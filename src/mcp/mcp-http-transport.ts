/**
 * Express server wrapping MCP StreamableHTTP transport with bearer token auth.
 * Stateful sessions: an initialize POST creates a server+transport pair keyed by mcp-session-id; later
 * POST/GET/DELETE /mcp requests carrying that id are routed to it. The GET stream carries server-initiated
 * notifications such as resources/updated for zalo://inbox.
 * A session with no open request (including its GET stream) for `limits.sessionIdleTimeout` is closed, so a
 * client that vanished without DELETE cannot leak its session.
 */

import express from "express";
import { randomUUID, timingSafeEqual } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "http";
import type { API } from "zca-js";
import type { Request, Response } from "express";
import type { MessageBuffer } from "./message-buffer.ts";
import type { ThreadFilter } from "./thread-filter.ts";
import type { ThreadNameCache } from "./thread-name-cache.ts";
import type { InboxSubscribers } from "./mcp-resources.ts";
import type { RegisterServerFn } from "./mcp-setup.ts";
import { parseDuration, type MCPServerConfig } from "./mcp-config.ts";
import pkg from "../../package.json" with { type: "json" };

/** Hosts that are safe to serve without an auth token */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_SWEEP_INTERVAL_MS = 60 * 1000;
const MIN_SWEEP_INTERVAL_MS = 50;

export interface HTTPServerDeps {
    getApi: () => API;
    buffer: MessageBuffer;
    filter: ThreadFilter;
    config: MCPServerConfig;
    nameCache?: ThreadNameCache;
    inboxSubscribers?: InboxSubscribers;
}

interface HTTPSession {
    transport: StreamableHTTPServerTransport;
    server: McpServer;
    openRequests: number;
    lastActivity: number;
}

/**
 * Create HTTP MCP server with optional bearer token auth.
 * @param registerServerFn - Registers tools and resources on a McpServer instance
 * @param authToken - Bearer token (null = no auth, loopback host only)
 * @param host - Bind address
 * @throws {Error} When no authToken is set and host is not a loopback address
 */
export function createHTTPServer(
    registerServerFn: RegisterServerFn,
    deps: HTTPServerDeps,
    port: number,
    authToken: string | null,
    host = "127.0.0.1",
): Server {
    if (!authToken && !LOOPBACK_HOSTS.has(host)) {
        throw new Error(`Refusing to listen on ${host} without --auth: set a bearer token or bind to 127.0.0.1`);
    }

    const app = express();
    app.use(express.json());

    // Auth middleware — skips /health
    if (authToken) {
        app.use((req, res, next) => {
            if (req.path === "/health") return next();
            const token = req.headers.authorization?.slice(7) || "";
            const expected = Buffer.from(authToken, "utf8");
            const received = Buffer.from(token, "utf8");
            if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
                return res.status(401).json({ error: "Unauthorized" });
            }
            next();
        });
    }

    /**
     * openRequests counts in-flight HTTP requests (the long-lived GET stream included); lastActivity is the
     * time a request last started or finished. Only sessions with no open request can expire.
     */
    const sessions = new Map<string, HTTPSession>();
    const idleTimeoutMs = parseDuration(deps.config?.limits?.sessionIdleTimeout ?? "30m") || DEFAULT_IDLE_TIMEOUT_MS;

    const jsonRpcError = (res: Response, status: number, code: number, message: string) =>
        res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });

    /** Create a server+transport pair for a new session; registered in `sessions` once initialized */
    const createSession = async (): Promise<HTTPSession> => {
        const server = new McpServer({ name: "zalo-agent", version: pkg.version });
        registerServerFn(server, deps.getApi, deps.buffer, deps.filter, deps.config, deps.nameCache, {
            inboxSubscribers: deps.inboxSubscribers,
        });

        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sessionId) => {
                sessions.set(sessionId, session);
            },
        });
        const session: HTTPSession = { transport, server, openRequests: 0, lastActivity: Date.now() };
        transport.onclose = () => {
            if (transport.sessionId) sessions.delete(transport.sessionId);
            server.close().catch(() => {});
        };

        await server.connect(transport);
        return session;
    };

    /** Route one request to a session, keeping its activity bookkeeping current until the response closes */
    const handleSessionRequest = (session: HTTPSession, req: Request, res: Response) => {
        session.openRequests++;
        session.lastActivity = Date.now();
        res.on("close", () => {
            session.openRequests--;
            session.lastActivity = Date.now();
        });
        return session.transport.handleRequest(req, res, req.body);
    };

    // MCP endpoint — POST carries requests, GET opens the notification stream, DELETE ends the session
    app.all("/mcp", async (req, res) => {
        try {
            if (!["POST", "GET", "DELETE"].includes(req.method)) {
                res.set("Allow", "POST, GET, DELETE");
                return jsonRpcError(res, 405, -32000, "Method not allowed");
            }

            const sessionId = req.headers["mcp-session-id"];
            if (sessionId) {
                const session = sessions.get(String(sessionId));
                if (!session) return jsonRpcError(res, 404, -32001, "Session not found");
                return await handleSessionRequest(session, req, res);
            }

            if (req.method !== "POST" || !isInitializeRequest(req.body)) {
                return jsonRpcError(res, 400, -32000, "Bad Request: no valid session ID provided");
            }
            await handleSessionRequest(await createSession(), req, res);
        } catch (err) {
            console.error("MCP HTTP error:", err);
            if (!res.headersSent) jsonRpcError(res, 500, -32603, "Internal server error");
        }
    });

    // Health check — no auth required
    app.get("/health", (_req, res) => {
        res.json({
            status: "ok",
            uptime: Math.floor(process.uptime()),
            threads: deps.buffer.getStats().length,
            sessions: sessions.size,
        });
    });

    const httpServer = app.listen(port, host, () => {
        console.error(`MCP HTTP server listening on ${host}:${port}`);
    });

    // transport.close() runs the cleanup wired in createSession (Map delete, server close, inbox listener detach)
    const sweepTimer = setInterval(
        () => {
            const now = Date.now();
            for (const session of sessions.values()) {
                if (session.openRequests === 0 && now - session.lastActivity > idleTimeoutMs) {
                    session.transport.close().catch(() => {});
                }
            }
        },
        Math.max(MIN_SWEEP_INTERVAL_MS, Math.min(MAX_SWEEP_INTERVAL_MS, idleTimeoutMs / 2)),
    );
    sweepTimer.unref();
    httpServer.on("close", () => clearInterval(sweepTimer));

    return httpServer;
}
