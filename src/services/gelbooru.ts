import { BooruPost, DeliveryMode, RatingFilter } from "../types";

const GELBOORU_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Referer": "https://gelbooru.com/",
};

interface GelbooruRawPost {
  id: number;
  created_at?: string;
  score?: number;
  width?: number;
  height?: number;
  md5?: string;
  directory?: string;
  image?: string;
  rating?: string; // 'general', 'sensitive', 'questionable', 'explicit'
  source?: string;
  file_url?: string;
  sample_url?: string;
  preview_url?: string;
  tags?: string;
  title?: string;
  status?: string;
}

interface GelbooruApiResponse {
  post?: GelbooruRawPost[];
  "@attributes"?: {
    limit: number;
    offset: number;
    count: number;
  };
}

export async function fetchGelbooruPosts(
  ratingFilter: RatingFilter,
  limit: number = 30,
  mode: DeliveryMode = "top",
  apiKey?: string,
  userId?: string,
  tagQuery?: string
): Promise<BooruPost[]> {
  const tags: string[] = [];

  if (tagQuery && tagQuery.trim()) {
    tags.push(tagQuery.trim().replace(/\s+/g, "_"));
  }

  // 1. Rating filter tag
  if (ratingFilter === "sfw") {
    tags.push("rating:general");
  } else if (ratingFilter === "nsfw") {
    tags.push("-rating:general");
  }

  // 2. Delivery mode tag
  if (mode === "random") {
    tags.push("sort:random");
  } else {
    tags.push("sort:score:desc");
  }

  const queryParams = new URLSearchParams({
    page: "dapi",
    s: "post",
    q: "index",
    json: "1",
    limit: String(Math.min(100, Math.max(limit * 2, 20))),
  });

  if (tags.length > 0) {
    queryParams.set("tags", tags.join(" "));
  }

  if (apiKey && userId) {
    queryParams.set("api_key", apiKey);
    queryParams.set("user_id", userId);
  }

  const url = `https://gelbooru.com/index.php?${queryParams.toString()}`;

  try {
    const res = await fetch(url, { headers: GELBOORU_HEADERS });
    if (!res.ok) {
      if (res.status === 401) {
        console.warn("Gelbooru API returned 401 Unauthorized. Please configure GELBOORU_API_KEY and GELBOORU_USER_ID.");
      } else {
        console.warn(`Gelbooru API returned HTTP ${res.status}`);
      }
      return [];
    }

    const data = (await res.json()) as GelbooruApiResponse | GelbooruRawPost[];
    let rawPosts: GelbooruRawPost[] = [];

    if (Array.isArray(data)) {
      rawPosts = data;
    } else if (data && Array.isArray(data.post)) {
      rawPosts = data.post;
    }

    const validPosts: BooruPost[] = [];
    const seenIds = new Set<number>();

    for (const post of rawPosts) {
      if (!post.id || seenIds.has(post.id)) continue;
      seenIds.add(post.id);

      if (post.status === "deleted") continue;

      const rating = (post.rating || "general").toLowerCase();
      const isNsfw = rating !== "general";

      if (ratingFilter === "sfw" && isNsfw) continue;
      if (ratingFilter === "nsfw" && !isNsfw) continue;

      const imageUrl = post.sample_url || post.file_url;
      if (!imageUrl) continue;

      // Ignore video formats
      const lowerImg = imageUrl.toLowerCase();
      if (lowerImg.endsWith(".mp4") || lowerImg.endsWith(".webm") || lowerImg.endsWith(".zip")) {
        continue;
      }

      const postTags = (post.tags || "").split(" ").filter(Boolean);

      validPosts.push({
        id: post.id,
        source: "gelbooru",
        imageUrl,
        postUrl: `https://gelbooru.com/index.php?page=post&s=view&id=${post.id}`,
        sourceUrl: post.source?.trim() || undefined,
        rating,
        isNsfw,
        tags: postTags,
        score: post.score || 0,
      });

      if (validPosts.length >= limit) {
        break;
      }
    }

    return validPosts;
  } catch (err) {
    console.error("fetchGelbooruPosts error:", err);
    return [];
  }
}
