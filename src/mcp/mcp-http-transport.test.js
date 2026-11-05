import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { createHTTPServer } from "./mcp-http-transport.js";
import { registerZaloServer } from "./mcp-setup.js";
import { MessageBuffer } from "./message-buffer.js";

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

const deps = { getApi: () => ({}), buffer: new MessageBuffer(), filter: {}, config: {}, nameCache: null };

/** Start the HTTP server on an ephemeral loopback port and return it with its MCP URL */
async function startServer(authToken) {
    const server = createHTTPServer(registerZaloServer, deps, 0, authToken);
    await once(server, "listening");
    return { server, url: `http://127.0.0.1:${server.address().port}/mcp` };
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
            let updatedUri = null;
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
                deps.buffer.push("g1", { id: "m1", threadId: "g1", threadType: "group", content: "hi", timestamp: 1 });
                await client.ping();
            }

            assert.equal(updatedUri, "zalo://inbox");
        } finally {
            await client.close();
            server.close();
        }
    },
);
