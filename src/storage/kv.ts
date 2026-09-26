import { BotSettings, BooruSource, RatingFilter, Env } from "../types";

const SETTINGS_KEY = "booru_bot_settings";

export function getDefaultSettings(env: Env): BotSettings {
  const defaultSource: BooruSource =
    env.DEFAULT_SOURCE?.toLowerCase() === "yandere" ? "yandere" : "danbooru";
  const defaultRating: RatingFilter =
    env.DEFAULT_RATING?.toLowerCase() === "nsfw" ? "nsfw" : "sfw";
  const ownerChatId = env.OWNER_CHAT_ID ? parseInt(env.OWNER_CHAT_ID, 10) : undefined;

  return {
    source: defaultSource,
    rating: defaultRating,
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
