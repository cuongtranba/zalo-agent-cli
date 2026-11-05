import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { MessageContent, SendMessageResponse } from "zca-js";
import type { MCPConfig } from "./mcp-config.ts";
import type { NormalizedMessage } from "./normalize-message.ts";
import { makeMessage } from "./test-fixtures.ts";
import { ZaloNotifier } from "./notifier.ts";
import { InboxSubscribers } from "./mcp-resources.ts";

/** Create a spy api.sendMessage that records calls */
const SENT: SendMessageResponse = { message: null, attachment: [] };

function makeSpy() {
    const calls: Array<{ text: string; thread: string; type: number | undefined }> = [];
    const api = {
        sendMessage: async (message: string | MessageContent, thread: string, type?: number) => {
            calls.push({ text: String(message), thread, type });
            return SENT;
        },
    };
    return { api, calls };
}

/** Minimal enabled config for ZaloNotifier */
function enabledConfig(overrides: Partial<MCPConfig["notify"]> = {}) {
    return {
        notify: {
            enabled: true,
            thread: "notify_group_123",
            on: ["dm"],
            cooldown: "10ms", // very short for tests
            ...overrides,
        },
    };
}

/** Disabled config */
function disabledConfig() {
    return {
        notify: {
            enabled: false,
            thread: "notify_group_123",
            on: ["dm"],
            cooldown: "10ms",
        },
    };
}

/** A normalised DM message */
function dmMsg(text = "hello", overrides: Partial<NormalizedMessage> = {}) {
    return makeMessage({ threadType: "dm", senderId: "user_1", senderName: "Alice", text, ...overrides });
}

/** Wait for ms milliseconds */
function wait(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

describe("ZaloNotifier constructor", () => {
    it("is disabled by default when config.notify.enabled=false", () => {
        const { api } = makeSpy();
        const n = new ZaloNotifier(() => api, disabledConfig());
        assert.equal(n._enabled, false);
    });

    it("is enabled when config.notify.enabled=true", () => {
        const { api } = makeSpy();
        const n = new ZaloNotifier(() => api, enabledConfig());
        assert.equal(n._enabled, true);
    });

    it("stores notify thread and onTypes from config", () => {
        const { api } = makeSpy();
        const n = new ZaloNotifier(() => api, enabledConfig({ thread: "grp_99", on: ["dm", "group"] }));
        assert.equal(n._notifyThread, "grp_99");
        assert.ok(n._onTypes.has("dm"));
        assert.ok(n._onTypes.has("group"));
    });
});

describe("ZaloNotifier onMessage - disabled", () => {
    it("does not queue messages when disabled", async () => {
        const { api, calls } = makeSpy();
        const n = new ZaloNotifier(() => api, disabledConfig());
        n.onMessage(dmMsg());
        await wait(30);
        assert.equal(calls.length, 0);
        assert.equal(n._pending.length, 0);
        n.destroy();
    });
});

describe("ZaloNotifier onMessage - inbox subscribers", () => {
    it("does not notify while a client is subscribed to the inbox", async () => {
        const { api, calls } = makeSpy();
        const inboxSubscribers = new InboxSubscribers();
        inboxSubscribers.add("session-1");
        const n = new ZaloNotifier(() => api, enabledConfig(), { inboxSubscribers });
        n.onMessage(dmMsg());
        await wait(30);
        assert.equal(calls.length, 0);
        n.destroy();
    });

    it("notifies again once the last subscriber is gone", async () => {
        const { api, calls } = makeSpy();
        const inboxSubscribers = new InboxSubscribers();
        inboxSubscribers.add("session-1");
        const n = new ZaloNotifier(() => api, enabledConfig(), { inboxSubscribers });
        n.onMessage(dmMsg("ignored"));
        inboxSubscribers.remove("session-1");
        n.onMessage(dmMsg("should notify"));
        await wait(30);
        assert.equal(calls.length, 1);
        assert.ok(calls[0].text.includes("1 tin nhắn mới"));
        n.destroy();
    });
});

describe("ZaloNotifier flush", () => {
    it(
        "messages arriving while a notification is being sent are delivered in the next batch, not dropped",
        { timeout: 2000 },
        async () => {
            const sent: string[] = [];
            let releaseFirstSend: (value: SendMessageResponse) => void = () => {};
            let firstSendStarted: () => void = () => {};
            let secondSendDone: () => void = () => {};
            const started = new Promise<void>((r) => (firstSendStarted = r));
            const secondSent = new Promise<void>((r) => (secondSendDone = r));
            // The first send stays pending until the test releases it
            const api = {
                sendMessage: (message: string | MessageContent) => {
                    sent.push(String(message));
                    if (sent.length === 1) {
                        firstSendStarted();
                        return new Promise<SendMessageResponse>((release) => (releaseFirstSend = release));
                    }
                    secondSendDone();
                    return Promise.resolve(SENT);
                },
            };
            const n = new ZaloNotifier(() => api, enabledConfig());

            n.onMessage(dmMsg("first"));
            await started;
            n.onMessage(dmMsg("during send"));
            releaseFirstSend(SENT);
            await secondSent;

            assert.equal(sent.length, 2);
            assert.ok(sent[0].includes("first") && !sent[0].includes("during send"));
            assert.ok(sent[1].includes("during send"));
            n.destroy();
        },
    );
});

describe("ZaloNotifier onMessage - type filtering", () => {
    it("queues messages matching onTypes (dm)", async () => {
        const { api, calls } = makeSpy();
        const n = new ZaloNotifier(() => api, enabledConfig({ on: ["dm"] }));
        n.onMessage(dmMsg("queued"));
        await wait(30);
        assert.equal(calls.length, 1);
    });

    it("ignores messages not matching onTypes", async () => {
        const { api, calls } = makeSpy();
        const n = new ZaloNotifier(() => api, enabledConfig({ on: ["dm"] }));
        n.onMessage(makeMessage({ threadType: "group", senderId: "u1", senderName: "Bob", text: "hi" }));
        await wait(30);
        assert.equal(calls.length, 0);
    });

    it("notifies for group type when configured", async () => {
        const { api, calls } = makeSpy();
        const n = new ZaloNotifier(() => api, enabledConfig({ on: ["group"] }));
        n.onMessage(makeMessage({ threadType: "group", senderId: "u1", senderName: "Bob", text: "hi" }));
        await wait(30);
        assert.equal(calls.length, 1);
    });
});

describe("ZaloNotifier _flush notification format", () => {
    it("sends to the configured notify thread", async () => {
        const { api, calls } = makeSpy();
        const n = new ZaloNotifier(() => api, enabledConfig({ thread: "grp_notify" }));
        n.onMessage(dmMsg("test message"));
        await wait(30);
        assert.equal(calls[0].thread, "grp_notify");
        assert.equal(calls[0].type, 1); // Group conversation type
    });

    it("notification text includes sender name and message preview", async () => {
        const { api, calls } = makeSpy();
        const n = new ZaloNotifier(() => api, enabledConfig());
        n.onMessage(dmMsg("hello world", { senderName: "Alice" }));
        await wait(30);
        assert.ok(calls[0].text.includes("Alice"));
        assert.ok(calls[0].text.includes("hello world"));
    });

    it("shows up to 3 message previews in a single flush", async () => {
        const { api, calls } = makeSpy();
        const n = new ZaloNotifier(() => api, enabledConfig());
        n.onMessage(dmMsg("msg1", { senderName: "A" }));
        n.onMessage(dmMsg("msg2", { senderName: "B" }));
        n.onMessage(dmMsg("msg3", { senderName: "C" }));
        await wait(30);
        // Only one batched send
        assert.equal(calls.length, 1);
        assert.ok(calls[0].text.includes("msg1"));
        assert.ok(calls[0].text.includes("msg2"));
        assert.ok(calls[0].text.includes("msg3"));
    });

    it("includes overflow count when more than 3 messages", async () => {
        const { api, calls } = makeSpy();
        const n = new ZaloNotifier(() => api, enabledConfig());
        for (let i = 1; i <= 5; i++) {
            n.onMessage(dmMsg(`msg${i}`, { senderName: `User${i}` }));
        }
        await wait(30);
        assert.equal(calls.length, 1);
        // Should mention the extra 2 messages
        assert.ok(calls[0].text.includes("2"));
    });

    it("sends total message count in notification text", async () => {
        const { api, calls } = makeSpy();
        const n = new ZaloNotifier(() => api, enabledConfig());
        n.onMessage(dmMsg("one"));
        n.onMessage(dmMsg("two"));
        await wait(30);
        assert.ok(calls[0].text.includes("2"));
    });

    it("shows type breakdown with mixed media types", async () => {
        const { api, calls } = makeSpy();
        const n = new ZaloNotifier(() => api, enabledConfig());
        n.onMessage(dmMsg("hello", { type: "text" }));
        n.onMessage(dmMsg("[image]", { type: "image" }));
        n.onMessage(dmMsg("[voice]", { type: "voice" }));
        await wait(30);
        assert.ok(calls[0].text.includes("1 text"));
        assert.ok(calls[0].text.includes("1 ảnh"));
        assert.ok(calls[0].text.includes("1 voice"));
    });

    it("uses emoji prefix for audio and video types", async () => {
        const { api, calls } = makeSpy();
        const n = new ZaloNotifier(() => api, enabledConfig());
        n.onMessage(dmMsg("[audio]", { type: "audio", senderName: "Bob" }));
        n.onMessage(dmMsg("[video]", { type: "video", senderName: "Eve" }));
        await wait(30);
        assert.ok(calls[0].text.includes("🎵"));
        assert.ok(calls[0].text.includes("🎬"));
    });

    it("uses microphone emoji for voice messages", async () => {
        const { api, calls } = makeSpy();
        const n = new ZaloNotifier(() => api, enabledConfig());
        n.onMessage(dmMsg("[voice]", { type: "voice" }));
        await wait(30);
        assert.ok(calls[0].text.includes("🎤"));
    });
});

describe("ZaloNotifier cooldown batching", () => {
    it("batches multiple messages within cooldown into a single send", async () => {
        const { api, calls } = makeSpy();
        const n = new ZaloNotifier(() => api, enabledConfig({ cooldown: "20ms" }));
        n.onMessage(dmMsg("first"));
        n.onMessage(dmMsg("second"));
        n.onMessage(dmMsg("third"));
        await wait(50); // wait for cooldown to fire
        assert.equal(calls.length, 1);
    });

    it("clears pending after flush so next batch is independent", async () => {
        const { api, calls } = makeSpy();
        const n = new ZaloNotifier(() => api, enabledConfig({ cooldown: "20ms" }));
        n.onMessage(dmMsg("batch1"));
        await wait(40); // first flush

        n.onMessage(dmMsg("batch2"));
        await wait(40); // second flush

        assert.equal(calls.length, 2);
    });
});

describe("ZaloNotifier destroy", () => {
    it("flushes pending messages on destroy", async () => {
        const { api, calls } = makeSpy();
        // Long cooldown so timer wouldn't fire naturally
        const n = new ZaloNotifier(() => api, enabledConfig({ cooldown: "60000ms" }));
        n.onMessage(dmMsg("urgent"));
        n.destroy(); // should flush immediately
        // _flush is async, give it a tick
        await wait(10);
        assert.equal(calls.length, 1);
    });

    it("destroy with no pending messages does not send", async () => {
        const { api, calls } = makeSpy();
        const n = new ZaloNotifier(() => api, enabledConfig());
        n.destroy(); // nothing pending, no timer
        await wait(10);
        assert.equal(calls.length, 0);
    });
});
