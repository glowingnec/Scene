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
  DEFAULT_RATING: "all",
  DEFAULT_LIMIT: 30,
  DEFAULT_MODE: "top",
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

  const rawMode = (env.DEFAULT_MODE || env.DELIVERY_MODE || DEFAULT_CONFIG.DEFAULT_MODE).toLowerCase();
  const mode = rawMode === "random" ? "random" : "top";

  const rawSpoiler = (env.DEFAULT_SPOILER_NSFW || "").toLowerCase();
  const spoilerNsfw = rawSpoiler === "true";

  const ownerChatId = parseChatTarget(env.OWNER_CHAT_ID || env.CHANNEL_ID) || DEFAULT_CONFIG.OWNER_CHAT_ID;

  return {
    rating,
    mode,
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

const SETTINGS_HEADER = "⚙️ <b>Settings</b>";

function buildSettingsMessage(settings) {
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

  const replyMarkup = {
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

function parseSettingsText(text, fallback) {
  if (!text) return fallback;

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

  let mode = fallback.mode;
  let rating = fallback.rating;
  let limit = fallback.limit;
  let spoilerNsfw = fallback.spoilerNsfw;

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

async function fetchChatSettings(api, ownerChatId, env) {
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

async function ensurePinnedSettings(api, chatId, env) {
  const { settings, pinnedMessageId } = await fetchChatSettings(api, chatId, env);
  const { text, replyMarkup } = buildSettingsMessage(settings);

  if (pinnedMessageId) {
    await api.editMessageText(chatId, pinnedMessageId, text, { reply_markup: replyMarkup });
    return { messageId: pinnedMessageId, settings };
  }

  const sendRes = await api.sendMessage(chatId, text, { reply_markup: replyMarkup });
  const newMsgId = sendRes.ok && sendRes.result?.message_id ? sendRes.result.message_id : null;

  if (newMsgId) {
    await api.pinChatMessage(chatId, newMsgId, { disable_notification: true });
    return { messageId: newMsgId, settings };
  }

  return { messageId: 0, settings };
}

function getTagTypeLabel(type) {
  switch (type) {
    case 4:
      return "Character";
    case 3:
      return "Series / Copyright";
    case 1:
      return "Artist";
    default:
      return "General";
  }
}

function getTagTypeEmoji(type) {
  switch (type) {
    case 4:
      return "👤";
    case 3:
      return "📚";
    case 1:
      return "🎨";
    default:
      return "🏷️";
  }
}

async function searchBooruTags(query, limit = 10) {
  const clean = query.trim().toLowerCase().replace(/\s+/g, "_");
  if (!clean) return [];

  try {
    const url = `https://yande.re/tag.json?name=*${encodeURIComponent(clean)}*&order=count&limit=${limit * 2}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data
      .map((t) => ({
        name: t.name,
        count: t.count || 0,
        type: t.type ?? 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  } catch (err) {
    console.warn("yande.re tag search error:", err);
    return [];
  }
}

async function fetchYanderePosts(ratingFilter, limit = 30, mode = "top", tagQuery) {
  let rawPosts = [];

  if (tagQuery && tagQuery.trim()) {
    try {
      const cleanTag = tagQuery.trim().replace(/\s+/g, "_");
      let ratingTag = "";
      if (ratingFilter === "sfw") ratingTag = "rating:s";
      else if (ratingFilter === "nsfw") ratingTag = "rating:q,e";

      const orderTag = mode === "random" ? "order:random" : "order:score";
      const searchTags = [cleanTag, orderTag, ratingTag].filter(Boolean).join(" ");
      const searchUrl = `https://yande.re/post.json?tags=${encodeURIComponent(searchTags)}&limit=${Math.min(100, Math.max(limit * 2, 30))}`;
      const res = await fetch(searchUrl, { headers: YANDERE_HEADERS });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) rawPosts = data;
      }
    } catch (err) {
      console.error("yande.re tag search error:", err);
    }
  } else if (mode === "random") {
    try {
      let ratingTag = "";
      if (ratingFilter === "sfw") ratingTag = "rating:s";
      else if (ratingFilter === "nsfw") ratingTag = "rating:q,e";

      const searchTags = ["order:random", ratingTag].filter(Boolean).join(" ");
      const searchUrl = `https://yande.re/post.json?tags=${encodeURIComponent(searchTags)}&limit=${Math.min(100, Math.max(limit * 2, 30))}`;
      const res = await fetch(searchUrl, { headers: YANDERE_HEADERS });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) rawPosts = data;
      }
    } catch (err) {
      console.error("yande.re random fetch error:", err);
    }
  } else {
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
      source: "yandere",
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

async function fetchBooruPosts(rating, limit = 30, mode = "top", tagQuery) {
  return await fetchYanderePosts(rating, limit, mode, tagQuery);
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
]);

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
      headers: YANDERE_HEADERS,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const tagMap = new Map();

    if (data && typeof data.data === "string") {
      const parts = data.data.split(" ");
      let currentType = 0;

      for (const token of parts) {
        if (!token) continue;
        if (/^\d+$/.test(token)) {
          currentType = parseInt(token, 10);
        } else {
          tagMap.set(token, currentType);
        }
      }
    }

    if (tagMap.size > 0) {
      cachedTagMap = tagMap;
      lastTagMapFetch = now;
      return tagMap;
    }
  } catch (err) {
    console.warn("yande.re tag summary fetch failed, using fallback regex:", err);
  }

  return cachedTagMap || new Map();
}

class TelegramApi {
  constructor(token) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async sendMessage(chatId, text, options) {
    try {
      const res = await fetch(`${this.baseUrl}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: options?.parse_mode ?? "HTML",
          reply_markup: options?.reply_markup,
          disable_web_page_preview: options?.disable_web_page_preview ?? false,
        }),
      });
      return await res.json();
    } catch (err) {
      return { ok: false, description: err.message || "Network request failed" };
    }
  }

  async sendMediaGroup(chatId, media) {
    try {
      const res = await fetch(`${this.baseUrl}/sendMediaGroup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          media,
        }),
      });
      return await res.json();
    } catch (err) {
      return { ok: false, description: err.message || "Network request failed" };
    }
  }

  async sendPhoto(chatId, photo, options) {
    try {
      const res = await fetch(`${this.baseUrl}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          photo,
          caption: options?.caption,
          parse_mode: options?.parse_mode ?? "HTML",
          has_spoiler: options?.has_spoiler,
        }),
      });
      return await res.json();
    } catch (err) {
      return { ok: false, description: err.message || "Network request failed" };
    }
  }

  async editMessageText(chatId, messageId, text, options) {
    try {
      const res = await fetch(`${this.baseUrl}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text,
          parse_mode: options?.parse_mode ?? "HTML",
          reply_markup: options?.reply_markup,
        }),
      });
      return await res.json();
    } catch (err) {
      return { ok: false, description: err.message };
    }
  }

  async answerCallbackQuery(callbackQueryId, text, showAlert = false) {
    try {
      const res = await fetch(`${this.baseUrl}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text,
          show_alert: showAlert,
        }),
      });
      return await res.json();
    } catch (err) {
      return { ok: false, description: err.message };
    }
  }

  async answerInlineQuery(inlineQueryId, results, options) {
    try {
      const res = await fetch(`${this.baseUrl}/answerInlineQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inline_query_id: inlineQueryId,
          results,
          cache_time: options?.cache_time ?? 300,
          is_personal: options?.is_personal ?? false,
        }),
      });
      return await res.json();
    } catch (err) {
      return { ok: false, description: err.message || "Network request failed" };
    }
  }

  async setWebhook(url, secretToken) {
    try {
      const res = await fetch(`${this.baseUrl}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          secret_token: secretToken,
          allowed_updates: ["message", "callback_query", "inline_query"],
        }),
      });
      return await res.json();
    } catch (err) {
      return { ok: false, description: err.message };
    }
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
      return { ok: false, description: err.message || "Network request failed" };
    }
  }

  async setMyCommands(commands) {
    try {
      const res = await fetch(`${this.baseUrl}/setMyCommands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commands }),
      });
      return await res.json();
    } catch (err) {
      return { ok: false, description: err.message || "Network request failed" };
    }
  }

  async setChatMenuButton(menuButton = { type: "commands" }) {
    try {
      const res = await fetch(`${this.baseUrl}/setChatMenuButton`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ menu_button: menuButton }),
      });
      return await res.json();
    } catch (err) {
      return { ok: false, description: err.message || "Network request failed" };
    }
  }

  async getChat(chatId) {
    try {
      const res = await fetch(`${this.baseUrl}/getChat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId }),
      });
      return await res.json();
    } catch (err) {
      return { ok: false, description: err.message || "Network request failed" };
    }
  }

  async pinChatMessage(chatId, messageId, options) {
    try {
      const res = await fetch(`${this.baseUrl}/pinChatMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          disable_notification: options?.disable_notification ?? true,
        }),
      });
      return await res.json();
    } catch (err) {
      return { ok: false, description: err.message || "Network request failed" };
    }
  }

  async unpinChatMessage(chatId, messageId) {
    try {
      const res = await fetch(`${this.baseUrl}/unpinChatMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
        }),
      });
      return await res.json();
    } catch (err) {
      return { ok: false, description: err.message || "Network request failed" };
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

function formatPostCaption(post, index, formattedDate, mode = "top") {
  let caption = `#${index + 1} Score: ${post.score} (<a href="${post.postUrl}">yande.re</a>)`;

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

async function sendBooruPostsToChat(
  api,
  chatId,
  rating,
  limit = 30,
  spoilerNsfw = false,
  mode = "top",
  tagQuery
) {
  const modeLabel = mode === "random" ? "random" : "top";
  const loadingText = tagQuery
    ? `⏳ <i>Searching yande.re for <b>${escapeHtml(tagQuery)}</b> (${limit} images)...</i>`
    : `⏳ <i>Fetching ${limit} ${modeLabel} images from <b>yande.re</b>...</i>`;

  const loadingRes = await api.sendMessage(chatId, loadingText);
  const loadingMsgId =
    loadingRes.ok && loadingRes.result?.message_id
      ? loadingRes.result.message_id
      : null;

  try {
    const posts = await fetchBooruPosts(rating, limit, mode, tagQuery);

    if (posts.length === 0) {
      if (tagQuery) {
        const suggestions = await searchBooruTags(tagQuery, 6);
        let noFoundText = `⚠️ No images found matching: <code>${escapeHtml(tagQuery)}</code>`;
        let replyMarkup = undefined;

        if (suggestions.length > 0) {
          noFoundText += `\n\n💡 <b>Did you mean one of these tags?</b>`;
          const buttons = suggestions.slice(0, 4).map((s) => [
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

    let bannerText = "";
    if (tagQuery) {
      bannerText = `🔍 <b>"${escapeHtml(tagQuery)}" • ${posts.length} yande.re • ${formattedDate}</b>`;
    } else {
      bannerText =
        mode === "random"
          ? `🎲 <b>${posts.length} Random images of ${formattedDate} • yande.re</b>`
          : `🌟 <b>Top ${posts.length} yande.re • ${formattedDate}</b>`;
    }

    if (loadingMsgId) {
      await api.editMessageText(chatId, loadingMsgId, bannerText);
    } else {
      await api.sendMessage(chatId, bannerText);
    }

    const buildMediaGroup = (items) =>
      items.map((post, idx) => ({
        type: "photo",
        media: post.imageUrl,
        caption: formatPostCaption(post, idx, formattedDate, mode),
        parse_mode: "HTML",
        has_spoiler: spoilerNsfw && post.isNsfw,
      }));

    const BATCH_SIZE = 10;
    let totalSent = 0;

    for (let i = 0; i < posts.length; i += BATCH_SIZE) {
      const chunk = posts.slice(i, i + BATCH_SIZE);
      const mediaGroup = buildMediaGroup(chunk);

      const sentInBatch = await sendAlbumBatch(api, chatId, mediaGroup);
      totalSent += sentInBatch;

      if (i + BATCH_SIZE < posts.length) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    console.log(`Delivered ${totalSent}/${posts.length} images to ${chatId}`);
  } catch (err) {
    console.error("sendBooruPostsToChat execution error:", err);
    if (loadingMsgId) {
      await api.editMessageText(
        chatId,
        loadingMsgId,
        `❌ Failed to load images: ${escapeHtml(err.message)}`
      );
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

function parseSearchCommandArgs(args, defaultRating, defaultLimit, defaultSpoiler) {
  let rating = defaultRating;
  let limit = defaultLimit;
  let spoilerNsfw = defaultSpoiler;
  const queryParts = [];

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

const DEFAULT_BOT_COMMANDS = [
  { command: "today", description: "🌟 Top popular images of the day" },
  { command: "search", description: "🔍 Search tag (live autocomplete)" },
  { command: "random", description: "🎲 Random anime images" },
  { command: "settings", description: "⚙️ Configuration & quick panel" },
  { command: "myid", description: "🆔 Your Telegram Chat ID" },
  { command: "help", description: "📖 Help & command reference" },
];

async function handleTelegramMessage(message, env) {
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
  const { settings: config } = await fetchChatSettings(api, chat.id, env);

  switch (cmd) {
    case "/start": {
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
      await ensurePinnedSettings(api, chat.id, env);
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

async function handleTelegramCallbackQuery(callbackQuery, env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const api = new TelegramApi(token);
  const msg = callbackQuery.message;
  const from = callbackQuery.from;

  if (!msg || !isOwner(from, env)) {
    await api.answerCallbackQuery(callbackQuery.id, "Access Denied");
    return;
  }

  const { settings: config } = await fetchChatSettings(api, msg.chat.id, env);

  if (callbackQuery.data && callbackQuery.data.startsWith("cfg:")) {
    const rawAction = callbackQuery.data.slice(4);
    const currentSettings = parseSettingsText(msg.text || "", config);

    if (rawAction.startsWith("mode:")) {
      currentSettings.mode = rawAction.slice(5) === "random" ? "random" : "top";
    } else if (rawAction.startsWith("rating:")) {
      const r = rawAction.slice(7);
      currentSettings.rating = r === "sfw" ? "sfw" : r === "nsfw" ? "nsfw" : "all";
    } else if (rawAction.startsWith("limit:")) {
      const l = parseInt(rawAction.slice(6), 10);
      if (!isNaN(l)) currentSettings.limit = l;
    } else if (rawAction === "spoiler:toggle") {
      currentSettings.spoilerNsfw = !currentSettings.spoilerNsfw;
    }

    const { text: newText, replyMarkup: newMarkup } = buildSettingsMessage(currentSettings);
    await api.editMessageText(msg.chat.id, msg.message_id, newText, { reply_markup: newMarkup });
    await api.answerCallbackQuery(callbackQuery.id, "Saved");
    return;
  }

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

async function handleScheduledBroadcast(env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const api = new TelegramApi(token);
  const fallback = getConfig(env);
  const { settings: config } = await fetchChatSettings(
    api,
    fallback.ownerChatId || DEFAULT_CONFIG.OWNER_CHAT_ID,
    env
  );

  const targets = new Set();
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

async function handleTelegramInlineQuery(inlineQuery, env) {
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

    const results = suggestions.map((tag, idx) => {
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return new Response(
        JSON.stringify({
          status: "healthy",
          bot: "Scene Telegram Bot",
          source: "yande.re",
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
      const webhookRes = await api.setWebhook(webhookUrl, env.SECRET_TOKEN);
      const commandsRes = await api.setMyCommands(DEFAULT_BOT_COMMANDS);
      const menuRes = await api.setChatMenuButton({ type: "commands" });
      return new Response(
        JSON.stringify(
          {
            configured_url: webhookUrl,
            webhook: webhookRes,
            commands: commandsRes,
            menu_button: menuRes,
          },
          null,
          2
        ),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    if (request.method === "GET" && (url.pathname === "/setup-commands" || url.pathname === "/set-menu")) {
      if (!token) return new Response("Error: TELEGRAM_BOT_TOKEN is not set.", { status: 500 });
      const api = new TelegramApi(token);
      const commandsRes = await api.setMyCommands(DEFAULT_BOT_COMMANDS);
      const menuRes = await api.setChatMenuButton({ type: "commands" });
      return new Response(
        JSON.stringify({ commands: commandsRes, menu_button: menuRes }, null, 2),
        { headers: { "Content-Type": "application/json" } }
      );
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
        } else if (update.inline_query) {
          ctx.waitUntil(handleTelegramInlineQuery(update.inline_query, env));
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
};\n