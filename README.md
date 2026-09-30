# 🌸 Scene (Cloudflare Workers Telegram Bot)

A serverless Telegram bot hosted on **Cloudflare Workers** delivering top daily anime art from **yande.re**, both on-demand and automatically every day at 8:00 AM UTC+7.

---

## ✨ Features & Architecture

- **Clean & Fast**: Runs entirely on Cloudflare Workers edge runtime with zero database/KV required.
- **Source**: Exclusively fetches highest scoring anime art from **yande.re**.
- **Defaults**:
  - **Rating:** ALL (SFW + Questionable + Explicit)
  - **Count:** 30 images
  - **Spoilers:** OFF (Unblurred by default)
  - **Batching:** 10-image albums with intelligent 5+5 sub-album fallback on timeout.
- **Delivery Modes**:
  - **Daily at 8:00 AM UTC+7 (01:00 UTC)** via Cloudflare Cron Trigger.
  - **On-demand** via `/today` or `/yan` commands.
- **Strict Owner-Only Access**:
  - Exclusively restricted to `@cheytac29` (Chat ID: `1368225736`).
  - Unauthorized users receive `Access Denied: You don't have permission`.

---

## 📋 Available Commands

| Command | Description |
| :--- | :--- |
| `/start` | Welcome and quick start guide |
| `/today [count] [rating]` | Fetch top images (defaults to 30, ALL rating) |
| `/search <tag> [count] [rating]` | Search specific tag, character, or artist (alias: `/s`) |
| `@s <tag>` | Real-time tag autocomplete right in chat message box |
| `/random [count] [rating]` | Fetch random anime art from yande.re |
| `/settings` | View active configuration and quick-action buttons |
| `/myid` | View your Telegram Chat ID (`1368225736`) |
| `/test_cron` | Test the 8:00 AM scheduled delivery immediately |
| `/help` | Command reference |

---

## ⚙️ Runtime Variables (Cloudflare Dashboard)

Configure defaults directly in Cloudflare Dashboard under **Workers & Pages ➔ [Your Worker] ➔ Settings ➔ Variables**:

| Variable | Type | Recommended Value | Description |
| :--- | :--- | :--- | :--- |
| `TELEGRAM_BOT_TOKEN` | Secret | `your_bot_token` | Token from [@BotFather](https://t.me/BotFather) |
| `OWNER_USERNAME` | Variable | `cheytac29` | Your Telegram username |
| `OWNER_CHAT_ID` | Variable | `1368225736` | Your numeric Telegram ID |
| `DEFAULT_LIMIT` | Variable | `30` | Default number of images |
| `DEFAULT_RATING` | Variable | `all` | `all`, `sfw`, or `nsfw` |
| `DEFAULT_SPOILER_NSFW` | Variable | `false` | `false` = unblurred, `true` = blurred |

---

## 🚀 Fresh Setup Guide (For New Repo / Bot)

### Step 1: Create Your Bot on Telegram
1. Message [@BotFather](https://t.me/BotFather) on Telegram.
2. Send `/newbot`, choose a name and username.
3. Save the **Bot Token** (e.g. `123456789:ABCdef...`).

### Step 2: Deploy to Cloudflare Workers

#### Option A: Via GitHub Integration
1. Push this repository to GitHub.
2. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) ➔ **Workers & Pages** ➔ **Create application** ➔ **Connect to Git**.
3. Select your repository.
4. Add the variables from the table above.
5. Deploy!

#### Option B: Standalone Paste (Zero Git)
1. In Cloudflare Dashboard, click **Create Worker**.
2. Click **Quick Edit** in the browser.
3. Paste the contents of `worker.js`.
4. Click **Save and Deploy**.
5. Go to **Settings ➔ Variables** and add `TELEGRAM_BOT_TOKEN`, `OWNER_CHAT_ID`, etc.

### Step 3: Register Telegram Webhook
Open in your browser:
```
https://<your-worker-subdomain>.workers.dev/setup-webhook
```
You will receive:
```json
{
  "configured_url": "https://<your-worker-subdomain>.workers.dev/webhook",
  "telegram_response": { "ok": true, "result": true, "description": "Webhook was set" }
}
```

### Step 4: Verify Cron Trigger
In Cloudflare Dashboard under **Settings ➔ Triggers ➔ Cron Triggers**:
- Ensure `0 1 * * *` (01:00 UTC = 8:00 AM UTC+7) is listed.

---

## 🛠️ Project Structure

```
├── src/
│   ├── config.ts         # Runtime configuration from Cloudflare env
│   ├── types/index.ts    # TypeScript definitions
│   ├── services/
│   │   ├── yandere.ts    # yande.re popular_by_day & search API
│   │   └── booru.ts      # Booru service abstraction
│   ├── telegram/
│   │   ├── api.ts        # Telegram Bot API client
│   │   └── bot.ts        # Command router, album batching & rate limit handling
│   └── index.ts          # Cloudflare Worker entry (fetch & scheduled)
├── worker.js             # Standalone all-in-one file (optional single-file deploy)
├── wrangler.toml         # Cloudflare Worker configuration
└── README.md
```
