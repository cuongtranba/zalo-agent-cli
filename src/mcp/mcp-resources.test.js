import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { registerZaloServer } from "./mcp-setup.js";
import { MessageBuffer } from "./message-buffer.js";

const MESSAGE = { id: "m1", threadId: "g1", threadType: "group", content: "hello", timestamp: Date.now() };

/** Connect a real Client to a McpServer set up like production; resolves update URIs via `updates` */
async function connect(buffer) {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerZaloServer(server, () => ({}), buffer, {}, {});
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const updates = [];
    let notify;
    const nextUpdate = new Promise((resolve) => (notify = resolve));
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
        updates.push(n.params.uri);
        notify(n.params.uri);
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    return { client, nextUpdate, updates };
}

test("a subscribed client is notified when a message is buffered", { timeout: 5000 }, async () => {
    const buffer = new MessageBuffer();
    const { client, nextUpdate } = await connect(buffer);

    await client.subscribeResource({ uri: "zalo://inbox" });
    buffer.push("g1", { ...MESSAGE });

    assert.equal(await nextUpdate, "zalo://inbox");
    await client.close();
});

test("reading zalo://inbox returns buffered messages in the zalo_get_messages shape", async () => {
    const buffer = new MessageBuffer();
    buffer.push("g1", { ...MESSAGE });
    const { client } = await connect(buffer);

    const { contents } = await client.readResource({ uri: "zalo://inbox" });
    const inbox = JSON.parse(contents[0].text);

    assert.equal(inbox.messages.length, 1);
    assert.equal(inbox.messages[0].content, "hello");
    assert.equal(inbox.cursor, inbox.messages[0]._cursor);
    assert.equal(inbox.hasMore, false);
    await client.close();
});

test("an unsubscribed client receives no inbox updates", { timeout: 5000 }, async () => {
    const buffer = new MessageBuffer();
    const { client, updates } = await connect(buffer);

    await client.subscribeResource({ uri: "zalo://inbox" });
    await client.unsubscribeResource({ uri: "zalo://inbox" });
    buffer.push("g1", { ...MESSAGE });
    // A request round-trip after the push guarantees any (wrongly) sent notification has been delivered
    await client.listTools();

    assert.deepEqual(updates, []);
    await client.close();
});
