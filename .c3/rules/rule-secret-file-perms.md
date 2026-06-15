---
id: rule-secret-file-perms
c3-seal: 513977519a3196997c4e1d0a8a5ba15e36a50860ba91b2a4eff3efcda70dbad8
title: secret-file-perms
type: rule
goal: Enforce that every file containing Zalo credentials or session secrets is written with owner-only (0600) permissions, project-wide, so secrets are never left group- or world-readable on shared machines.
---

## Goal

Enforce that every file containing Zalo credentials or session secrets is written with owner-only (0600) permissions, project-wide, so secrets are never left group- or world-readable on shared machines.

## Rule

All credential, account, and exported-secret files must be written with mode 0600 (owner read/write only).

## Golden Example

```js
// src/core/credentials.js — canonical pattern
import { writeFileSync, chmodSync } from "fs";

export function saveCredentials(ownId, creds) {
    ensureDirs();
    const target = credPath(ownId);
    writeFileSync(target, JSON.stringify(creds, null, 2), "utf-8"); // REQUIRED: write
    chmodSync(target, 0o600);                                       // REQUIRED: lock to owner
    return target;
}

// src/core/oa-client.js — same standard for OA creds (mode at write time)
fs.writeFileSync(OA_CREDS_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 }); // REQUIRED
```

## Not This

| Anti-Pattern | Correct | Why Wrong Here |
| --- | --- | --- |
| writeFileSync(path, data) with no chmod | Follow with chmodSync(path, 0o600) or pass {mode: 0o600} | Default umask can leave the file readable by group/others — credentials leak |
| chmod only the directory, not the file | chmod the file itself | A 0600 dir does not protect a 0644 file inside it |

## Scope

Applies to any code under `src/` that persists Zalo session cookies, imei, access/refresh tokens, or account exports. Does not apply to non-secret config (e.g. `mcp-config.json`) or downloaded media.

## Override

Only with an ADR documenting why a secret must be more permissive (none currently). Account export (`account export`) already applies 0600 to the user-chosen path and warns against committing it.
