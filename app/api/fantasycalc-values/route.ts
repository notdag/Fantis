import { NextResponse } from "next/server";

// Server-side proxy for FantasyCalc's public player-value endpoint —
// see Portfolio's "FC power rank" (lib/usePortfolio.ts), added at the
// user's explicit request to incorporate fantasycalc.com. Unlike
// SharpAPI/SportsGameOdds this needs no key (it's a genuinely public,
// unauthenticated endpoint used by the wider fantasy-tool community), but
// it's still routed server-side rather than called directly like Sleeper,
// both to sidestep any CORS restriction on their end and to cache — their
// values update at most a few times a day, so hourly polling from every
// visitor would be discourteous for a free, keyless endpoint.
//
// One fixed settings snapshot (redraft, 1 QB, PPR, 12-team) is used for
// every league regardless of that league's actual settings — Portfolio
// aggregates across many leagues with different formats at once, and
// FantasyCalc's own value set doesn't vary continuously enough by team
// count to justify a per-league fetch. This is a real, sourced number,
// just not custom-fit to each league's exact settings.

interface FantasyCalcEntry {
  player: {
    name: string;
    position: string;
  };
  value: number;
}

export interface FantasyCalcValue {
  name: string;
  pos: string;
  value: number;
}

export async function GET() {
  let res: Response;
  try {
    res = await fetch(
      "https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=12&ppr=1",
      { next: { revalidate: 43200 } } // 12h — see note above on polling courtesy
    );
  } catch {
    return NextResponse.json({ error: "Couldn't reach FantasyCalc" }, { status: 502 });
  }

  if (!res.ok) {
    return NextResponse.json({ error: `FantasyCalc returned ${res.status}` }, { status: 502 });
  }

  const json = (await res.json()) as FantasyCalcEntry[];
  const values: FantasyCalcValue[] = json
    .filter((e) => e.player?.name && e.player?.position)
    .map((e) => ({ name: e.player.name, pos: e.player.position, value: e.value }));

  return NextResponse.json({ values });
}
