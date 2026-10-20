# Hướng dẫn Zalo MCP Server

Model Context Protocol (MCP) cho phép Claude Code và các MCP client/agent tương tác với Zalo trực tiếp qua 12 tools: đọc, gửi tin, gửi file, thả reaction, tra cứu hội thoại, nhóm và người dùng.

---

## Khởi động nhanh

### Chế độ stdio (Local — Claude Code)

```bash
zalo-agent mcp start
```

Thêm vào `.claude/settings.json`:

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

### Chế độ HTTP (VPS — Remote)

```bash
zalo-agent mcp start --http 3847 --auth your-secret
```

Endpoint MCP là `http://<host>:<port>/mcp`. Thêm vào cấu hình MCP client:

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

## Tích hợp vào agent qua HTTP

### Khởi động server

```bash
zalo-agent mcp start --http 3847 --auth <token>                 # chỉ nghe 127.0.0.1
zalo-agent mcp start --http 3847 --auth <token> --host 0.0.0.0  # mở ra mạng
```

- Mặc định server chỉ bind `127.0.0.1`. Dùng `--host 0.0.0.0` để agent ở máy khác kết nối được.
- Nếu bind vào địa chỉ không phải loopback (`127.0.0.1`, `::1`, `localhost`) mà **không có `--auth`**, server từ chối khởi động.
- Mọi request tới `/mcp` phải có header `Authorization: Bearer <token>`, sai hoặc thiếu sẽ nhận `401`.
- `GET /health` không cần token, trả về `{ "status": "ok", "uptime": ..., "threads": ... }` để dùng cho health check.
- Server chạy stateless: mỗi `POST /mcp` tạo một MCP server riêng, nhưng luôn dùng phiên Zalo hiện tại (kể cả sau khi tự đăng nhập lại).
- Nên đặt reverse proxy HTTPS (nginx, Caddy) phía trước khi mở ra Internet.

### Ví dụ client JavaScript

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

// Đọc tin mới
const res = await client.callTool({ name: "zalo_get_messages", arguments: { limit: 20 } });
const { messages, cursor } = JSON.parse(res.content[0].text);

// Trả lời tin đầu tiên (threadType: 0 = DM, 1 = nhóm)
const m = messages[0];
await client.callTool({
    name: "zalo_send_message",
    arguments: {
        threadId: m.threadId,
        threadType: m.threadType === "group" ? 1 : 0,
        text: "Đã nhận!",
        replyToMessageId: m.id,
    },
});

// Đánh dấu đã đọc
await client.callTool({ name: "zalo_mark_read", arguments: { cursor } });
await client.close();
```

Kết quả của mỗi tool là một khối `text` chứa JSON; khi lỗi, `isError` là `true` và text bắt đầu bằng `Error:`.

### Lưu ý khi tích hợp

- **Reply và react chỉ hoạt động với tin nhắn nhận được khi server đang chạy** (còn trong buffer). Tin cũ lấy từ `zalo_get_history` không quote được; với `zalo_react` cần truyền thêm `cliMsgId` nếu biết.
- **Nguồn của `zalo_send_attachment`** là đường dẫn tuyệt đối **trên máy chạy server** hoặc URL `http(s)`. URL được server tải về thư mục tạm (tối đa 25 MB, timeout 30 giây) rồi xoá sau khi gửi.
- Buffer nằm trong bộ nhớ: khởi động lại server sẽ mất tin chưa đọc.

---

## Tham chiếu Tools

`threadType`: `0` = DM (mặc định), `1` = nhóm.

### `zalo_get_messages`
Lấy tin nhắn từ buffer, hỗ trợ cursor để đọc tăng dần.

| Tên | Kiểu | Mô tả |
|-----|------|--------|
| `threadId` | string (tuỳ chọn) | Chỉ đọc một thread. Bỏ trống để đọc tất cả thread đang theo dõi |
| `since` | number (mặc định 0) | Cursor từ lần đọc trước — chỉ lấy tin mới hơn |
| `limit` | number 1–100 (mặc định `limits.maxMessagesPerPoll`) | Số tin tối đa |

Kết quả: `{ messages, cursor, hasMore }`. Mỗi tin có `id`, `cliMsgId`, `threadId`, `threadType` (`dm`/`group`), `senderId`, `senderName`, `text`, `timestamp`, `ts`, `type`, `attachment`, `replyTo` (`{ msgId, ownerId, text }` hoặc `null`), `threadName`.

---

### `zalo_get_history`
Lấy tin cũ từ server Zalo (tối đa ~2 tuần), khác với buffer của `zalo_get_messages`.

| Tên | Kiểu | Mô tả |
|-----|------|--------|
| `threadId` | string | Thread cần lấy |
| `threadType` | number | 0 = DM (mặc định), 1 = nhóm |
| `limit` | number 1–200 (mặc định 50) | Số tin tối đa |
| `lastMsgId` | string (tuỳ chọn) | Cursor phân trang từ lần gọi trước |

Kết quả: `{ threadId, threadType, count, messages, cursor, hasMore }`.

---

### `zalo_send_message`
Gửi tin nhắn văn bản, có thể trả lời (quote) một tin hoặc mention người dùng.

| Tên | Kiểu | Mô tả |
|-----|------|--------|
| `threadId` | string | ID người dùng hoặc nhóm |
| `text` | string | Nội dung tin nhắn |
| `threadType` | number | 0 = DM (mặc định), 1 = nhóm |
| `replyToMessageId` | string (tuỳ chọn) | `id` của tin trong buffer để quote |
| `mentions` | array (tuỳ chọn) | `[{ userId, pos, len }]` — `pos`/`len` là vị trí và độ dài đoạn `@Tên` trong `text` |

Kết quả: `{ "success": true, "messageId": "..." }`. Nếu `replyToMessageId` không còn trong buffer, tool trả lỗi.

---

### `zalo_send_attachment`
Gửi một hoặc nhiều ảnh/file.

| Tên | Kiểu | Mô tả |
|-----|------|--------|
| `threadId` | string | ID người dùng hoặc nhóm |
| `threadType` | number | 0 = DM (mặc định), 1 = nhóm |
| `sources` | string[] (1–10) | Đường dẫn tuyệt đối trên máy chạy server, hoặc URL `http(s)` |
| `caption` | string (tuỳ chọn) | Nội dung kèm theo |

Kết quả: `{ "success": true, "messageId": ..., "attachmentIds": [...] }`.

---

### `zalo_react`
Thả reaction vào một tin nhắn.

| Tên | Kiểu | Mô tả |
|-----|------|--------|
| `messageId` | string | `id` của tin cần react |
| `threadId` | string | Thread chứa tin |
| `threadType` | number | 0 = DM (mặc định), 1 = nhóm |
| `reaction` | enum | `heart`, `like`, `haha`, `wow`, `cry`, `angry` |
| `cliMsgId` | string (tuỳ chọn) | Chỉ cần khi tin không còn trong buffer |

Kết quả: `{ "success": true }`.

---

### `zalo_list_threads`
Liệt kê các thread đang có tin trong buffer kèm số tin chưa đọc.

| Tên | Kiểu | Mô tả |
|-----|------|--------|
| `type` | enum | `dm`, `group` hoặc `all` (mặc định) |

Kết quả: `{ threads: [{ threadId, unread, total, lastActivity, threadType, name }], total }`.

---

### `zalo_search_threads`
Tìm thread (nhóm/DM) theo tên, hỗ trợ fuzzy và không phân biệt dấu tiếng Việt.

| Tên | Kiểu | Mô tả |
|-----|------|--------|
| `query` | string | Từ khoá |
| `type` | enum | `dm`, `group` hoặc `all` (mặc định) |
| `limit` | number 1–50 (mặc định 10) | Số kết quả tối đa |

Kết quả: `{ results, total }`.

---

### `zalo_list_conversations`
Liệt kê hội thoại của chính tài khoản Zalo (không chỉ thread trong buffer): DM gần đây nhất theo lần tương tác cuối, và các nhóm.

| Tên | Kiểu | Mô tả |
|-----|------|--------|
| `type` | enum | `dm`, `group` hoặc `all` (mặc định) |
| `limit` | number 1–200 (mặc định 50) | Số kết quả tối đa cho mỗi loại |

Kết quả: `{ conversations: [{ threadId, name, threadType, lastActionTime | memberCount }], total }`.

---

### `zalo_get_group_members`
Liệt kê thành viên của nhóm.

| Tên | Kiểu | Mô tả |
|-----|------|--------|
| `groupId` | string | ID nhóm |
| `limit` | number 1–500 (mặc định 200) | Số thành viên tối đa |

Kết quả: `{ groupId, name, total, members: [{ userId, name, isAdmin, isCreator }] }`.

---

### `zalo_get_user_info`
Tra cứu hồ sơ công khai của người dùng (không trả về số điện thoại).

| Tên | Kiểu | Mô tả |
|-----|------|--------|
| `userId` | string | ID người dùng, ví dụ `senderId` của một tin nhắn |

Kết quả: `{ userId, displayName, zaloName, avatar }`.

---

### `zalo_mark_read`
Đánh dấu đã đọc — xoá tin khỏi buffer đến cursor chỉ định (áp dụng cho mọi thread).

| Tên | Kiểu | Mô tả |
|-----|------|--------|
| `cursor` | number | Cursor trả về từ `zalo_get_messages` |

Kết quả: `{ success, discarded }`.

---

### `zalo_view_media`
Mở ảnh/audio/video của một tin nhắn bằng trình xem của hệ thống (tự tải nếu chưa có).

| Tên | Kiểu | Mô tả |
|-----|------|--------|
| `messageId` | string | `id` của tin có media |
| `threadId` | string (tuỳ chọn) | Thread cần tìm; bỏ trống để tìm tất cả |
| `open` | boolean | Có mở bằng trình xem hay không (mặc định `media.autoOpen`) |

Kết quả: `{ success, path, mediaType }`.

---

## Cấu hình (mcp-config.json)

File nằm ở `~/.zalo-agent-cli/mcp-config.json`, giá trị bạn khai báo được gộp lên giá trị mặc định dưới đây:

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
    "autoDigestThreshold": 50,
    "bufferMaxAge": "2h",
    "bufferMaxSize": 500
  },
  "media": {
    "downloadDir": null,
    "autoOpen": true
  }
}
```

| Trường | Mô tả |
|--------|--------|
| `watchThreads` | Pattern thread cần theo dõi: `dm:*`, `group:*`, `dm:<id>`, `group:<id>` |
| `mode`, `limits.autoDigestThreshold` | Dành riêng cho tính năng sau, hiện chưa có tác dụng |
| `triggerKeywords` | Từ khoá đánh dấu tin cần agent chú ý |
| `notify.enabled` | Bật gửi thông báo vào nhóm Zalo khi có tin mới lúc agent offline |
| `notify.thread` | ID nhóm nhận thông báo |
| `notify.on` | Loại thread kích hoạt thông báo (`dm`, `group`) |
| `notify.cooldown` | Gộp thông báo trong khoảng này (`30s`, `5m`, `1h`) |
| `limits.maxMessagesPerPoll` | Số tin mặc định mỗi lần `zalo_get_messages` |
| `limits.bufferMaxAge` | Tuổi tối đa của tin trong buffer (`2h`) |
| `limits.bufferMaxSize` | Số tin tối đa mỗi thread trong buffer |
| `media.downloadDir` | Thư mục lưu media (mặc định `~/.zalo-agent-cli/media/`) |
| `media.autoOpen` | Mặc định mở media sau khi tải |

---

## Kiến trúc

```
Zalo WebSocket
     ↓
Thread Filter (watchThreads / lọc noise)
     ↓
Ring Buffer (in-memory, tối đa bufferMaxSize mỗi thread)
     ↓
MCP Server (stdio hoặc HTTP /mcp)
     ↓
Claude Code / agent của bạn
```

- **Auto-reconnect**: WebSocket tự kết nối lại; khi phiên bị đóng, server đăng nhập lại và mọi tool dùng phiên mới
- **Cursor-based**: Client đọc tăng dần, không bỏ sót tin
- **Stateless transport**: Mỗi request HTTP độc lập — state nằm ở buffer

---

## Mẹo sử dụng

- Dùng `watchThreads` để lọc noise — chỉ nhận thread quan trọng
- Gọi `zalo_get_messages` định kỳ với `since` để polling tăng dần
- Dùng `zalo_mark_read` sau khi xử lý xong để buffer không đầy
- Dùng `zalo_list_conversations` / `zalo_search_threads` để tìm `threadId` trước khi gửi tin
- Trên VPS: luôn dùng `--auth` và đặt HTTPS phía trước
