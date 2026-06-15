---
id: ref-credential-isolation
c3-seal: 714b819c4dffe2937d0a7dbf4b1eb70bc3e45ba8943866e83c0764c527811a7a
title: credential-isolation
type: ref
goal: Standardize where and how account secrets live on disk so multiple Zalo accounts (and the separate Official Account API) can coexist without cross-contamination and without leaking credentials into the repo or world-readable files.
---

## Goal

Standardize where and how account secrets live on disk so multiple Zalo accounts (and the separate Official Account API) can coexist without cross-contamination and without leaking credentials into the repo or world-readable files.

## Choice

All state lives under a single per-user config root `~/.zalo-agent-cli/` (`CONFIG_DIR`, defined once in `src/core/credentials.js`). Per-account zca-js credentials are stored one file per account keyed by owner id (`credentials/cred_<ownId>.json`); the active-account registry is `accounts.json`; OA credentials are a separate keyed map. Modules never hardcode the home path — they import `CONFIG_DIR`.

## Why

Multi-account isolation requires each account's cookie/imei to be addressable independently so account switch can reload exactly one account's session; a single shared credentials blob would force rewrites and risk mixing sessions. The unofficial (zca-js) and official (OA) credentials have different shapes and lifecycles, so they are stored separately rather than merged. Centralizing the root in `CONFIG_DIR` means `mcp-config.js`, `media-downloader.js`, `accounts.js`, and `credentials.js` all agree on location without duplication. (Enforcement of file permissions is split out into rule-secret-file-perms.)

## How

```js
// src/core/credentials.js — REQUIRED: single source of the config root
import { homedir } from "os";
import { join } from "path";
export const CONFIG_DIR = join(homedir(), ".zalo-agent-cli");
export const CREDENTIALS_DIR = join(CONFIG_DIR, "credentials");

function credPath(ownId) {
    return join(CREDENTIALS_DIR, `cred_${ownId}.json`); // REQUIRED: keyed by ownId
}

// Other modules REQUIRED to import CONFIG_DIR, never re-derive homedir()
import { CONFIG_DIR } from "../core/credentials.js";
```
