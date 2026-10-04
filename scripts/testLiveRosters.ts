// Live roster helpers (stale-roster guard + merge). Run: npx tsx scripts/testLiveRosters.ts
import { MSG_CHANGED, MSG_UNREADABLE, mergeLive, preflightRosters, rosterChanged, type LiveRoster } from "../lib/liveRosters";

let pass = 0;
let fail = 0;
const ok = (c: unknown, name: string, extra = "") => (c ? pass++ : (fail++, console.log(`  FAIL  ${name} ${extra}`)));

const base: LiveRoster = { starters: ["a", "b", "0"], players: ["a", "b", "c", "d"], reserve: ["e"] };
const clone = (r: LiveRoster): LiveRoster => ({ starters: [...r.starters], players: [...r.players], reserve: [...r.reserve] });

ok(!rosterChanged(base, clone(base)), "identical rosters are not 'changed'");
ok(!rosterChanged(base, { ...clone(base), players: ["d", "c", "b", "a"] }), "player order doesn't matter (set comparison)");
ok(rosterChanged(base, { ...clone(base), players: ["a", "b", "c"] }), "a dropped player is a change");
ok(rosterChanged(base, { ...clone(base), players: ["a", "b", "c", "d", "z"] }), "an added player is a change");
ok(rosterChanged(base, { ...clone(base), reserve: [] }), "an IR move is a change");
ok(rosterChanged(base, { ...clone(base), starters: ["b", "a", "0"] }), "swapping two starters' slots is a change");
ok(rosterChanged(base, { ...clone(base), starters: ["a", "b", "c"] }), "filling the empty slot is a change");
ok(!rosterChanged(base, { ...clone(base), starters: ["a", "b", ""] }), "'' and '0' both mean an empty slot");
ok(!rosterChanged({ ...base, starters: ["a", "b"] }, { ...base, starters: ["a", "b", "0"] }), "a trailing empty slot isn't a change");

const items = [
  { league: { id: "1" }, roster: { starters: ["x"], players: ["x"], reserve: [], extra: 1 } },
  { league: { id: "2" }, roster: null },
  { league: { id: "3" }, roster: { starters: ["old"], players: ["old"], reserve: [], extra: 3 } },
];
const merged = mergeLive(items, { "1": { starters: ["n"], players: ["n", "m"], reserve: ["r"] }, "2": { starters: ["n"], players: ["n"], reserve: [] } });
ok(merged[0].roster?.starters[0] === "n" && merged[0].roster?.players.length === 2 && merged[0].roster?.reserve[0] === "r" && merged[0].roster?.extra === 1, "live roster overlays the stored one and keeps its other fields");
ok(merged[1].roster === null, "a league with no stored roster is left alone");
ok(merged[2].roster?.starters[0] === "old", "a league with no live read keeps the stored roster (never dropped)");
ok(items[0].roster?.starters[0] === "x", "the input is not mutated");

// ── ignoreStarters (adds, IR moves, future-week lineups don't depend on the current lineup) ──
ok(!rosterChanged(base, { ...clone(base), starters: ["b", "a", "0"] }, { ignoreStarters: true }), "ignoreStarters: a lineup edit alone is not a change");
ok(rosterChanged(base, { ...clone(base), players: ["a", "b", "c"] }, { ignoreStarters: true }), "ignoreStarters: a dropped player still is");
ok(rosterChanged(base, { ...clone(base), reserve: [] }, { ignoreStarters: true }), "ignoreStarters: an IR change still is");

// ── pre-flight: one check per league, decided before anything is sent ──
const fresh = (over: Partial<LiveRoster> = {}): LiveRoster => ({ ...clone(base), allRostered: ["a", "b", "c", "d", "e", "x"], ...over });
const stores: Record<string, LiveRoster | "throw" | null> = {
  same: fresh(),
  dropped: fresh({ players: ["a", "b", "c"] }),
  lineupOnly: fresh({ starters: ["b", "a", "0"] }),
  gone: null,
  boom: "throw",
};
let calls = 0;
const fetcher = async (leagueId: string) => {
  calls++;
  const v = stores[leagueId];
  if (v === "throw") throw new Error("503");
  return v ?? null;
};
const row = (leagueId: string, strictStarters: boolean) => ({ leagueId, rosterId: 1, base, strictStarters });
async function main() {
  const pf = await preflightRosters(
    [row("same", true), row("dropped", false), row("lineupOnly", false), row("lineupOnly@strict", true), row("gone", false), row("boom", false)].map((r) =>
      r.leagueId === "lineupOnly@strict" ? { ...r, leagueId: "lineupOnly" } : r
    ),
    { fetcher }
  );
  ok(pf.same.blocked === undefined && !!pf.same.fresh, "unchanged roster → clear to send, fresh copy returned");
  ok(pf.dropped.blocked === MSG_CHANGED, "a dropped player blocks the league with the changed message");
  ok(pf.lineupOnly.blocked === MSG_CHANGED, "same league needs the CURRENT lineup (strict) and the lineup changed → blocked");
  ok(pf.gone.blocked === MSG_UNREADABLE, "a roster that can't be found blocks (never assumed fine)");
  ok(pf.boom.blocked === MSG_UNREADABLE, "a read that keeps failing blocks (never assumed fine)");
  ok(calls === 5, "one read per LEAGUE, not per row (6 rows over 5 leagues)", String(calls));
  const pf2 = await preflightRosters([row("lineupOnly", false)], { fetcher });
  ok(pf2.lineupOnly.blocked === undefined, "a lineup-only edit does NOT block an add / non-lineup change");
  ok(pf2.lineupOnly.fresh?.allRostered?.includes("x") === true, "everyone-rostered set is passed through for availability checks");
  const pf3 = await preflightRosters([{ leagueId: "dropped", rosterId: 1, base: null, strictStarters: false }], { fetcher });
  ok(pf3.dropped.blocked === undefined, "no base to compare with → only readability is checked");

  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main();
