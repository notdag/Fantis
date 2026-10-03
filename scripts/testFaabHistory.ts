// Tests for FAAB bid suggestions. Run: npx tsx scripts/testFaabHistory.ts
import { computeFaabStats, suggestBid, type FaabTxnRow } from "../lib/faabHistory";

let pass = 0;
let fail = 0;
const ok = (c: unknown, name: string, extra = "") => (c ? pass++ : (fail++, console.log(`  FAIL  ${name} ${extra}`)));

const row = (leagueId: string, bid: number | null, pos: string | null): FaabTxnRow => ({
  leagueId,
  waiverBid: bid,
  adds: pos ? [{ playerId: "x", playerName: "X", pos, rosterId: 1, teamName: "T" }] : null,
});

// ---------------------------------------------------------------- computeFaabStats
{
  const rows: FaabTxnRow[] = [row("1", 10, "WR"), row("1", 20, "WR"), row("1", 30, "WR"), row("1", 5, "RB"), row("2", 50, "WR")];
  const stats = computeFaabStats(rows);
  ok(stats["1"]?.WR.median === 20 && stats["1"]?.WR.n === 3, "median of 3 real bids", JSON.stringify(stats["1"]?.WR));
  ok(stats["1"]?.RB.median === 5 && stats["1"]?.RB.n === 1, "single bid is its own median");
  ok(stats["2"]?.WR.median === 50, "leagues are kept separate");
  ok(stats["1"]?.WR.p75 >= stats["1"]?.WR.median, "p75 is never below the median");
}

// null/missing bids and adds are ignored, never treated as a $0 bid
{
  const rows: FaabTxnRow[] = [row("1", null, "WR"), row("1", 10, null), row("1", 0, "WR")];
  const stats = computeFaabStats(rows);
  ok(stats["1"]?.WR.n === 1 && stats["1"].WR.median === 0, "a real $0 winning bid is kept, but null bid/position rows are dropped", JSON.stringify(stats));
}

// negative bids (shouldn't exist, but never trusted if they somehow appear)
{
  const stats = computeFaabStats([row("1", -5, "WR"), row("1", 10, "WR")]);
  ok(stats["1"]?.WR.n === 1, "a negative bid is never counted");
}

// a claim with multiple adds credits its bid to each position
{
  const multi: FaabTxnRow = { leagueId: "1", waiverBid: 40, adds: [{ playerId: "a", pos: "RB" }, { playerId: "b", pos: "TE" }] };
  const stats = computeFaabStats([multi]);
  ok(stats["1"]?.RB.n === 1 && stats["1"]?.TE.n === 1 && stats["1"].RB.median === 40 && stats["1"].TE.median === 40, "a multi-add claim's bid applies to every position in it");
}

// empty input never throws
{
  ok(Object.keys(computeFaabStats([])).length === 0, "no rows -> no stats, no crash");
}

// ---------------------------------------------------------------------- suggestBid
{
  const stats = computeFaabStats([row("1", 10, "WR"), row("1", 20, "WR"), row("1", 30, "WR")]);
  const s = suggestBid(stats, "1", "WR", 0, 0);
  ok(s.sourced && s.n === 3 && s.bid === stats["1"].WR.p75, "3+ real bids -> uses the p75 number, flagged as sourced");
}
{
  const stats = computeFaabStats([row("1", 12, "WR")]);
  const s = suggestBid(stats, "1", "WR", 0, 0);
  ok(s.sourced && s.n === 1 && s.bid === 12, "only 1-2 real bids -> uses the median (not the thin p75 tail)");
}
{
  const s = suggestBid(null, "1", "WR", 5, 5);
  ok(!s.sourced && s.bid === 5 && s.n === 0, "no history at all -> falls back to the caller's default, marked not sourced");
}
{
  const stats = computeFaabStats([row("1", 2, "WR")]);
  const s = suggestBid(stats, "1", "WR", 15, 0);
  ok(s.bid === 15, "suggestion never drops below the league's own bid minimum");
}
{
  const stats = computeFaabStats([row("1", 10, "WR")]);
  const s = suggestBid(stats, "1", "RB", 0, 7); // different position, no data
  ok(!s.sourced && s.bid === 7, "a position with no history for this league falls back, even if another position has data");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
