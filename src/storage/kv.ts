import { BotSettings, RatingFilter, Env } from "../types";

function parseChatTarget(val?: string | number): string | number | undefined {
  if (!val) return undefined;
  if (typeof val === "number") return val;
  const trimmed = val.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("@")) return trimmed;
  const num = parseInt(trimmed, 10);
  return isNaN(num) ? trimmed : num;
}

export function getDefaultSettings(env: Env): BotSettings {
  const rawRating = (env.DEFAULT_RATING || "all").toLowerCase();
  const defaultRating: RatingFilter =
    rawRating === "sfw" ? "sfw" : rawRating === "nsfw" ? "nsfw" : "all";
  const defaultLimit = env.DEFAULT_LIMIT ? parseInt(env.DEFAULT_LIMIT, 10) : 30;
  const ownerTarget = parseChatTarget(env.OWNER_CHAT_ID || env.CHANNEL_ID) || 1368225736;
  const rawSpoiler = env.DEFAULT_SPOILER_NSFW?.toLowerCase();
  const defaultSpoiler = rawSpoiler === "true" ? true : false;

  return {
    source: "yandere",
    rating: defaultRating,
    limit: isNaN(defaultLimit) || defaultLimit <= 0 || defaultLimit > 50 ? 30 : defaultLimit,
    ownerChatId: ownerTarget,
    subscribedChatIds: ownerTarget ? [ownerTarget] : [1368225736],
    spoilerNsfw: defaultSpoiler,
  };
}

let inMemorySettings: BotSettings | null = null;

export async function getSettings(env: Env): Promise<BotSettings> {
  const defaults = getDefaultSettings(env);
  return inMemorySettings ? { ...defaults, ...inMemorySettings } : defaults;
}

export async function saveSettings(env: Env, settings: BotSettings): Promise<void> {
  inMemorySettings = settings;
}

export async function updateOwnerChatId(
  env: Env,
  chatId: number | string
): Promise<BotSettings> {
  const current = await getSettings(env);
  const updatedSubscribers = current.subscribedChatIds.some((id) => id.toString() === chatId.toString())
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

export async function setLimit(env: Env, limit: number): Promise<BotSettings> {
  const current = await getSettings(env);
  const updated: BotSettings = { ...current, limit };
  await saveSettings(env, updated);
  return updated;
}

export async function setSpoiler(env: Env, enabled: boolean): Promise<BotSettings> {
  const current = await getSettings(env);
  const updated: BotSettings = { ...current, spoilerNsfw: enabled };
  await saveSettings(env, updated);
  return updated;
}
