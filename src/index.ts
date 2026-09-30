import { Env, TelegramUpdate } from "./types";
import { TelegramApi } from "./telegram/api";
import {
  handleTelegramMessage,
  handleTelegramCallbackQuery,
  handleTelegramInlineQuery,
  handleScheduledBroadcast,
  DEFAULT_BOT_COMMANDS,
} from "./telegram/bot";

export default {
  /**
   * HTTP Webhook, Health Check & Browser Test Endpoints
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Root status & health check
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return new Response(
        JSON.stringify({
          status: "healthy",
          bot: "Scene Telegram Bot",
          source: env.DEFAULT_SOURCE || "both",
          owner: env.OWNER_USERNAME || "cheytac29",
          timestamp: new Date().toISOString(),
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    const token = env.TELEGRAM_BOT_TOKEN;

    // Helper endpoint to register webhook and menu commands: GET /setup-webhook
    if (request.method === "GET" && url.pathname === "/setup-webhook") {
      if (!token) {
        return new Response("Error: TELEGRAM_BOT_TOKEN environment variable/secret is not set.", {
          status: 500,
        });
      }

      const webhookUrl = `${url.origin}/webhook`;
      const api = new TelegramApi(token);
      const webhookRes = await api.setWebhook(webhookUrl, env.SECRET_TOKEN);
      const commandsRes = await api.setMyCommands(DEFAULT_BOT_COMMANDS);
      const menuRes = await api.setChatMenuButton({ type: "commands" });

      return new Response(
        JSON.stringify(
          {
            configured_url: webhookUrl,
            webhook: webhookRes,
            commands: commandsRes,
            menu_button: menuRes,
          },
          null,
          2
        ),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Helper endpoint to set up bot menu commands: GET /setup-commands
    if (request.method === "GET" && (url.pathname === "/setup-commands" || url.pathname === "/set-menu")) {
      if (!token) {
        return new Response("Error: TELEGRAM_BOT_TOKEN environment variable/secret is not set.", {
          status: 500,
        });
      }
      const api = new TelegramApi(token);
      const commandsRes = await api.setMyCommands(DEFAULT_BOT_COMMANDS);
      const menuRes = await api.setChatMenuButton({ type: "commands" });
      return new Response(
        JSON.stringify({ commands: commandsRes, menu_button: menuRes }, null, 2),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Telegram Webhook Handler: POST /webhook
    if (request.method === "POST" && (url.pathname === "/webhook" || url.pathname === "/")) {
      if (env.SECRET_TOKEN) {
        const headerSecret = request.headers.get("x-telegram-bot-api-secret-token");
        if (headerSecret !== env.SECRET_TOKEN) {
          return new Response("Unauthorized", { status: 401 });
        }
      }

      try {
        const update = (await request.json()) as TelegramUpdate;
        if (update.message) {
          ctx.waitUntil(handleTelegramMessage(update.message, env));
        } else if (update.callback_query) {
          ctx.waitUntil(handleTelegramCallbackQuery(update.callback_query, env));
        } else if (update.inline_query) {
          ctx.waitUntil(handleTelegramInlineQuery(update.inline_query, env));
        }

        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      } catch (err: any) {
        console.error("Webhook processing error:", err);
        return new Response(JSON.stringify({ ok: false, error: err?.message }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
    }

    // HTTP endpoint to manually trigger scheduled broadcast from browser: GET /test-scheduled
    if (request.method === "GET" && (url.pathname === "/test-scheduled" || url.pathname === "/cron")) {
      try {
        const result = await handleScheduledBroadcast(env);
        return new Response(
          JSON.stringify({ ok: true, message: result, timestamp: new Date().toISOString() }, null, 2),
          { headers: { "Content-Type": "application/json" } }
        );
      } catch (err: any) {
        return new Response(
          JSON.stringify({ ok: false, error: err?.message }, null, 2),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    return new Response("Not Found", { status: 404 });
  },

  /**
   * Cloudflare Cron Trigger (Runs daily at 8:00 AM UTC+7 / 01:00 UTC)
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const token = env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.error("TELEGRAM_BOT_TOKEN not configured in scheduled cron execution.");
      return;
    }

    try {
      console.log(`Daily cron trigger fired: ${event.cron}`);
      const res = await handleScheduledBroadcast(env);
      console.log(`Daily broadcast completed: ${res}`);
    } catch (err: any) {
      console.error("Daily cron broadcast failed:", err);
    }
  },
};
