/**
 * MCP server setup with stdio transport.
 * Creates and connects the McpServer instance for Claude Code integration.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerZaloServer } from "./mcp-setup.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8"));

/**
 * Create and start MCP server with stdio transport.
 * All logs MUST use console.error() — stdout is reserved for MCP protocol.
 * @param {() => object} getApi - Returns the current zca-js API instance
 * @param {import("./message-buffer.js").MessageBuffer} buffer
 * @param {import("./thread-filter.js").ThreadFilter} filter
 * @param {object} config - MCP config
 * @param {import("./thread-name-cache.js").ThreadNameCache} [nameCache] - Thread name cache
 * @param {{ inboxSubscribers?: import("./mcp-resources.js").InboxSubscribers }} [options]
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
