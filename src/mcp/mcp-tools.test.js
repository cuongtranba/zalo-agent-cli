import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTools } from "./mcp-tools.js";
import { MessageBuffer } from "./message-buffer.js";
import { normalizeMessage } from "./normalize-message.js";

/** Raw zca-js group message event, as delivered by the listener */
const RAW_EVENT = {
    threadId: "g1",
    type: 1,
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
    const calls = [];
    const api = {
        sendMessage: async (...args) => {
            calls.push({ method: "sendMessage", args });
            return { message: { msgId: 555 }, attachment: [] };
        },
        addReaction: async (...args) => {
            calls.push({ method: "addReaction", args });
            return { msgIds: [1] };
        },
    };
    return { api, calls };
}

/** Connect a real Client to a McpServer with the Zalo tools registered */
async function connect(getApi, buffer = new MessageBuffer()) {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, getApi, buffer, {}, {});
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
    const [content, threadId, type] = calls[0].args;
    assert.equal(content.msg, "answer");
    assert.equal(content.quote.msgId, "m100");
    assert.equal(content.quote.cliMsgId, "c100");
    assert.equal(content.quote.uidFrom, "u7");
    assert.equal(content.quote.content, "hello");
    assert.equal(threadId, "g1");
    assert.equal(type, 1);
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
