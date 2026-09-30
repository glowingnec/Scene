import { BooruTagSuggestion } from "../types";

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
 * Searches tags on yande.re
 */
export async function searchBooruTags(
  query: string,
  limit: number = 10
): Promise<BooruTagSuggestion[]> {
  const clean = query.trim().toLowerCase().replace(/\s+/g, "_");
  if (!clean) return [];

  try {
    const url = `https://yande.re/tag.json?name=*${encodeURIComponent(clean)}*&order=count&limit=${limit * 2}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as any[];
    if (!Array.isArray(data)) return [];

    return data
      .map((t) => ({
        name: t.name,
        count: t.count || 0,
        type: t.type ?? 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  } catch (err) {
    console.warn("yande.re tag search error:", err);
    return [];
  }
}
