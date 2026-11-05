/**
 * Normalize raw zca-js message events into the MCP buffer's message shape.
 */

import type { Message, SendMessageQuote } from "zca-js";
import { extractMessageText } from "../utils/extract-message-text.ts";

/**
 * Symbol key holding the zca-js SendMessageQuote payload for a buffered message.
 * A symbol keeps the raw payload out of JSON.stringify, so it never leaks into tool output.
 */
export const QUOTE_SOURCE = Symbol("quoteSource");

/** A message in the shape the MCP buffer stores and tools return. */
export interface NormalizedMessage {
    id: string;
    cliMsgId: string | null;
    threadId: string;
    threadType: "dm" | "group";
    senderId: string | null;
    senderName: string | null;
    text: string;
    timestamp: number;
    ts: number | null;
    type: string;
    attachment: { type: string; url: string | null; description: string | null; localPath?: string } | null;
    replyTo: { msgId: string; ownerId: string; text: string } | null;
    /** Thread display name, added when read through the name cache. */
    threadName?: string;
    /** Read cursor, assigned by MessageBuffer.push(). */
    _cursor?: number;
    [QUOTE_SOURCE]?: SendMessageQuote;
}

/**
 * Normalize a raw zca-js message event into the buffer's message shape.
 * @param {object} msg - Raw zca-js message event
 * @returns {object} Normalized message
 */
export function normalizeMessage(msg: Message): NormalizedMessage {
    const data = msg.data;
    const rawContent = data.content;
    // Non-text content is a loosely typed payload; link/file messages carry href and title
    const content = rawContent as { href?: string; title?: string } | null;
    const isText = typeof rawContent === "string";
    const quote = data.quote;
    const message: NormalizedMessage = {
        id: data.msgId,
        cliMsgId: data.cliMsgId ? String(data.cliMsgId) : null,
        threadId: msg.threadId,
        threadType: msg.type === 0 ? "dm" : "group",
        senderId: data.uidFrom || null,
        senderName: data.dName || null,
        text: isText ? rawContent : extractMessageText(rawContent, data.msgType),
        timestamp: Date.now(),
        ts: Number(data.ts) || null,
        type: isText ? "text" : data.msgType || "attachment",
        attachment:
            !isText && rawContent
                ? {
                      type: data.msgType,
                      url: content?.href || null,
                      description: content?.title || null,
                  }
                : null,
        replyTo: quote ? { msgId: String(quote.globalMsgId ?? ""), ownerId: quote.ownerId, text: quote.msg } : null,
    };

    // Shape of zca-js SendMessageQuote — lets zalo_send_message quote this message later
    message[QUOTE_SOURCE] = {
        content: rawContent,
        msgType: data.msgType,
        propertyExt: data.propertyExt,
        uidFrom: data.uidFrom,
        msgId: data.msgId,
        cliMsgId: data.cliMsgId,
        ts: data.ts,
        ttl: data.ttl,
    };
    return message;
}
