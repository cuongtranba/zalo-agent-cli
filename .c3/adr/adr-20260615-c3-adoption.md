---
id: adr-00000000-c3-adoption
c3-seal: a19f3d7be20c2ac67bc9674985c717c677b0964188819d7993adf722e0d8d4b7
title: C3 Architecture Documentation Adoption
type: adr
goal: 'Adopt C3 architecture documentation for zalo-agent-cli: establish the canonical topology (one container, twelve components, four refs, two rules) in `.c3/` so that future changes are governed by documented contracts, refs, and rules rather than tribal knowledge.'
status: implemented
date: "2026-06-15"
affects:
    - c3-0
---

## Goal

Adopt C3 architecture documentation for zalo-agent-cli: establish the canonical topology (one container, twelve components, four refs, two rules) in `.c3/` so that future changes are governed by documented contracts, refs, and rules rather than tribal knowledge.

## Context

zalo-agent-cli is a single Node.js (ESM) CLI binary (`zalo-agent`) with ~40 source files spanning three distinct API surfaces (unofficial zca-js, official OA REST v3.0, MCP protocol) and three runtime modes (short-lived commands, long-running webhook/WS listeners, MCP daemon). Before adoption there were no machine-checkable architecture docs: cross-cutting conventions (dual-mode `--json` output, per-account proxy dispatch, 0600 credential storage, MCP stdout discipline) lived only in code and review feedback. This created drift risk — e.g. the proxy bug fixed in commit 2b32be8 (native fetch silently bypassing the proxy) is exactly the class of regression a documented ref + rule guards against. The affected topology is the whole `src/` tree.

## Decision

Model the system as ONE container `c3-1` (the single deployable `zalo-agent` binary) decomposed into six foundation components (entry-router, credential-store, account-registry, zalo-client, oa-client, shared-utils) and six feature components (auth-commands, messaging-commands, social-commands, listen-runtime, oa-runtime, mcp-server). Extract four cross-cutting refs (json-output-mode, command-registration, proxy-dispatch, credential-isolation) and two enforceable rules (secret-file-perms, mcp-stdout-reserved). Layering (foundation vs feature) is expressed via component numbering rather than additional containers, because there is exactly one deployable artifact — multiple containers would misrepresent the runtime boundary.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-0 | system | Root context created and given project goal | Confirm goal matches package.json description |
| c3-1 | container | New container modeling the single binary | Components + Responsibilities reviewed |
| c3-101 | component | entry-router documented (index.js) | Cites ref-command-registration, ref-json-output-mode |
| c3-102 | component | credential-store documented (credentials.js) | Cites rule-secret-file-perms, ref-credential-isolation |
| c3-103 | component | account-registry documented (accounts.js) | Cites rule-secret-file-perms, ref-credential-isolation |
| c3-104 | component | zalo-client documented (zalo-client.js) | Cites ref-proxy-dispatch, ref-credential-isolation |
| c3-105 | component | oa-client documented (oa-client.js) | Cites rule-secret-file-perms, ref-credential-isolation |
| c3-106 | component | shared-utils documented (utils/**) | Owns ref-json-output-mode pattern |
| c3-110 | component | messaging-commands documented | Cites ref-json-output-mode, ref-command-registration |
| c3-111 | component | social-commands documented | Cites ref-json-output-mode, ref-command-registration |
| c3-112 | component | auth-commands documented | Cites rule-secret-file-perms, ref-credential-isolation |
| c3-113 | component | listen-runtime documented | Cites ref-command-registration, ref-json-output-mode |
| c3-114 | component | oa-runtime documented | Cites rule-secret-file-perms, ref-command-registration |
| c3-115 | component | mcp-server documented (mcp.js + mcp/**) | Cites rule-mcp-stdout-reserved, ref-credential-isolation |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-json-output-mode | Dual-mode output is used by ~17 command files; adoption must capture the canonical output() pattern | create-ref |
| ref-command-registration | All 16 command groups follow registerXCommands(program); adoption documents the composition convention | create-ref |
| ref-proxy-dispatch | Per-account proxy must reach both zca-js and native fetch (commit 2b32be8); adoption records the rationale | create-ref |
| ref-credential-isolation | Multi-account + OA secrets share CONFIG_DIR with per-account keying; adoption documents storage layout | create-ref |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-secret-file-perms | Credential/account/export files must be 0600 to avoid leaking secrets on shared hosts | create-rule |
| rule-mcp-stdout-reserved | MCP stdio path must keep stdout for JSON-RPC; a stray console.log corrupts the client stream | create-rule |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Scaffold | c3x init created c3-0 + adoption ADR | .c3/ exists |
| Container | c3x add container cli | c3-1 |
| Foundation components | Created c3-101..c3-106 from src/core + src/index.js + src/utils | c3x list |
| Feature components | Created c3-110..c3-115 from src/commands + src/mcp | c3x list |
| Refs + rules | Created 4 refs + 2 rules with golden examples | c3x list |
| Codemap | c3x set <id> codemap for every component + concrete refs/rules | c3x lookup src/core/zalo-client.js |
| CLAUDE.md | Inject C3 usage section | grep "C3 docs" CLAUDE.md |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| C3 CLI / validators | N.A - adoption documents an existing codebase; no c3x tool, validator, schema, or help surface was modified | c3x check passes with stock CLI |
| C3 templates / tests | N.A - no template or test of the c3x underlay was changed by this ADR | c3x check |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| c3x check | Validates refs cited, no orphans, schema completeness | c3x check returns no issues |
| c3x lookup | Maps any src file to owning component + refs/rules | c3x lookup src/mcp/mcp-server.js -> c3-115, rule-mcp-stdout-reserved |
| rule-secret-file-perms golden | Reviewers check chmod 0600 on credential writes | src/core/credentials.js:27-33 |
| rule-mcp-stdout-reserved golden | Reviewers reject console.log in mcp stdio path | src/mcp/mcp-server.js |
| npm test | Existing unit tests guard utils + mcp behavior | src/cli.test.js, src/mcp/*.test.js |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Multiple containers (cli / oa / mcp) | All three ship as one npm binary with one deploy unit; separate containers would misrepresent the runtime boundary. Layering is captured via foundation/feature numbering instead |
| One component per command file (~16) | Too fine-grained: command groups already cluster by domain, and per-file components would bury the shared refs in noise |
| Single coarse component for all of src/ | Too coarse: hides the three API surfaces and the foundation/feature dependency direction that the refs/rules govern |
| Skip refs/rules, document components only | Loses the machine-checkable cross-cutting constraints (json mode, proxy, 0600, mcp stdout) that are the main drift risks |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Docs drift from code over time | codemap globs + c3x check catch unmapped/renamed files | c3x check; c3x lookup 'src/**' |
| Refs/rules become stale advice | Golden examples cite real file:line so reviewers can diff | c3x read rule-secret-file-perms |
| Component bodies inaccurate | Bodies derived from source reads + tests, not assumed | c3x check passes; spot-read c3-115 |
| README lists 4 MCP tools but code has 7 | Documented accurately in c3-115 (7 tools); README is a separate follow-up | c3x read c3-115 |

## Verification

| Check | Result |
| --- | --- |
| c3x check | No issues across 21 entities |
| c3x list | 1 container, 12 components, 4 refs, 2 rules, all active |
| c3x lookup src/core/zalo-client.js | Maps to c3-104 |
| c3x lookup 'src/mcp/**' | Maps every mcp file to c3-115 |
| grep "C3 docs" CLAUDE.md | C3 usage section present |
