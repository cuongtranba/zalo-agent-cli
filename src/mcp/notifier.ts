/**
 * Sends notification to a configured Zalo group when DMs arrive
 * and no MCP client is subscribed to zalo://inbox (a subscriber gets a push, so the group message is redundant).
 * Batches messages within a cooldown window.
 */

import type { API } from "zca-js";
import { parseDuration, type MCPConfig } from "./mcp-config.ts";
import type { NormalizedMessage } from "./normalize-message.ts";

/** Emoji prefix per message type for notification previews */
const TYPE_EMOJI: Record<string, string> = {
    text: "💬",
    image: "📷",
    file: "📎",
    link: "🔗",
    video: "🎬",
    audio: "🎵",
    voice: "🎤",
    gif: "🎞️",
};

/** Vietnamese label per message type for notification breakdown */
const TYPE_LABEL: Record<string, string> = {
    text: "text",
    image: "ảnh",
    file: "file",
    link: "link",
    video: "video",
    audio: "audio",
    voice: "voice",
    gif: "gif",
};

export interface NotifierOptions {
    /** Suppress notifications while any subscriber exists */
    inboxSubscribers?: { count: () => number } | null;
}

export class ZaloNotifier {
    _getApi: () => API;
    _enabled: boolean;
    _notifyThread: string | null;
    _onTypes: Set<string>;
    _cooldownMs: number;
    _pending: NormalizedMessage[] = []; // Messages queued during cooldown window
    _timer: ReturnType<typeof setTimeout> | null = null;
    _inboxSubscribers: { count: () => number } | null;

    /**
     * @param getApi - Returns the current zca-js API instance (changes after re-login)
     * @param config - MCP config; uses the notify section:
     *   enabled, thread (group ID to notify), on (event types, e.g. ["dm"]), cooldown (debounce window, e.g. "5m")
     * @param options - inboxSubscribers suppresses notifications while any subscriber exists
     */
    constructor(
        getApi: () => API,
        config: { notify?: Partial<MCPConfig["notify"]> },
        { inboxSubscribers = null }: NotifierOptions = {},
    ) {
        this._getApi = getApi;
        this._enabled = config.notify?.enabled || false;
        this._notifyThread = config.notify?.thread || null;
        this._onTypes = new Set(config.notify?.on || ["dm"]);
        this._cooldownMs = parseDuration(config.notify?.cooldown || "5m");
        this._inboxSubscribers = inboxSubscribers;
    }

    /**
     * Called when a new message arrives. Queues notification if conditions are met.
     * @param {object} message - Normalized message object
     */
    onMessage(message: NormalizedMessage): void {
        if (!this._shouldNotify(message)) return;
        this._pending.push(message);
        // Start cooldown timer only once per batch window
        if (!this._timer) {
            this._timer = setTimeout(() => this._flush(), this._cooldownMs);
        }
    }

    /**
     * Determine whether this message warrants a notification.
     * @param {object} message
     * @returns {boolean}
     */
    _shouldNotify(message: NormalizedMessage): boolean {
        if (!this._enabled || !this._notifyThread) return false;
        if ((this._inboxSubscribers?.count() ?? 0) > 0) return false;
        return this._onTypes.has(message.threadType);
    }

    /** Flush pending notifications as a single batched message to the notify thread */
    async _flush(): Promise<void> {
        this._timer = null;
        if (this._pending.length === 0) return;

        // Take the batch before awaiting so messages arriving during the send start the next batch
        const batch = this._pending;
        this._pending = [];

        const count = batch.length;
        const typeBreakdown = this._buildTypeBreakdown(batch);
        const preview = batch
            .slice(0, 3) // Show at most 3 message previews
            .map((m) => {
                const type = m.type || "text";
                const prefix = TYPE_EMOJI[type] || "💬";
                const sender = m.senderName || m.senderId;
                const body = type === "text" ? (m.text || "").slice(0, 50) : `[${TYPE_LABEL[type] || type}]`;
                return `- ${sender}: ${prefix} ${body}`;
            })
            .join("\n");

        const suffix = count > 3 ? `\n...và ${count - 3} tin nhắn khác` : "";
        const text = `🔔 ${count} tin nhắn mới [${typeBreakdown}] trong ${this._formatWindow()}:\n${preview}${suffix}`;

        try {
            // threadType 1 = Group conversation
            // _notifyThread is set: onMessage only queues messages when it is
            await this._getApi().sendMessage(text, this._notifyThread!, 1);
        } catch (err) {
            console.error("Notifier send failed:", (err as Error).message);
        }
    }

    /**
     * Build a human-readable type breakdown string, e.g. "2 text, 1 ảnh".
     * @param {object[]} messages - Array of normalized messages
     * @returns {string}
     */
    _buildTypeBreakdown(messages: NormalizedMessage[]): string {
        const counts: Record<string, number> = {};
        for (const m of messages) {
            const t = m.type || "text";
            counts[t] = (counts[t] || 0) + 1;
        }
        return Object.entries(counts)
            .map(([type, n]) => `${n} ${TYPE_LABEL[type] || type}`)
            .join(", ");
    }

    /** Format cooldown duration as human-readable string (e.g. "5 phút", "1h") */
    _formatWindow(): string {
        const mins = Math.round(this._cooldownMs / 60000);
        return mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins} phút`;
    }

    /** Clean up pending timer on shutdown and attempt final flush */
    destroy(): void {
        if (this._timer) {
            clearTimeout(this._timer);
            this._flush();
        }
    }
}
