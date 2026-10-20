/**
 * MCP tool registrations for Zalo message access and sending.
 * Registers 12 tools: zalo_get_messages, zalo_get_history, zalo_send_message, zalo_send_attachment, zalo_react,
 * zalo_list_threads, zalo_search_threads, zalo_list_conversations, zalo_get_group_members, zalo_get_user_info,
 * zalo_mark_read, zalo_view_media.
 */

import { rm } from "fs/promises";
import { z } from "zod";
import { downloadMedia, openFile } from "./media-downloader.js";
import { createAttachmentDir, resolveAttachmentSources } from "./attachment-source.js";
import { QUOTE_SOURCE } from "./normalize-message.js";
import { extractMessageText } from "../utils/extract-message-text.js";

/** Thread type constants matching zca-js ThreadType enum */
const THREAD_USER = 0;

/** Reaction names exposed to agents, mapped to zca-js Reactions codes */
const REACTION_CODES = {
    heart: "/-heart",
    like: "/-strong",
    haha: ":>",
    wow: ":o",
    cry: ":-((",
    angry: ":-h",
};

/** Max ids per getGroupInfo / getGroupMembersInfo request */
const BATCH_SIZE = 50;

/**
 * Wrap a result object into MCP tool content format.
 * @param {object} result
 * @returns {{ content: Array }}
 */
function ok(result) {
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
}

/**
 * Wrap an error message into MCP tool error content format.
 * @param {string} message
 * @returns {{ content: Array, isError: true }}
 */
function err(message) {
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

/**
 * Split a list into fixed-size batches.
 * @param {Array} list
 * @param {number} size
 * @returns {Array[]}
 */
function toBatches(list, size) {
    const batches = [];
    for (let i = 0; i < list.length; i += size) batches.push(list.slice(i, i + size));
    return batches;
}

/**
 * Register all Zalo MCP tools on the server.
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {() => object} getApi - Returns the current zca-js API instance (changes after re-login, so call per request)
 * @param {import("./message-buffer.js").MessageBuffer} buffer
 * @param {import("./thread-filter.js").ThreadFilter} filter
 * @param {object} config - MCP config
 * @param {import("./thread-name-cache.js").ThreadNameCache} [nameCache] - Thread name cache
 */
export function registerTools(server, getApi, buffer, filter, config, nameCache) {
    const maxPerPoll = config.limits?.maxMessagesPerPoll ?? 20;

    /** Find a buffered message by id, optionally scoped to one thread */
    const findBuffered = (messageId, threadId) =>
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
                const result = buffer.read(threadId, since, limit);
                // Enrich messages with thread name from cache
                if (nameCache) {
                    for (const msg of result.messages) {
                        const info = nameCache.get(msg.threadId);
                        if (info) msg.threadName = info.name;
                    }
                }
                return ok(result);
            } catch (e) {
                console.error("[mcp-tools] zalo_get_messages error:", e.message);
                return err(e.message);
            }
        },
    );

    // --- zalo_send_message ---
    server.registerTool(
        "zalo_send_message",
        {
            title: "Send Zalo Message",
            description:
                "Send a text message to a Zalo thread (DM or group). threadType: 0=DM(User), 1=Group. " +
                "Optionally reply to a buffered message (replyToMessageId) or @mention users in a group.",
            inputSchema: z.object({
                threadId: z.string().describe("Thread ID to send message to"),
                text: z.string().min(1).describe("Message text to send"),
                threadType: z
                    .number()
                    .int()
                    .min(0)
                    .max(1)
                    .default(THREAD_USER)
                    .describe("Thread type: 0=DM(User), 1=Group"),
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
                let content = text;
                if (replyToMessageId || mentions?.length) {
                    content = { msg: text };
                    if (replyToMessageId) {
                        const quote = findBuffered(replyToMessageId, threadId)?.[QUOTE_SOURCE];
                        if (!quote) {
                            return err(
                                `Message ${replyToMessageId} not found in buffer — can only reply to messages received while the server is running`,
                            );
                        }
                        content.quote = quote;
                    }
                    if (mentions?.length) {
                        content.mentions = mentions.map((m) => ({ pos: m.pos, uid: m.userId, len: m.len }));
                    }
                }
                const result = await getApi().sendMessage(content, threadId, Number(threadType));
                const messageId = result?.message?.msgId ?? result?.msgId ?? null;
                return ok({ success: true, messageId });
            } catch (e) {
                console.error("[mcp-tools] zalo_send_message error:", e.message);
                return err(e.message);
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
                "server host or an http(s) URL (downloaded first, max 25 MB). threadType: 0=DM(User), 1=Group.",
            inputSchema: z.object({
                threadId: z.string().describe("Thread ID to send to"),
                threadType: z
                    .number()
                    .int()
                    .min(0)
                    .max(1)
                    .default(THREAD_USER)
                    .describe("Thread type: 0=DM(User), 1=Group"),
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
                    Number(threadType),
                );
                const messageId = result?.message?.msgId ?? null;
                const attachmentIds = (result?.attachment ?? []).map((a) => a.msgId);
                return ok({ success: true, messageId, attachmentIds });
            } catch (e) {
                console.error("[mcp-tools] zalo_send_attachment error:", e.message);
                return err(e.message);
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
                "(their cliMsgId is known); otherwise pass cliMsgId explicitly.",
            inputSchema: z.object({
                messageId: z.string().describe("Message ID to react to"),
                threadId: z.string().describe("Thread ID the message belongs to"),
                threadType: z
                    .number()
                    .int()
                    .min(0)
                    .max(1)
                    .default(THREAD_USER)
                    .describe("Thread type: 0=DM(User), 1=Group"),
                reaction: z.enum(Object.keys(REACTION_CODES)).describe("Reaction: heart, like, haha, wow, cry, angry"),
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
                    type: Number(threadType),
                });
                return ok({ success: true });
            } catch (e) {
                console.error("[mcp-tools] zalo_react error:", e.message);
                return err(e.message);
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
                console.error("[mcp-tools] zalo_list_threads error:", e.message);
                return err(e.message);
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
                console.error("[mcp-tools] zalo_search_threads error:", e.message);
                return err(e.message);
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
                        .sort((a, b) => b.lastActionTime - a.lastActionTime)
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
                            console.error("[mcp-tools] zalo_list_conversations batch failed:", e.message);
                        }
                    }
                }

                return ok({ conversations, total: conversations.length });
            } catch (e) {
                console.error("[mcp-tools] zalo_list_conversations error:", e.message);
                return err(e.message);
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

                const profiles = {};
                for (const batch of toBatches(memberIds, BATCH_SIZE)) {
                    try {
                        Object.assign(profiles, (await api.getGroupMembersInfo(batch))?.profiles || {});
                    } catch (e) {
                        console.error("[mcp-tools] zalo_get_group_members batch failed:", e.message);
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
                console.error("[mcp-tools] zalo_get_group_members error:", e.message);
                return err(e.message);
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
                console.error("[mcp-tools] zalo_get_user_info error:", e.message);
                return err(e.message);
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
                console.error("[mcp-tools] zalo_mark_read error:", e.message);
                return err(e.message);
            }
        },
    );

    // --- zalo_get_history ---
    server.registerTool(
        "zalo_get_history",
        {
            title: "Get Zalo Message History",
            description:
                "Fetch historical messages from a Zalo DM or group conversation (up to ~2 weeks). " +
                "Unlike zalo_get_messages (which reads from the live buffer), this fetches older messages " +
                "from the Zalo server. Use 'lastMsgId' cursor from previous response for pagination. " +
                "WARNING: Large limits may consume significant memory/bandwidth. Start with a small limit and paginate.",
            inputSchema: z.object({
                threadId: z.string().describe("Thread ID to fetch history from"),
                threadType: z
                    .number()
                    .int()
                    .min(0)
                    .max(1)
                    .default(THREAD_USER)
                    .describe("Thread type: 0=DM(User), 1=Group"),
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
                // Capture once so handler add/remove always hit the same listener, even across a re-login
                const listener = getApi().listener;
                const allMessages = [];
                let cursor = lastMsgId || null;
                let done = false;
                const maxPages = Math.ceil(limit / 20);
                let page = 0;

                while (!done && allMessages.length < limit && page < maxPages) {
                    page++;
                    const pageMessages = await new Promise((resolve) => {
                        const handler = (messages) => {
                            clearTimeout(timer);
                            listener.removeListener("old_messages", handler);
                            resolve(messages);
                        };
                        const timer = setTimeout(() => {
                            listener.removeListener("old_messages", handler);
                            resolve([]);
                        }, 10000);

                        listener.on("old_messages", handler);
                        listener.requestOldMessages(threadType, cursor);
                    });

                    if (!pageMessages || pageMessages.length === 0) {
                        done = true;
                        break;
                    }

                    for (const msg of pageMessages) {
                        if (allMessages.length >= limit) break;
                        // API returns messages globally — filter to requested thread
                        const msgThread = String(msg.threadId || "");
                        const msgSender = String(msg.data?.uidFrom || "");
                        const target = String(threadId);
                        if (msgThread !== target && msgSender !== target) continue;
                        const rawContent = msg.data?.content;
                        const isText = typeof rawContent === "string";
                        allMessages.push({
                            msgId: msg.data?.msgId,
                            threadId: msg.threadId,
                            senderId: msg.data?.uidFrom || null,
                            senderName: msg.data?.dName || null,
                            text: isText ? rawContent : extractMessageText(rawContent, msg.data?.msgType),
                            timestamp: msg.data?.ts ? Number(msg.data.ts) : null,
                            type: isText ? "text" : msg.data?.msgType || "attachment",
                        });
                    }

                    const lastMsg = pageMessages[pageMessages.length - 1];
                    const nextId = lastMsg?.data?.actionId || lastMsg?.data?.msgId;
                    if (!nextId || nextId === cursor) done = true;
                    cursor = nextId;
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
                    threadType: threadType === 0 ? "dm" : "group",
                    count: allMessages.length,
                    messages: allMessages,
                    cursor: cursor,
                    hasMore: !done,
                });
            } catch (e) {
                console.error("[mcp-tools] zalo_get_history error:", e.message);
                return err(e.message);
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
                console.error("[mcp-tools] zalo_view_media error:", e.message);
                return err(e.message);
            }
        },
    );
}
