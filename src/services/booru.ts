import { BooruPost, RatingFilter } from "../types";
import { fetchYanderePosts } from "./yandere";

export async function fetchBooruPosts(
  rating: RatingFilter,
  limit: number = 15
): Promise<BooruPost[]> {
  return await fetchYanderePosts(rating, limit);
}
