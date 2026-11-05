# Zalo Official Account (OA)

Manage a Zalo Official Account through the official API v3.0. Fully independent from the personal account (zca-js).

> **Note:** Some APIs require a higher OA tier. See [zalo.cloud/oa/pricing](https://zalo.cloud/oa/pricing).

## Quick start

### Interactive (humans)

```bash
zalo-agent oa init
```

A step-by-step wizard: enter credentials → OAuth login → webhook setup.

### Non-interactive (AI agent / CI)

```bash
# Login + skip webhook
zalo-agent oa init --app-id <APP_ID> --secret <SECRET> --skip-webhook

# Login + ngrok tunnel
zalo-agent oa init --app-id <APP_ID> --secret <SECRET> --tunnel ngrok -p 3000

# Login + existing webhook URL (VPS/n8n)
zalo-agent oa init --app-id <APP_ID> --secret <SECRET> --webhook-url https://your-server.com/webhook

# JSON output
zalo-agent --json oa init --app-id <APP_ID> --secret <SECRET> --skip-webhook
```

### VPS (headless server)

```bash
# On VPS — starts callback server on 0.0.0.0
zalo-agent oa login --app-id <APP_ID> --secret <SECRET> --callback-host https://your-vps.com

# Copy the auth URL → open in local browser → authorize → VPS receives token
```

---

## Commands

### Setup & Auth

| Command | Description |
|-------|--------|
| `oa init` | Guided setup wizard (interactive + non-interactive) |
| `oa login --app-id <id> --secret <key>` | OAuth login (opens a browser) |
| `oa login ... --callback-host <url>` | OAuth login from a VPS |
| `oa refresh` | Refresh the access token (uses the refresh token) |
| `oa setup <access-token>` | Set the token manually (skips OAuth) |
| `oa whoami` | Show OA info |

### Messages

```bash
# Send text (message type: cs | transaction | promotion)
zalo-agent oa msg text <user-id> "Message text" [-m cs]

# Send an image (URL or attachment_id)
zalo-agent oa msg image <user-id> --image-url https://...
zalo-agent oa msg image <user-id> --image-id <attachment_id>

# Send a file (upload first)
zalo-agent oa msg file <user-id> <file-id>

# Send a list
zalo-agent oa msg list <user-id> '[{"title":"Item 1"},{"title":"Item 2"}]'

# Check delivery status
zalo-agent oa msg status <message-id>
```

### Follower

```bash
zalo-agent oa follower list [--offset 0] [--count 50]
zalo-agent oa follower info <user-id>
zalo-agent oa follower update <user-id> '{"name":"...","phone":"..."}'
```

### Tag

```bash
zalo-agent oa tag list
zalo-agent oa tag assign <user-id> <tag-name>
zalo-agent oa tag remove <tag-name>
zalo-agent oa tag untag <user-id> <tag-name>
```

### Media Upload

```bash
zalo-agent oa upload image ./photo.jpg    # Returns attachment_id
zalo-agent oa upload file ./document.pdf  # Returns file token
```

### Conversations

```bash
zalo-agent oa conv recent [--offset 0] [--count 10]
zalo-agent oa conv history <user-id> [--offset 0] [--count 10]
```

### Webhook Listener

```bash
# Basic
zalo-agent oa listen -p 3000

# With MAC verification
zalo-agent oa listen -p 3000 -s <OA_SECRET_KEY>

# Filter events
zalo-agent oa listen -e user_send_text,follow

# Domain verification
zalo-agent oa listen -p 3000 --verify-domain <ZALO_VERIFY_CODE>

# JSON output (pipe)
zalo-agent --json oa listen | while read -r event; do
  echo "$event" | jq '.message.text'
done
```

**Supported events:** `follow`, `unfollow`, `user_send_text`, `user_send_image`, `user_send_file`, `user_send_location`, `user_send_sticker`, `user_send_gif`, `user_click_button`, `user_click_link`

### Other

```bash
zalo-agent oa menu '{"buttons":[...]}'         # Update the OA menu
zalo-agent oa article create '{"title":"..."}'  # Create an article
zalo-agent oa article list                      # List articles
zalo-agent oa store product-list                # List products
zalo-agent oa store category-list               # List categories
```

---

## Webhook Setup

### Zalo requirements

1. **Domain verification** — Zalo must verify your domain before you can use webhooks
2. **HTTPS required** — the webhook URL must be HTTPS
3. **Vietnam IP** — needed to receive full user info (name, avatar, phone number)
4. **Return 200 OK** — within 5 seconds

### Ways to expose a webhook

| Option | Pros | Cons |
|------|----------|------------|
| **ngrok** | Fastest, one command | Singapore IP, URL changes on every run |
| **cloudflared** | Free, stable | Needs a Cloudflare account |
| **VPS** | Vietnam IP, stable | You manage the server |
| **n8n** | Visual workflow | Needs an n8n deployment |

### With ngrok

```bash
# Terminal 1: listener
zalo-agent oa listen -p 3000 --no-verify --verify-domain <CODE>

# Terminal 2: tunnel
ngrok http 3000
```

### With a VPS (recommended for production)

```bash
# Install on the VPS
bun add -g zalo-mcp

# Log in from the VPS
zalo-agent oa login --app-id <ID> --secret <KEY> --callback-host https://your-vps.com

# Run listener
zalo-agent oa listen -p 3000 -s <SECRET>

# Keep it alive with systemd/pm2 (pm2 runs it via Bun)
pm2 start zalo-agent --interpreter bun --name zalo-oa -- oa listen -p 3000 -s <SECRET>
```

---

## Credentials

Stored at `~/.zalo-agent/oa-credentials.json` (mode 0600, readable only by the owner).

```json
{
  "default": {
    "appId": "...",
    "secretKey": "...",
    "accessToken": "...",
    "refreshToken": "...",
    "expiresIn": 90000,
    "updatedAt": "2026-03-17T..."
  }
}
```

**Multi-OA:** use `--oa-id` to manage several OAs:

```bash
zalo-agent oa login --app-id <ID1> --secret <KEY1> --oa-id shop1
zalo-agent oa login --app-id <ID2> --secret <KEY2> --oa-id shop2
zalo-agent oa whoami --oa-id shop1
zalo-agent oa whoami --oa-id shop2
```

---

## Security

- Credentials file: `chmod 600` (owner-only)
- MAC verification: HMAC-SHA256 with timing-safe comparison
- Message type whitelist: `cs`, `transaction`, `promotion` only
- Webhook body size limit: 1MB max
- OAuth callback: binds `127.0.0.1` (local) or `0.0.0.0` (VPS mode)
- No hardcoded secrets — all from CLI flags or credential file

---

## Comparison

| | `zalo-agent` (personal) | `zalo-agent oa` (official) |
|---|---|---|
| API | Unofficial (zca-js) | Official (Zalo OA API v3.0) |
| Auth | QR code login | OAuth 2.0 |
| Scope | Personal account | Official Account |
| Risk | May get banned | Safe, official API |
| Features | Chat, friend, group, poll... | Messaging, follower, tag, store, webhook |
