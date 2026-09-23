// Real per-player news, sourced from ESPN's public news feed — the same
// unofficial, keyless endpoint lib/espnGames.ts already calls for scoreboard
// odds (no API key, sends access-control-allow-origin: *, safe to call
// client-side). Confirmed by direct testing: ESPN's own `athleteId`/`athlete`
// query params are silently ignored and just return the generic feed, so the
// feed has to be fetched whole and filtered here by matching `athleteId` in
// each article's own category tags (which real testing showed ESPN does
// attach correctly per-article).
//
// Coverage is real but not exhaustive — this only surfaces ESPN's own
// published articles (trades, milestones, storylines), not the routine
// injury/practice wire blurbs Sleeper's player page aggregates from sources
// it licenses (RotoBaller etc.). For that denser day-to-day feed, the player
// card's "Injury report & news on Sleeper" link is still the real source —
// this tab is a complement, not a replacement.
export interface NewsArticle {
  id: number;
  headline: string;
  description: string;
  published: string; // ISO date
  imageUrl: string | null;
  link: string;
  isVideo: boolean;
}

interface RawArticleCategory {
  type?: string;
  athleteId?: number;
}
interface RawArticle {
  id: number;
  headline?: string;
  description?: string;
  published?: string;
  type?: string;
  images?: { url?: string }[];
  links?: { web?: { href?: string } };
  categories?: RawArticleCategory[];
}

const FEED_SIZE = 50; // ESPN caps this feed at 50 regardless of a higher limit param (confirmed by testing)
const CACHE_MS = 15 * 60 * 1000; // one shared feed for every player card open this window, not a fetch per click

let cache: { fetchedAt: number; articles: RawArticle[] } | null = null;

async function getFeed(): Promise<RawArticle[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache.articles;
  const res = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=${FEED_SIZE}`
  );
  if (!res.ok) throw new Error("Couldn't reach ESPN news.");
  const json = await res.json();
  const articles: RawArticle[] = json.articles ?? [];
  cache = { fetchedAt: Date.now(), articles };
  return articles;
}

export async function getPlayerNews(espnId: number): Promise<NewsArticle[]> {
  const feed = await getFeed();
  return feed
    .filter((a) => (a.categories ?? []).some((c) => c.type === "athlete" && c.athleteId === espnId))
    .map((a) => ({
      id: a.id,
      headline: a.headline ?? "",
      description: a.description ?? "",
      published: a.published ?? "",
      imageUrl: a.images?.[0]?.url ?? null,
      link: a.links?.web?.href ?? "https://www.espn.com/nfl/",
      isVideo: a.type === "Media",
    }));
}
