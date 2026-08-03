import { NextResponse } from "next/server";

// Server-side proxy for SportsGameOdds's NFL player props. Keeps
// SPORTSGAMEODDS_API_KEY off the client, same reasoning as
// app/api/mvp-odds/route.ts. The free "Amateur" tier caps out at 2.5k
// objects/month, and — confirmed by testing — usage is metered per event
// returned, not per prop line within it. Fetching a small event window and
// caching for hours (not minutes) keeps this comfortably under budget:
// 20 events x ~2 pulls/day x 30 days = ~1200/month.

interface SgoPlayer {
  playerID: string;
  name: string;
}

interface SgoOdd {
  statID: string;
  statEntityID: string;
  betTypeID: string;
  sideID: string;
  periodID: string;
  opposingOddID?: string;
  bookOdds?: string;
  fairOdds?: string;
  bookOverUnder?: string;
  fairOverUnder?: string;
}

interface SgoEvent {
  eventID: string;
  players?: Record<string, SgoPlayer>;
  odds?: Record<string, SgoOdd>;
}

interface SgoEventsResponse {
  success: boolean;
  data: SgoEvent[];
}

// Only stats we've confirmed are actually populated on the free tier —
// see CLAUDE.md "Data sources". Anything else (e.g. receptions) is a
// defined stat in SportsGameOdds' taxonomy but wasn't live in testing.
const STAT_LABELS: Record<string, string> = {
  passing_yards: "Passing Yards",
  rushing_yards: "Rushing Yards",
  receiving_yards: "Receiving Yards",
  passing_touchdowns: "Passing TDs",
  passing_interceptions: "INTs Thrown",
  touchdowns: "Anytime TD",
  firstTouchdown: "First TD",
};

export interface PropLine {
  stat: string;
  line: number | null;
  overOdds: string | null;
  underOdds: string | null;
}

export async function GET() {
  const key = process.env.SPORTSGAMEODDS_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "SportsGameOdds is not configured" }, { status: 501 });
  }

  let res: Response;
  try {
    res = await fetch(
      "https://api.sportsgameodds.com/v2/events?leagueID=NFL&oddsAvailable=true&limit=20",
      {
        headers: { "x-api-key": key },
        next: { revalidate: 43200 }, // 12h — props don't need to be minute-fresh, and budget is tight
      }
    );
  } catch {
    return NextResponse.json({ error: "Couldn't reach SportsGameOdds" }, { status: 502 });
  }

  if (!res.ok) {
    return NextResponse.json({ error: `SportsGameOdds returned ${res.status}` }, { status: 502 });
  }

  const json = (await res.json()) as SgoEventsResponse;
  const props: Record<string, PropLine[]> = {};

  for (const ev of json.data ?? []) {
    const players = ev.players ?? {};
    const odds = ev.odds ?? {};
    for (const entry of Object.values(odds)) {
      const player = players[entry.statEntityID];
      const label = STAT_LABELS[entry.statID];
      if (!player || !label) continue;
      // Full-game line only — the same stat also comes in 1st/2nd half and
      // 1st quarter variants (same statID+player, different periodID), which
      // would otherwise collide under one label with no way to tell them apart.
      if (entry.periodID !== "game") continue;
      // One row per market: take the "over" (or "yes") side and pull its
      // counterpart via opposingOddID instead of iterating both sides.
      if (entry.sideID !== "over" && entry.sideID !== "yes") continue;

      const opposing = entry.opposingOddID ? odds[entry.opposingOddID] : undefined;
      const line: PropLine = {
        stat: label,
        line: entry.betTypeID === "ou" ? Number(entry.bookOverUnder ?? entry.fairOverUnder) : null,
        overOdds: entry.bookOdds ?? entry.fairOdds ?? null,
        underOdds: opposing ? opposing.bookOdds ?? opposing.fairOdds ?? null : null,
      };
      if (Number.isNaN(line.line)) line.line = null;

      (props[player.name] ??= []).push(line);
    }
  }

  return NextResponse.json({ props });
}
