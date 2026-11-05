/**
 * MCP resource for push notifications: zalo://inbox.
 * Clients subscribe with resources/subscribe and get notifications/resources/updated whenever a message
 * is buffered. Notifications carry no payload; the client re-reads the resource or calls zalo_get_messages.
 */

import {
    McpError,
    ErrorCode,
    SubscribeRequestSchema,
    UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readBufferedMessages } from "./mcp-tools.js";

export const INBOX_URI = "zalo://inbox";

/**
 * Tracks which MCP sessions are subscribed to zalo://inbox. Shared across sessions and transports so other
 * parts (the Zalo-group notifier) can tell whether an agent will already receive a push.
 */
export class InboxSubscribers {
    #sessions = new Set();

    /** Idempotent: a session counts once however often it subscribes */
    add(sessionKey) {
        this.#sessions.add(sessionKey);
    }

    remove(sessionKey) {
        this.#sessions.delete(sessionKey);
    }

    count() {
        return this.#sessions.size;
    }
}

/**
 * Register the inbox resource and its subscribe handlers on one server instance (= one client session).
 * Must run before the server connects to a transport.
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {import("./message-buffer.js").MessageBuffer} buffer
 * @param {object} config - MCP config
 * @param {import("./thread-name-cache.js").ThreadNameCache} [nameCache]
 * @param {InboxSubscribers} [inboxSubscribers] - Updated as this session subscribes, unsubscribes or closes
 */
export function registerInboxResource(server, buffer, config, nameCache, inboxSubscribers = new InboxSubscribers()) {
    const inboxWindow = config.limits?.inboxWindow ?? 50;

    server.registerResource(
        "inbox",
        INBOX_URI,
        {
            title: "Zalo Inbox",
            description:
                "The newest N buffered Zalo messages that have not been marked read (N = limits.inboxWindow, default 50), " +
                "oldest to newest, as JSON { messages, cursor, hasMore } (same shape as zalo_get_messages). " +
                "cursor is the newest returned message's cursor; hasMore is true when older unread messages " +
                "were left out of the window (page them with zalo_get_messages). Subscribe to be notified (notifications/resources/updated) " +
                "when new messages arrive, then re-read this resource or call zalo_get_messages with your last " +
                "cursor. Notifications are best-effort: keep cursor polling as the source of truth.",
            mimeType: "application/json",
        },
        async (uri) => ({
            contents: [
                {
                    uri: uri.href,
                    mimeType: "application/json",
                    text: JSON.stringify(readBufferedMessages(buffer, nameCache, { limit: inboxWindow, newest: true })),
                },
            ],
        }),
    );

    server.server.registerCapabilities({ resources: { subscribe: true } });

    const subscribed = new Set();
    const sessionKey = Symbol("inbox-session");
    server.server.setRequestHandler(SubscribeRequestSchema, async ({ params }) => {
        if (params.uri !== INBOX_URI) {
            throw new McpError(ErrorCode.InvalidParams, `Resource ${params.uri} not found or not subscribable`);
        }
        subscribed.add(params.uri);
        inboxSubscribers.add(sessionKey);
        return {};
    });
    server.server.setRequestHandler(UnsubscribeRequestSchema, async ({ params }) => {
        subscribed.delete(params.uri);
        if (subscribed.size === 0) inboxSubscribers.remove(sessionKey);
        return {};
    });

    const stopListening = buffer.onPush(() => {
        if (!subscribed.has(INBOX_URI)) return;
        // Fire and forget: a dead client must never affect the Zalo listener
        server.server.sendResourceUpdated({ uri: INBOX_URI }).catch((e) => {
            console.error("[mcp-resources] Failed to send inbox update:", e.message);
        });
    });

    // Detach from the shared buffer when this session's transport closes
    const previousOnClose = server.server.onclose;
    server.server.onclose = () => {
        previousOnClose?.();
        stopListening();
        subscribed.clear();
        inboxSubscribers.remove(sessionKey);
    };
}
