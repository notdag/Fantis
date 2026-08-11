// Historical, official weekly injury-report status — real data from
// nflverse's public injuries dataset (nflverse-data on GitHub; the actual
// NFL injury report — Questionable/Doubtful/Out — not an editorial blurb).
// This complements the *current* week's real-time status already shown
// elsewhere (Sleeper/ESPN) with *historical* weekly report presence, which
// nothing else in the app currently shows — e.g. a down game explained by
// the player having actually been on the injury report that week, even
// though he played.
//
// Fetched via app/api/nflverse-injuries (server-side proxy) rather than
// directly from GitHub — confirmed by testing that GitHub's release-asset
// URLs don't send CORS headers, so a direct client fetch fails even though
// the data itself needs no key. The route does the gsis_id->espn_id join
// (nflverse's own player crosswalk) so this file just consumes the result,
// matched against the espnId Sleeper's player dump already gives us.
export interface WeeklyInjuryStatus {
  week: number;
  status: string; // "Questionable" | "Doubtful" | "Out" | ...
  bodyPart: string | null;
}

const SEASON_CACHE_PREFIX = "fantis_nflverse_injuries_v2_";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getSeasonInjuryReportsByEspnId(
  season: string
): Promise<Record<string, WeeklyInjuryStatus[]>> {
  const cacheKey = `${SEASON_CACHE_PREFIX}${season}`;
  if (typeof window !== "undefined") {
    try {
      const cached = window.localStorage.getItem(cacheKey);
      if (cached) {
        const d = JSON.parse(cached) as { day: string; map: Record<string, WeeklyInjuryStatus[]> };
        if (d.day === today()) return d.map;
      }
    } catch {
      // ignore cache read errors
    }
  }

  const res = await fetch(`/api/nflverse-injuries?season=${season}`);
  if (!res.ok) throw new Error("Couldn't reach nflverse injuries data.");
  const json = (await res.json()) as { injuries: Record<string, WeeklyInjuryStatus[]> };
  const map = json.injuries ?? {};

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(cacheKey, JSON.stringify({ day: today(), map }));
    } catch {
      // ignore cache write errors (e.g. quota exceeded)
    }
  }

  return map;
}
