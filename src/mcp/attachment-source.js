/**
 * Resolve attachment sources (server-side file paths or http(s) URLs) into local file paths
 * that zca-js sendMessage can upload. URLs are downloaded into a temp dir the caller must remove.
 */

import { mkdtemp, writeFile, stat } from "fs/promises";
import { tmpdir } from "os";
import { isAbsolute, join, basename, extname } from "path";

/** Max size of a downloaded attachment */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Download timeout per URL in ms */
const DOWNLOAD_TIMEOUT_MS = 30000;

/** Extension fallback when the URL path has none, keyed by content-type */
const EXT_BY_CONTENT_TYPE = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
};

/**
 * Create a temp dir for downloaded attachments. Caller must rm it when done.
 * @returns {Promise<string>}
 */
export function createAttachmentDir() {
    return mkdtemp(join(tmpdir(), "zalo-attach-"));
}

/**
 * Validate a local file source.
 * @param {string} source - Absolute path on the server host
 * @returns {Promise<string>} The same path when it is an existing regular file
 */
async function resolveLocalFile(source) {
    if (!isAbsolute(source)) throw new Error(`Attachment path must be absolute: ${source}`);
    let info;
    try {
        info = await stat(source);
    } catch {
        throw new Error(`Attachment file not found: ${source}`);
    }
    if (!info.isFile()) throw new Error(`Attachment is not a file: ${source}`);
    return source;
}

/**
 * Derive a safe "name.ext" filename for a downloaded URL.
 * @param {URL} url
 * @param {string} contentType
 * @param {number} index - Position in the sources list, keeps names unique
 * @returns {string}
 */
function safeFilename(url, contentType, index) {
    let name = "";
    try {
        name = basename(decodeURIComponent(url.pathname));
    } catch {
        // Malformed escape — fall back to the generic name
    }
    name = name.replace(/[^A-Za-z0-9._-]/g, "_");
    let ext = extname(name);
    if (!ext) {
        const type = contentType.split(";")[0].trim().toLowerCase();
        ext = EXT_BY_CONTENT_TYPE[type] || ".bin";
    }
    const stem = name.slice(0, name.length - extname(name).length) || "attachment";
    return `${index}-${stem}${ext}`;
}

/**
 * Download an http(s) URL into dir.
 * @param {string} source
 * @param {string} dir - Existing temp dir
 * @param {number} index
 * @returns {Promise<string>} Path of the downloaded file
 */
async function downloadUrl(source, dir, index) {
    const url = new URL(source);
    const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Download failed (${res.status}) for ${source}`);

    const declared = Number(res.headers.get("content-length"));
    if (declared > MAX_ATTACHMENT_BYTES) throw new Error(`Attachment too large (>25 MB): ${source}`);

    // Count bytes while streaming so a response without content-length cannot exhaust memory
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
        size += chunk.length;
        if (size > MAX_ATTACHMENT_BYTES) throw new Error(`Attachment too large (>25 MB): ${source}`);
        chunks.push(chunk);
    }
    const data = Buffer.concat(chunks);

    const path = join(dir, safeFilename(url, res.headers.get("content-type") || "", index));
    await writeFile(path, data);
    return path;
}

/**
 * Resolve every source to a local file path.
 * @param {string[]} sources - Absolute server paths or http(s) URLs
 * @param {string} dir - Temp dir for downloads (from createAttachmentDir)
 * @returns {Promise<string[]>}
 */
export async function resolveAttachmentSources(sources, dir) {
    // Sequential so a failure never leaves in-flight writes racing the caller's temp dir cleanup
    const paths = [];
    for (const [index, source] of sources.entries()) {
        paths.push(
            /^https?:\/\//i.test(source) ? await downloadUrl(source, dir, index) : await resolveLocalFile(source),
        );
    }
    return paths;
}
