// Client for our own /api/mvp-odds proxy — never talks to SharpAPI directly,
// so the API key stays server-side. See app/api/mvp-odds/route.ts.

export interface MvpOddsEntry {
  american: number;
  probability: number;
  sportsbook: string;
}

export async function getMvpOdds(): Promise<Record<string, MvpOddsEntry>> {
  const res = await fetch("/api/mvp-odds");
  if (!res.ok) throw new Error(`${res.status}`);
  const json = (await res.json()) as { odds: Record<string, MvpOddsEntry> };
  return json.odds ?? {};
}
