/**
 * MCP server setup with stdio transport.
 * Creates and connects the McpServer instance for Claude Code integration.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { MessageBuffer } from "./message-buffer.ts";
import type { MCPServerConfig } from "./mcp-config.ts";
import type { ThreadFilter } from "./thread-filter.ts";
import type { ThreadNameCache } from "./thread-name-cache.ts";
import type { ToolsApi } from "./mcp-tools.ts";
import { registerZaloServer, type ZaloServerOptions } from "./mcp-setup.ts";
import pkg from "../../package.json" with { type: "json" };

/**
 * Create and start MCP server with stdio transport.
 * All logs MUST use console.error() — stdout is reserved for MCP protocol.
 * @param getApi - Returns the current zca-js API instance
 */
export async function createMCPServer(
    getApi: () => ToolsApi,
    buffer: MessageBuffer,
    filter: ThreadFilter,
    config: MCPServerConfig,
    nameCache?: ThreadNameCache,
    options: ZaloServerOptions = {},
): Promise<McpServer> {
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
