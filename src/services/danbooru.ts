import { BooruPost, RatingFilter } from "../types";

const DANBOORU_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Referer": "https://danbooru.donmai.us/",
};

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
  limit: number = 10
): Promise<BooruPost[]> {
  let rawPosts: DanbooruRawPost[] = [];

  // Try rank order on posts.json (most reliable for Danbooru)
  try {
    let tagQuery = "order:rank";
    if (ratingFilter === "sfw") {
      tagQuery += " rating:g,s";
    } else if (ratingFilter === "nsfw") {
      tagQuery += " rating:q,e";
    }
    // "all" has no rating tag

    const url = `https://danbooru.donmai.us/posts.json?tags=${encodeURIComponent(tagQuery)}&limit=${Math.max(limit * 3, 30)}`;
    const res = await fetch(url, { headers: DANBOORU_HEADERS });
    if (res.ok) {
      const data = (await res.json()) as DanbooruRawPost[];
      if (Array.isArray(data) && data.length > 0) {
        rawPosts = data;
      }
    } else {
      console.warn(`Danbooru posts.json failed with HTTP ${res.status}: ${res.statusText}`);
    }
  } catch (err) {
    console.warn("Danbooru rank query error:", err);
  }

  // Fallback 1: explore popular posts endpoint
  if (rawPosts.length === 0) {
    try {
      const popularUrl = "https://danbooru.donmai.us/explore/posts/popular.json?scale=day";
      const res = await fetch(popularUrl, { headers: DANBOORU_HEADERS });
      if (res.ok) {
        const data = (await res.json()) as DanbooruRawPost[];
        if (Array.isArray(data)) {
          rawPosts = data;
        }
      }
    } catch (err) {
      console.warn("Danbooru popular.json fallback error:", err);
    }
  }

  // Fallback 2: score order
  if (rawPosts.length === 0) {
    try {
      const res = await fetch(
        "https://danbooru.donmai.us/posts.json?tags=order:score&limit=40",
        { headers: DANBOORU_HEADERS }
      );
      if (res.ok) {
        const data = (await res.json()) as DanbooruRawPost[];
        if (Array.isArray(data)) rawPosts = data;
      }
    } catch (err) {
      console.error("Danbooru score query fallback error:", err);
    }
  }

  const validPosts: BooruPost[] = [];

  for (const post of rawPosts) {
    if (post.is_banned || post.is_deleted) continue;

    const rating = (post.rating || "q").toLowerCase();
    const isNsfw = rating === "e" || rating === "q";

    if (ratingFilter === "sfw" && isNsfw) continue;
    if (ratingFilter === "nsfw" && !isNsfw) continue;
    // "all" accepts both

    // Determine image URL
    let imageUrl = post.large_file_url || post.file_url;

    if (!imageUrl && post.media_asset?.variants) {
      const preferred = post.media_asset.variants.find(
        (v) => v.type === "sample" || v.type === "720p" || v.type === "1080p"
      );
      imageUrl = preferred ? preferred.url : post.media_asset.variants[0]?.url;
    }

    if (!imageUrl) continue;

    // Resolve relative URLs if any
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
