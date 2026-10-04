import { BotSettings, Env, InlineKeyboardMarkup, DeliveryMode, RatingFilter } from "../types";
import { TelegramApi } from "../telegram/api";
import { getConfig } from "../config";

export const SETTINGS_HEADER = "⚙️ <b>Settings</b>";

/**
 * Builds clean, minimal settings text and interactive toggle buttons.
 */
export function buildSettingsMessage(settings: BotSettings): {
  text: string;
  replyMarkup: InlineKeyboardMarkup;
} {
  const modeLabel = settings.mode === "random" ? "Random" : "Top";
  const ratingLabel =
    settings.rating === "sfw"
      ? "SFW"
      : settings.rating === "nsfw"
      ? "NSFW"
      : "All";
  const spoilerLabel = settings.spoilerNsfw ? "On" : "Off";

  const text =
    `${SETTINGS_HEADER}\n\n` +
    `• Mode: <b>${modeLabel}</b>\n` +
    `• Rating: <b>${ratingLabel}</b>\n` +
    `• Limit: <b>${settings.limit}</b>\n` +
    `• Spoilers: <b>${spoilerLabel}</b>`;

  const isTop = settings.mode !== "random";
  const isSfw = settings.rating === "sfw";
  const isNsfw = settings.rating === "nsfw";
  const isAll = settings.rating === "all";

  const is10 = settings.limit === 10;
  const is20 = settings.limit === 20;
  const is30 = settings.limit === 30 || (!is10 && !is20);

  const replyMarkup: InlineKeyboardMarkup = {
    inline_keyboard: [
      [
        {
          text: isTop ? "✅ Top" : "🌟 Top",
          callback_data: "cfg:mode:top",
        },
        {
          text: !isTop ? "✅ Random" : "🎲 Random",
          callback_data: "cfg:mode:random",
        },
      ],
      [
        {
          text: isSfw ? "✅ SFW" : "🛡️ SFW",
          callback_data: "cfg:rating:sfw",
        },
        {
          text: isNsfw ? "✅ NSFW" : "⚠️ NSFW",
          callback_data: "cfg:rating:nsfw",
        },
        {
          text: isAll ? "✅ All" : "🌈 All",
          callback_data: "cfg:rating:all",
        },
      ],
      [
        {
          text: is10 ? "✅ 10" : "10",
          callback_data: "cfg:limit:10",
        },
        {
          text: is20 ? "✅ 20" : "20",
          callback_data: "cfg:limit:20",
        },
        {
          text: is30 ? "✅ 30" : "30",
          callback_data: "cfg:limit:30",
        },
      ],
      [
        {
          text: settings.spoilerNsfw
            ? "🙈 Spoilers: On (Blurred)"
            : "👁️ Spoilers: Off (Unblurred)",
          callback_data: "cfg:spoiler:toggle",
        },
      ],
      [
        {
          text: "🔍 Search Tag",
          switch_inline_query_current_chat: "",
        },
        {
          text: "🚀 Fetch Now",
          callback_data: "fetch_top",
        },
      ],
    ],
  };

  return { text, replyMarkup };
}

/**
 * Parses settings from the message text, supporting bullet points or JSON block.
 */
export function parseSettingsText(text: string, fallback: BotSettings): BotSettings {
  if (!text) return fallback;

  // 1. Try parsing JSON block if present
  const jsonMatch = text.match(/\{[\s\S]*"mode"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        ...fallback,
        mode: parsed.mode === "random" ? "random" : "top",
        rating:
          parsed.rating === "sfw"
            ? "sfw"
            : parsed.rating === "nsfw"
            ? "nsfw"
            : "all",
        limit:
          typeof parsed.limit === "number" && parsed.limit > 0 && parsed.limit <= 50
            ? parsed.limit
            : fallback.limit,
        spoilerNsfw: Boolean(parsed.spoilerNsfw ?? parsed.spoiler),
      };
    } catch {
      // Fall through to bullet-point regex
    }
  }

  // 2. Parse bullet points regex
  let mode: DeliveryMode = fallback.mode;
  let rating: RatingFilter = fallback.rating;
  let limit: number = fallback.limit;
  let spoilerNsfw: boolean = fallback.spoilerNsfw;

  const modeMatch = text.match(/Mode:\s*(?:<b>)?(Top|Random)(?:<\/b>)?/i);
  if (modeMatch) {
    mode = modeMatch[1].toLowerCase() === "random" ? "random" : "top";
  }

  const ratingMatch = text.match(/Rating:\s*(?:<b>)?(All|SFW|NSFW)(?:<\/b>)?/i);
  if (ratingMatch) {
    const r = ratingMatch[1].toLowerCase();
    rating = r === "sfw" ? "sfw" : r === "nsfw" ? "nsfw" : "all";
  }

  const limitMatch = text.match(/Limit:\s*(?:<b>)?(\d+)(?:<\/b>)?/i);
  if (limitMatch) {
    const n = parseInt(limitMatch[1], 10);
    if (!isNaN(n) && n > 0 && n <= 50) {
      limit = n;
    }
  }

  const spoilerMatch = text.match(/Spoilers?:\s*(?:<b>)?(On|Off)(?:<\/b>)?/i);
  if (spoilerMatch) {
    spoilerNsfw = spoilerMatch[1].toLowerCase() === "on";
  }

  return {
    ...fallback,
    mode,
    rating,
    limit,
    spoilerNsfw,
  };
}

/**
 * Reads dynamic settings from Telegram pinned message in owner's chat.
 * Falls back cleanly to env variables if not found or unpinned.
 */
export async function fetchChatSettings(
  api: TelegramApi,
  ownerChatId: number | string | undefined,
  env: Env
): Promise<{ settings: BotSettings; pinnedMessageId?: number }> {
  const fallback = getConfig(env);
  if (!ownerChatId) return { settings: fallback };

  try {
    const chatRes = await api.getChat(ownerChatId);
    if (chatRes.ok && chatRes.result?.pinned_message) {
      const pinnedMsg = chatRes.result.pinned_message;
      const text = pinnedMsg.text || "";

      if (text.includes("Settings") || text.includes("⚙️")) {
        const parsed = parseSettingsText(text, fallback);
        return { settings: parsed, pinnedMessageId: pinnedMsg.message_id };
      }
    }
  } catch (err) {
    console.warn("fetchChatSettings failed, using env defaults:", err);
  }

  return { settings: fallback };
}

/**
 * Ensures the settings card exists and is pinned in chat.
 */
export async function ensurePinnedSettings(
  api: TelegramApi,
  chatId: number | string,
  env: Env
): Promise<{ messageId: number; settings: BotSettings }> {
  const { settings, pinnedMessageId } = await fetchChatSettings(api, chatId, env);
  const { text, replyMarkup } = buildSettingsMessage(settings);

  // Send a fresh settings card directly in chat so user immediately sees it
  const sendRes = await api.sendMessage(chatId, text, { reply_markup: replyMarkup });
  const newMsgId = sendRes.ok && sendRes.result?.message_id ? sendRes.result.message_id : null;

  if (newMsgId) {
    // Pin the new settings card silently
    await api.pinChatMessage(chatId, newMsgId, { disable_notification: true });

    // Clean up previous pinned settings message if it exists
    if (pinnedMessageId && pinnedMessageId !== newMsgId) {
      try {
        await api.deleteMessage(chatId, pinnedMessageId);
      } catch (e) {
        // Ignore deletion errors for old messages
      }
    }

    return { messageId: newMsgId, settings };
  }

  return { messageId: 0, settings };
}
