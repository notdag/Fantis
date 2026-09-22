// Phase 1 acceptance tests for the Command Center AI. Run: npx tsx scripts/testCommandCenter.ts
// Pure fixtures — no network, no database, nothing touches Sleeper.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createReadOnlyTools, READ_TOOLS } from "../lib/commandCenter/tools";
import { handleCommand, newSession, type Block, type EngineEnv, type Session } from "../lib/commandCenter/engine";
import { analyzeDrops } from "../lib/commandCenter/drops";
import type { CcLeague, DropSignals, LeagueSnapshot } from "../lib/commandCenter/types";
import { CURRENT_PERMISSION, canExecute } from "../lib/commandCenter/types";
import type { RawRoster, RawTxn } from "../lib/commandCenter/classify";
import type { PlayerMap, ProjectionMap } from "../lib/types";
import type { RawMatchup, SleeperLeg, WeekRecordRow } from "../lib/commandCenter/tools";
import type { FaabStats } from "../lib/faabHistory";
import { computeFaabStats } from "../lib/faabHistory";
import { describeProposal } from "../lib/commandCenter/proposals";
import { buildPlayerIndex, findMentions } from "../lib/commandCenter/resolve";

let pass = 0;
let fail = 0;
function ok(cond: unknown, name: string, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
}

// ---------------------------------------------------------------- fixtures
const NOW = Date.parse("2026-09-20T12:00:00Z");
const ME = "me";

const RP_FC = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN", "BN", "BN", "BN"];
const WR_ROSTER = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN", "BN", "BN", "BN"]; // 14 spots
const NO_WR_ROSTER = ["QB", "RB", "RB", "TE", "K", "DEF", "BN", "BN"];
const mkSettings = (rp: string[], clear = 2) => ({ roster_positions: rp, settings: { waiver_clear_days: clear, waiver_type: 0, reserve_slots: 1 } });

function basePmap(): PlayerMap {
  const pm: PlayerMap = {
    "100": { n: "Antonio Williams", p: "WR", t: "CLE" },
    "101": { n: "Antonio Williams", p: "RB", t: "" }, // retired namesake, no team
    "200": { n: "Christian McCaffrey", p: "RB", t: "SF" },
    "300": { n: "Sam QB", p: "QB", t: "DAL" },
    "301": { n: "Terry TE", p: "TE", t: "KC" },
    "302": { n: "Kyle K", p: "K", t: "BAL" },
    "303": { n: "Denver DEF", p: "DEF", t: "DEN" },
  };
  for (let i = 0; i < 12; i++) pm[String(400 + i)] = { n: `Bench ${String.fromCharCode(65 + i)}`, p: i % 2 ? "WR" : "RB", t: "NYJ" };
  return pm;
}

// A 14-player roster: starters + bench. Bench ids 400..
const starters = ["300", "410", "411", "412", "413", "301", "414", "302", "303"];
const bench = ["400", "401", "402", "403", "404"];
const fullRoster = (extra: string[] = []): RawRoster => ({
  roster_id: 1, owner_id: ME, players: [...starters, ...bench, ...extra], starters, reserve: [], taxi: [],
});
const openRoster = (): RawRoster => ({ roster_id: 1, owner_id: ME, players: [...starters, "400", "401"], starters, reserve: [], taxi: [] });
const otherRoster = (players: string[]): RawRoster => ({ roster_id: 2, owner_id: "them", players, starters: [], reserve: [], taxi: [] });

interface LeagueFx {
  league: CcLeague;
  rosters: RawRoster[] | Error;
  txns: RawTxn[] | Error;
}
const lg = (id: string, name: string, rp = WR_ROSTER, extra: Partial<CcLeague> = {}): CcLeague => ({
  id, name, status: "in_season", settings: mkSettings(rp), rosterId: 1, ownerId: ME, bestBall: false, ...extra,
});

function scenario(): LeagueFx[] {
  const dropTxn: RawTxn = { type: "free_agent", status: "complete", created: NOW - 3_600_000 * 5, drops: { "100": 2 } };
  return [
    { league: lg("1", "L1 free agent"), rosters: [openRoster(), otherRoster(["500"])], txns: [] },
    { league: lg("2", "L2 waiver full roster"), rosters: [fullRoster(["405", "406", "407", "408", "409"].slice(0, 0)), otherRoster([])], txns: [dropTxn] },
    { league: lg("3", "L3 on my roster"), rosters: [fullRoster(["100"]), otherRoster([])], txns: [] },
    { league: lg("4", "L4 on other roster"), rosters: [openRoster(), otherRoster(["100"])], txns: [] },
    { league: lg("5", "L5 scan fails"), rosters: new Error("503"), txns: [] },
    { league: lg("6", "L6 tx fails"), rosters: [openRoster(), otherRoster([])], txns: new Error("timeout") },
    { league: lg("7", "L7 no WR slot", NO_WR_ROSTER), rosters: [openRoster(), otherRoster([])], txns: [] },
    { league: lg("8", "L8 free agent full roster"), rosters: [fullRoster(), otherRoster([])], txns: [] },
    { league: lg("9", "L9 best ball", WR_ROSTER, { bestBall: true }), rosters: [openRoster(), otherRoster([])], txns: [] },
    { league: lg("10", "L10 offseason", WR_ROSTER, { status: "pre_draft" }), rosters: [openRoster(), otherRoster([])], txns: [] },
  ];
}

// fullRoster has 9 starters + 5 bench = 14 = WR_ROSTER length → "full".

function signals(pm: PlayerMap, opts: { avoid?: string[]; priority?: string[]; values?: Record<string, number> } = {}): DropSignals {
  const values = opts.values ?? {};
  return {
    info: (id) => (pm[id] ? { id, name: pm[id].n, pos: pm[id].p, team: pm[id].t, injury: pm[id].inj ?? null, active: !!pm[id].t } : null),
    fantisValue: (id) => (id in values ? values[id] : null),
    fcValue: () => null,
    curated: () => null,
    avoid: new Set(opts.avoid ?? []),
    priority: new Set(opts.priority ?? []),
  };
}

interface MatchupExtra {
  faabStats?: FaabStats | null;
  weekRecord?: Record<number, { rows: WeekRecordRow[]; noData: string[] }>;
  sleeper?: { access: boolean; legs: Record<string, SleeperLeg[] | Error>; calls?: { n: number } };
  states?: Record<string, { state: "pre" | "in" | "post"; elapsed: number }> | null;
  matchups?: Record<string, RawMatchup[] | Error>;
  projections?: ProjectionMap | null;
  week?: number;
}
function makeEnv(fx: LeagueFx[], pm: PlayerMap, sig?: DropSignals, calls = { rosters: 0, txns: 0, matchups: 0 }, extra: MatchupExtra = {}): EngineEnv & { calls: typeof calls } {
  const byId = new Map(fx.map((f) => [f.league.id, f]));
  const tools = createReadOnlyTools({
    leagues: fx.map((f) => f.league),
    pmap: pm,
    currentLeg: 3,
    now: () => NOW,
    week: extra.week ?? 3,
    hasSleeperAccess: () => !!extra.sleeper?.access,
    getFaabStats: async () => extra.faabStats ?? null,
    getWeekRecord: async (w: number) => extra.weekRecord?.[w] ?? null,
    getSleeperLegs: async (id) => {
      if (extra.sleeper?.calls) extra.sleeper.calls.n++;
      const l = extra.sleeper?.legs[id];
      if (!l) throw new Error("no fixture");
      if (l instanceof Error) throw l;
      return l;
    },
    getMatchups: async (id) => {
      calls.matchups++;
      const m = extra.matchups?.[id];
      if (!m) throw new Error("no fixture");
      if (m instanceof Error) throw m;
      return m;
    },
    snapshotDeps: {
      getRosters: async (id) => {
        calls.rosters++;
        const f = byId.get(id)!;
        if (f.rosters instanceof Error) throw f.rosters;
        return f.rosters;
      },
      getTransactions: async (id) => {
        calls.txns++;
        const f = byId.get(id)!;
        if (f.txns instanceof Error) throw f.txns;
        return f.txns;
      },
    },
  });
  return { tools, signals: sig ?? signals(pm), pmap: pm, curatedIds: null, rank: () => [0, 0], now: () => NOW, calls, projections: extra.projections ?? null, week: extra.week ?? 3, getGameStates: async () => extra.states ?? null };
}

const textOf = (blocks: Block[]) => blocks.filter((b): b is Extract<Block, { t: "text" }> => b.t === "text").map((b) => b.text).join("\n");
const leaguesBlock = (blocks: Block[]) => blocks.find((b): b is Extract<Block, { t: "leagues" }> => b.t === "leagues");
async function run(cmds: string[], env: EngineEnv, s: Session = newSession()) {
  let out = null as Awaited<ReturnType<typeof handleCommand>> | null;
  for (const c of cmds) {
    out = await handleCommand(c, s, env);
    s = out.session;
  }
  return out!;
}

async function main() {
  // ---------- 0. permission model is READ_ONLY and inert
  ok(CURRENT_PERMISSION === "READ_ONLY", "permission is READ_ONLY");
  ok(canExecute() === false, "canExecute() is false");

  // ---------- 1. static safety: no write path exists anywhere in the module tree
  const dir = join(process.cwd(), "lib", "commandCenter");
  for (const f of readdirSync(dir)) {
    const src = readFileSync(join(dir, f), "utf8");
    ok(!/sleeperWrite|graphql|accept_trade|submit_waiver_claim|league_create_transaction|update_matchup_leg|roster_update_reserve/.test(src.replace(/\/\/.*$/gm, "")), `no write imports/mutations in ${f}`);
    ok(!/method:\s*["'](POST|PUT|PATCH|DELETE)["']/.test(src), `no mutating fetch in ${f}`);
  }
  const tools0 = createReadOnlyTools({ leagues: [], pmap: {}, currentLeg: 1, snapshotDeps: { getRosters: async () => [], getTransactions: async () => [] } });
  const toolNames = Object.keys(tools0).filter((k) => k.startsWith("get_") || k === "search_players");
  ok(toolNames.every((n) => (READ_TOOLS as readonly string[]).includes(n)), "every exposed tool is in READ_TOOLS", toolNames.join());
  ok(!Object.keys(tools0).some((k) => /add|drop|claim|set_|update|write|execute|submit/i.test(k)), "no write-named tool exists");

  // ---------- 2. classification of every state
  {
    const pm = basePmap();
    delete pm["101"]; // single Antonio Williams for this case
    const env = makeEnv(scenario(), pm);
    const out = await run(["Find Antonio Williams everywhere"], env);
    const rows = leaguesBlock(out.blocks)!.rows;
    const st = Object.fromEntries(rows.map((r) => [r.leagueName, r.state]));
    ok(st["L1 free agent"] === "AVAILABLE", "L1 AVAILABLE", st["L1 free agent"]);
    ok(st["L2 waiver full roster"] === "WAIVER", "L2 WAIVER", st["L2 waiver full roster"]);
    ok(st["L3 on my roster"] === "ON_MY_ROSTER", "L3 ON_MY_ROSTER");
    ok(st["L4 on other roster"] === "ON_OTHER_ROSTER", "L4 ON_OTHER_ROSTER");
    ok(st["L5 scan fails"] === "SCAN_FAILED", "L5 SCAN_FAILED (never 'unavailable')", st["L5 scan fails"]);
    ok(st["L6 tx fails"] === "UNKNOWN", "L6 partial → UNKNOWN, not AVAILABLE/WAIVER", st["L6 tx fails"]);
    ok(st["L7 no WR slot"] === "NOT_ELIGIBLE", "L7 NOT_ELIGIBLE");
    ok(st["L8 free agent full roster"] === "AVAILABLE", "L8 AVAILABLE");
    ok(!("L9 best ball" in st) && !("L10 offseason" in st), "best-ball and off-season leagues are excluded, not scanned");
    const meta = out.session.meta!;
    ok(meta.inScope === 8 && meta.excludedBestBall === 1 && meta.excludedNotInSeason === 1, "scope counts + exclusions reported", JSON.stringify(meta));
    ok(meta.failed === 1 && meta.partial === 1 && meta.ok === 6, "scan health: 6 ok / 1 partial / 1 failed", `${meta.ok}/${meta.partial}/${meta.failed}`);
    ok(meta.failedLeagues[0]?.name === "L5 scan fails", "failed league is named");
    // roster requirement
    const byName = Object.fromEntries(rows.map((r) => [r.leagueName, r]));
    ok(byName["L1 free agent"].needsDrop === false, "open roster → no drop required");
    ok(byName["L2 waiver full roster"].needsDrop === true, "full roster → drop required");
    ok(byName["L8 free agent full roster"].needsDrop === true, "L8 drop required");
    // text never says done/added
    const txt = textOf(out.blocks);
    ok(!/\b(was|were) (added|dropped|claimed)|added Antonio|dropped .* from/i.test(txt), "no fake success language", txt.slice(0, 200));
    ok(/READ-ONLY MODE/.test(txt), "read-only line present");
    ok(/could not be verified/.test(txt) && /NOT counted as unavailable/.test(txt), "unverified leagues stated");
    ok(out.blocks.some((b) => b.t === "preview" && b.banner === "PREVIEW ONLY — NOTHING HAS BEEN CHANGED"), "preview banner present");
    // audit
    ok(out.audit.leaguesTotal === 8 && out.audit.leaguesFailed === 1 && out.audit.players[0]?.id === "100", "audit record", JSON.stringify(out.audit));
    ok(out.audit.errors.some((e) => e.includes("L5")), "audit records the failed league");
    ok(out.audit.permission === "READ_ONLY", "audit records permission");

    // ---------- follow-ups reuse context (no re-scan)
    const callsBefore = env.calls.rosters;
    const f1 = await handleCommand("Only show waiver leagues", out.session, env);
    ok(env.calls.rosters === callsBefore, "filter follow-up did not re-scan");
    ok(leaguesBlock(f1.blocks)!.rows.every((r) => r.state === "WAIVER") && leaguesBlock(f1.blocks)!.rows.length === 1, "only WAIVER rows");
    const f2 = await handleCommand("Only show leagues where I can add him without dropping someone", out.session, env);
    const r2 = leaguesBlock(f2.blocks)!.rows;
    ok(r2.length === 1 && r2[0].leagueName === "L1 free agent", "add-without-drop filter", JSON.stringify(r2.map((r) => r.leagueName)));
    const f3 = await handleCommand("show leagues where I would need to drop someone", out.session, env);
    ok(leaguesBlock(f3.blocks)!.rows.map((r) => r.leagueName).sort().join() === "L2 waiver full roster,L8 free agent full roster", "drop-required filter");
    const f4 = await handleCommand("show all", f1.session, env);
    ok(leaguesBlock(f4.blocks)!.rows.length === 8, "clear filter restores everything");

    // ---------- drops on the filtered set
    const d1 = await handleCommand("Now give me the bottom 3 drops", f3.session, env);
    ok(env.calls.rosters === callsBefore, "drops follow-up reused cached rosters");
    const dl = leaguesBlock(d1.blocks)!;
    ok(dl.rows.length === 2 && dl.rows.every((r) => r.drops && r.drops.candidates.length === 3), "3 drop candidates in each drop-required league");
    ok(dl.rows[0].drops!.candidates.every((c) => c.reasons.length >= 3), "every candidate carries reasons");
    ok(/Suggested drop candidates/.test(textOf(d1.blocks)) && !/correct drop|should drop/i.test(textOf(d1.blocks)), "worded as suggestions, not verdicts");
    ok(d1.blocks.some((b) => b.t === "tally"), "aggregate tally produced");

    // aggregate + drill-down
    const cand = dl.rows[0].drops!.candidates[0];
    const c1 = await handleCommand(`How many leagues have ${cand.name} as a candidate?`, d1.session, env);
    ok(/in 2 of 2 analysed leagues/.test(textOf(c1.blocks)), "candidate count aggregation", textOf(c1.blocks));
    const c2 = await handleCommand(`Show me every league where ${cand.name} is one of the bottom 3`, d1.session, env);
    ok(leaguesBlock(c2.blocks)?.rows.length === 2, "candidate drill-down lists leagues");
    const a1 = await handleCommand("which drops show up the most", d1.session, env);
    ok(a1.blocks.some((b) => b.t === "tally"), "aggregate_drops intent");
  }

  // ---------- 3. ambiguous name never guessed
  {
    const pm = basePmap();
    pm["102"] = { n: "Antonio Williams", p: "TE", t: "MIA" }; // second ACTIVE Antonio Williams
    const env = makeEnv(scenario(), pm);
    const a = await handleCommand("Find Antonio Williams everywhere", newSession(), env);
    const cl = a.blocks.find((b) => b.t === "clarify") as Extract<Block, { t: "clarify" }> | undefined;
    ok(!!cl && cl.options.length === 2, "ambiguous name asks which player", JSON.stringify(a.blocks.map((b) => b.t)));
    ok(cl?.options.every((o) => /—/.test(o.label) && /(WR|TE)/.test(o.label)), "options show position/team");
    ok(env.calls.rosters === 0 && !a.session.results, "no scan happens before the user confirms");
    const b = await handleCommand("2", a.session, env);
    ok(b.session.targets.length === 1 && b.session.targets[0].pos === "TE" && b.session.results!.length > 0, "choice 2 resolves to the TE and scans");
    // user changes their mind mid-clarification
    const c = await handleCommand("Find CMC", a.session, env);
    ok(c.session.pending === null && c.session.targets[0]?.id === "200", "new command abandons the pending choice; nickname CMC resolves");
    // bad choice number re-asks, does not guess
    const d = await handleCommand("9", a.session, env);
    ok(d.blocks.some((x) => x.t === "clarify") && !d.session.results, "out-of-range choice re-asks");
  }

  // ---------- 4. namesake with no team is disclosed, not silently ignored
  {
    const env = makeEnv(scenario(), basePmap()); // 100 active + 101 team-less
    const a = await handleCommand("Is Antonio Williams available?", newSession(), env);
    ok(/Ignored 1 namesake/.test(textOf(a.blocks)), "ignored inactive namesake is disclosed");
    ok(a.session.targets[0]?.id === "100", "resolved to the only current player");
  }

  // ---------- 5. nonexistent / multiple / phrasing variants
  {
    const pm = basePmap();
    delete pm["101"];
    const env = makeEnv(scenario(), pm);
    const n = await handleCommand("Find Zzyzx Notaplayer everywhere", newSession(), env);
    ok(!n.session.results, "nonexistent name does not scan");
    const multi = await handleCommand("Scan for Antonio Williams and Christian McCaffrey", newSession(), env);
    ok(multi.session.targets.length === 2, "multiple players in one command", String(multi.session.targets.length));
    const variants = ["Find Antonio Williams.", "Check Antonio Williams everywhere", "Is Antonio Williams available?", "Get Antonio Williams in every league", "Where can I add Antonio Williams?", "Where can I waiver Antonio Williams?", "Find me leagues where Antonio Williams is available"];
    for (const v of variants) {
      const o = await handleCommand(v, newSession(), makeEnv(scenario(), pm));
      ok(o.session.targets[0]?.id === "100" && o.session.results?.length === 8, `variant resolves to the scan workflow: "${v}"`, o.audit.intent);
    }
    const dropVariants = [
      "Who can I drop?",
      "Give me my worst 3",
      "What's my weakest player?",
      "Find the bottom 3 players on each roster.",
      // starts with the bare word "drop" — would otherwise be grabbed by the
      // execute_request verb match (no player named) instead of this real
      // informational drops scan.
      "Drop candidates for my worst players",
      "drop my worst players",
    ];
    for (const v of dropVariants) {
      const o = await handleCommand(v, newSession(), makeEnv(scenario(), pm));
      ok(o.audit.intent === "drops", `variant → drop workflow: "${v}"`, o.audit.intent);
    }
    const g = await handleCommand("Give me 3 drops for Antonio Williams", newSession(), makeEnv(scenario(), pm));
    ok(g.session.targets[0]?.id === "100" && !!g.session.drops && Object.keys(g.session.drops).length > 0, "3 drops for <player> scans him and analyses drops");
  }

  // ---------- 6. player exists in every league / zero leagues
  {
    const pm = basePmap();
    delete pm["101"];
    const everywhere = scenario().slice(0, 4).map((f) => ({ ...f, rosters: [openRoster(), otherRoster(["100"])] as RawRoster[], txns: [] as RawTxn[] }));
    const o1 = await run(["Find Antonio Williams everywhere"], makeEnv(everywhere, pm));
    ok(leaguesBlock(o1.blocks)!.rows.every((r) => r.state === "ON_OTHER_ROSTER"), "player on someone's roster in every league");
    const nowhere = scenario().slice(0, 4).map((f) => ({ ...f, rosters: [openRoster(), otherRoster([])] as RawRoster[], txns: [] as RawTxn[] }));
    const o2 = await run(["Find Antonio Williams everywhere"], makeEnv(nowhere, pm));
    ok(leaguesBlock(o2.blocks)!.rows.every((r) => r.state === "AVAILABLE"), "player unrostered in every league");
    const allFail = scenario().slice(0, 3).map((f) => ({ ...f, rosters: new Error("down") as Error | RawRoster[], txns: [] as RawTxn[] }));
    const o3 = await run(["Find Antonio Williams everywhere"], makeEnv(allFail, pm));
    ok(leaguesBlock(o3.blocks)!.rows.every((r) => r.state === "SCAN_FAILED") && !/free-agent list in [1-9]/.test(textOf(o3.blocks)), "multiple failures stay SCAN_FAILED (never 'unavailable')");
    ok(o3.audit.leaguesFailed === 3, "audit counts all failures");
  }

  // ---------- 7. missing data
  {
    const pm = basePmap();
    delete pm["101"];
    const missingMine = [{ league: lg("1", "no roster for me"), rosters: [otherRoster([])] as RawRoster[], txns: [] as RawTxn[] }];
    const o = await run(["Find Antonio Williams everywhere"], makeEnv(missingMine, pm));
    ok(leaguesBlock(o.blocks)!.rows[0].state === "SCAN_FAILED", "roster missing → SCAN_FAILED, never a guess");
    const wrongOwner = [{ league: lg("1", "wrong owner"), rosters: [{ ...openRoster(), owner_id: "someone else" }, otherRoster([])] as RawRoster[], txns: [] as RawTxn[] }];
    const o2 = await run(["Find Antonio Williams everywhere"], makeEnv(wrongOwner, pm));
    ok(leaguesBlock(o2.blocks)!.rows[0].state === "SCAN_FAILED", "roster owner mismatch → SCAN_FAILED");
    const noSettings = [{ league: { ...lg("1", "no settings"), settings: null }, rosters: [openRoster(), otherRoster([])] as RawRoster[], txns: [] as RawTxn[] }];
    const o3 = await run(["Find Antonio Williams everywhere"], makeEnv(noSettings, pm));
    ok(leaguesBlock(o3.blocks)!.rows[0].state === "UNKNOWN", "missing league settings → UNKNOWN");
    // window setting missing + recent drop → UNKNOWN, no drop → AVAILABLE
    const noWin = { ...lg("1", "no window"), settings: { roster_positions: WR_ROSTER, settings: {} } };
    const o4 = await run(["Find Antonio Williams everywhere"], makeEnv([{ league: noWin, rosters: [openRoster(), otherRoster([])], txns: [{ type: "free_agent", status: "complete", created: NOW - 1000, drops: { "100": 2 } }] }], pm));
    ok(leaguesBlock(o4.blocks)!.rows[0].state === "UNKNOWN", "recent drop but window unknown → UNKNOWN");
    // dropped long ago → free agent
    const o5 = await run(["Find Antonio Williams everywhere"], makeEnv([{ league: lg("1", "old drop"), rosters: [openRoster(), otherRoster([])], txns: [{ type: "waiver", status: "complete", created: NOW - 5 * 86_400_000, drops: { "100": 2 } }] }], pm));
    ok(leaguesBlock(o5.blocks)!.rows[0].state === "AVAILABLE", "drop outside the waiver window → free agent");
    // failed / pending transactions are not counted as drops
    const o6 = await run(["Find Antonio Williams everywhere"], makeEnv([{ league: lg("1", "failed drop"), rosters: [openRoster(), otherRoster([])], txns: [{ type: "waiver", status: "failed", created: NOW - 1000, drops: { "100": 2 } }] }], pm));
    ok(leaguesBlock(o6.blocks)!.rows[0].state === "AVAILABLE", "failed transactions ignored");
  }

  // ---------- 8. drop model
  {
    const pm = basePmap();
    const values: Record<string, number> = { "400": 5, "401": 50, "402": 3, "403": 80, "404": 20 };
    const sig = signals(pm, { values, priority: ["402"], avoid: ["404"] });
    const snap: LeagueSnapshot = {
      league: lg("1", "L"), status: "SUCCESS", fetchedAt: NOW,
      rosters: [{ rosterId: 1, ownerId: ME, players: [...starters, ...bench], starters, reserve: [], taxi: [] }],
      recentDrops: {},
    };
    const a = analyzeDrops(snap, sig, { incomingId: "100" })!;
    const order = a.candidates.map((c) => c.playerId);
    ok(order[0] === "404", "Avoid-list player is offered first", order.join());
    ok(!order.includes("402"), "Priority-list player is protected", order.join());
    ok(order.join() === "404,400,401", "then weakest Fantis value first", order.join());
    ok(a.candidates.every((c) => !starters.includes(c.playerId)), "starters never offered");
    ok(a.protectedCount >= starters.length + 1, "protected count includes starters + priority");
    // scarcity: only one QB/TE/K/DEF on roster and they're benched → protected
    const snap2: LeagueSnapshot = { ...snap, rosters: [{ rosterId: 1, ownerId: ME, players: ["300", "301", "302", "303", "400"], starters: [], reserve: [], taxi: [] }] };
    const a2 = analyzeDrops(snap2, sig)!;
    ok(a2.candidates.map((c) => c.playerId).join() === "400", "required positions (QB/TE/K/DEF) are never offered", a2.candidates.map((c) => c.playerId).join());
    ok(a2.note?.includes("Only 1"), "explains fewer than 3 droppable", a2.note);
    // IR players are not droppable for a roster spot
    const snap3: LeagueSnapshot = { ...snap, rosters: [{ rosterId: 1, ownerId: ME, players: [...starters, "400", "401"], starters, reserve: ["401"], taxi: [] }] };
    ok(!analyzeDrops(snap3, sig)!.candidates.some((c) => c.playerId === "401"), "IR player not offered");
    // player missing from the player map: no crash
    const snap4: LeagueSnapshot = { ...snap, rosters: [{ rosterId: 1, ownerId: ME, players: [...starters, "999999"], starters, reserve: [], taxi: [] }] };
    const a4 = analyzeDrops(snap4, sig)!;
    ok(a4.candidates[0]?.playerId === "999999" && a4.candidates[0].reasons.length > 0, "unknown player id handled with reasons");
    ok(a4.unrankedTie === false, "single unranked candidate isn't flagged as a tie");
    // tie disclosure
    const a5 = analyzeDrops(snap, signals(pm))!;
    ok(a5.unrankedTie === true, "identical unranked values are flagged as arbitrary order");
    ok(a5.candidates[0].reasons.some((r) => /No Fantis value/.test(r)), "reason states missing Fantis value");
    // unreadable roster → no analysis
    ok(analyzeDrops({ ...snap, status: "FAILED", rosters: null }, sig) === null, "no recommendation for an unreadable roster");
  }

  // ---------- 9. bottom-N with no context, and shared cache
  {
    const pm = basePmap();
    delete pm["101"];
    const env = makeEnv(scenario(), pm);
    const o = await run(["Find the bottom 3 players on each roster"], env);
    const rows = leaguesBlock(o.blocks)!.rows;
    ok(rows.length === 7, "bottom-3 for every readable roster (7 of 8; the failed league is skipped, not guessed)", String(rows.length));
    const before = env.calls.rosters;
    await handleCommand("Who can I drop?", o.session, env);
    ok(env.calls.rosters - before === 1, "snapshots cached between commands; only the failed league is retried", String(env.calls.rosters - before));
  }

  // ---------- 10. write attempts are refused
  {
    const pm = basePmap();
    delete pm["101"];
    const env = makeEnv(scenario(), pm);
    const scan = await run(["Find Antonio Williams everywhere"], env);
    for (const cmd of ["Add him", "Drop Bench A everywhere", "Go ahead and claim him", "Submit the waiver claims", "execute all"]) {
      const o = await handleCommand(cmd, scan.session, env);
      const txt = textOf(o.blocks);
      ok(o.audit.intent === "execute_request", `"${cmd}" is an execute request`, o.audit.intent);
      ok(/can't .* READ-ONLY/.test(txt) && /Nothing has been changed/.test(txt), `"${cmd}" refused`, txt.slice(0, 120));
      ok(!o.blocks.some((b) => b.t === "text" && /^(Added|Dropped|Claimed|Done)/i.test(b.text)), `"${cmd}" no fake success`);
    }
    const o = await handleCommand("Add Antonio Williams to every league", newSession(), makeEnv(scenario(), pm));
    ok(/READ-ONLY/.test(textOf(o.blocks)) && o.blocks.some((b) => b.t === "preview"), "'add X everywhere' → refusal + preview, still no write");
  }

  // ---------- 11. IR / roster decisions / waiver opps run read-only
  {
    const pm = basePmap();
    pm["400"] = { ...pm["400"], inj: "Out" };
    const env = makeEnv(scenario(), pm);
    const ir = await handleCommand("Find all leagues where I have an injured player who could go on IR", newSession(), env);
    ok(ir.audit.intent === "ir_opps" && ir.blocks.some((b) => b.t === "decisions"), "IR opportunities workflow");
    const rd = await handleCommand("Show me every league where I have a roster decision to make", newSession(), env);
    ok(rd.audit.intent === "roster_decisions", "roster decisions workflow");
  }

  // ---------- 12. LIVE matchups: scores so far, players played / left, projected finish
  {
    // Fixture players, each on a team whose game state we control.
    const pm = basePmap();
    const team = (id: string, t: string) => (pm[id] = { n: "P " + id, p: "WR", t });
    team("a", "DAL"); // game over
    team("b", "KC"); //  in progress, halfway
    team("c", "BAL"); // not started
    team("d", "DEN"); // not started
    team("e", "DAL"); // game over
    team("x", "BAL");
    team("y", "DEN");
    team("bye", "MIA"); // no game this week
    const states = {
      DAL: { state: "post" as const, elapsed: 1 },
      KC: { state: "in" as const, elapsed: 0.5 },
      BAL: { state: "pre" as const, elapsed: 0 },
      DEN: { state: "pre" as const, elapsed: 0 },
    };
    const proj: ProjectionMap = {
      a: { pts_ppr: 99 }, // finished — projection must be ignored, actual used
      b: { pts_ppr: 20 }, c: { pts_ppr: 15 }, d: { pts_ppr: 10 }, e: { pts_ppr: 99 },
      x: { pts_ppr: 30, pts_half_ppr: 10 }, y: { pts_ppr: 5, pts_half_ppr: 15 },
    };
    const half = { ...lg("8", "L8 free agent full roster"), settings: { ...mkSettings(WR_ROSTER), scoring_settings: { rec: 0.5 } } };
    const fx = scenario().map((f) => (f.league.id === "8" ? { ...f, league: half } : f));
    const row = (id: number, mid: number | null, starters: string[], pts: number[]): RawMatchup => ({
      roster_id: id, matchup_id: mid, starters, starters_points: pts, points: pts.reduce((x, y) => x + y, 0),
    });
    const matchups: Record<string, RawMatchup[] | Error> = {
      // L1: a (final, 20) + b (halfway, 10 so far, proj 20) + c (pre, proj 15) vs d (pre, proj 10) + e (final, 12)
      //     me: now 30, final 20 + (10+20*.5) + 15 = 55 ; opp: now 12, final 12+10 = 22  → WIN
      "1": [row(1, 1, ["a", "b", "c"], [20, 10, 0]), row(2, 1, ["d", "e"], [0, 12])],
      // L2: everyone finished, 100 vs 90 → WON (a fact)
      "2": [row(1, 1, ["a", "e"], [60, 40]), row(2, 1, ["a", "e"], [50, 40])],
      // L3: everyone finished, 80 vs 90 → LOST
      "3": [row(1, 1, ["a", "e"], [40, 40]), row(2, 1, ["a", "e"], [50, 40])],
      // L4: finished tie
      "4": [row(1, 1, ["a"], [70]), row(2, 1, ["e"], [70])],
      "5": new Error("503"), // → UNKNOWN
      // L6: bye week, no opponent
      "6": [row(1, null, ["a"], [10]), row(2, null, ["e"], [10])],
      // L7: I'm LEADING now (30 vs 0) but the opponent still has c (15) and d (10) to play … projected 30 vs 25 → WIN? make it a loss:
      //     opp has two unplayed starters projected 15 + 10 = 25 vs my 30 → still a win; use bigger: see L7b below
      "7": [row(1, 1, ["a"], [30]), row(2, 1, ["c", "d", "b"], [0, 0, 0])], // opp: 15+10+20 = 45 vs my 30 → LOSS while leading nothing (0<30 now)
      // L8: half-PPR field must be used (x=10 vs y=15 → LOSS; full PPR would say WIN 30 vs 5)
      "8": [row(1, 1, ["x"], [0]), row(2, 1, ["y"], [5])],
    };
    const calls = { rosters: 0, txns: 0, matchups: 0 };
    const env = makeEnv(fx, pm, undefined, calls, { matchups, projections: proj, states });
    const out = await handleCommand("How many leagues am I winning this week?", newSession(), env);
    const mb = out.blocks.find((b): b is Extract<Block, { t: "matchups" }> => b.t === "matchups")!;
    ok(!!mb, "matchup block produced");
    const by = Object.fromEntries((mb?.rows ?? []).map((r) => [r.leagueName, r]));
    const L = (n: string) => by[n];
    // L1: exact live math
    ok(L("L1 free agent")?.nowMine === 30 && L("L1 free agent")?.nowOpp === 12, "points so far are the real scores", JSON.stringify(L("L1 free agent")));
    ok(L("L1 free agent")?.projMine === 55 && L("L1 free agent")?.projOpp === 22, "finished=actual, mid-game=actual+proj×time left, unplayed=projection", `${L("L1 free agent")?.projMine}/${L("L1 free agent")?.projOpp}`);
    ok(L("L1 free agent")?.verdict === "WIN", "L1 projected win");
    ok(L("L1 free agent")?.playedMine === 1 && L("L1 free agent")?.leftMine === 2 && L("L1 free agent")?.playedOpp === 1 && L("L1 free agent")?.leftOpp === 1, "players played / left counted per side", JSON.stringify(L("L1 free agent")));
    ok(L("L2 waiver full roster")?.verdict === "WON", "everyone finished and ahead → WON (a fact)");
    ok(L("L3 on my roster")?.verdict === "LOST", "everyone finished and behind → LOST");
    ok(L("L4 on other roster")?.verdict === "TIED", "finished level → TIED");
    ok(L("L5 scan fails")?.verdict === "UNKNOWN", "unreadable league → UNKNOWN");
    ok(L("L6 tx fails")?.verdict === "NO_OPPONENT", "bye → NO_OPPONENT");
    ok(L("L7 no WR slot")?.verdict === "LOSS", "leading now but opponent has more still to come → projected LOSS", JSON.stringify(L("L7 no WR slot")));
    ok(L("L8 free agent full roster")?.verdict === "LOSS", "league scoring format honored (half-PPR field)", L("L8 free agent full roster")?.verdict);
    const c = mb.counts;
    ok(c.WON === 1 && c.LOST === 1 && c.TIED === 1 && c.WIN === 1 && c.LOSS === 2 && c.NO_OPPONENT === 1 && c.UNKNOWN === 1, "verdict counts", JSON.stringify(c));
    const txt = textOf(out.blocks);
    ok(/3 matchups are already decided \(1 won, 1 lost, 1 tied\)/.test(txt), "headline: already decided", txt.slice(0, 200));
    ok(/projected to win 1, lose 2/.test(txt), "headline: projected win/loss among live");
    ok(/leading in .* and trailing in/.test(txt), "headline: leading/trailing right now");
    ok(/Starters still to finish/.test(txt), "headline: players left");
    ok(/NOT counted as wins or losses/.test(txt), "unreadable leagues never counted as wins/losses");
    ok(/not a win probability/.test(txt), "says it is a projection");
    ok(mb.live.leftMine > 0 && mb.live.leftOpp > 0, "aggregate starters left");

    // filters, no re-read
    const before = calls.matchups;
    const f1 = await handleCommand("Which leagues have I already won", out.session, env);
    ok(calls.matchups === before, "follow-up reused the result (no re-read)");
    ok(f1.blocks.find((b): b is Extract<Block, { t: "matchups" }> => b.t === "matchups")!.rows.every((r) => r.verdict === "WON"), "'already won' shows only WON");
    const f2 = await handleCommand("Which leagues am I trailing right now", out.session, env);
    const tr = f2.blocks.find((b): b is Extract<Block, { t: "matchups" }> => b.t === "matchups")!.rows;
    ok(tr.length > 0 && tr.every((r) => r.nowMine! < r.nowOpp! && !["WON", "LOST", "TIED"].includes(r.verdict)), "'trailing right now' uses current score, excludes finished matchups", String(tr.length));
    const f3 = await handleCommand("Show me the leagues I'm projected to lose", out.session, env);
    ok(f3.blocks.find((b): b is Extract<Block, { t: "matchups" }> => b.t === "matchups")!.rows.length === 2 && calls.matchups === before, "projected-loss follow-up");

    for (const v of ["Am I going to win this week?", "How many leagues am I projected to win?", "How many leagues am I winning this week", "What are my matchups this week", "Who's winning in my leagues this week", "Which leagues am I losing this week?"]) {
      const o = await handleCommand(v, newSession(), makeEnv(fx, pm, undefined, undefined, { matchups, projections: proj, states }));
      ok(o.audit.intent === "win_projection", `phrasing → matchups: "${v}"`, o.audit.intent);
    }

    // game status unavailable → does NOT guess who has played
    const noStates = await handleCommand("How many leagues am I winning this week?", newSession(), makeEnv(fx, pm, undefined, undefined, { matchups, projections: proj, states: null }));
    ok(!noStates.blocks.some((b) => b.t === "matchups") && /couldn't load which NFL games/.test(textOf(noStates.blocks)), "no game status → refuses to guess");
    const noProj = await handleCommand("How many leagues am I winning this week?", newSession(), makeEnv(fx, pm, undefined, undefined, { matchups, projections: null, states }));
    ok(!noProj.blocks.some((b) => b.t === "matchups"), "no projections → no answer invented");
    ok(/READ-ONLY MODE/.test(textOf(out.blocks)), "read-only line on matchup answer");
    ok(out.audit.recommendations.some((r) => /won\/projected wins/.test(r)), "audit records the matchup result");

    // ---- Sleeper's own predictions (the numbers the app shows), when access is connected
    const leg = (id: number, mid: number | null, points: number, proj: number): SleeperLeg => ({ roster_id: id, matchup_id: mid, points, proj_points: proj });
    const legs: Record<string, SleeperLeg[] | Error> = {
      "1": [leg(1, 1, 30, 40), leg(2, 1, 12, 60)], // Sleeper says LOSS (40 vs 60); Fantis's own estimate said WIN
      "2": [leg(1, 1, 100, 100), leg(2, 1, 90, 90)], // decided — real scores win, Sleeper's projection is irrelevant
      "7": [leg(1, 1, 30, 70), leg(2, 1, 0, 20)], // Sleeper says WIN (70 vs 20); Fantis said LOSS
      "8": [leg(1, 1, 0, 0), leg(2, 1, 5, 0)], // unusable (0 projection) → fall back to Fantis
    };
    const sCalls = { n: 0 };
    const sEnv = makeEnv(fx, pm, undefined, undefined, { matchups, projections: proj, states, sleeper: { access: true, legs, calls: sCalls } });
    const sOut = await handleCommand("How many leagues am I winning this week?", newSession(), sEnv);
    const sm = sOut.blocks.find((b): b is Extract<Block, { t: "matchups" }> => b.t === "matchups")!;
    const sby = Object.fromEntries(sm.rows.map((r) => [r.leagueName, r]));
    ok(sby["L1 free agent"].source === "sleeper" && sby["L1 free agent"].projMine === 40 && sby["L1 free agent"].projOpp === 60, "uses Sleeper's own projected totals when available", JSON.stringify(sby["L1 free agent"]));
    ok(sby["L1 free agent"].verdict === "LOSS", "verdict follows Sleeper's prediction, not Fantis's", sby["L1 free agent"].verdict);
    ok(sby["L1 free agent"].estMine === 55 && sby["L1 free agent"].estOpp === 22, "Fantis's own estimate is kept alongside");
    ok(sby["L7 no WR slot"].source === "sleeper" && sby["L7 no WR slot"].verdict === "WIN", "L7 follows Sleeper");
    ok(sby["L8 free agent full roster"].source === "fantis" && sby["L8 free agent full roster"].warnings.some((w) => /Sleeper's projection looked unusable/.test(w)), "unusable Sleeper projection → Fantis fallback, flagged");
    ok(sby["L2 waiver full roster"].verdict === "WON" && sby["L2 waiver full roster"].source === "fantis", "decided matchups use real scores, not any projection");
    ok(sm.counts.WIN === 1 && sm.counts.LOSS === 2 && sm.counts.WON === 1, "aggregate counts use Sleeper's predictions", JSON.stringify(sm.counts));
    const sTxt = textOf(sOut.blocks);
    ok(/Predictions are Sleeper's own projected scores/.test(sTxt) && /Fantis's own estimate points the other way/.test(sTxt), "says whose numbers, and where they disagree", sTxt.slice(0, 400));

    // stale guard: Sleeper projection below points already scored → not trusted
    const staleLegs: Record<string, SleeperLeg[] | Error> = { "1": [leg(1, 1, 30, 10), leg(2, 1, 12, 60)] };
    const stale = await handleCommand("How many leagues am I winning this week?", newSession(), makeEnv(fx, pm, undefined, undefined, { matchups, projections: proj, states, sleeper: { access: true, legs: staleLegs } }));
    const stRow = stale.blocks.find((b): b is Extract<Block, { t: "matchups" }> => b.t === "matchups")!.rows.find((r) => r.leagueName === "L1 free agent")!;
    ok(stRow.source === "fantis", "Sleeper projection below points-so-far is not trusted");

    // a read that fails falls back per league and is counted, without breaking the others
    const oneBad: Record<string, SleeperLeg[] | Error> = { ...legs, "7": new Error("timeout") };
    const ob = await handleCommand("How many leagues am I winning this week?", newSession(), makeEnv(fx, pm, undefined, undefined, { matchups, projections: proj, states, sleeper: { access: true, legs: oneBad } }));
    const obRow = ob.blocks.find((b): b is Extract<Block, { t: "matchups" }> => b.t === "matchups")!.rows;
    ok(obRow.find((r) => r.leagueName === "L7 no WR slot")!.source === "fantis" && obRow.find((r) => r.leagueName === "L1 free agent")!.source === "sleeper", "one failed Sleeper read falls back only for that league");
    ok(/couldn't be read from Sleeper/.test(textOf(ob.blocks)), "failed Sleeper reads are disclosed");

    // rejected token: stop asking Sleeper, say so, still answer from Fantis's estimate
    const authCalls = { n: 0 };
    const allAuth: Record<string, SleeperLeg[] | Error> = Object.fromEntries(["1", "2", "3", "4", "5", "6", "7", "8"].map((k) => [k, new Error("Unauthorized")]));
    const au = await handleCommand("How many leagues am I winning this week?", newSession(), makeEnv(fx, pm, undefined, undefined, { matchups, projections: proj, states, sleeper: { access: true, legs: allAuth, calls: authCalls } }));
    ok(authCalls.n <= 6, "stops calling Sleeper once the token is rejected (no retry storm)", String(authCalls.n));
    ok(/rejected the saved login token/.test(textOf(au.blocks)) && au.blocks.some((b) => b.t === "matchups"), "explains the rejected token and still answers");

    // no Sleeper access connected → never calls Sleeper, says how to enable it
    const noCalls = { n: 0 };
    const na = await handleCommand("How many leagues am I winning this week?", newSession(), makeEnv(fx, pm, undefined, undefined, { matchups, projections: proj, states, sleeper: { access: false, legs, calls: noCalls } }));
    ok(noCalls.n === 0, "no Sleeper access → no calls to Sleeper");
    ok(/connect Sleeper access on the Lineups page/.test(textOf(na.blocks)), "tells the user how to use Sleeper's own predictions");
  }

  // ---------- 13. Phases 2–5 from the engine's side: drafts only, never an execution
  {
    const pm = basePmap();
    delete pm["101"];
    const draftsOf = (blocks: Block[]) => blocks.filter((b): b is Extract<Block, { t: "drafts" }> => b.t === "drafts").flatMap((b) => b.drafts);
    const env = makeEnv(scenario(), pm);
    env.permission = "PROPOSE_ONLY";
    const out = await handleCommand("Find Antonio Williams everywhere", newSession(), env);
    const ds = draftsOf(out.blocks);
    ok(ds.length === 3 && ds.every((d) => d.kind === "ADD"), "scan drafts one ADD per certain, actionable league", String(ds.length));
    const byL = Object.fromEntries(ds.map((d) => [d.leagueName, d]));
    const p1 = byL["L1 free agent"]?.params as { dropId: string | null; expectWaiver: boolean } | undefined;
    ok(p1?.dropId === null && p1?.expectWaiver === false, "open roster → add with no drop");
    const p2 = byL["L2 waiver full roster"]?.params as { dropId: string | null; expectWaiver: boolean } | undefined;
    ok(!!p2?.dropId && p2?.expectWaiver === true, "waiver + full roster → claim with a drop");
    ok(!starters.includes(p2?.dropId ?? "x"), "the proposed drop is never a starter");
    ok(!ds.some((d) => d.leagueName.startsWith("L6")), "unknown (partial) league is never proposed");
    ok(ds.every((d) => d.origin === "chat" && d.rationale.length > 0), "drafts are chat-origin and carry reasons");
    ok(/Nothing has been saved or sent to Sleeper/.test(out.blocks.find((b) => b.t === "drafts" && true) ? (out.blocks.find((b): b is Extract<Block, { t: "drafts" }> => b.t === "drafts")!.note) : ""), "drafts note says nothing was saved or sent");

    // read-only mode: still shows what could be proposed, but says it can't be saved
    const roEnv = makeEnv(scenario(), pm);
    const ro = await handleCommand("Find Antonio Williams everywhere", newSession(), roEnv);
    const roNote = ro.blocks.find((b): b is Extract<Block, { t: "drafts" }> => b.t === "drafts")?.note ?? "";
    ok(/Read-only mode/.test(roNote) && /switch to Propose only/.test(roNote), "read-only mode: can't save, tells the user how to enable it");

    // "add him" in propose mode → drafts + explanation, never an execution
    const sess = out.session;
    const ex = await handleCommand("Add him", sess, env);
    ok(ex.audit.intent === "execute_request" && /I don't add anything from chat, in any mode/.test(textOf(ex.blocks)), "chat 'add him' → not executed; turned into a proposal", textOf(ex.blocks).slice(0, 160));
    ok(draftsOf(ex.blocks).length === 0 || draftsOf(ex.blocks).every((d) => d.origin === "chat"), "chat can only ever create chat-origin drafts");
    ok(env.tools.callLog.every((c) => !/add|drop|claim|write|execute/i.test(c.tool.replace("get_", "").replace("_waiver_players", "").replace("_free_agents", ""))), "no write-like tool was ever called");

    // IR moves
    const pmIr = basePmap();
    pmIr["400"] = { ...pmIr["400"], inj: "IR" };
    const envIr = makeEnv(scenario(), pmIr);
    envIr.permission = "PROPOSE_ONLY";
    const irOut = await handleCommand("Find all leagues where I have an injured player who could go on IR", newSession(), envIr);
    const irDrafts = draftsOf(irOut.blocks);
    ok(irDrafts.length > 0 && irDrafts.every((d) => d.kind === "IR_MOVE" && (d.params as { injury: string }).injury === "IR"), "IR scan drafts IR_MOVE proposals for open-slot leagues");

    // lineup improvements
    const rpLu = ["QB", "RB", "BN", "BN"];
    const luPm: PlayerMap = {
      q: { n: "Q Back", p: "QB", t: "DAL" },
      r1: { n: "Hurt RB", p: "RB", t: "DAL", inj: "Out" },
      r2: { n: "Bench RB", p: "RB", t: "DAL" },
    };
    const luLeague = { ...lg("1", "Lineup League", rpLu), settings: { roster_positions: rpLu, settings: { reserve_slots: 1 } } };
    const luRoster: RawRoster = { roster_id: 1, owner_id: ME, players: ["q", "r1", "r2"], starters: ["q", "r1"], reserve: [], taxi: [] };
    const luFx: LeagueFx[] = [{ league: luLeague, rosters: [luRoster, otherRoster([])], txns: [] }];
    const luProj: ProjectionMap = { q: { pts_ppr: 20 }, r1: { pts_ppr: 15 }, r2: { pts_ppr: 9 } };
    const future = new Date(NOW + 86_400_000).toISOString();
    const luEnv = makeEnv(luFx, luPm, undefined, undefined, { projections: luProj, week: 3 });
    luEnv.permission = "PROPOSE_ONLY";
    luEnv.kickoffs = async () => ({ DAL: future });
    const lu = await handleCommand("Fix my lineups", newSession(), luEnv);
    const luD = draftsOf(lu.blocks);
    ok(luD.length === 1 && luD[0].kind === "SET_LINEUP", "lineup workflow drafts a SET_LINEUP proposal", String(luD.length));
    const lp = luD[0]?.params as { toStarters: string[]; fromStarters: string[]; changes: { inName: string | null }[] } | undefined;
    ok(lp?.toStarters.join() === "q,r2" && lp?.fromStarters.join() === "q,r1", "swaps the injured starter for the healthy bench player", JSON.stringify(lp));
    // started games are frozen
    const past = new Date(NOW - 3_600_000).toISOString();
    const luLocked = makeEnv(luFx, luPm, undefined, undefined, { projections: luProj, week: 3 });
    luLocked.permission = "PROPOSE_ONLY";
    luLocked.kickoffs = async () => ({ DAL: past });
    const lk = await handleCommand("Fix my lineups", newSession(), luLocked);
    ok(draftsOf(lk.blocks).length === 0, "players whose games started are never moved");
    // no kickoff data → refuses rather than guessing
    const luNoKo = makeEnv(luFx, luPm, undefined, undefined, { projections: luProj, week: 3 });
    luNoKo.permission = "PROPOSE_ONLY";
    luNoKo.kickoffs = async () => null;
    const nk = await handleCommand("Fix my lineups", newSession(), luNoKo);
    ok(draftsOf(nk.blocks).length === 0 && /couldn't load kickoff times/.test(textOf(nk.blocks)), "no kickoff times → no lineup proposals");

    // Thursday player → true slot, Monday player → flex, even at zero real
    // point gain (a pure reslot the 0.05-gain filter would otherwise hide).
    const thu = new Date(NOW + 4 * 86_400_000).toISOString(); // Thursday
    const wed = new Date(NOW + 3 * 86_400_000).toISOString(); // neither Thu nor Mon
    const rpFlex = ["QB", "WR", "FLEX", "BN"];
    const dayPm: PlayerMap = {
      fq: { n: "Force QB", p: "QB", t: "DAL" },
      thuGuy: { n: "Thursday Guy", p: "WR", t: "DAL" },
      sunGuy: { n: "Sunday Guy", p: "WR", t: "SF" },
      monGuy: { n: "Monday Guy", p: "WR", t: "NYJ" },
    };
    // League A: Thursday Guy is (wrongly) in FLEX, Sunday Guy in the true WR slot — equal points.
    const dayLeagueA = { ...lg("1", "Day League A — Thursday", rpFlex), settings: { roster_positions: rpFlex, settings: { reserve_slots: 1 } } };
    const dayRosterA: RawRoster = { roster_id: 1, owner_id: ME, players: ["fq", "thuGuy", "sunGuy"], starters: ["fq", "sunGuy", "thuGuy"], reserve: [], taxi: [] };
    // League B: Monday Guy is (wrongly) in the true WR slot, Sunday Guy in FLEX — equal points.
    const dayLeagueB = { ...lg("2", "Day League B — Monday", rpFlex), settings: { roster_positions: rpFlex, settings: { reserve_slots: 1 } } };
    const dayRosterB: RawRoster = { roster_id: 1, owner_id: ME, players: ["fq", "monGuy", "sunGuy"], starters: ["fq", "monGuy", "sunGuy"], reserve: [], taxi: [] };
    const dayProj: ProjectionMap = { fq: { pts_ppr: 20 }, thuGuy: { pts_ppr: 15 }, sunGuy: { pts_ppr: 15 }, monGuy: { pts_ppr: 15 } };
    const dayFx: LeagueFx[] = [
      { league: dayLeagueA, rosters: [dayRosterA, otherRoster([])], txns: [] },
      { league: dayLeagueB, rosters: [dayRosterB, otherRoster([])], txns: [] },
    ];
    const dayEnv = makeEnv(dayFx, dayPm, undefined, undefined, { projections: dayProj, week: 3 });
    dayEnv.permission = "PROPOSE_ONLY";
    dayEnv.kickoffs = async () => ({ DAL: thu, SF: wed, NYJ: future });
    const dayOut = await handleCommand("Fix my lineups", newSession(), dayEnv);
    const dayDrafts = draftsOf(dayOut.blocks);
    ok(dayDrafts.length === 2, "both Thursday and Monday placement fixes are proposed despite zero real point gain", String(dayDrafts.length));
    const byLg = Object.fromEntries(dayDrafts.map((d) => [d.leagueName, d.params as { toStarters: string[]; gain: number }]));
    ok(byLg["Day League A — Thursday"]?.toStarters[1] === "thuGuy" && byLg["Day League A — Thursday"]?.toStarters[2] === "sunGuy", "Thursday player moved into the true WR slot, not left in FLEX", JSON.stringify(byLg["Day League A — Thursday"]));
    ok(byLg["Day League B — Monday"]?.toStarters[2] === "monGuy" && byLg["Day League B — Monday"]?.toStarters[1] === "sunGuy", "Monday player moved into FLEX, not left in the true WR slot", JSON.stringify(byLg["Day League B — Monday"]));
    ok(dayDrafts.every((d) => (d.params as { gain: number }).gain < 0.05), "both fixes carry ~zero projected point change — real data, not fabricated value");
    ok(dayDrafts.every((d) => d.rationale[0] === "No real point change — this only moves Thursday/Monday players into the right slot before their games lock"), "rationale is honest that this is a placement fix, not a point upgrade");
    ok(dayDrafts.every((d) => /slot fix — no point change/.test(describeProposal(d))), "proposal summary reads as a slot fix, never a fake '+0.0 projected'");
    ok(/Thursday\/Monday slot fixes with no point change/.test(textOf(dayOut.blocks)) || /Thursday\/Monday player moved into the right slot/.test(textOf(dayOut.blocks)), "headline discloses these are placement-only fixes", textOf(dayOut.blocks).slice(0, 400));

    // Owner's curated rankings settle a genuine points tie for who starts.
    const rpTie = ["QB", "WR", "BN"];
    const tiePm: PlayerMap = {
      tq: { n: "Tie QB", p: "QB", t: "DAL" },
      tieStart: { n: "Tied Starter", p: "WR", t: "SF" },
      tieBench: { n: "Tied Bench", p: "WR", t: "SF" },
    };
    const tieLeague = { ...lg("1", "Tie League", rpTie), settings: { roster_positions: rpTie, settings: { reserve_slots: 1 } } };
    const tieRoster: RawRoster = { roster_id: 1, owner_id: ME, players: ["tq", "tieStart", "tieBench"], starters: ["tq", "tieStart"], reserve: [], taxi: [] };
    const tieProj: ProjectionMap = { tq: { pts_ppr: 20 }, tieStart: { pts_ppr: 12 }, tieBench: { pts_ppr: 12 } };
    const tieEnv = makeEnv([{ league: tieLeague, rosters: [tieRoster, otherRoster([])], txns: [] }], tiePm, undefined, undefined, { projections: tieProj, week: 3 });
    tieEnv.permission = "PROPOSE_ONLY";
    tieEnv.kickoffs = async () => ({ SF: wed, DAL: wed });
    tieEnv.curatedIds = ["tieBench", "tieStart"]; // tieBench ranked ABOVE tieStart in the owner's own rankings
    const tieOut = await handleCommand("Fix my lineups", newSession(), tieEnv);
    const tieDrafts = draftsOf(tieOut.blocks);
    ok(tieDrafts.length === 1, "a genuine points tie between two eligible players still gets a proposal, using the curated rankings to break it", String(tieDrafts.length));
    const tieParams = tieDrafts[0]?.params as { toStarters: string[] } | undefined;
    ok(tieParams?.toStarters.join() === "tq,tieBench", "the higher-curated-ranked player is preferred when the projections themselves are exactly tied", JSON.stringify(tieParams));
    // when the curated order favors the player who's ALREADY starting, nothing changes
    const tieEnvNoop = makeEnv([{ league: tieLeague, rosters: [tieRoster, otherRoster([])], txns: [] }], tiePm, undefined, undefined, { projections: tieProj, week: 3 });
    tieEnvNoop.permission = "PROPOSE_ONLY";
    tieEnvNoop.kickoffs = async () => ({ SF: wed, DAL: wed });
    tieEnvNoop.curatedIds = ["tieStart", "tieBench"];
    const tieOutNoop = await handleCommand("Fix my lineups", newSession(), tieEnvNoop);
    ok(draftsOf(tieOutNoop.blocks).length === 0, "curated rankings never cause a change when the current starter is already the preferred one");
    // a real, meaningfully-better-projected bench player still wins outright — rankings never override a genuine point edge
    const tieProjReal: ProjectionMap = { tq: { pts_ppr: 20 }, tieStart: { pts_ppr: 20 }, tieBench: { pts_ppr: 12 } };
    const tieEnvReal = makeEnv([{ league: tieLeague, rosters: [tieRoster, otherRoster([])], txns: [] }], tiePm, undefined, undefined, { projections: tieProjReal, week: 3 });
    tieEnvReal.permission = "PROPOSE_ONLY";
    tieEnvReal.kickoffs = async () => ({ SF: wed, DAL: wed });
    tieEnvReal.curatedIds = ["tieBench", "tieStart"]; // curated favorite has the far worse real projection this week
    const tieOutReal = await handleCommand("Fix my lineups", newSession(), tieEnvReal);
    ok(draftsOf(tieOutReal.blocks).length === 0, "a real 8-point projection edge is never overridden by curated rankings — projections still come first");
  }

  // ---------- 14. FantasyCalc per-league values + playoff standings
  {
    const pm: PlayerMap = {};
    for (const id of ["a1", "a2", "a3", "b1", "b2", "b3", "c1", "c2", "c3", "d1"]) pm[id] = { n: "P " + id, p: "WR", t: "DAL" };
    const rec = (id: number, owner: string, w: number, l: number, fpts: number, players: string[]): RawRoster => ({
      roster_id: id, owner_id: owner, players, starters: [], reserve: [], taxi: [], settings: { wins: w, losses: l, ties: 0, fpts },
    });
    const mkLg = (id: string, name: string, playoffTeams: number | null): CcLeague => ({
      ...lg(id, name),
      settings: { roster_positions: RP_FC, settings: { reserve_slots: 1, ...(playoffTeams ? { playoff_teams: playoffTeams } : {}) } },
    });
    // A: I'm 3-0 with 2 playoff spots → comfortably IN.
    const A = { league: mkLg("1", "A comfortably in", 2), rosters: [rec(1, ME, 3, 0, 300, ["a1", "a2"]), rec(2, "x", 2, 1, 250, ["a3"]), rec(3, "y", 1, 2, 200, []), rec(4, "z", 0, 3, 150, [])], txns: [] as RawTxn[] };
    // B: I'm 1-2, the last team in is 2-1 → a game behind → OUT (but my roster is the strongest).
    const B = { league: mkLg("2", "B out", 2), rosters: [rec(1, ME, 1, 2, 200, ["b1", "b2", "b3"]), rec(2, "x", 3, 0, 300, []), rec(3, "y", 2, 1, 250, []), rec(4, "z", 0, 3, 100, [])], txns: [] as RawTxn[] };
    // C: tied on record with the last team in, behind on points → BUBBLE.
    const C = { league: mkLg("3", "C bubble", 2), rosters: [rec(1, ME, 2, 1, 240, ["c1", "c2", "c3"]), rec(2, "x", 3, 0, 300, []), rec(3, "y", 2, 1, 260, []), rec(4, "z", 0, 3, 100, [])], txns: [] as RawTxn[] };
    // D: no playoff-team count on file → UNKNOWN, never a guess.
    const D = { league: mkLg("4", "D unknown", null), rosters: [rec(1, ME, 2, 1, 240, ["d1"]), rec(2, "x", 1, 2, 200, [])], txns: [] as RawTxn[] };
    const fx = [A, B, C, D];
    const fcTable: Record<string, Record<string, number>> = {
      "1": { a1: 5000, a2: 3000, a3: 2000 }, // mine 8000 vs 2000 → 1st
      "2": { b1: 6000, b2: 4000, b3: 2000 }, // mine 12000 → 1st (strong roster, behind on record)
      "3": { c1: 100 }, // mine 100, others 0 → 1st
      "4": {},
    };
    const sig = { ...signals(pm), fcValueFor: (lid: string, id: string) => fcTable[lid]?.[id] ?? null };
    const env = makeEnv(fx, pm, sig);
    const out = await handleCommand("Where do I stand for the playoffs?", newSession(), env);
    const sb = out.blocks.find((b): b is Extract<Block, { t: "standings" }> => b.t === "standings")!;
    ok(!!sb, "standings block produced");
    const by = Object.fromEntries((sb?.rows ?? []).map((r) => [r.leagueName, r]));
    ok(by["A comfortably in"]?.status === "IN" && by["A comfortably in"]?.rank === 1 && by["A comfortably in"]?.record === "3-0", "A: in a playoff spot", JSON.stringify(by["A comfortably in"]));
    ok((by["A comfortably in"]?.gamesFromLine ?? 0) >= 1, "A: games ahead of the line is positive");
    ok(by["B out"]?.status === "OUT" && by["B out"]?.rank === 3, "B: outside the line", JSON.stringify(by["B out"]));
    ok((by["B out"]?.gamesFromLine ?? 0) <= -1, "B: a game or more behind");
    ok(by["C bubble"]?.status === "BUBBLE" && by["C bubble"]?.rank === 3, "C: level with the last team in → bubble", JSON.stringify(by["C bubble"]));
    ok(by["D unknown"]?.status === "UNKNOWN" && by["D unknown"].warnings.some((w) => /no playoff-team count/.test(w)), "D: no playoff count → UNKNOWN with a reason");
    ok(sb.counts.IN === 1 && sb.counts.BUBBLE === 1 && sb.counts.OUT === 1 && sb.counts.UNKNOWN === 1, "status counts", JSON.stringify(sb.counts));
    ok(by["A comfortably in"]?.fcRank === 1 && by["B out"]?.fcRank === 1 && by["C bubble"]?.fcRank === 1, "roster strength ranked by this league's FantasyCalc values", JSON.stringify([by["A comfortably in"]?.fcRank, by["B out"]?.fcRank]));
    ok(by["D unknown"]?.fcRank == null || by["D unknown"]?.fcRank === 1, "no crash when a league has no FC values");
    const txt = textOf(out.blocks);
    ok(/in a playoff spot in 1 of 4 leagues, on the bubble .* in 1, outside in 1/.test(txt), "headline counts", txt.slice(0, 260));
    ok(/strong|top-3 roster/.test(txt), "flags a strong roster that is behind on record");
    ok(!/probab|chance of/i.test(txt), "no invented playoff probabilities");
    // follow-up filter without re-reading
    const before = env.calls.rosters;
    const f = await handleCommand("Only the leagues I'm out of", out.session, env);
    const fb = f.blocks.find((b): b is Extract<Block, { t: "standings" }> => b.t === "standings")!;
    ok(env.calls.rosters === before && fb.rows.length === 1 && fb.rows[0].status === "OUT", "follow-up filters the stored standings (no re-read)");
    for (const v of ["Where do I stand?", "What's my playoff picture", "Which leagues am I in a playoff spot", "How strong are my teams", "show me the standings"]) {
      const o = await handleCommand(v, newSession(), makeEnv(fx, pm, sig));
      ok(o.audit.intent === "standings", `phrasing → standings: "${v}"`, o.audit.intent);
    }
    ok(/READ-ONLY MODE/.test(txt), "read-only line present");

    // per-league FantasyCalc values drive drop candidates
    const dropPm: PlayerMap = { s: { n: "Starter", p: "RB", t: "DAL" }, x: { n: "Bench X", p: "RB", t: "DAL" }, y: { n: "Bench Y", p: "RB", t: "DAL" } };
    const dropLeague = lg("9", "Drop League", ["RB", "BN", "BN"]);
    const snap9: LeagueSnapshot = { league: dropLeague, status: "SUCCESS", fetchedAt: NOW, rosters: [{ rosterId: 1, ownerId: ME, players: ["s", "x", "y"], starters: ["s"], reserve: [], taxi: [] }], recentDrops: {} };
    const base = signals(dropPm);
    const withLeague = { ...base, fcValue: () => null, fcValueFor: (lid: string, id: string) => (lid === "9" ? ({ x: 900, y: 100 } as Record<string, number>)[id] ?? null : null) };
    const d = analyzeDrops(snap9, withLeague)!;
    ok(d.candidates[0].playerId === "y" && d.candidates[0].fcValue === 100, "the league's own FantasyCalc value orders the drops (lowest first)", JSON.stringify(d.candidates.map((c) => [c.playerId, c.fcValue])));
    ok(d.candidates[0].reasons.some((r) => /FantasyCalc value 100 \(this league's format\)/.test(r)), "reason names the league-format FantasyCalc value");
    const fallback = analyzeDrops(snap9, { ...base, fcValue: (id: string) => ({ x: 50, y: 700 } as Record<string, number>)[id] ?? null })!;
    ok(fallback.candidates[0].playerId === "x", "no per-league values → falls back to the fixed-format value");
  }

  // ---------- 15. FAAB bid suggestions in ADD/claim drafts
  {
    const pm = basePmap();
    delete pm["101"];
    const faabLeague = { ...lg("1", "FAAB League"), settings: { roster_positions: WR_ROSTER, settings: { reserve_slots: 1, waiver_type: 2, waiver_bid_min: 3 } } };
    const fx: LeagueFx[] = [{ league: faabLeague, rosters: [openRoster(), otherRoster([])], txns: [] }];

    const stats: FaabStats = computeFaabStats([
      { leagueId: "1", waiverBid: 10, adds: [{ playerId: "x", pos: "WR" }] },
      { leagueId: "1", waiverBid: 20, adds: [{ playerId: "y", pos: "WR" }] },
      { leagueId: "1", waiverBid: 30, adds: [{ playerId: "z", pos: "WR" }] },
    ]);
    const withHistory = makeEnv(fx, pm, undefined, undefined, { faabStats: stats });
    const out = await handleCommand("Find Antonio Williams everywhere", newSession(), withHistory);
    const drafts1 = out.blocks.find((b): b is Extract<Block, { t: "drafts" }> => b.t === "drafts")!.drafts;
    const p1 = drafts1[0].params as { bid: number; faab: boolean };
    ok(p1.faab && p1.bid === stats["1"].WR.p75, "FAAB league with real WR history: bid uses the sourced suggestion, not bid-min", JSON.stringify(p1));
    ok(drafts1[0].rationale.some((r) => /Suggested bid \$\d+ — based on 3 real winning WR claims/.test(r)), "rationale cites the real sample it came from", drafts1[0].rationale.join(" | "));

    const noHistory = makeEnv(fx, pm, undefined, undefined, { faabStats: null });
    const out2 = await handleCommand("Find Antonio Williams everywhere", newSession(), noHistory);
    const drafts2 = out2.blocks.find((b): b is Extract<Block, { t: "drafts" }> => b.t === "drafts")!.drafts;
    const p2 = drafts2[0].params as { bid: number };
    ok(p2.bid === 3, "no FAAB history anywhere: falls back to this league's own bid minimum", String(p2.bid));
    ok(drafts2[0].rationale.some((r) => /No WR claim history in this league yet — using the \$3 bid minimum/.test(r)), "rationale explains the fallback honestly", drafts2[0].rationale.join(" | "));

    // a non-FAAB league never even asks for stats
    const nonFaab = makeEnv(scenario().slice(0, 1), pm, undefined, undefined, { faabStats: stats });
    const out3 = await handleCommand("Find Antonio Williams everywhere", newSession(), nonFaab);
    ok(!out3.audit.errors.some((e) => /faab/i.test(e)), "non-FAAB league scans run fine with no bid data requested");
  }

  // ---------- 16. weekly sweep: IR + priority-list adds in one combined review
  {
    const pm = basePmap();
    delete pm["101"];
    pm["400"] = { ...pm["400"], inj: "IR" }; // bench player, IR-eligible in leagues where he's rostered
    const sig = signals(pm, { priority: ["200"] }); // Christian McCaffrey — never on any scenario() roster, so he's a free agent everywhere
    const env = makeEnv(scenario(), pm, sig);
    const out = await handleCommand("Run my weekly sweep", newSession(), env);
    ok(out.audit.intent === "weekly_sweep", "recognised as weekly_sweep", out.audit.intent);
    const draftsBlk = out.blocks.find((b): b is Extract<Block, { t: "drafts" }> => b.t === "drafts");
    ok(!!draftsBlk, "one combined drafts block is produced");
    const kinds = draftsBlk!.drafts.map((d) => d.kind);
    ok(kinds.includes("IR_MOVE"), "sweep includes IR_MOVE drafts", kinds.join());
    ok(kinds.includes("ADD"), "sweep includes ADD drafts for the priority-list player", kinds.join());
    const irCount = kinds.filter((k) => k === "IR_MOVE").length;
    const addCount = kinds.filter((k) => k === "ADD").length;
    ok(addCount >= 2, "the priority player is proposed in more than one league (he's a free agent everywhere)", String(addCount));
    const addDraft = draftsBlk!.drafts.find((d) => d.kind === "ADD")!;
    ok((addDraft.params as { addId: string }).addId === "200", "the ADD draft is for the priority-list player, not a guess");
    ok(/READ-ONLY MODE/.test(textOf(out.blocks)), "read-only line present");
    ok(/Weekly sweep: \d+ IR move/.test(textOf(out.blocks)), "headline summarises both halves", textOf(out.blocks).slice(0, 200));
    ok(!out.audit.errors.some((e) => /sweep/i.test(e)), "no sweep-specific errors surfaced");
    void irCount;

    // an empty priority list still runs the IR half and says so plainly
    const noPriority = makeEnv(scenario(), pm, signals(pm));
    const out2 = await handleCommand("weekly sweep", newSession(), noPriority);
    ok(/Add players to your Priority list/.test(textOf(out2.blocks)), "empty priority list explains how to include players next time", textOf(out2.blocks));
    const drafts2 = out2.blocks.find((b): b is Extract<Block, { t: "drafts" }> => b.t === "drafts");
    ok(!drafts2 || drafts2.drafts.every((d) => d.kind === "IR_MOVE"), "with no priority players, only IR drafts appear");

    for (const v of ["Run my weekly sweep", "sweep the week", "do my weekly check", "sweep my leagues"]) {
      const o = await handleCommand(v, newSession(), makeEnv(scenario(), pm, sig));
      ok(o.audit.intent === "weekly_sweep", `phrasing → weekly_sweep: "${v}"`, o.audit.intent);
    }
  }

  // ---------- 17. week record (real past results, pure DB read) + relative "last/this week"
  {
    const pm = basePmap();
    delete pm["101"];
    const wr = (leagueId: string, leagueName: string, points: number, won: boolean | null, oppPoints: number | null = null, oppName: string | null = null): WeekRecordRow => ({ leagueId, leagueName, points, won, opponentPoints: oppPoints, opponentTeamName: oppName });
    const week2: { rows: WeekRecordRow[]; noData: string[] } = {
      rows: [
        wr("1", "L1 free agent", 110.5, true, 90.2, "Team A"),
        wr("2", "L2 waiver full roster", 80, false, 95.5, "Team B"),
        wr("3", "L3 on my roster", 70, null, null, null), // a real synced bye/unresolved week — never guessed as a loss
      ],
      noData: ["L4 on other roster"], // no row at all for this week — never confused with a loss
    };
    const env = makeEnv(scenario(), pm, undefined, undefined, { weekRecord: { 2: week2 }, week: 3 });
    const out = await handleCommand("What was my overall record for week 2?", newSession(), env);
    ok(out.audit.intent === "week_record", "recognised as week_record", out.audit.intent);
    const wb = out.blocks.find((b): b is Extract<Block, { t: "week_record" }> => b.t === "week_record");
    ok(!!wb && wb.wins === 1 && wb.losses === 1 && wb.unresolved === 1, "wins/losses/unresolved computed correctly from real per-league results", JSON.stringify(wb));
    ok(!!wb && wb.noData.length === 1, "a league with no synced data for that week is reported separately, not counted as a loss");
    const txt = textOf(out.blocks);
    ok(/Week 2: 1-1 \(1 bye\/unresolved, not counted either way\) across 3 leagues/.test(txt), "headline states the real record and never guesses the unresolved one", txt.slice(0, 200));
    ok(/1 league has no synced data for week 2/.test(txt), "headline discloses the uncovered league");

    for (const v of ["What was my overall record for week 2", "How did I do week 2", "my score week 2", "week 2 results"]) {
      const o = await handleCommand(v, newSession(), env);
      ok(o.audit.intent === "week_record" && (o.audit as unknown as { players: unknown }) !== undefined, `phrasing → week_record: "${v}"`, o.audit.intent);
    }

    // relative "last week" / "this week" resolve against the real current week (env.week = 3), never guessed independently
    const lastWeek = await handleCommand("what was my record last week", newSession(), env);
    ok(lastWeek.audit.intent === "week_record", "\"last week\" recognised");
    ok(/Week 2:/.test(textOf(lastWeek.blocks)), "\"last week\" resolves to week 2 when the current week is 3", textOf(lastWeek.blocks).slice(0, 60));

    const envNoWeek = makeEnv(scenario(), pm, undefined, undefined, { weekRecord: { 2: week2 } }); // env.week defaults to 3 in makeEnv's fixture already; force unknown instead
    const noResult = await env.tools.get_week_record(999); // sanity: an unsynced week returns null via the tool, not a guess
    ok(noResult === null, "a week with no fixture at all comes back null from the tool, never invented");
    void envNoWeek;

    // week 1 has no "last week" — never wraps to a negative/zero week
    const noBefore = await handleCommand("what was my record last week", newSession(), makeEnv(scenario(), pm, undefined, undefined, { weekRecord: {}, week: 1 }));
    ok(/no week before week 1/.test(textOf(noBefore.blocks)), "never resolves to a week before 1");

    // an unreadable week (tool returns null) never invents a fake 0-0 record
    const unread = await handleCommand("what was my record for week 5", newSession(), makeEnv(scenario(), pm, undefined, undefined, { weekRecord: {} }));
    ok(!unread.blocks.some((b) => b.t === "week_record") && /Couldn't read week 5/.test(textOf(unread.blocks)), "an unreadable week says so instead of showing an empty/fake record");
    ok(/READ-ONLY MODE/.test(txt), "read-only line present on a week_record answer");
  }

  // ---------- 18. execute_request now applies an inline condition instead of discarding it
  {
    const pm = basePmap();
    delete pm["101"];
    const env = makeEnv(scenario(), pm);
    const out = await handleCommand("Add Antonio Williams if he's on waivers", newSession(), env);
    ok(out.audit.intent === "execute_request", "still recognised as an execution attempt (never executed)", out.audit.intent);
    const lb = out.blocks.find((b): b is Extract<Block, { t: "leagues" }> => b.t === "leagues");
    ok(!!lb && lb.rows.every((r) => r.state === "WAIVER"), "the inline 'if on waivers' condition is now applied, not discarded — every shown league is really WAIVER", JSON.stringify(lb?.rows.map((r) => r.state)));
    ok(/Only showing leagues that match what you asked for: waiver/.test(textOf(out.blocks)), "tells the user which condition it applied", textOf(out.blocks).slice(0, 300));
    ok(/can't add anything|I don't add anything/.test(textOf(out.blocks)), "still refuses to actually execute anything from chat");

    const out2 = await handleCommand("Add Antonio Williams only where I don't need to drop anyone", newSession(), makeEnv(scenario(), pm));
    const lb2 = out2.blocks.find((b): b is Extract<Block, { t: "leagues" }> => b.t === "leagues");
    ok(!!lb2 && lb2.rows.every((r) => r.needsDrop === false), "a 'no drop needed' condition is applied too", JSON.stringify(lb2?.rows.map((r) => r.needsDrop)));

    // a bare "add X" with no real condition still shows everything (no over-filtering)
    const out3 = await handleCommand("Add Antonio Williams", newSession(), makeEnv(scenario(), pm));
    const lb3 = out3.blocks.find((b): b is Extract<Block, { t: "leagues" }> => b.t === "leagues");
    ok(!!lb3 && lb3.rows.length > 1, "a plain 'add X' with no stated condition is not narrowed to a single state", String(lb3?.rows.length));
  }

  // ---------- 19. "move <player> off IR to my bench" (real chat request)
  {
    const pm = basePmap();
    delete pm["101"];
    pm["999"] = { n: "IR Star", p: "WR", t: "IND" };
    const aStarters = ["aq", "ar1", "ar2", "aw1", "aw2", "at", "af", "ak", "ad"];
    const values = { ab1: 5, ab2: 10, ab3: 20, ab4: 30, ab5: 40 };
    const sig = signals(pm, { values });

    const leagueA = { ...lg("1", "Activate League A — open"), settings: { roster_positions: WR_ROSTER, settings: { reserve_slots: 2 } } };
    const rosterA: RawRoster = { roster_id: 1, owner_id: ME, players: [...aStarters, "ab1", "999"], starters: aStarters, reserve: ["999"], taxi: [] };

    const leagueB = { ...lg("2", "Activate League B — full"), settings: { roster_positions: WR_ROSTER, settings: { reserve_slots: 2 } } };
    const rosterB: RawRoster = { roster_id: 1, owner_id: ME, players: [...aStarters, "ab1", "ab2", "ab3", "ab4", "ab5", "999"], starters: aStarters, reserve: ["999"], taxi: [] };

    const leagueC = { ...lg("3", "Activate League C — not on IR"), settings: { roster_positions: WR_ROSTER, settings: { reserve_slots: 2 } } };
    const rosterC: RawRoster = { roster_id: 1, owner_id: ME, players: [...aStarters, "ab1"], starters: aStarters, reserve: [], taxi: [] };

    const rp9 = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"]; // no bench slots at all
    const leagueD = { ...lg("4", "Activate League D — no candidate", rp9), settings: { roster_positions: rp9, settings: { reserve_slots: 1 } } };
    const rosterD: RawRoster = { roster_id: 1, owner_id: ME, players: [...aStarters, "999"], starters: aStarters, reserve: ["999"], taxi: [] };

    const fx: LeagueFx[] = [
      { league: leagueA, rosters: [rosterA, otherRoster([])], txns: [] },
      { league: leagueB, rosters: [rosterB, otherRoster([])], txns: [] },
      { league: leagueC, rosters: [rosterC, otherRoster([])], txns: [] },
      { league: leagueD, rosters: [rosterD, otherRoster([])], txns: [] },
    ];
    const env = makeEnv(fx, pm, sig);
    env.permission = "PROPOSE_ONLY";
    const out = await handleCommand("Move IR Star off IR to my bench", newSession(), env);
    ok(out.audit.intent === "activate_ir", "recognised as activate_ir", out.audit.intent);
    const decisionsBlk = out.blocks.find((b): b is Extract<Block, { t: "decisions" }> => b.t === "decisions");
    ok(!!decisionsBlk && decisionsBlk.rows.length === 3, "reports the 3 leagues where he's really on IR (League C excluded — never on IR there)", String(decisionsBlk?.rows.length));
    const draftsBlk = out.blocks.find((b): b is Extract<Block, { t: "drafts" }> => b.t === "drafts");
    ok(!!draftsBlk && draftsBlk.drafts.length === 2, "2 real proposals drafted (A: no drop, B: with a drop) — D skipped, no candidate", String(draftsBlk?.drafts.length));
    const byLeague = Object.fromEntries(draftsBlk!.drafts.map((d) => [d.leagueName, d]));
    ok(!(byLeague["Activate League A — open"].params as { dropId: string | null }).dropId, "open roster → no drop in the proposal");
    ok((byLeague["Activate League B — full"].params as { dropId: string | null }).dropId === "ab1", "full roster → weakest bench player suggested as the drop (lowest Fantis value first)", JSON.stringify(byLeague["Activate League B — full"].params));
    ok(draftsBlk!.drafts.every((d) => d.kind === "ACTIVATE_IR"), "every draft is the ACTIVATE_IR kind");
    ok(/2 can be proposed to move him to the bench; 1 would need a drop with no clear bench candidate/.test(textOf(out.blocks)), "headline discloses the skipped no-candidate league honestly", textOf(out.blocks).slice(0, 400));
    ok(/only moves him to your bench.*doesn't set him as a starter/.test(textOf(out.blocks)), "never conflates activating with starting him");

    // never on IR anywhere → says so plainly, no drafts
    const notOnIrFx: LeagueFx[] = [{ league: leagueC, rosters: [rosterC, otherRoster([])], txns: [] }];
    const out2 = await handleCommand("activate IR Star from IR", newSession(), makeEnv(notOnIrFx, pm, sig));
    ok(/isn't on IR in any of your/.test(textOf(out2.blocks)) && !out2.blocks.some((b) => b.t === "drafts"), "not on IR anywhere → plain statement, no drafts");

    for (const v of ["Move IR Star off IR to my bench", "activate IR Star from IR", "get IR Star off IR", "take IR Star off reserve"]) {
      const o = await handleCommand(v, newSession(), makeEnv(fx, pm, sig));
      ok(o.audit.intent === "activate_ir", `phrasing → activate_ir: "${v}"`, o.audit.intent);
    }
  }

  // ---------- 20. "make sure <player> starts" (forced single-player lineup override)
  {
    const pm: PlayerMap = {
      fq: { n: "Force QB", p: "QB", t: "DAL" },
      target: { n: "Target WR", p: "WR", t: "IND" }, // the player we want started
      bench1: { n: "Weak Bench", p: "WR", t: "IND" },
      hurt: { n: "Hurt Guy", p: "WR", t: "SF" },
    };
    const rpWR = ["QB", "WR", "WR", "BN"];
    const settings = { roster_positions: rpWR, settings: { reserve_slots: 1 } };
    const proj: ProjectionMap = { fq: { pts_ppr: 20 }, target: { pts_ppr: 5 }, bench1: { pts_ppr: 30 }, hurt: { pts_ppr: 25 } };
    const future = new Date(NOW + 86_400_000).toISOString();
    const past = new Date(NOW - 3_600_000).toISOString();

    // League 1: target is benched behind a higher-projected player → forcing him should swap him in even though it costs points
    const l1 = { ...lg("1", "Force L1 — bench swap"), settings };
    const r1: RawRoster = { roster_id: 1, owner_id: ME, players: ["fq", "bench1", "target"], starters: ["fq", "bench1", "0"], reserve: [], taxi: [] };
    // League 2: target already starting → nothing to propose
    const l2 = { ...lg("2", "Force L2 — already starting"), settings };
    const r2: RawRoster = { roster_id: 1, owner_id: ME, players: ["fq", "target", "bench1"], starters: ["fq", "target", "0"], reserve: [], taxi: [] };
    // League 3: target not rostered at all → excluded, never reported as a failure
    const l3 = { ...lg("3", "Force L3 — not rostered"), settings };
    const r3: RawRoster = { roster_id: 1, owner_id: ME, players: ["fq", "bench1"], starters: ["fq", "bench1", "0"], reserve: [], taxi: [] };
    // League 4: target on IR → can't be started, points to activation instead
    const l4 = { ...lg("4", "Force L4 — on IR"), settings };
    const r4: RawRoster = { roster_id: 1, owner_id: ME, players: ["fq", "bench1", "target"], starters: ["fq", "bench1", "0"], reserve: ["target"], taxi: [] };

    const fx: LeagueFx[] = [
      { league: l1, rosters: [r1, otherRoster([])], txns: [] },
      { league: l2, rosters: [r2, otherRoster([])], txns: [] },
      { league: l3, rosters: [r3, otherRoster([])], txns: [] },
      { league: l4, rosters: [r4, otherRoster([])], txns: [] },
    ];
    const env = makeEnv(fx, pm, undefined, undefined, { projections: proj, week: 3 });
    env.permission = "PROPOSE_ONLY";
    env.kickoffs = async () => ({ DAL: future, IND: future, SF: future });
    const out = await handleCommand("Make sure Target WR starts this week", newSession(), env);
    ok(out.audit.intent === "force_start", "recognised as force_start", out.audit.intent);
    const draftsBlk = out.blocks.find((b): b is Extract<Block, { t: "drafts" }> => b.t === "drafts");
    ok(!!draftsBlk && draftsBlk.drafts.length === 1 && draftsBlk.drafts[0].leagueName === "Force L1 — bench swap", "only the one league that actually needs a change gets a proposal", JSON.stringify(draftsBlk?.drafts.map((d) => d.leagueName)));
    const lp = draftsBlk!.drafts[0].params as { toStarters: string[] };
    ok(lp.toStarters.includes("target"), "the forced player is really in the proposed starting lineup", JSON.stringify(lp));
    ok(draftsBlk!.drafts[0].rationale.some((r) => /costs|gains/.test(r)), "rationale is honest about the point cost/gain of forcing him in, even when it's negative");
    const txt = textOf(out.blocks);
    ok(/already starting in 1 league/.test(txt), "already-starting league (L2) is reported, not silently skipped", txt.slice(0, 300));
    ok(/On IR\/taxi in 1 \(can't start until activated/.test(txt), "an IR-listed league (L4) is reported with a pointer to activation, never force-started", txt.slice(0, 400));

    // never overrides a real Out/bye status — the single most important safety rule here
    const pmHurtTarget: PlayerMap = { ...pm, target: { ...pm.target, inj: "Out" } };
    const envHurt = makeEnv(fx, pmHurtTarget, undefined, undefined, { projections: proj, week: 3 });
    envHurt.kickoffs = async () => ({ DAL: future, IND: future, SF: future });
    const outHurt2 = await handleCommand("Make sure Target WR starts this week", newSession(), envHurt);
    ok(!outHurt2.blocks.some((b) => b.t === "drafts"), "an Out player is NEVER force-started, even when explicitly asked — no proposal at all", textOf(outHurt2.blocks).slice(0, 300));
    ok(/Not started in 1 — his real status or bye makes him unavailable there; I never override that/.test(textOf(outHurt2.blocks)), "explains exactly why, honestly");

    // a locked game (already started) is never touched
    const envLocked = makeEnv([{ league: l1, rosters: [r1, otherRoster([])], txns: [] }], pm, undefined, undefined, { projections: proj, week: 3 });
    envLocked.kickoffs = async () => ({ DAL: future, IND: past });
    const outLocked = await handleCommand("Make sure Target WR starts this week", newSession(), envLocked);
    ok(!outLocked.blocks.some((b) => b.t === "drafts") && /Too late in 1/.test(textOf(outLocked.blocks)), "a game that already started is reported as too late, never proposed");

    // not rostered anywhere at all
    const envNone = makeEnv([{ league: l3, rosters: [r3, otherRoster([])], txns: [] }], pm, undefined, undefined, { projections: proj, week: 3 });
    envNone.kickoffs = async () => ({ DAL: future });
    const outNone = await handleCommand("Make sure Target WR starts this week", newSession(), envNone);
    ok(/isn't on your roster in any readable league/.test(textOf(outNone.blocks)), "not rostered anywhere → says so plainly");

    // no projections loaded → refuses to guess
    const envNoProj = makeEnv(fx, pm, undefined, undefined, { week: 3 });
    envNoProj.kickoffs = async () => ({ DAL: future });
    const outNoProj = await handleCommand("Make sure Target WR starts this week", newSession(), envNoProj);
    ok(!outNoProj.blocks.some((b) => b.t === "drafts") && /projections haven't loaded/.test(textOf(outNoProj.blocks)), "no projections → no lineup change proposed");

    for (const v of ["Make sure Target WR starts this week", "I want Target WR to start", "Target WR needs to start", "start Target WR in my lineups"]) {
      const o = await handleCommand(v, newSession(), env);
      ok(o.audit.intent === "force_start", `phrasing → force_start: "${v}"`, o.audit.intent);
    }

    // regression: when the forced player is eligible for BOTH his true position
    // slot and a FLEX slot, he must land in the true slot, not FLEX — the
    // assignment optimizer treats his weight as identical in either slot, so
    // without a tie-break he could end up in FLEX purely by solve order while
    // an equally-projected teammate sits in the real WR slot.
    const rpFlex = ["QB", "WR", "FLEX", "BN"];
    const flexSettings = { roster_positions: rpFlex, settings: { reserve_slots: 1 } };
    const l5Pm: PlayerMap = {
      fq: { n: "Force QB", p: "QB", t: "DAL" },
      target: { n: "Target WR", p: "WR", t: "IND" },
      wrSlotGuy: { n: "WR Slot Guy", p: "WR", t: "IND" },
      flexSlotGuy: { n: "Flex Slot Guy", p: "WR", t: "IND" },
    };
    const l5Proj: ProjectionMap = { fq: { pts_ppr: 20 }, target: { pts_ppr: 5 }, wrSlotGuy: { pts_ppr: 15 }, flexSlotGuy: { pts_ppr: 15 } };
    const l5 = { ...lg("5", "Force L5 — WR vs FLEX tie"), settings: flexSettings };
    const r5: RawRoster = { roster_id: 1, owner_id: ME, players: ["fq", "wrSlotGuy", "flexSlotGuy", "target"], starters: ["fq", "wrSlotGuy", "flexSlotGuy"], reserve: [], taxi: [] };
    const env5 = makeEnv([{ league: l5, rosters: [r5, otherRoster([])], txns: [] }], l5Pm, undefined, undefined, { projections: l5Proj, week: 3 });
    env5.kickoffs = async () => ({ DAL: future, IND: future });
    const out5 = await handleCommand("Make sure Target WR starts this week", newSession(), env5);
    const drafts5 = out5.blocks.find((b): b is Extract<Block, { t: "drafts" }> => b.t === "drafts");
    ok(!!drafts5 && drafts5.drafts.length === 1, "WR/FLEX tie league still gets exactly one proposal");
    const rp5 = drafts5!.drafts[0].params as { toStarters: string[] };
    ok(rp5.toStarters[1] === "target", "forced player lands in the real WR slot (index 1), not FLEX (index 2)", JSON.stringify(rp5.toStarters));
    ok(rp5.toStarters[2] !== "target", "forced player is NOT the one sitting in the FLEX slot", JSON.stringify(rp5.toStarters));
  }

  // ---------- 21. surname-only player mentions ("Pittman", not "Michael Pittman")
  {
    // Unambiguous surname behaves exactly like the full name would: resolves
    // to the one active player, discloses the team-less namesake.
    const pm = basePmap(); // "100" active Antonio Williams, "101" team-less namesake, both surname "Williams"
    const env = makeEnv(scenario(), pm);
    const a = await handleCommand("Is Williams available?", newSession(), env);
    ok(/Ignored 1 namesake/.test(textOf(a.blocks)), "surname-only still discloses the team-less namesake, never silently drops it");
    ok(a.session.targets[0]?.id === "100", "surname-only resolves to the one current player");

    // A shared surname is genuinely ambiguous → asks, exactly like a shared full name already did.
    const pm2 = basePmap();
    pm2["102"] = { n: "Antonio Williams", p: "TE", t: "MIA" }; // second active Antonio Williams
    const env2 = makeEnv(scenario(), pm2);
    const b = await handleCommand("Find Williams everywhere", newSession(), env2);
    const cl = b.blocks.find((x) => x.t === "clarify") as Extract<Block, { t: "clarify" }> | undefined;
    ok(!!cl && cl.options.length === 2, "a shared surname still asks which player rather than guessing", JSON.stringify(b.blocks.map((x) => x.t)));

    // The app's own command vocabulary can never be misread as a player name,
    // even when a real player happens to share that surname.
    const pmCollide = basePmap();
    pmCollide["105"] = { n: "Marcus Start", p: "WR", t: "SEA" }; // surname collides with the word "start"
    const idx = buildPlayerIndex(pmCollide);
    ok(findMentions("start my lineups", idx).length === 0, "a stopword-colliding surname is never picked up as a mention in an ordinary sentence", JSON.stringify(findMentions("start my lineups", idx)));
    ok(findMentions("Marcus Start", idx).length === 1, "the same player IS found when actually named", JSON.stringify(findMentions("Marcus Start", idx)));
    // "Fix my lineups" still routes correctly (requires mentions.length === 0)
    // even with a stopword-colliding surname sitting in the player map.
    const envCollide = makeEnv(scenario(), pmCollide);
    const c = await handleCommand("Fix my lineups", newSession(), envCollide);
    ok(c.audit.intent === "lineup_improvements", "a coincidental surname collision never derails an unrelated intent", c.audit.intent);
  }

  // ---------- 22. force_start phrasing: "start <player> in all my leagues"
  {
    const pm: PlayerMap = {
      fq: { n: "Force QB", p: "QB", t: "DAL" },
      target: { n: "Target WR", p: "WR", t: "IND" },
      bench1: { n: "Weak Bench", p: "WR", t: "IND" },
    };
    const rpWR = ["QB", "WR", "WR", "BN"];
    const settings = { roster_positions: rpWR, settings: { reserve_slots: 1 } };
    const proj: ProjectionMap = { fq: { pts_ppr: 20 }, target: { pts_ppr: 5 }, bench1: { pts_ppr: 30 } };
    const future = new Date(NOW + 86_400_000).toISOString();
    const l1 = { ...lg("1", "Force L1", rpWR), settings };
    const r1: RawRoster = { roster_id: 1, owner_id: ME, players: ["fq", "bench1", "target"], starters: ["fq", "bench1", "0"], reserve: [], taxi: [] };
    const fx: LeagueFx[] = [{ league: l1, rosters: [r1, otherRoster([])], txns: [] }];
    const env = makeEnv(fx, pm, undefined, undefined, { projections: proj, week: 3 });
    env.kickoffs = async () => ({ DAL: future, IND: future });
    for (const v of ["start Target WR in all my leagues", "start Target WR across my leagues", "start Target WR in every league", "start Target WR"]) {
      const o = await handleCommand(v, newSession(), env);
      ok(o.audit.intent === "force_start", `phrasing → force_start: "${v}"`, o.audit.intent);
    }
  }

  // ---------- 23. "put <player> on IR" (the opposite direction from activate_ir)
  {
    const draftsOf = (blocks: Block[]) => blocks.filter((b): b is Extract<Block, { t: "drafts" }> => b.t === "drafts").flatMap((b) => b.drafts);
    const rpIr = ["QB", "WR", "BN"];
    const settings = { roster_positions: rpIr, settings: { reserve_slots: 1 } };
    const irPm: PlayerMap = {
      fq: { n: "Send QB", p: "QB", t: "DAL" },
      bench1: { n: "Healthy Bench", p: "WR", t: "IND" },
      target: { n: "IR Candidate", p: "WR", t: "IND", inj: "IR" },
      irGuy: { n: "Already On IR", p: "WR", t: "IND", inj: "IR" },
    };
    const lA = { ...lg("1", "Send League A — open", rpIr), settings };
    const rA: RawRoster = { roster_id: 1, owner_id: ME, players: ["fq", "bench1", "target"], starters: ["fq", "bench1"], reserve: [], taxi: [] };
    const lB = { ...lg("2", "Send League B — full IR", rpIr), settings };
    const rB: RawRoster = { roster_id: 1, owner_id: ME, players: ["fq", "bench1", "target", "irGuy"], starters: ["fq", "bench1"], reserve: ["irGuy"], taxi: [] };
    const lC = { ...lg("3", "Send League C — already on IR", rpIr), settings };
    const rC: RawRoster = { roster_id: 1, owner_id: ME, players: ["fq", "bench1", "target"], starters: ["fq", "bench1"], reserve: ["target"], taxi: [] };
    const fx: LeagueFx[] = [
      { league: lA, rosters: [rA, otherRoster([])], txns: [] },
      { league: lB, rosters: [rB, otherRoster([])], txns: [] },
      { league: lC, rosters: [rC, otherRoster([])], txns: [] },
    ];
    const env = makeEnv(fx, irPm);
    env.permission = "PROPOSE_ONLY";
    const out = await handleCommand("Put IR Candidate on IR", newSession(), env);
    ok(out.audit.intent === "send_to_ir", "recognised as send_to_ir", out.audit.intent);
    const drafts = draftsOf(out.blocks);
    ok(drafts.length === 1 && drafts[0].leagueName === "Send League A — open" && drafts[0].kind === "IR_MOVE", "only the open-slot league gets a real IR_MOVE proposal", JSON.stringify(drafts.map((d) => d.leagueName)));
    const txt = textOf(out.blocks);
    ok(/is real IR-eligible in 2 league/.test(txt), "counts both leagues where he's really eligible (open + full)", txt.slice(0, 300));
    ok(/1 have a full IR — you'd need to release someone off IR first/.test(txt), "the full-IR league is reported honestly, never silently proposed", txt.slice(0, 400));
    ok(/already on IR in 1/.test(txt), "the league where he's already on IR is disclosed separately, not conflated with the eligible count", txt.slice(0, 400));

    // not eligible: healthy, no qualifying status at all
    const healthyPm: PlayerMap = { ...irPm, target: { n: "IR Candidate", p: "WR", t: "IND" } }; // no inj
    const envHealthy = makeEnv([{ league: lA, rosters: [rA, otherRoster([])], txns: [] }], healthyPm);
    const outHealthy = await handleCommand("Put IR Candidate on IR", newSession(), envHealthy);
    ok(!outHealthy.blocks.some((b) => b.t === "drafts") && /not IR-eligible \(healthy, or his real status doesn't qualify\) in 1/.test(textOf(outHealthy.blocks)), "a healthy player is never moved to IR, and the reason is stated honestly", textOf(outHealthy.blocks).slice(0, 300));

    // not rostered anywhere
    const lD = { ...lg("4", "Send League D — not rostered", rpIr), settings };
    const rD: RawRoster = { roster_id: 1, owner_id: ME, players: ["fq", "bench1"], starters: ["fq", "bench1"], reserve: [], taxi: [] };
    const envNone = makeEnv([{ league: lD, rosters: [rD, otherRoster([])], txns: [] }], irPm);
    const outNone = await handleCommand("Put IR Candidate on IR", newSession(), envNone);
    ok(/isn't on your roster in any of your/.test(textOf(outNone.blocks)), "not rostered anywhere → says so plainly, no drafts");

    for (const v of ["Put IR Candidate on IR", "move IR Candidate to IR", "send IR Candidate to IR", "place IR Candidate on injured reserve"]) {
      const o = await handleCommand(v, newSession(), env);
      ok(o.audit.intent === "send_to_ir", `phrasing → send_to_ir: "${v}"`, o.audit.intent);
    }
  }

  // ---------- 24. "add <X> and <Y>" (chat) — distinct drop per target, real FAAB per target
  {
    const draftsOf = (blocks: Block[]) => blocks.filter((b): b is Extract<Block, { t: "drafts" }> => b.t === "drafts").flatMap((b) => b.drafts);
    const rpMulti = ["QB", "WR", "BN", "BN"];
    const pm: PlayerMap = {
      fq: { n: "Multi QB", p: "QB", t: "DAL" },
      starter1: { n: "Starting WR", p: "WR", t: "DAL" },
      bench1: { n: "Weakest Bench", p: "WR", t: "DAL" },
      bench2: { n: "Second Bench", p: "WR", t: "DAL" },
      t1: { n: "Target One", p: "WR", t: "SEA" },
      t2: { n: "Target Two", p: "WR", t: "SEA" },
    };
    const sig = signals(pm, { values: { bench1: 10, bench2: 20 } }); // bench1 weaker → dropped first
    const league = { ...lg("1", "Multi Add League", rpMulti), settings: { roster_positions: rpMulti, settings: { reserve_slots: 1, waiver_type: 2, waiver_bid_min: 2 } } };
    const roster: RawRoster = { roster_id: 1, owner_id: ME, players: ["fq", "starter1", "bench1", "bench2"], starters: ["fq", "starter1"], reserve: [], taxi: [] };
    const fx: LeagueFx[] = [{ league, rosters: [roster, otherRoster([])], txns: [] }];

    const env = makeEnv(fx, pm, sig);
    env.permission = "PROPOSE_ONLY";
    const out = await handleCommand("Target One and Target Two", newSession(), env);
    ok(out.audit.intent === "scan_player", "bare multi-mention still recognised as scan_player", out.audit.intent);
    const drafts = draftsOf(out.blocks);
    ok(drafts.length === 2, "both targets get a real ADD proposal in the one full-roster league", String(drafts.length));
    const byTarget = Object.fromEntries(drafts.map((d) => [(d.params as { addName: string }).addName, d.params as { dropName: string | null; bid: number; faab: boolean }]));
    ok(byTarget["Target One"]?.dropName === "Weakest Bench" && byTarget["Target Two"]?.dropName === "Second Bench", "each target gets a DISTINCT drop candidate — never the same bench player proposed twice", JSON.stringify(byTarget));
    ok(byTarget["Target One"]?.faab === true && byTarget["Target Two"]?.faab === true, "FAAB applies independently per target — no collision risk there");

    // the "add X and Y" phrasing (a real execute_request) reaches the exact
    // same real scan+draft pipeline, not just a bare refusal.
    const env2 = makeEnv(fx, pm, sig);
    env2.permission = "PROPOSE_ONLY";
    const out2 = await handleCommand("add Target One and Target Two everywhere", newSession(), env2);
    ok(out2.audit.intent === "execute_request", "verb-led phrasing recognised as execute_request", out2.audit.intent);
    const drafts2 = draftsOf(out2.blocks);
    const byTarget2 = Object.fromEntries(drafts2.map((d) => [(d.params as { addName: string }).addName, d.params as { dropName: string | null }]));
    ok(drafts2.length === 2 && byTarget2["Target One"]?.dropName === "Weakest Bench" && byTarget2["Target Two"]?.dropName === "Second Bench", "\"add X and Y\" phrasing produces the same real, distinct-drop proposals as the bare mention", JSON.stringify(byTarget2));
    ok(/I don't add anything from chat/.test(textOf(out2.blocks)), "still states plainly that chat itself never sends anything — review + approve is still required");
  }

  // ---------- 25. "drop <order>" — owner-specified drop order as a follow-up to a scan
  {
    const draftsOf = (blocks: Block[]) => blocks.filter((b): b is Extract<Block, { t: "drafts" }> => b.t === "drafts").flatMap((b) => b.drafts);
    const rpFull = ["QB", "WR", "WR", "BN"];
    const settingsFull = { roster_positions: rpFull, settings: { reserve_slots: 1, waiver_type: 2, waiver_bid_min: 2 } };
    const rpSmall = ["QB", "WR", "BN"];
    const settingsSmall = { roster_positions: rpSmall, settings: { reserve_slots: 1 } };
    const pm: PlayerMap = {
      fq: { n: "Drop QB", p: "QB", t: "DAL" },
      starter1: { n: "Starting WR", p: "WR", t: "DAL" },
      bigsby: { n: "Tank Bigsby", p: "WR", t: "DAL" },
      washington: { n: "Mike Washington", p: "WR", t: "DAL" },
      other1: { n: "Other Bench One", p: "WR", t: "DAL" },
      other2: { n: "Other Bench Two", p: "WR", t: "DAL" },
      filler: { n: "Filler Bench", p: "WR", t: "DAL" },
      t1: { n: "Target One", p: "WR", t: "SEA" },
      t2: { n: "Target Two", p: "WR", t: "SEA" },
    };
    // League A: full roster, both drop-order names are real bench players → distinct assignment.
    const lA = { ...lg("1", "Drop Order League A", rpFull), settings: settingsFull };
    const rA: RawRoster = { roster_id: 1, owner_id: ME, players: ["fq", "starter1", "bigsby", "washington"], starters: ["fq", "starter1"], reserve: [], taxi: [] };
    // League B: full roster, neither drop-order name is on this roster at all → no match.
    const lB = { ...lg("2", "Drop Order League B — no match", rpFull), settings: settingsFull };
    const rB: RawRoster = { roster_id: 1, owner_id: ME, players: ["fq", "starter1", "other1", "other2"], starters: ["fq", "starter1"], reserve: [], taxi: [] };
    // League C: Tank Bigsby IS on this roster, but as a STARTER → never dropped, and no other listed name is here → no match.
    const lC = { ...lg("3", "Drop Order League C — named player is a starter", rpSmall), settings: settingsSmall };
    const rC: RawRoster = { roster_id: 1, owner_id: ME, players: ["fq", "bigsby", "filler"], starters: ["fq", "bigsby"], reserve: [], taxi: [] };
    const fx: LeagueFx[] = [
      { league: lA, rosters: [rA, otherRoster([])], txns: [] },
      { league: lB, rosters: [rB, otherRoster([])], txns: [] },
      { league: lC, rosters: [rC, otherRoster([])], txns: [] },
    ];
    const env = makeEnv(fx, pm);
    env.permission = "PROPOSE_ONLY";

    const out1 = await handleCommand("add Target One and Target Two everywhere", newSession(), env);
    ok(!!out1.session.results && out1.session.targets.length === 2, "the add scan leaves real targets/results on the session for a follow-up");

    const out2 = await handleCommand("drop Tank Bigsby, then Mike Washington", out1.session, env);
    ok(out2.audit.intent === "drop_preferences", "recognised as drop_preferences", out2.audit.intent);
    const drafts = draftsOf(out2.blocks);
    const byLeague = Object.fromEntries(drafts.map((d) => [d.leagueName, d.params as { dropName: string | null }]));
    ok(byLeague["Drop Order League A"]?.dropName !== undefined, "League A got a proposal from the drop order", JSON.stringify(byLeague));
    // both targets need a drop in League A — Bigsby (first in order) and
    // Washington (second) must each be claimed by exactly one, never both.
    const leagueADrafts = drafts.filter((d) => d.leagueName === "Drop Order League A");
    const namesUsed = leagueADrafts.map((d) => (d.params as { dropName: string | null }).dropName).sort();
    ok(leagueADrafts.length === 2 && namesUsed.join(",") === "Mike Washington,Tank Bigsby", "both targets in League A matched, to DISTINCT drop-order names — never the same one twice", JSON.stringify(namesUsed));
    ok(!drafts.some((d) => d.leagueName === "Drop Order League B — no match"), "League B (neither name on the roster) never gets a proposal");
    ok(!drafts.some((d) => d.leagueName === "Drop Order League C — named player is a starter"), "League C (named player is a starter there) never gets a proposal — a starter is never auto-dropped even when explicitly named");
    const txt2 = textOf(out2.blocks);
    ok(/Your drop order \(Tank Bigsby → Mike Washington\)/.test(txt2), "headline states the drop order back, in the order given", txt2.slice(0, 200));
    ok(/have none of your listed players as an eligible bench player/.test(txt2), "leagues with no eligible match are disclosed, never silently skipped", txt2.slice(0, 400));

    // with no prior scan on the session, "drop X" is NOT read as a drop
    // order (there's nothing to apply it to) — it falls through to the
    // ordinary drop-verb execute_request instead, unchanged.
    const outNoScan = await handleCommand("drop Tank Bigsby, then Mike Washington", newSession(), env);
    ok(outNoScan.audit.intent !== "drop_preferences", "with no prior add scan, a bare \"drop X\" is never misread as a drop order", outNoScan.audit.intent);

    // a scan with a target list but nothing actually needing a drop
    const noneNeeded = await handleCommand("Target One and Target Two", newSession(), makeEnv([{ league: lC, rosters: [{ ...rC, players: ["fq", "filler"], starters: ["fq"] }, otherRoster([])], txns: [] }], pm));
    const out3 = await handleCommand("drop Tank Bigsby, then Mike Washington", noneNeeded.session, env);
    ok(out3.audit.intent === "drop_preferences" && !out3.blocks.some((b) => b.t === "drafts") && /Nothing from the last scan needs a drop/.test(textOf(out3.blocks)), "a scan where nothing needed a drop → says so, nothing to propose");
  }

  // ---------- 26. ir_opps — open bench slot after the IR moves
  {
    const rp = ["QB", "WR", "BN", "BN"];
    const settings = { roster_positions: rp, settings: { reserve_slots: 1 } };
    const pm: PlayerMap = {
      fq: { n: "Bench QB", p: "QB", t: "DAL" },
      s1: { n: "Starter One", p: "WR", t: "DAL" },
      injPlayer: { n: "Hurt Bench Guy", p: "WR", t: "DAL", inj: "IR" },
      bench2: { n: "Healthy Bench", p: "WR", t: "DAL" },
      healthyOnly: { n: "All Healthy Guy", p: "WR", t: "DAL" },
    };
    // League A: full roster, one real IR-eligible bench player → a real IR_MOVE draft, opening 1 slot.
    const lA = { ...lg("1", "Bench Slot League A", rp), settings };
    const rA: RawRoster = { roster_id: 1, owner_id: ME, players: ["fq", "s1", "injPlayer", "bench2"], starters: ["fq", "s1"], reserve: [], taxi: [] };
    // League B: nobody injured → no IR draft, never appears in the open-slot report.
    const lB = { ...lg("2", "Bench Slot League B — nobody hurt", rp), settings };
    const rB: RawRoster = { roster_id: 1, owner_id: ME, players: ["fq", "s1", "healthyOnly", "bench2"], starters: ["fq", "s1"], reserve: [], taxi: [] };
    const fx: LeagueFx[] = [
      { league: lA, rosters: [rA, otherRoster([])], txns: [] },
      { league: lB, rosters: [rB, otherRoster([])], txns: [] },
    ];
    const env = makeEnv(fx, pm);
    env.permission = "PROPOSE_ONLY";
    const out = await handleCommand("Find all leagues where I have an injured player who could go on IR", newSession(), env);
    const txt = textOf(out.blocks);
    ok(/1 league would have an open bench slot afterward/.test(txt), "reports the real open-bench-slot count after the proposed IR moves", txt.slice(0, 400));
    const slotBlock = out.blocks.find((b): b is Extract<Block, { t: "decisions" }> => b.t === "decisions" && b.title === "Open bench slot after these IR moves");
    ok(!!slotBlock && slotBlock.rows.length === 1 && slotBlock.rows[0].leagueName === "Bench Slot League A" && /1 open slot/.test(slotBlock.rows[0].items[0]), "names the specific league and the real slot count (roster math: 4 active, 1 moves to IR, 4-slot roster → 1 open)", JSON.stringify(slotBlock));
    ok(!slotBlock || !slotBlock.rows.some((r) => r.leagueName.includes("nobody hurt")), "a league with no real IR move never appears in the open-slot report");

    // "move all my IR eligible players to IR" and its verb variants all
    // start with a word (move/put/send) the generic execute_request verb
    // match would otherwise grab first — must still reach the real ir_opps
    // flow, not a bare "tell me which player" fallback.
    for (const v of ["move all my IR eligible players to IR", "put all my IR eligible players on IR", "send all IR eligible players to IR", "move all IR eligible players to their IR spot"]) {
      const o = await handleCommand(v, newSession(), env);
      ok(o.audit.intent === "ir_opps", `phrasing → ir_opps: "${v}"`, o.audit.intent);
    }
    // a real named player in the same kind of sentence still routes normally — the
    // ir_opps shortcut never swallows an actual add/scan just because the
    // words "waiver"/"roster"/"ir" appear somewhere in it.
    const namedOut = await handleCommand("add Healthy Bench everywhere", newSession(), env);
    ok(namedOut.audit.intent !== "waiver_opps" && namedOut.audit.intent !== "ir_opps" && namedOut.audit.intent !== "roster_decisions", "a real named player is never swallowed by the waiver/IR/roster-decision shortcuts", namedOut.audit.intent);
  }

  // ---------- 27. "add X, Y, drop A, B if needed" — combined single-message drop order
  {
    const draftsOf = (blocks: Block[]) => blocks.filter((b): b is Extract<Block, { t: "drafts" }> => b.t === "drafts").flatMap((b) => b.drafts);
    const rpOpen = ["QB", "WR", "WR", "WR", "BN"];
    const rpFull = ["QB", "WR", "WR", "BN"];
    const pm: PlayerMap = {
      fq: { n: "Combo QB", p: "QB", t: "DAL" },
      starter1: { n: "Combo Starter", p: "WR", t: "DAL" },
      bigsby: { n: "Tank Bigsby", p: "WR", t: "DAL" },
      washington: { n: "Mike Washington", p: "WR", t: "DAL" },
      t1: { n: "Target One", p: "WR", t: "SEA" },
      t2: { n: "Target Two", p: "WR", t: "SEA" },
    };
    const lOpen = { ...lg("1", "Combo League Open", rpOpen), settings: { roster_positions: rpOpen, settings: { reserve_slots: 1, waiver_type: 2, waiver_bid_min: 2 } } };
    const rOpen: RawRoster = { roster_id: 1, owner_id: ME, players: ["fq", "starter1"], starters: ["fq", "starter1"], reserve: [], taxi: [] };
    const lFull = { ...lg("2", "Combo League Full", rpFull), settings: { roster_positions: rpFull, settings: { reserve_slots: 1, waiver_type: 2, waiver_bid_min: 2 } } };
    const rFull: RawRoster = { roster_id: 1, owner_id: ME, players: ["fq", "starter1", "bigsby", "washington"], starters: ["fq", "starter1"], reserve: [], taxi: [] };
    const fx: LeagueFx[] = [
      { league: lOpen, rosters: [rOpen, otherRoster([])], txns: [] },
      { league: lFull, rosters: [rFull, otherRoster([])], txns: [] },
    ];
    const env = makeEnv(fx, pm);
    env.permission = "PROPOSE_ONLY";
    const out = await handleCommand("add Target One and Target Two everywhere, drop Tank Bigsby then Mike Washington if needed", newSession(), env);
    ok(out.audit.intent === "execute_request", "recognised as execute_request (verb-led, still refuses to execute directly)", out.audit.intent);
    ok(/I don't add anything from chat/.test(textOf(out.blocks)), "still states plainly that chat itself never sends anything");
    const drafts = draftsOf(out.blocks);
    const openDrafts = drafts.filter((d) => d.leagueName === "Combo League Open");
    const fullDrafts = drafts.filter((d) => d.leagueName === "Combo League Full");
    ok(openDrafts.length === 2 && openDrafts.every((d) => (d.params as { dropName: string | null }).dropName === null), "the open-roster league gets BOTH targets proposed straightforwardly, no drop needed — the combined syntax doesn't lose the ordinary open-slot leagues", JSON.stringify(openDrafts.map((d) => d.params)));
    ok(fullDrafts.length === 2, "the full-roster league gets both targets proposed too", String(fullDrafts.length));
    const byName = Object.fromEntries(fullDrafts.map((d) => [(d.params as { addName: string }).addName, (d.params as { dropName: string | null }).dropName]));
    ok(byName["Target One"] === "Tank Bigsby" && byName["Target Two"] === "Mike Washington", "in the full league, each target gets a DISTINCT name from the owner's own drop order, in the order given, all from one message", JSON.stringify(byName));
  }

  // ---------- 28. force_start with MULTIPLE named players in one command
  {
    const draftsOf = (blocks: Block[]) => blocks.filter((b): b is Extract<Block, { t: "drafts" }> => b.t === "drafts").flatMap((b) => b.drafts);
    const rpTwo = ["QB", "WR", "WR", "BN"];
    const settings = { roster_positions: rpTwo, settings: { reserve_slots: 1 } };
    const pm: PlayerMap = {
      fq: { n: "Force QB", p: "QB", t: "DAL" },
      p1: { n: "Force Player One", p: "WR", t: "ATL" },
      p2: { n: "Force Player Two", p: "WR", t: "LAR" },
      bench1: { n: "Better Projected Bench", p: "WR", t: "DAL" },
    };
    const proj: ProjectionMap = { fq: { pts_ppr: 20 }, p1: { pts_ppr: 5 }, p2: { pts_ppr: 5 }, bench1: { pts_ppr: 30 } };
    const future = new Date(NOW + 86_400_000).toISOString();
    // League A: both empty WR slots — both named players should win them over
    // the far-higher-projected bench player, in the SAME optimizer pass.
    const lA = { ...lg("1", "Force Multi A — both open", rpTwo), settings };
    const rA: RawRoster = { roster_id: 1, owner_id: ME, players: ["fq", "p1", "p2", "bench1"], starters: ["fq", "0", "0"], reserve: [], taxi: [] };
    // League B: only Player One is rostered here at all.
    const lB = { ...lg("2", "Force Multi B — only one rostered", rpTwo), settings };
    const rB: RawRoster = { roster_id: 1, owner_id: ME, players: ["fq", "p1", "bench1"], starters: ["fq", "0"], reserve: [], taxi: [] };
    // League C: Player One already starting, Player Two needs to be forced in.
    const lC = { ...lg("3", "Force Multi C — one already starting", rpTwo), settings };
    const rC: RawRoster = { roster_id: 1, owner_id: ME, players: ["fq", "p1", "p2", "bench1"], starters: ["fq", "p1", "0"], reserve: [], taxi: [] };
    const fx: LeagueFx[] = [
      { league: lA, rosters: [rA, otherRoster([])], txns: [] },
      { league: lB, rosters: [rB, otherRoster([])], txns: [] },
      { league: lC, rosters: [rC, otherRoster([])], txns: [] },
    ];
    const env = makeEnv(fx, pm, undefined, undefined, { projections: proj, week: 3 });
    env.permission = "PROPOSE_ONLY";
    env.kickoffs = async () => ({ ATL: future, LAR: future, DAL: future });
    const out = await handleCommand("make sure Force Player One and Force Player Two start this week", newSession(), env);
    ok(out.audit.intent === "force_start", "recognised as force_start with two mentions", out.audit.intent);
    const drafts = draftsOf(out.blocks);
    ok(drafts.length === 3, "all three leagues get a proposal (A: both forced, B: one forced, C: one forced)", String(drafts.length));

    const draftA = drafts.find((d) => d.leagueName === "Force Multi A — both open");
    const toStartersA = (draftA?.params as { toStarters: string[] } | undefined)?.toStarters;
    ok(!!toStartersA && toStartersA.includes("p1") && toStartersA.includes("p2"), "BOTH named players win their slots together in the same league, overriding a much higher-projected bench player", JSON.stringify(toStartersA));
    ok(!!draftA && draftA.rationale[0].includes("Force Player One") && draftA.rationale[0].includes("Force Player Two"), "the rationale names both players forced in that league, not just one", draftA?.rationale[0]);

    const draftB = drafts.find((d) => d.leagueName === "Force Multi B — only one rostered");
    const toStartersB = (draftB?.params as { toStarters: string[] } | undefined)?.toStarters;
    ok(!!toStartersB && toStartersB.includes("p1") && !toStartersB.includes("p2"), "a league where only one of the two is rostered only forces that one", JSON.stringify(toStartersB));

    const draftC = drafts.find((d) => d.leagueName === "Force Multi C — one already starting");
    ok(!!draftC && (draftC.params as { toStarters: string[] }).toStarters.includes("p2") && draftC.rationale[0] === "You asked to start Force Player Two here", "a league where one is already starting only reports forcing the OTHER one, never re-mentions the one already fine", draftC?.rationale[0]);

    const txt = textOf(out.blocks);
    ok(/Force Player One: already starting in 1 league, can be started in 2 more/.test(txt), "Player One's own per-player summary line is present and correct (already starting in League C)", txt.slice(0, 500));
    ok(/Force Player Two: already starting in 0 leagues, can be started in 2 more/.test(txt), "Player Two's own per-player summary line is present and correct, independent of Player One's", txt.slice(0, 500));

    // one of the two named players is genuinely Out — he's never force-started,
    // but that never blocks the OTHER player from being forced in the SAME league.
    const pmHurt: PlayerMap = { ...pm, p1: { ...pm.p1, inj: "Out" } };
    const envHurt = makeEnv([{ league: lA, rosters: [rA, otherRoster([])], txns: [] }], pmHurt, undefined, undefined, { projections: proj, week: 3 });
    envHurt.kickoffs = async () => ({ ATL: future, LAR: future, DAL: future });
    const outHurt = await handleCommand("make sure Force Player One and Force Player Two start this week", newSession(), envHurt);
    const draftsHurt = draftsOf(outHurt.blocks);
    ok(draftsHurt.length === 1, "still proposes the league, just for the one player who's actually available", String(draftsHurt.length));
    const toStartersHurt = (draftsHurt[0]?.params as { toStarters: string[] } | undefined)?.toStarters;
    ok(!!toStartersHurt && toStartersHurt.includes("p2") && !toStartersHurt.includes("p1"), "the Out player is never force-started even when named alongside a healthy one", JSON.stringify(toStartersHurt));
    ok(/Not started in 1 — his real status or bye makes him unavailable there; I never override that/.test(textOf(outHurt.blocks)), "the Out player's own line still explains why, honestly");
  }

  // ---------- 29. activate_ir with MULTIPLE named players — distinct drop per player
  {
    const draftsOf = (blocks: Block[]) => blocks.filter((b): b is Extract<Block, { t: "drafts" }> => b.t === "drafts").flatMap((b) => b.drafts);
    const rpFull = ["QB", "WR", "WR", "WR", "WR", "BN"];
    const settings = { roster_positions: rpFull, settings: { reserve_slots: 2 } };
    const pm: PlayerMap = {
      q: { n: "Multi IR QB", p: "QB", t: "DAL" },
      w1: { n: "Starter W1", p: "WR", t: "DAL" },
      w2: { n: "Starter W2", p: "WR", t: "DAL" },
      w3: { n: "Starter W3", p: "WR", t: "DAL" },
      w4: { n: "Starter W4", p: "WR", t: "DAL" },
      ab1: { n: "Weakest Multi Bench", p: "WR", t: "DAL" },
      ab2: { n: "Second Multi Bench", p: "WR", t: "DAL" },
      ir1: { n: "IR Guy One", p: "WR", t: "IND" },
      ir2: { n: "IR Guy Two", p: "WR", t: "IND" },
    };
    const sig = signals(pm, { values: { ab1: 5, ab2: 10 } });
    const league = { ...lg("1", "Multi Activate League", rpFull), settings };
    const roster: RawRoster = { roster_id: 1, owner_id: ME, players: ["q", "w1", "w2", "w3", "w4", "ab1", "ab2", "ir1", "ir2"], starters: ["q", "w1", "w2", "w3", "w4"], reserve: ["ir1", "ir2"], taxi: [] };
    const env = makeEnv([{ league, rosters: [roster, otherRoster([])], txns: [] }], pm, sig);
    env.permission = "PROPOSE_ONLY";
    const out = await handleCommand("Move IR Guy One and IR Guy Two off IR to my bench", newSession(), env);
    ok(out.audit.intent === "activate_ir", "recognised as activate_ir with two mentions", out.audit.intent);
    const drafts = draftsOf(out.blocks);
    ok(drafts.length === 2, "both named IR players get a real proposal in the one league", String(drafts.length));
    const byName = Object.fromEntries(drafts.map((d) => [(d.params as { playerName: string }).playerName, (d.params as { dropName: string | null }).dropName]));
    ok(byName["IR Guy One"] === "Weakest Multi Bench" && byName["IR Guy Two"] === "Second Multi Bench", "each gets a DISTINCT bench drop — never the same one twice, ordered by real Fantis value", JSON.stringify(byName));
    ok(/IR Guy One is on IR in 1 league/.test(textOf(out.blocks)) && /IR Guy Two is on IR in 1 league/.test(textOf(out.blocks)), "each named player gets his own independent summary line", textOf(out.blocks).slice(0, 500));
  }

  // ---------- 30. send_to_ir with MULTIPLE named players competing for one real IR slot
  {
    const draftsOf = (blocks: Block[]) => blocks.filter((b): b is Extract<Block, { t: "drafts" }> => b.t === "drafts").flatMap((b) => b.drafts);
    const rp = ["QB", "WR", "BN"];
    const settings = { roster_positions: rp, settings: { reserve_slots: 1, reserve_allow_out: 1 } };
    const pm: PlayerMap = {
      fq: { n: "Send Multi QB", p: "QB", t: "DAL" },
      p1: { n: "Send Player One", p: "WR", t: "IND", inj: "Out" },
      p2: { n: "Send Player Two", p: "WR", t: "IND", inj: "Out" },
    };
    const league = { ...lg("1", "Multi Send League — one slot", rp), settings };
    const roster: RawRoster = { roster_id: 1, owner_id: ME, players: ["fq", "p1", "p2"], starters: ["fq"], reserve: [], taxi: [] };
    const env = makeEnv([{ league, rosters: [roster, otherRoster([])], txns: [] }], pm);
    env.permission = "PROPOSE_ONLY";
    const out = await handleCommand("Put Send Player One and Send Player Two on IR", newSession(), env);
    ok(out.audit.intent === "send_to_ir", "recognised as send_to_ir with two mentions", out.audit.intent);
    const drafts = draftsOf(out.blocks);
    ok(drafts.length === 1, "only ONE real IR slot exists, so only one player gets a real proposal, not both", String(drafts.length));
    ok((drafts[0]?.params as { playerName: string }).playerName === "Send Player One", "the FIRST named player wins the one open slot (real severity/order accounting, not arbitrary)", (drafts[0]?.params as { playerName: string })?.playerName);
    ok(/Send Player Two is real IR-eligible in 1 league.*have a full IR/.test(textOf(out.blocks)), "the second player is honestly reported as blocked by the full IR, not silently dropped", textOf(out.blocks).slice(0, 600));
  }

  // ---------- 31. non-imperative "I want to X and drop Y" phrasing (not just "add X, drop Y")
  {
    const draftsOf = (blocks: Block[]) => blocks.filter((b): b is Extract<Block, { t: "drafts" }> => b.t === "drafts").flatMap((b) => b.drafts);
    const rp = ["QB", "WR", "BN"];
    const pm: PlayerMap = {
      fq: { n: "Natural QB", p: "QB", t: "DAL" },
      w1: { n: "Natural Starter", p: "WR", t: "DAL" },
      target: { n: "Jonah Coleman", p: "WR", t: "SEA" },
      bigsby: { n: "Tank Bigsby", p: "WR", t: "DAL" },
    };
    const settings = { roster_positions: rp, settings: { reserve_slots: 1, waiver_type: 2, waiver_bid_min: 2 } };
    const league = { ...lg("1", "Natural Phrasing League", rp), settings };
    // Full roster (QB + WR starter + bench, all filled) with Tank Bigsby on
    // the bench (not a starter) so he's a real, eligible drop candidate.
    const roster: RawRoster = { roster_id: 1, owner_id: ME, players: ["fq", "w1", "bigsby"], starters: ["fq", "w1"], reserve: [], taxi: [] };
    const env = makeEnv([{ league, rosters: [roster, otherRoster([])], txns: [] }], pm);
    env.permission = "PROPOSE_ONLY";
    // deliberately avoids the word "waiver" here — that's a real, separate
    // state filter (tested elsewhere); this test isolates the drop-order split.
    const out = await handleCommand("I want to add Jonah Coleman in all my leagues and drop Tank Bigsby", newSession(), env);
    ok(out.audit.intent === "execute_request", "a natural, non-imperative sentence is still recognised as an execute_request with a real drop order", out.audit.intent);
    const drafts = draftsOf(out.blocks);
    ok(drafts.length === 1 && (drafts[0]?.params as { dropName: string | null })?.dropName === "Tank Bigsby", "Tank Bigsby is correctly read as the drop order, not as a second player to add", JSON.stringify(drafts[0]?.params));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
