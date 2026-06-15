---
id: rule-mcp-stdout-reserved
c3-seal: bd91ae8277e14bf760458bd28bdd7db49ed71f89c867af9c55f8418ae99bc213
title: mcp-stdout-reserved
type: rule
goal: Enforce that the MCP stdio runtime keeps stdout exclusively for the MCP wire protocol, project-wide, so a stray log line can never corrupt the JSON-RPC stream a client is parsing.
---

## Goal

Enforce that the MCP stdio runtime keeps stdout exclusively for the MCP wire protocol, project-wide, so a stray log line can never corrupt the JSON-RPC stream a client is parsing.

## Rule

In MCP stdio code paths, diagnostic output never uses `console.log`; all logs go to `console.error` (stderr).

## Golden Example

```js
// src/mcp/mcp-server.js — canonical pattern
export async function createMCPServer(api, buffer, filter, config, nameCache) {
    const server = new McpServer({ name: "zalo-agent", version: pkg.version });
    registerTools(server, api, buffer, filter, config, nameCache);
    const transport = new StdioServerTransport();
    await server.connect(transport);          // REQUIRED: stdout becomes the protocol channel
    console.error("[mcp-server] MCP server connected via stdio transport"); // REQUIRED: logs to stderr
    return server;
}
```

## Not This

| Anti-Pattern | Correct | Why Wrong Here |
| --- | --- | --- |
| console.log("[mcp] connected") in any mcp path | console.error("[mcp] connected") | stdout is the JSON-RPC transport; a log line is parsed as a malformed message and breaks the client |
| Library writing to stdout during mcp start | Set ZALO_JSON_MODE / suppress before connect | zca-js internal logs would pollute the protocol stream |

## Scope

Applies to `src/mcp/**` and `src/commands/mcp.js` while running the stdio transport. The HTTP transport (`mcp-http-transport.js`) does not share stdout with the protocol, but the convention is kept for consistency.

## Override

None. The entry point already sets `ZALO_JSON_MODE=1` for the `mcp` command (src/index.js:48-50) to suppress upstream stdout noise; any new logging must respect this.
