import { BooruPost, BooruSource, RatingFilter } from "../types";
import { fetchDanbooruPosts } from "./danbooru";
import { fetchYanderePosts } from "./yandere";

export async function fetchBooruPosts(
  source: BooruSource,
  rating: RatingFilter,
  limit: number = 10
): Promise<BooruPost[]> {
  if (source === "danbooru") {
    return await fetchDanbooruPosts(rating, limit);
  } else {
    return await fetchYanderePosts(rating, limit);
  }
}
