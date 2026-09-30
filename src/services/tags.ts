import { BooruTagSuggestion, BooruSource } from "../types";

export function getTagTypeLabel(type: number): string {
  switch (type) {
    case 4:
      return "Character";
    case 3:
      return "Series / Copyright";
    case 1:
      return "Artist";
    default:
      return "General";
  }
}

export function getTagTypeEmoji(type: number): string {
  switch (type) {
    case 4:
      return "👤";
    case 3:
      return "📚";
    case 1:
      return "🎨";
    default:
      return "🏷️";
  }
}

/**
 * Searches tags across yande.re, Gelbooru, or both.
 * Records individual post counts per source to provide full transparency.
 */
export async function searchBooruTags(
  query: string,
  limit: number = 10,
  gelbooruAuth?: { apiKey?: string; userId?: string },
  source: BooruSource = "both"
): Promise<BooruTagSuggestion[]> {
  const clean = query.trim().toLowerCase().replace(/\s+/g, "_");
  if (!clean) return [];

  const promises: Promise<{
    items: { name: string; count: number; type: number }[];
    source: "yandere" | "gelbooru";
  }>[] = [];

  // 1. yande.re tag search
  if (source === "both" || source === "yandere") {
    promises.push(
      (async () => {
        try {
          const url = `https://yande.re/tag.json?name=*${encodeURIComponent(clean)}*&order=count&limit=${limit * 2}`;
          const res = await fetch(url, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              Accept: "application/json",
            },
          });
          if (!res.ok) return { items: [], source: "yandere" as const };
          const data = (await res.json()) as any[];
          if (!Array.isArray(data)) return { items: [], source: "yandere" as const };
          return {
            items: data.map((t) => ({
              name: t.name,
              count: t.count || 0,
              type: t.type ?? 0,
            })),
            source: "yandere" as const,
          };
        } catch (err) {
          console.warn("yande.re tag search error:", err);
          return { items: [], source: "yandere" as const };
        }
      })()
    );
  }

  // 2. Gelbooru tag search
  if ((source === "both" || source === "gelbooru") && gelbooruAuth?.apiKey && gelbooruAuth?.userId) {
    promises.push(
      (async () => {
        try {
          const url = `https://gelbooru.com/index.php?page=dapi&s=tag&q=index&json=1&name_pattern=%25${encodeURIComponent(
            clean
          )}%25&api_key=${gelbooruAuth.apiKey}&user_id=${gelbooruAuth.userId}&limit=${limit * 2}`;
          const res = await fetch(url, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              Accept: "application/json",
            },
          });
          if (!res.ok) return { items: [], source: "gelbooru" as const };
          const data = (await res.json()) as any;
          const rawTags = Array.isArray(data) ? data : data?.tag || [];
          return {
            items: rawTags.map((t: any) => ({
              name: t.name,
              count: parseInt(t.count || "0", 10),
              type: parseInt(t.type || "0", 10),
            })),
            source: "gelbooru" as const,
          };
        } catch (err) {
          console.warn("Gelbooru tag search error:", err);
          return { items: [], source: "gelbooru" as const };
        }
      })()
    );
  }

  const results = await Promise.all(promises);
  const tagMap = new Map<string, BooruTagSuggestion>();

  for (const group of results) {
    for (const item of group.items) {
      const existing = tagMap.get(item.name);
      if (existing) {
        if (group.source === "yandere") {
          existing.yandereCount = item.count;
        } else {
          existing.gelbooruCount = item.count;
        }
        existing.count = (existing.yandereCount || 0) + (existing.gelbooruCount || 0);
        existing.source = "both";
        if (existing.type === 0 && item.type !== 0) {
          existing.type = item.type;
        }
      } else {
        tagMap.set(item.name, {
          name: item.name,
          count: item.count,
          type: item.type,
          source: group.source,
          yandereCount: group.source === "yandere" ? item.count : undefined,
          gelbooruCount: group.source === "gelbooru" ? item.count : undefined,
        });
      }
    }
  }

  return Array.from(tagMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
