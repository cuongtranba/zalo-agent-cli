/**
 * Single entry point that equips a McpServer with everything Zalo exposes: tools and the inbox resource.
 * Used by both the stdio and HTTP transports so they behave identically.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MessageBuffer } from "./message-buffer.ts";
import type { MCPServerConfig } from "./mcp-config.ts";
import type { ThreadFilter } from "./thread-filter.ts";
import type { ThreadNameCache } from "./thread-name-cache.ts";
import { registerTools, type ToolsApi } from "./mcp-tools.ts";
import { registerInboxResource, type InboxSubscribers } from "./mcp-resources.ts";

export interface ZaloServerOptions {
    inboxSubscribers?: InboxSubscribers;
}

/** Registers tools and resources on a McpServer instance (one per client session). */
export type RegisterServerFn = (
    server: McpServer,
    getApi: () => ToolsApi,
    buffer: MessageBuffer,
    filter: ThreadFilter,
    config: MCPServerConfig,
    nameCache?: ThreadNameCache,
    options?: ZaloServerOptions,
) => void;

/**
 * @param getApi - Returns the current zca-js API instance
 */
export const registerZaloServer: RegisterServerFn = (
    server,
    getApi,
    buffer,
    filter,
    config,
    nameCache,
    options = {},
) => {
    registerTools(server, getApi, buffer, filter, config, nameCache);
    registerInboxResource(server, buffer, config, nameCache, options.inboxSubscribers);
};
