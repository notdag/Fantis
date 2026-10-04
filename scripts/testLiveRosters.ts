// Live roster helpers (stale-roster guard + merge). Run: npx tsx scripts/testLiveRosters.ts
import { mergeLive, rosterChanged, type LiveRoster } from "../lib/liveRosters";

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

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
