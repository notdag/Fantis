// Table (header row) rank import. Run: npx tsx scripts/testRankTable.ts
import { buildSleeperIndex, matchPastedList, matchTableRows, parseRankTable } from "../lib/rankingsHelpers";
import type { PlayerMap } from "../lib/types";

let pass = 0;
let fail = 0;
const ok = (c: unknown, name: string, extra = "") => (c ? pass++ : (fail++, console.log(`  FAIL  ${name} ${extra}`)));

const head = "Rank\tName\tTeam\tPosition\tTier\tExpert Rank (Flock Rank)\tMason Dodd Rank (Flock Mason Rank)";
const tsv = [
  head,
  "1\tJa'Marr Chase\tCIN\tWR\t1\t3\t2",
  "2\tBijan Robinson\tATL\tRB\tS\t1\t1",
  "3\tMike Williams\tNYJ\tWR\t4\t88\t",
  "4\tRoman Wilson\tPIT\tWR\t8\t#150\t160",
  "5\tNobody Fake\tXX\tWR\t3\t5\t5",
].join("\n");

const t = parseRankTable(tsv)!;
ok(!!t && t.rows.length === 5, "TSV with header parses");
ok(t.columns.rank && t.columns.team && t.columns.pos && t.columns.tier && t.columns.expert && t.columns.mason, "all 7 columns recognised");
ok(t.rows[0].rank === 1 && t.rows[0].expert === 3 && t.rows[0].mason === 2, "expert and mason map to the right columns (Mason header also contains 'Flock')", JSON.stringify(t.rows[0]));
ok(t.rows[1].tier === 1, "letter tier S → 1");
ok(t.rows[2].mason === undefined && t.rows[2].expert === 88, "blank cell → undefined, not 0");
ok(t.rows[3].expert === 150, "'#150' parses as 150");

const csv = 'Rank,Name,Team,Position,Tier,Expert Rank,Mason Rank\n1,"Smith, John",DAL,WR,2,9,10\n2,"Plain Name",KC,TE,3,12,13';
const c = parseRankTable(csv)!;
ok(c.rows.length === 2 && c.rows[0].name === "Smith, John" && c.rows[0].expert === 9, "CSV with quoted comma");

ok(parseRankTable("1. A B\n2. C D") === null, "no header → null (falls back to name-list parser)");
ok(parseRankTable("Rank,Team\n1,KC") === null, "header without Name → null");

const pmap: PlayerMap = {
  "1": { n: "Ja'Marr Chase", p: "WR", t: "CIN" },
  "2": { n: "Bijan Robinson", p: "RB", t: "ATL" },
  "3": { n: "Mike Williams", p: "WR", t: "NYJ" },
  "4": { n: "Mike Williams", p: "WR", t: "PIT" },
  "5": { n: "Roman Wilson", p: "WR", t: "PIT" },
  "6": { n: "Josh Allen", p: "QB", t: "BUF" },
  "7": { n: "Josh Allen", p: "TE", t: "KC" },
};
const index = buildSleeperIndex(pmap);
const board = [
  { name: "Ja'Marr Chase", pos: "WR", team: "CIN" },
  { name: "Bijan Robinson", pos: "RB", team: "ATL" },
];
const m = matchTableRows(t.rows, board, index);
ok(m[0].status === "board" && m[1].status === "board", "board rows match");
ok(m[2].status === "ambiguous", "two real Mike Williamses (both WR) stay ambiguous even with the position column");
ok(m[3].status === "add" && m[3].team === "PIT", "Roman Wilson found on Sleeper, not on board");
ok(m[4].status === "unmatched", "unknown name unmatched");

const josh = matchTableRows([{ name: "Josh Allen", pos: "QB" }, { name: "Josh Allen", pos: "TE" }], [], index);
ok(josh[0].status === "add" && josh[0].pos === "QB", "Position column disambiguates the QB Josh Allen");
ok(josh[1].status === "add" && josh[1].pos === "TE", "…and the TE one");
ok(matchTableRows([{ name: "Josh Allen" }], [], index)[0].status === "ambiguous", "without a Position column the same name is ambiguous");
ok(matchTableRows([{ name: "Josh Allen", pos: "RB" }], [], index)[0].status === "unmatched", "a position that contradicts every candidate is reported, not forced");
ok(matchTableRows([{ name: "Ja'Marr Chase" }, { name: "ja'marr chase" }], board, index)[1].status === "unmatched", "duplicate row reported");

// ── hardening: what spreadsheets really export ──
const bom = "﻿" + csv.replace(/,/g, ";");
const bt = parseRankTable(bom)!;
ok(!!bt && bt.rows.length === 2 && bt.columns.expert, "BOM + semicolon delimiter parses");
const titled = "Flock Rankings export\nupdated Oct 2\n" + tsv;
const tt = parseRankTable(titled)!;
ok(!!tt && tt.rows.length === 5 && tt.columns.mason, "title lines above the header are skipped");
ok(parseRankTable("﻿Name,Team\nA B,KC") === null, "Name+Team only (no rank/tier/expert column) is not treated as a rank table");

// ── first-name variants (Kenneth → Kenny) ──
const pm2: PlayerMap = {
  "11": { n: "Kenny Gainwell", p: "RB", t: "TB" },
  "12": { n: "Michael Pittman Jr.", p: "WR", t: "IND" },
  "13": { n: "Josh Allen", p: "QB", t: "BUF" },
  "14": { n: "Joshua Allen", p: "TE", t: "KC" },
};
const ix2 = buildSleeperIndex(pm2);
const b2 = [{ name: "Kenny Gainwell", pos: "RB", team: "TB" }];
const g = matchTableRows([{ name: "Kenneth Gainwell", pos: "RB", expert: 40 }], b2, ix2)[0];
ok(g.status === "board" && g.name === "Kenny Gainwell" && g.fuzzy === true, "Kenneth Gainwell → board Kenny Gainwell", JSON.stringify(g));
const g2 = matchTableRows([{ name: "Kenneth Gainwell" }], [], ix2)[0];
ok(g2.status === "add" && g2.name === "Kenny Gainwell" && g2.fuzzy === true, "…and from Sleeper when not on the board");
const mp = matchTableRows([{ name: "Mike Pittman", pos: "WR" }], [], ix2)[0];
ok(mp.status === "add" && mp.name === "Michael Pittman Jr.", "Mike Pittman → Michael Pittman Jr.");
const ja = matchTableRows([{ name: "Josh Allen" }], [], ix2)[0];
ok(ja.status === "add" && ja.pos === "QB", "an exact name match wins over the variant fallback (Josh Allen → the QB, not Joshua Allen the TE)", JSON.stringify(ja));
const ja2 = matchTableRows([{ name: "Joshua Allen", pos: "QB" }], [], ix2)[0];
ok(ja2.status === "add" && ja2.pos === "QB", "variant + Position picks the right namesake", JSON.stringify(ja2));
const gl = matchPastedList("1. Kenneth Gainwell", b2, ix2)[0];
ok(gl.status === "board" && gl.fuzzy, "plain list gets the same variant fallback");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
