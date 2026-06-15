---
id: c3-104
c3-seal: 2e774fbf2618a54ff1fb45665567d515c9d8b7deb544bd05fe65178545dca881
title: zalo-client
type: component
category: foundation
parent: c3-1
goal: Wrap zca-js as a single live Zalo API instance per process, with login, session, and per-account proxy management.
---

## Goal

Wrap zca-js as a single live Zalo API instance per process, with login, session, and per-account proxy management.

## Parent Fit

| Field | Value |
| --- | --- |
| Layer | Foundation (02) — sole gateway to the unofficial Zalo API |
| Numbering | Foundation — every feature command depends on it |
| Depends on | account-registry (getActive), credential-store (loadCredentials), cli-output |
| Consumed by | All command groups via getApi(); entry-router via autoLogin |

## Purpose

Owns `src/core/zalo-client.js`: constructs one `Zalo` instance, performs QR and credential-file login, extracts credentials after login, and exposes `getApi()` as the single access point every command uses. It binds the account's proxy to both HTTP stacks (`HttpsProxyAgent` for zca-js, undici `ProxyAgent` for native fetch) and reads image metadata for media sends. Non-goals: it does not persist accounts (delegates to account-registry) or format output.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Active account + credentials exist (src/core/zalo-client.js) | ref-credential-isolation |
| Input | imei/cookie/userAgent from credential-store; proxy URL from registry | c3-102 |
| Shared state | Module-level single Zalo API instance, swapped on switch | N.A - in-process singleton |
| Dependency | Proxy applied via two stacks on (re)build | ref-proxy-dispatch |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | A ready api object for all Zalo operations | N.A - getApi() return |
| Primary path | autoLogin -> load creds -> build Zalo w/ proxy -> getApi (src/core/zalo-client.js) | ref-proxy-dispatch |
| Alternate | QR login event triggers QR display + temp HTTP server | N.A - see auth-commands (feature) |
| Failure | Missing/expired session -> autoLogin reports not-logged-in | ref-json-output-mode |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-proxy-dispatch | ref | How per-account proxy is wired to both HTTP stacks | Must follow | Native fetch needs undici dispatcher |
| ref-credential-isolation | ref | Where session credentials are read from | Must follow | Keyed by ownId |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| getApi() | OUT | Returns the live zca-js API instance | Throws/returns null if not logged in | src/core/zalo-client.js |
| autoLogin(jsonMode) | IN/OUT | Restores session before commands | Skipped for login/account/oa/mcp | src/index.js:58-60 |
| extractCredentials() | OUT | Returns {imei,cookie,userAgent} for storage | Caller persists via credential-store | src/core/zalo-client.js |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Proxy bypass on native fetch | Reverting to agent-only proxy | OA/native-fetch calls leak real IP | src/utils/proxy-helpers.test.js |
| Stale singleton after switch | Not rebuilding api on account switch | Commands act on wrong account | src/cli.test.js |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Every command's api usage | Contract | Per-command method calls | src/core/zalo-client.js |
