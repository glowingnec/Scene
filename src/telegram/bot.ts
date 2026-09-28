import {
  Env,
  RatingFilter,
  BotSettings,
  TelegramMessage,
  TelegramCallbackQuery,
  TelegramUser,
  InputMediaPhoto,
} from "../types";
import { TelegramApi } from "./api";
import { getConfig, DEFAULT_CONFIG } from "../config";
import { fetchYanderePosts } from "../services/yandere";

/**
 * Strict owner verification.
 * Only @cheytac29 (or numeric ID 1368225736) has permission.
 */
function isOwner(from: TelegramUser | undefined, env: Env): boolean {
  if (!from) return false;
  const ownerUsername = (env.OWNER_USERNAME || DEFAULT_CONFIG.OWNER_USERNAME)
    .toLowerCase()
    .replace(/^@/, "");
  const ownerChatId = (env.OWNER_CHAT_ID || DEFAULT_CONFIG.OWNER_CHAT_ID).toString();

  if (from.username && from.username.toLowerCase() === ownerUsername) return true;
  if (from.id && from.id.toString() === ownerChatId) return true;
  return false;
}

function escapeHtml(text?: string | number): string {
  if (text === undefined || text === null) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getRatingBadgeText(rating: RatingFilter): string {
  switch (rating) {
    case "sfw":
      return "SFW (Safe only) 🛡️";
    case "nsfw":
      return "NSFW (Questionable / Explicit) ⚠️";
    case "all":
      return "Both (SFW + NSFW) 🌈";
  }
}

/**
 * Format settings overview text based on active Cloudflare environment variables
 */
function formatSettingsText(config: BotSettings): string {
  const spoilerText = config.spoilerNsfw ? "Enabled (Blurred) 🙈" : "Disabled (Unblurred) 👁️";
  const targetText = config.ownerChatId ? `<code>${config.ownerChatId}</code>` : "<code>1368225736</code>";

  return (
    `⚙️ <b>Active Bot Configuration</b>\n\n` +
    `• <b>Source:</b> <code>yande.re</code>\n` +
    `• <b>Default Rating:</b> <code>${getRatingBadgeText(config.rating)}</code>\n` +
    `• <b>NSFW Spoilers:</b> <code>${spoilerText}</code>\n` +
    `• <b>Everyday Count:</b> <code>${config.limit} images</code>\n` +
    `• <b>Delivery Target:</b> ${targetText}\n` +
    `• <b>Daily Schedule:</b> <code>8:00 AM UTC+7 (01:00 UTC)</code>\n\n` +
    `💡 <i>To permanently change defaults, edit runtime variables in your Cloudflare Dashboard (Settings ➔ Variables).</i>`
  );
}

/**
 * Parses user command flags like `/today 20 nsfw` or `/yan sfw`
 */
export function parseCommandArgs(
  args: string[],
  defaultRating: RatingFilter,
  defaultLimit: number,
  defaultSpoiler: boolean = false
): { rating: RatingFilter; limit: number; spoilerNsfw: boolean } {
  let rating = defaultRating;
  let limit = defaultLimit;
  let spoilerNsfw = defaultSpoiler;

  for (const arg of args) {
    const lower = arg.toLowerCase();
    if (lower === "nsfw") rating = "nsfw";
    else if (lower === "sfw") rating = "sfw";
    else if (lower === "all" || lower === "both") rating = "all";
    else if (lower === "nospoiler" || lower === "unspoiler" || lower === "clean" || lower === "nospoil") {
      spoilerNsfw = false;
    } else if (lower === "spoiler" || lower === "blur") {
      spoilerNsfw = true;
    } else {
      const num = parseInt(lower, 10);
      if (!isNaN(num) && num > 0 && num <= 50) {
        limit = num;
      }
    }
  }

  return { rating, limit, spoilerNsfw };
}

/**
 * Fetch top images from yande.re and send them grouped as Telegram albums.
 * Uses 1.5s pacing between albums to prevent Telegram rate-limiting,
 * and falls back to 5+5 albums if Telegram times out downloading 10 images concurrently.
 */
export async function sendBooruPostsToChat(
  api: TelegramApi,
  chatId: number | string,
  rating: RatingFilter,
  limit: number = 30,
  spoilerNsfw: boolean = false
): Promise<void> {
  const ratingLabel = rating === "all" ? "SFW+NSFW" : rating.toUpperCase();

  await api.sendMessage(
    chatId,
    `⏳ <i>Fetching top ${limit} images from <b>yande.re</b>...</i>`
  );

  try {
    const posts = await fetchYanderePosts(rating, limit);
    if (posts.length === 0) {
      await api.sendMessage(
        chatId,
        `⚠️ No images found matching rating <b>${ratingLabel}</b> on yande.re today.`
      );
      return;
    }

    const todayDate = new Date().toISOString().split("T")[0];
    const displayCount = Math.min(posts.length, limit);

    const mediaGroup: InputMediaPhoto[] = posts.slice(0, displayCount).map((post, idx) => {
      const isFirst = idx === 0;
      let caption = "";
      if (isFirst) {
        caption = `🌟 <b>Top ${displayCount} Today • yande.re</b>\n📅 ${todayDate}\n\n`;
      }
      const ratingBadge = post.isNsfw ? "⚠️ NSFW" : "🛡️ SFW";
      const artistStr = post.artist ? ` • 🎨 ${escapeHtml(post.artist)}` : "";
      caption += `#${idx + 1} <b>Score:</b> ${post.score} (${ratingBadge})${artistStr}\n🔗 <a href="${post.postUrl}">View on yande.re</a>`;

      return {
        type: "photo",
        media: post.imageUrl,
        caption: caption.slice(0, 1024),
        parse_mode: "HTML",
        has_spoiler: spoilerNsfw && post.isNsfw,
      };
    });

    let totalSent = 0;

    // Telegram sendMediaGroup accepts 2-10 items per album.
    // Batch in chunks of 10.
    for (let i = 0; i < mediaGroup.length; i += 10) {
      const batch = mediaGroup.slice(i, i + 10);

      if (i > 0) {
        // Wait 1.5s between media groups to satisfy Telegram's single-chat rate limit (1 msg/sec)
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }

      if (batch.length === 1) {
        const item = batch[0];
        const photoRes = await api.sendPhoto(chatId, item.media, {
          caption: item.caption,
          has_spoiler: item.has_spoiler,
          parse_mode: item.parse_mode,
        });
        if (photoRes.ok) totalSent++;
      } else {
        // 1. Primary: send 10-image album
        let sendResult = await api.sendMediaGroup(chatId, batch);
        if (!sendResult.ok) {
          console.warn(`Album batch failed (${sendResult.description}), waiting 1.5s to retry...`);
          await new Promise((resolve) => setTimeout(resolve, 1500));
          sendResult = await api.sendMediaGroup(chatId, batch);
        }

        if (sendResult.ok) {
          totalSent += batch.length;
        } else {
          // 2. Resilient Fallback: split into two 5-image albums to avoid Telegram concurrent download timeouts
          console.warn(`Album retry failed (${sendResult.description}), splitting into 5+5 albums...`);
          const subBatch1 = batch.slice(0, 5);
          const subBatch2 = batch.slice(5);

          await new Promise((resolve) => setTimeout(resolve, 1200));
          const res1 = await api.sendMediaGroup(chatId, subBatch1);
          if (res1.ok) {
            totalSent += subBatch1.length;
          } else {
            for (const item of subBatch1) {
              await new Promise((resolve) => setTimeout(resolve, 350));
              const photoRes = await api.sendPhoto(chatId, item.media, {
                caption: item.caption,
                has_spoiler: item.has_spoiler,
                parse_mode: item.parse_mode,
              });
              if (photoRes.ok) totalSent++;
            }
          }

          if (subBatch2.length > 0) {
            await new Promise((resolve) => setTimeout(resolve, 1200));
            const res2 = await api.sendMediaGroup(chatId, subBatch2);
            if (res2.ok) {
              totalSent += subBatch2.length;
            } else {
              for (const item of subBatch2) {
                await new Promise((resolve) => setTimeout(resolve, 350));
                const photoRes = await api.sendPhoto(chatId, item.media, {
                  caption: item.caption,
                  has_spoiler: item.has_spoiler,
                  parse_mode: item.parse_mode,
                });
                if (photoRes.ok) totalSent++;
              }
            }
          }
        }
      }
    }

    // Emergency fallback if all photos were rejected
    if (totalSent === 0) {
      let textSummary = `🌟 <b>Top ${displayCount} Today • yande.re</b> [${ratingLabel}]\n📅 ${todayDate}\n\n`;
      posts.slice(0, displayCount).forEach((p, i) => {
        textSummary += `${i + 1}. <a href="${p.postUrl}">Post #${p.id}</a> - Score: ${p.score} [${p.rating.toUpperCase()}]\n`;
      });
      await api.sendMessage(chatId, textSummary, { disable_web_page_preview: false });
    }
  } catch (err: any) {
    console.error("sendBooruPostsToChat error:", err);
    await api.sendMessage(
      chatId,
      `❌ Failed to load images: ${escapeHtml(err?.message || "Unknown error")}`
    );
  }
}

/**
 * Telegram Message Router
 */
export async function handleTelegramMessage(
  message: TelegramMessage,
  env: Env
): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const api = new TelegramApi(token);
  const from = message.from;
  const chat = message.chat;
  const text = (message.text || "").trim();

  // Strict owner restriction: only @cheytac29 / 1368225736
  if (!isOwner(from, env)) {
    await api.sendMessage(chat.id, "Access Denied: You don't have permission");
    return;
  }

  const [command, ...args] = text.split(/\s+/);
  const cmd = command.toLowerCase().replace(/@.+$/, "");
  const config = getConfig(env);

  switch (cmd) {
    case "/start": {
      await api.sendMessage(
        chat.id,
        `🌸 <b>Scene</b>\n\n` +
          `Daily & on-demand top anime art from <b>yande.re</b>.\n\n` +
          `<b>Available Commands:</b>\n` +
          `• <code>/today [count] [sfw|nsfw|all]</code> - Fetch top images (defaults to ${config.limit}, ALL rating)\n` +
          `• <code>/yan [count] [sfw|nsfw|all]</code> - Shortcut for yande.re\n` +
          `• <code>/settings</code> - View active configuration\n` +
          `• <code>/myid</code> - View your Telegram Chat ID\n` +
          `• <code>/test_cron</code> - Test daily 8:00 AM delivery right now\n` +
          `• <code>/help</code> - Command reference`
      );
      break;
    }

    case "/help": {
      await api.sendMessage(
        chat.id,
        `📖 <b>Help & Command Reference</b>\n\n` +
          `<b>Fetch Commands:</b>\n` +
          `• <code>/today [count] [rating]</code> - Pull top images (e.g. <code>/today</code>, <code>/today 15</code>, <code>/today 30 nsfw</code>)\n` +
          `• <code>/yan [count] [rating]</code> - Shortcut for yande.re\n\n` +
          `<b>Info & Diagnostics:</b>\n` +
          `• <code>/settings</code> - Inspect active environment variables\n` +
          `• <code>/myid</code> - View your Telegram Chat ID\n` +
          `• <code>/test_cron</code> - Run the scheduled broadcast immediately in chat`
      );
      break;
    }

    case "/today":
    case "/top":
    case "/top10":
    case "/top15":
    case "/top30":
    case "/yan":
    case "/yandere": {
      const parsed = parseCommandArgs(args, config.rating, config.limit, config.spoilerNsfw);
      await sendBooruPostsToChat(
        api,
        chat.id,
        parsed.rating,
        parsed.limit,
        parsed.spoilerNsfw
      );
      break;
    }

    case "/settings":
    case "/panel":
    case "/config": {
      await api.sendMessage(chat.id, formatSettingsText(config), {
        reply_markup: {
          inline_keyboard: [
            [{ text: `🚀 Fetch Top ${config.limit} Now`, callback_data: "fetch_top" }],
            [{ text: `⏰ Test 8:00 AM Delivery Now`, callback_data: "test_cron" }],
            [
              { text: "🛡️ Top 10 SFW", callback_data: "fetch_sfw" },
              { text: "⚠️ Top 10 NSFW", callback_data: "fetch_nsfw" },
            ],
          ],
        },
      });
      break;
    }

    case "/id":
    case "/myid":
    case "/chatid": {
      await api.sendMessage(
        chat.id,
        `🆔 <b>Your Telegram Chat ID:</b> <code>${chat.id}</code>\n` +
          `👤 <b>Username:</b> @${from?.username || "unknown"}\n\n` +
          `✅ <b>Configured Owner:</b> <code>${config.ownerChatId}</code>\n\n` +
          `💡 <i>You can run <code>/test_cron</code> to test the scheduled broadcast immediately!</i>`
      );
      break;
    }

    case "/test_cron":
    case "/runcron":
    case "/cron": {
      await api.sendMessage(
        chat.id,
        `⏰ <b>Testing Daily Scheduled Cron:</b>\n\n` +
          `• <b>Chat ID:</b> <code>${chat.id}</code>\n` +
          `• <b>Source:</b> <code>yande.re</code>\n` +
          `• <b>Rating:</b> <code>${config.rating}</code>\n` +
          `• <b>Count:</b> <code>${config.limit} images</code>\n` +
          `• <b>Schedule:</b> <code>8:00 AM UTC+7 (01:00 UTC)</code>\n\n` +
          `<i>Executing broadcast now...</i>`
      );

      const resultMsg = await handleScheduledBroadcast(env);
      await api.sendMessage(chat.id, `🏁 <b>Cron test finished:</b> ${resultMsg}`);
      break;
    }

    default:
      // Unknown command: guide to /help
      if (text.startsWith("/")) {
        await api.sendMessage(
          chat.id,
          `ℹ️ Unknown command: <code>${escapeHtml(cmd)}</code>\nUse /today to fetch images or /help for commands.`
        );
      }
      break;
  }
}

/**
 * Telegram Interactive Inline Button Handler
 */
export async function handleTelegramCallbackQuery(
  callbackQuery: TelegramCallbackQuery,
  env: Env
): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const api = new TelegramApi(token);
  const msg = callbackQuery.message;
  const from = callbackQuery.from;

  if (!msg || !isOwner(from, env)) {
    await api.answerCallbackQuery(callbackQuery.id, "Access Denied");
    return;
  }

  const config = getConfig(env);

  switch (callbackQuery.data) {
    case "fetch_top": {
      await api.answerCallbackQuery(callbackQuery.id, `Fetching top ${config.limit}...`);
      await sendBooruPostsToChat(
        api,
        msg.chat.id,
        config.rating,
        config.limit,
        config.spoilerNsfw
      );
      break;
    }

    case "test_cron": {
      await api.answerCallbackQuery(callbackQuery.id, "Testing daily delivery...");
      const result = await handleScheduledBroadcast(env);
      await api.sendMessage(msg.chat.id, `🏁 <b>Cron test result:</b> ${result}`);
      break;
    }

    case "fetch_sfw": {
      await api.answerCallbackQuery(callbackQuery.id, "Fetching top 10 SFW...");
      await sendBooruPostsToChat(api, msg.chat.id, "sfw", 10, false);
      break;
    }

    case "fetch_nsfw": {
      await api.answerCallbackQuery(callbackQuery.id, "Fetching top 10 NSFW...");
      await sendBooruPostsToChat(api, msg.chat.id, "nsfw", 10, config.spoilerNsfw);
      break;
    }

    default:
      await api.answerCallbackQuery(callbackQuery.id);
  }
}

/**
 * Daily Scheduled Broadcast Execution.
 * Pushes top anime art from yande.re directly to the owner at 8:00 AM UTC+7.
 */
export async function handleScheduledBroadcast(env: Env): Promise<string> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const api = new TelegramApi(token);
  const config = getConfig(env);

  const targets = new Set<number | string>();
  if (config.ownerChatId) targets.add(config.ownerChatId);
  config.subscribedChatIds.forEach((id) => targets.add(id));

  let sentCount = 0;
  for (const chatId of targets) {
    try {
      await sendBooruPostsToChat(
        api,
        chatId,
        config.rating,
        config.limit,
        config.spoilerNsfw
      );
      sentCount++;
    } catch (err) {
      console.error(`Daily broadcast failed for chat ${chatId}:`, err);
    }
  }

  return `Broadcast sent to ${sentCount}/${targets.size} chats.`;
}
