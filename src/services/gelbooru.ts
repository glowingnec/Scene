import { BooruPost, RatingFilter } from "../types";

const GELBOORU_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
};

interface GelbooruRawPost {
  id: number;
  created_at?: string;
  score?: number;
  width?: number;
  height?: number;
  image?: string;
  file_url?: string;
  sample_url?: string;
  preview_url?: string;
  rating?: string; // 'general', 'sensitive', 'questionable', 'explicit'
  tags?: string;
  source?: string;
  owner?: string;
  status?: string;
}

export async function fetchGelbooruPosts(
  ratingFilter: RatingFilter,
  limit: number = 10,
  auth?: { userId?: string; apiKey?: string }
): Promise<BooruPost[]> {
  let tagQuery = "sort:score:desc -video -webm -animated";

  if (ratingFilter === "sfw") {
    tagQuery += " rating:general";
  } else if (ratingFilter === "nsfw") {
    tagQuery += " rating:explicit";
  }

  const queryParams = new URLSearchParams({
    page: "dapi",
    s: "post",
    q: "index",
    json: "1",
    tags: tagQuery,
    limit: String(Math.min(100, Math.max(limit * 2, 30))),
  });

  if (auth?.userId && auth?.apiKey) {
    queryParams.set("user_id", auth.userId);
    queryParams.set("api_key", auth.apiKey);
  }

  const url = `https://gelbooru.com/index.php?${queryParams.toString()}`;

  try {
    const res = await fetch(url, { headers: GELBOORU_HEADERS });
    if (!res.ok) {
      if (res.status === 401) {
        throw new Error(
          "Gelbooru requires free API credentials. Please add GELBOORU_USER_ID and GELBOORU_API_KEY in Cloudflare Settings."
        );
      }
      throw new Error(`Gelbooru returned HTTP ${res.status}: ${res.statusText}`);
    }

    const data: any = await res.json();
    let rawPosts: GelbooruRawPost[] = [];

    if (Array.isArray(data)) {
      rawPosts = data;
    } else if (data && Array.isArray(data.post)) {
      rawPosts = data.post;
    }

    const validPosts: BooruPost[] = [];

    for (const post of rawPosts) {
      const rating = (post.rating || "q").toLowerCase();
      const isNsfw = rating === "explicit" || rating === "questionable" || rating === "e" || rating === "q";

      if (ratingFilter === "sfw" && isNsfw) continue;
      if (ratingFilter === "nsfw" && !isNsfw) continue;

      // Filter out non-image files (videos, animations, archives)
      const rawFile = (post.image || post.file_url || "").toLowerCase();
      const ext = rawFile.split(".").pop()?.split("?")[0] || "";
      if (
        ext === "mp4" ||
        ext === "webm" ||
        ext === "zip" ||
        ext === "gif" ||
        ext === "swf" ||
        ext === "avi" ||
        ext === "mkv"
      ) {
        continue;
      }

      // Prefer sample URL to avoid huge file sizes that cause Telegram sendMediaGroup failures
      let imageUrl = post.sample_url || post.file_url || post.preview_url;
      if (!imageUrl) continue;

      if (imageUrl.startsWith("//")) {
        imageUrl = `https:${imageUrl}`;
      }

      validPosts.push({
        id: post.id,
        source: "gelbooru",
        imageUrl,
        postUrl: `https://gelbooru.com/index.php?page=post&s=view&id=${post.id}`,
        rating,
        isNsfw,
        tags: (post.tags || "").split(" ").slice(0, 15),
        artist: post.owner,
        score: post.score || 0,
      });

      if (validPosts.length >= limit) break;
    }

    return validPosts;
  } catch (err: any) {
    console.error("Gelbooru fetch error:", err);
    throw err;
  }
}
