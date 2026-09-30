import { BooruPost, DeliveryMode, RatingFilter } from "../types";

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
  source?: string;
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
  limit: number = 30,
  mode: DeliveryMode = "top",
  tagQuery?: string
): Promise<BooruPost[]> {
  let rawPosts: YandereRawPost[] = [];

  if (tagQuery && tagQuery.trim()) {
    try {
      const cleanTag = tagQuery.trim().replace(/\s+/g, "_");
      let ratingTag = "";
      if (ratingFilter === "sfw") ratingTag = "rating:s";
      else if (ratingFilter === "nsfw") ratingTag = "rating:q,e";

      const orderTag = mode === "random" ? "order:random" : "order:score";
      const searchTags = [cleanTag, orderTag, ratingTag].filter(Boolean).join(" ");
      const searchUrl = `https://yande.re/post.json?tags=${encodeURIComponent(
        searchTags
      )}&limit=${Math.min(100, Math.max(limit * 2, 30))}`;
      const res = await fetch(searchUrl, { headers: YANDERE_HEADERS });
      if (res.ok) {
        const data = (await res.json()) as YandereRawPost[];
        if (Array.isArray(data)) {
          rawPosts = data;
        }
      }
    } catch (err) {
      console.error("yande.re tag search error:", err);
    }
  } else if (mode === "random") {
    try {
      let ratingTag = "";
      if (ratingFilter === "sfw") ratingTag = "rating:s";
      else if (ratingFilter === "nsfw") ratingTag = "rating:q,e";

      const searchTags = ["order:random", ratingTag].filter(Boolean).join(" ");
      const searchUrl = `https://yande.re/post.json?tags=${encodeURIComponent(
        searchTags
      )}&limit=${Math.min(100, Math.max(limit * 2, 30))}`;
      const res = await fetch(searchUrl, { headers: YANDERE_HEADERS });
      if (res.ok) {
        const data = (await res.json()) as YandereRawPost[];
        if (Array.isArray(data)) {
          rawPosts = data;
        }
      }
    } catch (err) {
      console.error("yande.re random fetch error:", err);
    }
  } else {
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
        )}&limit=${Math.min(100, Math.max(limit * 2, 30))}`;
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
  }

  // Fetch tag categorization map from yande.re tag summary
  const tagMap = await getTagTypeMap();

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

    const postTags = (post.tags || "").split(" ").filter(Boolean);
    const charTags: string[] = [];
    const copyTags: string[] = [];
    const artistTags: string[] = [];

    for (const t of postTags) {
      const type = tagMap.get(t);
      if (type === 4) {
        charTags.push(t);
      } else if (type === 3) {
        copyTags.push(t);
      } else if (type === 1) {
        artistTags.push(t);
      }
    }

    // Heuristic fallback if tagMap was unavailable
    if (tagMap.size === 0) {
      for (const t of postTags) {
        if (GENERAL_FALLBACK_TAGS.has(t.toLowerCase())) continue;
        const match = t.match(/_\(([^)]+)\)$/);
        if (match) {
          const paren = match[1].toLowerCase();
          if (NON_COPYRIGHT_PARENS.has(paren)) {
            charTags.push(t);
          } else {
            charTags.push(t.slice(0, match.index));
            copyTags.push(match[1]);
          }
        } else if (KNOWN_FRANCHISES.some((f) => t.toLowerCase().includes(f))) {
          copyTags.push(t);
        } else {
          charTags.push(t);
        }
      }
    }

    // If no copyright found yet, check if any character tag contains series parenthetical
    if (copyTags.length === 0) {
      for (const c of charTags) {
        const match = c.match(/_\(([^)]+)\)$/);
        if (match) {
          const paren = match[1].toLowerCase();
          if (!NON_COPYRIGHT_PARENS.has(paren)) {
            copyTags.push(match[1]);
            break;
          }
        }
      }
    }

    validPosts.push({
      id: post.id,
      source: "yandere",
      imageUrl,
      postUrl: `https://yande.re/post/show/${post.id}`,
      sourceUrl: post.source?.trim() || undefined,
      rating,
      isNsfw,
      tags: postTags,
      artist: artistTags.length > 0 ? artistTags[0] : undefined,
      characterTags: charTags,
      copyrightTags: copyTags,
      score: post.score || 0,
    });

    if (validPosts.length >= limit) break;
  }

  return validPosts;
}

let cachedTagMap: Map<string, number> | null = null;
let lastTagMapFetch = 0;
const TAG_MAP_CACHE_TTL = 1000 * 60 * 60 * 12; // 12 hours

const NON_COPYRIGHT_PARENS = new Set([
  "female", "male", "cosplay", "costume", "style", "swimsuit", "maid",
  "bunny", "young", "older", "futa", "monster", "armor", "uniform",
  "alter", "santa", "summer", "bride", "wedding", "idol"
]);

const KNOWN_FRANCHISES = [
  "genshin", "blue_archive", "zenless", "idolm", "wuthering", "honkai",
  "touhou", "azur_lane", "arknights", "yani_neko", "kairakuten", "seitokai",
  "fate", "vocaloid", "pokemon", "chainsaw_man", "hololive", "nijisanji"
];

const GENERAL_FALLBACK_TAGS = new Set([
  "solo", "1girl", "2girls", "3girls", "4girls", "multiple_girls", "1boy", "2boys", "tagme",
  "highres", "absurdres", "wallpaper", "dress", "bikini", "swimsuits", "breasts", "cleavage",
  "looking_at_viewer", "smile", "thighhighs", "panties", "underwear", "pantyhose", "tail", "wings"
]);

export async function getTagTypeMap(): Promise<Map<string, number>> {
  const now = Date.now();
  if (cachedTagMap && now - lastTagMapFetch < TAG_MAP_CACHE_TTL) {
    return cachedTagMap;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch("https://yande.re/tag/summary.json", {
      headers: {
        "User-Agent": YANDERE_HEADERS["User-Agent"],
        "Accept-Encoding": "gzip",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const json = (await res.json()) as { data?: string };
      if (json.data) {
        const map = new Map<string, number>();
        const entries = json.data.split(" ");
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          if (!entry) continue;
          const parts = entry.split("`");
          if (parts.length >= 2) {
            const type = parseInt(parts[0], 10);
            if (!isNaN(type)) {
              for (let j = 1; j < parts.length; j++) {
                if (parts[j]) {
                  map.set(parts[j], type);
                }
              }
            }
          }
        }
        cachedTagMap = map;
        lastTagMapFetch = now;
        return map;
      }
    }
  } catch (err) {
    console.warn("yande.re tag summary fetch error:", err);
  }

  if (cachedTagMap) return cachedTagMap;
  return new Map<string, number>();
}

