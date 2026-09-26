/**
 * Booru Today Telegram Bot - Standalone Single-File Worker
 *
 * Supported:
 * - Danbooru & yande.re top images
 * - Rating toggles: SFW, NSFW, and BOTH (SFW+NSFW)
 * - Configurable image count: 1-10 (e.g. /limit 5 or /dbr 5)
 * - Shortened commands: /dbr and /yan
 * - Built-in image proxy to bypass Danbooru hotlink blocks
 * - Owner recognition for @cheytac29
 * - Daily cron scheduled broadcast at 8:00 AM UTC+7 (01:00 UTC)
 */

const DEFAULT_CONFIG = {
  OWNER_USERNAME: "cheytac29",
  DEFAULT_SOURCE: "danbooru",
  DEFAULT_RATING: "sfw",
  DEFAULT_LIMIT: 10,
  RESTRICT_ALL_TO_OWNER: "false",
};

const DANBOORU_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Referer": "https://danbooru.donmai.us/",
};

const YANDERE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Referer": "https://yande.re/",
};

const SETTINGS_KEY = "booru_bot_settings";
let inMemorySettings = null;

async function getSettings(env) {
  const rawRating = (env.DEFAULT_RATING || DEFAULT_CONFIG.DEFAULT_RATING).toLowerCase();
  const defaultRating = rawRating === "all" ? "all" : rawRating === "nsfw" ? "nsfw" : "sfw";
  const defaultLimit = env.DEFAULT_LIMIT ? parseInt(env.DEFAULT_LIMIT, 10) : DEFAULT_CONFIG.DEFAULT_LIMIT;

  const defaults = {
    source: (env.DEFAULT_SOURCE || DEFAULT_CONFIG.DEFAULT_SOURCE).toLowerCase() === "yandere" ? "yandere" : "danbooru",
    rating: defaultRating,
    limit: isNaN(defaultLimit) || defaultLimit < 1 || defaultLimit > 10 ? 10 : defaultLimit,
    ownerChatId: env.OWNER_CHAT_ID ? parseInt(env.OWNER_CHAT_ID, 10) : undefined,
    subscribedChatIds: env.OWNER_CHAT_ID ? [parseInt(env.OWNER_CHAT_ID, 10)] : [],
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

function getSettingsKeyboard(source, rating, limit) {
  return {
    inline_keyboard: [
      [{ text: `📁 Source: ${source === "danbooru" ? "Danbooru 🟢" : "yande.re 🟢"}`, callback_data: "toggle_source" }],
      [{ text: `🔞 Rating: ${getRatingBadgeText(rating)}`, callback_data: "toggle_rating" }],
      [{ text: `🔢 Display Count: ${limit} images`, callback_data: "cycle_limit" }],
      [{ text: `🚀 Fetch Top ${limit} Now`, callback_data: "fetch_top" }],
    ],
  };
}

async function fetchDanbooruPosts(ratingFilter, limit = 10, auth) {
  let rawPosts = [];
  const headers = { ...DANBOORU_HEADERS };

  if (auth && auth.login && auth.apiKey) {
    headers["Authorization"] = "Basic " + btoa(`${auth.login}:${auth.apiKey}`);
  }

  let tagQuery = "order:rank";
  if (ratingFilter === "sfw") tagQuery += " rating:g,s";
  else if (ratingFilter === "nsfw") tagQuery += " rating:q,e";

  const queryParams = new URLSearchParams({
    tags: tagQuery,
    limit: String(Math.max(limit * 3, 30)),
  });

  if (auth && auth.login && auth.apiKey) {
    queryParams.set("login", auth.login);
    queryParams.set("api_key", auth.apiKey);
  }

  let blockedByCloudflare = false;

  try {
    const url = `https://danbooru.donmai.us/posts.json?${queryParams.toString()}`;
    const res = await fetch(url, { headers });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) rawPosts = data;
    } else {
      const text = await res.text();
      if (res.status === 403 || text.includes("Just a moment...")) {
        blockedByCloudflare = true;
      }
    }
  } catch (err) {
    console.warn("Danbooru rank query error:", err);
  }

  if (rawPosts.length === 0 && !blockedByCloudflare) {
    try {
      const popularUrl = "https://danbooru.donmai.us/explore/posts/popular.json?scale=day" + (auth && auth.login ? `&login=${auth.login}&api_key=${auth.apiKey}` : "");
      const res = await fetch(popularUrl, { headers });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) rawPosts = data;
      } else {
        const text = await res.text();
        if (res.status === 403 || text.includes("Just a moment...")) {
          blockedByCloudflare = true;
        }
      }
    } catch (err) {
      console.warn("Danbooru popular fallback error:", err);
    }
  }

  if (blockedByCloudflare && rawPosts.length === 0) {
    throw new Error(
      "Danbooru requires your free API key to pass Cloudflare. Please set DANBOORU_LOGIN & DANBOORU_API_KEY in Cloudflare Settings."
    );
  }

  if (rawPosts.length === 0) {
    try {
      const res = await fetch("https://danbooru.donmai.us/posts.json?tags=order:score&limit=40", { headers: DANBOORU_HEADERS });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) rawPosts = data;
      }
    } catch (err) {
      console.error("Danbooru score fallback error:", err);
    }
  }

  const validPosts = [];
  for (const post of rawPosts) {
    if (post.is_banned || post.is_deleted) continue;
    const rating = (post.rating || "q").toLowerCase();
    const isNsfw = rating === "e" || rating === "q";

    if (ratingFilter === "sfw" && isNsfw) continue;
    if (ratingFilter === "nsfw" && !isNsfw) continue;

    let imageUrl = post.large_file_url || post.file_url;
    if (!imageUrl && post.media_asset && post.media_asset.variants) {
      const preferred = post.media_asset.variants.find((v) => v.type === "sample" || v.type === "720p" || v.type === "1080p");
      imageUrl = preferred ? preferred.url : post.media_asset.variants[0]?.url;
    }

    if (!imageUrl) continue;
    if (imageUrl.startsWith("/")) imageUrl = `https://danbooru.donmai.us${imageUrl}`;

    const ext = (post.file_ext || "").toLowerCase();
    if (ext === "mp4" || ext === "webm" || ext === "zip") continue;

    validPosts.push({
      id: post.id,
      source: "danbooru",
      imageUrl,
      postUrl: `https://danbooru.donmai.us/posts/${post.id}`,
      rating,
      isNsfw,
      tags: (post.tag_string || "").split(" ").slice(0, 15),
      artist: post.tag_string_artist?.replace(/ /g, ", "),
      score: post.score || post.fav_count || 0,
    });

    if (validPosts.length >= limit) break;
  }

  return validPosts;
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
      const res = await fetch(`https://yande.re/post.json?tags=${encodeURIComponent(searchTags)}&limit=${Math.max(limit * 3, 30)}`, { headers: YANDERE_HEADERS });
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

async function sendBooruPostsToChat(api, chatId, source, rating, limit = 10, workerOrigin, danbooruAuth) {
  const sourceName = source === "danbooru" ? "Danbooru" : "yande.re";
  const ratingLabel = rating === "all" ? "SFW+NSFW" : rating.toUpperCase();

  await api.sendMessage(chatId, `⏳ <i>Fetching top ${limit} images from <b>${sourceName}</b> [${ratingLabel}]...</i>`);

  try {
    const posts = source === "danbooru" ? await fetchDanbooruPosts(rating, limit, danbooruAuth) : await fetchYanderePosts(rating, limit);
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
      if (workerOrigin && post.imageUrl.includes("donmai.us")) {
        resolvedImageUrl = `${workerOrigin}/proxy?url=${encodeURIComponent(post.imageUrl)}`;
      }

      return {
        type: "photo",
        media: resolvedImageUrl,
        caption: caption.slice(0, 1024),
        parse_mode: "HTML",
        has_spoiler: post.isNsfw,
      };
    });

    const sendResult = await api.sendMediaGroup(chatId, mediaGroup);

    if (!sendResult.ok) {
      console.warn("sendMediaGroup failed, using individual sendPhoto fallback:", sendResult.description);
      let successCount = 0;
      for (let i = 0; i < posts.length; i++) {
        const post = posts[i];
        const caption = `#${i + 1} <b>${sourceName}</b> • Score: ${post.score} [${post.rating.toUpperCase()}]\n🔗 <a href="${post.postUrl}">Post Link</a>`;
        let photoUrl = post.imageUrl;
        if (workerOrigin && post.imageUrl.includes("donmai.us")) {
          photoUrl = `${workerOrigin}/proxy?url=${encodeURIComponent(post.imageUrl)}`;
        }
        const photoRes = await api.sendPhoto(chatId, photoUrl, {
          caption,
          has_spoiler: post.isNsfw,
          parse_mode: "HTML",
        });
        if (photoRes.ok) successCount++;
      }

      if (successCount === 0) {
        let textSummary = `🌟 <b>Top ${displayCount} Today • ${sourceName}</b> [${ratingLabel}]\n📅 ${todayDate}\n\n`;
        posts.slice(0, displayCount).forEach((p, i) => {
          textSummary += `${i + 1}. <a href="${p.postUrl}">Post #${p.id}</a> - Score: ${p.score} [${p.rating.toUpperCase()}]\n`;
        });
        await api.sendMessage(chatId, textSummary, { disable_web_page_preview: false });
      }
    }
  } catch (err) {
    console.error("sendBooruPostsToChat error:", err);
    await api.sendMessage(chatId, `❌ Failed to load images: ${escapeHtml(err.message)}`);
  }
}

function parseCommandArgs(args, defaultRating, defaultLimit) {
  let rating = defaultRating;
  let limit = defaultLimit;

  for (const arg of args) {
    const lower = arg.toLowerCase();
    if (lower === "nsfw") rating = "nsfw";
    else if (lower === "sfw") rating = "sfw";
    else if (lower === "all" || lower === "both") rating = "all";
    else {
      const num = parseInt(lower, 10);
      if (!isNaN(num) && num > 0 && num <= 10) {
        limit = num;
      }
    }
  }
  return { rating, limit };
}

async function handleTelegramMessage(message, env, workerOrigin) {
  const token = env.TELEGRAM_BOT_TOKEN || globalThis.TELEGRAM_BOT_TOKEN;
  const api = new TelegramApi(token);
  const from = message.from;
  const chat = message.chat;
  const text = (message.text || "").trim();
  const owner = isOwner(from, env);

  if (owner) {
    await updateOwnerChatId(env, chat.id);
  }

  const restrictAll = (env.RESTRICT_ALL_TO_OWNER || DEFAULT_CONFIG.RESTRICT_ALL_TO_OWNER) === "true";
  if (restrictAll && !owner) {
    await api.sendMessage(chat.id, "⛔ <b>Access Denied:</b> This bot is exclusively configured for its owner (@cheytac29).");
    return;
  }

  const [command, ...args] = text.split(/\s+/);
  const cmd = command.toLowerCase().replace(/@.+$/, "");

  const danbooruAuth =
    env.DANBOORU_LOGIN && env.DANBOORU_API_KEY
      ? { login: env.DANBOORU_LOGIN, apiKey: env.DANBOORU_API_KEY }
      : undefined;

  switch (cmd) {
    case "/start": {
      const ownerNotice = owner
        ? "👑 <b>Owner recognized!</b> Your chat is registered for daily 8:00 AM deliveries."
        : "👋 Welcome! (Bot Owner: @cheytac29)";

      await api.sendMessage(
        chat.id,
        `🌸 <b>Booru Today Bot</b>\n\n` +
          `Daily & on-demand top anime art from Danbooru & yande.re.\n\n` +
          `${ownerNotice}\n\n` +
          `<b>Available Commands:</b>\n` +
          `• <code>/today [count] [sfw|nsfw|all]</code> - Fetch today's top images\n` +
          `• <code>/dbr [count] [sfw|nsfw|all]</code> - Danbooru top images\n` +
          `• <code>/yan [count] [sfw|nsfw|all]</code> - yande.re top images\n` +
          `• <code>/settings</code> - Interactive configuration panel (Owner only)\n` +
          `• <code>/sfw</code> - Safe content only (Owner only)\n` +
          `• <code>/nsfw</code> - Questionable & explicit content (Owner only)\n` +
          `• <code>/all</code> - Both SFW and NSFW content (Owner only)\n` +
          `• <code>/limit &lt;1-10&gt;</code> - Set default image count (Owner only)\n` +
          `• <code>/source danbooru|yandere</code> - Set default source (Owner only)\n` +
          `• <code>/help</code> - Show command reference`
      );
      break;
    }

    case "/help": {
      await api.sendMessage(
        chat.id,
        `📖 <b>Help & Command Reference</b>\n\n` +
          `<b>Quick Fetch Commands:</b>\n` +
          `• <code>/dbr</code> or <code>/danbooru</code> - Danbooru top images\n` +
          `  <i>Examples: <code>/dbr</code>, <code>/dbr 5</code>, <code>/dbr 5 nsfw</code>, <code>/dbr all</code></i>\n` +
          `• <code>/yan</code> or <code>/yandere</code> - yande.re top images\n` +
          `  <i>Examples: <code>/yan</code>, <code>/yan 5</code>, <code>/yan 5 all</code></i>\n` +
          `• <code>/today</code> or <code>/top10</code> - Fetch with current settings\n\n` +
          `<b>Owner Commands (@cheytac29):</b>\n` +
          `• <code>/settings</code> - Interactive settings panel\n` +
          `• <code>/sfw</code> - Safe only\n` +
          `• <code>/nsfw</code> - Questionable / Explicit only\n` +
          `• <code>/all</code> - Both SFW and NSFW\n` +
          `• <code>/limit &lt;1-10&gt;</code> - Set default count (e.g. <code>/limit 5</code>)\n` +
          `• <code>/source &lt;danbooru|yandere&gt;</code> - Set default source\n` +
          `• <code>/subscribe</code> - Register for daily 8:00 AM UTC+7 delivery\n` +
          `• <code>/unsubscribe</code> - Cancel daily delivery`
      );
      break;
    }

    case "/today":
    case "/top10": {
      const settings = await getSettings(env);
      const parsed = parseCommandArgs(args, settings.rating, settings.limit);
      await sendBooruPostsToChat(api, chat.id, settings.source, parsed.rating, parsed.limit, workerOrigin, danbooruAuth);
      break;
    }

    case "/dbr":
    case "/danbooru": {
      const settings = await getSettings(env);
      const parsed = parseCommandArgs(args, settings.rating, settings.limit);
      await sendBooruPostsToChat(api, chat.id, "danbooru", parsed.rating, parsed.limit, workerOrigin, danbooruAuth);
      break;
    }

    case "/yan":
    case "/yandere": {
      const settings = await getSettings(env);
      const parsed = parseCommandArgs(args, settings.rating, settings.limit);
      await sendBooruPostsToChat(api, chat.id, "yandere", parsed.rating, parsed.limit, workerOrigin, danbooruAuth);
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
          `• <b>Rating Filter:</b> <code>${getRatingBadgeText(settings.rating)}</code>\n` +
          `• <b>Default Count:</b> <code>${settings.limit} images</code>\n` +
          `• <b>Daily Schedule:</b> <code>8:00 AM UTC+7 (01:00 UTC)</code>\n\n` +
          `Use the buttons below to customize:`,
        { reply_markup: getSettingsKeyboard(settings.source, settings.rating, settings.limit) }
      );
      break;
    }

    case "/sfw": {
      if (!owner) return api.sendMessage(chat.id, "🔒 Only bot owner (@cheytac29) can toggle ratings.");
      const current = await getSettings(env);
      await saveSettings(env, { ...current, rating: "sfw" });
      await api.sendMessage(chat.id, "🛡️ <b>Rating set to SFW.</b> Safe & general posts will be delivered.");
      break;
    }

    case "/nsfw": {
      if (!owner) return api.sendMessage(chat.id, "🔒 Only bot owner (@cheytac29) can toggle ratings.");
      const current = await getSettings(env);
      await saveSettings(env, { ...current, rating: "nsfw" });
      await api.sendMessage(chat.id, "⚠️ <b>Rating set to NSFW.</b> Questionable & explicit posts will be delivered.");
      break;
    }

    case "/all":
    case "/both": {
      if (!owner) return api.sendMessage(chat.id, "🔒 Only bot owner (@cheytac29) can toggle ratings.");
      const current = await getSettings(env);
      await saveSettings(env, { ...current, rating: "all" });
      await api.sendMessage(chat.id, "🌈 <b>Rating set to BOTH (SFW + NSFW).</b> All top posts will be delivered.");
      break;
    }

    case "/limit":
    case "/count": {
      if (!owner) return api.sendMessage(chat.id, "🔒 Only bot owner (@cheytac29) can set image limit.");
      const num = parseInt(args[0], 10);
      if (isNaN(num) || num < 1 || num > 10) {
        return api.sendMessage(chat.id, "ℹ️ Please specify a number between 1 and 10. Example: <code>/limit 5</code>");
      }
      const current = await getSettings(env);
      await saveSettings(env, { ...current, limit: num });
      await api.sendMessage(chat.id, `🔢 <b>Default display count set to:</b> <code>${num} images</code>`);
      break;
    }

    case "/source": {
      if (!owner) return api.sendMessage(chat.id, "🔒 Only bot owner (@cheytac29) can change source.");
      const target = args[0]?.toLowerCase();
      if (target !== "danbooru" && target !== "yandere" && target !== "dbr" && target !== "yan") {
        return api.sendMessage(chat.id, "ℹ️ Specify source: <code>/source danbooru</code> or <code>/source yandere</code>");
      }
      const source = target === "danbooru" || target === "dbr" ? "danbooru" : "yandere";
      const current = await getSettings(env);
      await saveSettings(env, { ...current, source });
      await api.sendMessage(chat.id, `📁 <b>Default source updated to:</b> <code>${source}</code>`);
      break;
    }

    case "/subscribe": {
      if (!owner) return api.sendMessage(chat.id, "🔒 Only bot owner can manage subscriptions.");
      await updateOwnerChatId(env, chat.id);
      await api.sendMessage(chat.id, "✅ This chat is registered for daily 8:00 AM UTC+7 deliveries.");
      break;
    }

    case "/unsubscribe": {
      if (!owner) return api.sendMessage(chat.id, "🔒 Only bot owner can manage subscriptions.");
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
    return api.answerCallbackQuery(callbackQuery.id, "🔒 Action restricted to bot owner (@cheytac29)", true);
  }

  const msg = callbackQuery.message;
  if (!msg) return api.answerCallbackQuery(callbackQuery.id);

  let settings = await getSettings(env);

  switch (callbackQuery.data) {
    case "toggle_source": {
      const nextSource = settings.source === "danbooru" ? "yandere" : "danbooru";
      settings = { ...settings, source: nextSource };
      await saveSettings(env, settings);
      await api.answerCallbackQuery(callbackQuery.id, `Source switched to ${nextSource}`);
      await api.editMessageText(
        msg.chat.id,
        msg.message_id,
        `⚙️ <b>Bot Settings Panel</b>\n\n` +
          `• <b>Default Source:</b> <code>${settings.source}</code>\n` +
          `• <b>Rating Filter:</b> <code>${getRatingBadgeText(settings.rating)}</code>\n` +
          `• <b>Default Count:</b> <code>${settings.limit} images</code>\n` +
          `• <b>Daily Schedule:</b> <code>8:00 AM UTC+7 (01:00 UTC)</code>\n\n` +
          `Use the buttons below to customize:`,
        { reply_markup: getSettingsKeyboard(settings.source, settings.rating, settings.limit) }
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
        `⚙️ <b>Bot Settings Panel</b>\n\n` +
          `• <b>Default Source:</b> <code>${settings.source}</code>\n` +
          `• <b>Rating Filter:</b> <code>${getRatingBadgeText(settings.rating)}</code>\n` +
          `• <b>Default Count:</b> <code>${settings.limit} images</code>\n` +
          `• <b>Daily Schedule:</b> <code>8:00 AM UTC+7 (01:00 UTC)</code>\n\n` +
          `Use the buttons below to customize:`,
        { reply_markup: getSettingsKeyboard(settings.source, settings.rating, settings.limit) }
      );
      break;
    }

    case "cycle_limit": {
      const nextLimit = settings.limit <= 3 ? 5 : settings.limit <= 5 ? 10 : 3;
      settings = { ...settings, limit: nextLimit };
      await saveSettings(env, settings);
      await api.answerCallbackQuery(callbackQuery.id, `Count set to ${nextLimit} images`);
      await api.editMessageText(
        msg.chat.id,
        msg.message_id,
        `⚙️ <b>Bot Settings Panel</b>\n\n` +
          `• <b>Default Source:</b> <code>${settings.source}</code>\n` +
          `• <b>Rating Filter:</b> <code>${getRatingBadgeText(settings.rating)}</code>\n` +
          `• <b>Default Count:</b> <code>${settings.limit} images</code>\n` +
          `• <b>Daily Schedule:</b> <code>8:00 AM UTC+7 (01:00 UTC)</code>\n\n` +
          `Use the buttons below to customize:`,
        { reply_markup: getSettingsKeyboard(settings.source, settings.rating, settings.limit) }
      );
      break;
    }

    case "fetch_top": {
      await api.answerCallbackQuery(callbackQuery.id, `Fetching top ${settings.limit}...`);
      await sendBooruPostsToChat(api, msg.chat.id, settings.source, settings.rating, settings.limit, workerOrigin);
      break;
    }

    default:
      await api.answerCallbackQuery(callbackQuery.id);
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
        if (!host.endsWith("donmai.us") && !host.endsWith("yande.re")) {
          return new Response("Forbidden host", { status: 403 });
        }

        const isDanbooru = host.includes("donmai.us");
        const referer = isDanbooru ? "https://danbooru.donmai.us/" : "https://yande.re/";

        const imgRes = await fetch(targetUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
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
