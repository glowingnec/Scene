/**
 * 🌸 Scene Telegram Bot - Cloudflare Worker
 *
 * Dedicated to @cheytac29 (Chat ID: 1368225736)
 * - Source: yande.re
 * - Rating: ALL (SFW + Questionable + Explicit)
 * - Default Count: 30 images (batched into albums of 10 with 5+5 fallback)
 * - Spoilers: OFF (Unblurred) by default
 * - Scheduled Cron: Daily 8:00 AM UTC+7 (01:00 UTC)
 */

const DEFAULT_CONFIG = {
  OWNER_USERNAME: "cheytac29",
  OWNER_CHAT_ID: 1368225736,
  DEFAULT_SOURCE: "yandere",
  DEFAULT_RATING: "all",
  DEFAULT_LIMIT: 30,
  DEFAULT_SPOILER_NSFW: false,
};

const YANDERE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Referer": "https://yande.re/",
};

function parseChatTarget(val) {
  if (!val) return undefined;
  if (typeof val === "number") return val;
  const trimmed = String(val).trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("@")) return trimmed;
  const num = parseInt(trimmed, 10);
  return isNaN(num) ? trimmed : num;
}

function getConfig(env) {
  const rawRating = (env.DEFAULT_RATING || DEFAULT_CONFIG.DEFAULT_RATING).toLowerCase();
  const rating = rawRating === "sfw" ? "sfw" : rawRating === "nsfw" ? "nsfw" : "all";

  const rawLimit = env.DEFAULT_LIMIT ? parseInt(env.DEFAULT_LIMIT, 10) : DEFAULT_CONFIG.DEFAULT_LIMIT;
  const limit = isNaN(rawLimit) || rawLimit < 1 || rawLimit > 50 ? 30 : rawLimit;

  const rawSpoiler = (env.DEFAULT_SPOILER_NSFW || "").toLowerCase();
  const spoilerNsfw = rawSpoiler === "true";

  const ownerChatId = parseChatTarget(env.OWNER_CHAT_ID || env.CHANNEL_ID) || DEFAULT_CONFIG.OWNER_CHAT_ID;

  return {
    source: "yandere",
    rating,
    limit,
    ownerChatId,
    subscribedChatIds: [ownerChatId],
    spoilerNsfw,
  };
}

function isOwner(from, env) {
  if (!from) return false;
  const ownerUsername = (env.OWNER_USERNAME || DEFAULT_CONFIG.OWNER_USERNAME).replace(/^@/, "").toLowerCase();
  const ownerChatId = (env.OWNER_CHAT_ID || DEFAULT_CONFIG.OWNER_CHAT_ID).toString();

  if (from.username && from.username.toLowerCase() === ownerUsername) return true;
  if (from.id && from.id.toString() === ownerChatId) return true;
  return false;
}

function escapeHtml(str) {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getRatingBadgeText(rating) {
  if (rating === "sfw") return "SFW Mode 🛡️";
  if (rating === "nsfw") return "NSFW Mode ⚠️";
  return "Both SFW+NSFW 🌈";
}

function formatSettingsText(config) {
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

async function fetchYanderePosts(ratingFilter, limit = 30) {
  let rawPosts = [];

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();

  // 1. Primary: popular by current day
  try {
    const popularUrl = `https://yande.re/post/popular_by_day.json?year=${year}&month=${month}&day=${day}`;
    const res = await fetch(popularUrl, { headers: YANDERE_HEADERS });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) rawPosts = data;
    }
  } catch (err) {
    console.warn("yande.re popular_by_day request error:", err);
  }

  // 2. Query yesterday if today is early
  if (rawPosts.length < limit) {
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const yUrl = `https://yande.re/post/popular_by_day.json?year=${yesterday.getUTCFullYear()}&month=${yesterday.getUTCMonth() + 1}&day=${yesterday.getUTCDate()}`;
      const res = await fetch(yUrl, { headers: YANDERE_HEADERS });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) rawPosts = [...rawPosts, ...data];
      }
    } catch (err) {
      console.warn("yande.re yesterday popular request error:", err);
    }
  }

  // 3. Fallback: search by score
  if (rawPosts.length === 0) {
    try {
      let ratingTag = "";
      if (ratingFilter === "sfw") ratingTag = "rating:s";
      else if (ratingFilter === "nsfw") ratingTag = "rating:q,e";

      const searchTags = ["order:score", ratingTag].filter(Boolean).join(" ");
      const searchUrl = `https://yande.re/post.json?tags=${encodeURIComponent(searchTags)}&limit=${Math.min(100, Math.max(limit * 2, 30))}`;
      const res = await fetch(searchUrl, { headers: YANDERE_HEADERS });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) rawPosts = data;
      }
    } catch (err) {
      console.error("yande.re search fallback error:", err);
    }
  }

  // Fetch tag categorization map from yande.re tag summary
  const tagMap = await getTagTypeMap();

  const validPosts = [];
  const seenIds = new Set();

  for (const post of rawPosts) {
    if (seenIds.has(post.id)) continue;
    seenIds.add(post.id);

    if (post.status === "deleted" || post.is_banned) continue;

    const rating = (post.rating || "q").toLowerCase();
    const isNsfw = rating === "e" || rating === "q";

    if (ratingFilter === "sfw" && isNsfw) continue;
    if (ratingFilter === "nsfw" && !isNsfw) continue;

    const imageUrl = post.sample_url || post.jpeg_url || post.file_url;
    if (!imageUrl) continue;

    const ext = (post.file_ext || "").toLowerCase();
    if (ext === "zip" || ext === "mp4" || ext === "webm") continue;

    const postTags = (post.tags || "").split(" ").filter(Boolean);
    const charTags = [];
    const copyTags = [];
    const artistTags = [];

    for (const t of postTags) {
      const type = tagMap.get(t);
      if (type === 4) {
        charTags.push(t);
      } else if (type === 3) {
        copyTags.push(t);
      } else if (type === 1) {
        artistTags.push(t);
      }
    }

    // Heuristic fallback if tagMap was unavailable
    if (tagMap.size === 0) {
      for (const t of postTags) {
        if (GENERAL_FALLBACK_TAGS.has(t.toLowerCase())) continue;
        const match = t.match(/_\(([^)]+)\)$/);
        if (match) {
          const paren = match[1].toLowerCase();
          if (NON_COPYRIGHT_PARENS.has(paren)) {
            charTags.push(t);
          } else {
            charTags.push(t.slice(0, match.index));
            copyTags.push(match[1]);
          }
        } else if (KNOWN_FRANCHISES.some((f) => t.toLowerCase().includes(f))) {
          copyTags.push(t);
        } else {
          charTags.push(t);
        }
      }
    }

    // If no copyright found yet, check if any character tag contains series parenthetical
    if (copyTags.length === 0) {
      for (const c of charTags) {
        const match = c.match(/_\(([^)]+)\)$/);
        if (match) {
          const paren = match[1].toLowerCase();
          if (!NON_COPYRIGHT_PARENS.has(paren)) {
            copyTags.push(match[1]);
            break;
          }
        }
      }
    }

    validPosts.push({
      id: post.id,
      imageUrl,
      postUrl: `https://yande.re/post/show/${post.id}`,
      sourceUrl: post.source ? post.source.trim() : undefined,
      rating,
      isNsfw,
      tags: postTags,
      artist: artistTags.length > 0 ? artistTags[0] : undefined,
      characterTags: charTags,
      copyrightTags: copyTags,
      score: post.score || 0,
    });

    if (validPosts.length >= limit) break;
  }

  return validPosts;
}

let cachedTagMap = null;
let lastTagMapFetch = 0;
const TAG_MAP_CACHE_TTL = 1000 * 60 * 60 * 12; // 12 hours

const NON_COPYRIGHT_PARENS = new Set([
  "female", "male", "cosplay", "costume", "style", "swimsuit", "maid",
  "bunny", "young", "older", "futa", "monster", "armor", "uniform",
  "alter", "santa", "summer", "bride", "wedding", "idol"
]);

const KNOWN_FRANCHISES = [
  "genshin", "blue_archive", "zenless", "idolm", "wuthering", "honkai",
  "touhou", "azur_lane", "arknights", "yani_neko", "kairakuten", "seitokai",
  "fate", "vocaloid", "pokemon", "chainsaw_man", "hololive", "nijisanji"
];

const GENERAL_FALLBACK_TAGS = new Set([
  "solo", "1girl", "2girls", "3girls", "4girls", "multiple_girls", "1boy", "2boys", "tagme",
  "highres", "absurdres", "wallpaper", "dress", "bikini", "swimsuits", "breasts", "cleavage",
  "looking_at_viewer", "smile", "thighhighs", "panties", "underwear", "pantyhose", "tail", "wings"
]);

async function getTagTypeMap() {
  const now = Date.now();
  if (cachedTagMap && now - lastTagMapFetch < TAG_MAP_CACHE_TTL) {
    return cachedTagMap;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch("https://yande.re/tag/summary.json", {
      headers: {
        "User-Agent": YANDERE_HEADERS["User-Agent"],
        "Accept-Encoding": "gzip",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const json = await res.json();
      if (json && json.data) {
        const map = new Map();
        const entries = json.data.split(" ");
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          if (!entry) continue;
          const parts = entry.split("`");
          if (parts.length >= 2) {
            const type = parseInt(parts[0], 10);
            if (!isNaN(type)) {
              for (let j = 1; j < parts.length; j++) {
                if (parts[j]) {
                  map.set(parts[j], type);
                }
              }
            }
          }
        }
        cachedTagMap = map;
        lastTagMapFetch = now;
        return map;
      }
    }
  } catch (err) {
    console.warn("yande.re tag summary fetch error:", err);
  }

  if (cachedTagMap) return cachedTagMap;
  return new Map();
}

class TelegramApi {
  constructor(token) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async sendMessage(chatId, text, options = {}) {
    try {
      const res = await fetch(`${this.baseUrl}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: options.parse_mode ?? "HTML",
          reply_markup: options.reply_markup,
          disable_web_page_preview: options.disable_web_page_preview ?? false,
        }),
      });
      return await res.json();
    } catch (err) {
      return { ok: false, description: err?.message || "Network error" };
    }
  }

  async sendMediaGroup(chatId, media) {
    try {
      const res = await fetch(`${this.baseUrl}/sendMediaGroup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, media }),
      });
      return await res.json();
    } catch (err) {
      return { ok: false, description: err?.message || "Network error" };
    }
  }

  async sendPhoto(chatId, photo, options = {}) {
    try {
      const res = await fetch(`${this.baseUrl}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          photo,
          caption: options.caption,
          parse_mode: options.parse_mode ?? "HTML",
          has_spoiler: options.has_spoiler,
        }),
      });
      return await res.json();
    } catch (err) {
      return { ok: false, description: err?.message || "Network error" };
    }
  }

  async answerCallbackQuery(callbackQueryId, text) {
    const res = await fetch(`${this.baseUrl}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });
    return await res.json();
  }

  async setWebhook(url, secretToken) {
    const res = await fetch(`${this.baseUrl}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        secret_token: secretToken,
        allowed_updates: ["message", "callback_query"],
      }),
    });
    return await res.json();
  }

  async deleteMessage(chatId, messageId) {
    try {
      const res = await fetch(`${this.baseUrl}/deleteMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
        }),
      });
      return await res.json();
    } catch (err) {
      return { ok: false, description: err?.message || "Network error" };
    }
  }
}

async function sendAlbumBatch(api, chatId, items) {
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

function toTitleCase(name) {
  if (!name) return "";
  const clean = name.replace(/_\((?:series|game|anime|manga|novel)\)$/i, "");
  const parts = clean.split("_");
  const res = [];
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

function cleanCharacterName(charTag, copyrightTags) {
  const match = charTag.match(/_\(([^)]+)\)$/);
  if (match) {
    const paren = match[1].toLowerCase();
    const isSeries = (copyrightTags || []).some(
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

function getSourcePlatform(url) {
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

function formatPostCaption(post, index, displayCount, todayDate) {
  const isFirst = index === 0;
  let caption = isFirst
    ? `🌟 <b>Top ${displayCount} Today • yande.re</b>\n📅 ${todayDate}\n\n`
    : "";

  // Line 1: #11 Score: 6 (yande.re)
  caption += `#${index + 1} Score: ${post.score} (<a href="${post.postUrl}">yande.re</a>)`;

  // Line 2: Character • Copyright / by: Artist name (or Platform)
  const chars = (post.characterTags || []).map((c) =>
    toTitleCase(cleanCharacterName(c, post.copyrightTags || []))
  );
  const copies = (post.copyrightTags || []).map(toTitleCase);

  const charStr = chars.slice(0, 2).join(", ");
  const copyStr = copies.length > 0 ? copies[0] : "";

  const tagParts = [];
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

async function sendBooruPostsToChat(api, chatId, rating, limit = 30, spoilerNsfw = false) {
  const loadingRes = await api.sendMessage(chatId, `⏳ <i>Fetching top ${limit} images from <b>yande.re</b>...</i>`);
  const loadingMsgId = loadingRes && loadingRes.ok && loadingRes.result && loadingRes.result.message_id ? loadingRes.result.message_id : null;

  try {
    const posts = await fetchYanderePosts(rating, limit);
    if (posts.length === 0) {
      await api.sendMessage(chatId, `⚠️ No images found on yande.re today.`);
      return;
    }

    const todayDate = new Date().toISOString().split("T")[0];
    const displayCount = Math.min(posts.length, limit);

    const mediaGroup = posts.slice(0, displayCount).map((post, idx) => {
      const caption = formatPostCaption(post, idx, displayCount, todayDate);
      return {
        type: "photo",
        media: post.imageUrl,
        caption: caption.slice(0, 1024),
        parse_mode: "HTML",
        has_spoiler: spoilerNsfw && post.isNsfw,
      };
    });

    let totalSent = 0;

    for (let i = 0; i < mediaGroup.length; i += 10) {
      const batch = mediaGroup.slice(i, i + 10);

      if (i > 0) {
        // Wait 3.5s between media groups to satisfy Telegram's media download queue & single-chat pacing
        await new Promise((r) => setTimeout(r, 3500));
      }

      const sent = await sendAlbumBatch(api, chatId, batch);
      totalSent += sent;
    }

    if (totalSent === 0) {
      let textSummary = `🌟 <b>Top ${displayCount} Today • yande.re</b>\n📅 ${todayDate}\n\n`;
      posts.slice(0, displayCount).forEach((p, i) => {
        textSummary += `${i + 1}. <a href="${p.postUrl}">Post #${p.id}</a> - Score: ${p.score}\n`;
      });
      await api.sendMessage(chatId, textSummary, { disable_web_page_preview: false });
    }
  } catch (err) {
    console.error("sendBooruPostsToChat error:", err);
    await api.sendMessage(chatId, `❌ Failed to load images: ${escapeHtml(err.message || "Unknown error")}`);
  } finally {
    if (loadingMsgId) {
      await api.deleteMessage(chatId, loadingMsgId);
    }
  }
}

function parseCommandArgs(args, defaultRating, defaultLimit, defaultSpoiler = false) {
  let rating = defaultRating;
  let limit = defaultLimit;
  let spoilerNsfw = defaultSpoiler;

  for (const arg of args) {
    const lower = arg.toLowerCase();
    if (lower === "nsfw") rating = "nsfw";
    else if (lower === "sfw") rating = "sfw";
    else if (lower === "all" || lower === "both") rating = "all";
    else if (lower === "nospoiler" || lower === "unspoiler" || lower === "clean") spoilerNsfw = false;
    else if (lower === "spoiler" || lower === "blur") spoilerNsfw = true;
    else {
      const num = parseInt(lower, 10);
      if (!isNaN(num) && num > 0 && num <= 50) limit = num;
    }
  }

  return { rating, limit, spoilerNsfw };
}

async function handleTelegramMessage(message, env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const api = new TelegramApi(token);
  const from = message.from;
  const chat = message.chat;
  const text = (message.text || "").trim();

  // Strict owner restriction
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
          `• <code>/myid</code> - View your Telegram Chat ID`
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
      await sendBooruPostsToChat(api, chat.id, parsed.rating, parsed.limit, parsed.spoilerNsfw);
      break;
    }

    case "/settings":
    case "/panel":
    case "/config": {
      await api.sendMessage(chat.id, formatSettingsText(config), {
        reply_markup: {
          inline_keyboard: [
            [{ text: `🚀 Fetch Top ${config.limit} Now`, callback_data: "fetch_top" }],
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
        await api.sendMessage(chat.id, `ℹ️ Unknown command: <code>${escapeHtml(cmd)}</code>\nUse /today to fetch images or /help for commands.`);
      }
      break;
  }
}

async function handleTelegramCallbackQuery(callbackQuery, env) {
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
      await sendBooruPostsToChat(api, msg.chat.id, config.rating, config.limit, config.spoilerNsfw);
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

async function handleScheduledBroadcast(env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const api = new TelegramApi(token);
  const config = getConfig(env);

  const targets = new Set();
  if (config.ownerChatId) targets.add(config.ownerChatId);
  config.subscribedChatIds.forEach((id) => targets.add(id));

  let sentCount = 0;
  for (const chatId of targets) {
    try {
      await sendBooruPostsToChat(api, chatId, config.rating, config.limit, config.spoilerNsfw);
      sentCount++;
    } catch (err) {
      console.error(`Daily broadcast failed for chat ${chatId}:`, err);
    }
  }

  return `Broadcast sent to ${sentCount}/${targets.size} chats.`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return new Response(
        JSON.stringify({
          status: "healthy",
          bot: "Scene Telegram Bot",
          source: "yandere",
          owner: env.OWNER_USERNAME || DEFAULT_CONFIG.OWNER_USERNAME,
          timestamp: new Date().toISOString(),
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    const token = env.TELEGRAM_BOT_TOKEN;

    if (request.method === "GET" && url.pathname === "/setup-webhook") {
      if (!token) return new Response("Error: TELEGRAM_BOT_TOKEN is not set.", { status: 500 });
      const webhookUrl = `${url.origin}/webhook`;
      const api = new TelegramApi(token);
      const res = await api.setWebhook(webhookUrl, env.SECRET_TOKEN);
      return new Response(JSON.stringify({ configured_url: webhookUrl, telegram_response: res }, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "POST" && (url.pathname === "/webhook" || url.pathname === "/")) {
      if (env.SECRET_TOKEN) {
        const headerSecret = request.headers.get("x-telegram-bot-api-secret-token");
        if (headerSecret !== env.SECRET_TOKEN) return new Response("Unauthorized", { status: 401 });
      }

      try {
        const update = await request.json();
        if (update.message) {
          ctx.waitUntil(handleTelegramMessage(update.message, env));
        } else if (update.callback_query) {
          ctx.waitUntil(handleTelegramCallbackQuery(update.callback_query, env));
        }
        return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" }, status: 200 });
      } catch (err) {
        console.error("Webhook processing error:", err);
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
    }

    if (request.method === "GET" && (url.pathname === "/test-scheduled" || url.pathname === "/cron")) {
      try {
        const result = await handleScheduledBroadcast(env);
        return new Response(
          JSON.stringify({ ok: true, message: result, timestamp: new Date().toISOString() }, null, 2),
          { headers: { "Content-Type": "application/json" } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ ok: false, error: err.message }, null, 2),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    const token = env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.error("TELEGRAM_BOT_TOKEN not configured in scheduled cron execution.");
      return;
    }

    try {
      console.log(`Daily cron trigger fired: ${event.cron}`);
      const res = await handleScheduledBroadcast(env);
      console.log(`Daily broadcast completed: ${res}`);
    } catch (err) {
      console.error("Daily cron broadcast failed:", err);
    }
  },
};
