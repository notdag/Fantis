// Tests for the /admin tier board's helpers. Run: npx tsx scripts/testRankingsHelpers.ts
import {
  buildSleeperIndex,
  findTeamDrift,
  findUnranked,
  injurySeverity,
  sortByAdp,
  pushSnapshot,
  parseHistory,
  HISTORY_LIMIT,
  isInjured,
} from "../lib/rankingsHelpers";
import type { PlayerMap } from "../lib/types";

let pass = 0;
let fail = 0;
const ok = (c: unknown, name: string, extra = "") => (c ? pass++ : (fail++, console.log(`  FAIL  ${name} ${extra}`)));

const pmap: PlayerMap = {
  "1": { n: "Ranked Guy", p: "WR", t: "SF", inj: null },
  "2": { n: "Hurt Back", p: "RB", t: "DAL", inj: "Out" },
  "3": { n: "Deep Reserve", p: "WR", t: "NYJ", inj: "IR" },
  "4": { n: "Healthy Unranked", p: "TE", t: "KC", inj: null },
  "5": { n: "Cut Guy", p: "RB", t: "", inj: "Out" }, // no team: released
  "6": { n: "Some Kicker", p: "K", t: "BUF", inj: "Out" }, // not rankable
  "7": { n: "Doubtful Dan Jr.", p: "WR", t: "LAR", inj: "Doubtful" },
  "8": { n: "Nobody Owns", p: "QB", t: "CHI", inj: "Out" }, // zero exposure
  // Two Sleeper entries sharing a name+position: the inactive one has no team.
  "9": { n: "Lamar Jackson", p: "QB", t: "BAL", inj: "Questionable" },
  "10": { n: "Lamar Jackson", p: "QB", t: "", inj: null },
};

const board = [
  { name: "Ranked Guy", pos: "WR", team: "SF" },
  { name: "Traded Guy", pos: "RB", team: "MIA" },
  { name: "Lamar Jackson", pos: "QB", team: "BAL" },
];

// ── isInjured / severity ──
ok(isInjured("Out") && isInjured("IR") && isInjured("Questionable"), "injured statuses recognised");
ok(!isInjured(null) && !isInjured("Sus") && !isInjured("Active"), "suspension / null / junk is not injured");
ok(injurySeverity("IR") < injurySeverity("Out") && injurySeverity("Out") < injurySeverity("Questionable"), "IR worse than Out worse than Q");
ok(injurySeverity(null) > injurySeverity("Questionable"), "healthy sorts after every injury");

// ── findUnranked ──
const exposure: Record<string, number> = { "1": 30, "2": 12, "3": 1, "4": 5, "5": 9, "6": 7, "7": 3, "8": 0, "9": 20 };
const un = findUnranked(pmap, board, exposure);
const ids = un.map((u) => u.id);
ok(!ids.includes("1"), "already-ranked player is excluded");
ok(!ids.includes("9"), "already-ranked (namesake entry) excluded by name");
ok(ids.includes("2") && ids.includes("3") && ids.includes("4"), "unranked rostered players are included");
ok(!ids.includes("5"), "player with no NFL team is excluded");
ok(!ids.includes("6"), "non-QB/RB/WR/TE position is excluded");
ok(!ids.includes("8"), "zero-exposure player is excluded");
ok(ids.includes("7"), "suffix player (Jr.) is included when unranked");
ok(un[0].id === "2" && un[1].id === "4", "sorted by most leagues first", JSON.stringify(ids));
ok(findUnranked(pmap, board, exposure, 5).every((u) => u.leagues >= 5), "minLeagues threshold applies");
ok(
  findUnranked(pmap, [{ name: "Doubtful Dan", pos: "WR", team: "LAR" }], exposure).every((u) => u.id !== "7"),
  "board name without the suffix still matches Sleeper's suffixed name"
);
const inj = un.filter((u) => isInjured(u.inj));
ok(inj.length === 3 && inj.every((u) => ["2", "3", "7"].includes(u.id)), "injured subset is exactly the hurt unranked rostered players");

// ── buildSleeperIndex ──
const index = buildSleeperIndex(pmap);
ok(index.lookup({ name: "Lamar Jackson", pos: "QB" })?.id === "9", "namesake lookup prefers the player who has a team");
ok(index.lookup({ name: "Doubtful Dan", pos: "WR" })?.id === "7", "suffix-stripped fallback lookup");
ok(index.lookup({ name: "Nope", pos: "WR" }) === null, "unknown player → null");
ok(index.lookup({ name: "Hurt Back", pos: "WR" }) === null, "position is part of the key");

// ── findTeamDrift ──
const drift = findTeamDrift(index, [
  { name: "Ranked Guy", pos: "WR", team: "SF" }, // same
  { name: "Hurt Back", pos: "RB", team: "MIA" }, // traded to DAL
  { name: "Cut Guy", pos: "RB", team: "DEN" }, // released
  { name: "Not In Sleeper", pos: "WR", team: "SF" }, // unknown → never flagged
  { name: "Healthy Unranked", pos: "TE", team: "kc" }, // case-insensitive match
]);
ok(drift.length === 2, "only real mismatches are reported", JSON.stringify(drift));
ok(drift.some((d) => d.name === "Hurt Back" && d.from === "MIA" && d.to === "DAL"), "trade detected");
ok(drift.some((d) => d.name === "Cut Guy" && d.to === ""), "release reported with empty team");

// ── sortByAdp ──
const adp: Record<string, number> = { A: 30, B: 5, C: 12 };
const sorted = sortByAdp([{ name: "A" }, { name: "X" }, { name: "B" }, { name: "Y" }, { name: "C" }], (p) => adp[p.name]);
ok(sorted.map((p) => p.name).join("") === "BCAXY", "ADP ascending; unranked keep relative order at the end", sorted.map((p) => p.name).join(""));
ok(sortByAdp([{ name: "P" }, { name: "Q" }], () => 7).map((p) => p.name).join("") === "PQ", "ties are stable");

// ── history ──
const snap = (n: number) => ({ at: new Date(n).toISOString(), players: [{ name: "P" + n, pos: "WR", team: "SF", tier: 1 }] });
let h = pushSnapshot([], snap(1));
h = pushSnapshot(h, snap(2));
ok(h.length === 2 && h[0].players[0].name === "P2", "newest first");
ok(pushSnapshot(h, { ...snap(2), at: "later" }).length === 2, "identical-to-newest snapshot is skipped");
ok(pushSnapshot(h, { at: "x", players: [] }).length === 2, "empty snapshot ignored");
let big = [] as ReturnType<typeof pushSnapshot>;
for (let i = 0; i < HISTORY_LIMIT + 5; i++) big = pushSnapshot(big, snap(i));
ok(big.length === HISTORY_LIMIT && big[0].players[0].name === "P" + (HISTORY_LIMIT + 4), "capped at the limit, newest kept");
ok(parseHistory(JSON.stringify(h)).length === 2, "round-trips");
ok(parseHistory("not json").length === 0 && parseHistory(null).length === 0 && parseHistory("{}").length === 0, "garbage parses to empty");
ok(parseHistory(JSON.stringify([{ at: 1 }, snap(3)])).length === 1, "malformed entries are dropped");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
