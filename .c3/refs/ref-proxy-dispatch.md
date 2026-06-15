---
id: ref-proxy-dispatch
c3-seal: f2e908206ae5ca515e875705017c84c8b4aea442c81f056ee127e97e18348774
title: proxy-dispatch
type: ref
goal: Standardize per-account proxy routing so each Zalo account's traffic is isolated through its own proxy across two different HTTP stacks (zca-js's agent-based client and Node's native `fetch`).
---

## Goal

Standardize per-account proxy routing so each Zalo account's traffic is isolated through its own proxy across two different HTTP stacks (zca-js's agent-based client and Node's native `fetch`).

## Choice

Use two complementary proxy mechanisms wired from the same per-account proxy URL: `HttpsProxyAgent` (from `https-proxy-agent`) for zca-js, and undici's `ProxyAgent` as the dispatcher for Node's native `fetch`. The proxy URL is stored 1:1 with the account in the registry and applied when the client is (re)built on login/switch.

## Why

Multi-account automation needs each account pinned to a stable IP to reduce ban risk, so proxy must be per-account, not global. zca-js accepts an agent, but Node's native `fetch` ignores agents and requires an undici `ProxyAgent` dispatcher instead — discovered and fixed in commit 2b32be8 (`fix(proxy): use undici ProxyAgent dispatcher for Node.js native fetch`). Using only `HttpsProxyAgent` silently bypassed the proxy for native-fetch calls. The chosen pairing covers both code paths from one configured URL. Display always masks the password via `maskProxy`.

## How

```js
// src/core/zalo-client.js — REQUIRED: both stacks fed the same proxy URL
import { HttpsProxyAgent } from "https-proxy-agent";
import { ProxyAgent } from "undici";

const agent = new HttpsProxyAgent(proxyUrl);   // REQUIRED for zca-js
const dispatcher = new ProxyAgent(proxyUrl);   // REQUIRED for native fetch

// src/utils/proxy-helpers.js — REQUIRED: never print raw credentials
export function maskProxy(proxyUrl) {
    if (!proxyUrl) return "none";
    return proxyUrl.replace(/(\/\/[^:]+:)[^@]+(@)/, "$1***$2");
}
```
