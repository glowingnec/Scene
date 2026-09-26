import { BooruPost, BooruSource, RatingFilter } from "../types";
import { fetchYanderePosts } from "./yandere";
import { fetchGelbooruPosts } from "./gelbooru";

export async function fetchBooruPosts(
  source: BooruSource,
  rating: RatingFilter,
  limit: number = 10,
  gelbooruAuth?: { userId?: string; apiKey?: string }
): Promise<BooruPost[]> {
  if (source === "gelbooru") {
    return await fetchGelbooruPosts(rating, limit, gelbooruAuth);
  } else {
    return await fetchYanderePosts(rating, limit);
  }
}
