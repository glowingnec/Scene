import { BooruPost, RatingFilter } from "../types";

interface DanbooruRawPost {
  id: number;
  created_at?: string;
  file_url?: string;
  large_file_url?: string;
  preview_file_url?: string;
  file_ext?: string;
  rating?: string; // 'g' (general), 's' (sensitive), 'q' (questionable), 'e' (explicit)
  tag_string?: string;
  tag_string_artist?: string;
  tag_string_character?: string;
  score?: number;
  fav_count?: number;
  is_banned?: boolean;
  is_deleted?: boolean;
  media_asset?: {
    variants?: Array<{
      url: string;
      type: string;
      width: number;
      height: number;
    }>;
  };
}

export async function fetchDanbooruPosts(
  ratingFilter: RatingFilter,
  limit: number = 10,
  auth?: { login?: string; apiKey?: string }
): Promise<BooruPost[]> {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://danbooru.donmai.us/",
  };

  if (auth?.login && auth?.apiKey) {
    headers["Authorization"] = "Basic " + btoa(`${auth.login}:${auth.apiKey}`);
  }

  let rawPosts: DanbooruRawPost[] = [];
  let blockedByCloudflare = false;

  // Danbooru tags query (Danbooru free tier permits max 2 tags)
  let tagQuery = "order:rank";
  if (ratingFilter === "sfw") {
    tagQuery += " rating:g,s";
  } else if (ratingFilter === "nsfw") {
    tagQuery += " rating:q,e";
  }

  const queryParams = new URLSearchParams({
    tags: tagQuery,
    limit: String(Math.max(limit * 3, 30)),
  });

  if (auth?.login && auth?.apiKey) {
    queryParams.set("login", auth.login);
    queryParams.set("api_key", auth.apiKey);
  }

  const url = `https://danbooru.donmai.us/posts.json?${queryParams.toString()}`;

  try {
    const res = await fetch(url, { headers });
    if (res.ok) {
      const data = (await res.json()) as DanbooruRawPost[];
      if (Array.isArray(data) && data.length > 0) {
        rawPosts = data;
      }
    } else {
      const text = await res.text();
      if (res.status === 403 || text.includes("Just a moment...") || text.includes("challenges.cloudflare.com")) {
        blockedByCloudflare = true;
      }
      console.warn(`Danbooru posts.json failed HTTP ${res.status}:`, text.slice(0, 200));
    }
  } catch (err) {
    console.warn("Danbooru rank query error:", err);
  }

  // Fallback 1: explore popular posts
  if (rawPosts.length === 0 && !blockedByCloudflare) {
    try {
      const popularUrl = "https://danbooru.donmai.us/explore/posts/popular.json?scale=day";
      const res = await fetch(popularUrl, { headers });
      if (res.ok) {
        const data = (await res.json()) as DanbooruRawPost[];
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
      "Danbooru has Cloudflare Bot Protection enabled against cloud servers. Please add a free Danbooru API key (DANBOORU_LOGIN & DANBOORU_API_KEY) in Cloudflare settings, or use /yan."
    );
  }

  const validPosts: BooruPost[] = [];

  for (const post of rawPosts) {
    if (post.is_banned || post.is_deleted) continue;

    const rating = (post.rating || "q").toLowerCase();
    const isNsfw = rating === "e" || rating === "q";

    if (ratingFilter === "sfw" && isNsfw) continue;
    if (ratingFilter === "nsfw" && !isNsfw) continue;

    let imageUrl = post.large_file_url || post.file_url;

    if (!imageUrl && post.media_asset?.variants) {
      const preferred = post.media_asset.variants.find(
        (v) => v.type === "sample" || v.type === "720p" || v.type === "1080p"
      );
      imageUrl = preferred ? preferred.url : post.media_asset.variants[0]?.url;
    }

    if (!imageUrl) continue;

    if (imageUrl.startsWith("/")) {
      imageUrl = `https://danbooru.donmai.us${imageUrl}`;
    }

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
      artist: post.tag_string_artist?.replace(/ /g, ", ") || undefined,
      score: post.score || post.fav_count || 0,
    });

    if (validPosts.length >= limit) break;
  }

  return validPosts;
}
