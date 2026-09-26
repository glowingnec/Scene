/**
 * Booru Today Telegram Bot - Standalone Single-File Worker
 * Ready for Cloudflare Dashboard Web Editor (Zero Build Step Required)
 *
 * Supported:
 * - Danbooru & yande.re top 10 daily images
 * - SFW & NSFW toggles with native Telegram spoiler blur
 * - Owner recognition for @cheytac29
 * - Daily cron scheduled broadcast & on-demand requests
 * - Interactive inline keyboard settings panel
 */

// Default configuration constants (can also be overridden in Cloudflare Dashboard -> Settings -> Variables)
const DEFAULT_CONFIG = {
  OWNER_USERNAME: "cheytac29",
  DEFAULT_SOURCE: "danbooru", // "danbooru" or "yandere"
  DEFAULT_RATING: "sfw",      // "sfw" or "nsfw"
  RESTRICT_ALL_TO_OWNER: "false",
};

const USER_AGENT = "BooruTodayBot/1.0 (Cloudflare Workers; Telegram Bot by @cheytac29)";
const SETTINGS_KEY = "booru_bot_settings";

let inMemorySettings = null;

// ==========================================
// Storage Helpers (Cloudflare KV or In-Memory)
// ==========================================
async function getSettings(env) {
  const defaults = {
    source: (env.DEFAULT_SOURCE || DEFAULT_CONFIG.DEFAULT_SOURCE).toLowerCase() === "yandere" ? "yandere" : "danbooru",
    rating: (env.DEFAULT_RATING || DEFAULT_CONFIG.DEFAULT_RATING).toLowerCase() === "nsfw" ? "nsfw" : "sfw",
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

  const updated = {
    ...current,
    ownerChatId: chatId,
    subscribedChatIds: subscribers,
  };
  await saveSettings(env, updated);
  return updated;
}

// ==========================================
// Authorization & Formatting
// ==========================================
function isOwner(from, env) {
  if (!from || !from.username) return false;
  const owner = (env.OWNER_USERNAME || DEFAULT_CONFIG.OWNER_USERNAME)
    .replace(/^@/, "")
    .toLowerCase();
  return from.username.toLowerCase() === owner;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getSettingsKeyboard(source, rating) {
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

// ==========================================
// Booru API Clients (Danbooru & yande.re)
// ==========================================
async function fetchDanbooruTop10(ratingFilter) {
  const headers = { "User-Agent": USER_AGENT, "Accept": "application/json" };
  let rawPosts = [];

  // Primary: explore popular posts of the day
  try {
    const res = await fetch("https://danbooru.donmai.us/explore/posts/popular.json?scale=day", { headers });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) rawPosts = data;
    }
  } catch (err) {
    console.warn("Danbooru popular fetch error:", err);
  }

  // Fallback: search by rank or score
  if (rawPosts.length === 0) {
    try {
      const ratingTag = ratingFilter === "sfw" ? "rating:g,s" : "";
      const searchTags = ["order:rank", ratingTag].filter(Boolean).join(" ");
      const res = await fetch(`https://danbooru.donmai.us/posts.json?tags=${encodeURIComponent(searchTags)}&limit=30`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) rawPosts = data;
      }
    } catch (err) {
      console.error("Danbooru search fallback error:", err);
    }
  }

  const validPosts = [];
  for (const post of rawPosts) {
    if (post.is_banned || post.is_deleted) continue;

    const rating = (post.rating || "q").toLowerCase();
    const isNsfw = rating === "e" || rating === "q";

    if (ratingFilter === "sfw" && isNsfw) continue;

    let imageUrl = post.large_file_url || post.file_url;
    if (!imageUrl && post.media_asset && post.media_asset.variants) {
      const sampleVariant = post.media_asset.variants.find((v) => v.type === "sample" || v.type === "1080p");
      imageUrl = sampleVariant ? sampleVariant.url : post.media_asset.variants[0]?.url;
    }

    if (!imageUrl) continue;
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

    if (validPosts.length >= 10) break;
  }

  return validPosts;
}

async function fetchYandereTop10(ratingFilter) {
  const headers = { "User-Agent": USER_AGENT, "Accept": "application/json" };
  let rawPosts = [];

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();

  try {
    const res = await fetch(`https://yande.re/post/popular_by_day.json?year=${year}&month=${month}&day=${day}`, { headers });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) rawPosts = data;
    }
  } catch (err) {
    console.warn("yande.re popular_by_day error:", err);
  }

  // If start of day, also query yesterday
  if (rawPosts.length < 5) {
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const res = await fetch(`https://yande.re/post/popular_by_day.json?year=${yesterday.getUTCFullYear()}&month=${yesterday.getUTCMonth() + 1}&day=${yesterday.getUTCDate()}`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) rawPosts = [...rawPosts, ...data];
      }
    } catch (err) {
      console.warn("yande.re yesterday popular error:", err);
    }
  }

  // Fallback: search by score
  if (rawPosts.length === 0) {
    try {
      const ratingTag = ratingFilter === "sfw" ? "rating:s" : "";
      const searchTags = ["order:score", ratingTag].filter(Boolean).join(" ");
      const res = await fetch(`https://yande.re/post.json?tags=${encodeURIComponent(searchTags)}&limit=30`, { headers });
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

    // Use sample_url or jpeg_url to avoid Telegram 10MB photo URL limit
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

    if (validPosts.length >= 10) break;
  }

  return validPosts;
}

async function fetchTop10Posts(source, rating) {
  if (source === "danbooru") {
    return await fetchDanbooruTop10(rating);
  }
  return await fetchYandereTop10(rating);
}

// ==========================================
// Telegram Bot API Wrapper
// ==========================================
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

// ==========================================
// Command & Message Router
// ==========================================
async function sendTop10ToChat(api, chatId, source, rating) {
  const sourceName = source === "danbooru" ? "Danbooru" : "yande.re";
  await api.sendMessage(
    chatId,
    `⏳ <i>Fetching top 10 images from <b>${sourceName}</b> [${rating.toUpperCase()}]...</i>`
  );

  try {
    const posts = await fetchTop10Posts(source, rating);
    if (posts.length === 0) {
      await api.sendMessage(
        chatId,
        `⚠️ No images found matching rating <b>${rating.toUpperCase()}</b> on ${sourceName} today.`
      );
      return;
    }

    const todayDate = new Date().toISOString().split("T")[0];
    const mediaGroup = posts.slice(0, 10).map((post, idx) => {
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

    // Fallback if media group fails
    if (!sendResult.ok) {
      console.warn("sendMediaGroup failed, using individual sendPhoto fallback:", sendResult.description);
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

      if (successCount === 0) {
        let textSummary = `🌟 <b>Top 10 Today • ${sourceName}</b> [${rating.toUpperCase()}]\n📅 ${todayDate}\n\n`;
        posts.slice(0, 10).forEach((p, i) => {
          textSummary += `${i + 1}. <a href="${p.postUrl}">Post #${p.id}</a> - Score: ${p.score} [${p.rating.toUpperCase()}]\n`;
        });
        await api.sendMessage(chatId, textSummary, { disable_web_page_preview: false });
      }
    }
  } catch (err) {
    console.error("sendTop10ToChat error:", err);
    await api.sendMessage(chatId, `❌ Failed to load images: ${escapeHtml(err.message)}`);
  }
}

async function handleTelegramMessage(message, env) {
  const api = new TelegramApi(env.TELEGRAM_BOT_TOKEN);
  const from = message.from;
  const chat = message.chat;
  const text = (message.text || "").trim();
  const owner = isOwner(from, env);

  // If owner interacts, register chat ID for daily cron
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

  switch (cmd) {
    case "/start": {
      const ownerNotice = owner
        ? "👑 <b>Owner recognized!</b> Your chat has been registered for daily top 10 deliveries."
        : "👋 Welcome! (Bot Owner: @cheytac29)";

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
          `• <code>/help</code> - Show command reference`
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
          `• <code>/subscribe</code> - Register chat for daily cron broadcast\n` +
          `• <code>/unsubscribe</code> - Stop daily cron broadcast`
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
      const current = await getSettings(env);
      await saveSettings(env, { ...current, rating: "sfw" });
      await api.sendMessage(chat.id, "🛡️ <b>Rating set to SFW.</b> Safe and general posts will be delivered.");
      break;
    }

    case "/nsfw": {
      if (!owner) {
        await api.sendMessage(chat.id, "🔒 Only bot owner (@cheytac29) can toggle ratings.");
        return;
      }
      const current = await getSettings(env);
      await saveSettings(env, { ...current, rating: "nsfw" });
      await api.sendMessage(chat.id, "⚠️ <b>Rating set to NSFW.</b> Questionable and explicit posts included (with spoiler blur).");
      break;
    }

    case "/source": {
      if (!owner) {
        await api.sendMessage(chat.id, "🔒 Only bot owner (@cheytac29) can change source.");
        return;
      }
      const target = args[0]?.toLowerCase();
      if (target !== "danbooru" && target !== "yandere") {
        await api.sendMessage(chat.id, "ℹ️ Specify source: <code>/source danbooru</code> or <code>/source yandere</code>");
        return;
      }
      const current = await getSettings(env);
      await saveSettings(env, { ...current, source: target });
      await api.sendMessage(chat.id, `📁 <b>Default source updated to:</b> <code>${target}</code>`);
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
      const current = await getSettings(env);
      const filtered = current.subscribedChatIds.filter((id) => id !== chat.id);
      await saveSettings(env, { ...current, subscribedChatIds: filtered });
      await api.sendMessage(chat.id, "🔕 This chat unsubscribed from daily broadcasts.");
      break;
    }
  }
}

async function handleTelegramCallbackQuery(callbackQuery, env) {
  const api = new TelegramApi(env.TELEGRAM_BOT_TOKEN);
  const from = callbackQuery.from;
  const owner = isOwner(from, env);

  if (!owner) {
    await api.answerCallbackQuery(callbackQuery.id, "🔒 Action restricted to bot owner (@cheytac29)", true);
    return;
  }

  const msg = callbackQuery.message;
  if (!msg) {
    await api.answerCallbackQuery(callbackQuery.id);
    return;
  }

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
          `• <b>Rating Filter:</b> <code>${settings.rating.toUpperCase()}</code>\n` +
          `• <b>Daily Cron Broadcast:</b> <code>Active</code>\n\n` +
          `Use the buttons below to toggle configuration:`,
        { reply_markup: getSettingsKeyboard(settings.source, settings.rating) }
      );
      break;
    }

    case "toggle_rating": {
      const nextRating = settings.rating === "sfw" ? "nsfw" : "sfw";
      settings = { ...settings, rating: nextRating };
      await saveSettings(env, settings);
      await api.answerCallbackQuery(callbackQuery.id, `Rating switched to ${nextRating.toUpperCase()}`);
      await api.editMessageText(
        msg.chat.id,
        msg.message_id,
        `⚙️ <b>Bot Settings Panel</b>\n\n` +
          `• <b>Default Source:</b> <code>${settings.source}</code>\n` +
          `• <b>Rating Filter:</b> <code>${settings.rating.toUpperCase()}</code>\n` +
          `• <b>Daily Cron Broadcast:</b> <code>Active</code>\n\n` +
          `Use the buttons below to toggle configuration:`,
        { reply_markup: getSettingsKeyboard(settings.source, settings.rating) }
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

async function handleScheduledBroadcast(env) {
  const api = new TelegramApi(env.TELEGRAM_BOT_TOKEN);
  const settings = await getSettings(env);

  const targets = new Set();
  if (settings.ownerChatId) targets.add(settings.ownerChatId);
  settings.subscribedChatIds.forEach((id) => targets.add(id));

  if (targets.size === 0) {
    console.warn("No subscribed chats found for daily broadcast.");
    return;
  }

  for (const chatId of targets) {
    try {
      await sendTop10ToChat(api, chatId, settings.source, settings.rating);
    } catch (err) {
      console.error(`Daily broadcast failed for chat ${chatId}:`, err);
    }
  }
}

// ==========================================
// Cloudflare Workers Entry Point
// ==========================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Healthcheck
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

    // Helper: setup webhook by visiting GET /setup-webhook
    if (request.method === "GET" && url.pathname === "/setup-webhook") {
      if (!env.TELEGRAM_BOT_TOKEN) {
        return new Response("Error: TELEGRAM_BOT_TOKEN variable/secret is not set in Worker settings.", { status: 500 });
      }
      const webhookUrl = `${url.origin}/webhook`;
      const api = new TelegramApi(env.TELEGRAM_BOT_TOKEN);
      const res = await api.setWebhook(webhookUrl, env.SECRET_TOKEN);

      return new Response(
        JSON.stringify({ configured_url: webhookUrl, telegram_response: res }, null, 2),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Telegram Webhook Handler
    if (request.method === "POST" && (url.pathname === "/webhook" || url.pathname === "/")) {
      if (env.SECRET_TOKEN) {
        const headerSecret = request.headers.get("x-telegram-bot-api-secret-token");
        if (headerSecret !== env.SECRET_TOKEN) {
          return new Response("Unauthorized", { status: 401 });
        }
      }

      try {
        const update = await request.json();
        if (update.message) {
          ctx.waitUntil(handleTelegramMessage(update.message, env));
        } else if (update.callback_query) {
          ctx.waitUntil(handleTelegramCallbackQuery(update.callback_query, env));
        }

        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
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
    if (!env.TELEGRAM_BOT_TOKEN) {
      console.error("TELEGRAM_BOT_TOKEN not configured in scheduled cron execution.");
      return;
    }
    ctx.waitUntil(handleScheduledBroadcast(env));
  },
};
