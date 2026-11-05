import type { NormalizedMessage } from "./normalize-message.ts";

/**
 * Ring buffer storing messages per thread with cursor-based incremental reads.
 * Shared by both stdio and HTTP MCP transports.
 */

/** A message held by the buffer, stamped with its global read cursor. */
export type BufferedMessage = NormalizedMessage & { _cursor: number };

type PushListener = (threadId: string, message: BufferedMessage) => void;

export interface ThreadStats {
    threadId: string;
    unread: number;
    total: number;
    lastActivity: number;
}

export class MessageBuffer {
    _threads = new Map<string, { messages: BufferedMessage[]; lastActivity: number }>();
    _maxSize: number;
    _maxAge: number;
    _globalCursor = 0;
    _pushListeners = new Set<PushListener>();

    /**
     * @param maxSize - Max messages per thread before eviction
     * @param maxAge - Max message age in ms before eviction (default 2h)
     */
    constructor(maxSize = 500, maxAge = 2 * 60 * 60 * 1000) {
        this._maxSize = maxSize;
        this._maxAge = maxAge;
    }

    /**
     * Observe pushes. Listeners run after the message is stored; a throwing listener never breaks push().
     * @returns Unsubscribe function
     */
    onPush(listener: PushListener): () => void {
        this._pushListeners.add(listener);
        return () => this._pushListeners.delete(listener);
    }

    /**
     * Add message to thread buffer. Auto-evicts stale messages.
     * @param message - Normalized message object
     */
    push(threadId: string, message: NormalizedMessage): void {
        let thread = this._threads.get(threadId);
        if (!thread) {
            thread = { messages: [], lastActivity: Date.now() };
            this._threads.set(threadId, thread);
        }
        // Assign global cursor for incremental reads
        const buffered = Object.assign(message, { _cursor: ++this._globalCursor });
        thread.messages.push(buffered);
        thread.lastActivity = Date.now();
        this._evict(threadId);
        for (const listener of this._pushListeners) {
            try {
                listener(threadId, buffered);
            } catch (e) {
                console.error("[message-buffer] push listener failed:", (e as Error).message);
            }
        }
    }

    /**
     * Read messages from a thread, optionally since a cursor.
     * @param [threadId] - If omitted, reads from all threads
     * @param [since=0] - Cursor to read from (exclusive)
     * @param [maxCount=20] - Max messages to return
     * @param [options.newest] - Return the latest `maxCount` messages instead of the oldest, still ordered
     *   oldest→newest. `hasMore` then means older messages were left out.
     */
    read(
        threadId?: string,
        since = 0,
        maxCount = 20,
        { newest = false }: { newest?: boolean } = {},
    ): { messages: BufferedMessage[]; cursor: number; hasMore: boolean } {
        const sources = threadId
            ? [this._threads.get(threadId)].filter((t) => t !== undefined)
            : Array.from(this._threads.values());

        // Collect all messages after cursor, sorted by cursor
        const all: BufferedMessage[] = [];
        for (const thread of sources) {
            for (const msg of thread.messages) {
                if (msg._cursor > since) all.push(msg);
            }
        }
        all.sort((a, b) => a._cursor - b._cursor);

        const hasMore = all.length > maxCount;
        const messages = newest ? all.slice(Math.max(0, all.length - maxCount)) : all.slice(0, maxCount);
        const cursor = messages.length > 0 ? messages[messages.length - 1]._cursor : since;

        return { messages, cursor, hasMore };
    }

    /**
     * Advance read cursor — discard messages at or before given cursor.
     * @returns Count of discarded messages
     */
    markRead(cursor: number): number {
        let discarded = 0;
        for (const [, thread] of this._threads) {
            const before = thread.messages.length;
            thread.messages = thread.messages.filter((m) => m._cursor > cursor);
            discarded += before - thread.messages.length;
        }
        return discarded;
    }

    /**
     * Get stats for all threads with buffered messages.
     * @param [readCursor=0] - Messages after this cursor are "unread"
     */
    getStats(readCursor = 0): ThreadStats[] {
        const stats: ThreadStats[] = [];
        for (const [threadId, thread] of this._threads) {
            if (thread.messages.length === 0) continue;
            const unread = thread.messages.filter((m) => m._cursor > readCursor).length;
            stats.push({
                threadId,
                unread,
                total: thread.messages.length,
                lastActivity: thread.lastActivity,
            });
        }
        return stats;
    }

    /**
     * Get thread type from first buffered message.
     */
    getThreadType(threadId: string): string | null {
        const thread = this._threads.get(threadId);
        return thread?.messages?.[0]?.threadType ?? null;
    }

    /**
     * Evict messages that exceed maxSize or maxAge for a given thread.
     */
    _evict(threadId: string): void {
        const thread = this._threads.get(threadId);
        if (!thread) return;

        const now = Date.now();
        // Remove messages older than maxAge
        thread.messages = thread.messages.filter((m) => now - m.timestamp < this._maxAge);
        // Trim to maxSize (keep newest)
        if (thread.messages.length > this._maxSize) {
            thread.messages = thread.messages.slice(thread.messages.length - this._maxSize);
        }
        // Clean up empty threads
        if (thread.messages.length === 0) {
            this._threads.delete(threadId);
        }
    }
}
