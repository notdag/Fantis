// Regenerates lib/players.data.ts from real Sleeper data: top N per
// position (QB/RB/WR/TE) by season PPR point projection, tiered by
// quantile within each position's own pool. Run with `npm run regen-players`.
//
// This OVERWRITES the whole curated list, including any manual tier moves
// made via the /admin tier board — it's a "start fresh from real data"
// tool, not an incremental merge. Re-run it when the pool feels stale
// (new season, a rookie class landing on rosters, a wave of trades/
// signings) rather than hand-adding missing players one at a time.
//
// Position caps aren't uniform: real season-point projections cliff off
// much faster for QB/TE than RB/WR (checked directly against Sleeper's
// data — QB and TE both crater to bye-week-streamer-level points around
// rank ~35-40, while RB/WR still carry real signal out past 80). A flat
// "top 80 everywhere" would pull in noise like 3rd-string QBs and
// camp-body TEs that happen to have a token nonzero projection.
import { getPlayers, getSeasonProjectionTotals, SEASONS } from "../lib/sleeper";
import { generatePlayersData } from "../lib/generatePlayersData";
import fs from "fs";
import path from "path";

const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
const TOP_N: Record<(typeof POSITIONS)[number], number> = { QB: 40, RB: 80, WR: 80, TE: 40 };
const TIER_COUNT = 8;

async function main() {
  const pmap = await getPlayers();
  const totals = await getSeasonProjectionTotals(SEASONS[0]);

  type Row = { name: string; pos: string; team: string; pts: number };
  const byPos: Record<string, Row[]> = { QB: [], RB: [], WR: [], TE: [] };

  for (const id in pmap) {
    const p = pmap[id];
    if (!POSITIONS.includes(p.p as (typeof POSITIONS)[number])) continue;
    if (!p.t) continue; // exclude free agents / no current NFL roster
    const pts = totals[id]?.pts ?? 0;
    if (pts <= 0) continue;
    byPos[p.p].push({ name: p.n, pos: p.p, team: p.t, pts });
  }

  const out: { name: string; pos: string; team: string; tier: number; posRank: number }[] = [];

  for (const pos of POSITIONS) {
    const sorted = byPos[pos].sort((a, b) => b.pts - a.pts).slice(0, TOP_N[pos]);
    sorted.forEach((r, i) => {
      const tier = Math.min(TIER_COUNT, Math.floor((i / sorted.length) * TIER_COUNT) + 1);
      out.push({ name: r.name, pos: r.pos, team: r.team, tier, posRank: i + 1 });
    });
  }

  // Master order: tier major (file reads top-to-bottom by quality),
  // position minor, points-descending within each — this also keeps each
  // position's entries in strictly descending point order across the
  // whole file, which is what makes posRank (computed from order alone)
  // come out correct.
  out.sort(
    (a, b) =>
      a.tier - b.tier ||
      POSITIONS.indexOf(a.pos as (typeof POSITIONS)[number]) -
        POSITIONS.indexOf(b.pos as (typeof POSITIONS)[number]) ||
      a.posRank - b.posRank
  );

  const outPath = path.join(__dirname, "..", "lib", "players.data.ts");
  fs.writeFileSync(outPath, generatePlayersData(out));

  for (const pos of POSITIONS) {
    console.log(pos, out.filter((r) => r.pos === pos).length);
  }
  console.log("Total:", out.length);
}

main();
