import { test } from "bun:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { registerZaloServer } from "./mcp-setup.ts";
import { InboxSubscribers } from "./mcp-resources.ts";
import { ZaloNotifier } from "./notifier.ts";
import { MessageBuffer } from "./message-buffer.ts";
import { ThreadFilter } from "./thread-filter.ts";
import { makeMessage, makeToolsApi } from "./test-fixtures.ts";
import type { MessageContent, SendMessageResponse } from "zca-js";

const MESSAGE = makeMessage({ id: "m1", threadId: "g1", threadType: "group", text: "hello" });

/** Connect a real Client to a McpServer set up like production; resolves update URIs via `updates` */
async function connect(buffer: MessageBuffer, inboxSubscribers?: InboxSubscribers) {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerZaloServer(server, () => makeToolsApi(), buffer, new ThreadFilter({ watchThreads: [] }), {}, undefined, {
        inboxSubscribers,
    });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const updates: string[] = [];
    const nextUpdate = Promise.withResolvers<string>();
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
        updates.push(n.params.uri);
        nextUpdate.resolve(n.params.uri);
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    return { client, nextUpdate: nextUpdate.promise, updates };
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
    const inbox = JSON.parse((contents[0] as { text: string }).text);

    assert.equal(inbox.messages.length, 1);
    assert.equal(inbox.messages[0].text, "hello");
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

/** A notifier sharing `inboxSubscribers`, whose Zalo-group sends resolve `firstSend` */
function makeNotifier(inboxSubscribers: InboxSubscribers) {
    const sent: string[] = [];
    const firstSend = Promise.withResolvers<void>();
    const api = {
        sendMessage: async (message: string | MessageContent) => {
            sent.push(String(message));
            firstSend.resolve();
            const response: SendMessageResponse = { message: null, attachment: [] };
            return response;
        },
    };
    const config = { notify: { enabled: true, thread: "notify_group", on: ["dm"], cooldown: "20ms" } };
    return { notifier: new ZaloNotifier(() => api, config, { inboxSubscribers }), sent, firstSend: firstSend.promise };
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
        const dm = makeMessage({ threadType: "dm", senderId: "u1", senderName: "Alice", text: "hi" });

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
    notifier.onMessage(makeMessage({ threadType: "dm", senderId: "u1", senderName: "Alice", text: "hi" }));
    await firstSend;

    assert.equal(sent.length, 1);
    notifier.destroy();
});
