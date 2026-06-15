---
id: c3-113
c3-seal: cfcf3bedb2491b64112b447dca011594d01eeb693f6bed623f635a6725a1a467
title: listen-runtime
type: component
category: feature
parent: c3-1
goal: Run a long-lived WebSocket listener for personal-account events with auto-reconnect, webhook forwarding, and local capture.
---

## Goal

Run a long-lived WebSocket listener for personal-account events with auto-reconnect, webhook forwarding, and local capture.

## Parent Fit

| Field | Value |
| --- | --- |
| Layer | Feature (13) — long-running runtime, not a short-lived command |
| Numbering | Feature — depends on zalo-client |
| Depends on | zalo-client (getApi, autoLogin, clearSession), shared-utils (output) |
| Consumed by | Users/agents wanting a live event stream or webhook bridge |

## Purpose

Owns `src/commands/listen.js`: subscribes to zca-js's WebSocket listener for messages, friend requests, group events, and reactions. Supports auto-reconnect with re-login on `closed`, webhook forwarding (HTTP POST), per-thread JSONL capture (`--save <dir>`), and auto-accepting friend requests. Blocks until SIGINT. Non-goals: the MCP-buffered model (mcp-server owns that) and one-shot message sends.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Active logged-in account; api.listener available | c3-104 |
| Input | zca-js listener events (live) | c3-104 |
| Shared state | JSONL append per thread when --save dir is set (src/commands/listen.js) | N.A - user path |
| Dependency | autoLogin/clearSession for re-login loop | c3-104 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | A continuous event stream (stdout/webhook/file) | ref-json-output-mode |
| Primary path | start listener -> on event -> output/forward/save (src/commands/listen.js) | ref-json-output-mode |
| Alternate | on closed -> re-login (5s then 30s retry) | c3-104 |
| Failure | SIGINT -> graceful shutdown of the listener | N.A - process signal |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-command-registration | ref | registerListenCommand(program) shape | Must follow | Single command group |
| ref-json-output-mode | ref | Event emission honors --json | Must follow | Stream is parseable |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| listen | OUT | Streams events to stdout | Until SIGINT | src/commands/listen.js |
| --webhook <url> | OUT | POSTs each event to a URL | Fire-and-forget forward | src/commands/listen.js |
| --save <dir> | OUT | Appends JSONL per thread | One file per thread | src/commands/listen.js |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Reconnect loop tight-spins | Removing retry backoff | CPU spin / rate-limit ban | src/commands/listen.js |
| Lost events on reconnect | Not re-subscribing after re-login | Gaps in stream | src/commands/listen.js |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Forwarded/saved event payloads | Contract | Transport (stdout/webhook/file) | src/commands/listen.js |
