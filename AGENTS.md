# AGENTS.md

Guidance for AI coding agents working in this repository. Read this before changing code.

## What this is

`zalo-agent`, a Bun + TypeScript CLI and MCP server that automates Zalo, published on npm as `zalo-mcp`.

- **Personal accounts** go through [zca-js](https://github.com/RFS-ADRENO/zca-js), an unofficial reverse-engineered API (QR login, cookies, one WebSocket listener per account).
- **Official Accounts (OA)** go through the official REST API v3.0 (`src/core/oa-client.ts`, `oa` commands). OA code never touches zca-js.
- **MCP server** (`zalo-agent mcp start`) exposes a logged-in personal account to MCP clients over stdio or HTTP.

## Commands

```bash
bun install --frozen-lockfile
bun src/index.ts <args>        # run the CLI from source (there is no dev script)
bun run typecheck              # tsc --noEmit
bun run lint                   # oxlint (warnings fail)
bun run format                 # prettier --write src/
bun test                       # all tests; bun test src/mcp/ for one folder
bun run check                  # typecheck + lint + format:check + test, same as CI
bun run build:bin              # compile dist/zalo-agent
```

Run `bun run check` before you call a change done. CI (`.github/workflows/ci.yml`) also runs `--version`, `--help`, and the compiled binary on Ubuntu and macOS.

## Layout

```
src/index.ts            Commander entry: global --json, preAction hook (disclaimer, auto-login, update check), registers commands
src/commands/<group>.ts One file per command group (msg, friend, group, conv, account, listen, oa*, mcp, ...)
src/core/               zalo-client.ts (zca-js wrapper, single API instance), accounts.ts, credentials.ts, oa-client.ts
src/mcp/                MCP server: mcp-tools.ts (12 tools), mcp-resources.ts (zalo://inbox), mcp-http-transport.ts,
                        mcp-config.ts, message-buffer.ts, thread-filter.ts, thread-name-cache.ts, notifier.ts, media
src/utils/              output.ts (output/success/error/info/warning), bank-helpers.ts, proxy-helpers.ts, qr-*, update-check.ts
src/**/*.test.ts        Colocated bun:test tests; src/cli.test.ts runs the CLI end to end
skill/                  End-user agent skill (SKILL.md + references/) describing how to drive the CLI
docs/official-account.md OA guide
```

`plans/` is gitignored and local-only. `assets/` holds demo media and is excluded from lint and typecheck.

## Rules

- **Bun only.** Use Bun APIs and global `fetch`; do not add Node-only tooling or new dependencies without a clear need.
- **Style** is enforced by oxlint and prettier (4 spaces, double quotes, width 120). No `any`, no non-null `!`, use `import type` for types, `@ts-expect-error` needs a reason, `@ts-ignore` is banned. Imports use `.ts` extensions.
- **Output.** User-facing CLI output goes through `src/utils/output.ts` so `--json` keeps working. Every new command must produce valid JSON under `--json`.
- **MCP stdout is the protocol.** In `src/mcp/` and `src/commands/mcp.ts`, log with `console.error` only; any `console.log` corrupts stdio transport.
- **New MCP tools** are registered in `src/mcp/mcp-tools.ts` with a zod input schema and a description written for an LLM caller. Update the tool table in `README.md` and `skill/references/mcp-guide.md`.
- **New CLI commands or flags**: update `skill/references/command-reference.md` (and `skill/SKILL.md` if it is a common task).
- **Secrets.** Never log or print credentials, cookies, IMEI, tokens, or proxy passwords; mask proxies with `maskProxy()` from `src/utils/proxy-helpers.ts`. Never pass user input to a shell.
- **English** for code, comments, docs, and CLI text.
- **CHANGELOG.md**: add user-visible changes under `## [Unreleased]` (Added / Changed / Fixed / Removed / BREAKING).
- **Commits** use Conventional Commits (`feat(mcp): ...`, `fix: ...`, `docs: ...`). Work on a branch; do not commit to `main`. Do not `npm publish` or bump versions by hand; see `RELEASING.md`.

## Tests

- Framework: `bun:test` with `node:assert/strict`. Tests sit next to the code as `*.test.ts`.
- Test behavior through public functions and the CLI, not internals. Use real or in-memory fakes; the suite uses no mocking library.
- CLI tests must point `HOME` at a temp directory (see `src/cli.test.ts`) so they never read or write real credentials.
- Tests must not call Zalo. Anything needing a live account goes in the manual checklist in `TEST.md`.

## Gotchas

- **Ban risk.** Personal-account calls hit an unofficial API with no built-in rate limiting. Do not add send loops without throttling, and never run live sends while testing.
- **One listener per account.** Zalo allows one web session; WebSocket close code 3000 means another session took over. `listen`, `mcp start`, and `msg history` each open a listener, so do not run them concurrently on one account.
- **Auto-login** runs in the `preAction` hook for every command except `login`, `account`, `help`, `version`, `update`, `oa`, `mcp` (`src/index.ts`). `mcp start` logs in itself and exits with code `78` when the session is missing or expired.
- **Credential files** are plain JSON with mode 0600, not encrypted: `~/.zalo-agent-cli/accounts.json`, `~/.zalo-agent-cli/credentials/cred_<ownId>.json`. OA tokens live separately in `~/.zalo-agent/oa-credentials.json` (expire after about 25 hours; `oa refresh`). MCP config: `~/.zalo-agent-cli/mcp-config.json`.
- **`mcp start --config` is accepted but ignored**; the config is always read from `~/.zalo-agent-cli/mcp-config.json`.
- **HTTP MCP** binds `127.0.0.1` by default and refuses a non-loopback `--host` without `--auth`.
- **Reactions and replies** need the message to be in the MCP buffer, or an explicit `cliMsgId`.
- Every non-`mcp`, non-`update` command checks npm for updates (5 s timeout); non-JSON runs print the disclaimer to stdout. Parse output only with `--json`.
