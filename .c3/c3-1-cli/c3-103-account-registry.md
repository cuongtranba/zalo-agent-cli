---
id: c3-103
c3-seal: 9db1b30717a26049dd8a5330b2a9f975487a71e8faf9c7d9c8ab2af552a8c655
title: account-registry
type: component
category: foundation
parent: c3-1
goal: Maintain the multi-account registry that tracks every Zalo account, its 1:1 proxy, and which one is active.
---

## Goal

Maintain the multi-account registry that tracks every Zalo account, its 1:1 proxy, and which one is active.

## Parent Fit

| Field | Value |
| --- | --- |
| Layer | Foundation (03) — account identity + proxy mapping |
| Numbering | Foundation — zalo-client and auth-commands depend on it |
| Depends on | credential-store (CONFIG_DIR, deleteCredentials) |
| Consumed by | zalo-client (getActive), auth-commands, account export |

## Purpose

Owns `src/core/accounts.js`: a JSON registry at `~/.zalo-agent-cli/accounts.json` mapping each account (by owner id) to its proxy and an `active` flag. Exposes list/get/add/remove/setActive. Switching active deactivates others so exactly one account is current. Non-goals: it does not store the actual session credentials (credential-store does) nor build API clients.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | CONFIG_DIR exists / is created on save (src/core/accounts.js:10-13) | ref-credential-isolation |
| Input | account objects {ownId, name, proxy, active} | N.A - in-memory shape |
| Shared state | accounts.json persisted with 0600 (src/core/accounts.js:24-28) | rule-secret-file-perms |
| Dependency | Reuses CONFIG_DIR + deleteCredentials from credential-store | c3-102 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Exactly one active account with its proxy | N.A - getActive() |
| Primary path | add/login -> setActive deactivates others (src/core/accounts.js) | N.A - see auth-commands (feature) |
| Alternate | partial name/id match resolves account on switch | N.A - see auth-commands (feature) |
| Failure | setActive returns false if account not found | ref-json-output-mode |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-credential-isolation | ref | Storage root + per-account keying | Must follow | Shares CONFIG_DIR |
| rule-secret-file-perms | rule | accounts.json written 0600 | Must comply | Holds proxy creds |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| getActive() | OUT | Returns active account or null | One active at a time | src/core/accounts.js:36-38 |
| setActive(id) | IN/OUT | Activates one, deactivates rest | Returns false if missing | src/core/accounts.js |
| addAccount/removeAccount | IN/OUT | Mutate the registry + clean creds | removeAccount calls deleteCredentials | src/core/accounts.js |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Multiple active accounts | setActive not deactivating others | Wrong account used by commands | src/cli.test.js |
| Registry world-readable | Dropping chmod on save | accounts.json leaks proxy creds | src/core/accounts.js:24-28 |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Active-account selection in zalo-client | Contract | Read-only consumption | src/core/zalo-client.js |
