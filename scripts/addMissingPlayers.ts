// Additive top-up for lib/players.data.ts: finds real players inside a
// "top 300 by real Sleeper ADP" pool — roughly the depth of a real 12-team
// mock draft — who aren't in the curated list yet, and appends them at the
// bottom (tier G) without touching anything already curated. Unlike
// regenPlayers.ts, this never overwrites existing tiers/order; it's safe to
// run after manual tier-board edits. Run with `npm run add-missing-players`.
//
// Deliberately ADP-based, not points-based like regenPlayers.ts's core
// selection: ADP is "who actually gets drafted," which is what a top-up
// should mean. Checked directly against real data before writing this: a
// naive top-300-by-ADP skews TE-heavy (68 of the top 300, vs. ~30 TEs that
// actually have real single-TE-league relevance) because Sleeper's ADP
// blends every league format on their platform (deep bench, TE-premium,
// dynasty), not just standard redraft — confirmed the first time this ran,
// which is why TE gets its own cap below instead of riding the shared
// 300-player pool size like QB/RB/WR do.
import { getPlayers, getSeasonProjectionTotals, isRankedAdp, SEASONS } from "../lib/sleeper";
import { generatePlayersData } from "../lib/generatePlayersData";
import { RAW } from "../lib/players.data";
import fs from "fs";
import path from "path";

const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
const POOL_SIZE = 300;
// Total curated count per position after adding — not an "add up to N more"
// budget. TE is capped tighter than the shared ADP pool would produce on
// its own (see note above); the rest just ride the 300-player pool as-is.
const MAX_TOTAL: Record<(typeof POSITIONS)[number], number> = {
  QB: Infinity,
  RB: Infinity,
  WR: Infinity,
  TE: 30,
};

async function main() {
  const pmap = await getPlayers();
  const totals = await getSeasonProjectionTotals(SEASONS[0]);

  // Sleeper's projections endpoint (not the season-totals one) carries ADP —
  // fetch week 1 directly for it, same field regenPlayers.ts's caller uses
  // elsewhere in the app via getProjections().
  const week1 = await fetch(
    `https://api.sleeper.app/v1/projections/nfl/regular/${SEASONS[0]}/1`
  ).then((r) => r.json() as Promise<Record<string, { adp_dd_ppr?: number } | null>>);

  type Row = { name: string; pos: string; team: string; adp: number };
  const pool: Row[] = [];
  for (const id in pmap) {
    const p = pmap[id];
    if (!p || !p.t) continue; // exclude free agents / no current roster
    if (!POSITIONS.includes(p.p as (typeof POSITIONS)[number])) continue;
    const adp = week1[id]?.adp_dd_ppr;
    if (!isRankedAdp(adp)) continue;
    if ((totals[id]?.pts ?? 0) <= 0) continue; // must have a real season projection too
    pool.push({ name: p.n, pos: p.p, team: p.t, adp });
  }
  pool.sort((a, b) => a.adp - b.adp);
  const top300 = pool.slice(0, POOL_SIZE);

  const existing = new Set(RAW.map(([name, pos]) => `${name}|${pos}`));
  const maxPosRank: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const [, pos, , , posRank] of RAW) {
    if (posRank > (maxPosRank[pos] ?? 0)) maxPosRank[pos] = posRank;
  }

  const additions: { name: string; pos: string; team: string; tier: number; posRank: number }[] = [];
  for (const r of top300) {
    const key = `${r.name}|${r.pos}`;
    if (existing.has(key)) continue;
    const cap = MAX_TOTAL[r.pos as (typeof POSITIONS)[number]];
    if ((maxPosRank[r.pos] ?? 0) >= cap) continue;
    maxPosRank[r.pos] = (maxPosRank[r.pos] ?? 0) + 1;
    additions.push({ name: r.name, pos: r.pos, team: r.team, tier: 8, posRank: maxPosRank[r.pos] });
  }

  if (additions.length === 0) {
    console.log("Nothing to add — every top-300-ADP player is already in the curated list.");
    return;
  }

  const combined = [
    ...RAW.map(([name, pos, team, tier, posRank]) => ({ name, pos, team, tier, posRank })),
    ...additions,
  ];

  const outPath = path.join(__dirname, "..", "lib", "players.data.ts");
  fs.writeFileSync(outPath, generatePlayersData(combined));

  for (const pos of POSITIONS) {
    console.log(pos, additions.filter((a) => a.pos === pos).length, "added");
  }
  console.log("Total added:", additions.length, "| new list size:", combined.length);
}

main();
