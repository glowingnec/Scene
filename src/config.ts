import { Env, RatingFilter, DeliveryMode, BooruSource, BotSettings } from "./types";

export const DEFAULT_CONFIG = {
  OWNER_USERNAME: "cheytac29",
  OWNER_CHAT_ID: 1368225736,
  DEFAULT_SOURCE: "both" as BooruSource,
  DEFAULT_RATING: "all" as RatingFilter,
  DEFAULT_LIMIT: 30,
  DEFAULT_MODE: "top" as DeliveryMode,
  DEFAULT_SPOILER_NSFW: false,
};

export function parseChatTarget(val?: string | number): number | string | undefined {
  if (!val) return undefined;
  if (typeof val === "number") return val;
  const trimmed = String(val).trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("@")) return trimmed;
  const num = parseInt(trimmed, 10);
  return isNaN(num) ? trimmed : num;
}

/**
 * Loads configuration directly from Cloudflare environment variables.
 * Settings modified in Cloudflare Dashboard Variables take immediate, permanent effect.
 */
export function getConfig(env: Env): BotSettings {
  const rawSource = (env.DEFAULT_SOURCE || DEFAULT_CONFIG.DEFAULT_SOURCE).toLowerCase();
  const source: BooruSource =
    rawSource === "gelbooru" ? "gelbooru" : rawSource === "yandere" ? "yandere" : "both";

  const rawRating = (env.DEFAULT_RATING || DEFAULT_CONFIG.DEFAULT_RATING).toLowerCase();
  const rating: RatingFilter =
    rawRating === "sfw" ? "sfw" : rawRating === "nsfw" ? "nsfw" : "all";

  const rawLimit = env.DEFAULT_LIMIT
    ? parseInt(env.DEFAULT_LIMIT, 10)
    : DEFAULT_CONFIG.DEFAULT_LIMIT;
  const limit = isNaN(rawLimit) || rawLimit < 1 || rawLimit > 50 ? 30 : rawLimit;

  const rawMode = (env.DEFAULT_MODE || env.DELIVERY_MODE || DEFAULT_CONFIG.DEFAULT_MODE).toLowerCase();
  const mode: DeliveryMode = rawMode === "random" ? "random" : "top";

  const rawSpoiler = (env.DEFAULT_SPOILER_NSFW || "").toLowerCase();
  const spoilerNsfw = rawSpoiler === "true";

  const ownerChatId =
    parseChatTarget(env.OWNER_CHAT_ID || env.CHANNEL_ID) || DEFAULT_CONFIG.OWNER_CHAT_ID;

  return {
    source,
    rating,
    mode,
    limit,
    ownerChatId,
    subscribedChatIds: [ownerChatId],
    spoilerNsfw,
    gelbooruApiKey: env.GELBOORU_API_KEY?.trim() || undefined,
    gelbooruUserId: env.GELBOORU_USER_ID?.trim() || undefined,
  };
}
