import { BooruPost, RatingFilter } from "../types";

const YANDERE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Referer": "https://yande.re/",
};

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

export async function fetchYanderePosts(
  ratingFilter: RatingFilter,
  limit: number = 10
): Promise<BooruPost[]> {
  let rawPosts: YandereRawPost[] = [];

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();

  // Primary: popular by current day
  try {
    const popularUrl = `https://yande.re/post/popular_by_day.json?year=${year}&month=${month}&day=${day}`;
    const res = await fetch(popularUrl, { headers: YANDERE_HEADERS });
    if (res.ok) {
      const data = (await res.json()) as YandereRawPost[];
      if (Array.isArray(data) && data.length > 0) {
        rawPosts = data;
      }
    }
  } catch (err) {
    console.warn("yande.re popular_by_day request error:", err);
  }

  // If empty or early in day, query yesterday as well
  if (rawPosts.length < limit) {
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const yUrl = `https://yande.re/post/popular_by_day.json?year=${yesterday.getUTCFullYear()}&month=${
        yesterday.getUTCMonth() + 1
      }&day=${yesterday.getUTCDate()}`;
      const res = await fetch(yUrl, { headers: YANDERE_HEADERS });
      if (res.ok) {
        const data = (await res.json()) as YandereRawPost[];
        if (Array.isArray(data) && data.length > 0) {
          rawPosts = [...rawPosts, ...data];
        }
      }
    } catch (err) {
      console.warn("yande.re yesterday popular request error:", err);
    }
  }

  // Fallback: search by score
  if (rawPosts.length === 0) {
    try {
      let ratingTag = "";
      if (ratingFilter === "sfw") ratingTag = "rating:s";
      else if (ratingFilter === "nsfw") ratingTag = "rating:q,e";

      const searchTags = ["order:score", ratingTag].filter(Boolean).join(" ");
      const searchUrl = `https://yande.re/post.json?tags=${encodeURIComponent(
        searchTags
      )}&limit=${Math.max(limit * 3, 30)}`;
      const res = await fetch(searchUrl, { headers: YANDERE_HEADERS });
      if (res.ok) {
        const data = (await res.json()) as YandereRawPost[];
        if (Array.isArray(data)) {
          rawPosts = data;
        }
      }
    } catch (err) {
      console.error("yande.re search fallback error:", err);
    }
  }

  const validPosts: BooruPost[] = [];
  const seenIds = new Set<number>();

  for (const post of rawPosts) {
    if (seenIds.has(post.id)) continue;
    seenIds.add(post.id);

    if (post.status === "deleted" || post.is_banned) continue;

    const rating = (post.rating || "q").toLowerCase();
    const isNsfw = rating === "e" || rating === "q";

    if (ratingFilter === "sfw" && isNsfw) continue;
    if (ratingFilter === "nsfw" && !isNsfw) continue;
    // "all" accepts both

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
