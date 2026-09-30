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
  DEFAULT_SOURCE: "both",
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
  const rawSource = (env.DEFAULT_SOURCE || DEFAULT_CONFIG.DEFAULT_SOURCE).toLowerCase();
  const source = rawSource === "gelbooru" ? "gelbooru" : rawSource === "yandere" ? "yandere" : "both";

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
    source,
    rating,
    mode,
    limit,
    ownerChatId,
    subscribedChatIds: [ownerChatId],
    spoilerNsfw,
    gelbooruApiKey: env.GELBOORU_API_KEY ? env.GELBOORU_API_KEY.trim() : undefined,
    gelbooruUserId: env.GELBOORU_USER_ID ? env.GELBOORU_USER_ID.trim() : undefined,
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
  const modeText = config.mode === "random" ? "Random Images 🎲" : "Top Popular Today 🌟";
  const sourceText =
    config.source === "both"
      ? "Both (yande.re Top + Gelbooru Random) 🌐"
      : config.source === "gelbooru"
      ? "Gelbooru (Random) 🌀"
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

async function searchBooruTags(query, limit = 10, gelbooruAuth, source = "both") {
  const clean = query.trim().toLowerCase().replace(/\s+/g, "_");
  if (!clean) return [];

  const promises = [];

  // 1. yande.re tag search
  if (source === "both" || source === "yandere") {
    promises.push(
      (async () => {
        try {
          const url = `https://yande.re/tag.json?name=*${encodeURIComponent(clean)}*&order=count&limit=${limit * 2}`;
          const res = await fetch(url, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              Accept: "application/json",
            },
          });
          if (!res.ok) return { items: [], source: "yandere" };
          const data = await res.json();
          if (!Array.isArray(data)) return { items: [], source: "yandere" };
          return {
            items: data.map((t) => ({
              name: t.name,
              count: t.count || 0,
              type: t.type ?? 0,
            })),
            source: "yandere",
          };
        } catch (err) {
          console.warn("yande.re tag search error:", err);
          return { items: [], source: "yandere" };
        }
      })()
    );
  }

  // 2. Gelbooru tag search
  if ((source === "both" || source === "gelbooru") && gelbooruAuth?.apiKey && gelbooruAuth?.userId) {
    promises.push(
      (async () => {
        try {
          const url = `https://gelbooru.com/index.php?page=dapi&s=tag&q=index&json=1&name_pattern=%25${encodeURIComponent(
            clean
          )}%25&api_key=${gelbooruAuth.apiKey}&user_id=${gelbooruAuth.userId}&limit=${limit * 2}`;
          const res = await fetch(url, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              Accept: "application/json",
            },
          });
          if (!res.ok) return { items: [], source: "gelbooru" };
          const data = await res.json();
          const rawTags = Array.isArray(data) ? data : data?.tag || [];
          return {
            items: rawTags.map((t) => ({
              name: t.name,
              count: parseInt(t.count || "0", 10),
              type: parseInt(t.type || "0", 10),
            })),
            source: "gelbooru",
          };
        } catch (err) {
          console.warn("Gelbooru tag search error:", err);
          return { items: [], source: "gelbooru" };
        }
      })()
    );
  }

  const results = await Promise.all(promises);
  const tagMap = new Map();

  for (const group of results) {
    for (const item of group.items) {
      const existing = tagMap.get(item.name);
      if (existing) {
        if (group.source === "yandere") {
          existing.yandereCount = item.count;
        } else {
          existing.gelbooruCount = item.count;
        }
        existing.count = (existing.yandereCount || 0) + (existing.gelbooruCount || 0);
        existing.source = "both";
        if (existing.type === 0 && item.type !== 0) {
          existing.type = item.type;
        }
      } else {
        tagMap.set(item.name, {
          name: item.name,
          count: item.count,
          type: item.type,
          source: group.source,
          yandereCount: group.source === "yandere" ? item.count : undefined,
          gelbooruCount: group.source === "gelbooru" ? item.count : undefined,
        });
      }
    }
  }

  return Array.from(tagMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
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

const GELBOORU_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Referer": "https://gelbooru.com/",
};

async function fetchGelbooruPosts(ratingFilter, limit = 30, mode = "top", apiKey, userId, tagQuery) {
  const tags = [];

  if (tagQuery && tagQuery.trim()) {
    tags.push(tagQuery.trim().replace(/\s+/g, "_"));
  }

  if (ratingFilter === "sfw") tags.push("rating:general");
  else if (ratingFilter === "nsfw") tags.push("-rating:general");

  if (mode === "random" || !tagQuery) tags.push("sort:random");
  else tags.push("sort:score:desc");

  const queryParams = new URLSearchParams({
    page: "dapi",
    s: "post",
    q: "index",
    json: "1",
    limit: String(Math.min(100, Math.max(limit * 2, 20))),
  });

  if (tags.length > 0) queryParams.set("tags", tags.join(" "));
  if (apiKey && userId) {
    queryParams.set("api_key", apiKey);
    queryParams.set("user_id", userId);
  }

  const url = `https://gelbooru.com/index.php?${queryParams.toString()}`;

  try {
    const res = await fetch(url, { headers: GELBOORU_HEADERS });
    if (!res.ok) {
      if (res.status === 401) {
        console.warn("Gelbooru API returned 401 Unauthorized. Configure GELBOORU_API_KEY and GELBOORU_USER_ID.");
      } else {
        console.warn(`Gelbooru API returned HTTP ${res.status}`);
      }
      return [];
    }

    const data = await res.json();
    let rawPosts = [];
    if (Array.isArray(data)) rawPosts = data;
    else if (data && Array.isArray(data.post)) rawPosts = data.post;

    const validPosts = [];
    const seenIds = new Set();

    for (const post of rawPosts) {
      if (!post.id || seenIds.has(post.id)) continue;
      seenIds.add(post.id);

      if (post.status === "deleted") continue;

      const rating = (post.rating || "general").toLowerCase();
      const isNsfw = rating !== "general";

      if (ratingFilter === "sfw" && isNsfw) continue;
      if (ratingFilter === "nsfw" && !isNsfw) continue;

      const imageUrl = post.sample_url || post.file_url;
      if (!imageUrl) continue;

      const lowerImg = imageUrl.toLowerCase();
      if (lowerImg.endsWith(".mp4") || lowerImg.endsWith(".webm") || lowerImg.endsWith(".zip")) continue;

      const postTags = (post.tags || "").split(" ").filter(Boolean);

      validPosts.push({
        id: post.id,
        source: "gelbooru",
        imageUrl,
        postUrl: `https://gelbooru.com/index.php?page=post&s=view&id=${post.id}`,
        sourceUrl: post.source ? post.source.trim() : undefined,
        rating,
        isNsfw,
        tags: postTags,
        score: post.score || 0,
      });

      if (validPosts.length >= limit) break;
    }

    return validPosts;
  } catch (err) {
    console.error("fetchGelbooruPosts error:", err);
    return [];
  }
}

async function fetchBooruPosts(source, rating, limit = 30, mode = "top", gelbooruAuth, tagQuery) {
  if (source === "yandere") {
    const yanderePosts = await fetchYanderePosts(rating, limit, mode, tagQuery);
    return { yanderePosts, gelbooruPosts: [], posts: yanderePosts };
  }

  if (source === "gelbooru") {
    const gelbooruPosts = await fetchGelbooruPosts(
      rating,
      limit,
      mode,
      gelbooruAuth?.apiKey,
      gelbooruAuth?.userId,
      tagQuery
    );
    return { yanderePosts: [], gelbooruPosts, posts: gelbooruPosts };
  }

  // source === "both": Fetch limit per source concurrently
  const [yanderePosts, gelbooruPosts] = await Promise.all([
    fetchYanderePosts(rating, limit, mode, tagQuery),
    fetchGelbooruPosts(rating, limit, mode, gelbooruAuth?.apiKey, gelbooruAuth?.userId, tagQuery),
  ]);

  return { yanderePosts, gelbooruPosts, posts: [...yanderePosts, ...gelbooruPosts] };
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

  async answerInlineQuery(inlineQueryId, results, options = {}) {
    try {
      const res = await fetch(`${this.baseUrl}/answerInlineQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inline_query_id: inlineQueryId,
          results,
          cache_time: options.cache_time ?? 300,
          is_personal: options.is_personal ?? false,
        }),
      });
      return await res.json();
    } catch (err) {
      return { ok: false, description: err?.message || "Network error" };
    }
  }

  async setWebhook(url, secretToken) {
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

  async setMyCommands(commands) {
    try {
      const res = await fetch(`${this.baseUrl}/setMyCommands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commands }),
      });
      return await res.json();
    } catch (err) {
      return { ok: false, description: err?.message || "Network error" };
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

function formatPostCaption(post, index, formattedDate, mode = "top") {
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
  source = "both",
  gelbooruAuth,
  tagQuery
) {
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
    loadingRes && loadingRes.ok && loadingRes.result && loadingRes.result.message_id
      ? loadingRes.result.message_id
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
        const suggestions = await searchBooruTags(tagQuery, 6, gelbooruAuth, source);
        let noFoundText = `⚠️ No images found matching: <code>${escapeHtml(tagQuery)}</code>`;
        let replyMarkup = undefined;

        if (suggestions.length > 0) {
          noFoundText += `\n\n💡 <b>Did you mean one of these tags?</b>`;
          const buttons = suggestions.slice(0, 4).map((s) => [
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
        : `🎲 <b>${posts.length} Random images • Gelbooru • ${formattedDate}</b>`;
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

    const buildMediaGroup = (items) =>
      items.map((post, idx) => ({
        type: "photo",
        media: post.imageUrl,
        caption: formatPostCaption(post, idx, formattedDate, mode).slice(0, 1024),
        parse_mode: "HTML",
        has_spoiler: spoilerNsfw && post.isNsfw,
      }));

    const sendGroupBatches = async (items) => {
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

    if (totalSent === 0) {
      let textSummary = `${bannerText}\n\n`;
      posts.forEach((p, i) => {
        const srcName = p.source === "gelbooru" ? "Gelbooru" : "yande.re";
        textSummary += `${i + 1}. <a href="${p.postUrl}">${srcName} #${p.id}</a> - Score: ${p.score}\n`;
      });
      await api.sendMessage(chatId, textSummary, { disable_web_page_preview: false });
    }
  } catch (err) {
    console.error("sendBooruPostsToChat error:", err);
    const errText = `❌ Failed to load images: ${escapeHtml(err.message || "Unknown error")}`;
    if (loadingMsgId) {
      await api.editMessageText(chatId, loadingMsgId, errText);
    } else {
      await api.sendMessage(chatId, errText);
    }
  }
}

function parseCommandArgs(args, defaultRating, defaultLimit, defaultSpoiler = false, defaultSource) {
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
      if (!isNaN(num) && num > 0 && num <= 50) limit = num;
    }
  }

  return { rating, limit, spoilerNsfw, source };
}

function parseSearchCommandArgs(
  args,
  defaultRating,
  defaultLimit,
  defaultSpoiler,
  defaultSource
) {
  let rating = defaultRating;
  let limit = defaultLimit;
  let spoilerNsfw = defaultSpoiler;
  let source = defaultSource;
  const queryParts = [];

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

function parseTagCommandArgs(args, defaultSource) {
  let source = defaultSource;
  const queryParts = [];

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

const DEFAULT_BOT_COMMANDS = [
  { command: "today", description: "🌟 Top popular images of the day" },
  { command: "search", description: "🔍 Search tag (live autocomplete)" },
  { command: "random", description: "🎲 Random anime images" },
  { command: "both", description: "🌐 Fetch from yande.re + Gelbooru" },
  { command: "yan", description: "🌸 Fetch from yande.re" },
  { command: "gel", description: "🌀 Random from Gelbooru" },
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

  // Strict owner restriction
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
            `• <code>/tags raiden both</code> (searches both)\n\n` +
            `💡 <i>Tip: Tap the button below to type with instant live suggestions!</i>`,
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

      const buttons = [];

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
        "random",
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
            [
              { text: "🌸 yande.re", callback_data: "fetch_yan" },
              { text: "🌀 Gelbooru (Random)", callback_data: "fetch_gel" },
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
      if (text.startsWith("/")) {
        await api.sendMessage(
          chat.id,
          `ℹ️ Unknown command: <code>${escapeHtml(cmd)}</code>\nUse /today, /search, /tags, /both, /yan, /gel, /random, or /help.`
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

  const config = getConfig(env);
  const gelAuth = { apiKey: config.gelbooruApiKey, userId: config.gelbooruUserId };

  if (
    callbackQuery.data &&
    (callbackQuery.data.startsWith("st:") || callbackQuery.data.startsWith("search_tag:"))
  ) {
    let targetSource = config.source;
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
      await api.answerCallbackQuery(callbackQuery.id, `Fetching ${config.limit} random images from Gelbooru...`);
      await sendBooruPostsToChat(
        api,
        msg.chat.id,
        config.rating,
        config.limit,
        config.spoilerNsfw,
        "random",
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

async function handleScheduledBroadcast(env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const api = new TelegramApi(token);
  const config = getConfig(env);
  const gelAuth = { apiKey: config.gelbooruApiKey, userId: config.gelbooruUserId };

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
 * Telegram Real-Time Autocomplete Inline Query Handler
 */
async function handleTelegramInlineQuery(inlineQuery, env) {
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

    const results = suggestions.map((tag, idx) => {
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return new Response(
        JSON.stringify({
          status: "healthy",
          bot: "Scene Telegram Bot",
          source: env.DEFAULT_SOURCE || "both",
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
};
