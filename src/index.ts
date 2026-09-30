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

    // Image proxy endpoint to bypass anti-hotlink protections (e.g. Gelbooru Referer requirement)
    if (request.method === "GET" && (url.pathname === "/image.jpg" || url.pathname === "/image" || url.pathname === "/proxy")) {
      const targetUrl = url.searchParams.get("url");
      if (!targetUrl) {
        return new Response("Missing url parameter", { status: 400 });
      }

      try {
        const imageRes = await fetch(targetUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            Referer: "https://gelbooru.com/",
          },
        });

        if (!imageRes.ok) {
          return new Response(`Upstream error: ${imageRes.status}`, { status: imageRes.status });
        }

        const contentType = imageRes.headers.get("content-type") || "image/jpeg";
        return new Response(imageRes.body, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=604800, immutable",
          },
        });
      } catch (err: any) {
        return new Response(`Proxy error: ${err?.message}`, { status: 502 });
      }
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
        const workerOrigin = url.origin;
        if (update.message) {
          ctx.waitUntil(handleTelegramMessage(update.message, env, workerOrigin));
        } else if (update.callback_query) {
          ctx.waitUntil(handleTelegramCallbackQuery(update.callback_query, env, workerOrigin));
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
