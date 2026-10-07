// Tests for the FantasyCalc format mapping. Run: npx tsx scripts/testFantasyCalc.ts
import { DEFAULT_FORMAT, describeFormat, formatKey, leagueFormat, parseFormatKey, valuesQuery } from "../lib/fantasyCalcFormat";
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
const ok = (c: unknown, name: string, extra = "") => (c ? pass++ : (fail++, console.log(`  FAIL  ${name} ${extra}`)));

const lg = (rp: string[], scoring: Record<string, number>, inner: Record<string, unknown> = {}) => ({ roster_positions: rp, scoring_settings: scoring, settings: inner });
const STD = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN"];

ok(formatKey(DEFAULT_FORMAT) === "red-1qb-12t-1ppr-none", "default key");
ok(formatKey(leagueFormat(lg(STD, { rec: 1 }), 12)) === "red-1qb-12t-1ppr-none", "plain 12-team PPR redraft");
ok(leagueFormat(lg(STD, { rec: 0.5 }), 12).ppr === 0.5, "half PPR");
ok(leagueFormat(lg(STD, { rec: 0 }), 12).ppr === 0, "standard");
ok(leagueFormat(lg(STD, { rec: 0.25 }), 12).ppr === 0 || leagueFormat(lg(STD, { rec: 0.25 }), 12).ppr === 0.5, "odd rec snaps to a supported value");
ok(leagueFormat(lg([...STD, "SUPER_FLEX"], { rec: 1 }), 12).numQbs === 2, "superflex → 2 QBs");
ok(leagueFormat(lg(["QB", "QB", "RB", "WR"], { rec: 1 }), 12).numQbs === 2, "two QB slots → 2 QBs");
ok(leagueFormat(lg(STD, { rec: 1 }), 12).numQbs === 1, "one QB slot → 1 QB");
ok(leagueFormat(lg(STD, { rec: 1 }), 10).numTeams === 10 && leagueFormat(lg(STD, { rec: 1 }), 14).numTeams === 14, "10 and 14 team");
ok(leagueFormat(lg(STD, { rec: 1 }), 11).numTeams === 10 || leagueFormat(lg(STD, { rec: 1 }), 11).numTeams === 12, "11 teams snaps to a neighbour");
ok(leagueFormat(lg(STD, { rec: 1 }), 16).numTeams === 14, "16 teams → largest supported (14)");
ok(leagueFormat(lg(STD, { rec: 1 }), 6).numTeams === 8, "6 teams → smallest supported (8)");
ok(leagueFormat(lg(STD, { rec: 1 }), null).numTeams === 12, "unknown size → 12");
ok(leagueFormat(lg(STD, { rec: 1 }, { type: 2 }), 12).isDynasty === true, "Sleeper type 2 = dynasty");
ok(leagueFormat(lg(STD, { rec: 1 }, { type: 1 }), 12).isDynasty === false, "keeper is not dynasty");
ok(leagueFormat(lg(STD, { rec: 1, bonus_rec_te: 0.5 }), 12).tep === "te+", "TE premium 0.5 → te+");
ok(leagueFormat(lg(STD, { rec: 1, bonus_rec_te: 1 }), 12).tep === "te++", "TE premium 1 → te++");
ok(leagueFormat(lg(STD, { rec: 1 }), 12).tep === "none", "no premium");
ok(JSON.stringify(leagueFormat(null, undefined)) === JSON.stringify(DEFAULT_FORMAT), "missing settings → default, not a guess");
ok(JSON.stringify(leagueFormat("garbage", 12)) === JSON.stringify({ ...DEFAULT_FORMAT }), "garbage settings → default");

const f = leagueFormat(lg([...STD, "SUPER_FLEX"], { rec: 0.5, bonus_rec_te: 0.5 }, { type: 2 }), 14);
const k = formatKey(f);
ok(k === "dyn-2qb-14t-0.5ppr-te+", "composite key", k);
ok(JSON.stringify(parseFormatKey(k)) === JSON.stringify(f), "key round-trips");
ok(valuesQuery(f) === "isDynasty=true&numQbs=2&numTeams=14&ppr=0.5&tep=te%2B", "query string matches the documented parameters", valuesQuery(f));
ok(describeFormat(f).includes("dynasty") && describeFormat(f).includes("2QB"), "human description");

// nothing but a validated format can become a request
for (const bad of ["", "red-1qb-12t-1ppr-none; drop table", "../../players", "red-3qb-12t-1ppr-none", "red-1qb-9t-1ppr-none", "red-1qb-12t-2ppr-none", "red-1qb-12t-1ppr-x"]) {
  ok(parseFormatKey(bad) === null, `rejects malformed key "${bad}"`);
}

// static: the sync module only knows FantasyCalc's two documented endpoints
const src = readFileSync("lib/fantasyCalcSync.ts", "utf8").replace(/\/\/.*$/gm, "");
const paths = [...src.matchAll(/getJson\(\s*[`"']([^`"'?]+)/g)].map((m) => m[1]);
ok(paths.length === 2 && paths.includes("/players") && paths.includes("/values/current"), "sync calls only /players and /values/current", paths.join());
ok(!/api\.fantasycalc\.com\/(?!$)/.test(src.replace(/const BASE = "https:\/\/api\.fantasycalc\.com"/, "")), "no other FantasyCalc URL is hard-coded");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
