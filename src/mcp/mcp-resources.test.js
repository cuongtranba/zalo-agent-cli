import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { registerZaloServer } from "./mcp-setup.js";
import { InboxSubscribers } from "./mcp-resources.js";
import { ZaloNotifier } from "./notifier.js";
import { MessageBuffer } from "./message-buffer.js";

const MESSAGE = { id: "m1", threadId: "g1", threadType: "group", content: "hello", timestamp: Date.now() };

/** Connect a real Client to a McpServer set up like production; resolves update URIs via `updates` */
async function connect(buffer, inboxSubscribers, config = {}) {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerZaloServer(server, () => ({}), buffer, {}, config, undefined, { inboxSubscribers });
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

test("zalo://inbox shows the newest messages when more than the window are buffered", async () => {
    const buffer = new MessageBuffer();
    for (let i = 1; i <= 5; i++) buffer.push("g1", { ...MESSAGE, id: `m${i}` });
    const { client } = await connect(buffer, undefined, { limits: { inboxWindow: 2 } });

    const { contents } = await client.readResource({ uri: "zalo://inbox" });
    const inbox = JSON.parse(contents[0].text);

    assert.deepEqual(
        inbox.messages.map((m) => m.id),
        ["m4", "m5"],
    );
    assert.equal(inbox.hasMore, true);
    assert.equal(inbox.cursor, inbox.messages[1]._cursor);
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

/** A notifier sharing `inboxSubscribers`, whose Zalo-group sends resolve `firstSend` */
function makeNotifier(inboxSubscribers) {
    const sent = [];
    let notifySent;
    const firstSend = new Promise((resolve) => (notifySent = resolve));
    const api = {
        sendMessage: async (text) => {
            sent.push(text);
            notifySent();
        },
    };
    const config = { notify: { enabled: true, thread: "notify_group", on: ["dm"], cooldown: "20ms" } };
    return { notifier: new ZaloNotifier(() => api, config, { inboxSubscribers }), sent, firstSend };
}

test(
    "the Zalo-group notifier stays quiet while a client is subscribed and resumes after it unsubscribes",
    {
        timeout: 5000,
    },
    async () => {
        const inboxSubscribers = new InboxSubscribers();
        const { client } = await connect(new MessageBuffer(), inboxSubscribers);
        const { notifier, sent, firstSend } = makeNotifier(inboxSubscribers);
        const dm = { threadType: "dm", senderId: "u1", senderName: "Alice", text: "hi" };

        await client.subscribeResource({ uri: "zalo://inbox" });
        notifier.onMessage(dm);
        await new Promise((r) => setTimeout(r, 100)); // well past the 20ms cooldown
        assert.deepEqual(sent, []);

        await client.unsubscribeResource({ uri: "zalo://inbox" });
        notifier.onMessage(dm);
        await firstSend;
        assert.equal(sent.length, 1);

        await client.close();
        notifier.destroy();
    },
);

test("the Zalo-group notifier resumes when a subscribed client disconnects", { timeout: 5000 }, async () => {
    const inboxSubscribers = new InboxSubscribers();
    const { client } = await connect(new MessageBuffer(), inboxSubscribers);
    const { notifier, sent, firstSend } = makeNotifier(inboxSubscribers);

    await client.subscribeResource({ uri: "zalo://inbox" });
    await client.close();
    notifier.onMessage({ threadType: "dm", senderId: "u1", senderName: "Alice", text: "hi" });
    await firstSend;

    assert.equal(sent.length, 1);
    notifier.destroy();
});
