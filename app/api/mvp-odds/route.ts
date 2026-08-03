import { NextResponse } from "next/server";

// Server-side proxy for SharpAPI's NFL MVP futures market. Keeps
// SHARPAPI_API_KEY off the client — this route is the only thing that ever
// sees it. See CLAUDE.md for why this exists as an API route instead of a
// direct client-side fetch like the Sleeper calls elsewhere in the app.

interface SharpApiOddsEntry {
  market_type: string;
  selection: string;
  selection_type: string;
  odds_american: number;
  odds_probability: number;
  sportsbook: string;
}

interface SharpApiOddsResponse {
  data: SharpApiOddsEntry[];
  updated_at: string;
}

export interface MvpOddsEntry {
  american: number;
  probability: number;
  sportsbook: string;
}

export async function GET() {
  const key = process.env.SHARPAPI_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "SharpAPI is not configured" }, { status: 501 });
  }

  let res: Response;
  try {
    res = await fetch(
      "https://api.sharpapi.io/api/v1/odds?sport=football&league=nfl&market=mvp&limit=100",
      {
        headers: { "X-API-Key": key },
        next: { revalidate: 3600 }, // MVP odds move slowly; cache an hour
      }
    );
  } catch {
    return NextResponse.json({ error: "Couldn't reach SharpAPI" }, { status: 502 });
  }

  if (!res.ok) {
    return NextResponse.json({ error: `SharpAPI returned ${res.status}` }, { status: 502 });
  }

  const json = (await res.json()) as SharpApiOddsResponse;
  const odds: Record<string, MvpOddsEntry> = {};
  for (const entry of json.data ?? []) {
    if (entry.market_type !== "mvp" || entry.selection_type !== "outright") continue;
    // Keep the shortest (most favorable) odds if more than one book has a line.
    const existing = odds[entry.selection];
    if (!existing || entry.odds_american < existing.american) {
      odds[entry.selection] = {
        american: entry.odds_american,
        probability: entry.odds_probability,
        sportsbook: entry.sportsbook,
      };
    }
  }

  return NextResponse.json({ odds, updatedAt: json.updated_at });
}
