# 🌸 Booru Today Telegram Bot (Cloudflare Workers)

A serverless Telegram bot hosted on **Cloudflare Workers** that delivers top anime art from **yande.re**, both on-demand and automatically every day via cron triggers.

## ✨ Features

- **Top Daily Anime Art**: Pulls the highest scoring art from **yande.re**.
- **Defaults**:
  - **Rating:** ALL (SFW + Questionable + Explicit)
  - **Count:** 15 images (batched into media groups of 10 + 5)
  - **Spoilers:** OFF (Unblurred by default)
- **Delivery Modes**:
  - **Every day automatically**: Scheduled Cloudflare Cron Trigger sends daily art to the owner at 8:00 AM UTC+7 (01:00 UTC).
  - **5-Minute Test Cron**: Enabled for rapid delivery testing.
  - **On-demand by request**: Trigger anytime with `/today` or `/yan`.
- **Private Bot with Owner-Exclusive Security**:
  - Strictly restricted to owner `@cheytac29` (Chat ID: `1368225736`).
  - Non-owners are denied with: `Access Denied: You don't have permission`.

---

## 📋 Available Commands

| Command | Description |
| :--- | :--- |
| `/start` | Welcome and quick start guide |
| `/today [count] [sfw\|nsfw\|all]` | Fetch top images (defaults to 15, ALL rating) |
| `/yan [count] [sfw\|nsfw\|all]` | Shortcut for yande.re top images |
| `/settings` | Open interactive settings panel |
| `/limit <1-50>` | Set everyday image count (e.g. `/limit 15`) |
| `/spoiler [on\|off]` | Toggle NSFW spoiler blur on or off |
| `/unspoiler` | Turn off NSFW spoiler blur (unblur images by default) |
| `/sfw` | Set rating filter to SFW (Safe only) |
| `/nsfw` | Set rating filter to NSFW (Questionable / Explicit) |
| `/all` | Set rating filter to BOTH (SFW + NSFW) |
| `/myid` | View your Telegram Chat ID (`1368225736`) |
| `/test_cron` | Test the scheduled broadcast immediately in chat |
| `/subscribe` | Register chat for daily 8:00 AM delivery |
| `/unsubscribe` | Cancel daily delivery |
| `/help` | Command reference |

---

## 🚀 Deployment Guide to Cloudflare Workers

### 1. Prerequisites

1. A **Telegram Bot Token** from [@BotFather](https://t.me/BotFather).
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
```

---

### 3. Deploy to Cloudflare Workers

Deploy the worker with:

```bash
npx wrangler deploy
```

Once deployed, visit your worker URL to register the webhook:
`https://<your-worker>.<subdomain>.workers.dev/setup-webhook`

---

### 4. Scheduled Daily Trigger

The daily scheduled triggers are configured in `wrangler.toml`:

```toml
[triggers]
crons = ["0 1 * * *", "*/5 * * * *"] # 8:00 AM UTC+7 daily + 5-minute test cron
```
