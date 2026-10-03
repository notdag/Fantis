// Paste-in rank list matching. Run: npx tsx scripts/testRankImport.ts
import { buildSleeperIndex, looseKey, matchPastedList, parsePastedLines } from "../lib/rankingsHelpers";
import type { PlayerMap } from "../lib/types";

let pass = 0;
let fail = 0;
const ok = (c: unknown, name: string, extra = "") => (c ? pass++ : (fail++, console.log(`  FAIL  ${name} ${extra}`)));

const pmap: PlayerMap = {
  "1": { n: "Ja'Marr Chase", p: "WR", t: "CIN" },
  "2": { n: "Amon-Ra St. Brown", p: "WR", t: "DET" },
  "3": { n: "Brian Thomas Jr.", p: "WR", t: "JAX" },
  "4": { n: "Roman Wilson", p: "WR", t: "PIT" },
  "5": { n: "Josh Allen", p: "QB", t: "BUF" },
  "6": { n: "Josh Allen", p: "LB", t: "JAX" }, // not rankable → ignored
  "7": { n: "Mike Williams", p: "WR", t: "PIT" },
  "8": { n: "Mike Williams", p: "WR", t: "NYJ" }, // real namesake collision
  "9": { n: "Retired Guy", p: "RB", t: "" }, // no team → ignored
};
const index = buildSleeperIndex(pmap);
const board = [
  { name: "Ja'Marr Chase", pos: "WR", team: "CIN" },
  { name: "Amon-Ra St. Brown", pos: "WR", team: "DET" },
  { name: "Brian Thomas Jr.", pos: "WR", team: "JAX" },
];

ok(looseKey("Amon-Ra St. Brown") === looseKey("amon ra st brown"), "punctuation/case insensitive");
ok(looseKey("Brian Thomas Jr.") === looseKey("Brian Thomas"), "suffix insensitive");
ok(looseKey("Ja'Marr Chase") === looseKey("JaMarr Chase"), "apostrophe insensitive");

ok(parsePastedLines("Tier 1\n\n1. A B\n---\n2. C D\n").length === 2, "skips blank/tier/separator lines");

const text = [
  "1. Ja'Marr Chase",
  "2) Amon Ra St Brown WR DET", // trailing pos/team + no punctuation
  "#3 Brian Thomas",
  "4 - Roman Wilson", // not on board → add
  "5,Josh Allen,QB,BUF", // CSV
  "Mike Williams", // namesake collision
  "Nobody McFake", // unknown
  "Ja'Marr Chase", // duplicate
].join("\n");
const m = matchPastedList(text, board, index);
ok(m.length === 8, "one result per line", String(m.length));
ok(m[0].status === "board" && m[0].name === "Ja'Marr Chase", "numbered '1.' line matches board");
ok(m[1].status === "board" && m[1].name === "Amon-Ra St. Brown", "'2)' + trailing WR DET + loose punctuation matches");
ok(m[2].status === "board" && m[2].name === "Brian Thomas Jr.", "'#3' + missing suffix matches board name");
ok(m[3].status === "add" && m[3].name === "Roman Wilson" && m[3].team === "PIT", "unlisted-on-board player resolves from Sleeper");
ok(m[4].status === "add" && m[4].name === "Josh Allen" && m[4].pos === "QB", "CSV row; the non-rankable LB namesake is ignored");
ok(m[5].status === "ambiguous" && /WR PIT/.test(m[5].note ?? "") && /WR NYJ/.test(m[5].note ?? ""), "real namesakes are flagged, never guessed");
ok(m[6].status === "unmatched", "unknown name is unmatched");
ok(m[7].status === "unmatched" && /duplicate/.test(m[7].note ?? ""), "duplicate line is reported, first placement kept");
ok(matchPastedList("Retired Guy", board, index)[0].status === "unmatched", "player with no NFL team is not addable");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
