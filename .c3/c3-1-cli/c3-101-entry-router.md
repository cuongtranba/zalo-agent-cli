---
id: c3-101
c3-seal: 10bdfe89a8e3e3959e12558448905c218768af09c836234afe524a154ec145f2
title: entry-router
type: component
category: foundation
parent: c3-1
goal: Register every CLI command group and run shared pre-action concerns for the `zalo-agent` binary.
---

## Goal

Register every CLI command group and run shared pre-action concerns for the `zalo-agent` binary.

## Parent Fit

| Field | Value |
| --- | --- |
| Layer | Foundation — process entry point, composes all other components |
| Numbering | Foundation (01) — everything else loads through here |
| Depends on | zalo-client (autoLogin), cli-output (warning/success), update-check |
| Consumed by | The zalo-agent executable (bin in package.json) |

## Purpose

Owns `src/index.js`: builds the root Commander `program`, declares the global `--json` flag, and registers all sixteen command groups via their `registerXCommands(program)` functions. Its `preAction` hook centralizes cross-cutting behavior so individual commands stay focused: it sets `ZALO_JSON_MODE` for clean piping, prints the unofficial-API disclaimer (except for `oa`/`mcp`/json runs), triggers `autoLogin` for commands that need a session, and fires a non-blocking update check. Non-goals: it contains no Zalo business logic and performs no direct API calls.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Node >= 20, ESM; package.json read for version (src/index.js:8-15) | N.A - source in Detail |
| Input | process.argv parsed by Commander (src/index.js:95) | ref-command-registration |
| Shared state | program.opts().json global flag + ZALO_JSON_MODE env (src/index.js:44-50) | ref-json-output-mode |
| Dependency | autoLogin invoked in preAction (src/index.js:31,58-60) | c3-1 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | A wired CLI dispatching to the right command group (src/index.js:78-95) | ref-command-registration |
| Primary path | Parse args -> preAction hook -> command action (src/index.js:45-65) | N.A - source in Detail |
| Alternate | mcp/json mode suppress disclaimer + zca-js logs (src/index.js:48-55) | rule-mcp-stdout-reserved |
| Failure | Unknown command -> Commander prints help/error | N.A - commander default |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-command-registration | ref | How each group plugs into the root program | Must follow | Entry point is the composition site |
| ref-json-output-mode | ref | Global --json flag semantics | Must follow | Flag declared here, consumed everywhere |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| program Commander instance | OUT | Passed to every registerXCommands | Each group attaches its own subcommands | src/index.js:78-93 |
| --json global option | OUT | Available to all commands via program.opts() | Boolean, default false | src/index.js:44 |
| preAction hook | IN/OUT | Runs autoLogin + disclaimer before actions | Skipped for login/account/oa/mcp/help | src/index.js:45-65 |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| New command not registered | Adding a command file without wiring it | Command missing at runtime | src/cli.test.js (npm test) |
| Disclaimer/json regression | Editing preAction logic | Disclaimer prints in json/mcp mode | src/cli.test.js |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Each command group registration call | Contract | New groups appended in order | src/index.js:78-93 |
