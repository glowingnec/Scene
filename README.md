# 🌸 Booru Today Telegram Bot (Cloudflare Workers)

A serverless Telegram bot hosted on **Cloudflare Workers** that delivers top anime art from **yande.re** and **Gelbooru**, both on-demand and automatically every day via cron triggers.

## ✨ Features

- **Top Daily Anime Art**: Pulls the highest scoring / most popular images of the day from **yande.re** or **Gelbooru**.
- **Delivery Modes**:
  - **Every day automatically**: Scheduled Cloudflare Cron Trigger sends daily art to the owner at 8:00 AM UTC+7 (01:00 UTC).
  - **On-demand by request**: Trigger anytime with `/today`, `/yan`, or `/gel`.
- **Private Bot with Owner-Exclusive Security**:
  - Strictly configured for owner `@cheytac29`.
  - Non-owners are denied with: `Access Denied: You don't have permission`.
- **SFW, NSFW & BOTH (All) Toggles**:
  - **SFW**: Safe & general posts only.
  - **NSFW**: Questionable and explicit posts, with Telegram's native spoiler blur.
  - **BOTH**: All top posts without rating filters.
- **Configurable Display Count**:
  - Configure pulling from 1 up to 50 images (`/limit <1-50>` or interactive `/settings` panel).
  - Set as default for everyday scheduled deliveries.
  - Automatic batching: Telegram media groups are automatically chunked into batches of 10.
- **Short Commands**: `/yan` (yande.re) and `/gel` (Gelbooru).
- **Built-in Image Proxy**: Proxies images to bypass hotlink protection when needed.

---

## 📋 Available Commands

| Command | Description |
| :--- | :--- |
| `/start` | Welcome and quick start guide |
| `/yan [count] [sfw\|nsfw\|all] [spoiler\|nospoiler]` | Pull top yande.re images (e.g. `/yan`, `/yan 15`, `/yan 20 all nospoiler`) |
| `/gel [count] [sfw\|nsfw\|all] [spoiler\|nospoiler]` | Pull top Gelbooru images (e.g. `/gel`, `/gel 15`, `/gel 20 nsfw nospoiler`) |
| `/today [count] [sfw\|nsfw\|all] [spoiler\|nospoiler]` | Pull top images of the day using current settings |
| `/settings` | Open interactive settings panel (toggle source, rating, spoiler blur, count) |
| `/spoiler [on\|off]` | Toggle NSFW spoiler blur on or off |
| `/unspoiler` | Turn off NSFW spoiler blur by default (unblur images) |
| `/limit <1-50>` | Set default everyday image count (e.g. `/limit 15`) |
| `/source <yandere\|gelbooru>` | Switch default source |
| `/sfw` | Set default rating to SFW (Safe only) |
| `/nsfw` | Set default rating to NSFW (Questionable / Explicit) |
| `/all` | Set default rating to BOTH (SFW + NSFW) |
| `/subscribe` | Register chat for daily 8:00 AM UTC+7 delivery |
| `/unsubscribe` | Cancel daily delivery |
| `/test_gel` | Diagnostic test for Gelbooru API connection |
| `/help` | Command reference |

---

## 🚀 Deployment Guide to Cloudflare Workers

### 1. Prerequisites

1. A **Telegram Bot Token**:
   - Open Telegram and message [@BotFather](https://t.me/BotFather).
   - Send `/newbot`, choose a name and username.
   - Copy the API token (e.g. `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ`).
2. A free [Cloudflare Account](https://dash.cloudflare.com/).
3. Node.js & npm installed on your deployment machine.

---

### 2. Configure Cloudflare Workers Secrets

In this project directory, run:

```bash
# Log in to your Cloudflare account
npx wrangler login

# Set your Telegram bot token (required)
npx wrangler secret put TELEGRAM_BOT_TOKEN
# (Paste your token when prompted)

# (Optional) Set a random secret token for webhook validation
npx wrangler secret put SECRET_TOKEN
```

---

### 3. (Optional but Recommended) Setup Cloudflare KV for Settings Persistence

To allow settings changes (like toggling SFW/NSFW or switching sources via `/settings`) to persist across worker restarts:

```bash
# Create the KV namespace
npx wrangler kv:namespace create BOORU_KV
```

Copy the generated namespace ID and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "BOORU_KV"
id = "your_kv_namespace_id_here"
```

*(Note: Even without KV, the bot will function using the default settings configured in `wrangler.toml`.)*

---

### 4. Deploy to Cloudflare Workers

Deploy the worker with:

```bash
npx wrangler deploy
```

Once deployed, Wrangler will output your worker URL, for example:
`https://booru-today-bot.<your-subdomain>.workers.dev`

---

### 5. Activate Telegram Webhook

To connect Telegram to your newly deployed Cloudflare Worker, simply visit:

```
https://booru-today-bot.<your-subdomain>.workers.dev/setup-webhook
```

Or run via curl:

```bash
curl "https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/setWebhook?url=https://booru-today-bot.<your-subdomain>.workers.dev/webhook"
```

You should see:
```json
{
  "ok": true,
  "result": true,
  "description": "Webhook was set"
}
```

---

### 6. Start Using the Bot!

1. Open your bot on Telegram and send `/start`.
2. As `@cheytac29`, the bot will automatically recognize you as the owner and register your chat ID for daily deliveries!
3. Send `/settings` to inspect or toggle between SFW and NSFW modes, or switch between Danbooru and yande.re.
4. Send `/today` to test immediate top 10 retrieval!

---

## ⏰ Customizing Daily Cron Schedule

The daily scheduled trigger is configured in `wrangler.toml`:

```toml
[triggers]
crons = ["0 1 * * *"] # 01:00 UTC everyday (8:00 AM UTC+7)
```

You can change this cron expression to whatever time best matches your timezone.

---

## 🛠️ Local Development & Testing

```bash
# Install dependencies
npm install

# Run type check
npm run typecheck

# Start local dev server with Wrangler
npm run dev
```
