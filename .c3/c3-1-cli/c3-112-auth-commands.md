---
id: c3-112
c3-seal: 367b5eb6c92a692e882e10f2c4d16f651a7d08584c24cd7e7515031a5642b6bf
title: auth-commands
type: component
category: feature
parent: c3-1
goal: Provide the login, session, and multi-account management commands for the unofficial Zalo API.
---

## Goal

Provide the login, session, and multi-account management commands for the unofficial Zalo API.

## Parent Fit

| Field | Value |
| --- | --- |
| Layer | Feature (10) — user-facing auth + account lifecycle |
| Numbering | Feature — depends on foundation auth stack |
| Depends on | zalo-client (login), credential-store (save), account-registry, shared-utils (QR) |
| Consumed by | End users + AI agents before any messaging command |

## Purpose

Owns `src/commands/login.js` and `src/commands/account.js`: QR-code and credential-file login, logout (with `--purge`), status/whoami, and the full `account` tree (list, login, switch, remove, info, export). Login displays a QR via terminal and a transient HTTP server, saves credentials, and registers the account. `account switch` reloads one account's credentials and reconnects with that account's proxy. Non-goals: messaging or social actions.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | An account-specific proxy when configured | ref-proxy-dispatch |
| Input | QR scan result or credential JSON file path | c3-104 |
| Shared state | Writes credentials (0600) + accounts.json | rule-secret-file-perms |
| Dependency | zalo-client login + credential-store save | c3-102 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | An active, authenticated account ready for commands | c3-103 |
| Primary path | login -> QR -> saveCredentials -> addAccount -> setActive (src/commands/login.js) | c3-104 |
| Alternate | account switch reloads creds + reconnects via account proxy (src/commands/account.js) | ref-proxy-dispatch |
| Failure | export writes 0600 file + warns against git commit (src/commands/account.js:171-172) | rule-secret-file-perms |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-secret-file-perms | rule | Exported creds + saved sessions are 0600 | Must comply | account export at user path |
| ref-json-output-mode | ref | status/whoami/list emit via output() | Must follow | login path branches on json flag |
| ref-credential-isolation | ref | Per-account keyed storage | Must follow | switch reloads one account |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| login / account login | IN | QR/file login, persists creds + account | Adds to registry | src/commands/login.js |
| account switch <id> | IN/OUT | Activates account, rebuilds api w/ proxy | Partial id/name match | src/commands/account.js |
| account export [id] | OUT | Writes creds JSON 0600 | User-chosen path | src/commands/account.js:171-172 |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Export leaks creds | Removing chmod on export | World-readable secret file | src/commands/account.js:171-172 |
| Switch uses wrong proxy | Not rebuilding api on switch | Traffic on wrong IP | src/utils/proxy-helpers.test.js |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Credential + account writes | Governance | Per-account files | src/commands/account.js |
