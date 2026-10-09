// League Manager selection model. Run: npx tsx scripts/testLeagueSelection.ts
import { addAll, filterState, parseStored, prune, removeAll, selectionCounts, toggle } from "../lib/leagueSelection";

let pass = 0;
let fail = 0;
const ok = (c: unknown, name: string, extra = "") => (c ? pass++ : (fail++, console.log(`  FAIL  ${name} ${extra}`)));

const all = Array.from({ length: 250 }, (_, i) => `L${i}`); // more leagues than one page
const filtered = all.filter((_, i) => i % 2 === 0); // a filter matching 125 leagues

// individual selection
let s = toggle(new Set(), "L1");
ok(s.has("L1") && s.size === 1, "toggle selects one league");
s = toggle(s, "L1");
ok(s.size === 0, "toggle again deselects it");

// select all filtered — beyond any visible page
s = addAll(new Set(["L1"]), filtered);
ok(s.size === 126, "select-all-filtered adds every filtered league (125), not just a page, and keeps earlier picks", String(s.size));
ok(filterState(s, filtered) === "all", "header checkbox reads 'all' for the filter");

// filter change keeps the selection; counts say how many are hidden
const other = all.filter((_, i) => i < 10);
const c = selectionCounts(s, other);
ok(c.total === 126 && c.inFilter === 6 && c.hidden === 120, "a different filter never drops selected leagues; hidden ones are counted", JSON.stringify(c));
ok(filterState(s, other) === "some", "partially selected filter reads 'some'");
ok(filterState(new Set(), other) === "none" && filterState(s, []) === "none", "'none' for nothing selected or an empty filter");

// clear only the filtered ones
s = removeAll(s, filtered);
ok(s.size === 1 && s.has("L1"), "clearing the filtered leagues leaves selections outside the filter alone");

// persistence: parse / prune
ok(parseStored(JSON.stringify(["L1", "L2"])).size === 2, "stored selection round-trips");
ok(parseStored("not json").size === 0 && parseStored(null).size === 0 && parseStored('{"a":1}').size === 0, "bad storage → empty, never throws");
ok(parseStored(JSON.stringify(["L1", 5, "", "x".repeat(99)])).size === 1, "junk entries dropped");
ok([...prune(new Set(["L1", "GONE"]), all)].join() === "L1", "leagues that no longer exist drop out");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
