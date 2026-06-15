---
id: ref-command-registration
c3-seal: 321313a934445637f8b0b760c1465463eae798bc96d407b82660c2d05e3a1f9d
title: command-registration
type: ref
goal: Standardize how command groups are defined and attached to the CLI so the root entry point stays a flat, declarative composition list and new feature areas can be added without touching unrelated code.
---

## Goal

Standardize how command groups are defined and attached to the CLI so the root entry point stays a flat, declarative composition list and new feature areas can be added without touching unrelated code.

## Choice

Each command-group module exports exactly one `registerXCommands(program)` function (e.g. `registerMsgCommands`, `registerOACommands`) that attaches its subcommands to the passed Commander `program`. `src/index.js` imports each register function and calls them in sequence; no command-group module touches the global program except through its register function.

## Why

Commander has no built-in module system, so without a convention the entry point would either become a monolith or grow ad-hoc wiring per file. A uniform `registerXCommands(program)` signature makes the entry point a readable manifest of capabilities, lets each domain own its subcommands and options, and makes registration order explicit (which matters because the `preAction` hook keys behavior off the first arg). The alternative — exporting raw `Command` objects or mutating a shared singleton on import — hides ordering and creates import-time side effects.

## How

```js
// src/commands/msg.js — REQUIRED: one exported register fn per group
export function registerMsgCommands(program) {
    const msg = program.command("msg").description("Messaging commands");
    msg.command("send <threadId> <message>")
        .action(async (threadId, message, opts) => { /* ... */ });
    // ... more subcommands
}

// src/index.js — REQUIRED: import + call, one line per group
import { registerMsgCommands } from "./commands/msg.js";
registerMsgCommands(program);
```
