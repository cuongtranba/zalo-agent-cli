# Zalo MCP Server Guide

The Model Context Protocol (MCP) lets Claude Code and other MCP clients/agents work with Zalo directly through 12 tools: read and send messages, send files, add reactions, and look up conversations, groups, and users.

---

## Quick start

### stdio mode (local — Claude Code)

```bash
zalo-agent mcp start
```

Add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "zalo": {
      "command": "zalo-agent",
      "args": ["mcp", "start"]
    }
  }
}
```

### HTTP mode (VPS — remote)

```bash
zalo-agent mcp start --http 3847 --auth your-secret
```

The MCP endpoint is `http://<host>:<port>/mcp`. Add to your MCP client config:

```json
{
  "mcpServers": {
    "zalo": {
      "url": "http://your-vps:3847/mcp",
      "headers": { "Authorization": "Bearer your-secret" }
    }
  }
}
```

---

## Integrating an agent over HTTP

### Start the server

```bash
zalo-agent mcp start --http 3847 --auth <token>                 # listens on 127.0.0.1 only
zalo-agent mcp start --http 3847 --auth <token> --host 0.0.0.0  # exposed to the network
```

- By default the server binds only `127.0.0.1`. Use `--host 0.0.0.0` so agents on other machines can connect.
- If you bind to a non-loopback address (anything other than `127.0.0.1`, `::1`, `localhost`) **without `--auth`**, the server refuses to start.
- Every request to `/mcp` must carry the header `Authorization: Bearer <token>`; a missing or wrong token gets `401`.
- `GET /health` needs no token and returns `{ "status": "ok", "uptime": ..., "threads": ..., "sessions": ... }` for health checks.
- The server is session-based: a `POST /mcp` with an `initialize` request creates a session and returns the `mcp-session-id` header. Every later request (`POST`, `GET` to open the SSE notification stream, `DELETE` to end the session) must send this header back, otherwise it gets `400`; an unknown session gets `404`. Standard MCP clients (SDKs) handle this automatically. All sessions share one buffer and always use the current Zalo session (including after an automatic re-login). A session with no open request (including the `GET` stream) for longer than `limits.sessionIdleTimeout` (default 30 minutes) is closed; the client then gets `404` and only needs to `initialize` again (standard SDKs do this on reconnect).
- Put an HTTPS reverse proxy (nginx, Caddy) in front when exposing the server to the Internet.

### Run in the background with pm2

```bash
pm2 start zalo-agent --interpreter bun --name zalo-mcp --stop-exit-codes 78 -- mcp start --http 3847 --auth <token>
```

- Exit code `78` means the Zalo session has expired or is missing: the server prints one error line and stops for good instead of restarting in a loop.
- Fix: run `zalo-agent login`, then `pm2 restart zalo-mcp`.
- Transient network errors still exit with code `1`, so pm2 retries automatically.

### JavaScript client example

```js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(new URL("http://your-vps:3847/mcp"), {
    requestInit: { headers: { Authorization: "Bearer your-secret" } },
});
const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(tools.map((t) => t.name));

// Read new messages
const res = await client.callTool({ name: "zalo_get_messages", arguments: { limit: 20 } });
const { messages, cursor } = JSON.parse(res.content[0].text);

// Reply to the first message (threadType: 0 = DM, 1 = group)
const m = messages[0];
await client.callTool({
    name: "zalo_send_message",
    arguments: {
        threadId: m.threadId,
        threadType: m.threadType === "group" ? 1 : 0,
        text: "Received!",
        replyToMessageId: m.id,
    },
});

// Mark as read
await client.callTool({ name: "zalo_mark_read", arguments: { cursor } });
await client.close();
```

Each tool result is a single `text` block containing JSON; on failure `isError` is `true` and the text starts with `Error:`.

### Integration notes

- **Reply and react only work for messages received while the server is running** (still in the buffer). Older messages fetched via `zalo_get_history` cannot be quoted; for `zalo_react` also pass `cliMsgId` if you know it.
- **Sources for `zalo_send_attachment`** are absolute paths **on the machine running the server** or `http(s)` URLs. The server downloads URLs to a temp directory (max 25 MB, 30 s timeout) and deletes them after sending.
- The buffer is in memory: restarting the server loses unread messages.

---

## Push notifications (resource `zalo://inbox`)

The server supports standard MCP subscriptions (`resources/subscribe`) on both stdio and HTTP:

- Resource `zalo://inbox` (`application/json`): reads as `{ messages, cursor, hasMore }`, the same shape as `zalo_get_messages` (the **newest** messages not yet cleared with `zalo_mark_read`, up to `limits.inboxWindow`, default 50, ordered oldest to newest; `cursor` is the cursor of the newest message). If more messages than this window arrive between two reads, the excess is missed, so raise `limits.inboxWindow`. `hasMore: true` means older messages exist outside the window — read them with `zalo_get_messages` (paginate forward with `since`).
- The client calls `resources/subscribe` with `{ "uri": "zalo://inbox" }`. Whenever a new message enters the buffer, the server sends `notifications/resources/updated` with that `uri` (without message content).
- On notification, the client re-reads `zalo://inbox` or calls `zalo_get_messages` with `since` set to the last processed cursor.
- Notifications are **best-effort** per the MCP spec (they can be lost on disconnect or coalesced): always keep cursor-based polling as the source of truth.
- Over HTTP, notifications travel through the SSE stream of `GET /mcp` in the open session; the client must keep the `mcp-session-id`.
- Many hosts (such as Claude Code) only re-read the resource on notification and do **not** wake the model by themselves; for an agent to react immediately, use a client that handles notifications itself and then calls tools.

```js
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

client.setNotificationHandler(ResourceUpdatedNotificationSchema, async () => {
    const res = await client.callTool({ name: "zalo_get_messages", arguments: { since: lastCursor } });
    // handle new messages, update lastCursor
});
await client.subscribeResource({ uri: "zalo://inbox" });
```

---

## Tools reference

`threadType`: `0` or `"dm"` = DM (default), `1` or `"group"` = group. The `threadType` of buffered messages (`dm`/`group`) can be passed straight to the send/react/history tools.

### `zalo_get_messages`
Get messages from the buffer; supports a cursor for incremental reads.

| Name | Type | Description |
|------|------|-------------|
| `threadId` | string (optional) | Read a single thread only. Omit to read all watched threads |
| `since` | number (default 0) | Cursor from the previous read — returns only newer messages |
| `limit` | number 1–100 (default `limits.maxMessagesPerPoll`) | Max messages |

Result: `{ messages, cursor, hasMore }`. Each message has `id`, `cliMsgId`, `threadId`, `threadType` (`dm`/`group`), `senderId`, `senderName`, `text`, `timestamp`, `ts`, `type`, `attachment`, `replyTo` (`{ msgId, ownerId, text }` or `null`), `threadName`.

---

### `zalo_get_history`
Fetch older messages from the Zalo server (up to ~2 weeks), unlike the buffer used by `zalo_get_messages`.

| Name | Type | Description |
|------|------|-------------|
| `threadId` | string | Thread to fetch |
| `threadType` | `0` \| `1` \| `"dm"` \| `"group"` | 0 / `"dm"` = DM (default), 1 / `"group"` = group |
| `limit` | number 1–200 (default 50) | Max messages |
| `lastMsgId` | string (optional) | Pagination cursor from the previous call |

Result: `{ threadId, threadType, count, messages, cursor, hasMore }`.

---

### `zalo_send_message`
Send a text message; can reply to (quote) a message or mention users.

| Name | Type | Description |
|------|------|-------------|
| `threadId` | string | User or group ID |
| `text` | string | Message text |
| `threadType` | `0` \| `1` \| `"dm"` \| `"group"` | 0 / `"dm"` = DM (default), 1 / `"group"` = group |
| `replyToMessageId` | string (optional) | `id` of a buffered message to quote |
| `mentions` | array (optional) | `[{ userId, pos, len }]` — `pos`/`len` are the offset and length of the `@Name` span inside `text` |

Result: `{ "success": true, "messageId": "...", "sentAt": 1700000000000 }` (`sentAt` = epoch ms when the send completed). If `replyToMessageId` is no longer in the buffer, the tool returns an error.

---

### `zalo_send_attachment`
Send one or more images/files.

| Name | Type | Description |
|------|------|-------------|
| `threadId` | string | User or group ID |
| `threadType` | `0` \| `1` \| `"dm"` \| `"group"` | 0 / `"dm"` = DM (default), 1 / `"group"` = group |
| `sources` | string[] (1–10) | Absolute paths on the machine running the server, or `http(s)` URLs |
| `caption` | string (optional) | Accompanying text |

Result: `{ "success": true, "messageId": ..., "attachmentIds": [...], "sentAt": 1700000000000 }` (`sentAt` = epoch ms when the send completed).

---

### `zalo_react`
Add a reaction to a message.

| Name | Type | Description |
|------|------|-------------|
| `messageId` | string | `id` of the message to react to |
| `threadId` | string | Thread containing the message |
| `threadType` | `0` \| `1` \| `"dm"` \| `"group"` | 0 / `"dm"` = DM (default), 1 / `"group"` = group |
| `reaction` | enum | `heart`, `like`, `haha`, `wow`, `cry`, `angry` |
| `cliMsgId` | string (optional) | Only needed when the message is no longer in the buffer |

Result: `{ "success": true }`.

---

### `zalo_list_threads`
List threads that currently have messages in the buffer, with unread counts.

| Name | Type | Description |
|------|------|-------------|
| `type` | enum | `dm`, `group` or `all` (default) |

Result: `{ threads: [{ threadId, unread, total, lastActivity, threadType, name }], total }`.

---

### `zalo_search_threads`
Search threads (groups/DMs) by name; fuzzy and Vietnamese-accent-insensitive.

| Name | Type | Description |
|------|------|-------------|
| `query` | string | Search keyword |
| `type` | enum | `dm`, `group` or `all` (default) |
| `limit` | number 1–50 (default 10) | Max results |

Result: `{ results, total }`.

---

### `zalo_list_conversations`
List the Zalo account's own conversations (not just buffered threads): recent DMs ordered by last interaction, and groups.

| Name | Type | Description |
|------|------|-------------|
| `type` | enum | `dm`, `group` or `all` (default) |
| `limit` | number 1–200 (default 50) | Max results per type |

Result: `{ conversations: [{ threadId, name, threadType, lastActionTime | memberCount }], total }`.

---

### `zalo_get_group_members`
List the members of a group.

| Name | Type | Description |
|------|------|-------------|
| `groupId` | string | Group ID |
| `limit` | number 1–500 (default 200) | Max members |

Result: `{ groupId, name, total, members: [{ userId, name, isAdmin, isCreator }] }`.

---

### `zalo_get_user_info`
Look up a user's public profile (does not return phone numbers).

| Name | Type | Description |
|------|------|-------------|
| `userId` | string | User ID, e.g. a message's `senderId` |

Result: `{ userId, displayName, zaloName, avatar }`.

---

### `zalo_mark_read`
Mark as read — removes messages from the buffer up to the given cursor (applies to all threads).

| Name | Type | Description |
|------|------|-------------|
| `cursor` | number | Cursor returned by `zalo_get_messages` |

Result: `{ success, discarded }`.

---

### `zalo_view_media`
Open a message's image/audio/video in the system viewer (downloads it first if needed).

| Name | Type | Description |
|------|------|-------------|
| `messageId` | string | `id` of the message with media |
| `threadId` | string (optional) | Thread to search; omit to search all |
| `open` | boolean | Whether to open in the viewer (default `media.autoOpen`) |

Result: `{ success, path, mediaType }`.

---

## Configuration (mcp-config.json)

The file lives at `~/.zalo-agent-cli/mcp-config.json`; values you set are merged over the defaults below:

```json
{
  "watchThreads": ["dm:*", "group:*"],
  "mode": "manual",
  "triggerKeywords": ["@bot"],
  "notify": {
    "enabled": false,
    "thread": null,
    "on": ["dm"],
    "cooldown": "5m"
  },
  "limits": {
    "maxMessagesPerPoll": 20,
    "inboxWindow": 50,
    "autoDigestThreshold": 50,
    "bufferMaxAge": "2h",
    "bufferMaxSize": 500,
    "sessionIdleTimeout": "30m"
  },
  "media": {
    "downloadDir": null,
    "autoOpen": true
  }
}
```

| Field | Description |
|-------|-------------|
| `watchThreads` | Thread patterns to watch: `dm:*`, `group:*`, `dm:<id>`, `group:<id>` |
| `mode`, `limits.autoDigestThreshold` | Reserved for a future feature; currently has no effect |
| `triggerKeywords` | Keywords that flag a message for the agent's attention |
| `notify.enabled` | Enable notifications to a Zalo group; only sent when no client is subscribed to `zalo://inbox` |
| `notify.thread` | ID of the group that receives notifications |
| `notify.on` | Thread types that trigger notifications (`dm`, `group`) |
| `notify.cooldown` | Notifications are batched within this interval (`30s`, `5m`, `1h`) |
| `limits.maxMessagesPerPoll` | Default number of messages per `zalo_get_messages` call |
| `limits.inboxWindow` | Number of newest messages the `zalo://inbox` resource returns per read (default 50) |
| `limits.bufferMaxAge` | Max age of buffered messages (`2h`) |
| `limits.bufferMaxSize` | Max messages per thread in the buffer |
| `limits.sessionIdleTimeout` | An HTTP session with no open request for this long is closed (`30m`, default) |
| `media.downloadDir` | Directory for downloaded media (default `~/.zalo-agent-cli/media/`) |
| `media.autoOpen` | Open media by default after download |

---

## Architecture

```
Zalo WebSocket
     ↓
Thread Filter (watchThreads / noise filtering)
     ↓
Ring Buffer (in-memory, up to bufferMaxSize per thread)
     ↓
MCP Server (stdio or HTTP /mcp)
     ↓
Claude Code / your agent
```

- **Auto-reconnect**: the WebSocket reconnects by itself; when the session is closed, the server logs in again and all tools use the new session
- **Cursor-based**: clients read incrementally and don't miss messages
- **HTTP sessions**: each client has its own session (`mcp-session-id`); messages stay in the shared buffer, so losing a session (including idle close) loses no messages

---

## Usage tips

- Use `watchThreads` to filter noise — receive only the threads that matter
- Poll `zalo_get_messages` periodically with `since` for incremental reads (source of truth); optionally subscribe to `zalo://inbox` to be notified of new messages
- Call `zalo_mark_read` after processing so the buffer doesn't fill up
- Use `zalo_list_conversations` / `zalo_search_threads` to find the `threadId` before sending
- On a VPS: always use `--auth` and put HTTPS in front
