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
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MessageBuffer } from "./message-buffer.ts";
import type { MCPServerConfig } from "./mcp-config.ts";
import type { ThreadNameCache } from "./thread-name-cache.ts";
import { readBufferedMessages } from "./mcp-tools.ts";

export const INBOX_URI = "zalo://inbox";

/**
 * Tracks which MCP sessions are subscribed to zalo://inbox. Shared across sessions and transports so other
 * parts (the Zalo-group notifier) can tell whether an agent will already receive a push.
 */
export class InboxSubscribers {
    #sessions = new Set<symbol | string>();

    /** Idempotent: a session counts once however often it subscribes */
    add(sessionKey: symbol | string): void {
        this.#sessions.add(sessionKey);
    }

    remove(sessionKey: symbol | string): void {
        this.#sessions.delete(sessionKey);
    }

    count(): number {
        return this.#sessions.size;
    }
}

/**
 * Register the inbox resource and its subscribe handlers on one server instance (= one client session).
 * Must run before the server connects to a transport.
 * @param inboxSubscribers - Updated as this session subscribes, unsubscribes or closes
 */
export function registerInboxResource(
    server: McpServer,
    buffer: MessageBuffer,
    config: MCPServerConfig,
    nameCache?: ThreadNameCache,
    inboxSubscribers: InboxSubscribers = new InboxSubscribers(),
): void {
    const maxPerPoll = config.limits?.maxMessagesPerPoll ?? 20;

    server.registerResource(
        "inbox",
        INBOX_URI,
        {
            title: "Zalo Inbox",
            description:
                "Buffered Zalo messages that have not been marked read, as JSON { messages, cursor, hasMore } " +
                "(same shape as zalo_get_messages). Subscribe to be notified (notifications/resources/updated) " +
                "when new messages arrive, then re-read this resource or call zalo_get_messages with your last " +
                "cursor. Notifications are best-effort: keep cursor polling as the source of truth.",
            mimeType: "application/json",
        },
        async (uri) => ({
            contents: [
                {
                    uri: uri.href,
                    mimeType: "application/json",
                    text: JSON.stringify(readBufferedMessages(buffer, nameCache, { limit: maxPerPoll })),
                },
            ],
        }),
    );

    server.server.registerCapabilities({ resources: { subscribe: true } });

    const subscribed = new Set<string>();
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
        server.server.sendResourceUpdated({ uri: INBOX_URI }).catch((e: Error) => {
            console.error("[mcp-resources] Failed to send inbox update:", e.message);
        });
    });

    // Detach from the shared buffer when this session's transport closes
    const previousOnClose = server.server.onclose;
    // oxlint-disable-next-line unicorn/prefer-add-event-listener -- MCP SDK callback property, not an EventTarget
    server.server.onclose = () => {
        previousOnClose?.();
        stopListening();
        subscribed.clear();
        inboxSubscribers.remove(sessionKey);
    };
}
