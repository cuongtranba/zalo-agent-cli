---
id: c3-106
c3-seal: 3cb51acd373308c2d0e5859b355de8b83fc28d360df48ea181a32ff55b51bf15
title: shared-utils
type: component
category: foundation
parent: c3-1
goal: 'Provide cross-cutting helpers shared by all commands: output formatting, proxy masking, QR display, bank/VietQR, message-text extraction, and update checks.'
---

## Goal

Provide cross-cutting helpers shared by all commands: output formatting, proxy masking, QR display, bank/VietQR, message-text extraction, and update checks.

## Parent Fit

| Field | Value |
| --- | --- |
| Layer | Foundation (06) — leaf utilities with no business logic |
| Numbering | Foundation — imported widely by features |
| Depends on | chalk; otherwise Node stdlib |
| Consumed by | Every command group and the mcp/oa runtimes |

## Purpose

Owns `src/utils/**`: `output.js` (dual-mode `output()` + colored `success/error/info/warning`), `proxy-helpers.js` (`maskProxy`), `qr-display.js` + `qr-http-server.js` (login QR), `bank-helpers.js` (BIN resolution + VietQR image generation), `extract-message-text.js` (normalize Zalo message payloads to text), and `update-check.js` (self-update). Each is a small, independently testable helper. Non-goals: no Zalo API calls and no persisted state.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | None — pure helpers, called on demand | N.A - leaf modules |
| Input | Command-supplied data (results, proxy URLs, message objects) | N.A - varies per helper |
| Shared state | None (stateless functions); QR server binds a temp port | N.A - stateless |
| Dependency | chalk for color; bank-helpers generates temp QR image files | rule-secret-file-perms |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Consistent human/JSON output + reusable helpers | ref-json-output-mode |
| Primary path | command -> output(data, json, fmt) -> stdout (src/utils/output.js) | ref-json-output-mode |
| Alternate | maskProxy hides passwords before any display (src/utils/proxy-helpers.js) | ref-proxy-dispatch |
| Failure | Helpers return safe defaults (maskProxy -> "none") | N.A - defensive defaults |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-json-output-mode | ref | output() is the canonical implementation | Owns pattern | Golden code lives in output.js |
| ref-proxy-dispatch | ref | maskProxy display convention | Must follow | Never print raw proxy creds |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| output(data, jsonMode, fmt) | OUT | Dual-mode result emission | stdout only | src/utils/output.js:8-16 |
| maskProxy(url) | OUT | Returns password-masked URL | "none" when null | src/utils/proxy-helpers.js |
| extractMessageText(msg) | OUT | Normalizes Zalo payload to text | Used by msg + mcp | src/utils/extract-message-text.js |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Output regression breaks piping | Changing output() shape | AI agents fail to parse JSON | src/cli.test.js |
| Text extraction loses message types | Editing extractMessageText | Empty/garbled text in msg/mcp | src/mcp/message-buffer.test.js |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Every command's result emission | Contract | Per-command humanFormatter | src/utils/output.js |
