import type { ToolsApi } from "./mcp-tools.ts";
import type { NormalizedMessage } from "./normalize-message.ts";

/** A complete normalized message; override only the fields a test cares about. */
export function makeMessage(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
    return {
        id: "m1",
        cliMsgId: null,
        threadId: "t1",
        threadType: "dm",
        senderId: "u1",
        senderName: "Alice",
        text: "hello",
        timestamp: Date.now(),
        ts: null,
        type: "text",
        attachment: null,
        replyTo: null,
        ...overrides,
    };
}

const unsupported = async (): Promise<never> => {
    throw new Error("not implemented by this test's fake api");
};

/** A tools api whose methods all throw; override the ones a test exercises. */
export function makeToolsApi(overrides: Partial<ToolsApi> = {}): ToolsApi {
    return {
        sendMessage: unsupported,
        addReaction: unsupported,
        getAllFriends: unsupported,
        getAllGroups: unsupported,
        getGroupInfo: unsupported,
        getGroupMembersInfo: unsupported,
        getUserInfo: unsupported,
        listener: {
            on: () => {
                throw new Error("not implemented by this test's fake api");
            },
            removeListener: () => {
                throw new Error("not implemented by this test's fake api");
            },
            requestOldMessages: () => {
                throw new Error("not implemented by this test's fake api");
            },
        },
        ...overrides,
    };
}
