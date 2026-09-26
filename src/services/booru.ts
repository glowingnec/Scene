import { BooruPost, BooruSource, RatingFilter } from "../types";
import { fetchDanbooruTop10 } from "./danbooru";
import { fetchYandereTop10 } from "./yandere";

export async function fetchTop10Posts(
  source: BooruSource,
  rating: RatingFilter
): Promise<BooruPost[]> {
  if (source === "danbooru") {
    return await fetchDanbooruTop10(rating);
  } else {
    return await fetchYandereTop10(rating);
  }
}
