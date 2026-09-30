import { BooruPost, DeliveryMode, RatingFilter } from "../types";
import { fetchYanderePosts } from "./yandere";

export async function fetchBooruPosts(
  rating: RatingFilter,
  limit: number = 30,
  mode: DeliveryMode = "top",
  tagQuery?: string
): Promise<BooruPost[]> {
  return await fetchYanderePosts(rating, limit, mode, tagQuery);
}
