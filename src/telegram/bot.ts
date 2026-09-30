import {
  Env,
  RatingFilter,
  DeliveryMode,
  BooruPost,
  BotSettings,
  TelegramMessage,
  TelegramCallbackQuery,
  TelegramUser,
  TelegramInlineQuery,
  TelegramInlineQueryResultArticle,
  InputMediaPhoto,
  InlineKeyboardButton,
  InlineKeyboardMarkup,
} from "../types";
import { TelegramApi } from "./api";
import { getConfig, DEFAULT_CONFIG } from "../config";
import { fetchBooruPosts } from "../services/booru";
import { searchBooruTags, getTagTypeEmoji, getTagTypeLabel } from "../services/tags";

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
  const modeText = config.mode === "random" ? "Random Images 🎲" : "Top Popular Today 🌟";

  return (
    `⚙️ <b>Active Bot Configuration</b>\n\n` +
    `• <b>Source:</b> <code>yande.re 🌸</code>\n` +
    `• <b>Delivery Mode:</b> <code>${modeText}</code>\n` +
    `• <b>Default Rating:</b> <code>${getRatingBadgeText(config.rating)}</code>\n` +
    `• <b>NSFW Spoilers:</b> <code>${spoilerText}</code>\n` +
    `• <b>Everyday Count:</b> <code>${config.limit} images</code>\n` +
    `• <b>Delivery Target:</b> ${targetText}\n` +
    `• <b>Daily Schedule:</b> <code>8:00 AM UTC+7 (01:00 UTC)</code>\n\n` +
    `💡 <i>To permanently change defaults, edit runtime variables in your Cloudflare Dashboard (Settings ➔ Variables).</i>`
  );
}

/**
 * Parses user command flags like `/today 20 nsfw` or `/today sfw`
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
    else if (lower === "all") rating = "all";
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
 * Parses search command args like `/search hu_tao 20 nsfw`
 */
export function parseSearchCommandArgs(
  args: string[],
  defaultRating: RatingFilter,
  defaultLimit: number,
  defaultSpoiler: boolean
): {
  queryParts: string[];
  rating: RatingFilter;
  limit: number;
  spoilerNsfw: boolean;
} {
  let rating = defaultRating;
  let limit = defaultLimit;
  let spoilerNsfw = defaultSpoiler;
  const queryParts: string[] = [];

  for (const arg of args) {
    const lower = arg.toLowerCase();
    if (lower === "nsfw") rating = "nsfw";
    else if (lower === "sfw") rating = "sfw";
    else if (lower === "all") rating = "all";
    else if (
      lower === "nospoiler" ||
      lower === "unspoiler" ||
      lower === "clean" ||
      lower === "nospoil"
    ) {
      spoilerNsfw = false;
    } else if (lower === "spoiler" || lower === "blur") {
      spoilerNsfw = true;
    } else {
      const num = parseInt(lower, 10);
      if (!isNaN(num) && num > 0 && num <= 50) {
        limit = num;
      } else {
        queryParts.push(arg);
      }
    }
  }

  return { queryParts, rating, limit, spoilerNsfw };
}

/**
 * Sends a single album (media group) with resilient retry and smart fallback logic.
 */
async function sendAlbumBatch(
  api: TelegramApi,
  chatId: number | string,
  items: InputMediaPhoto[]
): Promise<number> {
  if (items.length === 0) return 0;

  if (items.length === 1) {
    const item = items[0];
    let photoRes = await api.sendPhoto(chatId, item.media, {
      caption: item.caption,
      has_spoiler: item.has_spoiler,
      parse_mode: item.parse_mode,
    });

    if (!photoRes.ok && photoRes.parameters?.retry_after) {
      const waitMs = (photoRes.parameters.retry_after + 1) * 1000;
      await new Promise((r) => setTimeout(r, waitMs));
      photoRes = await api.sendPhoto(chatId, item.media, {
        caption: item.caption,
        has_spoiler: item.has_spoiler,
        parse_mode: item.parse_mode,
      });
    }

    return photoRes.ok ? 1 : 0;
  }

  // 1. Primary: send as media group (album) with progressive backoff
  let sendResult = await api.sendMediaGroup(chatId, items);

  if (!sendResult.ok) {
    const desc = sendResult.description || "";
    const isUrlFailure = desc.includes("failed to get HTTP URL content") || desc.includes("wrong file identifier");

    if (!isUrlFailure) {
      const waitMs1 = sendResult.parameters?.retry_after
        ? (sendResult.parameters.retry_after + 1) * 1000
        : 3500;
      console.warn(`Album batch of ${items.length} failed (${sendResult.description}). Waiting ${waitMs1}ms for retry 1...`);
      await new Promise((r) => setTimeout(r, waitMs1));
      sendResult = await api.sendMediaGroup(chatId, items);

      if (!sendResult.ok) {
        const waitMs2 = sendResult.parameters?.retry_after
          ? (sendResult.parameters.retry_after + 1) * 1000
          : 4500;
        console.warn(`Album batch retry 1 failed (${sendResult.description}). Waiting ${waitMs2}ms for retry 2...`);
        await new Promise((r) => setTimeout(r, waitMs2));
        sendResult = await api.sendMediaGroup(chatId, items);
      }
    }
  }

  if (sendResult.ok) {
    return items.length;
  }

  // 2. Resilient Fallback for 4+ items: split into two smaller balanced albums
  if (items.length >= 4) {
    const mid = Math.ceil(items.length / 2);
    const sub1 = items.slice(0, mid);
    const sub2 = items.slice(mid);
    console.warn(`Album batch of ${items.length} failed retries (${sendResult.description}). Splitting into ${sub1.length} + ${sub2.length} albums...`);

    let sent = 0;
    await new Promise((r) => setTimeout(r, 2500));
    sent += await sendAlbumBatch(api, chatId, sub1);

    if (sub2.length > 0) {
      await new Promise((r) => setTimeout(r, 3000));
      sent += await sendAlbumBatch(api, chatId, sub2);
    }
    return sent;
  }

  // 3. Graceful Fallback for 3 items: split into 2-item album + 1 single photo
  if (items.length === 3) {
    console.warn(`3-item album failed retries (${sendResult.description}). Splitting into 2-item album + 1 photo...`);
    const pair = items.slice(0, 2);
    const single = items.slice(2);

    let sent = 0;
    sent += await sendAlbumBatch(api, chatId, pair);

    await new Promise((r) => setTimeout(r, 2000));
    sent += await sendAlbumBatch(api, chatId, single);
    return sent;
  }

  // 4. Last Resort for 2 items: send individually spaced by 1200ms
  console.warn(`2-item album failed retries (${sendResult.description}). Sending individually as last resort...`);
  let sent = 0;
  for (const item of items) {
    await new Promise((r) => setTimeout(r, 1200));
    let photoRes = await api.sendPhoto(chatId, item.media, {
      caption: item.caption,
      has_spoiler: item.has_spoiler,
      parse_mode: item.parse_mode,
    });

    if (!photoRes.ok && photoRes.parameters?.retry_after) {
      const waitMs = (photoRes.parameters.retry_after + 1) * 1000;
      await new Promise((r) => setTimeout(r, waitMs));
      photoRes = await api.sendPhoto(chatId, item.media, {
        caption: item.caption,
        has_spoiler: item.has_spoiler,
        parse_mode: item.parse_mode,
      });
    }

    if (photoRes.ok) sent++;
  }
  return sent;
}

function toTitleCase(name: string): string {
  if (!name) return "";
  const clean = name.replace(/_\((?:series|game|anime|manga|novel)\)$/i, "");
  const parts = clean.split("_");
  const res: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    if (p.startsWith("(") && p.endsWith(")")) {
      res.push("(" + p.charAt(1).toUpperCase() + p.slice(2).toLowerCase());
    } else if (p.startsWith("(")) {
      res.push("(" + p.charAt(1).toUpperCase() + p.slice(2).toLowerCase());
    } else if (p.endsWith(")")) {
      res.push(p.charAt(0).toUpperCase() + p.slice(1, -1).toLowerCase() + ")");
    } else {
      res.push(p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());
    }
  }
  return res.join(" ");
}

function cleanCharacterName(charTag: string, copyrightTags: string[]): string {
  const match = charTag.match(/_\(([^)]+)\)$/);
  if (match) {
    const paren = match[1].toLowerCase();
    const isSeries = copyrightTags.some(
      (c) =>
        c.toLowerCase() === paren ||
        c.toLowerCase().includes(paren) ||
        paren.includes(c.toLowerCase())
    );
    if (isSeries) {
      return charTag.slice(0, match.index);
    }
  }
  return charTag;
}

function getSourcePlatform(url?: string): string {
  if (!url) return "Source";
  const u = url.toLowerCase();
  if (u.includes("pixiv.net") || u.includes("pximg.net")) return "Pixiv";
  if (u.includes("twitter.com") || u.includes("x.com")) return "X (Twitter)";
  if (u.includes("fanbox.cc")) return "Fanbox";
  if (u.includes("fantia.jp")) return "Fantia";
  if (u.includes("dlsite.com")) return "DLsite";
  if (u.includes("bilibili.com")) return "Bilibili";
  if (u.includes("weibo.com")) return "Weibo";
  if (u.includes("artstation.com")) return "ArtStation";
  if (u.includes("skeb.jp")) return "Skeb";
  return "Source";
}

function formatPostCaption(
  post: BooruPost,
  index: number,
  formattedDate: string,
  mode: DeliveryMode = "top"
): string {
  let caption = `#${index + 1} Score: ${post.score} (<a href="${post.postUrl}">yande.re</a>)`;

  const chars = (post.characterTags || []).map((c) =>
    toTitleCase(cleanCharacterName(c, post.copyrightTags || []))
  );
  const copies = (post.copyrightTags || []).map(toTitleCase);

  const charStr = chars.slice(0, 2).join(", ");
  const copyStr = copies.length > 0 ? copies[0] : "";

  const tagParts: string[] = [];
  if (charStr) tagParts.push(escapeHtml(charStr));
  if (copyStr) tagParts.push(escapeHtml(copyStr));
  const tagLine = tagParts.join(" • ");

  const artistName = post.artist ? toTitleCase(post.artist) : null;
  const platform = getSourcePlatform(post.sourceUrl);

  let byPart = "";
  if (post.sourceUrl) {
    const linkText = artistName || platform;
    byPart = `<a href="${escapeHtml(post.sourceUrl)}">${escapeHtml(linkText)}</a>`;
  } else if (artistName) {
    byPart = escapeHtml(artistName);
  }

  let line2 = "";
  if (tagLine && byPart) {
    line2 = `${tagLine} / by: ${byPart}`;
  } else if (tagLine) {
    line2 = tagLine;
  } else if (byPart) {
    line2 = `by: ${byPart}`;
  }

  if (line2) {
    caption += `\n${line2}`;
  }

  return caption;
}

/**
 * Fetch images from yande.re and send them grouped as Telegram albums.
 * Auto-deletes the loading message after finish delivering.
 */
export async function sendBooruPostsToChat(
  api: TelegramApi,
  chatId: number | string,
  rating: RatingFilter,
  limit: number = 30,
  spoilerNsfw: boolean = false,
  mode: DeliveryMode = "top",
  tagQuery?: string
): Promise<void> {
  const modeLabel = mode === "random" ? "random" : "top";
  const loadingText = tagQuery
    ? `⏳ <i>Searching yande.re for <b>${escapeHtml(tagQuery)}</b> (${limit} images)...</i>`
    : `⏳ <i>Fetching ${limit} ${modeLabel} images from <b>yande.re</b>...</i>`;

  const loadingRes = await api.sendMessage(chatId, loadingText);
  const loadingMsgId =
    loadingRes.ok && loadingRes.result?.message_id
      ? (loadingRes.result.message_id as number)
      : null;

  try {
    const posts = await fetchBooruPosts(rating, limit, mode, tagQuery);

    if (posts.length === 0) {
      if (tagQuery) {
        const suggestions = await searchBooruTags(tagQuery, 6);
        let noFoundText = `⚠️ No images found matching: <code>${escapeHtml(tagQuery)}</code>`;
        let replyMarkup: InlineKeyboardMarkup | undefined = undefined;

        if (suggestions.length > 0) {
          noFoundText += `\n\n💡 <b>Did you mean one of these tags?</b>`;
          const buttons: InlineKeyboardButton[][] = suggestions.slice(0, 4).map((s) => [
            {
              text: `${getTagTypeEmoji(s.type)} ${s.name} (${s.count.toLocaleString()})`,
              callback_data: `st:${s.name.slice(0, 50)}`,
            },
          ]);
          replyMarkup = { inline_keyboard: buttons };
        }

        if (loadingMsgId) {
          await api.editMessageText(chatId, loadingMsgId, noFoundText, { reply_markup: replyMarkup });
        } else {
          await api.sendMessage(chatId, noFoundText, { reply_markup: replyMarkup });
        }
        return;
      }

      const noFoundText = `⚠️ No images found on yande.re.`;
      if (loadingMsgId) {
        await api.editMessageText(chatId, loadingMsgId, noFoundText);
      } else {
        await api.sendMessage(chatId, noFoundText);
      }
      return;
    }

    const now = new Date();
    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const year = now.getFullYear();
    const formattedDate = `${day}/${month}/${year}`;

    // Auto-delete the loading message so delivery starts clean
    if (loadingMsgId) {
      await api.deleteMessage(chatId, loadingMsgId);
    }

    const buildMediaGroup = (items: BooruPost[]) =>
      items.map((post, idx) => ({
        type: "photo" as const,
        media: post.imageUrl,
        caption: formatPostCaption(post, idx, formattedDate, mode).slice(0, 1024),
        parse_mode: "HTML" as const,
        has_spoiler: spoilerNsfw && post.isNsfw,
      }));

    const sendGroupBatches = async (items: InputMediaPhoto[]) => {
      let sent = 0;
      for (let i = 0; i < items.length; i += 10) {
        const batch = items.slice(i, i + 10);
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, 3500));
        }
        sent += await sendAlbumBatch(api, chatId, batch);
      }
      return sent;
    };

    const media = buildMediaGroup(posts);
    const totalSent = await sendGroupBatches(media);

    // Emergency fallback if all photos were rejected
    if (totalSent === 0) {
      let textSummary = `🌟 <b>yande.re • ${formattedDate}</b>\n\n`;
      posts.forEach((p, i) => {
        textSummary += `${i + 1}. <a href="${p.postUrl}">yande.re #${p.id}</a> - Score: ${p.score}\n`;
      });
      await api.sendMessage(chatId, textSummary, { disable_web_page_preview: false });
    }
  } catch (err: any) {
    console.error("sendBooruPostsToChat error:", err);
    const errText = `❌ Failed to load images: ${escapeHtml(err?.message || "Unknown error")}`;
    if (loadingMsgId) {
      await api.editMessageText(chatId, loadingMsgId, errText);
    } else {
      await api.sendMessage(chatId, errText);
    }
  }
}

export const DEFAULT_BOT_COMMANDS = [
  { command: "today", description: "🌟 Top popular images of the day" },
  { command: "search", description: "🔍 Search tag (live autocomplete)" },
  { command: "random", description: "🎲 Random anime images" },
  { command: "settings", description: "⚙️ Configuration & quick panel" },
  { command: "myid", description: "🆔 Your Telegram Chat ID" },
  { command: "help", description: "📖 Help & command reference" },
];

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
      // Auto-register command list and Menu button in Telegram UI
      await api.setMyCommands(DEFAULT_BOT_COMMANDS);
      await api.setChatMenuButton({ type: "commands" });

      await api.sendMessage(
        chat.id,
        `🌸 <b>Scene</b>\n\n` +
          `Daily & on-demand anime art from <b>yande.re</b>.\n\n` +
          `<b>Available Commands:</b>\n` +
          `• <code>/today [count] [rating]</code> - Fetch top popular images of the day\n` +
          `• <code>/search &lt;tag/character&gt;</code> - Search specific tag or character (alias: <code>/s</code>)\n` +
          `• <code>/random [count] [rating]</code> - Fetch random anime art\n` +
          `• <code>/settings</code> - Inspect configuration & quick actions\n` +
          `• <code>/help</code> - Full usage guide\n\n` +
          `💡 <i>Tip: Type <code>@s</code> or <code>@scenenecta_bot</code> in chat for live tag autocomplete!</i>`
      );
      break;
    }

    case "/help":
    case "/info": {
      await api.sendMessage(
        chat.id,
        `📖 <b>Scene Bot - Command Reference</b>\n\n` +
          `<b>Search Commands:</b>\n` +
          `• <code>/search &lt;tag&gt; [count] [rating]</code> (alias: <code>/s</code>)\n` +
          `  <i>e.g. <code>/search hu_tao</code>, <code>/s firefly 15 nsfw</code></i>\n` +
          `• <code>@s &lt;tag&gt;</code> - Live tag autocomplete right above your keyboard\n\n` +
          `<b>Browse Commands:</b>\n` +
          `• <code>/today [count] [rating]</code> - Pull top images of the day\n` +
          `• <code>/random [count] [rating]</code> - Pull random images\n\n` +
          `<b>Info & Diagnostics:</b>\n` +
          `• <code>/settings</code> - Inspect active environment variables & quick buttons\n` +
          `• <code>/myid</code> - View your Telegram Chat ID`
      );
      break;
    }

    case "/search":
    case "/s":
    case "/tag":
    case "/char":
    case "/character": {
      if (args.length === 0) {
        await api.sendMessage(
          chat.id,
          `🔍 <b>Tag & Character Search</b>\n\n` +
            `Usage: <code>/search &lt;tag or character&gt; [count] [rating]</code>\n\n` +
            `<b>Examples:</b>\n` +
            `• <code>/search hu_tao</code>\n` +
            `• <code>/search firefly 15 nsfw</code>\n` +
            `• <code>/search marin_kitagawa 20 sfw</code>\n\n` +
            `💡 <i>Tip: Tap the button below to search with live autocomplete!</i>`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "🔍 Search Tag (Live Autocomplete)",
                    switch_inline_query_current_chat: "",
                  },
                ],
              ],
            },
          }
        );
        break;
      }

      const { queryParts, rating, limit, spoilerNsfw } = parseSearchCommandArgs(
        args,
        config.rating,
        config.limit,
        config.spoilerNsfw
      );
      const tagQuery = queryParts.join("_");

      await sendBooruPostsToChat(
        api,
        chat.id,
        rating,
        limit,
        spoilerNsfw,
        "top",
        tagQuery
      );
      break;
    }

    case "/random":
    case "/rand": {
      const parsed = parseCommandArgs(args, config.rating, config.limit, config.spoilerNsfw);
      await sendBooruPostsToChat(
        api,
        chat.id,
        parsed.rating,
        parsed.limit,
        parsed.spoilerNsfw,
        "random"
      );
      break;
    }

    case "/today":
    case "/top":
    case "/top10":
    case "/top15":
    case "/top30":
    case "/test_cron":
    case "/runcron":
    case "/cron": {
      const parsed = parseCommandArgs(args, config.rating, config.limit, config.spoilerNsfw);
      await sendBooruPostsToChat(
        api,
        chat.id,
        parsed.rating,
        parsed.limit,
        parsed.spoilerNsfw,
        "top"
      );
      break;
    }

    case "/menu":
    case "/settings":
    case "/panel":
    case "/config": {
      await api.setMyCommands(DEFAULT_BOT_COMMANDS);
      await api.setChatMenuButton({ type: "commands" });
      await api.sendMessage(chat.id, formatSettingsText(config), {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🔍 Search Tag (Live Autocomplete)",
                switch_inline_query_current_chat: "",
              },
            ],
            [
              { text: `🚀 Top ${config.limit}`, callback_data: "fetch_top" },
              { text: `🎲 Random ${config.limit}`, callback_data: "fetch_random" },
            ],
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
          `✅ <b>Configured Owner:</b> <code>${config.ownerChatId}</code>`
      );
      break;
    }

    default:
      if (text.startsWith("/")) {
        await api.sendMessage(
          chat.id,
          `ℹ️ Unknown command: <code>${escapeHtml(cmd)}</code>\nUse /today, /search, /random, or /help.`
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

  if (
    callbackQuery.data &&
    (callbackQuery.data.startsWith("st:") || callbackQuery.data.startsWith("search_tag:"))
  ) {
    let tag = callbackQuery.data.replace(/^(?:st:|search_tag:)/, "");
    if (tag.startsWith("y:") || tag.startsWith("g:") || tag.startsWith("b:")) {
      tag = tag.slice(2);
    }

    await api.answerCallbackQuery(callbackQuery.id, `Searching for ${tag}...`);
    await sendBooruPostsToChat(
      api,
      msg.chat.id,
      config.rating,
      config.limit,
      config.spoilerNsfw,
      "top",
      tag
    );
    return;
  }

  switch (callbackQuery.data) {
    case "fetch_top": {
      await api.answerCallbackQuery(callbackQuery.id, `Fetching top ${config.limit}...`);
      await sendBooruPostsToChat(
        api,
        msg.chat.id,
        config.rating,
        config.limit,
        config.spoilerNsfw,
        "top"
      );
      break;
    }

    case "fetch_random": {
      await api.answerCallbackQuery(callbackQuery.id, `Fetching ${config.limit} random images...`);
      await sendBooruPostsToChat(
        api,
        msg.chat.id,
        config.rating,
        config.limit,
        config.spoilerNsfw,
        "random"
      );
      break;
    }

    case "fetch_sfw": {
      await api.answerCallbackQuery(callbackQuery.id, "Fetching top 10 SFW...");
      await sendBooruPostsToChat(api, msg.chat.id, "sfw", 10, false, "top");
      break;
    }

    case "fetch_nsfw": {
      await api.answerCallbackQuery(callbackQuery.id, "Fetching top 10 NSFW...");
      await sendBooruPostsToChat(api, msg.chat.id, "nsfw", 10, config.spoilerNsfw, "top");
      break;
    }

    default:
      await api.answerCallbackQuery(callbackQuery.id);
  }
}

/**
 * Daily Scheduled Broadcast Execution.
 * Pushes anime art from yande.re directly to the owner at 8:00 AM UTC+7 (follows DEFAULT_MODE).
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
        config.spoilerNsfw,
        config.mode
      );
      sentCount++;
    } catch (err) {
      console.error(`Daily broadcast failed for chat ${chatId}:`, err);
    }
  }

  return `Broadcast sent to ${sentCount}/${targets.size} chats.`;
}

/**
 * Telegram Real-Time Autocomplete Inline Query Handler.
 * Triggered as the user types `@botusername query` or `@s query`
 */
export async function handleTelegramInlineQuery(
  inlineQuery: TelegramInlineQuery,
  env: Env
): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const api = new TelegramApi(token);

  const query = (inlineQuery.query || "").trim();
  if (!query) {
    await api.answerInlineQuery(
      inlineQuery.id,
      [
        {
          type: "article",
          id: "hint_prompt",
          title: "🔍 Type a tag, character, or artist...",
          description: "e.g. hu_tao, firefly, raiden, blue_archive",
          input_message_content: {
            message_text: "/search",
          },
        },
      ],
      { cache_time: 5, is_personal: true }
    );
    return;
  }

  try {
    const suggestions = await searchBooruTags(query, 12);
    if (suggestions.length === 0) {
      await api.answerInlineQuery(
        inlineQuery.id,
        [
          {
            type: "article",
            id: `no_tag_${encodeURIComponent(query)}`,
            title: `⚠️ No matching tags for "${query}"`,
            description: `Check spelling or try a broader keyword`,
            input_message_content: {
              message_text: `/search ${query}`,
            },
          },
        ],
        { cache_time: 30, is_personal: true }
      );
      return;
    }

    const results: TelegramInlineQueryResultArticle[] = suggestions.map((tag, idx) => {
      const emoji = getTagTypeEmoji(tag.type);
      const label = getTagTypeLabel(tag.type);

      return {
        type: "article",
        id: `tag_${idx}_${tag.name}`,
        title: `${emoji} ${tag.name} (${label})`,
        description: `${tag.count.toLocaleString()} posts on yande.re`,
        input_message_content: {
          message_text: `/search ${tag.name}`,
        },
      };
    });

    await api.answerInlineQuery(inlineQuery.id, results, { cache_time: 60, is_personal: true });
  } catch (err) {
    console.error("Error answering inline query:", err);
  }
}
