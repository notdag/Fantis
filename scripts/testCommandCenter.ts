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
import type { RawMatchup } from "../lib/commandCenter/tools";

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
    const dropVariants = ["Who can I drop?", "Give me my worst 3", "What's my weakest player?", "Find the bottom 3 players on each roster."];
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
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
