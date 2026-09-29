import {
  Env,
  RatingFilter,
  DeliveryMode,
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
  const modeText = config.mode === "random" ? "Random Images 🎲" : "Top Popular Today 🌟";

  return (
    `⚙️ <b>Active Bot Configuration</b>\n\n` +
    `• <b>Source:</b> <code>yande.re</code>\n` +
    `• <b>Delivery Mode:</b> <code>${modeText}</code>\n` +
    `• <b>Default Rating:</b> <code>${getRatingBadgeText(config.rating)}</code>\n` +
    `• <b>NSFW Spoilers:</b> <code>${spoilerText}</code>\n` +
    `• <b>Everyday Count:</b> <code>${config.limit} images</code>\n` +
    `• <b>Delivery Target:</b> ${targetText}\n` +
    `• <b>Daily Schedule:</b> <code>8:00 AM UTC+7 (01:00 UTC)</code>\n\n` +
    `💡 <i>To permanently change defaults, edit runtime variables in your Cloudflare Dashboard (Settings ➔ Variables). Set <code>DEFAULT_MODE</code> to <code>top</code> or <code>random</code>.</i>`
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
 * Sends a batch of InputMediaPhoto items as an album, respecting Telegram's rate limits (429 retry_after),
 * providing progressive multi-stage retries to absorb transient CDN/downloader lags,
 * and gracefully halving or splitting (down to 2+1 for 3-item groups) so items remain bundled in albums.
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
      console.warn(`Single photo hit rate limit. Waiting ${waitMs}ms to retry...`);
      await new Promise((r) => setTimeout(r, waitMs));
      photoRes = await api.sendPhoto(chatId, item.media, {
        caption: item.caption,
        has_spoiler: item.has_spoiler,
        parse_mode: item.parse_mode,
      });
    }

    return photoRes.ok ? 1 : 0;
  }

  // 1. Primary: send as media group (album) with up to 2 retries (progressive backoff)
  let sendResult = await api.sendMediaGroup(chatId, items);

  if (!sendResult.ok) {
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

  if (sendResult.ok) {
    return items.length;
  }

  // 2. Resilient Fallback for 4+ items: split into two smaller balanced albums (e.g. 10 -> 5+5, 5 -> 3+2, 4 -> 2+2)
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

  // 3. Graceful Fallback for 3 items: split into 2-item album + 1 single photo so 2 items stay bundled
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

  // 4. Last Resort for 2 items that persistently failed as an album (one URL is genuinely broken/404 on source):
  // Send individual valid photos spaced by 1200ms.
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

const GENERAL_TAGS = new Set([
  "solo", "1girl", "2girls", "3girls", "4girls", "multiple_girls", "1boy", "2boys", "multiple_boys", "male", "female",
  "looking_at_viewer", "smile", "smiling", "open_mouth", "closed_eyes", "blush", "blushing", "tears", "crying", "wink",
  "profile", "wide_shot", "close_up", "upper_body", "lower_body", "full_body", "cowboy_shot", "back", "from_behind",
  "sitting", "standing", "lying", "on_bed", "on_stomach", "on_back", "upside_down", "kneeling", "squatting", "cross_legged", "all_fours", "hands_up", "arms_behind_back",
  "breasts", "boobs", "small_breasts", "medium_breasts", "large_breasts", "huge_breasts", "cleavage", "bare_shoulders", "navel", "stomach", "midriff", "thighs", "thick_thighs", "bare_legs", "legs", "barefoot", "feet",
  "ass", "butt", "pussy", "cameltoe", "nipples", "erect_nipples", "censored", "uncensored", "mosaic_censored", "cum", "pussy_juice", "penis", "sex", "anal", "bondage",
  "thighhighs", "thigh_highs", "stockings", "socks", "pantyhose", "tights", "black_pantyhose", "white_thighhighs", "black_thighhighs", "torn_thighhighs", "fishnets", "fishnet_pantyhose", "garter", "garter_belt", "shoes", "boots", "heels", "high_heels",
  "leotard", "swimsuit", "swimsuits", "bikini", "bikini_top", "bikini_bottom", "micro_bikini", "sling_bikini", "one_piece_swimsuit", "competition_swimsuit",
  "dress", "black_dress", "white_dress", "red_dress", "wedding_dress", "skirt", "mini_skirt", "pleated_skirt", "skirt_lift", "shirt_lift", "leotard_pull",
  "pantsu", "panties", "underwear", "black_panties", "white_panties", "striped_panties", "no_bra", "no_panties", "nopan", "bra", "topless", "bottomless", "naked", "nude", "lingerie",
  "uniform", "seifuku", "sailor_suit", "school_uniform", "gym_uniform", "bloomers", "maid", "maid_apron", "aprons", "apron", "wa_maid",
  "bunny_girl", "bunny_ears", "bunny_suit", "rabbit_ears", "cat_ears", "nekomimi", "animal_ears", "dog_ears", "wolf_ears", "fox_ears", "kitsunemimi", "tail", "animal_tail", "cat_tail", "fox_tail", "wings", "angel_wings", "devil_wings", "bat_wings", "horns", "halo",
  "bandaid", "bandage", "glasses", "megane", "sunglasses", "choker", "collar", "ribbon", "hair_ribbon", "bow", "hair_bow", "gloves",
  "long_hair", "short_hair", "medium_hair", "twintails", "twin_tails", "ponytail", "side_ponytail", "braid", "braids", "bangs", "ahoge", "hair_ornament", "hair_flower", "hairclip",
  "blonde_hair", "black_hair", "brown_hair", "blue_hair", "red_hair", "pink_hair", "white_hair", "silver_hair", "green_hair", "purple_hair", "grey_hair", "multicolored_hair", "gradient_hair",
  "blue_eyes", "brown_eyes", "green_eyes", "red_eyes", "yellow_eyes", "purple_eyes", "pink_eyes", "amber_eyes", "heterochromia",
  "wet", "sweating", "sweat", "food", "drink", "outdoors", "indoors", "bedroom", "beach", "pool", "sky", "clouds", "simple_background", "white_background", "transparent_background", "monochrome", "sepia",
  "highres", "absurdres", "incredible_absurdres", "wallpaper", "widescreen", "scan", "scans", "official_art", "tagme", "duplicate", "bad_id", "comic", "manga", "text", "watermark", "sample", "parody", "crossover", "original", "original_character",
  "sweater", "torn_clothes", "see_through", "pointy_ears", "point_ears", "chibi", "dress_lift", "breast_hold", "vibrator", "dildo", "sex_toy", "anus", "saliva", "drool"
]);

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
  displayCount: number,
  todayDate: string,
  mode: DeliveryMode = "top"
): string {
  const isFirst = index === 0;
  let caption = "";
  if (isFirst) {
    if (mode === "random") {
      caption = `🎲 <b>${displayCount} Random Images • yande.re</b>\n\n`;
    } else {
      caption = `🌟 <b>Top ${displayCount} Today • yande.re</b>\n📅 ${todayDate}\n\n`;
    }
  }

  // Line 1: #11 Score: 6 (yande.re)
  caption += `#${index + 1} Score: ${post.score} (<a href="${post.postUrl}">yande.re</a>)`;

  // Line 2: Character • Copyright / by: Artist name (or Platform)
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
 * Fetch images from yande.re (top popular or random) and send them grouped as Telegram albums.
 * Uses 3.5s pacing between albums to prevent Telegram media queue congestion,
 * respects retry_after headers, and provides progressive retries and graceful splitting.
 */
export async function sendBooruPostsToChat(
  api: TelegramApi,
  chatId: number | string,
  rating: RatingFilter,
  limit: number = 30,
  spoilerNsfw: boolean = false,
  mode: DeliveryMode = "top"
): Promise<void> {
  const modeLabel = mode === "random" ? "random" : "top";
  const loadingRes = await api.sendMessage(
    chatId,
    `⏳ <i>Fetching ${limit} ${modeLabel} images from <b>yande.re</b>...</i>`
  );
  const loadingMsgId =
    loadingRes.ok && loadingRes.result?.message_id
      ? (loadingRes.result.message_id as number)
      : null;

  try {
    const posts = await fetchYanderePosts(rating, limit, mode);
    if (posts.length === 0) {
      await api.sendMessage(
        chatId,
        `⚠️ No images found on yande.re.`
      );
      return;
    }

    const todayDate = new Date().toISOString().split("T")[0];
    const displayCount = Math.min(posts.length, limit);

    const mediaGroup: InputMediaPhoto[] = posts.slice(0, displayCount).map((post, idx) => {
      const caption = formatPostCaption(post, idx, displayCount, todayDate, mode);
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
        // Wait 3.5s between media groups to satisfy Telegram's media download queue & single-chat pacing
        await new Promise((resolve) => setTimeout(resolve, 3500));
      }

      const sent = await sendAlbumBatch(api, chatId, batch);
      totalSent += sent;
    }

    // Emergency fallback if all photos were rejected
    if (totalSent === 0) {
      let textSummary = mode === "random"
        ? `🎲 <b>${displayCount} Random Images • yande.re</b>\n\n`
        : `🌟 <b>Top ${displayCount} Today • yande.re</b>\n📅 ${todayDate}\n\n`;
      posts.slice(0, displayCount).forEach((p, i) => {
        textSummary += `${i + 1}. <a href="${p.postUrl}">Post #${p.id}</a> - Score: ${p.score}\n`;
      });
      await api.sendMessage(chatId, textSummary, { disable_web_page_preview: false });
    }
  } catch (err: any) {
    console.error("sendBooruPostsToChat error:", err);
    await api.sendMessage(
      chatId,
      `❌ Failed to load images: ${escapeHtml(err?.message || "Unknown error")}`
    );
  } finally {
    if (loadingMsgId) {
      await api.deleteMessage(chatId, loadingMsgId);
    }
  }
}

export const DEFAULT_BOT_COMMANDS = [
  { command: "today", description: "🌟 Top popular images of the day" },
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
          `• <code>/today [count] [rating]</code> - Fetch top images (defaults to ${config.limit})\n` +
          `• <code>/random [count] [rating]</code> - Fetch random images\n` +
          `• <code>/yan [count] [rating]</code> - Shortcut for yande.re\n` +
          `• <code>/settings</code> - View active configuration\n` +
          `• <code>/myid</code> - View your Telegram Chat ID\n` +
          `• <code>/help</code> - Command reference\n\n` +
          `💡 <i>Tap the <b>[Menu]</b> button on the left of your message box for instant quick access to all commands!</i>`
      );
      break;
    }

    case "/help": {
      await api.sendMessage(
        chat.id,
        `📖 <b>Help & Command Reference</b>\n\n` +
          `<b>Fetch Commands:</b>\n` +
          `• <code>/today [count] [rating]</code> - Pull top images (e.g. <code>/today</code>, <code>/today 15</code>, <code>/today 30 nsfw</code>)\n` +
          `• <code>/random [count] [rating]</code> - Pull random images (e.g. <code>/random</code>, <code>/random 30 sfw</code>)\n` +
          `• <code>/yan [count] [rating]</code> - Shortcut for yande.re\n\n` +
          `<b>Info & Diagnostics:</b>\n` +
          `• <code>/settings</code> - Inspect active environment variables\n` +
          `• <code>/myid</code> - View your Telegram Chat ID`
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
    case "/yan":
    case "/yandere":
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
      // Unknown command: guide to /help
      if (text.startsWith("/")) {
        await api.sendMessage(
          chat.id,
          `ℹ️ Unknown command: <code>${escapeHtml(cmd)}</code>\nUse /today or /random to fetch images, or /help for commands.`
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
