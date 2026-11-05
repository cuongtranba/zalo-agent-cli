# zalo-agent-cli

[![npm version](https://img.shields.io/npm/v/zalo-mcp.svg)](https://www.npmjs.com/package/zalo-mcp)
[![license](https://img.shields.io/npm/l/zalo-mcp.svg)](LICENSE)

Zalo automation for scripts and AI agents: a CLI (`zalo-agent`) and an MCP server for personal Zalo accounts, plus a client for the official Zalo Official Account (OA) API.

Published on npm as `zalo-mcp`. Built on [zca-js](https://github.com/RFS-ADRENO/zca-js). Forked from [PhucMPham/zalo-agent-cli](https://github.com/PhucMPham/zalo-agent-cli).

> [!WARNING]
> Personal-account features use the **unofficial** Zalo API (zca-js). Zalo may restrict or ban the account. Not affiliated with Zalo or VNG. See [DISCLAIMER.md](DISCLAIMER.md).

## Install

Requires [Bun](https://bun.sh) >= 1.4.2. Node.js is not supported.

```bash
bun add -g zalo-mcp
zalo-agent --version
```

Standalone binaries (no Bun needed) are attached to each [release](https://github.com/cuongtranba/zalo-agent-cli/releases/latest): `zalo-agent-{linux-x64,linux-arm64,darwin-x64,darwin-arm64,windows-x64.exe}` with `SHA256SUMS`.

## Quick start

```bash
zalo-agent login                              # scan the QR with Zalo app > Scan QR
zalo-agent status                             # check the session
zalo-agent friend search "Name"               # find a user ID
zalo-agent listen                             # print incoming messages with their threadId
zalo-agent msg send <THREAD_ID> "Hello"       # send to a user
zalo-agent msg send <THREAD_ID> "Hello" -t 1  # send to a group
```

Add `--json` to any command for machine-readable output.

## MCP server

Exposes a logged-in personal account to MCP clients (Claude Code, Claude Desktop, other agents).

```bash
zalo-agent login                                                # once, before starting the server
claude mcp add zalo -- zalo-agent mcp start                     # stdio, for a local client
zalo-agent mcp start --http 3847 --auth <token>                 # HTTP at http://127.0.0.1:3847/mcp
zalo-agent mcp start --http 3847 --auth <token> --host 0.0.0.0  # remote access (--auth required)
```

| Tool | Purpose |
|------|---------|
| `zalo_get_messages` | Read buffered incoming messages (cursor `since`) |
| `zalo_mark_read` | Drop buffered messages up to a cursor |
| `zalo_list_threads` | Buffered threads with unread counts |
| `zalo_search_threads` | Find a DM or group by name (accent-insensitive) |
| `zalo_list_conversations` | Recent DMs and groups from the account |
| `zalo_get_history` | Older messages from the server (about 2 weeks) |
| `zalo_send_message` | Send text; optional reply and @mentions |
| `zalo_send_attachment` | Send files or images from paths or URLs (25 MB cap) |
| `zalo_react` | React to a message |
| `zalo_get_group_members` | Group members with admin flags |
| `zalo_get_user_info` | Public profile of a user ID |
| `zalo_view_media` | Open a received image, audio or video file |

Clients can subscribe to the `zalo://inbox` resource to be notified of new messages; cursor polling stays the source of truth. Exit code `78` means the saved session is missing or expired: run `zalo-agent login` again. Config: `~/.zalo-agent-cli/mcp-config.json`. Full guide: [skill/references/mcp-guide.md](skill/references/mcp-guide.md).

## Command groups

Run `zalo-agent <group> --help` for subcommands and flags.

| Group | What it does |
|-------|--------------|
| `login`, `logout`, `status`, `whoami` | QR login and session |
| `account` | Multiple accounts, one proxy per account, export |
| `msg` | Text, images, files, voice, video, stickers, links, contact cards, bank cards, VietQR, reactions, recall, history |
| `friend` | List, search, add, accept, remove, block, aliases |
| `group` | Create, members, admins, settings, links, notes |
| `conv` | Mute, pin, archive, hide, read state, auto-delete |
| `profile` | Profile, avatar, privacy settings |
| `poll`, `reminder`, `auto-reply`, `quick-msg`, `label`, `catalog` | Zalo features of the same name |
| `listen` | Real-time listener; `--webhook <url>`, `--save <dir>` (JSONL), `--filter user\|group\|all` |
| `oa` | Official Account API v3.0: OAuth, messages, followers, tags, articles, store, webhook listener |
| `mcp start` | MCP server (see above) |
| `update` | Update the CLI |

## Official Account (OA)

Uses the official, documented OA API v3.0. It is separate from the personal-account login.

```bash
zalo-agent oa init                                              # interactive setup
zalo-agent oa init --app-id <ID> --secret <KEY> --skip-webhook  # non-interactive
zalo-agent oa msg text <user-id> "Hello"
zalo-agent oa listen -p 3000                                    # webhook listener
```

Guide: [docs/official-account.md](docs/official-account.md).

## Agent skill

[`skill/`](skill/SKILL.md) teaches an agent to drive the CLI. For Claude Code:

```bash
cp -r skill/ ~/.claude/skills/zalo-agent/
```

## Local data

| Path | Content |
|------|---------|
| `~/.zalo-agent-cli/accounts.json`, `~/.zalo-agent-cli/credentials/` | Personal-account sessions (plain JSON, mode 0600) |
| `~/.zalo-agent-cli/mcp-config.json` | MCP server config |
| `~/.zalo-agent-cli/media/` | Media downloaded by the MCP server |
| `~/.zalo-agent/oa-credentials.json` | OA tokens |

Treat these files as secrets.

## Development

```bash
bun install
bun src/index.ts --help   # run from source
bun run check             # typecheck, lint, format check, tests
```

Agent and contributor notes: [AGENTS.md](AGENTS.md), [CONTRIBUTING.md](CONTRIBUTING.md), [TEST.md](TEST.md), [RELEASING.md](RELEASING.md).

## License

[MIT](LICENSE). See [DISCLAIMER.md](DISCLAIMER.md).
