---
id: c3-102
c3-seal: 5d1e433a79c3223e434eee2d6f387e86793bf1f3b8b833495d980ec835b7830d
title: credential-store
type: component
category: foundation
parent: c3-1
goal: Persist and retrieve per-account zca-js session credentials on disk with owner-only permissions.
---

## Goal

Persist and retrieve per-account zca-js session credentials on disk with owner-only permissions.

## Parent Fit

| Field | Value |
| --- | --- |
| Layer | Foundation (04) — secret storage + config root owner |
| Numbering | Foundation — defines CONFIG_DIR used across the app |
| Depends on | Node fs/os/path only |
| Consumed by | account-registry, zalo-client, mcp-config, media-downloader |

## Purpose

Owns `src/core/credentials.js`: defines `CONFIG_DIR` (`~/.zalo-agent-cli`) and `CREDENTIALS_DIR`, and saves/loads/deletes one credential file per account (`cred_<ownId>.json`) at mode 0600. It is the single source of the config root that other modules import rather than re-deriving `homedir()`. Non-goals: it does not know about active account selection or OA credentials (those live in account-registry and oa-client).

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | CREDENTIALS_DIR created on save (src/core/credentials.js:14-16) | N.A - mkdir recursive |
| Input | ownId + {imei, cookie, userAgent, language?} | N.A - creds shape |
| Shared state | Files under CONFIG_DIR, keyed by ownId | ref-credential-isolation |
| Dependency | None beyond Node fs | N.A - leaf module |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Durable, owner-only credential files | rule-secret-file-perms |
| Primary path | saveCredentials -> writeFileSync -> chmod 0600 (src/core/credentials.js) | rule-secret-file-perms |
| Alternate | loadCredentials returns null when file missing | ref-json-output-mode |
| Failure | Corrupt JSON -> caller treats as not-logged-in | N.A - try/catch in callers |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-secret-file-perms | rule | 0600 on every credential file | Must comply | Canonical golden example lives here |
| ref-credential-isolation | ref | CONFIG_DIR + per-ownId keying | Must follow | This component defines the root |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| CONFIG_DIR / CREDENTIALS_DIR | OUT | Single source of storage root | Imported, never re-derived | src/core/credentials.js:11-12 |
| saveCredentials(ownId, creds) | IN | Writes 0600 file, returns path | One file per account | src/core/credentials.js:27-33 |
| loadCredentials(ownId) | OUT | Returns creds or null | Null = not logged in | src/core/credentials.js |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Credential file readable by others | Dropping chmodSync | secrets leak on shared host | src/core/credentials.js:27-33 |
| Path drift across modules | Re-deriving homedir() elsewhere | Inconsistent storage location | src/mcp/mcp-config.js |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| CONFIG_DIR imports in mcp/media modules | Contract | Subpaths under CONFIG_DIR | src/mcp/media-downloader.js |
