import { Env, TelegramUpdate } from "./types";
import { TelegramApi } from "./telegram/api";
import {
  handleTelegramMessage,
  handleTelegramCallbackQuery,
  handleScheduledBroadcast,
} from "./telegram/bot";

export default {
  /**
   * HTTP Webhook Request Handler
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Root status check
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return new Response(
        JSON.stringify({
          status: "healthy",
          bot: "Booru Today Telegram Bot",
          owner: env.OWNER_USERNAME || "cheytac29",
          timestamp: new Date().toISOString(),
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const token = env.TELEGRAM_BOT_TOKEN || (globalThis as any).TELEGRAM_BOT_TOKEN;

    // Helper endpoint to register webhook automatically: GET /setup-webhook
    if (request.method === "GET" && url.pathname === "/setup-webhook") {
      if (!token) {
        return new Response("Error: TELEGRAM_BOT_TOKEN environment secret is not set.", {
          status: 500,
        });
      }

      const webhookUrl = `${url.origin}/webhook`;
      const api = new TelegramApi(token);
      const res = await api.setWebhook(webhookUrl, env.SECRET_TOKEN);

      return new Response(
        JSON.stringify({
          configured_url: webhookUrl,
          telegram_response: res,
        }, null, 2),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Telegram Webhook Handler
    if (request.method === "POST" && (url.pathname === "/webhook" || url.pathname === "/")) {
      // Validate secret token if configured
      if (env.SECRET_TOKEN) {
        const headerSecret = request.headers.get("x-telegram-bot-api-secret-token");
        if (headerSecret !== env.SECRET_TOKEN) {
          return new Response("Unauthorized", { status: 401 });
        }
      }

      try {
        const update = (await request.json()) as TelegramUpdate;

        // Process message asynchronously without blocking Telegram's webhook timeout
        if (update.message) {
          ctx.waitUntil(handleTelegramMessage(update.message, env));
        } else if (update.callback_query) {
          ctx.waitUntil(handleTelegramCallbackQuery(update.callback_query, env));
        }

        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      } catch (err: any) {
        console.error("Webhook processing error:", err);
        return new Response(JSON.stringify({ ok: false, error: err?.message }), {
          headers: { "Content-Type": "application/json" },
          status: 200, // Still return 200 to Telegram to prevent retry floods
        });
      }
    }

    return new Response("Not Found", { status: 404 });
  },

  /**
   * Cron Scheduled Trigger Handler (Runs every day)
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const token = env.TELEGRAM_BOT_TOKEN || (globalThis as any).TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.error("TELEGRAM_BOT_TOKEN not configured in scheduled cron execution.");
      return;
    }

    ctx.waitUntil(handleScheduledBroadcast({ ...env, TELEGRAM_BOT_TOKEN: token }));
  },
};
