// Real, per-player injury reports — sourced from ESPN's public injuries feed
// (same unofficial, keyless site.api.espn.com family lib/espnGames.ts and
// lib/espnNews.ts already use). Confirmed by direct testing: this feed
// carries the actual RotoWire-sourced status blurb (short + long comment,
// with "source":"RotoWire" attribution) plus structured detail — body part,
// side, and an expected return date — for every currently-injured player
// league-wide. This is the real day-to-day injury-report content Sleeper's
// own page shows (see the "Injury report & news on Sleeper" link on the
// player card); ESPN just happens to expose it through this endpoint too.
//
// The raw feed is one ~9MB league-wide payload (every team, bloated with
// full logo arrays per player). It's fetched once, trimmed down to just the
// fields used here (~500KB for the ~800 currently-injured players), and
// cached in localStorage for the day — the same day-granularity cache
// lib/sleeper.ts already uses for the player dump.
export interface InjuryReport {
  status: string;
  type: string | null; // body part, e.g. "Quadriceps"
  location: string | null; // e.g. "Leg"
  detail: string | null; // e.g. "Strain"
  returnDate: string | null; // YYYY-MM-DD, ESPN's own estimate
  shortComment: string | null;
  longComment: string | null;
  source: string | null; // e.g. "RotoWire" — real attribution, shown alongside the text
  date: string | null; // ISO — when this report was filed
}

interface RawInjuryEntry {
  status?: string;
  date?: string;
  shortComment?: string;
  longComment?: string;
  details?: {
    type?: string;
    location?: string;
    detail?: string;
    returnDate?: string;
  };
  athlete?: {
    links?: { href?: string }[];
    headshot?: { href?: string };
    notes?: { items?: { source?: string }[] };
  };
}

interface RawInjuriesResponse {
  injuries?: { injuries?: RawInjuryEntry[] }[];
}

const CACHE_KEY = "fantis_espn_injuries_v1";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function extractEspnId(entry: RawInjuryEntry): string | null {
  const href = entry.athlete?.links?.[0]?.href || entry.athlete?.headshot?.href || "";
  const m = href.match(/\/(\d+)(?:\.png|\/)/);
  return m ? m[1] : null;
}

export async function getInjuryReports(): Promise<Record<string, InjuryReport>> {
  if (typeof window !== "undefined") {
    try {
      const cached = window.localStorage.getItem(CACHE_KEY);
      if (cached) {
        const d = JSON.parse(cached) as { day: string; map: Record<string, InjuryReport> };
        if (d.day === today()) return d.map;
      }
    } catch {
      // ignore cache read errors
    }
  }

  const res = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries");
  if (!res.ok) throw new Error("Couldn't reach ESPN injuries.");
  const json: RawInjuriesResponse = await res.json();

  const map: Record<string, InjuryReport> = {};
  for (const team of json.injuries ?? []) {
    for (const entry of team.injuries ?? []) {
      const espnId = extractEspnId(entry);
      if (!espnId) continue;
      map[espnId] = {
        status: entry.status ?? "",
        type: entry.details?.type ?? null,
        location: entry.details?.location ?? null,
        detail: entry.details?.detail ?? null,
        returnDate: entry.details?.returnDate ?? null,
        shortComment: entry.shortComment ?? null,
        longComment: entry.longComment ?? null,
        source: entry.athlete?.notes?.items?.[0]?.source ?? null,
        date: entry.date ?? null,
      };
    }
  }

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify({ day: today(), map }));
    } catch {
      // ignore cache write errors (e.g. quota exceeded)
    }
  }

  return map;
}
