import { ThreadType, type GroupMessage, type TGroupMessage } from "zca-js";
import type { ToolsApi } from "./mcp-tools.ts";
import type { NormalizedMessage } from "./normalize-message.ts";

/**
 * Build a GroupMessage as returned by getCloudMessage. Fill only the fields a test cares about;
 * the rest get harmless defaults so the result is a structurally valid zca-js GroupMessage.
 */
export function makeGroupHistoryMessage(
    data: Partial<TGroupMessage> & Pick<TGroupMessage, "msgId" | "uidFrom" | "idTo" | "content">,
): GroupMessage {
    const full: TGroupMessage = {
        actionId: "0",
        cliMsgId: "0",
        msgType: "webchat",
        dName: "",
        ts: "0",
        status: 0,
        notify: "",
        ttl: 0,
        userId: "",
        uin: "",
        topOut: "",
        topOutTimeOut: "",
        topOutImprTimeOut: "",
        propertyExt: undefined,
        paramsExt: { countUnread: 0, containType: 0, platformType: 0 },
        cmd: 0,
        st: 0,
        at: 0,
        realMsgId: "",
        quote: undefined,
        mentions: undefined,
        ...data,
    };
    return { type: ThreadType.Group, data: full, threadId: full.idTo, isSelf: full.uidFrom === "0" };
}

/** Build a getCloudMessage response; fill only the fields a test cares about. */
export function makeCloudMessageResponse(overrides: {
    groupMsgs?: GroupMessage[];
    lastMsgId?: string;
    hasMore?: number;
    isOld?: number;
    isFiltered?: number;
}) {
    return {
        error: 0,
        groupMsgs: [],
        lastMsgId: "",
        minMsgId: "",
        maxMsgId: "",
        msgJumpId: "",
        hasMore: 0,
        isOld: 0,
        isFiltered: 0,
        isFilteredByPhase: 0,
        isFilteredByTimeJoin: 0,
        rootMsgId: null,
        isRootDel: 0,
        tsJoinGroup: null,
        ...overrides,
    };
}

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
        getCloudMessage: unsupported,
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
