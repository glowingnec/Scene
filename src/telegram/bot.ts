import {
  Env,
  RatingFilter,
  DeliveryMode,
  BooruSource,
  BooruPost,
  BotSettings,
  TelegramMessage,
  TelegramCallbackQuery,
  TelegramUser,
  TelegramInlineQuery,
  TelegramInlineQueryResultArticle,
  InputMediaPhoto,
  InlineKeyboardButton,
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
  const sourceText =
    config.source === "both"
      ? "Both (yande.re + Gelbooru) 🌐"
      : config.source === "gelbooru"
      ? "Gelbooru 🌀"
      : "yande.re 🌸";
  const countText =
    config.source === "both"
      ? `<code>${config.limit} images per source</code>`
      : `<code>${config.limit} images</code>`;

  return (
    `⚙️ <b>Active Bot Configuration</b>\n\n` +
    `• <b>Source:</b> <code>${sourceText}</code>\n` +
    `• <b>Delivery Mode:</b> <code>${modeText}</code>\n` +
    `• <b>Default Rating:</b> <code>${getRatingBadgeText(config.rating)}</code>\n` +
    `• <b>NSFW Spoilers:</b> <code>${spoilerText}</code>\n` +
    `• <b>Everyday Count:</b> ${countText}\n` +
    `• <b>Delivery Target:</b> ${targetText}\n` +
    `• <b>Daily Schedule:</b> <code>8:00 AM UTC+7 (01:00 UTC)</code>\n\n` +
    `💡 <i>To permanently change defaults, edit runtime variables in your Cloudflare Dashboard (Settings ➔ Variables). Set <code>DEFAULT_SOURCE</code> to <code>both</code>, <code>yandere</code>, or <code>gelbooru</code>.</i>`
  );
}

/**
 * Parses user command flags like `/today 20 nsfw`, `/today gel`, or `/yan sfw`
 */
export function parseCommandArgs(
  args: string[],
  defaultRating: RatingFilter,
  defaultLimit: number,
  defaultSpoiler: boolean = false,
  defaultSource?: BooruSource
): { rating: RatingFilter; limit: number; spoilerNsfw: boolean; source?: BooruSource } {
  let rating = defaultRating;
  let limit = defaultLimit;
  let spoilerNsfw = defaultSpoiler;
  let source = defaultSource;

  for (const arg of args) {
    const lower = arg.toLowerCase();
    if (lower === "nsfw") rating = "nsfw";
    else if (lower === "sfw") rating = "sfw";
    else if (lower === "all") rating = "all";
    else if (lower === "both") source = "both";
    else if (lower === "yan" || lower === "yandere") source = "yandere";
    else if (lower === "gel" || lower === "gelbooru") source = "gelbooru";
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

  return { rating, limit, spoilerNsfw, source };
}

/**
 * Parses search command args like `/search hu_tao 20 nsfw both`
 * Distinguishes search query words from rating, count, source, and spoiler flags.
 */
export function parseSearchCommandArgs(
  args: string[],
  defaultRating: RatingFilter,
  defaultLimit: number,
  defaultSpoiler: boolean,
  defaultSource: BooruSource
): {
  queryParts: string[];
  rating: RatingFilter;
  limit: number;
  spoilerNsfw: boolean;
  source: BooruSource;
} {
  let rating = defaultRating;
  let limit = defaultLimit;
  let spoilerNsfw = defaultSpoiler;
  let source = defaultSource;
  const queryParts: string[] = [];

  for (const arg of args) {
    const lower = arg.toLowerCase();
    if (lower === "nsfw") rating = "nsfw";
    else if (lower === "sfw") rating = "sfw";
    else if (lower === "all") rating = "all";
    else if (lower === "both") source = "both";
    else if (lower === "yan" || lower === "yandere") source = "yandere";
    else if (lower === "gel" || lower === "gelbooru") source = "gelbooru";
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

  return { queryParts, rating, limit, spoilerNsfw, source };
}

/**
 * Parses tag lookup command args like `/tags hu_tao yan` or `/tags firefly both`
 */
export function parseTagCommandArgs(
  args: string[],
  defaultSource: BooruSource
): { query: string; source: BooruSource } {
  let source = defaultSource;
  const queryParts: string[] = [];

  for (const arg of args) {
    const lower = arg.toLowerCase();
    if (lower === "both") source = "both";
    else if (lower === "yan" || lower === "yandere") source = "yandere";
    else if (lower === "gel" || lower === "gelbooru") source = "gelbooru";
    else {
      queryParts.push(arg);
    }
  }

  return { query: queryParts.join(" ").trim(), source };
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
  formattedDate: string,
  mode: DeliveryMode = "top"
): string {
  // Line 1: #1 Score: 6 (yande.re) or (Gelbooru)
  const sourceName = post.source === "gelbooru" ? "Gelbooru" : "yande.re";
  let caption = `#${index + 1} Score: ${post.score} (<a href="${post.postUrl}">${sourceName}</a>)`;

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
 * Fetch images from yande.re, Gelbooru, or both (top popular or random) and send them grouped as Telegram albums.
 * Uses 3.5s pacing between albums to prevent Telegram media queue congestion,
 * respects retry_after headers, and provides progressive retries and graceful splitting.
 */
export async function sendBooruPostsToChat(
  api: TelegramApi,
  chatId: number | string,
  rating: RatingFilter,
  limit: number = 30,
  spoilerNsfw: boolean = false,
  mode: DeliveryMode = "top",
  source: BooruSource = "both",
  gelbooruAuth?: { apiKey?: string; userId?: string },
  tagQuery?: string
): Promise<void> {
  const modeLabel = mode === "random" ? "random" : "top";
  let loadingText = tagQuery
    ? `⏳ <i>Searching for <b>${escapeHtml(tagQuery)}</b> (${limit} images each from yande.re &amp; Gelbooru)...</i>`
    : `⏳ <i>Fetching ${limit} ${modeLabel} images each from <b>yande.re</b> &amp; <b>Gelbooru</b>...</i>`;

  if (source === "yandere") {
    loadingText = tagQuery
      ? `⏳ <i>Searching yande.re for <b>${escapeHtml(tagQuery)}</b> (${limit} images)...</i>`
      : `⏳ <i>Fetching ${limit} ${modeLabel} images from <b>yande.re</b>...</i>`;
  } else if (source === "gelbooru") {
    loadingText = tagQuery
      ? `⏳ <i>Searching Gelbooru for <b>${escapeHtml(tagQuery)}</b> (${limit} images)...</i>`
      : `⏳ <i>Fetching ${limit} ${modeLabel} images from <b>Gelbooru</b>...</i>`;
  }

  const loadingRes = await api.sendMessage(chatId, loadingText);
  const loadingMsgId =
    loadingRes.ok && loadingRes.result?.message_id
      ? (loadingRes.result.message_id as number)
      : null;

  try {
    const { yanderePosts, gelbooruPosts, posts } = await fetchBooruPosts(
      source,
      rating,
      limit,
      mode,
      gelbooruAuth,
      tagQuery
    );

    if (posts.length === 0) {
      if (tagQuery) {
        // Look up autocomplete tag suggestions so user can tap to retry
        const suggestions = await searchBooruTags(tagQuery, 6, gelbooruAuth, source);
        let noFoundText = `⚠️ No images found matching: <code>${escapeHtml(tagQuery)}</code>`;
        let replyMarkup: { inline_keyboard: InlineKeyboardButton[][] } | undefined = undefined;

        if (suggestions.length > 0) {
          noFoundText += `\n\n💡 <b>Did you mean one of these tags?</b>`;
          const buttons: InlineKeyboardButton[][] = suggestions.slice(0, 4).map((s) => [
            {
              text: `${getTagTypeEmoji(s.type)} ${s.name} (${s.count.toLocaleString()})`,
              callback_data: `st:${source === "yandere" ? "y" : source === "gelbooru" ? "g" : "b"}:${s.name.slice(0, 45)}`,
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

      let noFoundText = `⚠️ No images found on yande.re.`;
      if (source === "gelbooru") {
        noFoundText = `⚠️ No images found on Gelbooru. Please check your GELBOORU_API_KEY and GELBOORU_USER_ID secrets.`;
      } else if (source === "both") {
        noFoundText = `⚠️ No images found on yande.re or Gelbooru.`;
      }
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

    // Turn "Fetching..." text into persistent banner
    let bannerText = "";
    if (source === "both") {
      const yCount = yanderePosts.length;
      const gCount = gelbooruPosts.length;
      if (tagQuery) {
        bannerText = `🔍 <b>"${escapeHtml(tagQuery)}" • ${yCount} yande.re + ${gCount} Gelbooru • ${formattedDate}</b>`;
      } else {
        bannerText =
          mode === "random"
            ? `🎲 <b>${yCount} yande.re + ${gCount} Gelbooru • ${formattedDate}</b>`
            : `🌟 <b>Top ${yCount} yande.re + ${gCount} Gelbooru • ${formattedDate}</b>`;
      }
    } else if (source === "gelbooru") {
      bannerText = tagQuery
        ? `🔍 <b>"${escapeHtml(tagQuery)}" • ${posts.length} Gelbooru • ${formattedDate}</b>`
        : (mode === "random"
          ? `🎲 <b>${posts.length} Random images of ${formattedDate} • Gelbooru</b>`
          : `🌟 <b>Top ${posts.length} images of ${formattedDate} • Gelbooru</b>`);
    } else {
      bannerText = tagQuery
        ? `🔍 <b>"${escapeHtml(tagQuery)}" • ${posts.length} yande.re • ${formattedDate}</b>`
        : (mode === "random"
          ? `🎲 <b>${posts.length} Random images of ${formattedDate} • yande.re</b>`
          : `🌟 <b>Top ${posts.length} images of ${formattedDate} • yande.re</b>`);
    }

    if (loadingMsgId) {
      await api.editMessageText(chatId, loadingMsgId, bannerText);
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

    let totalSent = 0;

    if (source === "both") {
      // 1. yande.re batch
      if (yanderePosts.length > 0) {
        await api.sendMessage(chatId, `🌸 <b>yande.re</b> (${yanderePosts.length} images)`);
        const yMedia = buildMediaGroup(yanderePosts);
        totalSent += await sendGroupBatches(yMedia);
      }

      // 2. Gelbooru batch
      if (gelbooruPosts.length > 0) {
        if (yanderePosts.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 3500));
        }
        await api.sendMessage(chatId, `🌀 <b>Gelbooru</b> (${gelbooruPosts.length} images)`);
        const gMedia = buildMediaGroup(gelbooruPosts);
        totalSent += await sendGroupBatches(gMedia);
      }
    } else {
      const media = buildMediaGroup(posts);
      totalSent += await sendGroupBatches(media);
    }

    // Emergency fallback if all photos were rejected
    if (totalSent === 0) {
      let textSummary = `${bannerText}\n\n`;
      posts.forEach((p, i) => {
        const srcName = p.source === "gelbooru" ? "Gelbooru" : "yande.re";
        textSummary += `${i + 1}. <a href="${p.postUrl}">${srcName} #${p.id}</a> - Score: ${p.score}\n`;
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
  { command: "search", description: "🔍 Search tag or character" },
  { command: "tags", description: "🏷️ Tag autocomplete & search" },
  { command: "random", description: "🎲 Random anime images" },
  { command: "both", description: "🌐 Fetch from yande.re + Gelbooru" },
  { command: "yan", description: "🌸 Fetch from yande.re" },
  { command: "gel", description: "🌀 Fetch from Gelbooru" },
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
  const gelAuth = { apiKey: config.gelbooruApiKey, userId: config.gelbooruUserId };

  switch (cmd) {
    case "/start": {
      // Auto-register command list and Menu button in Telegram UI
      await api.setMyCommands(DEFAULT_BOT_COMMANDS);
      await api.setChatMenuButton({ type: "commands" });

      await api.sendMessage(
        chat.id,
        `🌸 <b>Scene</b>\n\n` +
          `Daily & on-demand anime art from <b>yande.re</b> and <b>Gelbooru</b>.\n\n` +
          `<b>Available Commands:</b>\n` +
          `• <code>/today [count] [rating]</code> - Fetch top images (active source: ${config.source})\n` +
          `• <code>/search &lt;tag/character&gt;</code> - Search specific tag or character (alias: <code>/s</code>)\n` +
          `• <code>/tags &lt;query&gt;</code> - Check tag names & per-source counts (alias: <code>/find</code>)\n` +
          `• <code>/both [count] [rating]</code> - Fetch from both yande.re & Gelbooru\n` +
          `• <code>/yan [count] [rating]</code> - Fetch from yande.re\n` +
          `• <code>/gel [count] [rating]</code> - Fetch from Gelbooru\n` +
          `• <code>/random [count] [rating]</code> - Fetch random images\n` +
          `• <code>/settings</code> - View active configuration & quick panel\n` +
          `• <code>/myid</code> - View your Telegram Chat ID\n` +
          `• <code>/help</code> - Command reference\n\n` +
          `💡 <i>Tip: Use <code>/tags &lt;query&gt;</code> to browse tags with 1-click search buttons!</i>`
      );
      break;
    }

    case "/help": {
      await api.sendMessage(
        chat.id,
        `📖 <b>Help & Command Reference</b>\n\n` +
          `<b>Search & Tags:</b>\n` +
          `• <code>/search &lt;tag&gt; [count] [rating] [source]</code> (alias: <code>/s</code>)\n` +
          `  <i>e.g. <code>/search hu_tao</code>, <code>/s firefly 15 nsfw yan</code>, <code>/s raiden both</code></i>\n` +
          `  <i>Specify <code>yan</code>, <code>gel</code>, or <code>both</code> to choose source (defaults to active source).</i>\n` +
          `• <code>/tags &lt;query&gt; [source]</code> - Find tag names & per-source counts (alias: <code>/find</code>)\n` +
          `  <i>e.g. <code>/tags hu</code>, <code>/tags firefly yan</code>, <code>/tags raiden gel</code></i>\n\n` +
          `<b>Browse Commands:</b>\n` +
          `• <code>/today [count] [rating]</code> - Pull top images of the day\n` +
          `• <code>/both [count] [rating]</code> - Pull from both yande.re & Gelbooru\n` +
          `• <code>/yan [count] [rating]</code> - Pull from yande.re\n` +
          `• <code>/gel [count] [rating]</code> - Pull from Gelbooru\n` +
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
            `Usage: <code>/search &lt;tag or character&gt; [count] [rating] [source]</code>\n\n` +
            `<b>How Source Selection Works:</b>\n` +
            `• Default: Uses active bot source (<b>${config.source}</b>)\n` +
            `• <code>both</code>: Searches both yande.re &amp; Gelbooru\n` +
            `• <code>yan</code>: Searches yande.re only\n` +
            `• <code>gel</code>: Searches Gelbooru only\n\n` +
            `<b>Examples:</b>\n` +
            `• <code>/search hu_tao</code> (active: ${config.source})\n` +
            `• <code>/search hu_tao both</code>\n` +
            `• <code>/search firefly 15 nsfw yan</code>\n` +
            `• <code>/search marin_kitagawa 20 sfw gel</code>\n\n` +
            `💡 <i>Tip: Use <code>/tags &lt;query&gt;</code> to check if a tag exists on yande.re or Gelbooru!</i>`
        );
        break;
      }

      const { queryParts, rating, limit, spoilerNsfw, source } = parseSearchCommandArgs(
        args,
        config.rating,
        config.limit,
        config.spoilerNsfw,
        config.source
      );
      const tagQuery = queryParts.join("_");

      await sendBooruPostsToChat(
        api,
        chat.id,
        rating,
        limit,
        spoilerNsfw,
        "top",
        source,
        gelAuth,
        tagQuery
      );
      break;
    }

    case "/tags":
    case "/find":
    case "/autocomplete": {
      const { query, source } = parseTagCommandArgs(args, config.source);
      if (!query) {
        await api.sendMessage(
          chat.id,
          `🏷️ <b>Tag & Character Lookup</b>\n\n` +
            `Usage: <code>/tags &lt;query&gt; [source]</code>\n\n` +
            `<b>Examples:</b>\n` +
            `• <code>/tags hu</code> (searches active source: ${config.source})\n` +
            `• <code>/tags firefly yan</code> (searches yande.re)\n` +
            `• <code>/tags genshin gel</code> (searches Gelbooru)\n` +
            `• <code>/tags raiden both</code> (searches both)`
        );
        break;
      }

      const sourceLabel =
        source === "both"
          ? "Both (yande.re + Gelbooru) 🌐"
          : source === "gelbooru"
          ? "Gelbooru 🌀"
          : "yande.re 🌸";

      const tags = await searchBooruTags(query, 10, gelAuth, source);
      if (tags.length === 0) {
        await api.sendMessage(
          chat.id,
          `⚠️ No tags found matching <code>${escapeHtml(query)}</code> on ${sourceLabel}.`
        );
        break;
      }

      let listText = `🏷️ <b>Matching Tags for "${escapeHtml(query)}"</b>\n`;
      listText += `📡 <b>Source:</b> ${sourceLabel}\n\n`;

      const buttons: InlineKeyboardButton[][] = [];

      tags.forEach((t, i) => {
        const emoji = getTagTypeEmoji(t.type);
        const label = getTagTypeLabel(t.type);

        let countLine = "";
        if (source === "both") {
          const yanCount = t.yandereCount !== undefined ? t.yandereCount.toLocaleString() : "0";
          const gelCount = t.gelbooruCount !== undefined ? t.gelbooruCount.toLocaleString() : "0";
          countLine = `\n   └ 🌸 yande.re: <b>${yanCount}</b> • 🌀 Gelbooru: <b>${gelCount}</b>`;
        } else if (source === "yandere") {
          countLine = ` • ${t.count.toLocaleString()} posts`;
        } else {
          countLine = ` • ${t.count.toLocaleString()} posts`;
        }

        listText += `${i + 1}. ${emoji} <code>${t.name}</code> (${label})${countLine}\n`;

        if (i < 5) {
          if (source === "both") {
            buttons.push([
              {
                text: `🌐 Both: ${t.name}`,
                callback_data: `st:b:${t.name.slice(0, 45)}`,
              },
              {
                text: `🌸 yan`,
                callback_data: `st:y:${t.name.slice(0, 45)}`,
              },
              {
                text: `🌀 gel`,
                callback_data: `st:g:${t.name.slice(0, 45)}`,
              },
            ]);
          } else if (source === "yandere") {
            buttons.push([
              {
                text: `🌸 Search ${t.name} (${t.count.toLocaleString()})`,
                callback_data: `st:y:${t.name.slice(0, 45)}`,
              },
            ]);
          } else {
            buttons.push([
              {
                text: `🌀 Search ${t.name} (${t.count.toLocaleString()})`,
                callback_data: `st:g:${t.name.slice(0, 45)}`,
              },
            ]);
          }
        }
      });

      listText += `\n<i>Tap a button below to search instantly:</i>`;

      await api.sendMessage(chat.id, listText, {
        reply_markup: { inline_keyboard: buttons },
      });
      break;
    }

    case "/random":
    case "/rand": {
      const parsed = parseCommandArgs(args, config.rating, config.limit, config.spoilerNsfw, config.source);
      await sendBooruPostsToChat(
        api,
        chat.id,
        parsed.rating,
        parsed.limit,
        parsed.spoilerNsfw,
        "random",
        parsed.source || config.source,
        gelAuth
      );
      break;
    }

    case "/yan":
    case "/yandere": {
      const parsed = parseCommandArgs(args, config.rating, config.limit, config.spoilerNsfw, "yandere");
      await sendBooruPostsToChat(
        api,
        chat.id,
        parsed.rating,
        parsed.limit,
        parsed.spoilerNsfw,
        "top",
        "yandere",
        gelAuth
      );
      break;
    }

    case "/gel":
    case "/gelbooru": {
      const parsed = parseCommandArgs(args, config.rating, config.limit, config.spoilerNsfw, "gelbooru");
      await sendBooruPostsToChat(
        api,
        chat.id,
        parsed.rating,
        parsed.limit,
        parsed.spoilerNsfw,
        "top",
        "gelbooru",
        gelAuth
      );
      break;
    }

    case "/both": {
      const parsed = parseCommandArgs(args, config.rating, config.limit, config.spoilerNsfw, "both");
      await sendBooruPostsToChat(
        api,
        chat.id,
        parsed.rating,
        parsed.limit,
        parsed.spoilerNsfw,
        "top",
        "both",
        gelAuth
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
      const parsed = parseCommandArgs(args, config.rating, config.limit, config.spoilerNsfw, config.source);
      await sendBooruPostsToChat(
        api,
        chat.id,
        parsed.rating,
        parsed.limit,
        parsed.spoilerNsfw,
        "top",
        parsed.source || config.source,
        gelAuth
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
            [
              { text: "🌸 yande.re", callback_data: "fetch_yan" },
              { text: "🌀 Gelbooru", callback_data: "fetch_gel" },
              { text: "🌐 Both Sources", callback_data: "fetch_both" },
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
          `ℹ️ Unknown command: <code>${escapeHtml(cmd)}</code>\nUse /today, /search, /tags, /both, /yan, /gel, /random, or /help.`
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
  const gelAuth = { apiKey: config.gelbooruApiKey, userId: config.gelbooruUserId };

  if (
    callbackQuery.data &&
    (callbackQuery.data.startsWith("st:") || callbackQuery.data.startsWith("search_tag:"))
  ) {
    let targetSource: BooruSource = config.source;
    let tag = "";

    if (callbackQuery.data.startsWith("st:")) {
      const parts = callbackQuery.data.split(":");
      const srcCode = parts[1];
      tag = parts.slice(2).join(":");
      if (srcCode === "y") targetSource = "yandere";
      else if (srcCode === "g") targetSource = "gelbooru";
      else if (srcCode === "b") targetSource = "both";
    } else {
      tag = callbackQuery.data.slice("search_tag:".length);
    }

    const srcLabel =
      targetSource === "both"
        ? "both sources"
        : targetSource === "gelbooru"
        ? "Gelbooru"
        : "yande.re";

    await api.answerCallbackQuery(callbackQuery.id, `Searching ${srcLabel} for ${tag}...`);
    await sendBooruPostsToChat(
      api,
      msg.chat.id,
      config.rating,
      config.limit,
      config.spoilerNsfw,
      "top",
      targetSource,
      gelAuth,
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
        "top",
        config.source,
        gelAuth
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
        "random",
        config.source,
        gelAuth
      );
      break;
    }

    case "fetch_sfw": {
      await api.answerCallbackQuery(callbackQuery.id, "Fetching top 10 SFW...");
      await sendBooruPostsToChat(api, msg.chat.id, "sfw", 10, false, "top", config.source, gelAuth);
      break;
    }

    case "fetch_nsfw": {
      await api.answerCallbackQuery(callbackQuery.id, "Fetching top 10 NSFW...");
      await sendBooruPostsToChat(api, msg.chat.id, "nsfw", 10, config.spoilerNsfw, "top", config.source, gelAuth);
      break;
    }

    case "fetch_yan": {
      await api.answerCallbackQuery(callbackQuery.id, `Fetching ${config.limit} images from yande.re...`);
      await sendBooruPostsToChat(
        api,
        msg.chat.id,
        config.rating,
        config.limit,
        config.spoilerNsfw,
        config.mode,
        "yandere",
        gelAuth
      );
      break;
    }

    case "fetch_gel": {
      await api.answerCallbackQuery(callbackQuery.id, `Fetching ${config.limit} images from Gelbooru...`);
      await sendBooruPostsToChat(
        api,
        msg.chat.id,
        config.rating,
        config.limit,
        config.spoilerNsfw,
        config.mode,
        "gelbooru",
        gelAuth
      );
      break;
    }

    case "fetch_both": {
      await api.answerCallbackQuery(callbackQuery.id, `Fetching ${config.limit} images each from both sources...`);
      await sendBooruPostsToChat(
        api,
        msg.chat.id,
        config.rating,
        config.limit,
        config.spoilerNsfw,
        config.mode,
        "both",
        gelAuth
      );
      break;
    }

    default:
      await api.answerCallbackQuery(callbackQuery.id);
  }
}

/**
 * Daily Scheduled Broadcast Execution.
 * Pushes anime art from yande.re / Gelbooru directly to the owner at 8:00 AM UTC+7 (follows DEFAULT_MODE).
 */
export async function handleScheduledBroadcast(env: Env): Promise<string> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const api = new TelegramApi(token);
  const config = getConfig(env);
  const gelAuth = { apiKey: config.gelbooruApiKey, userId: config.gelbooruUserId };

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
        config.mode,
        config.source,
        gelAuth
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
 * Triggered as the user types `@botusername query`
 */
export async function handleTelegramInlineQuery(
  inlineQuery: TelegramInlineQuery,
  env: Env
): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const api = new TelegramApi(token);
  const config = getConfig(env);
  const gelAuth = { apiKey: config.gelbooruApiKey, userId: config.gelbooruUserId };

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
            message_text: "/tags",
          },
        },
      ],
      { cache_time: 5, is_personal: true }
    );
    return;
  }

  try {
    const suggestions = await searchBooruTags(query, 12, gelAuth, config.source);
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
              message_text: `/tags ${query}`,
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
      let desc = "";
      if (config.source === "both") {
        const yanStr = tag.yandereCount !== undefined ? tag.yandereCount.toLocaleString() : "0";
        const gelStr = tag.gelbooruCount !== undefined ? tag.gelbooruCount.toLocaleString() : "0";
        desc = `🌸 yande.re: ${yanStr} • 🌀 Gelbooru: ${gelStr} posts`;
      } else {
        const srcName = config.source === "gelbooru" ? "Gelbooru" : "yande.re";
        desc = `${tag.count.toLocaleString()} posts on ${srcName}`;
      }

      return {
        type: "article",
        id: `tag_${idx}_${tag.name}`,
        title: `${emoji} ${tag.name} (${label})`,
        description: desc,
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
