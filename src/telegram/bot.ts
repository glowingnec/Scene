import {
  Env,
  TelegramMessage,
  TelegramCallbackQuery,
  TelegramUser,
  InputMediaPhoto,
  InlineKeyboardMarkup,
  BooruPost,
  BooruSource,
  RatingFilter,
} from "../types";
import { TelegramApi } from "./api";
import {
  getSettings,
  updateOwnerChatId,
  setRating,
  setSource,
  setLimit,
  setSpoiler,
  saveSettings,
} from "../storage/kv";
import { fetchBooruPosts } from "../services/booru";

export function isOwner(from: TelegramUser | undefined, env: Env): boolean {
  if (!from || !from.username) return false;
  const configuredOwner = (env.OWNER_USERNAME || "cheytac29")
    .replace(/^@/, "")
    .toLowerCase();
  return from.username.toLowerCase() === configuredOwner;
}

export function escapeHtml(str: string): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getRatingBadgeText(rating: RatingFilter): string {
  switch (rating) {
    case "sfw":
      return "SFW Mode 🛡️";
    case "nsfw":
      return "NSFW Mode ⚠️";
    case "all":
      return "Both SFW+NSFW 🌈";
  }
}

function getSourceName(source: BooruSource): string {
  return source === "gelbooru" ? "Gelbooru" : "yande.re";
}

function getSettingsKeyboard(
  source: BooruSource,
  rating: RatingFilter,
  limit: number,
  spoilerNsfw: boolean = true
): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: `📁 Source: ${getSourceName(source)} 🟢`,
          callback_data: "toggle_source",
        },
      ],
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
          text: `🔢 Default Count: ${limit} images`,
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

function formatSettingsPanelText(settings: {
  source: BooruSource;
  rating: RatingFilter;
  limit: number;
  spoilerNsfw?: boolean;
}): string {
  const spoilerText = settings.spoilerNsfw !== false ? "Enabled (Blurred) 🙈" : "Disabled (Unblurred) 👁️";
  return (
    `⚙️ <b>Bot Settings Panel</b>\n\n` +
    `• <b>Default Source:</b> <code>${getSourceName(settings.source)}</code>\n` +
    `• <b>Rating Filter:</b> <code>${getRatingBadgeText(settings.rating)}</code>\n` +
    `• <b>NSFW Spoilers:</b> <code>${spoilerText}</code>\n` +
    `• <b>Default Everyday Count:</b> <code>${settings.limit} images</code>\n` +
    `• <b>Daily Schedule:</b> <code>8:00 AM UTC+7 (01:00 UTC)</code>\n\n` +
    `💡 <i>Tips: Use <code>/limit &lt;1-50&gt;</code> to set count, or <code>/spoiler off</code> to un-spoiler by default.</i>\n\n` +
    `Use the buttons below to customize:`
  );
}

export async function sendBooruPostsToChat(
  api: TelegramApi,
  chatId: number | string,
  source: BooruSource,
  rating: RatingFilter,
  limit: number = 10,
  workerOrigin?: string,
  gelbooruAuth?: { userId?: string; apiKey?: string },
  spoilerNsfw: boolean = true
): Promise<void> {
  const sourceName = getSourceName(source);
  const ratingLabel = rating === "all" ? "SFW+NSFW" : rating.toUpperCase();

  await api.sendMessage(
    chatId,
    `⏳ <i>Fetching top ${limit} images from <b>${sourceName}</b> [${ratingLabel}]...</i>`
  );

  try {
    const posts = await fetchBooruPosts(source, rating, limit, gelbooruAuth);

    if (posts.length === 0) {
      await api.sendMessage(
        chatId,
        `⚠️ No images found matching rating <b>${ratingLabel}</b> on ${sourceName} today. Try adjusting rating or switching source.`
      );
      return;
    }

    const todayDate = new Date().toISOString().split("T")[0];
    const displayCount = Math.min(posts.length, limit);

    const mediaGroup: InputMediaPhoto[] = posts.slice(0, displayCount).map((post, idx) => {
      const isFirst = idx === 0;
      let caption = "";

      if (isFirst) {
        caption = `🌟 <b>Top ${displayCount} Today • ${sourceName}</b> [${ratingLabel}]\n📅 ${todayDate}\n\n`;
      }

      const ratingBadge = post.isNsfw ? "⚠️ NSFW" : "🛡️ SFW";
      const artistStr = post.artist ? ` • 🎨 ${escapeHtml(post.artist)}` : "";
      caption += `#${idx + 1} <b>Score:</b> ${post.score} (${ratingBadge})${artistStr}\n🔗 <a href="${post.postUrl}">View on ${sourceName}</a>`;

      let resolvedImageUrl = post.imageUrl;
      if (workerOrigin && post.imageUrl.includes("gelbooru.com")) {
        resolvedImageUrl = `${workerOrigin}/proxy?url=${encodeURIComponent(post.imageUrl)}`;
      }

      const shouldSpoiler = spoilerNsfw && post.isNsfw;

      return {
        type: "photo",
        media: resolvedImageUrl,
        caption: caption.slice(0, 1024),
        parse_mode: "HTML",
        has_spoiler: shouldSpoiler,
      };
    });

    let totalSent = 0;

    // Telegram sendMediaGroup accepts 2-10 items. For limits > 10, batch in chunks of 10.
    for (let i = 0; i < mediaGroup.length; i += 10) {
      const batch = mediaGroup.slice(i, i + 10);

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
        const sendResult = await api.sendMediaGroup(chatId, batch);
        if (sendResult.ok) {
          totalSent += batch.length;
        } else {
          console.warn("sendMediaGroup batch failed, falling back to sendPhoto:", sendResult.description);
          for (const item of batch) {
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
      let textSummary = `🌟 <b>Top ${displayCount} Today • ${sourceName}</b> [${ratingLabel}]\n📅 ${todayDate}\n\n`;
      posts.slice(0, displayCount).forEach((p, i) => {
        textSummary += `${i + 1}. <a href="${p.postUrl}">Post #${p.id}</a> - Score: ${p.score} [${p.rating.toUpperCase()}]\n`;
      });
      await api.sendMessage(chatId, textSummary, { disable_web_page_preview: false });
    }
  } catch (err: any) {
    console.error("Error in sendBooruPostsToChat:", err);
    await api.sendMessage(
      chatId,
      `❌ Failed to load images: ${escapeHtml(err?.message || "Unknown error")}`
    );
  }
}

function parseCommandArgs(
  args: string[],
  defaultRating: RatingFilter,
  defaultLimit: number,
  defaultSpoiler: boolean = true
): { rating: RatingFilter; limit: number; spoilerNsfw: boolean } {
  let rating = defaultRating;
  let limit = defaultLimit;
  let spoilerNsfw = defaultSpoiler;

  for (const arg of args) {
    const lower = arg.toLowerCase();
    if (lower === "nsfw") rating = "nsfw";
    else if (lower === "sfw") rating = "sfw";
    else if (lower === "all" || lower === "both") rating = "all";
    else if (lower === "nospoiler" || lower === "unspoiler" || lower === "unspoiled" || lower === "clean") {
      spoilerNsfw = false;
    } else if (lower === "spoiler" || lower === "spoiled" || lower === "blur") {
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
  env: Env,
  workerOrigin?: string
): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN || (globalThis as any).TELEGRAM_BOT_TOKEN;
  const api = new TelegramApi(token);
  const from = message.from;
  const chat = message.chat;
  const text = (message.text || "").trim();
  const owner = isOwner(from, env);

  if (!owner) {
    await api.sendMessage(chat.id, "Access Denied: You don't have permission");
    return;
  }

  await updateOwnerChatId(env, chat.id);

  const [command, ...args] = text.split(/\s+/);
  const cmd = command.toLowerCase().replace(/@.+$/, "");

  const gelbooruAuth =
    env.GELBOORU_USER_ID && env.GELBOORU_API_KEY
      ? { userId: env.GELBOORU_USER_ID, apiKey: env.GELBOORU_API_KEY }
      : undefined;

  switch (cmd) {
    case "/start": {
      await api.sendMessage(
        chat.id,
        `🌸 <b>Booru Today Bot</b>\n\n` +
          `Daily & on-demand top anime art from yande.re & Gelbooru.\n\n` +
          `<b>Available Commands:</b>\n` +
          `• <code>/today [count] [sfw|nsfw|all]</code> - Fetch today's top images\n` +
          `• <code>/yan [count] [sfw|nsfw|all]</code> - yande.re top images\n` +
          `• <code>/gel [count] [sfw|nsfw|all]</code> - Gelbooru top images\n` +
          `• <code>/settings</code> - Interactive configuration panel\n` +
          `• <code>/limit &lt;1-50&gt;</code> - Set default everyday image count (e.g. <code>/limit 15</code>)\n` +
          `• <code>/spoiler [on|off]</code> - Toggle NSFW spoiler blur\n` +
          `• <code>/unspoiler</code> - Unblur images by default\n` +
          `• <code>/source &lt;yandere|gelbooru&gt;</code> - Set default source\n` +
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
          `• <code>/yan [count] [rating]</code> - Pull yande.re top images\n` +
          `  <i>Examples: <code>/yan</code>, <code>/yan 15</code>, <code>/yan 20 all</code></i>\n` +
          `• <code>/gel [count] [rating]</code> - Pull Gelbooru top images\n` +
          `  <i>Examples: <code>/gel</code>, <code>/gel 15</code>, <code>/gel 20 nsfw</code></i>\n` +
          `• <code>/today [count] [rating]</code> - Pull with default source\n\n` +
          `<b>Configuration:</b>\n` +
          `• <code>/settings</code> - Interactive control panel\n` +
          `• <code>/limit &lt;1-50&gt;</code> - Set default everyday image count (e.g. <code>/limit 15</code>)\n` +
          `• <code>/spoiler [on|off]</code> - Enable or disable spoiler blur\n` +
          `• <code>/unspoiler</code> - Turn off spoiler blur by default\n` +
          `• <code>/source &lt;yandere|gelbooru&gt;</code> - Set default source\n` +
          `• <code>/sfw</code> - Set default rating to SFW (Safe only)\n` +
          `• <code>/nsfw</code> - Set default rating to NSFW (Questionable / Explicit)\n` +
          `• <code>/all</code> - Set default rating to Both (SFW + NSFW)\n` +
          `• <code>/subscribe</code> - Register chat for daily 8:00 AM delivery\n` +
          `• <code>/unsubscribe</code> - Cancel daily delivery`
      );
      break;
    }

    case "/today":
    case "/top10": {
      const settings = await getSettings(env);
      const parsed = parseCommandArgs(args, settings.rating, settings.limit, settings.spoilerNsfw !== false);
      await sendBooruPostsToChat(
        api,
        chat.id,
        settings.source,
        parsed.rating,
        parsed.limit,
        workerOrigin,
        gelbooruAuth,
        parsed.spoilerNsfw
      );
      break;
    }

    case "/yan":
    case "/yandere": {
      const settings = await getSettings(env);
      const parsed = parseCommandArgs(args, settings.rating, settings.limit, settings.spoilerNsfw !== false);
      await sendBooruPostsToChat(
        api,
        chat.id,
        "yandere",
        parsed.rating,
        parsed.limit,
        workerOrigin,
        gelbooruAuth,
        parsed.spoilerNsfw
      );
      break;
    }

    case "/gel":
    case "/gbr":
    case "/gelbooru": {
      const settings = await getSettings(env);
      const parsed = parseCommandArgs(args, settings.rating, settings.limit, settings.spoilerNsfw !== false);
      await sendBooruPostsToChat(
        api,
        chat.id,
        "gelbooru",
        parsed.rating,
        parsed.limit,
        workerOrigin,
        gelbooruAuth,
        parsed.spoilerNsfw
      );
      break;
    }

    case "/test_gel": {
      const userId = env.GELBOORU_USER_ID;
      const apiKey = env.GELBOORU_API_KEY;
      const maskedKey = apiKey ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : "NOT_SET";

      let testUrl = "https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&limit=1";
      if (userId && apiKey) {
        testUrl += `&user_id=${encodeURIComponent(userId)}&api_key=${encodeURIComponent(apiKey)}`;
      }

      await api.sendMessage(chat.id, "🔍 Testing Gelbooru API connection directly...");

      try {
        const startTime = Date.now();
        const res = await fetch(testUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json, text/plain, */*",
          },
        });
        const duration = Date.now() - startTime;
        const text = await res.text();
        const snippet = text.slice(0, 350).replace(/</g, "&lt;").replace(/>/g, "&gt;");

        await api.sendMessage(
          chat.id,
          `📊 <b>Gelbooru API Diagnostic Results:</b>\n\n` +
            `• <b>HTTP Status:</b> <code>${res.status} ${res.statusText}</code>\n` +
            `• <b>Response Time:</b> <code>${duration}ms</code>\n` +
            `• <b>GELBOORU_USER_ID:</b> <code>${userId || "NOT_SET"}</code>\n` +
            `• <b>GELBOORU_API_KEY:</b> <code>${maskedKey}</code>\n\n` +
            `<b>Response Body Snippet:</b>\n<pre>${snippet}</pre>`
        );
      } catch (err: any) {
        await api.sendMessage(
          chat.id,
          `❌ <b>Fetch Error:</b> <code>${escapeHtml(err?.message || "Unknown error")}</code>`
        );
      }
      break;
    }

    case "/settings":
    case "/panel": {
      const settings = await getSettings(env);
      await api.sendMessage(chat.id, formatSettingsPanelText(settings), {
        reply_markup: getSettingsKeyboard(
          settings.source,
          settings.rating,
          settings.limit,
          settings.spoilerNsfw !== false
        ),
      });
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
        enabled = settings.spoilerNsfw === false ? true : false;
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
        `🔢 <b>Default everyday count set to:</b> <code>${updated.limit} images</code>\n<i>This will be used for daily deliveries and default /today, /yan, and /gel commands.</i>`
      );
      break;
    }

    case "/source": {
      const target = args[0]?.toLowerCase();
      let resolvedSource: BooruSource | null = null;
      if (target === "gelbooru" || target === "gel" || target === "gbr") resolvedSource = "gelbooru";
      else if (target === "yandere" || target === "yan") resolvedSource = "yandere";

      if (!resolvedSource) {
        await api.sendMessage(
          chat.id,
          "ℹ️ Available sources: <code>yandere</code> or <code>gelbooru</code>"
        );
        return;
      }

      const updated = await setSource(env, resolvedSource);
      await api.sendMessage(chat.id, `📁 <b>Default source updated to:</b> <code>${getSourceName(updated.source)}</code>`);
      break;
    }

    case "/subscribe": {
      await updateOwnerChatId(env, chat.id);
      await api.sendMessage(chat.id, "✅ This chat is registered for daily 8:00 AM UTC+7 deliveries.");
      break;
    }

    case "/unsubscribe": {
      const settings = await getSettings(env);
      const filtered = settings.subscribedChatIds.filter((id) => id !== chat.id);
      await saveSettings(env, { ...settings, subscribedChatIds: filtered });
      await api.sendMessage(chat.id, "🔕 This chat unsubscribed from daily deliveries.");
      break;
    }
  }
}

export async function handleTelegramCallbackQuery(
  callbackQuery: TelegramCallbackQuery,
  env: Env,
  workerOrigin?: string
): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN || (globalThis as any).TELEGRAM_BOT_TOKEN;
  const api = new TelegramApi(token);
  const from = callbackQuery.from;
  const owner = isOwner(from, env);

  if (!owner) {
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

  const gelbooruAuth =
    env.GELBOORU_USER_ID && env.GELBOORU_API_KEY
      ? { userId: env.GELBOORU_USER_ID, apiKey: env.GELBOORU_API_KEY }
      : undefined;

  switch (callbackQuery.data) {
    case "toggle_source": {
      const nextSource: BooruSource = settings.source === "yandere" ? "gelbooru" : "yandere";
      settings = await setSource(env, nextSource);
      await api.answerCallbackQuery(callbackQuery.id, `Source switched to ${getSourceName(nextSource)}`);
      await api.editMessageText(
        msg.chat.id,
        msg.message_id,
        formatSettingsPanelText(settings),
        {
          reply_markup: getSettingsKeyboard(
            settings.source,
            settings.rating,
            settings.limit,
            settings.spoilerNsfw !== false
          ),
        }
      );
      break;
    }

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
            settings.source,
            settings.rating,
            settings.limit,
            settings.spoilerNsfw !== false
          ),
        }
      );
      break;
    }

    case "toggle_spoiler": {
      const nextSpoiler = settings.spoilerNsfw === false ? true : false;
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
            settings.source,
            settings.rating,
            settings.limit,
            settings.spoilerNsfw !== false
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
            settings.source,
            settings.rating,
            settings.limit,
            settings.spoilerNsfw !== false
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
        settings.source,
        settings.rating,
        settings.limit,
        workerOrigin,
        gelbooruAuth,
        settings.spoilerNsfw !== false
      );
      break;
    }

    default:
      await api.answerCallbackQuery(callbackQuery.id);
  }
}

export async function handleScheduledBroadcast(env: Env, workerOrigin?: string): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN || (globalThis as any).TELEGRAM_BOT_TOKEN;
  const api = new TelegramApi(token);
  const settings = await getSettings(env);

  const gelbooruAuth =
    env.GELBOORU_USER_ID && env.GELBOORU_API_KEY
      ? { userId: env.GELBOORU_USER_ID, apiKey: env.GELBOORU_API_KEY }
      : undefined;

  const targets = new Set<number>();
  if (settings.ownerChatId) targets.add(settings.ownerChatId);
  settings.subscribedChatIds.forEach((id) => targets.add(id));

  if (targets.size === 0) {
    console.warn("No registered chats found for daily broadcast.");
    return;
  }

  for (const chatId of targets) {
    try {
      await sendBooruPostsToChat(
        api,
        chatId,
        settings.source,
        settings.rating,
        settings.limit,
        workerOrigin,
        gelbooruAuth,
        settings.spoilerNsfw !== false
      );
    } catch (err) {
      console.error(`Daily broadcast failed for chat ${chatId}:`, err);
    }
  }
}
