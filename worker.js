/**
 * Booru Today Telegram Bot - Cloudflare Worker
 *
 * Dedicated strictly to @cheytac29 (Chat ID: 1368225736)
 * - Source: yande.re
 * - Rating: ALL (SFW + Questionable + Explicit)
 * - Default Count: 15 images
 * - Spoilers: OFF (Unblurred) by default
 * - Scheduled Cron: Daily 8:00 AM UTC+7 (01:00 UTC) + 5-minute test cron
 */

const DEFAULT_CONFIG = {
  OWNER_USERNAME: "cheytac29",
  OWNER_CHAT_ID: "1368225736",
  DEFAULT_SOURCE: "yandere",
  DEFAULT_RATING: "all",
  DEFAULT_LIMIT: 15,
  DEFAULT_SPOILER_NSFW: "false",
};

const YANDERE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Referer": "https://yande.re/",
};

let inMemorySettings = null;

function parseChatTarget(val) {
  if (!val) return undefined;
  if (typeof val === "number") return val;
  const trimmed = String(val).trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("@")) return trimmed;
  const num = parseInt(trimmed, 10);
  return isNaN(num) ? trimmed : num;
}

async function getSettings(env) {
  const rawRating = (env.DEFAULT_RATING || DEFAULT_CONFIG.DEFAULT_RATING).toLowerCase();
  const defaultRating = rawRating === "sfw" ? "sfw" : rawRating === "nsfw" ? "nsfw" : "all";
  const defaultLimit = env.DEFAULT_LIMIT ? parseInt(env.DEFAULT_LIMIT, 10) : DEFAULT_CONFIG.DEFAULT_LIMIT;
  const rawSpoiler = (env.DEFAULT_SPOILER_NSFW || DEFAULT_CONFIG.DEFAULT_SPOILER_NSFW).toLowerCase();
  const defaultSpoiler = rawSpoiler === "true" ? true : false;
  const ownerTarget = parseChatTarget(env.OWNER_CHAT_ID) || 1368225736;

  const defaults = {
    source: "yandere",
    rating: defaultRating,
    limit: isNaN(defaultLimit) || defaultLimit < 1 || defaultLimit > 50 ? 15 : defaultLimit,
    ownerChatId: ownerTarget,
    subscribedChatIds: ownerTarget ? [ownerTarget] : [1368225736],
    spoilerNsfw: defaultSpoiler,
  };

  return inMemorySettings ? { ...defaults, ...inMemorySettings } : defaults;
}

async function saveSettings(env, settings) {
  inMemorySettings = settings;
}

async function updateOwnerChatId(env, chatId) {
  const current = await getSettings(env);
  const subscribers = current.subscribedChatIds.some((id) => id.toString() === chatId.toString())
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

function isOwner(from, env) {
  if (!from) return false;
  const ownerUsername = (env.OWNER_USERNAME || DEFAULT_CONFIG.OWNER_USERNAME).replace(/^@/, "").toLowerCase();
  const ownerChatId = (env.OWNER_CHAT_ID || DEFAULT_CONFIG.OWNER_CHAT_ID).toString();

  if (from.username && from.username.toLowerCase() === ownerUsername) return true;
  if (from.id && from.id.toString() === ownerChatId) return true;
  return false;
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

function getSettingsKeyboard(rating, limit, spoilerNsfw = false) {
  return {
    inline_keyboard: [
      [{ text: `🔞 Rating: ${getRatingBadgeText(rating)}`, callback_data: "toggle_rating" }],
      [{ text: spoilerNsfw ? "🙈 Spoilers: ON (Blurred)" : "👁️ Spoilers: OFF (Unblurred)", callback_data: "toggle_spoiler" }],
      [{ text: `🔢 Everyday Count: ${limit} images`, callback_data: "cycle_limit" }],
      [{ text: `🚀 Fetch Top ${limit} Now`, callback_data: "fetch_top" }],
    ],
  };
}

function formatSettingsPanelText(settings) {
  const spoilerText = settings.spoilerNsfw ? "Enabled (Blurred) 🙈" : "Disabled (Unblurred) 👁️";
  const ownerChatText = settings.ownerChatId ? `<code>${settings.ownerChatId}</code>` : "<code>1368225736</code>";

  return (
    `⚙️ <b>Bot Settings Panel</b>\n\n` +
    `• <b>Source:</b> <code>yande.re</code>\n` +
    `• <b>Rating Filter:</b> <code>${getRatingBadgeText(settings.rating)}</code>\n` +
    `• <b>NSFW Spoilers:</b> <code>${spoilerText}</code>\n` +
    `• <b>Everyday Count:</b> <code>${settings.limit} images</code>\n` +
    `• <b>Target Chat ID:</b> ${ownerChatText}\n` +
    `• <b>Daily Schedule:</b> <code>8:00 AM UTC+7 (01:00 UTC)</code>\n\n` +
    `💡 <i>Tips: Run <code>/limit &lt;1-50&gt;</code> to set count, or <code>/test_cron</code> to test daily delivery now.</i>\n\n` +
    `Use the buttons below to customize:`
  );
}

async function fetchYanderePosts(ratingFilter, limit = 15) {
  let tags = "order:score";
  if (ratingFilter === "sfw") tags += " rating:s";
  else if (ratingFilter === "nsfw") tags += " -rating:s";

  const fetchLimit = Math.min(Math.max(limit * 2, 25), 100);
  const targetUrl = `https://yande.re/post.json?tags=${encodeURIComponent(tags)}&limit=${fetchLimit}`;

  const res = await fetch(targetUrl, { headers: YANDERE_HEADERS });
  if (!res.ok) throw new Error(`yande.re API returned HTTP ${res.status}`);

  const rawPosts = await res.json();
  const validPosts = [];

  for (const post of rawPosts) {
    const rawRating = (post.rating || "").toLowerCase();
    const isNsfw = rawRating === "e" || rawRating === "q";
    if (ratingFilter === "sfw" && isNsfw) continue;
    if (ratingFilter === "nsfw" && !isNsfw) continue;

    let imageUrl = post.sample_url || post.file_url || post.jpeg_url || post.preview_url;
    if (!imageUrl) continue;
    if (imageUrl.startsWith("//")) imageUrl = `https:${imageUrl}`;

    validPosts.push({
      id: post.id,
      source: "yandere",
      imageUrl,
      postUrl: `https://yande.re/post/show/${post.id}`,
      rating: isNsfw ? "nsfw" : "sfw",
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

async function sendBooruPostsToChat(api, chatId, rating, limit = 15, spoilerNsfw = false) {
  const ratingLabel = rating === "all" ? "SFW+NSFW" : rating.toUpperCase();

  await api.sendMessage(chatId, `⏳ <i>Fetching top ${limit} images from <b>yande.re</b> [${ratingLabel}]...</i>`);

  try {
    const posts = await fetchYanderePosts(rating, limit);
    if (posts.length === 0) {
      await api.sendMessage(chatId, `⚠️ No images found matching rating <b>${ratingLabel}</b> on yande.re today.`);
      return;
    }

    const todayDate = new Date().toISOString().split("T")[0];
    const displayCount = Math.min(posts.length, limit);

    const mediaGroup = posts.slice(0, displayCount).map((post, idx) => {
      const isFirst = idx === 0;
      let caption = "";
      if (isFirst) {
        caption = `🌟 <b>Top ${displayCount} Today • yande.re</b> [${ratingLabel}]\n📅 ${todayDate}\n\n`;
      }
      const ratingBadge = post.isNsfw ? "⚠️ NSFW" : "🛡️ SFW";
      const artistStr = post.artist ? ` • 🎨 ${escapeHtml(post.artist)}` : "";
      caption += `#${idx + 1} <b>Score:</b> ${post.score} (${ratingBadge})${artistStr}\n🔗 <a href="${post.postUrl}">View on yande.re</a>`;

      const shouldSpoiler = spoilerNsfw && post.isNsfw;

      return {
        type: "photo",
        media: post.imageUrl,
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
      let textSummary = `🌟 <b>Top ${displayCount} Today • yande.re</b> [${ratingLabel}]\n📅 ${todayDate}\n\n`;
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

function parseCommandArgs(args, defaultRating, defaultLimit, defaultSpoiler = false) {
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

async function handleTelegramMessage(message, env) {
  const token = env.TELEGRAM_BOT_TOKEN || globalThis.TELEGRAM_BOT_TOKEN;
  const api = new TelegramApi(token);
  const from = message.from;
  const chat = message.chat;
  const text = (message.text || "").trim();

  // Restrict access strictly to @cheytac29 / 1368225736
  if (!isOwner(from, env)) {
    await api.sendMessage(chat.id, "Access Denied: You don't have permission");
    return;
  }

  await updateOwnerChatId(env, chat.id);

  const [command, ...args] = text.split(/\s+/);
  const cmd = command.toLowerCase().replace(/@.+$/, "");

  switch (cmd) {
    case "/start": {
      await api.sendMessage(
        chat.id,
        `🌸 <b>Booru Today Bot</b>\n\n` +
          `Daily & on-demand top anime art from <b>yande.re</b>.\n\n` +
          `<b>Available Commands:</b>\n` +
          `• <code>/today [count] [sfw|nsfw|all]</code> - Fetch top images (default: 15, ALL rating)\n` +
          `• <code>/yan [count] [sfw|nsfw|all]</code> - Shortcut for yande.re\n` +
          `• <code>/settings</code> - Interactive configuration panel\n` +
          `• <code>/myid</code> - View your Telegram Chat ID\n` +
          `• <code>/test_cron</code> - Test daily scheduled broadcast immediately\n` +
          `• <code>/limit &lt;1-50&gt;</code> - Set everyday count (e.g. <code>/limit 15</code>)\n` +
          `• <code>/spoiler [on|off]</code> - Toggle NSFW spoiler blur\n` +
          `• <code>/unspoiler</code> - Unblur images by default\n` +
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
          `• <code>/today [count] [rating]</code> - Pull top images (e.g. <code>/today</code>, <code>/today 20</code>, <code>/today 15 nsfw</code>)\n` +
          `• <code>/yan [count] [rating]</code> - Shortcut for yande.re\n\n` +
          `<b>Configuration & Schedule:</b>\n` +
          `• <code>/settings</code> - Interactive control panel\n` +
          `• <code>/myid</code> - View your Telegram Chat ID\n` +
          `• <code>/test_cron</code> - Trigger daily broadcast test immediately\n` +
          `• <code>/limit &lt;1-50&gt;</code> - Set everyday count (e.g. <code>/limit 15</code>)\n` +
          `• <code>/spoiler [on|off]</code> - Enable or disable spoiler blur\n` +
          `• <code>/unspoiler</code> - Turn off spoiler blur by default\n` +
          `• <code>/sfw</code> - Set default rating to SFW (Safe only)\n` +
          `• <code>/nsfw</code> - Set default rating to NSFW (Questionable / Explicit)\n` +
          `• <code>/all</code> - Set default rating to Both (SFW + NSFW)\n` +
          `• <code>/subscribe</code> - Register chat for daily 8:00 AM delivery\n` +
          `• <code>/unsubscribe</code> - Cancel daily delivery`
      );
      break;
    }

    case "/today":
    case "/top":
    case "/top10":
    case "/top15":
    case "/yan":
    case "/yandere": {
      const settings = await getSettings(env);
      const parsed = parseCommandArgs(args, settings.rating, settings.limit, settings.spoilerNsfw);
      await sendBooruPostsToChat(
        api,
        chat.id,
        parsed.rating,
        parsed.limit,
        parsed.spoilerNsfw
      );
      break;
    }

    case "/settings":
    case "/panel": {
      const settings = await getSettings(env);
      await api.sendMessage(chat.id, formatSettingsPanelText(settings), {
        reply_markup: getSettingsKeyboard(
          settings.rating,
          settings.limit,
          settings.spoilerNsfw
        ),
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
          `✅ <b>Configured Owner:</b> <code>${env.OWNER_CHAT_ID || "1368225736"}</code>\n\n` +
          `💡 <i>You can run <code>/test_cron</code> to test the scheduled broadcast immediately!</i>`
      );
      break;
    }

    case "/test_cron":
    case "/runcron":
    case "/cron": {
      const settings = await getSettings(env);
      const ownerId = settings.ownerChatId || env.OWNER_CHAT_ID || 1368225736;
      const subscribers = settings.subscribedChatIds;

      await api.sendMessage(
        chat.id,
        `⏰ <b>Testing Daily Scheduled Cron:</b>\n\n` +
          `• <b>Your Chat ID:</b> <code>${chat.id}</code>\n` +
          `• <b>Configured Owner Chat ID:</b> <code>${ownerId}</code>\n` +
          `• <b>Subscribed Chat IDs:</b> <code>${subscribers.length > 0 ? subscribers.join(", ") : "None"}</code>\n` +
          `• <b>Source:</b> <code>yande.re</code>\n` +
          `• <b>Rating:</b> <code>${settings.rating}</code>\n` +
          `• <b>Limit:</b> <code>${settings.limit} images</code>\n` +
          `• <b>Daily Schedule:</b> <code>8:00 AM UTC+7 (01:00 UTC)</code>\n\n` +
          `<i>Executing broadcast now...</i>`
      );

      await updateOwnerChatId(env, chat.id);
      const resultMsg = await handleScheduledBroadcast(env);
      await api.sendMessage(chat.id, `🏁 <b>Cron test finished:</b> ${resultMsg}`);
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
        enabled = !settings.spoilerNsfw;
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
        `🔢 <b>Default everyday count set to:</b> <code>${num} images</code>\n<i>This will be used for daily deliveries and default /today commands.</i>`
      );
      break;
    }

    case "/subscribe": {
      await updateOwnerChatId(env, chat.id);
      await api.sendMessage(chat.id, "✅ This chat is registered for daily 8:00 AM UTC+7 deliveries.");
      break;
    }

    case "/unsubscribe": {
      const current = await getSettings(env);
      const filtered = current.subscribedChatIds.filter((id) => id.toString() !== chat.id.toString());
      await saveSettings(env, { ...current, subscribedChatIds: filtered });
      await api.sendMessage(chat.id, "🔕 This chat unsubscribed from daily deliveries.");
      break;
    }
  }
}

async function handleTelegramCallbackQuery(callbackQuery, env) {
  const token = env.TELEGRAM_BOT_TOKEN || globalThis.TELEGRAM_BOT_TOKEN;
  const api = new TelegramApi(token);
  const from = callbackQuery.from;

  // Restrict access strictly to @cheytac29 / 1368225736
  if (!isOwner(from, env)) {
    return api.answerCallbackQuery(callbackQuery.id, "Access Denied: You don't have permission", true);
  }

  const msg = callbackQuery.message;
  if (!msg) return api.answerCallbackQuery(callbackQuery.id);

  let settings = await getSettings(env);

  switch (callbackQuery.data) {
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
            settings.rating,
            settings.limit,
            settings.spoilerNsfw
          ),
        }
      );
      break;
    }

    case "toggle_spoiler": {
      const nextSpoiler = !settings.spoilerNsfw;
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
            settings.rating,
            settings.limit,
            settings.spoilerNsfw
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
            settings.rating,
            settings.limit,
            settings.spoilerNsfw
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
        settings.rating,
        settings.limit,
        settings.spoilerNsfw
      );
      break;
    }

    default:
      await api.answerCallbackQuery(callbackQuery.id);
  }
}

async function handleScheduledBroadcast(env) {
  const token = env.TELEGRAM_BOT_TOKEN || globalThis.TELEGRAM_BOT_TOKEN;
  const api = new TelegramApi(token);
  const settings = await getSettings(env);

  const targets = new Set();
  if (settings.ownerChatId) targets.add(settings.ownerChatId);
  settings.subscribedChatIds.forEach((id) => targets.add(id));

  // Fallback to configured owner ID 1368225736
  if (targets.size === 0) {
    targets.add(env.OWNER_CHAT_ID || 1368225736);
  }

  let sentCount = 0;
  for (const chatId of targets) {
    try {
      await sendBooruPostsToChat(
        api,
        chatId,
        settings.rating,
        settings.limit,
        settings.spoilerNsfw
      );
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
          bot: "Booru Today Telegram Bot",
          owner: env.OWNER_USERNAME || DEFAULT_CONFIG.OWNER_USERNAME,
          timestamp: new Date().toISOString(),
        }),
        { headers: { "Content-Type": "application/json" } }
      );
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

    // HTTP endpoint to manually trigger scheduled broadcast test: GET /test-scheduled
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
    const token = env.TELEGRAM_BOT_TOKEN || globalThis.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.error("TELEGRAM_BOT_TOKEN not configured in scheduled cron execution.");
      return;
    }
    try {
      console.log(`Cron trigger fired: ${event.cron}`);
      const res = await handleScheduledBroadcast(env);
      console.log(`Cron execution completed: ${res}`);
    } catch (err) {
      console.error("Cron execution failed:", err);
    }
  },
};
