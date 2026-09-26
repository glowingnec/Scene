import { BooruPost, RatingFilter } from "../types";

const USER_AGENT = "BooruTodayBot/1.0 (Cloudflare Workers; Telegram Bot by @cheytac29)";

interface YandereRawPost {
  id: number;
  tags?: string;
  created_at?: number;
  author?: string;
  score?: number;
  rating?: string; // 's' (safe), 'q' (questionable), 'e' (explicit)
  file_url?: string;
  sample_url?: string;
  jpeg_url?: string;
  file_ext?: string;
  is_banned?: boolean;
  status?: string;
}

export async function fetchYandereTop10(ratingFilter: RatingFilter): Promise<BooruPost[]> {
  const headers = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json",
  };

  let rawPosts: YandereRawPost[] = [];

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();

  // Primary: popular by current day
  try {
    const popularUrl = `https://yande.re/post/popular_by_day.json?year=${year}&month=${month}&day=${day}`;
    const res = await fetch(popularUrl, { headers });
    if (res.ok) {
      const data = (await res.json()) as YandereRawPost[];
      if (Array.isArray(data) && data.length > 0) {
        rawPosts = data;
      }
    }
  } catch (err) {
    console.warn("yande.re popular_by_day request failed, trying fallback:", err);
  }

  // If empty (e.g. at start of day) or failed, try previous day
  if (rawPosts.length < 5) {
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const yUrl = `https://yande.re/post/popular_by_day.json?year=${yesterday.getUTCFullYear()}&month=${
        yesterday.getUTCMonth() + 1
      }&day=${yesterday.getUTCDate()}`;
      const res = await fetch(yUrl, { headers });
      if (res.ok) {
        const data = (await res.json()) as YandereRawPost[];
        if (Array.isArray(data) && data.length > 0) {
          rawPosts = [...rawPosts, ...data];
        }
      }
    } catch (err) {
      console.warn("yande.re yesterday popular request failed:", err);
    }
  }

  // Fallback: search by score
  if (rawPosts.length === 0) {
    try {
      const ratingTag = ratingFilter === "sfw" ? "rating:s" : "";
      const searchTags = ["order:score", ratingTag].filter(Boolean).join(" ");
      const searchUrl = `https://yande.re/post.json?tags=${encodeURIComponent(
        searchTags
      )}&limit=30`;
      const res = await fetch(searchUrl, { headers });
      if (res.ok) {
        const data = (await res.json()) as YandereRawPost[];
        if (Array.isArray(data)) {
          rawPosts = data;
        }
      }
    } catch (err) {
      console.error("yande.re search fallback failed:", err);
    }
  }

  const validPosts: BooruPost[] = [];
  const seenIds = new Set<number>();

  for (const post of rawPosts) {
    if (seenIds.has(post.id)) continue;
    seenIds.add(post.id);

    if (post.status === "deleted" || post.is_banned) continue;

    const rating = (post.rating || "q").toLowerCase();
    const isExplicitOrQuestionable = rating === "e" || rating === "q";

    if (ratingFilter === "sfw" && isExplicitOrQuestionable) {
      continue;
    }

    // Prefer sample_url or jpeg_url because raw original can exceed Telegram's 10MB photo URL limit
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
      isNsfw: isExplicitOrQuestionable,
      tags: (post.tags || "").split(" ").slice(0, 15),
      artist: post.author,
      score: post.score || 0,
    });

    if (validPosts.length >= 10) break;
  }

  return validPosts;
}
