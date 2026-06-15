---
id: ref-json-output-mode
c3-seal: de4cdb715b265fa762caaf66517057c0c7a845358fc890211c2977538660e673
title: json-output-mode
type: ref
goal: Standardize how every command emits results so the same binary serves both terminal humans and AI agents / shell pipelines without per-command branching logic.
---

## Goal

Standardize how every command emits results so the same binary serves both terminal humans and AI agents / shell pipelines without per-command branching logic.

## Choice

A single `output(data, jsonMode, humanFormatter)` helper in `src/utils/output.js`, driven by one global `--json` flag declared on the root program. When `jsonMode` is true it prints `JSON.stringify(data, null, 2)`; otherwise it calls the command's `humanFormatter` (colored via `chalk`). Commands pass `program.opts().json` as `jsonMode`.

## Why

The CLI is explicitly built for AI-agent consumption (MCP, skills) as well as humans, so machine-readable output is a first-class requirement, not an afterthought. Centralizing the dual-mode decision in one helper keeps ~17 command files from each reimplementing a `if (json) console.log(JSON...) else printPretty()` branch, and guarantees that adding `--json` support to a new command is automatic rather than opt-in. The alternative — per-command formatting — drifts: some commands would forget json mode and break piping.

## How

```js
// src/utils/output.js — REQUIRED shape
export function output(data, jsonMode, humanFormatter) {
    if (jsonMode) {
        console.log(JSON.stringify(data, null, 2)); // REQUIRED: pretty JSON to stdout
    } else if (humanFormatter) {
        humanFormatter(data);                        // OPTIONAL: colored human view
    } else {
        console.log(JSON.stringify(data, null, 2));  // REQUIRED: JSON fallback
    }
}

// In any command action:
output(result, program.opts().json, (d) => {
    success(`Sent to ${d.threadId}`);
});
```
