/**
 * Express server wrapping MCP StreamableHTTP transport with bearer token auth.
 * Stateful sessions: an initialize POST creates a server+transport pair keyed by mcp-session-id; later
 * POST/GET/DELETE /mcp requests carrying that id are routed to it. The GET stream carries server-initiated
 * notifications such as resources/updated for zalo://inbox.
 */

import express from "express";
import { randomUUID, timingSafeEqual } from "crypto";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8"));

/** Hosts that are safe to serve without an auth token */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * Create HTTP MCP server with optional bearer token auth.
 * @param {Function} registerServerFn - Registers tools and resources on a McpServer instance
 * @param {object} deps - { getApi, buffer, filter, config, nameCache }
 * @param {number} port
 * @param {string|null} authToken - Bearer token (null = no auth, loopback host only)
 * @param {string} [host] - Bind address
 * @returns {import("http").Server}
 * @throws {Error} When no authToken is set and host is not a loopback address
 */
export function createHTTPServer(registerServerFn, deps, port, authToken, host = "127.0.0.1") {
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

    /** @type {Map<string, { transport: StreamableHTTPServerTransport, server: McpServer }>} */
    const sessions = new Map();

    const jsonRpcError = (res, status, code, message) =>
        res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });

    /** Create a server+transport pair for a new session; registered in `sessions` once initialized */
    const createSession = async () => {
        const server = new McpServer({ name: "zalo-agent", version: pkg.version });
        registerServerFn(server, deps.getApi, deps.buffer, deps.filter, deps.config, deps.nameCache);

        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sessionId) => sessions.set(sessionId, { transport, server }),
        });
        transport.onclose = () => {
            if (transport.sessionId) sessions.delete(transport.sessionId);
            server.close().catch(() => {});
        };

        await server.connect(transport);
        return transport;
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
                const session = sessions.get(sessionId);
                if (!session) return jsonRpcError(res, 404, -32001, "Session not found");
                return await session.transport.handleRequest(req, res, req.body);
            }

            if (req.method !== "POST" || !isInitializeRequest(req.body)) {
                return jsonRpcError(res, 400, -32000, "Bad Request: no valid session ID provided");
            }
            const transport = await createSession();
            await transport.handleRequest(req, res, req.body);
        } catch (err) {
            console.error("MCP HTTP error:", err);
            if (!res.headersSent) jsonRpcError(res, 500, -32603, "Internal server error");
        }
    });

    // Health check — no auth required
    app.get("/health", (req, res) => {
        res.json({
            status: "ok",
            uptime: Math.floor(process.uptime()),
            threads: deps.buffer.getStats().length,
        });
    });

    return app.listen(port, host, () => {
        console.error(`MCP HTTP server listening on ${host}:${port}`);
    });
}
