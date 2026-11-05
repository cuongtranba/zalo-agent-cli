# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### BREAKING

- Bun-only runtime: the CLI now runs on [Bun](https://bun.sh) >= 1.4.2 and Node.js is no longer supported. Install with `bun add -g zalo-agent-cli`; `npm install -g` still installs the package, but the `zalo-agent` command needs `bun` on `PATH`. Process managers must run it with Bun (for pm2: `--interpreter bun`; keep `--stop-exit-codes 78` for `mcp start`).
- The package now ships TypeScript sources (`src/**/*.ts`, `bin` points at `src/index.ts`) instead of JavaScript.

### Changed

- `threadType` on `zalo_send_message`, `zalo_send_attachment`, `zalo_react` and `zalo_get_history` now also accepts `"dm"` / `"group"` (the values buffered messages carry) besides `0` / `1`. Numeric values and defaults are unchanged.
- The npm package is renamed to `zalo-mcp` (the `zalo-agent` command is unchanged). Install with `bun add -g zalo-mcp`; `zalo-agent update` and the update check now use the `zalo-mcp` package. Config and credentials stay in `~/.zalo-agent-cli/`.
- Documentation and CLI text are English only: the README is rewritten for agents, the startup disclaimer and `oa init` instructions drop the Vietnamese duplicates, and `AGENTS.md` / `CLAUDE.md` describe the project for coding agents.

### Removed

- Donation section and QR image from the README.

- ClawHub auto-publish workflow (`.github/workflows/clawhub-publish.yml`) and the `clawhub install zalo-agent` instructions. The `skill/` folder remains usable locally by agents.

### Added

- `zalo_send_message` and `zalo_send_attachment` results include `sentAt` (epoch ms when the send resolved) next to `messageId`.
- Standalone release binaries (no runtime needed) for linux-x64, linux-arm64, darwin-x64, darwin-arm64 and windows-x64, attached to every GitHub release with `SHA256SUMS`.
- `bun run check` runs typecheck, lint, format check and tests in sequence.
- Push notifications through the standard MCP resource subscription: subscribe to `zalo://inbox` and receive `notifications/resources/updated` when a message is buffered (stdio and HTTP). Notifications are best-effort; cursor polling stays the source of truth.
- MCP tools: `zalo_send_attachment` (server paths or http(s) URLs, 25 MB cap), `zalo_react`, `zalo_list_conversations`, `zalo_get_group_members`, `zalo_get_user_info`.
- `zalo_send_message` accepts `replyToMessageId` (quote a buffered message) and `mentions`.
- Buffered MCP messages expose `cliMsgId`, `ts`, and `replyTo` (filled from the quoted message).
- MCP guide: "Integrating an agent over HTTP" section, full tool reference for all 12 tools, corrected config keys and `/mcp` URL.
- Tests for MCP tools and the HTTP transport.

### Changed

- Linting moved from ESLint to oxlint with a stricter ruleset (no explicit `any`, no non-null assertions, described `@ts-expect-error`, consistent type imports).
- CI runs on Bun for Ubuntu and macOS, including a compiled-binary smoke test; releases are published to npm with provenance by `release.yml`.
- The npm tarball no longer includes test files.
- HTTP MCP transport is now session-based (`mcp-session-id`, `GET /mcp` SSE stream) instead of stateless, which is required for server-to-client notifications. Standard MCP clients handle this automatically.

### Fixed

- `zalo://inbox` now returns the newest `limits.inboxWindow` unread messages (oldest→newest, `hasMore` = older ones left out) instead of the oldest, so a subscriber that re-reads on each notification keeps seeing new messages when more than the window are buffered. The window is its own setting, `limits.inboxWindow` (default 50), separate from `limits.maxMessagesPerPoll`, which now only governs `zalo_get_messages`; `zalo_get_messages` paging is unchanged.
- `oa login` crashed with a `ReferenceError` when the login timed out, because `warning()` was used without being imported.
- `profile full-avatar` always printed `?`: it read `avatar` from the response, but the field is `full_avatar`.
- `msg history` could not stop the listener when a fetch failed: the error handler referenced a variable scoped to the `try` block, and the resulting error was swallowed.
- Idle HTTP MCP sessions now expire (`limits.sessionIdleTimeout`, default 30m) instead of accumulating forever when a client disappears without closing its session. `/health` reports the open `sessions` count.
- The Zalo-group notifier now actually suppresses notifications while an MCP client is subscribed to `zalo://inbox` (previously it never knew about connected agents and always sent).
- The notifier no longer drops messages that arrive while a notification is being sent; they go out in the next batch.
- `mcp start` no longer crash-loops under a process manager when the saved Zalo session is expired or missing: it prints the reason once and exits with code 78 (start pm2 with `--stop-exit-codes 78`). Transient network failures still exit with code 1 so the process manager retries.
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
