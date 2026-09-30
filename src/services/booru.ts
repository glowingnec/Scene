import { BooruPost, BooruSource, DeliveryMode, RatingFilter } from "../types";
import { fetchYanderePosts } from "./yandere";
import { fetchGelbooruPosts } from "./gelbooru";

export interface CombinedBooruResult {
  yanderePosts: BooruPost[];
  gelbooruPosts: BooruPost[];
  posts: BooruPost[];
}

export async function fetchBooruPosts(
  source: BooruSource,
  rating: RatingFilter,
  limit: number = 30,
  mode: DeliveryMode = "top",
  gelbooruAuth?: { apiKey?: string; userId?: string },
  tagQuery?: string
): Promise<CombinedBooruResult> {
  if (source === "yandere") {
    const yanderePosts = await fetchYanderePosts(rating, limit, mode, tagQuery);
    return { yanderePosts, gelbooruPosts: [], posts: yanderePosts };
  }

  if (source === "gelbooru") {
    const gelbooruPosts = await fetchGelbooruPosts(
      rating,
      limit,
      mode,
      gelbooruAuth?.apiKey,
      gelbooruAuth?.userId,
      tagQuery
    );
    return { yanderePosts: [], gelbooruPosts, posts: gelbooruPosts };
  }

  // source === "both": Fetch limit from yande.re AND limit from Gelbooru concurrently
  const [yanderePosts, gelbooruPosts] = await Promise.all([
    fetchYanderePosts(rating, limit, mode, tagQuery),
    fetchGelbooruPosts(rating, limit, mode, gelbooruAuth?.apiKey, gelbooruAuth?.userId, tagQuery),
  ]);

  const combined = [...yanderePosts, ...gelbooruPosts];

  return { yanderePosts, gelbooruPosts, posts: combined };
}
