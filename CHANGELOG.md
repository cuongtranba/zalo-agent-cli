# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- MCP tools: `zalo_send_attachment` (server paths or http(s) URLs, 25 MB cap), `zalo_react`, `zalo_list_conversations`, `zalo_get_group_members`, `zalo_get_user_info`.
- `zalo_send_message` accepts `replyToMessageId` (quote a buffered message) and `mentions`.
- Buffered MCP messages expose `cliMsgId`, `ts`, and `replyTo` (filled from the quoted message).
- MCP guide: "Tích hợp vào agent qua HTTP" section, full tool reference for all 12 tools, corrected config keys and `/mcp` URL.
- Tests for MCP tools and the HTTP transport.

### Fixed

- MCP tools, HTTP transport and notifier used the Zalo session captured at startup, so every call failed after an automatic re-login. They now resolve the current session per call.
- `mcp start` no longer prints the auto-login line or the update notice to stdout (the stdio protocol channel).

### Security

- HTTP MCP refuses to start on a non-loopback `--host` without `--auth`.

## [1.6.1] - 2026-03-27

### Security

- **HTTP MCP binds to `127.0.0.1` by default** — prevents accidental network exposure of Zalo sessions. Use `--host 0.0.0.0` to override.
- **Command injection fix** — replaced `exec()` with `execFile()` in media file opener, preventing shell injection via crafted filenames.
- **Timing-safe token comparison** — bearer token auth now uses `crypto.timingSafeEqual` instead of `===`, resistant to timing attacks.
- **Empty `--auth` validation** — `--auth ""` no longer silently disables authentication middleware.

### Added

- `--host <address>` flag for MCP HTTP transport to control bind address.
- `prepublishOnly` script — blocks `npm publish` if lint or tests fail.
- `npm test` step in CI workflow — tests now run on every push/PR.
- `getThreadType()` public method on `MessageBuffer` (replaces private `_threads` access).
- Port validation for `--http` flag (rejects non-integer or out-of-range values).
- Unit tests for `getThreadType()` (4 new tests, total: 145).

### Fixed

- Webhook fetch timeout — added `AbortSignal.timeout(5000)` to prevent connection leaks on slow webhook servers.
- Silent `catch {}` blocks in listen command replaced with `console.error` for debuggability.
- Graceful shutdown in MCP mode — SIGINT now stops Zalo listener, flushes notifier, and closes HTTP server.
- Windows compatibility — `openFile()` now handles `start` (cmd.exe builtin) correctly with `shell: true`.

### Changed

- MCP server version now reads from `package.json` instead of hardcoded `"1.0.0"` (both stdio and HTTP transports).
- `mcp-tools.js` uses `buffer.getThreadType()` public API instead of accessing `buffer._threads` directly.

## [1.6.0] - 2026-03-26

### Added

- MCP server for AI agent integration (stdio + HTTP transports)
- Unified media downloader with auto-download and organized folder structure
- Thread name cache with Vietnamese accent-insensitive search
- Notifier system for offline agent alerts
- Thread filter with glob pattern matching

## [1.5.1] - 2026-03-25

### Fixed

- Minor bug fixes and stability improvements
