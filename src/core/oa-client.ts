/**
 * Zalo Official Account API v3.0 client.
 * Wraps OA REST endpoints with global fetch. No dependency on zca-js.
 * Credentials stored in ~/.zalo-agent/oa-credentials.json.
 */

import fs from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const V3_BASE = "https://openapi.zalo.me/v3.0/oa";
const V2_BASE = "https://openapi.zalo.me/v2.0/oa";
const DATA_DIR = join(homedir(), ".zalo-agent");
const OA_CREDS_FILE = join(DATA_DIR, "oa-credentials.json");

/**
 * Response envelope of the Zalo OA REST API. The payload shape differs per endpoint and is only loosely
 * documented, so commands read it defensively.
 */
export interface OAResponse {
    error?: number;
    message?: string;
    // oxlint-disable-next-line typescript/no-explicit-any -- untyped boundary: endpoint-specific payload, shape not guaranteed by Zalo
    data?: any;
    // oxlint-disable-next-line typescript/no-explicit-any -- untyped boundary: other top-level fields vary per endpoint
    [key: string]: any;
}

/** OA OAuth credentials + settings persisted per OA id. */
export interface OACreds {
    appId?: string;
    secretKey?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number | string;
    oaId?: string;
    webhookUrl?: string;
    verifyCode?: string;
    updatedAt?: string;
}

/** Response of the OAuth token endpoint. */
export interface OATokenResponse {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number | string;
    oa_id?: string;
    error?: number | string;
    error_name?: string;
    error_description?: string;
    message?: string;
}

/** One element of an OA list message. */
export interface OAListElement {
    title: string;
    subtitle?: string;
    image_url?: string;
    default_action?: Record<string, unknown>;
}

interface OAFetchOptions {
    method?: string;
    body?: Record<string, unknown> | FormData;
    token: string;
    isFormData?: boolean;
}

/** Ensure data directory exists. */
function ensureDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

const OAUTH_URL = "https://oauth.zaloapp.com/v4/oa/permission";
const TOKEN_URL = "https://oauth.zaloapp.com/v4/oa/access_token";

/** Save full OA credentials to disk with restricted file permissions. */
export function saveOACreds(data: OACreds, oaId = "default"): void {
    ensureDir();
    let creds: Record<string, OACreds> = {};
    if (fs.existsSync(OA_CREDS_FILE)) {
        creds = JSON.parse(fs.readFileSync(OA_CREDS_FILE, "utf8"));
    }
    creds[oaId] = { ...creds[oaId], ...data, updatedAt: new Date().toISOString() };
    fs.writeFileSync(OA_CREDS_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

/** Save OA access token to disk (backward compat). */
export function saveOAToken(accessToken: string, oaId = "default"): void {
    saveOACreds({ accessToken }, oaId);
}

/** Load full OA credentials from disk. */
export function loadOACreds(oaId = "default"): OACreds | null {
    if (!fs.existsSync(OA_CREDS_FILE)) return null;
    const creds = JSON.parse(fs.readFileSync(OA_CREDS_FILE, "utf8"));
    return creds[oaId] || null;
}

/** Load OA access token from disk. */
export function loadOAToken(oaId = "default"): string | null {
    return loadOACreds(oaId)?.accessToken || null;
}

/** Get token or throw. */
function getToken(oaId: string): string {
    const creds = loadOACreds(oaId);
    if (!creds?.accessToken) {
        throw new Error("OA not configured. Run: zalo-agent oa login --app-id <id> --secret <key>");
    }
    return creds.accessToken;
}

/** Build OAuth authorization URL. */
export function getOAuthUrl(appId: string, redirectUri = "http://localhost:3456/callback") {
    const params = new URLSearchParams({
        app_id: appId,
        redirect_uri: redirectUri,
    });
    return `${OAUTH_URL}?${params}`;
}

/** Exchange authorization code for access + refresh tokens. */
export async function exchangeCode(
    code: string,
    appId: string,
    secretKey: string,
    redirectUri = "http://localhost:3456/callback",
): Promise<OATokenResponse> {
    const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", secret_key: secretKey },
        body: new URLSearchParams({
            code,
            app_id: appId,
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
        }),
    });
    return (await res.json()) as OATokenResponse;
}

/** Refresh access token using refresh token. */
export async function refreshAccessToken(
    refreshToken: string,
    appId: string,
    secretKey: string,
): Promise<OATokenResponse> {
    const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", secret_key: secretKey },
        body: new URLSearchParams({
            refresh_token: refreshToken,
            app_id: appId,
            grant_type: "refresh_token",
        }),
    });
    return (await res.json()) as OATokenResponse;
}

/** Make authenticated request to Zalo OA API. */
async function oaFetch(
    url: string,
    { method = "GET", body, token, isFormData = false }: OAFetchOptions,
): Promise<OAResponse> {
    const headers: Record<string, string> = { access_token: token };
    if (!isFormData) headers["Content-Type"] = "application/json";

    const opts: RequestInit = { method, headers };
    if (body && !isFormData) opts.body = JSON.stringify(body);
    if (body && isFormData) opts.body = body as FormData;

    const res = await fetch(url, opts);
    const data = (await res.json()) as OAResponse;
    if (data.error && data.error !== 0) {
        throw new Error(`OA API error ${data.error}: ${data.message || JSON.stringify(data)}`);
    }
    return data;
}

// ─── Messaging (v3.0) ────────────────────────────────────────────────

const VALID_MSG_TYPES = ["cs", "transaction", "promotion"];

/** Validate messageType to prevent path injection. */
function validateMsgType(messageType: string): string {
    if (!VALID_MSG_TYPES.includes(messageType)) {
        throw new Error(`Invalid message type "${messageType}". Must be: ${VALID_MSG_TYPES.join(", ")}`);
    }
    return messageType;
}

/** Send text message via OA. messageType: cs | transaction | promotion */
export async function sendText(userId: string, text: string, messageType: string = "cs", oaId = "default") {
    const token = getToken(oaId);
    return oaFetch(`${V3_BASE}/message/${validateMsgType(messageType)}`, {
        method: "POST",
        token,
        body: { recipient: { user_id: userId }, message: { text } },
    });
}

/** Send image message via OA (by URL or attachment_id). */
export async function sendImage(
    userId: string,
    { imageUrl, imageId }: { imageUrl?: string; imageId?: string },
    messageType: string = "cs",
    oaId = "default",
) {
    const token = getToken(oaId);
    const element: Record<string, string> = { media_type: "image" };
    if (imageUrl) element.url = imageUrl;
    else if (imageId) element.attachment_id = imageId;
    else throw new Error("Provide --image-url or --image-id");

    return oaFetch(`${V3_BASE}/message/${validateMsgType(messageType)}`, {
        method: "POST",
        token,
        body: {
            recipient: { user_id: userId },
            message: {
                attachment: {
                    type: "template",
                    payload: { template_type: "media", elements: [element] },
                },
            },
        },
    });
}

/** Send file message via OA (requires pre-uploaded file attachment_id). */
export async function sendFile(userId: string, fileId: string, messageType: string = "cs", oaId = "default") {
    const token = getToken(oaId);
    return oaFetch(`${V3_BASE}/message/${validateMsgType(messageType)}`, {
        method: "POST",
        token,
        body: {
            recipient: { user_id: userId },
            message: { attachment: { type: "file", payload: { token: fileId } } },
        },
    });
}

/** Send list message via OA. elements: [{ title, subtitle, image_url, default_action }] */
export async function sendList(
    userId: string,
    elements: OAListElement[],
    messageType: string = "cs",
    oaId = "default",
) {
    const token = getToken(oaId);
    return oaFetch(`${V3_BASE}/message/${validateMsgType(messageType)}`, {
        method: "POST",
        token,
        body: {
            recipient: { user_id: userId },
            message: {
                attachment: {
                    type: "template",
                    payload: { template_type: "list", elements },
                },
            },
        },
    });
}

/** Get message delivery status. */
export async function getMessageStatus(messageId: string, oaId = "default") {
    const token = getToken(oaId);
    return oaFetch(`${V3_BASE}/message/status?message_id=${messageId}`, { token });
}

// ─── User / Follower Management ──────────────────────────────────────

/** Get OA profile info. */
export async function getOAProfile(oaId = "default") {
    const token = getToken(oaId);
    // v2 fallback — v3 docs incomplete for getoa
    return oaFetch(`${V2_BASE}/getoa`, { token });
}

/** Get follower info by user_id. */
export async function getFollowerInfo(userId: string, oaId = "default") {
    const token = getToken(oaId);
    return oaFetch(`${V3_BASE}/user/detail?user_id=${userId}`, { token });
}

/** Get followers list (paginated). */
export async function getFollowers(offset = 0, count = 50, oaId = "default") {
    const token = getToken(oaId);
    return oaFetch(`${V3_BASE}/user/getlist?offset=${offset}&count=${count}`, { token });
}

/** Update follower info (name, phone, address, etc.). */
export async function updateFollowerInfo(userId: string, updates: Record<string, unknown>, oaId = "default") {
    const token = getToken(oaId);
    return oaFetch(`${V3_BASE}/user/update`, {
        method: "POST",
        token,
        body: { user_id: userId, ...updates },
    });
}

// ─── Tags ────────────────────────────────────────────────────────────

/** Get all tags. */
export async function getTags(oaId = "default") {
    const token = getToken(oaId);
    // v2 endpoint — v3 not documented
    return oaFetch(`${V2_BASE}/tag/gettagsofoa`, { token });
}

/** Assign tag to follower. */
export async function assignTag(userId: string, tagName: string, oaId = "default") {
    const token = getToken(oaId);
    return oaFetch(`${V3_BASE}/tag/taguser`, {
        method: "POST",
        token,
        body: { user_id: userId, tag_name: tagName },
    });
}

/** Remove tag. */
export async function removeTag(tagName: string, oaId = "default") {
    const token = getToken(oaId);
    return oaFetch(`${V3_BASE}/tag/rmtag`, {
        method: "POST",
        token,
        body: { tag_name: tagName },
    });
}

/** Remove follower from tag. */
export async function removeFollowerFromTag(userId: string, tagName: string, oaId = "default") {
    const token = getToken(oaId);
    return oaFetch(`${V3_BASE}/tag/rmfollowerfromtag`, {
        method: "POST",
        token,
        body: { user_id: userId, tag_name: tagName },
    });
}

// ─── Media Upload ────────────────────────────────────────────────────

/** Upload image to OA (returns attachment_id). */
export async function uploadImage(filePath: string, oaId = "default") {
    const token = getToken(oaId);
    const fileData = fs.readFileSync(filePath);
    const blob = new Blob([fileData]);
    const form = new FormData();
    form.append("file", blob, filePath.split("/").pop());

    return oaFetch(`${V3_BASE}/upload/image`, {
        method: "POST",
        token,
        body: form,
        isFormData: true,
    });
}

/** Upload file to OA (returns token/attachment_id). */
export async function uploadFile(filePath: string, oaId = "default") {
    const token = getToken(oaId);
    const fileData = fs.readFileSync(filePath);
    const blob = new Blob([fileData]);
    const form = new FormData();
    form.append("file", blob, filePath.split("/").pop());

    return oaFetch(`${V3_BASE}/upload/file`, {
        method: "POST",
        token,
        body: form,
        isFormData: true,
    });
}

// ─── Conversations ───────────────────────────────────────────────────

/** Get recent chat list (v2 API). */
export async function getRecentChat(offset = 0, count = 10, oaId = "default") {
    const token = getToken(oaId);
    return oaFetch(`${V2_BASE}/listrecentchat?offset=${offset}&count=${count}`, { token });
}

/** Get conversation history with a user (v2 API). */
export async function getConversation(userId: string, offset = 0, count = 10, oaId = "default") {
    const token = getToken(oaId);
    return oaFetch(`${V2_BASE}/conversation?user_id=${userId}&offset=${offset}&count=${count}`, {
        token,
    });
}

// ─── Menu ────────────────────────────────────────────────────────────

/** Update OA menu. */
export async function updateMenu(menuData: Record<string, unknown>, oaId = "default") {
    const token = getToken(oaId);
    return oaFetch(`${V3_BASE}/menu`, { method: "POST", token, body: menuData });
}

// ─── Articles ────────────────────────────────────────────────────────

/** Create article (broadcast). */
export async function createArticle(articleData: Record<string, unknown>, oaId = "default") {
    const token = getToken(oaId);
    return oaFetch(`${V3_BASE}/article/create`, { method: "POST", token, body: articleData });
}

/** Get article list. */
export async function getArticleList(offset = 0, limit = 10, oaId = "default") {
    const token = getToken(oaId);
    return oaFetch(`${V3_BASE}/article/getlist?offset=${offset}&limit=${limit}`, { token });
}

/** Get article detail. */
export async function getArticleDetail(articleId: string, oaId = "default") {
    const token = getToken(oaId);
    return oaFetch(`${V3_BASE}/article/getdetail?id=${articleId}`, { token });
}

// ─── Store ───────────────────────────────────────────────────────────

/** Create product in OA store. */
export async function createProduct(productData: Record<string, unknown>, oaId = "default") {
    const token = getToken(oaId);
    return oaFetch(`${V3_BASE}/store/product/create`, { method: "POST", token, body: productData });
}

/** Get product list. */
export async function getProductList(offset = 0, limit = 10, oaId = "default") {
    const token = getToken(oaId);
    return oaFetch(`${V3_BASE}/store/product/getproductofoa?offset=${offset}&limit=${limit}`, {
        token,
    });
}

/** Get product detail. */
export async function getProductInfo(productId: string, oaId = "default") {
    const token = getToken(oaId);
    return oaFetch(`${V3_BASE}/store/product/getproduct?id=${productId}`, { token });
}

/** Create category in OA store. */
export async function createCategory(categoryData: Record<string, unknown>, oaId = "default") {
    const token = getToken(oaId);
    return oaFetch(`${V3_BASE}/store/category/create`, {
        method: "POST",
        token,
        body: categoryData,
    });
}

/** Get category list. */
export async function getCategoryList(oaId = "default") {
    const token = getToken(oaId);
    return oaFetch(`${V3_BASE}/store/category/getcategoryofoa`, { token });
}

/** Create order. */
export async function createOrder(orderData: Record<string, unknown>, oaId = "default") {
    const token = getToken(oaId);
    return oaFetch(`${V3_BASE}/store/order/create`, { method: "POST", token, body: orderData });
}
