/**
 * MCP tool registrations for Zalo message access and sending.
 * Registers 13 tools: zalo_get_messages, zalo_get_history, zalo_search_messages, zalo_send_message,
 * zalo_send_attachment, zalo_react, zalo_list_threads, zalo_search_threads, zalo_list_conversations,
 * zalo_get_group_members, zalo_get_user_info, zalo_mark_read, zalo_view_media.
 */

import { rm } from "fs/promises";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Reactions, type API, type MessageContent, type Message, type ThreadType } from "zca-js";
import { downloadMedia, openFile } from "./media-downloader.ts";
import { createAttachmentDir, resolveAttachmentSources } from "./attachment-source.ts";
import { QUOTE_SOURCE } from "./normalize-message.ts";
import type { MessageBuffer, BufferedMessage } from "./message-buffer.ts";
import type { MCPServerConfig } from "./mcp-config.ts";
import type { ThreadFilter } from "./thread-filter.ts";
import type { ThreadNameCache } from "./thread-name-cache.ts";
import { extractMessageText } from "../utils/extract-message-text.ts";
import { errorMessage } from "../utils/error-message.ts";

/** The part of zca-js's Listener the history tool uses to page through old messages. */
export interface HistoryListener {
    on(event: "old_messages", handler: (messages: Message[]) => void): unknown;
    removeListener(event: "old_messages", handler: (messages: Message[]) => void): unknown;
    requestOldMessages(threadType: ThreadType, lastMsgId?: string | null): void;
}

/** The zca-js API surface the MCP tools call. */
export type ToolsApi = Pick<
    API,
    | "sendMessage"
    | "addReaction"
    | "getAllFriends"
    | "getAllGroups"
    | "getGroupInfo"
    | "getGroupMembersInfo"
    | "getUserInfo"
    | "getCloudMessage"
> & { listener: HistoryListener };

/** Thread type constants matching zca-js ThreadType enum */
const THREAD_USER = 0;
const THREAD_GROUP = 1;

/**
 * threadType accepted by every tool that targets a thread: the numeric zca-js value or the
 * "dm"/"group" name that buffered messages carry. A plain union (no transform) keeps the
 * generated JSON input schema a simple anyOf of consts; handlers normalize with toThreadType.
 */
const THREAD_TYPE_SCHEMA = z
    .union([z.literal(0), z.literal(1), z.literal("dm"), z.literal("group")])
    .default(THREAD_USER)
    .describe('Thread type: 0 or "dm" = DM, 1 or "group" = group');

/** Normalize an accepted threadType value to the zca-js numeric ThreadType. */
function toThreadType(value: z.infer<typeof THREAD_TYPE_SCHEMA>): 0 | 1 {
    return value === 1 || value === "group" ? THREAD_GROUP : THREAD_USER;
}

/** Reaction names exposed to agents, mapped to zca-js Reactions codes */
const REACTION_CODES = {
    heart: Reactions.HEART,
    like: Reactions.LIKE,
    haha: Reactions.HAHA,
    wow: Reactions.WOW,
    cry: Reactions.CRY,
    angry: Reactions.ANGRY,
};

/** Max ids per getGroupInfo / getGroupMembersInfo request */
const BATCH_SIZE = 50;

/**
 * Wrap a result object into MCP tool content format.
 */
function ok(result: unknown): CallToolResult {
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
}

/**
 * Wrap an error message into MCP tool error content format.
 */
function err(message: string): CallToolResult {
    return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

/**
 * Split a list into fixed-size batches.
 */
function toBatches<T>(list: T[], size: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < list.length; i += size) batches.push(list.slice(i, i + size));
    return batches;
}

/** One message returned by zalo_get_history and zalo_search_messages. */
interface HistoryMessage {
    msgId: string | undefined;
    threadId: string;
    senderId: string | null;
    senderName: string | null;
    text: string;
    timestamp: number | null;
    type: string;
    threadName?: string;
}

/** A zca-js message as returned by the listener or getCloudMessage: a wrapper with .threadId and .data. */
type RawMessage = Pick<Message, "threadId" | "data">;

/** Map a raw zca-js message (listener event or group history) to the HistoryMessage shape. */
function toHistoryMessage(msg: RawMessage): HistoryMessage {
    const rawContent = msg.data?.content;
    const isText = typeof rawContent === "string";
    return {
        msgId: msg.data?.msgId,
        threadId: msg.threadId,
        senderId: msg.data?.uidFrom || null,
        senderName: msg.data?.dName || null,
        text: isText ? rawContent : extractMessageText(rawContent, msg.data?.msgType),
        timestamp: msg.data?.ts ? Number(msg.data.ts) : null,
        type: isText ? "text" : msg.data?.msgType || "attachment",
    };
}

/** Lower-case and strip Vietnamese/diacritic marks so message search is accent-insensitive. */
function foldText(value: string): string {
    return value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}

/** zca-js throws code -69 when the cloud service has nothing more to load: stop paging. */
function isStopPagingError(e: unknown): boolean {
    return typeof e === "object" && e !== null && "code" in e && (e as { code: unknown }).code === -69;
}

/**
 * Fetch a group's messages from Zalo's cloud message service (getCloudMessage), paging from newest
 * to older until `limit` messages are collected or the server has no more. Returns newest-first.
 * Replaces the removed `/api/group/history` endpoint (zca-js getGroupChatHistory, now 404).
 */
async function fetchGroupHistory(
    api: Pick<ToolsApi, "getCloudMessage">,
    groupId: string,
    limit: number,
): Promise<{ messages: HistoryMessage[]; hasMore: boolean; cursor: string | null }> {
    const messages: HistoryMessage[] = [];
    let cursor: string | undefined;
    let isOld = false;
    let moreOnServer = false;
    const maxPages = Math.ceil(limit / 50) + 1;

    for (let page = 0; page < maxPages && messages.length < limit; page++) {
        let res: Awaited<ReturnType<ToolsApi["getCloudMessage"]>>;
        try {
            res = await api.getCloudMessage(groupId, cursor, cursor ? { isOld } : undefined);
        } catch (e) {
            if (isStopPagingError(e)) break;
            throw e;
        }
        const batch = res?.groupMsgs ?? [];
        for (const m of batch) messages.push(toHistoryMessage(m));
        moreOnServer = Boolean(res?.hasMore);
        const next = res?.lastMsgId ?? null;
        if (!moreOnServer) break; // server says no older messages
        if (batch.length === 0 && (res?.isFiltered || next === (cursor ?? null))) break;
        if (next === null || next === (cursor ?? null)) break; // cursor stopped moving
        cursor = next;
        isOld = Boolean(res?.isOld);
    }

    const truncated = messages.length > limit;
    return { messages: messages.slice(0, limit), hasMore: moreOnServer || truncated, cursor: cursor ?? null };
}

/**
 * Fetch DM history by paging the live listener's `old_messages` stream and filtering to one thread.
 * zca-js 2.1.2 has no thread-scoped REST endpoint for DMs (only groups), so this is best-effort:
 * the listener returns messages globally for the thread type, so low-traffic DMs may need more pages.
 */
async function fetchDmHistoryViaListener(
    listener: HistoryListener,
    threadId: string,
    limit: number,
    lastMsgId: string | null,
): Promise<{ messages: HistoryMessage[]; cursor: string | null; hasMore: boolean }> {
    const target = String(threadId);
    const messages: HistoryMessage[] = [];
    let cursor = lastMsgId;
    let done = false;
    const maxPages = Math.ceil(limit / 20);

    for (let page = 0; !done && messages.length < limit && page < maxPages; page++) {
        const pageMessages = await new Promise<Message[]>((resolve) => {
            const handler = (received: Message[]) => {
                clearTimeout(timer);
                listener.removeListener("old_messages", handler);
                resolve(received);
            };
            const timer = setTimeout(() => {
                listener.removeListener("old_messages", handler);
                resolve([]);
            }, 10000);
            listener.on("old_messages", handler);
            listener.requestOldMessages(THREAD_USER, cursor);
        });

        if (!pageMessages || pageMessages.length === 0) {
            done = true;
            break;
        }

        for (const msg of pageMessages) {
            if (messages.length >= limit) break;
            const msgThread = String(msg.threadId || "");
            const msgSender = String(msg.data?.uidFrom || "");
            if (msgThread !== target && msgSender !== target) continue;
            messages.push(toHistoryMessage(msg));
        }

        const lastMsg = pageMessages[pageMessages.length - 1];
        const nextId = lastMsg?.data?.actionId || lastMsg?.data?.msgId;
        if (!nextId || nextId === cursor) done = true;
        cursor = nextId ?? null;
    }

    return { messages, cursor, hasMore: !done };
}

/**
 * Read buffered messages and enrich them with thread names.
 * Shared by the zalo_get_messages tool and the zalo://inbox resource so both return the same shape.
 * `newest` returns the latest `limit` messages (oldest→newest) instead of paging forward from `since`.
 */
export function readBufferedMessages(
    buffer: MessageBuffer,
    nameCache: ThreadNameCache | undefined,
    {
        threadId,
        since = 0,
        limit,
        newest = false,
    }: { threadId?: string; since?: number; limit: number; newest?: boolean },
): { messages: BufferedMessage[]; cursor: number; hasMore: boolean } {
    const result = buffer.read(threadId, since, limit, { newest });
    if (nameCache) {
        for (const msg of result.messages) {
            const info = nameCache.get(msg.threadId);
            if (info) msg.threadName = info.name;
        }
    }
    return result;
}

/**
 * Register all Zalo MCP tools on the server.
 * @param getApi - Returns the current zca-js API instance (changes after re-login, so call per request)
 */
export function registerTools(
    server: McpServer,
    getApi: () => ToolsApi,
    buffer: MessageBuffer,
    _filter: ThreadFilter,
    config: MCPServerConfig,
    nameCache?: ThreadNameCache,
): void {
    const maxPerPoll = config.limits?.maxMessagesPerPoll ?? 20;

    /** Find a buffered message by id, optionally scoped to one thread */
    const findBuffered = (messageId: string, threadId?: string) =>
        buffer.read(threadId, 0, Number.MAX_SAFE_INTEGER).messages.find((m) => m.id === messageId);

    // --- zalo_get_messages ---
    server.registerTool(
        "zalo_get_messages",
        {
            title: "Get Zalo Messages",
            description:
                "Get messages from Zalo threads (DMs and groups). Returns buffered messages since last read. Use 'since' cursor from previous response for incremental polling.",
            inputSchema: z.object({
                threadId: z.string().optional().describe("Thread ID to read from. Omit for all watched threads."),
                since: z.number().int().min(0).default(0).describe("Cursor from previous read for incremental polling"),
                limit: z.number().int().min(1).max(100).default(maxPerPoll).describe("Max messages to return"),
            }),
        },
        async ({ threadId, since, limit }) => {
            try {
                return ok(readBufferedMessages(buffer, nameCache, { threadId, since, limit }));
            } catch (e) {
                console.error("[mcp-tools] zalo_get_messages error:", errorMessage(e));
                return err(errorMessage(e));
            }
        },
    );

    // --- zalo_send_message ---
    server.registerTool(
        "zalo_send_message",
        {
            title: "Send Zalo Message",
            description:
                'Send a text message to a Zalo thread (DM or group). threadType: 0 or "dm" = DM, 1 or "group" = group. ' +
                "Optionally reply to a buffered message (replyToMessageId) or @mention users in a group.",
            inputSchema: z.object({
                threadId: z.string().describe("Thread ID to send message to"),
                text: z.string().min(1).describe("Message text to send"),
                threadType: THREAD_TYPE_SCHEMA,
                replyToMessageId: z
                    .string()
                    .optional()
                    .describe("Message ID (from zalo_get_messages) to quote. Only buffered messages can be quoted."),
                mentions: z
                    .array(
                        z.object({
                            userId: z.string().describe("User ID to mention"),
                            pos: z.number().int().min(0).describe("Start offset of the mention inside text"),
                            len: z.number().int().min(1).describe("Length of the mention inside text"),
                        }),
                    )
                    .optional()
                    .describe("@mentions (groups). pos/len mark the mention text, e.g. '@Name', inside text."),
            }),
        },
        async ({ threadId, text, threadType, replyToMessageId, mentions }) => {
            try {
                let content: string | MessageContent = text;
                if (replyToMessageId || mentions?.length) {
                    const rich: MessageContent = { msg: text };
                    content = rich;
                    if (replyToMessageId) {
                        const quote = findBuffered(replyToMessageId, threadId)?.[QUOTE_SOURCE];
                        if (!quote) {
                            return err(
                                `Message ${replyToMessageId} not found in buffer — can only reply to messages received while the server is running`,
                            );
                        }
                        rich.quote = quote;
                    }
                    if (mentions?.length) {
                        rich.mentions = mentions.map((m) => ({ pos: m.pos, uid: m.userId, len: m.len }));
                    }
                }
                const result = await getApi().sendMessage(content, threadId, toThreadType(threadType));
                const sentAt = Date.now();
                const messageId = result?.message?.msgId ?? null;
                return ok({ success: true, messageId, sentAt });
            } catch (e) {
                console.error("[mcp-tools] zalo_send_message error:", errorMessage(e));
                return err(errorMessage(e));
            }
        },
    );

    // --- zalo_send_attachment ---
    server.registerTool(
        "zalo_send_attachment",
        {
            title: "Send Zalo Attachment",
            description:
                "Send one or more files/images to a Zalo thread. Each source is an absolute file path on the " +
                'server host or an http(s) URL (downloaded first, max 25 MB). threadType: 0 or "dm" = DM, 1 or "group" = group.',
            inputSchema: z.object({
                threadId: z.string().describe("Thread ID to send to"),
                threadType: THREAD_TYPE_SCHEMA,
                sources: z
                    .array(z.string().min(1))
                    .min(1)
                    .max(10)
                    .describe("Absolute file paths on the server host, or http(s) URLs (1-10)"),
                caption: z.string().default("").describe("Optional text sent with the attachments"),
            }),
        },
        async ({ threadId, threadType, sources, caption }) => {
            let dir = null;
            try {
                dir = await createAttachmentDir();
                const paths = await resolveAttachmentSources(sources, dir);
                const result = await getApi().sendMessage(
                    { msg: caption, attachments: paths },
                    threadId,
                    toThreadType(threadType),
                );
                const sentAt = Date.now();
                const messageId = result?.message?.msgId ?? null;
                const attachmentIds = (result?.attachment ?? []).map((a) => a.msgId);
                return ok({ success: true, messageId, attachmentIds, sentAt });
            } catch (e) {
                console.error("[mcp-tools] zalo_send_attachment error:", errorMessage(e));
                return err(errorMessage(e));
            } finally {
                if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
            }
        },
    );

    // --- zalo_react ---
    server.registerTool(
        "zalo_react",
        {
            title: "React to Zalo Message",
            description:
                "Add a reaction to a message. Works best for messages received while the server is running " +
                "(their cliMsgId is known); otherwise pass cliMsgId explicitly. " +
                'threadType: 0 or "dm" = DM, 1 or "group" = group.',
            inputSchema: z.object({
                messageId: z.string().describe("Message ID to react to"),
                threadId: z.string().describe("Thread ID the message belongs to"),
                threadType: THREAD_TYPE_SCHEMA,
                reaction: z
                    .enum(Object.keys(REACTION_CODES) as [keyof typeof REACTION_CODES])
                    .describe("Reaction: heart, like, haha, wow, cry, angry"),
                cliMsgId: z
                    .string()
                    .optional()
                    .describe("Client message ID, only needed if the message is not buffered"),
            }),
        },
        async ({ messageId, threadId, threadType, reaction, cliMsgId }) => {
            try {
                const buffered = findBuffered(messageId, threadId);
                const resolvedCliMsgId = buffered?.cliMsgId ?? cliMsgId ?? messageId;
                await getApi().addReaction(REACTION_CODES[reaction], {
                    data: { msgId: messageId, cliMsgId: resolvedCliMsgId },
                    threadId,
                    type: toThreadType(threadType),
                });
                return ok({ success: true });
            } catch (e) {
                console.error("[mcp-tools] zalo_react error:", errorMessage(e));
                return err(errorMessage(e));
            }
        },
    );

    // --- zalo_list_threads ---
    server.registerTool(
        "zalo_list_threads",
        {
            title: "List Zalo Threads",
            description:
                "List all Zalo threads currently buffered with unread message counts. Useful for discovering active conversations.",
            inputSchema: z.object({
                type: z
                    .enum(["group", "dm", "all"])
                    .default("all")
                    .describe("Filter by thread type: 'dm', 'group', or 'all'"),
            }),
        },
        async ({ type }) => {
            try {
                const stats = buffer.getStats(0);
                // Enrich each stat entry with threadType and thread name
                const enriched = stats.map((t) => {
                    const threadType = buffer.getThreadType(t.threadId) ?? "unknown";
                    const cached = nameCache?.get(t.threadId);
                    return {
                        ...t,
                        threadType,
                        name: cached?.name ?? null,
                        ...(cached?.memberCount !== undefined && { memberCount: cached.memberCount }),
                    };
                });
                const filtered = type === "all" ? enriched : enriched.filter((t) => t.threadType === type);
                return ok({ threads: filtered, total: filtered.length });
            } catch (e) {
                console.error("[mcp-tools] zalo_list_threads error:", errorMessage(e));
                return err(errorMessage(e));
            }
        },
    );

    // --- zalo_search_threads ---
    server.registerTool(
        "zalo_search_threads",
        {
            title: "Search Zalo Threads",
            description:
                "Search threads (groups/DMs) by name. Uses fuzzy Vietnamese-aware matching. Useful for finding a thread ID by name.",
            inputSchema: z.object({
                query: z.string().min(1).describe("Search keyword (fuzzy match, case-insensitive, accent-insensitive)"),
                type: z
                    .enum(["group", "dm", "all"])
                    .default("all")
                    .describe("Filter by thread type: 'dm', 'group', or 'all'"),
                limit: z.number().int().min(1).max(50).default(10).describe("Max results to return"),
            }),
        },
        async ({ query, type, limit }) => {
            try {
                if (!nameCache?.ready) {
                    return err("Thread name cache not initialized yet. Try again shortly.");
                }
                const results = nameCache.search(query, type, limit);
                return ok({ results, total: results.length });
            } catch (e) {
                console.error("[mcp-tools] zalo_search_threads error:", errorMessage(e));
                return err(errorMessage(e));
            }
        },
    );

    // --- zalo_list_conversations ---
    server.registerTool(
        "zalo_list_conversations",
        {
            title: "List Zalo Conversations",
            description:
                "List conversations from the Zalo account itself (not just buffered ones): recent DMs by last " +
                "interaction and groups with member counts. Use the returned threadId with other tools.",
            inputSchema: z.object({
                type: z.enum(["dm", "group", "all"]).default("all").describe("Filter: 'dm', 'group', or 'all'"),
                limit: z.number().int().min(1).max(200).default(50).describe("Max results per type"),
            }),
        },
        async ({ type, limit }) => {
            try {
                const api = getApi();
                const conversations = [];

                if (type !== "group") {
                    const friends = await api.getAllFriends();
                    const recent = (Array.isArray(friends) ? friends : [])
                        .filter((f) => f.lastActionTime > 0)
                        .toSorted((a, b) => b.lastActionTime - a.lastActionTime)
                        .slice(0, limit);
                    for (const f of recent) {
                        conversations.push({
                            threadId: f.userId,
                            name: f.displayName || f.zaloName || "?",
                            threadType: "dm",
                            lastActionTime: f.lastActionTime,
                        });
                    }
                }

                if (type !== "dm") {
                    const groupIds = Object.keys((await api.getAllGroups())?.gridVerMap || {}).slice(0, limit);
                    for (const batch of toBatches(groupIds, BATCH_SIZE)) {
                        try {
                            const map = (await api.getGroupInfo(batch))?.gridInfoMap || {};
                            for (const [gid, g] of Object.entries(map)) {
                                conversations.push({
                                    threadId: gid,
                                    name: g.name || "?",
                                    threadType: "group",
                                    memberCount: g.totalMember || 0,
                                });
                            }
                        } catch (e) {
                            console.error("[mcp-tools] zalo_list_conversations batch failed:", errorMessage(e));
                        }
                    }
                }

                return ok({ conversations, total: conversations.length });
            } catch (e) {
                console.error("[mcp-tools] zalo_list_conversations error:", errorMessage(e));
                return err(errorMessage(e));
            }
        },
    );

    // --- zalo_get_group_members ---
    server.registerTool(
        "zalo_get_group_members",
        {
            title: "Get Zalo Group Members",
            description: "List members of a Zalo group with display names and admin/creator flags.",
            inputSchema: z.object({
                groupId: z.string().describe("Group thread ID"),
                limit: z.number().int().min(1).max(500).default(200).describe("Max members to return"),
            }),
        },
        async ({ groupId, limit }) => {
            try {
                const api = getApi();
                const group = (await api.getGroupInfo(groupId))?.gridInfoMap?.[groupId];
                if (!group) return err(`Group ${groupId} not found`);

                const allIds = group.memberIds?.length ? group.memberIds : (group.currentMems || []).map((m) => m.id);
                const memberIds = allIds.slice(0, limit);
                const admins = new Set(group.adminIds || []);

                const profiles: Awaited<ReturnType<API["getGroupMembersInfo"]>>["profiles"] = {};
                for (const batch of toBatches(memberIds, BATCH_SIZE)) {
                    try {
                        Object.assign(profiles, (await api.getGroupMembersInfo(batch))?.profiles || {});
                    } catch (e) {
                        console.error("[mcp-tools] zalo_get_group_members batch failed:", errorMessage(e));
                    }
                }

                const members = memberIds.map((userId) => ({
                    userId,
                    name: profiles[userId]?.displayName || profiles[userId]?.zaloName || null,
                    isAdmin: admins.has(userId),
                    isCreator: userId === group.creatorId,
                }));
                return ok({ groupId, name: group.name || null, total: group.totalMember ?? allIds.length, members });
            } catch (e) {
                console.error("[mcp-tools] zalo_get_group_members error:", errorMessage(e));
                return err(errorMessage(e));
            }
        },
    );

    // --- zalo_get_user_info ---
    server.registerTool(
        "zalo_get_user_info",
        {
            title: "Get Zalo User Info",
            description: "Look up a Zalo user's public profile (display name, Zalo name, avatar) by user ID.",
            inputSchema: z.object({
                userId: z.string().describe("User ID, e.g. a senderId from zalo_get_messages"),
            }),
        },
        async ({ userId }) => {
            try {
                const profile = (await getApi().getUserInfo(userId))?.changed_profiles?.[userId];
                if (!profile) return err(`User ${userId} not found`);
                return ok({
                    userId,
                    displayName: profile.displayName || null,
                    zaloName: profile.zaloName || null,
                    avatar: profile.avatar || null,
                });
            } catch (e) {
                console.error("[mcp-tools] zalo_get_user_info error:", errorMessage(e));
                return err(errorMessage(e));
            }
        },
    );

    // --- zalo_mark_read ---
    server.registerTool(
        "zalo_mark_read",
        {
            title: "Mark Zalo Messages Read",
            description:
                "Discard buffered messages up to and including the given cursor. Use the cursor returned by zalo_get_messages.",
            inputSchema: z.object({
                cursor: z
                    .number()
                    .int()
                    .min(0)
                    .describe("Cursor value returned from a previous zalo_get_messages call"),
            }),
        },
        async ({ cursor }) => {
            try {
                const discarded = buffer.markRead(cursor);
                return ok({ success: true, discarded });
            } catch (e) {
                console.error("[mcp-tools] zalo_mark_read error:", errorMessage(e));
                return err(errorMessage(e));
            }
        },
    );

    // --- zalo_get_history ---
    server.registerTool(
        "zalo_get_history",
        {
            title: "Get Zalo Message History",
            description:
                "Fetch historical messages from a Zalo DM or group conversation. " +
                "Unlike zalo_get_messages (which only reads the live buffer), this fetches older messages from the " +
                "Zalo server. Groups use a direct thread-scoped call that reliably returns the latest `limit` " +
                "messages (set a larger limit to go further back; `hasMore` signals older messages exist). " +
                "DMs page the live listener and are best-effort. " +
                'threadType: 0 or "dm" = DM, 1 or "group" = group.',
            inputSchema: z.object({
                threadId: z.string().describe("Thread ID to fetch history from"),
                threadType: THREAD_TYPE_SCHEMA,
                limit: z.number().int().min(1).max(200).default(50).describe("Max messages to fetch"),
                lastMsgId: z
                    .string()
                    .optional()
                    .nullable()
                    .describe("Cursor: last message ID from previous fetch for pagination"),
            }),
        },
        async ({ threadId, threadType, limit, lastMsgId }) => {
            try {
                const type = toThreadType(threadType);
                let allMessages: HistoryMessage[];
                let cursor: string | null;
                let hasMore: boolean;

                if (type === THREAD_GROUP) {
                    // Groups: Zalo's cloud message service (thread-scoped, paginated). Reliable even for
                    // low-traffic groups, and needs no second listener (avoids the one-listener-per-account conflict).
                    const res = await fetchGroupHistory(getApi(), threadId, limit);
                    allMessages = res.messages;
                    cursor = res.cursor;
                    hasMore = res.hasMore;
                } else {
                    // DMs: capture the listener once so add/remove hit the same one across a re-login.
                    const page = await fetchDmHistoryViaListener(getApi().listener, threadId, limit, lastMsgId ?? null);
                    allMessages = page.messages;
                    cursor = page.cursor;
                    hasMore = page.hasMore;
                }

                // Sort oldest first
                allMessages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

                // Enrich with thread name
                if (nameCache) {
                    const info = nameCache.get(threadId);
                    if (info) {
                        for (const msg of allMessages) msg.threadName = info.name;
                    }
                }

                return ok({
                    threadId,
                    threadType: type === THREAD_USER ? "dm" : "group",
                    count: allMessages.length,
                    messages: allMessages,
                    cursor,
                    hasMore,
                });
            } catch (e) {
                console.error("[mcp-tools] zalo_get_history error:", errorMessage(e));
                return err(errorMessage(e));
            }
        },
    );

    // --- zalo_search_messages ---
    server.registerTool(
        "zalo_search_messages",
        {
            title: "Search Zalo Messages",
            description:
                "Search/query messages by keyword, sender, and time range. Looks in the live buffer and, for a " +
                "group threadId, also fetches that group's history. Keyword match is case- and accent-insensitive " +
                "(Vietnamese-aware). Omit `query` to filter purely by sender/time. " +
                'threadType is only used when a group threadId is given (0 or "dm" = DM, 1 or "group" = group).',
            inputSchema: z.object({
                query: z.string().optional().describe("Keyword to match in message text (case/accent-insensitive)"),
                threadId: z
                    .string()
                    .optional()
                    .describe("Restrict to one thread. For groups, history is fetched; omit to search the buffer."),
                threadType: THREAD_TYPE_SCHEMA,
                senderId: z.string().optional().describe("Only messages sent by this user ID"),
                from: z.number().int().min(0).optional().describe("Only messages at/after this Unix ms timestamp"),
                to: z.number().int().min(0).optional().describe("Only messages at/before this Unix ms timestamp"),
                limit: z.number().int().min(1).max(200).default(50).describe("Max results (newest first)"),
            }),
        },
        async ({ query, threadId, threadType, senderId, from, to, limit }) => {
            try {
                const candidates: HistoryMessage[] = [];

                // Group history (reliable, thread-scoped) when a group thread is targeted.
                if (threadId && toThreadType(threadType) === THREAD_GROUP) {
                    const res = await fetchGroupHistory(getApi(), threadId, limit);
                    candidates.push(...res.messages);
                }

                // Live buffer (covers DMs and recent messages for everything).
                for (const m of buffer.read(threadId, 0, Number.MAX_SAFE_INTEGER).messages) {
                    candidates.push({
                        msgId: m.id,
                        threadId: m.threadId,
                        senderId: m.senderId,
                        senderName: m.senderName,
                        text: m.text,
                        timestamp: m.timestamp,
                        type: m.type,
                    });
                }

                const needle = query ? foldText(query) : null;
                const seen = new Set<string>();
                const matches = candidates
                    .filter((m) => {
                        if (m.msgId) {
                            if (seen.has(m.msgId)) return false;
                            seen.add(m.msgId);
                        }
                        if (needle && !foldText(m.text || "").includes(needle)) return false;
                        if (senderId && m.senderId !== senderId) return false;
                        if (from !== undefined && (m.timestamp ?? 0) < from) return false;
                        if (to !== undefined && (m.timestamp ?? 0) > to) return false;
                        return true;
                    })
                    .toSorted((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                    .slice(0, limit);

                if (nameCache) {
                    for (const m of matches) {
                        const info = nameCache.get(m.threadId);
                        if (info) m.threadName = info.name;
                    }
                }

                return ok({ count: matches.length, messages: matches });
            } catch (e) {
                console.error("[mcp-tools] zalo_search_messages error:", errorMessage(e));
                return err(errorMessage(e));
            }
        },
    );

    // --- zalo_view_media ---
    const mediaConfig = config.media || {};
    server.registerTool(
        "zalo_view_media",
        {
            title: "View Zalo Media",
            description:
                "Open a Zalo media file (image, audio, video) with the system viewer. " +
                "Media is auto-downloaded when received, organized by thread folder with date/sender metadata filenames. " +
                "If not yet downloaded, downloads first then opens.",
            inputSchema: z.object({
                messageId: z.string().describe("Message ID from zalo_get_messages that has a media attachment"),
                threadId: z.string().optional().describe("Thread ID to search in. Omit to search all threads."),
                open: z
                    .boolean()
                    .default(mediaConfig.autoOpen ?? true)
                    .describe("Open media with system viewer"),
            }),
        },
        async ({ messageId, threadId, open }) => {
            try {
                const message = findBuffered(messageId, threadId);
                if (!message) return err(`Message ${messageId} not found in buffer`);
                if (!message.attachment?.url) return err(`Message ${messageId} has no media attachment`);

                // Use local file if already auto-downloaded, otherwise download now
                let localPath = message.attachment.localPath;
                if (!localPath) {
                    const threadName = nameCache?.get(message.threadId)?.name || null;
                    const result = await downloadMedia(message, {
                        downloadDir: mediaConfig.downloadDir || undefined,
                        autoOpen: false,
                        threadName,
                    });
                    localPath = result.path;
                }

                if (open) openFile(localPath);

                return ok({ success: true, path: localPath, mediaType: message.type });
            } catch (e) {
                console.error("[mcp-tools] zalo_view_media error:", errorMessage(e));
                return err(errorMessage(e));
            }
        },
    );
}
