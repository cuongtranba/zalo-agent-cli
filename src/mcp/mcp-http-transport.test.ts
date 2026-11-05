import { test } from "bun:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { createHTTPServer } from "./mcp-http-transport.ts";
import { registerZaloServer } from "./mcp-setup.ts";
import { InboxSubscribers } from "./mcp-resources.ts";
import { MessageBuffer } from "./message-buffer.ts";
import { ThreadFilter } from "./thread-filter.ts";
import type { HTTPServerDeps } from "./mcp-http-transport.ts";
import { makeMessage, makeToolsApi } from "./test-fixtures.ts";

const TOKEN = "secret-token";

const TOOL_NAMES = [
    "zalo_get_messages",
    "zalo_send_message",
    "zalo_send_attachment",
    "zalo_react",
    "zalo_list_threads",
    "zalo_search_threads",
    "zalo_list_conversations",
    "zalo_get_group_members",
    "zalo_get_user_info",
    "zalo_mark_read",
    "zalo_get_history",
    "zalo_view_media",
];

const deps: HTTPServerDeps = {
    getApi: () => makeToolsApi(),
    buffer: new MessageBuffer(),
    filter: new ThreadFilter({ watchThreads: [] }),
    config: {},
};

/** Start the HTTP server on an ephemeral loopback port and return it with its MCP URL */
async function startServer(authToken: string | null, extraDeps: Partial<HTTPServerDeps> = {}) {
    const server = createHTTPServer(registerZaloServer, { ...deps, ...extraDeps }, 0, authToken);
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    return { server, url: `http://127.0.0.1:${port}/mcp` };
}

test("HTTP MCP rejects requests without the bearer token and serves all tools with it", async () => {
    const { server, url } = await startServer(TOKEN);
    try {
        const anonymous = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
        });
        assert.equal(anonymous.status, 401);

        const client = new Client({ name: "test-client", version: "0.0.0" });
        await client.connect(
            new StreamableHTTPClientTransport(new URL(url), {
                requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
            }),
        );
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOL_NAMES].sort());
        await client.close();
    } finally {
        server.close();
    }
});

test("createHTTPServer refuses a non-loopback host without an auth token", () => {
    assert.throws(() => createHTTPServer(registerZaloServer, deps, 0, null, "0.0.0.0"));
});

test(
    "HTTP MCP session pushes resource updates to a subscribed client over the GET stream",
    { timeout: 5000 },
    async () => {
        const { server, url } = await startServer(TOKEN);
        const client = new Client({ name: "test-client", version: "0.0.0" });
        try {
            let updatedUri: string | null = null;
            client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
                updatedUri = n.params.uri;
            });
            await client.connect(
                new StreamableHTTPClientTransport(new URL(url), {
                    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
                }),
            );
            await client.subscribeResource({ uri: "zalo://inbox" });

            // The client opens its GET stream asynchronously after initialize and notifications sent before it
            // is open are dropped, so keep pushing across request round-trips until one gets through.
            while (!updatedUri) {
                deps.buffer.push(
                    "g1",
                    makeMessage({ id: "m1", threadId: "g1", threadType: "group", text: "hi", timestamp: 1 }),
                );
                await client.ping();
            }

            assert.equal(updatedUri, "zalo://inbox");
        } finally {
            await client.close();
            server.close();
        }
    },
);

const MCP_HEADERS = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${TOKEN}`,
};

test(
    "an idle HTTP session expires and releases its resources while a connected client keeps working",
    { timeout: 10000 },
    async () => {
        const inboxSubscribers = new InboxSubscribers();
        const { server, url } = await startServer(TOKEN, {
            config: { limits: { sessionIdleTimeout: "300ms" } },
            inboxSubscribers,
        });
        const healthUrl = url.replace("/mcp", "/health");
        const sessionCount = async () => ((await (await fetch(healthUrl)).json()) as { sessions: number }).sessions;
        const client = new Client({ name: "test-client", version: "0.0.0" });
        try {
            // A client that initializes and subscribes but then vanishes without a DELETE or an open stream
            const init = await fetch(url, {
                method: "POST",
                headers: MCP_HEADERS,
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "initialize",
                    params: {
                        protocolVersion: "2025-03-26",
                        capabilities: {},
                        clientInfo: { name: "abandoned", version: "0.0.0" },
                    },
                }),
            });
            await init.text();
            const abandonedId = init.headers.get("mcp-session-id");
            assert.ok(abandonedId);
            const sub = await fetch(url, {
                method: "POST",
                headers: { ...MCP_HEADERS, "mcp-session-id": abandonedId },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 2,
                    method: "resources/subscribe",
                    params: { uri: "zalo://inbox" },
                }),
            });
            await sub.text();
            assert.equal(inboxSubscribers.count(), 1);

            // A live client holds its GET stream open, so it must not expire
            await client.connect(
                new StreamableHTTPClientTransport(new URL(url), {
                    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
                }),
            );
            assert.equal(await sessionCount(), 2);

            while ((await sessionCount()) > 1) await new Promise((r) => setTimeout(r, 25));

            const gone = await fetch(url, {
                method: "POST",
                headers: { ...MCP_HEADERS, "mcp-session-id": abandonedId },
                body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping" }),
            });
            assert.equal(gone.status, 404);
            assert.equal(inboxSubscribers.count(), 0);
            const { tools } = await client.listTools();
            assert.equal(tools.length, TOOL_NAMES.length);
        } finally {
            await client.close();
            server.close();
        }
    },
);
