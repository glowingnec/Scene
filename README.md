# 🌸 Booru Today Telegram Bot (Cloudflare Workers)

A serverless Telegram bot hosted on **Cloudflare Workers** that delivers the **top 10 daily images** from **Danbooru** or **yande.re**, both on-demand and automatically every day via cron triggers.

## ✨ Features

- **Top 10 Daily Anime Art**: Pulls the highest scoring / most popular images of the day from either **Danbooru** or **yande.re**.
- **Delivery Modes**:
  - **Every day automatically**: Scheduled Cloudflare Cron Trigger sends top 10 daily art to the owner/subscribed chats.
  - **On-demand by request**: Trigger anytime with `/today`, `/top10`, `/danbooru`, or `/yandere`.
- **Owner-Exclusive Security**:
  - Exclusively recognizes `@cheytac29` as the bot owner.
  - Only `@cheytac29` can toggle SFW/NSFW, change source, manage subscriptions, or access settings.
  - Configurable strict privacy mode (`RESTRICT_ALL_TO_OWNER`) to reject non-owners entirely if preferred.
- **SFW, NSFW & BOTH (All) Toggles**:
  - **SFW**: Delivers strictly safe / general ratings.
  - **NSFW**: Delivers questionable and explicit ratings, with Telegram's native spoiler blur enabled.
  - **ALL (Both)**: Delivers all top art without rating filters.
- **Configurable Display Count**: Choose how many works to display (1 to 10 images) via `/limit <1-10>` or inline settings.
- **Shortened Commands**: `/dbr` (Danbooru) and `/yan` (yande.re) for fast access.
- **Built-in Image Proxy**: Bypasses Danbooru CDN hotlink blocks so Danbooru images always load in Telegram.

---

## 📋 Available Commands

| Command | Audience | Description |
| :--- | :--- | :--- |
| `/start` | Everyone | Welcomes user, detects owner `@cheytac29`, registers chat for daily delivery. |
| `/yan [count] [sfw\|nsfw\|all]` | Everyone | Pulls top yande.re images (e.g. `/yan`, `/yan 5`, `/yan all`). |
| `/gel [count] [sfw\|nsfw\|all]` | Everyone | Pulls top Gelbooru images (e.g. `/gel`, `/gel 5`, `/gel nsfw`). |
| `/today [count] [sfw\|nsfw\|all]` | Everyone | Pulls top images of the day using current settings. |
| `/settings` | **Owner Only** | Opens the interactive settings control panel. |
| `/sfw` | **Owner Only** | Switches default rating filter to SFW. |
| `/nsfw` | **Owner Only** | Switches default rating filter to NSFW. |
| `/all` or `/both` | **Owner Only** | Switches default rating to BOTH (SFW + NSFW). |
| `/limit <1-10>` | **Owner Only** | Sets default number of images to display (e.g. `/limit 5`). |
| `/source <yandere\|gelbooru>` | **Owner Only** | Switches default daily source. |
| `/test_gel` | Everyone | Diagnostic test for Gelbooru API connection. |
| `/subscribe` | **Owner Only** | Subscribes current chat to daily 8:00 AM UTC+7 deliveries. |
| `/unsubscribe` | **Owner Only** | Unsubscribes from daily deliveries. |
| `/help` | Everyone | Shows the command list and instructions. |

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
