# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# zalo-agent-cli

CLI tool for Zalo automation — multi-account, proxy, bank transfers, QR payments, Official Account API v3.0, and an MCP server for AI agents. Single Node.js (ESM, `"type": "module"`, Node >=20) binary `zalo-agent`, built on the unofficial [zca-js](https://github.com/RFS-ADRENO/zca-js) plus the official OA REST API.

## Commands

- `npm test` — all unit + CLI tests (`node --test`, no external framework, no Zalo session needed)
- Single file: `node --test src/utils/bank-helpers.test.js`
- Single test by name: `node --test --test-name-pattern="parses VND" src/utils/bank-helpers.test.js`
- `npm run lint` / `npm run lint:fix` — ESLint
- `npm run format` / `npm run format:check` — Prettier
- Test files live **next to** their source (`foo.js` → `foo.test.js`); CLI integration tests in `src/cli.test.js`.

## Architecture

This project uses C3 docs in `.c3/`. For architecture questions, changes, audits, and file context → `/c3`. Operations: query, audit, change, ref, rule, sweep. File lookup: `c3x lookup <file-or-glob>` maps files/directories to components + refs.

Topology: one container (`c3-1` cli) with six foundation components (entry-router, credential-store, account-registry, zalo-client, oa-client, shared-utils) and six feature components (auth-commands, messaging-commands, social-commands, listen-runtime, oa-runtime, mcp-server).

### Command registration pattern

`src/index.js` is the entry router. Every command group lives in `src/commands/<group>.js` and exports a `register<Group>Commands(program)` function that attaches Commander.js subcommands. To add a command: create/extend a group file, export a register function, and call it in `src/index.js`. The global `preAction` hook (`src/index.js`) runs before every command: prints the unofficial-API disclaimer (skipped for `oa`/`mcp`/`--json`), auto-logs-in the active account (skipped for `login`/`account`/`help`/`oa`/`mcp`/`update`), and fires a non-blocking update check.

### Two independent credential systems (gotcha)

- **Personal account (zca-js):** registry at `~/.zalo-agent-cli/accounts.json`, per-account creds at `~/.zalo-agent-cli/credentials/cred_<ownId>.json`. Managed by `src/core/accounts.js` + `src/core/credentials.js`. One active account at a time; each account maps 1:1 to its own proxy. `src/core/zalo-client.js` holds a single live `_api` instance per process — `autoLogin()` hydrates it from the active account.
- **Official Account (OA):** entirely separate. Creds at `~/.zalo-agent/oa-credentials.json` (note the different dir), OAuth-based, no zca-js dependency. `src/core/oa-client.js` wraps the v3.0/v2.0 REST endpoints with `node-fetch`.

These two systems do not share state, directories, or auth. Don't conflate them.

### Output & JSON mode

All command output goes through `src/utils/output.js`. Use `output(data, jsonMode, humanFormatter)` — never raw `console.log` for results. The global `--json` flag sets `process.env.ZALO_JSON_MODE=1`, which also suppresses zca-js internal logs to keep stdout clean for piping.

### Proxy dispatch (gotcha)

Native Node.js `fetch` ignores the `agent` option. `src/core/zalo-client.js` uses **two** proxy mechanisms on the same proxy URL: `HttpsProxyAgent` for the WebSocket (`ws` lib) and an undici `ProxyAgent` `dispatcher` (via a `polyfill` fetch) for HTTP. Both are required for a proxied account to work.

### MCP server

`src/mcp/` — `zalo-agent mcp start` runs an MCP server over stdio (local Claude Code) or HTTP (VPS). On the stdio path, **stdout is reserved for the MCP protocol**: all logging MUST use `console.error()`. Tools registered in `src/mcp/mcp-tools.js`. Live messages flow through `message-buffer.js` + `thread-filter.js` + `thread-name-cache.js`.

### Shared message parsing

`src/utils/extract-message-text.js` (`extractMessageText`) is the single source of truth for pulling readable text out of non-string Zalo message content (replies, bubbles, link previews). Reused by `listen`, `msg`, and MCP tools — change it in one place.

## Conventions

- ESM only. zca-js enums are mirrored as local constants in command files (e.g. `THREAD_USER = 0`, `THREAD_GROUP = 1`) — match the enum order in zca-js.
- Credential files are written with `0600` permissions — preserve this on any new credential write (enforced rule `secret-file-perms`).
- This tool wraps an **unofficial** API; accounts can be banned. The disclaimer in `src/index.js` is intentional.
