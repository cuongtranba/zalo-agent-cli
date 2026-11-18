import { test } from "bun:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ThreadType, type MessageContent } from "zca-js";
import { registerTools, type ToolsApi } from "./mcp-tools.ts";
import { MessageBuffer } from "./message-buffer.ts";
import { normalizeMessage } from "./normalize-message.ts";
import { ThreadFilter } from "./thread-filter.ts";
import { makeToolsApi, makeGroupHistoryMessage, makeCloudMessageResponse } from "./test-fixtures.ts";

/** Raw zca-js group message event, as delivered by the listener */
const RAW_EVENT = {
    threadId: "g1",
    type: ThreadType.Group,
    isSelf: false,
    data: {
        msgId: "m100",
        cliMsgId: "c100",
        uidFrom: "u7",
        dName: "Lan",
        content: "hello",
        msgType: "webchat",
        ts: "1700000000000",
        ttl: 0,
        propertyExt: undefined,
    },
};

/** Fake zca-js api that records every call */
function makeFakeApi() {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const api = makeToolsApi({
        sendMessage: async (...args: Parameters<ToolsApi["sendMessage"]>) => {
            calls.push({ method: "sendMessage", args });
            return { message: { msgId: 555 }, attachment: [] };
        },
        addReaction: async (...args: Parameters<ToolsApi["addReaction"]>) => {
            calls.push({ method: "addReaction", args });
            return { msgIds: [1] };
        },
    });
    return { api, calls };
}

/** Connect a real Client to a McpServer with the Zalo tools registered */
async function connect(getApi: () => ToolsApi, buffer = new MessageBuffer()) {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, getApi, buffer, new ThreadFilter({ watchThreads: [] }), {});
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    return client;
}

test("tools use the Zalo session that is current at call time (regression: stale api after re-login)", async () => {
    const first = makeFakeApi();
    const second = makeFakeApi();
    let current = first.api;
    const client = await connect(() => current);

    current = second.api;
    await client.callTool({ name: "zalo_send_message", arguments: { threadId: "t1", text: "hi" } });

    assert.equal(first.calls.length, 0);
    assert.deepEqual(second.calls, [{ method: "sendMessage", args: ["hi", "t1", 0] }]);
});

test("zalo_send_message with replyToMessageId quotes the buffered message", async () => {
    const { api, calls } = makeFakeApi();
    const buffer = new MessageBuffer();
    buffer.push("g1", normalizeMessage(RAW_EVENT));
    const client = await connect(() => api, buffer);

    const result = await client.callTool({
        name: "zalo_send_message",
        arguments: { threadId: "g1", threadType: 1, text: "answer", replyToMessageId: "m100" },
    });

    assert.equal(result.isError, undefined);
    const [content, threadId, type] = calls[0].args as [Exclude<MessageContent, string>, string, number];
    assert.equal(content.msg, "answer");
    assert.ok(content.quote);
    assert.equal(content.quote.msgId, "m100");
    assert.equal(content.quote.cliMsgId, "c100");
    assert.equal(content.quote.uidFrom, "u7");
    assert.equal(content.quote.content, "hello");
    assert.equal(threadId, "g1");
    assert.equal(type, 1);
});

test('zalo_send_message accepts threadType "group" and reports messageId and sentAt', async () => {
    const { api, calls } = makeFakeApi();
    const client = await connect(() => api);
    const before = Date.now();

    const result = await client.callTool({
        name: "zalo_send_message",
        arguments: { threadId: "g1", threadType: "group", text: "hi" },
    });

    assert.equal(result.isError, undefined);
    assert.deepEqual(calls[0].args, ["hi", "g1", ThreadType.Group]);
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    assert.equal(payload.messageId, 555);
    assert.equal(typeof payload.sentAt, "number");
    assert.ok(payload.sentAt >= before);
});

test("zalo_react sends the buffered cliMsgId", async () => {
    const { api, calls } = makeFakeApi();
    const buffer = new MessageBuffer();
    buffer.push("g1", normalizeMessage(RAW_EVENT));
    const client = await connect(() => api, buffer);

    await client.callTool({
        name: "zalo_react",
        arguments: { messageId: "m100", threadId: "g1", threadType: 1, reaction: "heart" },
    });

    assert.deepEqual(calls[0].args, [
        "/-heart",
        { data: { msgId: "m100", cliMsgId: "c100" }, threadId: "g1", type: 1 },
    ]);
});

/** Read the JSON payload out of a successful tool result. */
function payloadOf(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
    assert.equal(result.isError, undefined);
    return JSON.parse((result.content as Array<{ text: string }>)[0].text);
}

test("zalo_get_history pages group history via getCloudMessage (reliable for low-traffic groups)", async () => {
    // Two pages: newest first, then older; hasMore drives pagination and the cursor is passed back.
    const page1 = makeCloudMessageResponse({
        lastMsgId: "cur1",
        hasMore: 1,
        groupMsgs: [
            makeGroupHistoryMessage({
                msgId: "m2",
                uidFrom: "u2",
                idTo: "g5",
                dName: "Bình",
                content: "ok",
                ts: "1700000001000",
            }),
        ],
    });
    const page2 = makeCloudMessageResponse({
        lastMsgId: "cur2",
        hasMore: 0,
        groupMsgs: [
            makeGroupHistoryMessage({
                msgId: "m1",
                uidFrom: "u1",
                idTo: "g5",
                dName: "An",
                content: "chào cả nhà",
                ts: "1700000000000",
            }),
        ],
    });
    const seen: Array<string | undefined> = [];
    const api = makeToolsApi({
        getCloudMessage: async (groupId, lastMsgId) => {
            assert.equal(groupId, "g5");
            seen.push(lastMsgId);
            return lastMsgId ? page2 : page1;
        },
    });
    const client = await connect(() => api);

    const result = await client.callTool({
        name: "zalo_get_history",
        arguments: { threadId: "g5", threadType: "group", limit: 50 },
    });

    const payload = payloadOf(result);
    assert.equal(payload.threadType, "group");
    assert.equal(payload.count, 2);
    assert.deepEqual(seen, [undefined, "cur1"]); // first page then older page using the cursor
    const messages = payload.messages as Array<{ msgId: string; text: string; senderName: string }>;
    assert.equal(messages[0].text, "chào cả nhà"); // oldest first after sort
    assert.equal(messages[1].msgId, "m2");
    assert.equal(messages[0].senderName, "An");
});

test("zalo_search_messages matches a group history keyword accent-insensitively", async () => {
    const api = makeToolsApi({
        getCloudMessage: async () =>
            makeCloudMessageResponse({
                hasMore: 0,
                groupMsgs: [
                    makeGroupHistoryMessage({
                        msgId: "m1",
                        uidFrom: "u1",
                        idTo: "g5",
                        content: "Gửi khách duyệt bài",
                        ts: "1700000000000",
                    }),
                    makeGroupHistoryMessage({
                        msgId: "m2",
                        uidFrom: "u2",
                        idTo: "g5",
                        content: "ok em",
                        ts: "1700000001000",
                    }),
                ],
            }),
    });
    const client = await connect(() => api);

    // "duyet" (no accents) should match "duyệt"
    const result = await client.callTool({
        name: "zalo_search_messages",
        arguments: { query: "duyet", threadId: "g5", threadType: "group" },
    });

    const payload = payloadOf(result);
    assert.equal(payload.count, 1);
    assert.equal((payload.messages as Array<{ msgId: string }>)[0].msgId, "m1");
});

test("zalo_search_messages filters buffered messages by sender", async () => {
    const buffer = new MessageBuffer();
    buffer.push("g1", normalizeMessage(RAW_EVENT)); // uidFrom u7, text "hello"
    buffer.push(
        "g1",
        normalizeMessage({ ...RAW_EVENT, data: { ...RAW_EVENT.data, msgId: "m200", uidFrom: "u9", content: "world" } }),
    );
    const client = await connect(() => makeToolsApi(), buffer);

    const result = await client.callTool({
        name: "zalo_search_messages",
        arguments: { senderId: "u9" },
    });

    const payload = payloadOf(result);
    assert.equal(payload.count, 1);
    assert.equal((payload.messages as Array<{ text: string }>)[0].text, "world");
});
