// Client for our own /api/player-props proxy — never talks to
// SportsGameOdds directly, so the API key stays server-side. See
// app/api/player-props/route.ts.

export interface PropLine {
  stat: string;
  line: number | null;
  overOdds: string | null;
  underOdds: string | null;
}

export async function getPlayerProps(): Promise<Record<string, PropLine[]>> {
  const res = await fetch("/api/player-props");
  if (!res.ok) throw new Error(`${res.status}`);
  const json = (await res.json()) as { props: Record<string, PropLine[]> };
  return json.props ?? {};
}
