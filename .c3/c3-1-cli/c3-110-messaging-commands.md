---
id: c3-110
c3-seal: 12d5e985da80ab1dcf6dd94d2b56fcd2a78214db8b3d79e7c3c2322441e13a8a
title: messaging-commands
type: component
category: feature
parent: c3-1
goal: 'Provide the messaging command groups: send/edit messages, quick replies, conversations, polls, reminders, and auto-reply rules.'
---

## Goal

Provide the messaging command groups: send/edit messages, quick replies, conversations, polls, reminders, and auto-reply rules.

## Parent Fit

| Field | Value |
| --- | --- |
| Layer | Feature (11) — core messaging surface |
| Numbering | Feature — depends on zalo-client + shared-utils |
| Depends on | zalo-client (getApi), shared-utils (output, extract-message-text, bank/VietQR) |
| Consumed by | End users + AI agents for day-to-day messaging |

## Purpose

Owns `src/commands/msg.js`, `quick-msg.js`, `conv.js`, `poll.js`, `reminder.js`, `auto-reply.js`. `msg` is the richest group: text (with inline markdown styles), images/files, contact + bank cards, VietQR transfer images, stickers, voice/link/video, reactions, delete/undo/forward, and history via a WebSocket listener. `conv recent` is the thread-discovery command. Others manage quick messages, polls, reminders, and auto-reply rules. Non-goals: friend/group management, OA, or MCP.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Active logged-in account (getApi()) | c3-104 |
| Input | threadId + message/media args from CLI | ref-command-registration |
| Shared state | VietQR temp image generated then unlinked (src/commands/msg.js:295) | rule-secret-file-perms |
| Dependency | extractMessageText for history normalization | c3-106 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | A message/poll/reminder delivered or a rule saved | ref-json-output-mode |
| Primary path | parse args -> api.sendMessage/... -> output() (src/commands/msg.js) | ref-json-output-mode |
| Alternate | msg history opens WS listener, paginates, process.exit (src/commands/msg.js:591) | c3-104 |
| Failure | API error surfaced via output(error) | c3-106 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-json-output-mode | ref | All results via output(data, json, fmt) | Must follow | Used across all groups |
| ref-command-registration | ref | registerXCommands(program) shape | Must follow | One register fn per file |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| msg send/send-* | IN | Sends text/media/cards/VietQR | threadId-scoped | src/commands/msg.js |
| conv recent | OUT | Lists friends + groups for thread discovery | Batches groups 50/call | src/commands/conv.js |
| poll/reminder/auto-reply | IN/OUT | Create/list/update group + account features | Group-scoped for poll | src/commands/poll.js |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| VietQR temp file left on disk | Removing unlink after send | Temp images accumulate | src/utils/bank-helpers.test.js |
| history hangs (no exit) | Removing process.exit on completion | Command never returns | src/commands/msg.js:591 |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Each subcommand result emission | Governance | Per-command formatter | src/commands/msg.js |
