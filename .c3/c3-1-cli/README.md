---
id: c3-1
c3-seal: c647b8139b996c0ac87d7fc36e594fe1f7b1003f2f81eef173ea480319756e27
title: cli
type: container
boundary: service
parent: c3-0
goal: Ship `zalo-agent`, a single Node.js (ESM) CLI binary that automates Zalo over both the unofficial `zca-js` web API and the official Official Account (OA) REST API, with multi-account + per-account proxy isolation, and exposes the same message stream to AI agents via an MCP server.
---

## Goal

Ship `zalo-agent`, a single Node.js (ESM) CLI binary that automates Zalo over both the unofficial `zca-js` web API and the official Official Account (OA) REST API, with multi-account + per-account proxy isolation, and exposes the same message stream to AI agents via an MCP server.

## Components

| ID | Name | Category | Status | Goal Contribution |
| --- | --- | --- | --- | --- |
| c3-101 | entry-router | foundation | active | Composes all command groups + shared preAction (autologin, json, disclaimer) |
| c3-102 | credential-store | foundation | active | Owns CONFIG_DIR; per-account session creds at 0600 |
| c3-103 | account-registry | foundation | active | Multi-account registry with 1:1 proxy + active flag |
| c3-104 | zalo-client | foundation | active | Single zca-js API instance per process with per-account proxy |
| c3-105 | oa-client | foundation | active | Official OA API v3.0 REST + OAuth client (separate creds) |
| c3-106 | shared-utils | foundation | active | output(), maskProxy, QR, bank/VietQR, text extraction, update-check |
| c3-112 | auth-commands | feature | active | login/logout/status + account list/switch/export |
| c3-110 | messaging-commands | feature | active | msg, quick-msg, conv, poll, reminder, auto-reply |
| c3-111 | social-commands | feature | active | friend, group, label, catalog, profile |
| c3-113 | listen-runtime | feature | active | Long-running WS listener: stream/webhook/JSONL |
| c3-114 | oa-runtime | feature | active | OA command tree + setup wizard + webhook listener |
| c3-115 | mcp-server | feature | active | MCP daemon (stdio/HTTP), 7 tools, buffer/filter/notify |

## Responsibilities

- Own the `zalo-agent` executable: register every command group through Commander and run shared pre-action concerns (auto-login, `--json` mode toggle, disclaimer, update check).
- Maintain one live `zca-js` API instance per process, swappable on account switch, each bound to its account-specific proxy.
- Persist account registry, per-account credentials, and OA credentials under `~/.zalo-agent-cli/` with owner-only file permissions.
- Expose Zalo automation as discrete CLI command groups (auth, messaging, social, listen) plus two long-running runtimes: the OA webhook listener and the MCP server.
- Keep human output (colored) and machine output (`--json`) consistent across every command for both terminal users and AI agents.

## Complexity Assessment

Moderate-to-complex. Single deployable but three distinct API surfaces (zca-js unofficial, OA official REST, MCP protocol) and three runtime modes (short-lived commands, webhook listeners, long-running MCP daemon). Highest risk areas: credential handling (account ban risk on the unofficial API), proxy dispatch correctness for Node native fetch vs zca-js, and MCP stdio discipline (stdout reserved for protocol).
