---
id: c3-105
c3-seal: ae0947c9c2d02b73bb90bfdc5ddad795399a836f205f8e893710e965822e5657
title: oa-client
type: component
category: foundation
parent: c3-1
goal: Provide a REST client for the official Zalo Official Account API v3.0, independent of zca-js.
---

## Goal

Provide a REST client for the official Zalo Official Account API v3.0, independent of zca-js.

## Parent Fit

| Field | Value |
| --- | --- |
| Layer | Foundation (05) — official-API gateway, parallel to zalo-client |
| Numbering | Foundation — oa-runtime depends on it |
| Depends on | node-fetch, Node fs/os/path |
| Consumed by | oa-runtime (oa.js, oa-init.js, oa-listen.js) |

## Purpose

Owns `src/core/oa-client.js`: wraps the official OA OAuth flow (`oauth.zaloapp.com`) and v3.0/v2.0 REST endpoints (`openapi.zalo.me`) using `node-fetch`. Stores OA credentials (access/refresh tokens, app id/secret, webhook config) in a keyed map at `~/.zalo-agent` / `~/.zalo-agent-cli` OA creds file with restricted permissions. Non-goals: no dependency on the unofficial zca-js stack; no CLI command definitions (oa-runtime owns those).

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | OA app id/secret obtained from Zalo developer console | N.A - external setup |
| Input | OAuth code -> access/refresh token exchange (src/core/oa-client.js) | N.A - TOKEN_URL flow |
| Shared state | OA creds map keyed by oaId, persisted with mode 0600 (src/core/oa-client.js:32) | rule-secret-file-perms |
| Dependency | node-fetch for all HTTP; honors proxy via dispatcher pattern | ref-proxy-dispatch |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Authenticated OA REST calls (send msg, followers, tags) | N.A - V3_BASE calls |
| Primary path | loadOACreds -> attach access_token -> fetch v3.0 endpoint | ref-json-output-mode |
| Alternate | refresh token flow when access token expired | N.A - TOKEN_URL |
| Failure | API error JSON surfaced to caller for output | ref-json-output-mode |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-secret-file-perms | rule | OA creds file written 0600 | Must comply | Holds access/refresh tokens |
| ref-credential-isolation | ref | Separate OA cred store from zca-js creds | Should follow | Different shape + lifecycle |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| saveOACreds(data, oaId) | IN | Merges + writes 0600 OA creds | Keyed by oaId | src/core/oa-client.js:26-34 |
| loadOACreds(oaId) | OUT | Returns stored OA creds | Null when absent | src/core/oa-client.js |
| OA REST wrappers | OUT | Typed calls to openapi.zalo.me v3.0/v2.0 | Official API only | src/core/oa-client.js:13-14 |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| OA token file world-readable | Writing without mode 0600 | tokens leak | src/core/oa-client.js:32 |
| Mixing OA + zca-js creds | Storing OA token in zca-js cred file | wrong API auth | src/core/credentials.js |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| oa-runtime command handlers | Contract | Per-endpoint wrappers | src/commands/oa.js |
