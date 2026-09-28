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
import {
  getSettings,
  saveSettings,
  setRating,
  setLimit,
  setSpoiler,
  updateOwnerChatId,
} from "../storage/kv";
import { fetchYanderePosts } from "../services/yandere";

const DEFAULT_CONFIG = {
  OWNER_USERNAME: "cheytac29",
  OWNER_CHAT_ID: "1368225736",
  DEFAULT_RATING: "all" as RatingFilter,
  DEFAULT_LIMIT: 30,
  DEFAULT_SPOILER_NSFW: false,
};

function isOwner(from: TelegramUser | undefined, env: Env): boolean {
  if (!from) return false;
  const ownerUsername = (env.OWNER_USERNAME || DEFAULT_CONFIG.OWNER_USERNAME)
    .toLowerCase()
    .replace(/^@/, "");
  const ownerChatId = (env.OWNER_CHAT_ID || DEFAULT_CONFIG.OWNER_CHAT_ID).toString();

  if (from.username && from.username.toLowerCase() === ownerUsername) {
    return true;
  }
  if (from.id && from.id.toString() === ownerChatId) {
    return true;
  }
  return false;
}

function escapeHtml(text: string): string {
  return text
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

function getSettingsKeyboard(rating: RatingFilter, limit: number, spoilerNsfw: boolean = false) {
  return {
    inline_keyboard: [
      [
        {
          text: `🔞 Rating: ${getRatingBadgeText(rating)}`,
          callback_data: "toggle_rating",
        },
      ],
      [
        {
          text: spoilerNsfw ? "🙈 Spoilers: ON (Blurred)" : "👁️ Spoilers: OFF (Unblurred)",
          callback_data: "toggle_spoiler",
        },
      ],
      [
        {
          text: `🔢 Everyday Count: ${limit} images`,
          callback_data: "cycle_limit",
        },
      ],
      [
        {
          text: `🚀 Fetch Top ${limit} Now`,
          callback_data: "fetch_top",
        },
      ],
    ],
  };
}

function formatSettingsPanelText(settings: BotSettings): string {
  const spoilerText = settings.spoilerNsfw ? "Enabled (Blurred) 🙈" : "Disabled (Unblurred) 👁️";
  const targetText = settings.ownerChatId ? `<code>${settings.ownerChatId}</code>` : "<code>1368225736</code>";

  return (
    `⚙️ <b>Bot Settings Panel</b>\n\n` +
    `• <b>Source:</b> <code>yande.re</code>\n` +
    `• <b>Rating Filter:</b> <code>${getRatingBadgeText(settings.rating)}</code>\n` +
    `• <b>NSFW Spoilers:</b> <code>${spoilerText}</code>\n` +
    `• <b>Everyday Count:</b> <code>${settings.limit} images</code>\n` +
    `• <b>Target Chat ID:</b> ${targetText}\n` +
    `• <b>Daily Schedule:</b> <code>8:00 AM UTC+7 (01:00 UTC)</code>\n\n` +
    `💡 <i>Tips: Run <code>/limit &lt;1-50&gt;</code> to set count, or <code>/test_cron</code> to test daily delivery now.</i>\n\n` +
    `Use the buttons below to customize:`
  );
}

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
        caption = `🌟 <b>Top ${displayCount} Today • yande.re</b> [${ratingLabel}]\n📅 ${todayDate}\n\n`;
      }
      const ratingBadge = post.isNsfw ? "⚠️ NSFW" : "🛡️ SFW";
      const artistStr = post.artist ? ` • 🎨 ${escapeHtml(post.artist)}` : "";
      caption += `#${idx + 1} <b>Score:</b> ${post.score} (${ratingBadge})${artistStr}\n🔗 <a href="${post.postUrl}">View on yande.re</a>`;

      const shouldSpoiler = spoilerNsfw && post.isNsfw;

      return {
        type: "photo",
        media: post.imageUrl,
        caption: caption.slice(0, 1024),
        parse_mode: "HTML",
        has_spoiler: shouldSpoiler,
      };
    });

    let totalSent = 0;

    // Telegram sendMediaGroup accepts 2-10 items. For limits > 10, batch in chunks of 10.
    for (let i = 0; i < mediaGroup.length; i += 10) {
      const batch = mediaGroup.slice(i, i + 10);

      if (i > 0) {
        // Wait 1.5s between media groups to satisfy Telegram's 1 msg/sec single-chat rate limit
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
        else console.warn("sendPhoto for single item failed:", photoRes.description);
      } else {
        let sendResult = await api.sendMediaGroup(chatId, batch);
        if (!sendResult.ok) {
          console.warn(`sendMediaGroup batch failed (${sendResult.description}), waiting 2s to retry...`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
          sendResult = await api.sendMediaGroup(chatId, batch);
        }

        if (sendResult.ok) {
          totalSent += batch.length;
        } else {
          console.warn("sendMediaGroup retry failed, falling back to sendPhoto:", sendResult.description);
          for (const item of batch) {
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

export async function handleTelegramMessage(
  message: TelegramMessage,
  env: Env
): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN || (globalThis as any).TELEGRAM_BOT_TOKEN;
  const api = new TelegramApi(token);
  const from = message.from;
  const chat = message.chat;
  const text = (message.text || "").trim();

  // Strict owner restriction: only @cheytac29 / 1368225736
  if (!isOwner(from, env)) {
    await api.sendMessage(chat.id, "Access Denied: You don't have permission");
    return;
  }

  await updateOwnerChatId(env, chat.id);

  const [command, ...args] = text.split(/\s+/);
  const cmd = command.toLowerCase().replace(/@.+$/, "");

  switch (cmd) {
    case "/start": {
      await api.sendMessage(
        chat.id,
        `🌸 <b>Booru Today Bot</b>\n\n` +
          `Daily & on-demand top anime art from <b>yande.re</b>.\n\n` +
          `<b>Available Commands:</b>\n` +
          `• <code>/today [count] [sfw|nsfw|all]</code> - Fetch top images (defaults to 30, ALL rating)\n` +
          `• <code>/yan [count] [sfw|nsfw|all]</code> - Shortcut for yande.re top images\n` +
          `• <code>/settings</code> - Interactive configuration panel\n` +
          `• <code>/myid</code> - View your Telegram Chat ID\n` +
          `• <code>/test_cron</code> - Test daily scheduled broadcast right now\n` +
          `• <code>/limit &lt;1-50&gt;</code> - Set everyday count (e.g. <code>/limit 30</code>)\n` +
          `• <code>/spoiler [on|off]</code> - Toggle NSFW spoiler blur\n` +
          `• <code>/unspoiler</code> - Unblur images by default\n` +
          `• <code>/sfw</code>, <code>/nsfw</code>, <code>/all</code> - Quick switch rating filter\n` +
          `• <code>/subscribe</code> - Register chat for daily 8:00 AM delivery\n` +
          `• <code>/unsubscribe</code> - Cancel daily delivery\n` +
          `• <code>/help</code> - Command reference`
      );
      break;
    }

    case "/help": {
      await api.sendMessage(
        chat.id,
        `📖 <b>Help & Command Reference</b>\n\n` +
          `<b>Fetch Commands:</b>\n` +
          `• <code>/today [count] [rating]</code> - Pull top images (e.g. <code>/today</code>, <code>/today 30</code>, <code>/today 30 nsfw</code>)\n` +
          `• <code>/yan [count] [rating]</code> - Shortcut for yande.re\n\n` +
          `<b>Configuration & Schedule:</b>\n` +
          `• <code>/settings</code> - Interactive control panel\n` +
          `• <code>/myid</code> - View your Telegram Chat ID\n` +
          `• <code>/test_cron</code> - Trigger daily broadcast test immediately\n` +
          `• <code>/limit &lt;1-50&gt;</code> - Set everyday count (e.g. <code>/limit 30</code>)\n` +
          `• <code>/spoiler [on|off]</code> - Enable or disable spoiler blur\n` +
          `• <code>/unspoiler</code> - Turn off spoiler blur by default\n` +
          `• <code>/sfw</code> - Set default rating to SFW (Safe only)\n` +
          `• <code>/nsfw</code> - Set default rating to NSFW (Questionable / Explicit)\n` +
          `• <code>/all</code> - Set default rating to Both (SFW + NSFW)\n` +
          `• <code>/subscribe</code> - Register chat for daily 8:00 AM delivery\n` +
          `• <code>/unsubscribe</code> - Cancel daily delivery`
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
      const settings = await getSettings(env);
      const parsed = parseCommandArgs(args, settings.rating, settings.limit, settings.spoilerNsfw);
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
    case "/panel": {
      const settings = await getSettings(env);
      await api.sendMessage(chat.id, formatSettingsPanelText(settings), {
        reply_markup: getSettingsKeyboard(
          settings.rating,
          settings.limit,
          settings.spoilerNsfw
        ),
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
          `✅ <b>Configured Owner:</b> <code>${env.OWNER_CHAT_ID || "1368225736"}</code>\n\n` +
          `💡 <i>You can run <code>/test_cron</code> to test the scheduled broadcast immediately!</i>`
      );
      break;
    }

    case "/test_cron":
    case "/runcron":
    case "/cron": {
      const settings = await getSettings(env);
      const ownerId = settings.ownerChatId || env.OWNER_CHAT_ID || 1368225736;
      const subscribers = settings.subscribedChatIds;

      await api.sendMessage(
        chat.id,
        `⏰ <b>Testing Daily Scheduled Cron:</b>\n\n` +
          `• <b>Your Chat ID:</b> <code>${chat.id}</code>\n` +
          `• <b>Configured Owner Chat ID:</b> <code>${ownerId}</code>\n` +
          `• <b>Subscribed Chat IDs:</b> <code>${subscribers.length > 0 ? subscribers.join(", ") : "None"}</code>\n` +
          `• <b>Source:</b> <code>yande.re</code>\n` +
          `• <b>Rating:</b> <code>${settings.rating}</code>\n` +
          `• <b>Limit:</b> <code>${settings.limit} images</code>\n` +
          `• <b>Daily Schedule:</b> <code>8:00 AM UTC+7 (01:00 UTC)</code>\n\n` +
          `<i>Executing broadcast now...</i>`
      );

      await updateOwnerChatId(env, chat.id);
      const resultMsg = await handleScheduledBroadcast(env);
      await api.sendMessage(chat.id, `🏁 <b>Cron test finished:</b> ${resultMsg}`);
      break;
    }

    case "/spoiler":
    case "/spoilers": {
      const arg = (args[0] || "").toLowerCase();
      let enabled: boolean;
      if (arg === "on" || arg === "enable" || arg === "1" || arg === "true") {
        enabled = true;
      } else if (arg === "off" || arg === "disable" || arg === "0" || arg === "false") {
        enabled = false;
      } else {
        const settings = await getSettings(env);
        enabled = !settings.spoilerNsfw;
      }
      const updated = await setSpoiler(env, enabled);
      if (updated.spoilerNsfw) {
        await api.sendMessage(chat.id, "🙈 <b>NSFW Spoilers enabled.</b> NSFW images will have Telegram spoiler blur applied.");
      } else {
        await api.sendMessage(chat.id, "👁️ <b>NSFW Spoilers disabled.</b> Images will be un-spoilered (unblurred) by default.");
      }
      break;
    }

    case "/unspoiler":
    case "/nospoiler": {
      await setSpoiler(env, false);
      await api.sendMessage(chat.id, "👁️ <b>NSFW Spoilers disabled.</b> Images will be un-spoilered (unblurred) by default.");
      break;
    }

    case "/sfw": {
      await setRating(env, "sfw");
      await api.sendMessage(chat.id, "🛡️ <b>Rating set to SFW.</b> Safe & general posts will be delivered.");
      break;
    }

    case "/nsfw": {
      await setRating(env, "nsfw");
      await api.sendMessage(chat.id, "⚠️ <b>Rating set to NSFW.</b> Questionable & explicit posts will be delivered.");
      break;
    }

    case "/all":
    case "/both": {
      await setRating(env, "all");
      await api.sendMessage(chat.id, "🌈 <b>Rating set to BOTH (SFW + NSFW).</b> All top posts will be delivered.");
      break;
    }

    case "/limit":
    case "/count": {
      const num = parseInt(args[0], 10);
      if (isNaN(num) || num < 1 || num > 50) {
        await api.sendMessage(chat.id, "ℹ️ Please specify a number between 1 and 50. Example: <code>/limit 15</code>");
        return;
      }
      const updated = await setLimit(env, num);
      await api.sendMessage(
        chat.id,
        `🔢 <b>Default everyday count set to:</b> <code>${updated.limit} images</code>\n<i>This will be used for daily deliveries and default /today commands.</i>`
      );
      break;
    }

    case "/subscribe": {
      await updateOwnerChatId(env, chat.id);
      await api.sendMessage(chat.id, "✅ This chat is registered for daily 8:00 AM UTC+7 deliveries.");
      break;
    }

    case "/unsubscribe": {
      const settings = await getSettings(env);
      const filtered = settings.subscribedChatIds.filter((id) => id.toString() !== chat.id.toString());
      await saveSettings(env, { ...settings, subscribedChatIds: filtered });
      await api.sendMessage(chat.id, "🔕 This chat unsubscribed from daily deliveries.");
      break;
    }
  }
}

export async function handleTelegramCallbackQuery(
  callbackQuery: TelegramCallbackQuery,
  env: Env
): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN || (globalThis as any).TELEGRAM_BOT_TOKEN;
  const api = new TelegramApi(token);
  const from = callbackQuery.from;

  // Strict owner restriction
  if (!isOwner(from, env)) {
    await api.answerCallbackQuery(
      callbackQuery.id,
      "Access Denied: You don't have permission",
      true
    );
    return;
  }

  const msg = callbackQuery.message;
  if (!msg) {
    await api.answerCallbackQuery(callbackQuery.id);
    return;
  }

  let settings = await getSettings(env);

  switch (callbackQuery.data) {
    case "toggle_rating": {
      const nextRating: RatingFilter =
        settings.rating === "sfw" ? "nsfw" : settings.rating === "nsfw" ? "all" : "sfw";
      settings = await setRating(env, nextRating);
      await api.answerCallbackQuery(callbackQuery.id, `Rating set to ${nextRating.toUpperCase()}`);
      await api.editMessageText(
        msg.chat.id,
        msg.message_id,
        formatSettingsPanelText(settings),
        {
          reply_markup: getSettingsKeyboard(
            settings.rating,
            settings.limit,
            settings.spoilerNsfw
          ),
        }
      );
      break;
    }

    case "toggle_spoiler": {
      const nextSpoiler = !settings.spoilerNsfw;
      settings = await setSpoiler(env, nextSpoiler);
      await api.answerCallbackQuery(
        callbackQuery.id,
        `Spoilers: ${nextSpoiler ? "ON (Blurred)" : "OFF (Unblurred)"}`
      );
      await api.editMessageText(
        msg.chat.id,
        msg.message_id,
        formatSettingsPanelText(settings),
        {
          reply_markup: getSettingsKeyboard(
            settings.rating,
            settings.limit,
            settings.spoilerNsfw
          ),
        }
      );
      break;
    }

    case "cycle_limit": {
      const limitSteps = [5, 10, 15, 20, 25, 30, 50];
      const currentIndex = limitSteps.indexOf(settings.limit);
      const nextLimit =
        currentIndex === -1 || currentIndex === limitSteps.length - 1
          ? limitSteps[0]
          : limitSteps[currentIndex + 1];
      settings = await setLimit(env, nextLimit);
      await api.answerCallbackQuery(callbackQuery.id, `Default count set to ${nextLimit} images`);
      await api.editMessageText(
        msg.chat.id,
        msg.message_id,
        formatSettingsPanelText(settings),
        {
          reply_markup: getSettingsKeyboard(
            settings.rating,
            settings.limit,
            settings.spoilerNsfw
          ),
        }
      );
      break;
    }

    case "fetch_top": {
      await api.answerCallbackQuery(callbackQuery.id, `Fetching top ${settings.limit}...`);
      await sendBooruPostsToChat(
        api,
        msg.chat.id,
        settings.rating,
        settings.limit,
        settings.spoilerNsfw
      );
      break;
    }

    default:
      await api.answerCallbackQuery(callbackQuery.id);
  }
}

export async function handleScheduledBroadcast(env: Env): Promise<string> {
  const token = env.TELEGRAM_BOT_TOKEN || (globalThis as any).TELEGRAM_BOT_TOKEN;
  const api = new TelegramApi(token);
  const settings = await getSettings(env);

  const targets = new Set<number | string>();
  if (settings.ownerChatId) targets.add(settings.ownerChatId);
  settings.subscribedChatIds.forEach((id) => targets.add(id));

  // Fallback to configured owner ID 1368225736
  if (targets.size === 0) {
    targets.add(env.OWNER_CHAT_ID || 1368225736);
  }

  let sentCount = 0;
  for (const chatId of targets) {
    try {
      await sendBooruPostsToChat(
        api,
        chatId,
        settings.rating,
        settings.limit,
        settings.spoilerNsfw
      );
      sentCount++;
    } catch (err) {
      console.error(`Daily broadcast failed for chat ${chatId}:`, err);
    }
  }
  return `Broadcast sent to ${sentCount}/${targets.size} chats.`;
}
