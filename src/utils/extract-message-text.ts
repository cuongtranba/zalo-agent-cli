interface MessageContentLike {
    params?: { message?: string };
    description?: string;
    title?: string;
    text?: string;
    msg?: string;
    href?: string;
    content?: unknown;
}

/**
 * Extract readable text from non-string Zalo message content.
 * Handles reply/quote messages, bubble messages, recommendations, link previews, etc.
 *
 * Field priority: params.message → description → title → text → msg → href → content (string) → JSON fallback
 */
export function extractMessageText(content: unknown, msgType?: string): string {
    if (!content || typeof content !== "object") return `[${msgType || "attachment"}]`;
    // Message content has no fixed schema: it is an arbitrary Zalo payload that we probe field by field.
    const c = content as MessageContentLike;
    if (c.params?.message) return c.params.message;
    if (c.description) return c.description;
    if (c.title) return c.title;
    if (c.text) return c.text;
    if (c.msg) return c.msg;
    if (c.href) return c.href;
    if (c.content && typeof c.content === "string") return c.content;
    try {
        const str = JSON.stringify(content);
        if (str.length < 200) return `[${msgType || "object"}: ${str}]`;
    } catch {}
    return `[${msgType || "attachment"}]`;
}
