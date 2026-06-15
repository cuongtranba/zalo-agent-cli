---
id: c3-114
c3-seal: 95f49d49917f27f17758cd472d0fe601d28e11733a36c651a0968e4573a30263
title: oa-runtime
type: component
category: feature
parent: c3-1
goal: Provide the Official Account (OA) command tree, setup wizard, and webhook listener over the official Zalo OA API.
---

## Goal

Provide the Official Account (OA) command tree, setup wizard, and webhook listener over the official Zalo OA API.

## Parent Fit

| Field | Value |
| --- | --- |
| Layer | Feature (14) — official-API surface, parallel to the zca-js features |
| Numbering | Feature — depends on oa-client |
| Depends on | oa-client (REST + OAuth + creds), shared-utils (output) |
| Consumed by | OA operators sending official messages + receiving webhooks |

## Purpose

Owns `src/commands/oa.js`, `oa-init.js`, `oa-listen.js`. `oa` registers 30+ subcommands (auth, messaging, followers, tags, media, conversations, menus, articles, store). `oa init` is a setup wizard supporting interactive and headless `--skip-webhook`/`--webhook-url` agent modes, with tunnel launch (ngrok/cloudflared when chosen) and domain verification. `oa listen` runs a plain Node HTTP webhook server that verifies HMAC-SHA256 signatures. Non-goals: the unofficial zca-js stack.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | OA app id/secret + OAuth completed (loadOACreds) | c3-105 |
| Input | CLI args + incoming webhook POSTs | ref-command-registration |
| Shared state | OA creds (tokens, webhookUrl, verifyCode) stored 0600 | rule-secret-file-perms |
| Dependency | oa-client for all REST + token refresh | c3-105 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | OA messages sent / followers + tags managed / webhooks received | ref-json-output-mode |
| Primary path | oa <cmd> -> oa-client REST -> output() (src/commands/oa.js) | ref-json-output-mode |
| Alternate | oa listen long-running HTTP server verifying X-Zevent-Signature (src/commands/oa-listen.js) | N.A - HMAC verify |
| Failure | Invalid signature -> request rejected | N.A - timingSafeEqual |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-secret-file-perms | rule | OA token file is 0600 | Must comply | Tokens persisted by oa-client |
| ref-command-registration | ref | registerOACommands + sub-registrars | Must follow | oa-init/oa-listen attach to oa |
| ref-json-output-mode | ref | Command + webhook output honors --json | Must follow | Agent-friendly |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| oa <subcommand> | IN/OUT | Official OA REST operations | Requires OA creds | src/commands/oa.js |
| oa init | IN/OUT | OAuth + webhook setup wizard | Interactive or agent mode | src/commands/oa-init.js |
| oa listen | OUT | Webhook HTTP server, HMAC-verified | Long-running, --secret | src/commands/oa-listen.js |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Unverified webhook accepted | Skipping signature check | Spoofed events processed | src/commands/oa-listen.js |
| OA token leak | Writing creds without 0600 | tokens world-readable | src/core/oa-client.js:32 |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| OA command handlers | Contract | Per-endpoint wrappers | src/commands/oa.js |
