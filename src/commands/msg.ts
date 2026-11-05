/**
 * Message commands — send text, images, files, cards, bank cards, QR transfers,
 * stickers, reactions, delete, forward.
 */

import type { Command } from "commander";
import { resolve } from "path";
import {
    TextStyle,
    type Message,
    type Mention,
    type MessageContent,
    type Reactions,
    type SendBankCardPayload,
    type SendCardOptions,
    type SendStickerPayload,
    type StickerBasic,
    type Style,
} from "zca-js";
import { getApi } from "../core/zalo-client.ts";
import { success, error, info, output } from "../utils/output.ts";
import { extractMessageText } from "../utils/extract-message-text.ts";
import { errorMessage } from "../utils/error-message.ts";

/**
 * TextStyle codes matching zca-js TextStyle enum.
 * Used for --style option and markdown parsing.
 */
type SimpleStyle = Exclude<TextStyle, TextStyle.Indent>;

const TEXT_STYLES: Record<string, SimpleStyle> = {
    bold: TextStyle.Bold,
    b: TextStyle.Bold,
    italic: TextStyle.Italic,
    i: TextStyle.Italic,
    underline: TextStyle.Underline,
    u: TextStyle.Underline,
    strikethrough: TextStyle.StrikeThrough,
    s: TextStyle.StrikeThrough,
    red: TextStyle.Red,
    orange: TextStyle.Orange,
    yellow: TextStyle.Yellow,
    green: TextStyle.Green,
    small: TextStyle.Small,
    big: TextStyle.Big,
};

/**
 * Parse markdown-like syntax from message text into plain text + styles array.
 * Supports: **bold**, *italic*, __underline__, ~~strikethrough~~,
 *           {red:text}, {orange:text}, {green:text}, {yellow:text},
 *           {big:text}, {small:text}
 */
function parseMarkdownStyles(input: string): { plain: string; styles: Style[] } {
    const styles: Style[] = [];
    let plain = input;

    // Process markdown patterns (order matters: ** before *)
    const patterns: Array<{ regex: RegExp; st: SimpleStyle | null }> = [
        { regex: /\*\*(.+?)\*\*/g, st: TextStyle.Bold },
        { regex: /\*(.+?)\*/g, st: TextStyle.Italic },
        { regex: /__(.+?)__/g, st: TextStyle.Underline },
        { regex: /~~(.+?)~~/g, st: TextStyle.StrikeThrough },
        { regex: /\{(red|orange|yellow|green|big|small):(.+?)\}/g, st: null },
    ];

    for (const p of patterns) {
        let match: RegExpExecArray | null;
        // Re-run from scratch each time since offsets shift
        while ((match = p.regex.exec(plain)) !== null) {
            const fullMatch = match[0];
            const start = match.index;
            let content: string;
            let st: SimpleStyle;
            if (p.st === null) {
                // Color/size pattern: {color:text}
                st = TEXT_STYLES[match[1]];
                content = match[2];
            } else {
                st = p.st;
                content = match[1];
            }
            // Replace the markdown syntax with plain content
            plain = plain.slice(0, start) + content + plain.slice(start + fullMatch.length);
            styles.push({ start, len: content.length, st });
            // Reset regex since string changed
            p.regex.lastIndex = start + content.length;
        }
    }

    return { plain, styles };
}

/**
 * Parse manual style specs: "start:len:style" → { start, len, st }
 * Style names: bold, italic, underline, strikethrough, red, orange, yellow, green, big, small
 */
function parseStyleSpecs(specs: string[]): Style[] {
    return specs.flatMap((spec) => {
        const [start, len, style] = spec.split(":");
        const st = TEXT_STYLES[style];
        if (!st) return [];
        return [{ start: Number(start), len: Number(len), st }];
    });
}

/** One message returned by `msg history`. */
interface HistoryMessage {
    msgId: string | undefined;
    threadId: string;
    senderId: string | null;
    senderName: string | null;
    text: string;
    timestamp: number | null;
    type: string;
}

export function registerMsgCommands(program: Command): void {
    const msg = program.command("msg").description("Send and manage messages");

    msg.command("send <threadId> <message>")
        .description("Send a text message with optional formatting")
        .option("-t, --type <n>", "Thread type: 0=User, 1=Group", "0")
        .option(
            "--mention <specs...>",
            "Mention users in group message. Format: pos:userId:len (e.g. 0:USER_ID:5). Use userId=-1 for @All.",
        )
        .option("--style <specs...>", "Text styles. Format: start:len:style (e.g. 0:5:bold 6:5:italic)")
        .option("--md", "Parse markdown-like formatting: **bold** *italic* __underline__ ~~strike~~ {red:text}")
        .option(
            "--react <icon>",
            "Auto-react to sent message. Codes: :> (haha), /-heart (heart), /-strong (like), :o (wow), :-(( (cry), :-h (angry)",
        )
        .action(
            async (
                threadId: string,
                message: string,
                opts: { type: string; mention?: string[]; style?: string[]; md?: boolean; react?: string },
            ) => {
                try {
                    // Parse mention specs: "pos:uid:len" → { pos, uid, len }
                    const mentions: Mention[] = (opts.mention || []).map((spec) => {
                        const [pos, uid, len] = spec.split(":");
                        return { pos: Number(pos), uid, len: Number(len) };
                    });

                    // Parse text styles
                    let styles: Style[] = [];
                    let finalMsg = message;

                    if (opts.md) {
                        // Markdown-like parsing: **bold** *italic* __underline__ ~~strike~~
                        const parsed = parseMarkdownStyles(message);
                        finalMsg = parsed.plain;
                        styles = parsed.styles;
                    }

                    if (opts.style) {
                        // Manual style specs: start:len:style
                        styles = styles.concat(parseStyleSpecs(opts.style));
                    }

                    // Build message content
                    const hasExtras = mentions.length > 0 || styles.length > 0;
                    const msgContent: string | MessageContent = hasExtras
                        ? {
                              msg: finalMsg,
                              ...(mentions.length > 0 && { mentions }),
                              ...(styles.length > 0 && { styles }),
                          }
                        : finalMsg;

                    const cliMsgId = String(Date.now());
                    const result = await getApi().sendMessage(msgContent, threadId, Number(opts.type));
                    output({ ...result, cliMsgId }, program.opts().json, () => success("Message sent"));

                    // Auto-react if --react flag provided
                    if (opts.react && result.message?.msgId) {
                        const dest = {
                            data: { msgId: String(result.message.msgId), cliMsgId },
                            threadId,
                            type: Number(opts.type),
                        };
                        // The raw reaction code is passed through; Zalo ignores codes it does not know
                        await getApi().addReaction(opts.react as Reactions, dest);
                        success(`Auto-reacted with '${opts.react}'`);
                    }
                } catch (e) {
                    error(errorMessage(e));
                }
            },
        );

    msg.command("send-image <threadId> <paths...>")
        .description("Send one or more images")
        .option("-t, --type <n>", "Thread type: 0=User, 1=Group", "0")
        .option("-m, --caption <text>", "Caption text", "")
        .action(async (threadId: string, paths: string[], opts: { type: string; caption: string }) => {
            try {
                const absPaths = paths.map((p) => resolve(p));
                const result = await getApi().sendMessage(
                    { msg: opts.caption, attachments: absPaths },
                    threadId,
                    Number(opts.type),
                );
                output(result, program.opts().json, () => success(`Image(s) sent to ${threadId}`));
            } catch (e) {
                error(errorMessage(e));
            }
        });

    msg.command("send-file <threadId> <paths...>")
        .description("Send files (docx, pdf, zip, etc.)")
        .option("-t, --type <n>", "Thread type: 0=User, 1=Group", "0")
        .option("-m, --caption <text>", "Caption text", "")
        .action(async (threadId: string, paths: string[], opts: { type: string; caption: string }) => {
            try {
                const absPaths = paths.map((p) => resolve(p));
                const result = await getApi().sendMessage(
                    { msg: opts.caption, attachments: absPaths },
                    threadId,
                    Number(opts.type),
                );
                output(result, program.opts().json, () => success(`File(s) sent to ${threadId}`));
            } catch (e) {
                error(errorMessage(e));
            }
        });

    msg.command("send-card <threadId> <userId>")
        .description("Send a contact card (danh thiếp)")
        .option("-t, --type <n>", "Thread type: 0=User, 1=Group", "0")
        .option("--phone <num>", "Phone number (auto-fetched if omitted)")
        .action(async (threadId: string, userId: string, opts: { type: string; phone?: string }) => {
            try {
                const api = getApi();
                let phone = opts.phone;
                if (!phone) {
                    const userInfo = await api.getUserInfo(userId);
                    const profiles = userInfo?.changed_profiles || {};
                    phone = profiles[userId]?.phoneNumber || "";
                    if (phone) info(`Auto-detected phone: ${phone}`);
                }
                const cardOpts: SendCardOptions = { userId };
                if (phone) cardOpts.phoneNumber = phone;
                const result = await api.sendCard(cardOpts, threadId, Number(opts.type));
                output(result, program.opts().json, () => success("Card sent"));
            } catch (e) {
                error(errorMessage(e));
            }
        });

    msg.command("send-bank <threadId> <accountNumber>")
        .description("Send a bank card (số tài khoản)")
        .requiredOption("-b, --bank <name>", "Bank name (ocb, vcb, bidv) or BIN code")
        .option("-t, --type <n>", "Thread type: 0=User, 1=Group", "0")
        .option("-n, --name <holder>", "Account holder name")
        .action(
            async (threadId: string, accountNumber: string, opts: { bank: string; type: string; name?: string }) => {
                try {
                    const { resolveBankBin, BIN_TO_DISPLAY } = await import("../utils/bank-helpers.ts");
                    const bin = resolveBankBin(opts.bank);
                    if (!bin) {
                        error(`Unknown bank: '${opts.bank}'`);
                        return;
                    }
                    info(`Bank: ${BIN_TO_DISPLAY[bin] || bin} (BIN ${bin})`);

                    const payload: SendBankCardPayload = { binBank: bin, numAccBank: accountNumber };
                    if (opts.name) payload.nameAccBank = opts.name;
                    const result = await getApi().sendBankCard(payload, threadId, Number(opts.type));
                    output(result, program.opts().json, () =>
                        success(`Bank card sent: ${BIN_TO_DISPLAY[bin]} / ${accountNumber}`),
                    );
                } catch (e) {
                    error(errorMessage(e));
                }
            },
        );

    msg.command("send-qr-transfer <threadId> <accountNumber>")
        .description("Generate VietQR and send as image")
        .requiredOption("-b, --bank <name>", "Bank name or BIN code")
        .option("-a, --amount <n>", "Transfer amount in VND", parseInt)
        .option("-m, --content <text>", "Transfer content (max 50 chars)")
        .option("--template <tpl>", "QR style: compact, print, qronly", "compact")
        .option("-t, --type <n>", "Thread type: 0=User, 1=Group", "0")
        .action(
            async (
                threadId: string,
                accountNumber: string,
                opts: { bank: string; amount?: number; content?: string; template: string; type: string },
            ) => {
                try {
                    const { resolveBankBin, BIN_TO_DISPLAY, generateQrTransferImage } =
                        await import("../utils/bank-helpers.ts");
                    const bin = resolveBankBin(opts.bank);
                    if (!bin) {
                        error(`Unknown bank: '${opts.bank}'`);
                        return;
                    }
                    if (opts.content && opts.content.length > 50) {
                        error(`Content too long (${opts.content.length} chars). VietQR max is 50.`);
                        return;
                    }
                    info(
                        `Generating QR: ${BIN_TO_DISPLAY[bin]} / ${accountNumber}${opts.amount ? ` / ${opts.amount.toLocaleString()}đ` : ""}`,
                    );

                    const qrPath = await generateQrTransferImage(
                        bin,
                        accountNumber,
                        opts.amount,
                        opts.content,
                        opts.template,
                    );
                    if (!qrPath) {
                        error("Failed to generate QR image");
                        return;
                    }

                    const caption = [
                        `QR chuyển khoản ${BIN_TO_DISPLAY[bin]} - ${accountNumber}`,
                        opts.amount ? `${opts.amount.toLocaleString()}đ` : null,
                        opts.content || null,
                    ]
                        .filter(Boolean)
                        .join(" - ");

                    const result = await getApi().sendMessage(
                        { msg: caption, attachments: [qrPath] },
                        threadId,
                        Number(opts.type),
                    );

                    // Cleanup temp file
                    try {
                        (await import("fs")).unlinkSync(qrPath);
                    } catch {}

                    output(result, program.opts().json, () => success(`QR transfer sent to ${threadId}`));
                } catch (e) {
                    error(errorMessage(e));
                }
            },
        );

    msg.command("sticker <threadId> <keyword>")
        .description("Search and send a sticker")
        .option("-t, --type <n>", "Thread type: 0=User, 1=Group", "0")
        .action(async (threadId: string, keyword: string, opts: { type: string }) => {
            try {
                const api = getApi();
                const search = await api.searchSticker(keyword);
                // Sticker search results may use either snake_case or camelCase keys
                const first = search?.[0] as
                    | (StickerBasic & { stickerId?: number; cateId?: number; id?: number })
                    | undefined;
                if (!first) {
                    error("No sticker found");
                    return;
                }
                // sendSticker expects {id, cateId, type} object
                const stickerObj = {
                    id: first.sticker_id || first.stickerId || first.id,
                    cateId: first.cate_id || first.cateId,
                    type: first.type || 7,
                } as SendStickerPayload;
                const result = await api.sendSticker(stickerObj, threadId, Number(opts.type));
                output(result, program.opts().json, () => success("Sticker sent"));
            } catch (e) {
                error(errorMessage(e));
            }
        });

    msg.command("send-voice <threadId> <voiceUrl>")
        .description("Send a voice message from URL")
        .option("-t, --type <n>", "Thread type: 0=User, 1=Group", "0")
        .option("--ttl <ms>", "Time to live in milliseconds", parseInt, 0)
        .action(async (threadId: string, voiceUrl: string, opts: { type: string; ttl: number }) => {
            try {
                info(`Sending voice: ${voiceUrl}`);
                const result = await getApi().sendVoice({ voiceUrl, ttl: opts.ttl }, threadId, Number(opts.type));
                output(result, program.opts().json, () => success(`Voice sent to ${threadId}`));
            } catch (e) {
                error(`Send voice failed: ${errorMessage(e)}`);
            }
        });

    msg.command("send-link <threadId> <url>")
        .description("Send a link with auto-preview (title, description, thumbnail)")
        .option("-t, --type <n>", "Thread type: 0=User, 1=Group", "0")
        .option("-m, --caption <text>", "Caption text")
        .action(async (threadId: string, url: string, opts: { type: string; caption?: string }) => {
            try {
                info(`Sending link: ${url}`);
                const result = await getApi().sendLink({ link: url, msg: opts.caption }, threadId, Number(opts.type));
                output(result, program.opts().json, () => success(`Link sent to ${threadId}`));
            } catch (e) {
                error(`Send link failed: ${errorMessage(e)}`);
            }
        });

    msg.command("send-video <threadId> <videoUrl>")
        .description("Send a video from URL")
        .requiredOption("--thumb <url>", "Thumbnail image URL")
        .option("-t, --type <n>", "Thread type: 0=User, 1=Group", "0")
        .option("-m, --caption <text>", "Caption text", "")
        .option("-d, --duration <ms>", "Video duration in milliseconds", parseInt)
        .option("-W, --width <px>", "Video width", parseInt, 1280)
        .option("-H, --height <px>", "Video height", parseInt, 720)
        .action(
            async (
                threadId: string,
                videoUrl: string,
                opts: {
                    thumb: string;
                    type: string;
                    caption: string;
                    duration?: number;
                    width: number;
                    height: number;
                },
            ) => {
                try {
                    info(`Sending video: ${videoUrl}`);
                    const result = await getApi().sendVideo(
                        {
                            videoUrl,
                            thumbnailUrl: opts.thumb,
                            msg: opts.caption,
                            duration: opts.duration,
                            width: opts.width,
                            height: opts.height,
                        },
                        threadId,
                        Number(opts.type),
                    );
                    output(result, program.opts().json, () => success(`Video sent to ${threadId}`));
                } catch (e) {
                    error(`Send video failed: ${errorMessage(e)}`);
                }
            },
        );

    msg.command("sticker-list <keyword>")
        .description("Search stickers by keyword (returns sticker IDs)")
        .action(async (keyword: string) => {
            try {
                const result = await getApi().getStickers(keyword);
                output(result, program.opts().json, () => {
                    const ids = Array.isArray(result) ? result : [];
                    info(`${ids.length} sticker(s) found for "${keyword}"`);
                    for (const id of ids) console.log(`  ${id}`);
                });
            } catch (e) {
                error(`Sticker search failed: ${errorMessage(e)}`);
            }
        });

    msg.command("sticker-detail <stickerIds...>")
        .description("Get sticker details by IDs")
        .action(async (stickerIds: string[]) => {
            try {
                const ids = stickerIds.map(Number);
                const result = await getApi().getStickersDetail(ids);
                output(result, program.opts().json);
            } catch (e) {
                error(`Sticker detail failed: ${errorMessage(e)}`);
            }
        });

    msg.command("sticker-category <categoryId>")
        .description("Get sticker category details")
        .action(async (categoryId: string) => {
            try {
                const result = await getApi().getStickerCategoryDetail(Number(categoryId));
                output(result, program.opts().json);
            } catch (e) {
                error(`Sticker category failed: ${errorMessage(e)}`);
            }
        });

    msg.command("react <msgId> <threadId> <reaction>")
        .description(
            "React to a message. Reaction codes: :> (haha), /-heart (heart), /-strong (like), :o (wow), :-(( (cry), :-h (angry)",
        )
        .option("-t, --type <n>", "Thread type: 0=User, 1=Group", "0")
        .option("-c, --cli-msg-id <id>", "Client message ID (required for reaction to appear, get from listen --json)")
        .action(
            async (msgId: string, threadId: string, reaction: string, opts: { type: string; cliMsgId?: string }) => {
                try {
                    // zca-js addReaction(icon, dest) — dest needs msgId + cliMsgId
                    const dest = {
                        data: { msgId, cliMsgId: opts.cliMsgId || msgId },
                        threadId,
                        type: Number(opts.type),
                    };
                    const result = await getApi().addReaction(reaction as Reactions, dest);
                    output(result, program.opts().json, () => success(`Reacted with '${reaction}'`));
                } catch (e) {
                    error(`React failed: ${errorMessage(e)}`);
                }
            },
        );

    msg.command("delete <msgId> <threadId>")
        .description("Delete a message you sent")
        .option("-t, --type <n>", "Thread type: 0=User, 1=Group", "0")
        .action(async (msgId: string, threadId: string, opts: { type: string }) => {
            try {
                // @ts-expect-error pre-existing: zca-js deleteMessage takes (message, onlyMe?), not (msgId, threadId, type)
                const result = await getApi().deleteMessage(msgId, threadId, Number(opts.type));
                output(result, program.opts().json, () => success("Message deleted"));
            } catch (e) {
                error(errorMessage(e));
            }
        });

    msg.command("undo <msgId> <threadId>")
        .description("Recall/undo a message for both sides (like Zalo app recall). Requires cliMsgId.")
        .option("-t, --type <n>", "Thread type: 0=User, 1=Group", "0")
        .option("-c, --cli-msg-id <id>", "Client message ID (required, get from listen --json or send --json)")
        .action(async (msgId: string, threadId: string, opts: { type: string; cliMsgId?: string }) => {
            try {
                if (!opts.cliMsgId) {
                    error("cliMsgId is required for undo. Get it from: listen --json or send --json output.");
                    return;
                }
                const payload = { msgId, cliMsgId: opts.cliMsgId };
                const result = await getApi().undo(payload, threadId, Number(opts.type));
                output(result, program.opts().json, () => success("Message recalled (undone)"));
            } catch (e) {
                error(`Undo failed: ${errorMessage(e)}`);
            }
        });

    msg.command("forward <msgId> <threadId>")
        .description("Forward a message to another thread")
        .option("-t, --type <n>", "Thread type: 0=User, 1=Group", "0")
        .action(async (msgId: string, threadId: string, opts: { type: string }) => {
            try {
                // @ts-expect-error pre-existing: zca-js forwardMessage takes a payload object, not (msgId, threadId, type)
                const result = await getApi().forwardMessage(msgId, threadId, Number(opts.type));
                output(result, program.opts().json, () => success("Message forwarded"));
            } catch (e) {
                error(errorMessage(e));
            }
        });

    msg.command("history <threadId>")
        .description("Fetch message history from a DM or group conversation via WebSocket")
        .option("-t, --type <n>", "Thread type: 0=User(DM), 1=Group", "0")
        .option("-n, --limit <n>", "Max messages to fetch (fetches in pages until limit)", "50")
        .option("--timeout <ms>", "Timeout in milliseconds waiting for response", "15000")
        .action(async (threadId: string, opts: { type: string; limit: string; timeout: string }) => {
            const jsonMode = program.opts().json;
            const threadType = Number(opts.type);
            const limit = Number(opts.limit);
            const timeout = Number(opts.timeout);

            try {
                if (!jsonMode && limit > 100) {
                    info(
                        `Warning: fetching up to ${limit} messages. Large history may use significant memory and bandwidth.`,
                    );
                }

                const api = getApi();
                const allMessages: HistoryMessage[] = [];
                let lastMsgId: string | null = null;
                let done = false;

                // Start listener (required for WebSocket requestOldMessages)
                await new Promise<void>((resolveConnected, reject) => {
                    const timer = setTimeout(() => reject(new Error("Listener connection timeout")), 10000);
                    api.listener.on("connected", () => {
                        clearTimeout(timer);
                        resolveConnected();
                    });
                    api.listener.on("error", (err) => {
                        clearTimeout(timer);
                        reject(err);
                    });
                    api.listener.start({ retryOnClose: false });
                });

                // Fetch pages until limit reached or no more messages
                while (!done && allMessages.length < limit) {
                    const pageMessages = await new Promise<Message[]>((resolvePage) => {
                        const handler = (messages: Message[]) => {
                            clearTimeout(timer);
                            api.listener.removeListener("old_messages", handler);
                            resolvePage(messages);
                        };
                        const timer = setTimeout(() => {
                            api.listener.removeListener("old_messages", handler);
                            resolvePage([]);
                        }, timeout);

                        api.listener.on("old_messages", handler);
                        api.listener.requestOldMessages(threadType, lastMsgId);
                    });

                    if (!pageMessages || pageMessages.length === 0) {
                        done = true;
                        break;
                    }

                    for (const historyMsg of pageMessages) {
                        if (allMessages.length >= limit) break;
                        // API returns messages globally — filter to requested thread
                        const msgThread = String(historyMsg.threadId || "");
                        const msgSender = String(historyMsg.data?.uidFrom || "");
                        const target = String(threadId);
                        if (msgThread !== target && msgSender !== target) continue;
                        allMessages.push({
                            msgId: historyMsg.data?.msgId,
                            threadId: historyMsg.threadId,
                            senderId: historyMsg.data?.uidFrom || null,
                            senderName: historyMsg.data?.dName || null,
                            text:
                                typeof historyMsg.data?.content === "string"
                                    ? historyMsg.data.content
                                    : extractMessageText(historyMsg.data?.content, historyMsg.data?.msgType),
                            timestamp: historyMsg.data?.ts ? Number(historyMsg.data.ts) : null,
                            type:
                                typeof historyMsg.data?.content === "string"
                                    ? "text"
                                    : historyMsg.data?.msgType || "attachment",
                        });
                    }

                    // Use last message's actionId for pagination
                    const lastMsg = pageMessages[pageMessages.length - 1];
                    const nextId = lastMsg?.data?.actionId || lastMsg?.data?.msgId;
                    if (!nextId || nextId === lastMsgId) {
                        done = true;
                    }
                    lastMsgId = nextId;
                }

                // Sort by timestamp (oldest first)
                allMessages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

                output(
                    {
                        threadId,
                        threadType: threadType === 0 ? "dm" : "group",
                        count: allMessages.length,
                        messages: allMessages,
                    },
                    jsonMode,
                    () => {
                        success(`${allMessages.length} message(s) from ${threadId}`);
                        for (const m of allMessages) {
                            const date = m.timestamp ? new Date(m.timestamp).toLocaleString() : "?";
                            const name = m.senderName || m.senderId || "?";
                            console.log(`  [${date}] ${name}: ${(m.text || "").slice(0, 200)}`);
                        }
                    },
                );

                // Clean up listener
                api.listener.stop();
                process.exit(0);
            } catch (e) {
                try {
                    // `api` is scoped to the try block above, so fetch it again
                    getApi().listener.stop();
                } catch {}
                error(`History fetch failed: ${errorMessage(e)}`);
                process.exit(1);
            }
        });
}
