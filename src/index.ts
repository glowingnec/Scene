import { Env, TelegramUpdate } from "./types";
import { TelegramApi } from "./telegram/api";
import {
  handleTelegramMessage,
  handleTelegramCallbackQuery,
  handleScheduledBroadcast,
} from "./telegram/bot";

export default {
  /**
   * HTTP Webhook & Proxy Handler
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

    // High-performance image proxy to ensure reliable media delivery to Telegram
    if (request.method === "GET" && url.pathname === "/proxy") {
      const targetUrl = url.searchParams.get("url");
      if (!targetUrl) return new Response("Missing url parameter", { status: 400 });

      try {
        const parsed = new URL(targetUrl);
        const host = parsed.hostname.toLowerCase();
        if (!host.endsWith("yande.re") && !host.endsWith("gelbooru.com")) {
          return new Response("Forbidden host", { status: 403 });
        }

        const referer = host.includes("gelbooru.com") ? "https://gelbooru.com/" : "https://yande.re/";

        const imgRes = await fetch(targetUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Referer": referer,
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          },
        });

        if (!imgRes.ok) {
          return new Response(`Upstream fetch failed: ${imgRes.status}`, { status: imgRes.status });
        }

        const contentType = imgRes.headers.get("content-type") || "image/jpeg";
        return new Response(imgRes.body, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=86400, s-maxage=86400",
          },
        });
      } catch (err: any) {
        return new Response(`Proxy error: ${err?.message}`, { status: 500 });
      }
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
        JSON.stringify(
          {
            configured_url: webhookUrl,
            telegram_response: res,
          },
          null,
          2
        ),
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
        const workerOrigin = url.origin;

        // Process message asynchronously without blocking Telegram's webhook timeout
        if (update.message) {
          ctx.waitUntil(handleTelegramMessage(update.message, env, workerOrigin));
        } else if (update.callback_query) {
          ctx.waitUntil(handleTelegramCallbackQuery(update.callback_query, env, workerOrigin));
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

    return new Response("Not Found", { status: 404 });
  },

  /**
   * Cron Scheduled Trigger Handler (Runs daily)
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
