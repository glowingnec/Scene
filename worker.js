/**
 * Booru Today Telegram Bot - Standalone Single-File Worker
 *
 * Supported:
 * - yande.re & Gelbooru top anime art
 * - Rating toggles: SFW, NSFW, and BOTH (SFW+NSFW)
 * - Configurable image count: 1-10 (e.g. /limit 5 or /yan 5)
 * - Shortened commands: /yan (yande.re) and /gel (Gelbooru)
 * - Owner recognition for @cheytac29
 * - Daily cron scheduled broadcast at 8:00 AM UTC+7 (01:00 UTC)
 */

const DEFAULT_CONFIG = {
  OWNER_USERNAME: "cheytac29",
  DEFAULT_SOURCE: "yandere",
  DEFAULT_RATING: "sfw",
  DEFAULT_LIMIT: 10,
  DEFAULT_SPOILER_NSFW: "true",
  RESTRICT_ALL_TO_OWNER: "false",
};

const YANDERE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Referer": "https://yande.re/",
};

const GELBOORU_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
};

const SETTINGS_KEY = "booru_bot_settings";
let inMemorySettings = null;

async function getSettings(env) {
  const rawRating = (env.DEFAULT_RATING || DEFAULT_CONFIG.DEFAULT_RATING).toLowerCase();
  const defaultRating = rawRating === "all" ? "all" : rawRating === "nsfw" ? "nsfw" : "sfw";
  const defaultLimit = env.DEFAULT_LIMIT ? parseInt(env.DEFAULT_LIMIT, 10) : DEFAULT_CONFIG.DEFAULT_LIMIT;
  const rawSpoiler = (env.DEFAULT_SPOILER_NSFW || DEFAULT_CONFIG.DEFAULT_SPOILER_NSFW).toLowerCase();
  const defaultSpoiler = rawSpoiler === "false" ? false : true;

  const defaults = {
    source: (env.DEFAULT_SOURCE || DEFAULT_CONFIG.DEFAULT_SOURCE).toLowerCase() === "gelbooru" ? "gelbooru" : "yandere",
    rating: defaultRating,
    limit: isNaN(defaultLimit) || defaultLimit < 1 || defaultLimit > 50 ? 10 : defaultLimit,
    ownerChatId: env.OWNER_CHAT_ID ? parseInt(env.OWNER_CHAT_ID, 10) : undefined,
    subscribedChatIds: env.OWNER_CHAT_ID ? [parseInt(env.OWNER_CHAT_ID, 10)] : [],
    spoilerNsfw: defaultSpoiler,
  };

  if (env.BOORU_KV) {
    try {
      const stored = await env.BOORU_KV.get(SETTINGS_KEY, "json");
      if (stored) {
        return {
          ...defaults,
          ...stored,
          limit: stored.limit || defaults.limit || 10,
          subscribedChatIds: stored.subscribedChatIds || defaults.subscribedChatIds || [],
          spoilerNsfw: stored.spoilerNsfw !== undefined ? stored.spoilerNsfw : defaults.spoilerNsfw,
        };
      }
    } catch (err) {
      console.error("KV read error:", err);
    }
  }

  return inMemorySettings ? { ...defaults, ...inMemorySettings } : defaults;
}

async function saveSettings(env, settings) {
  inMemorySettings = settings;
  if (env.BOORU_KV) {
    try {
      await env.BOORU_KV.put(SETTINGS_KEY, JSON.stringify(settings));
    } catch (err) {
      console.error("KV write error:", err);
    }
  }
}

async function updateOwnerChatId(env, chatId) {
  const current = await getSettings(env);
  const subscribers = current.subscribedChatIds.includes(chatId)
    ? current.subscribedChatIds
    : [...current.subscribedChatIds, chatId];

  const updated = { ...current, ownerChatId: chatId, subscribedChatIds: subscribers };
  await saveSettings(env, updated);
  return updated;
}

function isOwner(from, env) {
  if (!from || !from.username) return false;
  const owner = (env.OWNER_USERNAME || DEFAULT_CONFIG.OWNER_USERNAME).replace(/^@/, "").toLowerCase();
  return from.username.toLowerCase() === owner;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function getRatingBadgeText(rating) {
  if (rating === "sfw") return "SFW Mode 🛡️";
  if (rating === "nsfw") return "NSFW Mode ⚠️";
  return "Both SFW+NSFW 🌈";
}

function getSourceName(source) {
  return source === "gelbooru" ? "Gelbooru" : "yande.re";
}

function getSettingsKeyboard(source, rating, limit, spoilerNsfw = true) {
  return {
    inline_keyboard: [
      [{ text: `📁 Source: ${getSourceName(source)} 🟢`, callback_data: "toggle_source" }],
      [{ text: `🔞 Rating: ${getRatingBadgeText(rating)}`, callback_data: "toggle_rating" }],
      [{ text: spoilerNsfw ? "🙈 Spoilers: ON (Blurred)" : "👁️ Spoilers: OFF (Unblurred)", callback_data: "toggle_spoiler" }],
      [{ text: `🔢 Default Count: ${limit} images`, callback_data: "cycle_limit" }],
      [{ text: `🚀 Fetch Top ${limit} Now`, callback_data: "fetch_top" }],
    ],
  };
}

function formatSettingsPanelText(settings) {
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

async function fetchYanderePosts(ratingFilter, limit = 10) {
  let rawPosts = [];
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();

  try {
    const res = await fetch(`https://yande.re/post/popular_by_day.json?year=${year}&month=${month}&day=${day}`, { headers: YANDERE_HEADERS });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) rawPosts = data;
    }
  } catch (err) {
    console.warn("yande.re popular_by_day error:", err);
  }

  if (rawPosts.length < limit) {
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const res = await fetch(`https://yande.re/post/popular_by_day.json?year=${yesterday.getUTCFullYear()}&month=${yesterday.getUTCMonth() + 1}&day=${yesterday.getUTCDate()}`, { headers: YANDERE_HEADERS });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) rawPosts = [...rawPosts, ...data];
      }
    } catch (err) {
      console.warn("yande.re yesterday error:", err);
    }
  }

  if (rawPosts.length === 0) {
    try {
      let ratingTag = "";
      if (ratingFilter === "sfw") ratingTag = "rating:s";
      else if (ratingFilter === "nsfw") ratingTag = "rating:q,e";

      const searchTags = ["order:score", ratingTag].filter(Boolean).join(" ");
      const res = await fetch(`https://yande.re/post.json?tags=${encodeURIComponent(searchTags)}&limit=${Math.min(100, Math.max(limit * 2, 30))}`, { headers: YANDERE_HEADERS });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) rawPosts = data;
      }
    } catch (err) {
      console.error("yande.re search fallback error:", err);
    }
  }

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

    validPosts.push({
      id: post.id,
      source: "yandere",
      imageUrl,
      postUrl: `https://yande.re/post/show/${post.id}`,
      rating,
      isNsfw,
      tags: (post.tags || "").split(" ").slice(0, 15),
      artist: post.author,
      score: post.score || 0,
    });

    if (validPosts.length >= limit) break;
  }

  return validPosts;
}

async function fetchGelbooruPosts(ratingFilter, limit = 10, auth) {
  let tagQuery = "sort:score:desc -video -webm -animated";
  if (ratingFilter === "sfw") tagQuery += " rating:general";
  else if (ratingFilter === "nsfw") tagQuery += " rating:explicit";

  const queryParams = new URLSearchParams({
    page: "dapi",
    s: "post",
    q: "index",
    json: "1",
    tags: tagQuery,
    limit: String(Math.min(100, Math.max(limit * 2, 30))),
  });

  if (auth && auth.userId && auth.apiKey) {
    queryParams.set("user_id", auth.userId);
    queryParams.set("api_key", auth.apiKey);
  }

  const url = `https://gelbooru.com/index.php?${queryParams.toString()}`;
  const res = await fetch(url, { headers: GELBOORU_HEADERS });
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("Gelbooru requires API access credentials. Please set GELBOORU_USER_ID and GELBOORU_API_KEY in Cloudflare.");
    }
    throw new Error(`Gelbooru HTTP ${res.status}`);
  }

  const data = await res.json();
  let rawPosts = [];
  if (Array.isArray(data)) rawPosts = data;
  else if (data && Array.isArray(data.post)) rawPosts = data.post;

  const validPosts = [];
  for (const post of rawPosts) {
    const rating = (post.rating || "q").toLowerCase();
    const isNsfw = rating === "explicit" || rating === "questionable" || rating === "e" || rating === "q";

    if (ratingFilter === "sfw" && isNsfw) continue;
    if (ratingFilter === "nsfw" && !isNsfw) continue;

    // Filter out non-image files (videos, animations, archives)
    const rawFile = (post.image || post.file_url || "").toLowerCase();
    const ext = rawFile.split(".").pop()?.split("?")[0] || "";
    if (
      ext === "mp4" ||
      ext === "webm" ||
      ext === "zip" ||
      ext === "gif" ||
      ext === "swf" ||
      ext === "avi" ||
      ext === "mkv"
    ) {
      continue;
    }

    let imageUrl = post.sample_url || post.file_url || post.preview_url;
    if (!imageUrl) continue;
    if (imageUrl.startsWith("//")) imageUrl = `https:${imageUrl}`;

    validPosts.push({
      id: post.id,
      source: "gelbooru",
      imageUrl,
      postUrl: `https://gelbooru.com/index.php?page=post&s=view&id=${post.id}`,
      rating,
      isNsfw,
      tags: (post.tags || "").split(" ").slice(0, 15),
      artist: post.owner,
      score: post.score || 0,
    });

    if (validPosts.length >= limit) break;
  }
  return validPosts;
}

class TelegramApi {
  constructor(token) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async sendMessage(chatId, text, options = {}) {
    const res = await fetch(`${this.baseUrl}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: options.parse_mode || "HTML",
        reply_markup: options.reply_markup,
        disable_web_page_preview: options.disable_web_page_preview || false,
      }),
    });
    return await res.json();
  }

  async sendMediaGroup(chatId, media) {
    const res = await fetch(`${this.baseUrl}/sendMediaGroup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, media }),
    });
    return await res.json();
  }

  async sendPhoto(chatId, photo, options = {}) {
    const res = await fetch(`${this.baseUrl}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        photo,
        caption: options.caption,
        parse_mode: options.parse_mode || "HTML",
        has_spoiler: options.has_spoiler,
      }),
    });
    return await res.json();
  }

  async editMessageText(chatId, messageId, text, options = {}) {
    const res = await fetch(`${this.baseUrl}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: options.parse_mode || "HTML",
        reply_markup: options.reply_markup,
      }),
    });
    return await res.json();
  }

  async answerCallbackQuery(callbackQueryId, text, showAlert = false) {
    const res = await fetch(`${this.baseUrl}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: showAlert }),
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
}

async function sendBooruPostsToChat(
  api,
  chatId,
  source,
  rating,
  limit = 10,
  workerOrigin,
  gelbooruAuth,
  spoilerNsfw = true
) {
  const sourceName = getSourceName(source);
  const ratingLabel = rating === "all" ? "SFW+NSFW" : rating.toUpperCase();

  await api.sendMessage(chatId, `⏳ <i>Fetching top ${limit} images from <b>${sourceName}</b> [${ratingLabel}]...</i>`);

  try {
    const posts = source === "gelbooru" ? await fetchGelbooruPosts(rating, limit, gelbooruAuth) : await fetchYanderePosts(rating, limit);
    if (posts.length === 0) {
      await api.sendMessage(chatId, `⚠️ No images found matching rating <b>${ratingLabel}</b> on ${sourceName} today.`);
      return;
    }

    const todayDate = new Date().toISOString().split("T")[0];
    const displayCount = Math.min(posts.length, limit);

    const mediaGroup = posts.slice(0, displayCount).map((post, idx) => {
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
  } catch (err) {
    console.error("sendBooruPostsToChat error:", err);
    await api.sendMessage(chatId, `❌ Failed to load images: ${escapeHtml(err.message)}`);
  }
}

function parseCommandArgs(args, defaultRating, defaultLimit, defaultSpoiler = true) {
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

async function handleTelegramMessage(message, env, workerOrigin) {
  const token = env.TELEGRAM_BOT_TOKEN || globalThis.TELEGRAM_BOT_TOKEN;
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
          `• <code>/all</code> - Both SFW and NSFW\n` +
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
      } catch (err) {
        await api.sendMessage(chat.id, `❌ <b>Fetch Error:</b> <code>${escapeHtml(err.message)}</code>`);
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
      let enabled;
      if (arg === "on" || arg === "enable" || arg === "1" || arg === "true") {
        enabled = true;
      } else if (arg === "off" || arg === "disable" || arg === "0" || arg === "false") {
        enabled = false;
      } else {
        const settings = await getSettings(env);
        enabled = settings.spoilerNsfw === false ? true : false;
      }
      const current = await getSettings(env);
      const updated = { ...current, spoilerNsfw: enabled };
      await saveSettings(env, updated);
      if (enabled) {
        await api.sendMessage(chat.id, "🙈 <b>NSFW Spoilers enabled.</b> NSFW images will have Telegram spoiler blur applied.");
      } else {
        await api.sendMessage(chat.id, "👁️ <b>NSFW Spoilers disabled.</b> Images will be un-spoilered (unblurred) by default.");
      }
      break;
    }

    case "/unspoiler":
    case "/nospoiler": {
      const current = await getSettings(env);
      await saveSettings(env, { ...current, spoilerNsfw: false });
      await api.sendMessage(chat.id, "👁️ <b>NSFW Spoilers disabled.</b> Images will be un-spoilered (unblurred) by default.");
      break;
    }

    case "/sfw": {
      const current = await getSettings(env);
      await saveSettings(env, { ...current, rating: "sfw" });
      await api.sendMessage(chat.id, "🛡️ <b>Rating set to SFW.</b> Safe & general posts will be delivered.");
      break;
    }

    case "/nsfw": {
      const current = await getSettings(env);
      await saveSettings(env, { ...current, rating: "nsfw" });
      await api.sendMessage(chat.id, "⚠️ <b>Rating set to NSFW.</b> Questionable & explicit posts will be delivered.");
      break;
    }

    case "/all":
    case "/both": {
      const current = await getSettings(env);
      await saveSettings(env, { ...current, rating: "all" });
      await api.sendMessage(chat.id, "🌈 <b>Rating set to BOTH (SFW + NSFW).</b> All top posts will be delivered.");
      break;
    }

    case "/limit":
    case "/count": {
      const num = parseInt(args[0], 10);
      if (isNaN(num) || num < 1 || num > 50) {
        return api.sendMessage(chat.id, "ℹ️ Please specify a number between 1 and 50. Example: <code>/limit 15</code>");
      }
      const current = await getSettings(env);
      await saveSettings(env, { ...current, limit: num });
      await api.sendMessage(
        chat.id,
        `🔢 <b>Default everyday count set to:</b> <code>${num} images</code>\n<i>This will be used for daily deliveries and default /today, /yan, and /gel commands.</i>`
      );
      break;
    }

    case "/source": {
      const target = args[0]?.toLowerCase();
      let source = null;
      if (target === "gelbooru" || target === "gel" || target === "gbr") source = "gelbooru";
      else if (target === "yandere" || target === "yan") source = "yandere";

      if (!source) {
        return api.sendMessage(chat.id, "ℹ️ Specify source: <code>/source yandere</code> or <code>/source gelbooru</code>");
      }
      const current = await getSettings(env);
      await saveSettings(env, { ...current, source });
      await api.sendMessage(chat.id, `📁 <b>Default source updated to:</b> <code>${getSourceName(source)}</code>`);
      break;
    }

    case "/subscribe": {
      await updateOwnerChatId(env, chat.id);
      await api.sendMessage(chat.id, "✅ This chat is registered for daily 8:00 AM UTC+7 deliveries.");
      break;
    }

    case "/unsubscribe": {
      const current = await getSettings(env);
      const filtered = current.subscribedChatIds.filter((id) => id !== chat.id);
      await saveSettings(env, { ...current, subscribedChatIds: filtered });
      await api.sendMessage(chat.id, "🔕 This chat unsubscribed from daily deliveries.");
      break;
    }
  }
}

async function handleTelegramCallbackQuery(callbackQuery, env, workerOrigin) {
  const token = env.TELEGRAM_BOT_TOKEN || globalThis.TELEGRAM_BOT_TOKEN;
  const api = new TelegramApi(token);
  const from = callbackQuery.from;
  const owner = isOwner(from, env);

  if (!owner) {
    return api.answerCallbackQuery(callbackQuery.id, "Access Denied: You don't have permission", true);
  }

  const msg = callbackQuery.message;
  if (!msg) return api.answerCallbackQuery(callbackQuery.id);

  let settings = await getSettings(env);

  const gelbooruAuth =
    env.GELBOORU_USER_ID && env.GELBOORU_API_KEY
      ? { userId: env.GELBOORU_USER_ID, apiKey: env.GELBOORU_API_KEY }
      : undefined;

  switch (callbackQuery.data) {
    case "toggle_source": {
      const nextSource = settings.source === "yandere" ? "gelbooru" : "yandere";
      settings = { ...settings, source: nextSource };
      await saveSettings(env, settings);
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
      const nextRating = settings.rating === "sfw" ? "nsfw" : settings.rating === "nsfw" ? "all" : "sfw";
      settings = { ...settings, rating: nextRating };
      await saveSettings(env, settings);
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
      settings = { ...settings, spoilerNsfw: nextSpoiler };
      await saveSettings(env, settings);
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
      settings = { ...settings, limit: nextLimit };
      await saveSettings(env, settings);
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

async function handleScheduledBroadcast(env, workerOrigin) {
  const token = env.TELEGRAM_BOT_TOKEN || globalThis.TELEGRAM_BOT_TOKEN;
  const api = new TelegramApi(token);
  const settings = await getSettings(env);

  const gelbooruAuth =
    env.GELBOORU_USER_ID && env.GELBOORU_API_KEY
      ? { userId: env.GELBOORU_USER_ID, apiKey: env.GELBOORU_API_KEY }
      : undefined;

  const targets = new Set();
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return new Response(
        JSON.stringify({
          status: "healthy",
          bot: "Booru Today Telegram Bot",
          owner: env.OWNER_USERNAME || DEFAULT_CONFIG.OWNER_USERNAME,
          timestamp: new Date().toISOString(),
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    if (request.method === "GET" && url.pathname === "/proxy") {
      const targetUrl = url.searchParams.get("url");
      if (!targetUrl) return new Response("Missing url parameter", { status: 400 });

      try {
        const parsed = new URL(targetUrl);
        const host = parsed.hostname.toLowerCase();
        if (!host.endsWith("yande.re") && !host.endsWith("gelbooru.com")) {
          return new Response("Forbidden host", { status: 403 });
        }

        const referer = host.includes("gelbooru.com") ? "https://gelbooru.com/" : "https://yande.re/";
        const imgRes = await fetch(targetUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": referer,
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          },
        });

        if (!imgRes.ok) {
          return new Response(`Upstream fetch failed: ${imgRes.status}`, { status: imgRes.status });
        }

        const contentType = imgRes.headers.get("content-type") || "image/jpeg";
        return new Response(imgRes.body, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=86400, s-maxage=86400",
          },
        });
      } catch (err) {
        return new Response(`Proxy error: ${err.message}`, { status: 500 });
      }
    }

    const token = env.TELEGRAM_BOT_TOKEN || globalThis.TELEGRAM_BOT_TOKEN;

    if (request.method === "GET" && url.pathname === "/setup-webhook") {
      if (!token) return new Response("Error: TELEGRAM_BOT_TOKEN secret is not set.", { status: 500 });
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
        const workerOrigin = url.origin;
        if (update.message) {
          ctx.waitUntil(handleTelegramMessage(update.message, env, workerOrigin));
        } else if (update.callback_query) {
          ctx.waitUntil(handleTelegramCallbackQuery(update.callback_query, env, workerOrigin));
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

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    const token = env.TELEGRAM_BOT_TOKEN || globalThis.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.error("TELEGRAM_BOT_TOKEN not configured in scheduled cron execution.");
      return;
    }
    ctx.waitUntil(handleScheduledBroadcast(env));
  },
};
