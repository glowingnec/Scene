import { BooruPost, RatingFilter } from "../types";

const USER_AGENT = "BooruTodayBot/1.0 (Cloudflare Workers; Telegram Bot by @cheytac29)";

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

export async function fetchDanbooruTop10(ratingFilter: RatingFilter): Promise<BooruPost[]> {
  const headers = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json",
  };

  let rawPosts: DanbooruRawPost[] = [];

  // Primary: explore popular posts of the day
  try {
    const popularUrl = "https://danbooru.donmai.us/explore/posts/popular.json?scale=day";
    const res = await fetch(popularUrl, { headers });
    if (res.ok) {
      const data = (await res.json()) as DanbooruRawPost[];
      if (Array.isArray(data) && data.length > 0) {
        rawPosts = data;
      }
    }
  } catch (err) {
    console.warn("Danbooru popular.json request failed, trying fallback:", err);
  }

  // Fallback: search by order:rank or order:score
  if (rawPosts.length === 0) {
    try {
      const ratingTag = ratingFilter === "sfw" ? "rating:g,s" : "";
      const searchTags = ["order:rank", ratingTag].filter(Boolean).join(" ");
      const searchUrl = `https://danbooru.donmai.us/posts.json?tags=${encodeURIComponent(
        searchTags
      )}&limit=30`;

      const res = await fetch(searchUrl, { headers });
      if (res.ok) {
        const data = (await res.json()) as DanbooruRawPost[];
        if (Array.isArray(data)) {
          rawPosts = data;
        }
      }
    } catch (err) {
      console.error("Danbooru fallback posts search failed:", err);
    }
  }

  const validPosts: BooruPost[] = [];

  for (const post of rawPosts) {
    if (post.is_banned || post.is_deleted) continue;

    const rating = (post.rating || "q").toLowerCase();
    const isExplicitOrQuestionable = rating === "e" || rating === "q";

    // Enforce SFW filter
    if (ratingFilter === "sfw" && isExplicitOrQuestionable) {
      continue;
    }

    // Determine highest quality suitable image URL for Telegram
    let imageUrl = post.large_file_url || post.file_url;

    // Check media asset variants if large_file_url is missing
    if (!imageUrl && post.media_asset?.variants) {
      const sampleVariant = post.media_asset.variants.find(
        (v) => v.type === "sample" || v.type === "1080p" || v.type === "720p"
      );
      if (sampleVariant) {
        imageUrl = sampleVariant.url;
      } else if (post.media_asset.variants.length > 0) {
        imageUrl = post.media_asset.variants[0].url;
      }
    }

    if (!imageUrl) continue;

    // Filter out video files like mp4 or webm, as Telegram photo media group expects photos
    const ext = (post.file_ext || "").toLowerCase();
    if (ext === "mp4" || ext === "webm" || ext === "zip") continue;

    validPosts.push({
      id: post.id,
      source: "danbooru",
      imageUrl,
      postUrl: `https://danbooru.donmai.us/posts/${post.id}`,
      rating,
      isNsfw: isExplicitOrQuestionable,
      tags: (post.tag_string || "").split(" ").slice(0, 15),
      artist: post.tag_string_artist?.replace(/ /g, ", ") || undefined,
      score: post.score || post.fav_count || 0,
    });

    if (validPosts.length >= 10) break;
  }

  return validPosts;
}
