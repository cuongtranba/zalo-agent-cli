---
id: c3-115
c3-seal: 37d5ef7abaac41a182482f446c40cb3175bda7cce7d6eb1a39c33074eb3e2736
title: mcp-server
type: component
category: feature
parent: c3-1
goal: Expose the live Zalo message stream to AI agents as an MCP server over stdio or HTTP, with buffering, filtering, and notifications.
---

## Goal

Expose the live Zalo message stream to AI agents as an MCP server over stdio or HTTP, with buffering, filtering, and notifications.

## Parent Fit

| Field | Value |
| --- | --- |
| Layer | Feature (15) — long-running MCP daemon for agent integration |
| Numbering | Feature — depends on zalo-client + shared-utils |
| Depends on | zalo-client (autoLogin, getApi), shared-utils (extract-message-text), credential-store (CONFIG_DIR) |
| Consumed by | Claude Code and other MCP clients |

## Purpose

Owns `src/commands/mcp.js` and `src/mcp/**`. `mcp.js` bootstraps login, wires the zca-js WebSocket listener into a `MessageBuffer`, and starts either the stdio transport (`mcp-server.js`) or a stateless Express HTTP transport (`mcp-http-transport.js`). `mcp-tools.js` registers 7 MCP tools (get_messages, send_message, list_threads, search_threads, mark_read, get_history, view_media). Supporting modules: `message-buffer`, `thread-filter`, `thread-name-cache`, `notifier`, `media-downloader`, `mcp-config`. Non-goals: short-lived CLI commands.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Active login + mcp-config.json loaded (under CONFIG_DIR) | c3-102 |
| Input | Live zca-js listener events buffered by threadId | c3-104 |
| Shared state | In-memory MessageBuffer (cursor-based) + ThreadNameCache | N.A - in-process |
| Dependency | extractMessageText normalizes payloads for tools | c3-106 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | An agent reads/sends messages via 7 MCP tools | ref-json-output-mode |
| Primary path | listener -> buffer.push -> tool reads since cursor (src/mcp/mcp-tools.js) | rule-mcp-stdout-reserved |
| Alternate | HTTP transport: stateless server+transport per POST /mcp (src/mcp/mcp-http-transport.js) | N.A - streamable HTTP |
| Failure | DM notifier batches alerts to a group after cooldown (src/mcp/notifier.js) | N.A - debounce |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-mcp-stdout-reserved | rule | stdio path logs to stderr only | Must comply | stdout = JSON-RPC channel |
| ref-credential-isolation | ref | mcp-config + media under CONFIG_DIR | Must follow | Imports CONFIG_DIR |
| ref-command-registration | ref | registerMCPCommands(program) shape | Must follow | Single command group |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| 7 MCP tools | IN/OUT | get/send/list/search/mark_read/history/view_media | Zod-validated args | src/mcp/mcp-tools.js |
| stdio transport | OUT | JSON-RPC over stdout; logs to stderr | One per process | src/mcp/mcp-server.js |
| HTTP transport | IN/OUT | POST /mcp, bearer auth when token set, /health | Stateless per request | src/mcp/mcp-http-transport.js |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| stdout pollution breaks client | console.log in stdio path | Client parse errors | src/mcp/message-buffer.test.js |
| Buffer leak / unbounded growth | Removing maxSize/maxAge eviction | Memory growth | src/mcp/message-buffer.test.js |
| Noise floods agent | Disabling thread-filter noise rules | Stickers/system spam | src/mcp/thread-filter.test.js |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Tool result payloads | Contract | Per-tool schema | src/mcp/mcp-tools.js |
| Buffered message normalization | Foundational Flow | extract-message-text output | src/utils/extract-message-text.js |
