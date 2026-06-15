---
id: c3-111
c3-seal: 1186349652e5de07f9c579a4337ccf082a8247931523eaff266670be799a031d
title: social-commands
type: component
category: feature
parent: c3-1
goal: 'Provide social and catalog management commands: friends, groups, labels, business catalog, and own-profile.'
---

## Goal

Provide social and catalog management commands: friends, groups, labels, business catalog, and own-profile.

## Parent Fit

| Field | Value |
| --- | --- |
| Layer | Feature (12) — relationship + storefront management |
| Numbering | Feature — depends on zalo-client + shared-utils |
| Depends on | zalo-client (getApi), shared-utils (output) |
| Consumed by | End users + AI agents managing contacts and groups |

## Purpose

Owns `src/commands/friend.js`, `group.js`, `label.js`, `catalog.js`, `profile.js`. `friend` covers the full request lifecycle (add/accept/reject/remove/block, find by phone/username, aliases). `group` is the largest group (membership, admins, settings, invite links, notes, community upgrade, disperse). `label` updates conversation labels via JSON; `catalog` manages a business catalog + products + photo upload; `profile` manages own account profile, avatar gallery, and privacy settings. Non-goals: messaging delivery, OA, MCP.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Active logged-in account (getApi()) | c3-104 |
| Input | user/group ids, names, JSON payloads, local image paths | ref-command-registration |
| Shared state | group avatar / catalog photo resolved to absolute path then uploaded | N.A - transient upload |
| Dependency | output() for human/JSON results | c3-106 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | A relationship change, group mutation, label, or catalog item | ref-json-output-mode |
| Primary path | parse args -> api call -> output() (src/commands/friend.js) | ref-json-output-mode |
| Alternate | client-side filtering: group list --query strips Vietnamese accents (src/commands/group.js:55-67) | N.A - NFD normalize |
| Failure | Zalo numeric error codes mapped to messages (src/commands/friend.js:9-12) | c3-106 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-json-output-mode | ref | All results via output() | Must follow | Across all five files |
| ref-command-registration | ref | registerXCommands(program) shape | Must follow | One register fn per file |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| friend * | IN/OUT | Full friend-request lifecycle + lookup | userId-scoped | src/commands/friend.js |
| group * | IN/OUT | Membership, admin, settings, links, notes | groupId-scoped | src/commands/group.js |
| catalog * / profile * | IN/OUT | Catalog/products + own profile/privacy | upload via local file | src/commands/catalog.js |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Accent search breaks | Editing NFD normalization | group list --query misses matches | src/commands/group.js:55-67 |
| Irreversible disperse | group disperse without confirmation | Group permanently lost | src/commands/group.js |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Each subcommand result emission | Governance | Per-command formatter | src/commands/friend.js |
