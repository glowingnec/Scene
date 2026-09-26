import { BotSettings, BooruSource, RatingFilter, Env } from "../types";

const SETTINGS_KEY = "booru_bot_settings";

export function getDefaultSettings(env: Env): BotSettings {
  const defaultSource: BooruSource =
    env.DEFAULT_SOURCE?.toLowerCase() === "yandere" ? "yandere" : "danbooru";
  const rawRating = env.DEFAULT_RATING?.toLowerCase();
  const defaultRating: RatingFilter =
    rawRating === "all" ? "all" : rawRating === "nsfw" ? "nsfw" : "sfw";
  const defaultLimit = env.DEFAULT_LIMIT ? parseInt(env.DEFAULT_LIMIT, 10) : 10;
  const ownerChatId = env.OWNER_CHAT_ID ? parseInt(env.OWNER_CHAT_ID, 10) : undefined;

  return {
    source: defaultSource,
    rating: defaultRating,
    limit: isNaN(defaultLimit) || defaultLimit <= 0 || defaultLimit > 10 ? 10 : defaultLimit,
    ownerChatId: isNaN(ownerChatId as number) ? undefined : ownerChatId,
    subscribedChatIds: ownerChatId && !isNaN(ownerChatId) ? [ownerChatId] : [],
    spoilerNsfw: true,
  };
}

let inMemorySettings: BotSettings | null = null;

export async function getSettings(env: Env): Promise<BotSettings> {
  const defaults = getDefaultSettings(env);

  if (env.BOORU_KV) {
    try {
      const stored = await env.BOORU_KV.get<BotSettings>(SETTINGS_KEY, "json");
      if (stored) {
        return {
          ...defaults,
          ...stored,
          limit: stored.limit || defaults.limit || 10,
          subscribedChatIds: stored.subscribedChatIds || defaults.subscribedChatIds || [],
        };
      }
    } catch (err) {
      console.error("Failed to read settings from KV:", err);
    }
  }

  return inMemorySettings ? { ...defaults, ...inMemorySettings } : defaults;
}

export async function saveSettings(env: Env, settings: BotSettings): Promise<void> {
  inMemorySettings = settings;

  if (env.BOORU_KV) {
    try {
      await env.BOORU_KV.put(SETTINGS_KEY, JSON.stringify(settings));
    } catch (err) {
      console.error("Failed to persist settings to KV:", err);
    }
  }
}

export async function updateOwnerChatId(env: Env, chatId: number): Promise<BotSettings> {
  const current = await getSettings(env);
  const updatedSubscribers = current.subscribedChatIds.includes(chatId)
    ? current.subscribedChatIds
    : [...current.subscribedChatIds, chatId];

  const updated: BotSettings = {
    ...current,
    ownerChatId: chatId,
    subscribedChatIds: updatedSubscribers,
  };

  await saveSettings(env, updated);
  return updated;
}

export async function setRating(env: Env, rating: RatingFilter): Promise<BotSettings> {
  const current = await getSettings(env);
  const updated: BotSettings = { ...current, rating };
  await saveSettings(env, updated);
  return updated;
}

export async function setSource(env: Env, source: BooruSource): Promise<BotSettings> {
  const current = await getSettings(env);
  const updated: BotSettings = { ...current, source };
  await saveSettings(env, updated);
  return updated;
}

export async function setLimit(env: Env, limit: number): Promise<BotSettings> {
  const current = await getSettings(env);
  const clamped = Math.max(1, Math.min(10, limit));
  const updated: BotSettings = { ...current, limit: clamped };
  await saveSettings(env, updated);
  return updated;
}
