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
  saveSettings,
} from "../storage/kv";
import { fetchTop10Posts } from "../services/booru";

export function isOwner(from: TelegramUser | undefined, env: Env): boolean {
  if (!from || !from.username) return false;
  const configuredOwner = (env.OWNER_USERNAME || "cheytac29")
    .replace(/^@/, "")
    .toLowerCase();
  return from.username.toLowerCase() === configuredOwner;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getSettingsKeyboard(source: BooruSource, rating: RatingFilter): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: `📁 Source: ${source === "danbooru" ? "Danbooru 🟢" : "yande.re 🟢"}`,
          callback_data: "toggle_source",
        },
      ],
      [
        {
          text: `🔞 Rating: ${rating === "sfw" ? "SFW Mode 🛡️" : "NSFW Mode ⚠️"}`,
          callback_data: "toggle_rating",
        },
      ],
      [
        {
          text: "🚀 Fetch Top 10 Now",
          callback_data: "fetch_top10",
        },
      ],
    ],
  };
}

export async function sendTop10ToChat(
  api: TelegramApi,
  chatId: number | string,
  source: BooruSource,
  rating: RatingFilter
): Promise<void> {
  const sourceName = source === "danbooru" ? "Danbooru" : "yande.re";
  const statusMsg = await api.sendMessage(
    chatId,
    `⏳ <i>Fetching top 10 images from <b>${sourceName}</b> [${rating.toUpperCase()}]...</i>`
  );

  try {
    const posts = await fetchTop10Posts(source, rating);

    if (posts.length === 0) {
      await api.sendMessage(
        chatId,
        `⚠️ No images found matching rating <b>${rating.toUpperCase()}</b> on ${sourceName} today. Try toggling rating or switching source.`
      );
      return;
    }

    const todayDate = new Date().toISOString().split("T")[0];

    const mediaGroup: InputMediaPhoto[] = posts.slice(0, 10).map((post, idx) => {
      const isFirst = idx === 0;
      let caption = "";

      if (isFirst) {
        caption = `🌟 <b>Top 10 Today • ${sourceName}</b> [${rating.toUpperCase()}]\n📅 ${todayDate}\n\n`;
      }

      const ratingBadge = post.isNsfw ? "⚠️ NSFW" : "🛡️ SFW";
      const artistStr = post.artist ? ` • 🎨 ${escapeHtml(post.artist)}` : "";
      caption += `#${idx + 1} <b>Score:</b> ${post.score} (${ratingBadge})${artistStr}\n🔗 <a href="${post.postUrl}">View on ${sourceName}</a>`;

      return {
        type: "photo",
        media: post.imageUrl,
        caption: caption.slice(0, 1024),
        parse_mode: "HTML",
        has_spoiler: post.isNsfw,
      };
    });

    const sendResult = await api.sendMediaGroup(chatId, mediaGroup);

    // If sendMediaGroup failed (e.g. Telegram CDN fetch error or file size > 10MB)
    if (!sendResult.ok) {
      console.warn("sendMediaGroup failed, attempting individual photo delivery fallback:", sendResult.description);
      let successCount = 0;

      for (let i = 0; i < posts.length; i++) {
        const post = posts[i];
        const caption = `#${i + 1} <b>${sourceName}</b> • Score: ${post.score} [${post.rating.toUpperCase()}]\n🔗 <a href="${post.postUrl}">Post Link</a>`;
        const photoRes = await api.sendPhoto(chatId, post.imageUrl, {
          caption,
          has_spoiler: post.isNsfw,
          parse_mode: "HTML",
        });

        if (photoRes.ok) successCount++;
      }

      // If individual photos also failed (e.g. Telegram cannot reach image CDN), send rich HTML message
      if (successCount === 0) {
        let textSummary = `🌟 <b>Top 10 Today • ${sourceName}</b> [${rating.toUpperCase()}]\n📅 ${todayDate}\n\n`;
        posts.slice(0, 10).forEach((p, i) => {
          textSummary += `${i + 1}. <a href="${p.postUrl}">Post #${p.id}</a> - Score: ${p.score} [${p.rating.toUpperCase()}]\n`;
        });
        await api.sendMessage(chatId, textSummary, { disable_web_page_preview: false });
      }
    }
  } catch (err: any) {
    console.error("Error in sendTop10ToChat:", err);
    await api.sendMessage(
      chatId,
      `❌ Failed to load images: ${escapeHtml(err?.message || "Unknown error")}`
    );
  }
}

export async function handleTelegramMessage(
  message: TelegramMessage,
  env: Env
): Promise<void> {
  const api = new TelegramApi(env.TELEGRAM_BOT_TOKEN);
  const from = message.from;
  const chat = message.chat;
  const text = (message.text || "").trim();
  const owner = isOwner(from, env);

  // If owner interacts, automatically record owner's chat ID for cron broadcasts
  if (owner) {
    await updateOwnerChatId(env, chat.id);
  }

  // Access check if bot is configured strictly for owner only
  const restrictAll = env.RESTRICT_ALL_TO_OWNER === "true";
  if (restrictAll && !owner) {
    await api.sendMessage(
      chat.id,
      "⛔ <b>Access Denied:</b> This bot is exclusively configured for its owner (@cheytac29)."
    );
    return;
  }

  const [command, ...args] = text.split(/\s+/);
  const cmd = command.toLowerCase().replace(/@.+$/, ""); // strip bot username in commands

  switch (cmd) {
    case "/start": {
      const ownerNotice = owner
        ? "👑 <b>Owner recognized!</b> Your chat has been registered for daily top 10 deliveries."
        : `👋 Welcome! (Bot Owner: @cheytac29)`;

      await api.sendMessage(
        chat.id,
        `🌸 <b>Booru Today Bot</b>\n\n` +
          `Daily & on-demand top 10 anime art from Danbooru and yande.re.\n\n` +
          `${ownerNotice}\n\n` +
          `<b>Available Commands:</b>\n` +
          `• <code>/today</code> or <code>/top10</code> - Fetch today's top 10 images\n` +
          `• <code>/danbooru</code> - Fetch top 10 from Danbooru\n` +
          `• <code>/yandere</code> - Fetch top 10 from yande.re\n` +
          `• <code>/settings</code> - View & toggle SFW/NSFW & Source (Owner only)\n` +
          `• <code>/sfw</code> - Switch to SFW mode (Owner only)\n` +
          `• <code>/nsfw</code> - Switch to NSFW mode (Owner only)\n` +
          `• <code>/source danbooru|yandere</code> - Switch default source (Owner only)\n` +
          `• <code>/help</code> - Show this guide`
      );
      break;
    }

    case "/help": {
      await api.sendMessage(
        chat.id,
        `📖 <b>Help & Command Reference</b>\n\n` +
          `<b>Public Commands:</b>\n` +
          `• <code>/today</code> - Pull top 10 using current settings\n` +
          `• <code>/danbooru</code> - Pull top 10 from Danbooru\n` +
          `• <code>/yandere</code> - Pull top 10 from yande.re\n\n` +
          `<b>Owner Commands (@cheytac29):</b>\n` +
          `• <code>/settings</code> - Interactive configuration panel\n` +
          `• <code>/sfw</code> - Set SFW filter (Safe / General only)\n` +
          `• <code>/nsfw</code> - Set NSFW filter (Questionable / Explicit)\n` +
          `• <code>/source &lt;danbooru|yandere&gt;</code> - Set default source\n` +
          `• <code>/subscribe</code> - Register this chat for daily cron broadcast\n` +
          `• <code>/unsubscribe</code> - Stop daily cron broadcast in this chat`
      );
      break;
    }

    case "/today":
    case "/top10": {
      const settings = await getSettings(env);
      await sendTop10ToChat(api, chat.id, settings.source, settings.rating);
      break;
    }

    case "/danbooru": {
      const settings = await getSettings(env);
      const ratingOverride = args[0]?.toLowerCase() === "nsfw" ? "nsfw" : args[0]?.toLowerCase() === "sfw" ? "sfw" : settings.rating;
      await sendTop10ToChat(api, chat.id, "danbooru", ratingOverride);
      break;
    }

    case "/yandere": {
      const settings = await getSettings(env);
      const ratingOverride = args[0]?.toLowerCase() === "nsfw" ? "nsfw" : args[0]?.toLowerCase() === "sfw" ? "sfw" : settings.rating;
      await sendTop10ToChat(api, chat.id, "yandere", ratingOverride);
      break;
    }

    case "/settings":
    case "/panel": {
      if (!owner) {
        await api.sendMessage(chat.id, "🔒 Only bot owner (@cheytac29) can modify settings.");
        return;
      }
      const settings = await getSettings(env);
      await api.sendMessage(
        chat.id,
        `⚙️ <b>Bot Settings Panel</b>\n\n` +
          `• <b>Default Source:</b> <code>${settings.source}</code>\n` +
          `• <b>Rating Filter:</b> <code>${settings.rating.toUpperCase()}</code>\n` +
          `• <b>Daily Cron Broadcast:</b> <code>Active</code>\n\n` +
          `Use the buttons below to toggle configuration:`,
        {
          reply_markup: getSettingsKeyboard(settings.source, settings.rating),
        }
      );
      break;
    }

    case "/sfw": {
      if (!owner) {
        await api.sendMessage(chat.id, "🔒 Only bot owner (@cheytac29) can toggle ratings.");
        return;
      }
      const updated = await setRating(env, "sfw");
      await api.sendMessage(
        chat.id,
        `🛡️ <b>Rating set to SFW.</b> Only safe and general posts will be delivered.`
      );
      break;
    }

    case "/nsfw": {
      if (!owner) {
        await api.sendMessage(chat.id, "🔒 Only bot owner (@cheytac29) can toggle ratings.");
        return;
      }
      const updated = await setRating(env, "nsfw");
      await api.sendMessage(
        chat.id,
        `⚠️ <b>Rating set to NSFW.</b> Questionable and explicit posts will be included (with spoiler blur).`
      );
      break;
    }

    case "/source": {
      if (!owner) {
        await api.sendMessage(chat.id, "🔒 Only bot owner (@cheytac29) can change source.");
        return;
      }
      const target = args[0]?.toLowerCase();
      if (target !== "danbooru" && target !== "yandere") {
        await api.sendMessage(
          chat.id,
          "ℹ️ Please specify source: <code>/source danbooru</code> or <code>/source yandere</code>"
        );
        return;
      }
      const updated = await setSource(env, target);
      await api.sendMessage(
        chat.id,
        `📁 <b>Default source updated to:</b> <code>${updated.source}</code>`
      );
      break;
    }

    case "/subscribe": {
      if (!owner) {
        await api.sendMessage(chat.id, "🔒 Only bot owner can manage subscriptions.");
        return;
      }
      await updateOwnerChatId(env, chat.id);
      await api.sendMessage(chat.id, "✅ This chat is registered for daily top 10 broadcasts.");
      break;
    }

    case "/unsubscribe": {
      if (!owner) {
        await api.sendMessage(chat.id, "🔒 Only bot owner can manage subscriptions.");
        return;
      }
      const settings = await getSettings(env);
      const filtered = settings.subscribedChatIds.filter((id) => id !== chat.id);
      await saveSettings(env, { ...settings, subscribedChatIds: filtered });
      await api.sendMessage(chat.id, "🔕 This chat unsubscribed from daily broadcasts.");
      break;
    }
  }
}

export async function handleTelegramCallbackQuery(
  callbackQuery: TelegramCallbackQuery,
  env: Env
): Promise<void> {
  const api = new TelegramApi(env.TELEGRAM_BOT_TOKEN);
  const from = callbackQuery.from;
  const owner = isOwner(from, env);

  if (!owner) {
    await api.answerCallbackQuery(
      callbackQuery.id,
      "🔒 Action restricted to bot owner (@cheytac29)",
      true
    );
    return;
  }

  const data = callbackQuery.data;
  const msg = callbackQuery.message;
  if (!msg) {
    await api.answerCallbackQuery(callbackQuery.id);
    return;
  }

  let settings = await getSettings(env);

  switch (data) {
    case "toggle_source": {
      const nextSource: BooruSource = settings.source === "danbooru" ? "yandere" : "danbooru";
      settings = await setSource(env, nextSource);
      await api.answerCallbackQuery(callbackQuery.id, `Source switched to ${nextSource}`);
      await api.editMessageText(
        msg.chat.id,
        msg.message_id,
        `⚙️ <b>Bot Settings Panel</b>\n\n` +
          `• <b>Default Source:</b> <code>${settings.source}</code>\n` +
          `• <b>Rating Filter:</b> <code>${settings.rating.toUpperCase()}</code>\n` +
          `• <b>Daily Cron Broadcast:</b> <code>Active</code>\n\n` +
          `Use the buttons below to toggle configuration:`,
        {
          reply_markup: getSettingsKeyboard(settings.source, settings.rating),
        }
      );
      break;
    }

    case "toggle_rating": {
      const nextRating: RatingFilter = settings.rating === "sfw" ? "nsfw" : "sfw";
      settings = await setRating(env, nextRating);
      await api.answerCallbackQuery(callbackQuery.id, `Rating switched to ${nextRating.toUpperCase()}`);
      await api.editMessageText(
        msg.chat.id,
        msg.message_id,
        `⚙️ <b>Bot Settings Panel</b>\n\n` +
          `• <b>Default Source:</b> <code>${settings.source}</code>\n` +
          `• <b>Rating Filter:</b> <code>${settings.rating.toUpperCase()}</code>\n` +
          `• <b>Daily Cron Broadcast:</b> <code>Active</code>\n\n` +
          `Use the buttons below to toggle configuration:`,
        {
          reply_markup: getSettingsKeyboard(settings.source, settings.rating),
        }
      );
      break;
    }

    case "fetch_top10": {
      await api.answerCallbackQuery(callbackQuery.id, "Fetching top 10...");
      await sendTop10ToChat(api, msg.chat.id, settings.source, settings.rating);
      break;
    }

    default:
      await api.answerCallbackQuery(callbackQuery.id);
  }
}

export async function handleScheduledBroadcast(env: Env): Promise<void> {
  const api = new TelegramApi(env.TELEGRAM_BOT_TOKEN);
  const settings = await getSettings(env);

  const targets = new Set<number>();
  if (settings.ownerChatId) targets.add(settings.ownerChatId);
  settings.subscribedChatIds.forEach((id) => targets.add(id));

  if (targets.size === 0) {
    console.warn("No subscribed chats or ownerChatId registered for daily broadcast.");
    return;
  }

  for (const chatId of targets) {
    try {
      await sendTop10ToChat(api, chatId, settings.source, settings.rating);
    } catch (err) {
      console.error(`Failed to send daily broadcast to chat ${chatId}:`, err);
    }
  }
}
