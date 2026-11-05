/**
 * MCP server setup with stdio transport.
 * Creates and connects the McpServer instance for Claude Code integration.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerZaloServer } from "./mcp-setup.ts";
import pkg from "../../package.json" with { type: "json" };

/**
 * Create and start MCP server with stdio transport.
 * All logs MUST use console.error() — stdout is reserved for MCP protocol.
 * @param {() => object} getApi - Returns the current zca-js API instance
 * @param {import("./message-buffer.ts").MessageBuffer} buffer
 * @param {import("./thread-filter.ts").ThreadFilter} filter
 * @param {object} config - MCP config
 * @param {import("./thread-name-cache.ts").ThreadNameCache} [nameCache] - Thread name cache
 * @param {{ inboxSubscribers?: import("./mcp-resources.ts").InboxSubscribers }} [options]
 * @returns {Promise<McpServer>}
 */
export async function createMCPServer(getApi, buffer, filter, config, nameCache, options = {}) {
    const server = new McpServer({
        name: "zalo-agent",
        version: pkg.version,
    });

    registerZaloServer(server, getApi, buffer, filter, config, nameCache, options);

    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error("[mcp-server] MCP server connected via stdio transport");

    return server;
}
