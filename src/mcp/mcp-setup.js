/**
 * Single entry point that equips a McpServer with everything Zalo exposes: tools and the inbox resource.
 * Used by both the stdio and HTTP transports so they behave identically.
 */

import { registerTools } from "./mcp-tools.js";
import { registerInboxResource } from "./mcp-resources.js";

/**
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {() => object} getApi - Returns the current zca-js API instance
 * @param {import("./message-buffer.js").MessageBuffer} buffer
 * @param {import("./thread-filter.js").ThreadFilter} filter
 * @param {object} config - MCP config
 * @param {import("./thread-name-cache.js").ThreadNameCache} [nameCache]
 * @param {{ inboxSubscribers?: import("./mcp-resources.js").InboxSubscribers }} [options]
 */
export function registerZaloServer(server, getApi, buffer, filter, config, nameCache, options = {}) {
    registerTools(server, getApi, buffer, filter, config, nameCache);
    registerInboxResource(server, buffer, config, nameCache, options.inboxSubscribers);
}
