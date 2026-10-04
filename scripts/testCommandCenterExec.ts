// Tests for proposals, the Planning/Live permission model, the executor's
// gates, live re-validation, and verification. Fakes only — nothing here
// touches Sleeper or the database. Run: npx tsx scripts/testCommandCenterExec.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  activateIrDraft,
  addDraft,
  canSend,
  canTransition,
  draftKey,
  dropDraft,
  irDraft,
  sanitizeDraft,
  validateAgainstLive,
  type Proposal,
  type ProposalDraft,
} from "../lib/commandCenter/proposals";
import { describeProposal as describeProposal0 } from "../lib/commandCenter/proposals";
import { executeProposal, gate, type ExecDeps, type ExecWriters } from "../lib/commandCenterExec";
import type { CcLeague, LeagueSnapshot, SnapRoster } from "../lib/commandCenter/types";

let pass = 0;
let fail = 0;
function ok(cond: unknown, name: string, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
}

const NOW = Date.parse("2026-09-21T12:00:00Z");
const RP = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN", "BN", "BN", "BN"]; // 14 spots
const league = (id = "1", extraInner: Record<string, unknown> = {}): CcLeague => ({
  id,
  name: `League ${id}`,
  status: "in_season",
  settings: { roster_positions: RP, settings: { reserve_slots: 1, waiver_type: 2, waiver_bid_min: 0, ...extraInner } },
  rosterId: 1,
  ownerId: "me",
  bestBall: false,
});

const starters = ["q", "r1", "r2", "w1", "w2", "t", "f", "k", "d"];
const roster = (over: Partial<SnapRoster> = {}): SnapRoster => ({
  rosterId: 1,
  ownerId: "me",
  players: [...starters, "b1", "b2", "b3", "b4", "b5"], // 14 = full
  starters: [...starters],
  reserve: [],
  taxi: [],
  ...over,
});
const other = (players: string[]): SnapRoster => ({ rosterId: 2, ownerId: "them", players, starters: [], reserve: [], taxi: [] });
const snap = (lg: CcLeague, mine: SnapRoster, others: SnapRoster[] = [other([])]): LeagueSnapshot => ({
  league: lg,
  status: "SUCCESS",
  fetchedAt: NOW,
  rosters: [mine, ...others],
  recentDrops: {},
});

// ---- draft/proposal builders
const addD = (lg = league(), over: Partial<Parameters<typeof addDraft>[0]> = {}): ProposalDraft =>
  addDraft({ league: lg, addId: "new", addName: "New Guy", drop: { id: "b1", name: "Bench One" }, waiver: false, faab: true, bid: 5, rationale: ["r"], command: "cmd", ...over });
const asProposal = (d: ProposalDraft, status: Proposal["status"] = "proposed", id = "p1"): Proposal => ({ ...d, id, status, createdAt: NOW, updatedAt: NOW, events: [] });

// ---- a fake Sleeper: mutable rosters + writers that (optionally) apply their change
function fake(
  lg: CcLeague,
  initial: SnapRoster,
  opts: { applyWrites?: boolean; addDropError?: Error; pendingClaim?: boolean; writeError?: Error; irFailFirst?: Error; clearFails?: Error; activateError?: Error } = {}
) {
  let mine = { ...initial, players: [...initial.players], starters: [...initial.starters], reserve: [...initial.reserve], taxi: [...initial.taxi] };
  const calls = { add: 0, claim: 0, ir: 0, activate: 0, lineup: 0, reads: 0, tx: 0 };
  const apply = opts.applyWrites !== false;
  const writers: ExecWriters = {
    async addDropFreeAgent(_t, p) {
      calls.add++;
      if (opts.addDropError) throw opts.addDropError;
      if (opts.writeError) throw opts.writeError;
      if (apply) {
        if (p.dropPlayerId) {
          mine.players = mine.players.filter((x) => x !== p.dropPlayerId);
          mine.reserve = mine.reserve.filter((x) => x !== p.dropPlayerId);
          mine.taxi = mine.taxi.filter((x) => x !== p.dropPlayerId);
        }
        if (p.addPlayerId) mine.players.push(p.addPlayerId);
      }
      return {};
    },
    async claimWaiver() {
      calls.claim++;
      if (opts.writeError) throw opts.writeError;
      return {};
    },
    async moveToIR(_t, p) {
      calls.ir++;
      if (opts.irFailFirst && calls.ir === 1) throw opts.irFailFirst; // Sleeper rejects while he's a starter
      if (opts.writeError) throw opts.writeError;
      if (apply) mine.reserve.push(p.playerId);
      return {};
    },
    async activateFromIR(_t, p) {
      calls.activate++;
      if (opts.activateError) throw opts.activateError;
      if (opts.writeError) throw opts.writeError;
      if (apply) mine.reserve = mine.reserve.filter((id) => id !== p.playerId);
      return {};
    },
    async setStarters(_t, p) {
      calls.lineup++;
      if (opts.clearFails) throw opts.clearFails;
      if (opts.writeError) throw opts.writeError;
      if (apply) mine.starters = [...p.starters];
      return {};
    },
    async fetchLeagueTransactions(_t, p) {
      calls.tx++;
      return { trades: [], waivers: opts.pendingClaim ? [{ status: "processing", adds: { new: p.rosterId }, roster_ids: [p.rosterId] }] : [] };
    },
  };
  const deps = (over: Partial<ExecDeps> = {}): ExecDeps => ({
    permission: "LIVE",
    mode: "individual",
    token: "tok",
    week: 3,
    league: (id) => (id === lg.id ? lg : null),
    readSnapshot: async () => {
      calls.reads++;
      return snap(lg, mine);
    },
    injuryOf: () => null,
    isLocked: () => false,
    writers,
    isAuthError: (e) => e instanceof Error && /unauthorized/i.test(e.message),
    ...over,
  });
  return { calls, deps, get mine() { return mine; }, set mine(v: SnapRoster) { mine = v; } };
}

async function main() {
  // ============================================================ permission model
  ok(!canSend("PLANNING") && canSend("LIVE"), "sending needs Live mode");

  // ============================================================ state machine
  ok(canTransition("proposed", "executing") && canTransition("executing", "executed"), "happy path is legal: proposed sends straight to executing, no approval step");
  ok(canTransition("approved", "executing"), "a legacy 'approved' row (saved before the approval step was removed) can still be sent");
  ok(!canTransition("proposed", "executed") && !canTransition("approved", "executed"), "cannot jump to executed");
  ok(!canTransition("executed", "proposed") && !canTransition("failed", "proposed") && !canTransition("rejected", "proposed") && !canTransition("expired", "proposed"), "terminal states stay terminal");
  ok(canTransition("proposed", "rejected") && canTransition("approved", "rejected"), "can reject before running, from either status");
  ok(canTransition("executing", "verify_failed") && canTransition("executing", "submitted"), "execution can end unverified or as a pending claim");

  // ============================================================ sanitizing
  const good = sanitizeDraft({ ...addD(), extra: "ignored" });
  ok(!!good && good.kind === "ADD", "well-formed draft accepted");
  ok(sanitizeDraft({ ...addD(), leagueId: '1"}) { drop' }) === null, "league id must be numeric (GraphQL-injection guard)");
  ok(sanitizeDraft({ ...addD(), params: { ...addD().params, addId: 'a"b' } }) === null, "player id must be alphanumeric");
  ok(sanitizeDraft({ kind: "DELETE_LEAGUE", leagueId: "1", rosterId: 1, params: {} }) === null, "unknown kinds are rejected");
  ok(sanitizeDraft({ ...addD(), rosterId: -1 }) === null && sanitizeDraft({ ...addD(), rosterId: 1.5 }) === null, "roster id must be a positive integer");
  ok(draftKey(addD()) === draftKey(addD()) && draftKey(addD()) !== draftKey(addD(league("2"))), "dedupe key is stable per league+player");
  const lineup = { kind: "SET_LINEUP", leagueId: "1", leagueName: "L", rosterId: 1, params: { week: 3, fromStarters: ["a", "0"], toStarters: ["b", "0"], changes: [], gain: 2 }, rationale: [], origin: "chat", command: "" };
  ok(!!sanitizeDraft(lineup) && sanitizeDraft({ ...lineup, params: { ...lineup.params, toStarters: ["b"] } }) === null, "lineup arrays must match in length");

  // ============================================================ live validation
  {
    const lg = league();
    const live = (mine: SnapRoster, others = [other([])], injuryOf: (id: string) => string | null = () => null, isLocked = () => false) => ({ snapshot: snap(lg, mine, others), injuryOf, isLocked });
    const d = addD(lg);
    ok(validateAgainstLive(d, live(roster())).ok, "ADD: valid when roster full + drop on bench");
    ok(!validateAgainstLive(d, live(roster(), [other(["new"])])).ok, "ADD: expires if someone else rosters him");
    ok(!validateAgainstLive(addD(lg, { drop: null }), live(roster())).ok, "ADD: full roster without a drop is invalid");
    ok(!validateAgainstLive(d, live(roster({ players: [...starters, "b1"] }))).ok, "ADD: expires if the roster is no longer full but a drop was proposed");
    ok(!validateAgainstLive(d, live(roster({ starters: [...starters.slice(0, 8), "b1"] }))).ok, "ADD: expires if the drop became a starter");
    ok(!validateAgainstLive(d, live(roster({ reserve: ["b1"] }))).ok, "ADD: expires if the drop moved to IR");
    ok(!validateAgainstLive(d, live(roster({ players: roster().players.filter((x) => x !== "b1") }))).ok, "ADD: expires if the drop left the roster");
    const failedSnap: LeagueSnapshot = { ...snap(lg, roster()), status: "FAILED", rosters: null };
    ok(!validateAgainstLive(d, { snapshot: failedSnap, injuryOf: () => null, isLocked: () => false }).ok, "unreadable league → cannot validate → does not run");

    const ir = irDraft({ league: lg, playerId: "b2", playerName: "Hurt Guy", injury: "IR", rationale: [], command: "" });
    ok(validateAgainstLive(ir, live(roster(), [other([])], (id) => (id === "b2" ? "IR" : null))).ok, "IR: valid while still IR-listed with an open slot");
    ok(!validateAgainstLive(ir, live(roster(), [other([])], () => null)).ok, "IR: expires if he's healthy now");
    ok(!validateAgainstLive(ir, live(roster({ reserve: ["b3"] }), [other([])], () => "IR")).ok, "IR: expires if IR is now full");
    ok(!validateAgainstLive(ir, live(roster({ reserve: ["b2"] }), [other([])], () => "IR")).ok, "IR: expires if already on IR");

    const lu: ProposalDraft = { kind: "SET_LINEUP", leagueId: "1", leagueName: "L", rosterId: 1, origin: "chat", command: "", rationale: [], params: { week: 3, fromStarters: [...starters], toStarters: [...starters.slice(0, 8), "b1"], changes: [{ slot: "DEF", outName: "d", inName: "b1" }], gain: 3 } };
    ok(validateAgainstLive(lu, live(roster())).ok, "LINEUP: valid while the lineup is unchanged");
    ok(!validateAgainstLive(lu, live(roster({ starters: [...starters.slice(0, 8), "b2"] }))).ok, "LINEUP: expires if the lineup changed since proposed");
    ok(!validateAgainstLive(lu, live(roster(), [other([])], () => null, () => true)).ok, "LINEUP: expires if a game in the change has started");
    ok(!validateAgainstLive(lu, live(roster({ players: roster().players.filter((x) => x !== "b1") }))).ok, "LINEUP: expires if a player left the roster");
  }

  // ============================================================ the gate
  {
    const lg = league();
    const f = fake(lg, roster());
    const proposed = asProposal(addD(lg));
    ok(gate(proposed, f.deps()) === null, "gate opens for a proposed change in Live mode with access — no approval step needed");
    ok(gate(proposed, f.deps({ permission: "PLANNING" })) !== null, "gate closed in Planning mode");
    const legacyApproved = asProposal(addD(lg), "approved");
    ok(gate(legacyApproved, f.deps()) === null, "gate also opens for a legacy 'approved' row (saved before the approval step was removed)");
    ok(gate(asProposal(addD(lg), "rejected"), f.deps()) !== null && gate(asProposal(addD(lg), "executed"), f.deps()) !== null, "gate closed for rejected/already-executed");
    ok(gate(proposed, f.deps({ token: null })) !== null, "gate closed without Sleeper access");
    ok(gate(proposed, f.deps({ mode: "bulk", bulkEnabled: false })) !== null && gate(proposed, f.deps({ mode: "bulk", bulkEnabled: true })) === null, "bulk needs its own switch");
  }

  // ============================================================ execution: nothing sent unless valid
  {
    const lg = league();
    const blocked = fake(lg, roster());
    const r1 = await executeProposal(asProposal(addD(lg)), blocked.deps({ permission: "PLANNING" }));
    ok(r1.sent === false && blocked.calls.add + blocked.calls.claim === 0 && blocked.calls.reads === 0, "blocked by mode → no read, no write");

    const stale = fake(lg, roster());
    const r2 = await executeProposal(asProposal(addD(lg)), { ...stale.deps(), readSnapshot: async () => snap(lg, roster(), [other(["new"])]) });
    ok(r2.status === "expired" && r2.sent === false && stale.calls.add === 0, "changed since approval → 'expired', nothing sent", r2.message);

    const unread = fake(lg, roster());
    const r3 = await executeProposal(asProposal(addD(lg)), { ...unread.deps(), readSnapshot: async () => { throw new Error("503"); } });
    ok(r3.sent === false && unread.calls.add === 0, "can't re-read → nothing sent");
  }

  // ============================================================ execution: add / claim
  {
    const lg = league();
    const f = fake(lg, roster());
    const r = await executeProposal(asProposal(addD(lg)), f.deps());
    ok(r.status === "executed" && r.sent === true && f.calls.add === 1 && f.calls.claim === 0, "instant add → executed after a verifying re-read", r.message);
    ok(f.mine.players.includes("new") && !f.mine.players.includes("b1"), "fake roster shows the add + drop");
    ok(f.calls.reads === 2, "re-read before AND after", String(f.calls.reads));

    const silent = fake(lg, roster(), { applyWrites: false });
    const rs = await executeProposal(asProposal(addD(lg)), silent.deps());
    ok(rs.status === "verify_failed" && /Check Sleeper/.test(rs.message), "write returned OK but roster unchanged → verify_failed, never 'executed'", rs.status);

    const wv = fake(lg, roster(), { addDropError: new Error("Player is on waivers"), pendingClaim: true });
    const rw = await executeProposal(asProposal(addD(lg)), wv.deps());
    ok(rw.status === "submitted" && wv.calls.claim === 1 && wv.calls.add === 1, "add refused for waivers → falls back to a claim, verified pending", rw.message);
    const wv2 = fake(lg, roster(), { addDropError: new Error("Player is on waivers"), pendingClaim: false });
    const rw2 = await executeProposal(asProposal(addD(lg)), wv2.deps());
    ok(rw2.status === "verify_failed", "claim not seen pending → verify_failed");
    const direct = fake(lg, roster(), { pendingClaim: true });
    const rd = await executeProposal(asProposal(addD(lg, { waiver: true })), direct.deps());
    ok(rd.status === "submitted" && direct.calls.claim === 1 && direct.calls.add === 0, "scan said waiver → sends a claim directly, no instant add attempt");

    const auth = fake(lg, roster(), { writeError: new Error("Unauthorized") });
    const ra = await executeProposal(asProposal(addD(lg)), auth.deps());
    ok(ra.status === "failed" && ra.authError === true && auth.calls.add === 1, "rejected token → failed + authError (caller stops everything), single attempt no retry");
    const other2 = fake(lg, roster(), { writeError: new Error("Roster is full") });
    const ro = await executeProposal(asProposal(addD(lg)), other2.deps());
    ok(ro.status === "failed" && !ro.authError && other2.calls.add === 1, "other Sleeper error → failed, not retried");

    // double click
    const dbl = fake(lg, roster());
    const p = asProposal(addD(lg));
    const [a, b] = await Promise.all([executeProposal(p, dbl.deps()), executeProposal(p, dbl.deps())]);
    ok(dbl.calls.add === 1 && [a.status, b.status].includes("executed") && [a, b].some((x) => /already running/.test(x.message)), "double-click sends exactly one write");
  }

  // ============================================================ execution: IR + lineup
  {
    const lg = league();
    const f = fake(lg, roster());
    const ir = asProposal(irDraft({ league: lg, playerId: "b2", playerName: "Hurt Guy", injury: "IR", rationale: [], command: "" }));
    const r = await executeProposal(ir, f.deps({ injuryOf: (id) => (id === "b2" ? "IR" : null) }));
    ok(r.status === "executed" && f.calls.ir === 1 && f.mine.reserve.includes("b2"), "IR move executed and verified", r.message);
    const s = fake(lg, roster(), { applyWrites: false });
    const rs = await executeProposal(ir, s.deps({ injuryOf: () => "IR" }));
    ok(rs.status === "verify_failed", "IR write not reflected on re-read → verify_failed");
    const gone = fake(lg, roster());
    const rg = await executeProposal(ir, gone.deps({ injuryOf: () => null }));
    ok(rg.status === "expired" && gone.calls.ir === 0, "no longer IR-eligible → expired, no write");

    // Sleeper refuses to IR a player who is currently a starter until he's benched first
    // (same case BulkIR.tsx/lib/bulkPlan.ts already handle for the older direct tool).
    const starterIr = asProposal(irDraft({ league: lg, playerId: "q", playerName: "Starter Guy", injury: "IR", rationale: [], command: "" }));
    const bench = fake(lg, roster(), { irFailFirst: new Error("Cannot reserve a player in your starting lineup") });
    const rb = await executeProposal(starterIr, bench.deps({ injuryOf: (id) => (id === "q" ? "IR" : null) }));
    ok(rb.status === "executed" && bench.calls.lineup === 1 && bench.calls.ir === 2, "starter IR move: bench-then-retry succeeds and is verified", rb.message);
    ok(!bench.mine.starters.includes("q") && bench.mine.reserve.includes("q"), "starter cleared from the lineup and landed on IR", JSON.stringify(bench.mine));

    const benchFail = fake(lg, roster(), { irFailFirst: new Error("Cannot reserve a player in your starting lineup"), clearFails: new Error("Sleeper rejected the lineup change") });
    const rbf = await executeProposal(starterIr, benchFail.deps({ injuryOf: (id) => (id === "q" ? "IR" : null) }));
    ok(rbf.status === "failed" && /Cleared his lineup slot, but the IR move still failed/.test(rbf.message), "clear-then-retry: if the clear itself fails, reports both steps", rbf.message);
    ok(benchFail.calls.ir === 1 && benchFail.calls.lineup === 1, "one IR attempt, one clear attempt — no blind retry loop");

    const benchPlayer = asProposal(irDraft({ league: lg, playerId: "b3", playerName: "Bench Guy", injury: "IR", rationale: [], command: "" }));
    const notStarter = fake(lg, roster(), { writeError: new Error("Some other Sleeper error") });
    const rns = await executeProposal(benchPlayer, notStarter.deps({ injuryOf: (id) => (id === "b3" ? "IR" : null) }));
    ok(rns.status === "failed" && notStarter.calls.lineup === 0, "a bench player's IR failure never triggers a lineup clear attempt", rns.message);

    const lu: Proposal = asProposal({ kind: "SET_LINEUP", leagueId: "1", leagueName: "L", rosterId: 1, origin: "chat", command: "", rationale: [], params: { week: 3, fromStarters: [...starters], toStarters: [...starters.slice(0, 8), "b1"], changes: [{ slot: "DEF", outName: "d", inName: "b1" }], gain: 3 } });
    const fl = fake(lg, roster());
    const rl = await executeProposal(lu, fl.deps());
    ok(rl.status === "executed" && fl.calls.lineup === 1 && fl.mine.starters[8] === "b1", "lineup set and verified", rl.message);
    const flStale = fake(lg, roster({ starters: [...starters.slice(0, 8), "b2"] }));
    const rls = await executeProposal(lu, flStale.deps());
    ok(rls.status === "expired" && flStale.calls.lineup === 0, "lineup changed underneath → expired, no write");
  }

  // ============================================================ execution: activate from IR
  {
    const lg = league();
    // roster with one IR player and an open active spot (13 active + 1 IR = 14, roster size 14 → full already;
    // use a roster one short of the 14-slot limit so activating needs no drop)
    const openRoster = roster({ players: [...starters, "b1", "b2", "b3", "b4"], reserve: ["b4"] }); // 13 active, 1 IR
    const irPlayer = activateIrDraft({ league: lg, playerId: "b4", playerName: "Reserve Guy", drop: null, rationale: [], command: "" });
    const noDrop = fake(lg, openRoster);
    const r1 = await executeProposal(asProposal(irPlayer), noDrop.deps());
    ok(r1.status === "executed" && noDrop.calls.activate === 1 && noDrop.calls.add === 0 && !noDrop.mine.reserve.includes("b4"), "open roster: activated with no drop, verified", r1.message);

    // full roster (14/14 active) + 1 on IR → activating needs a drop, dropped FIRST then activated
    const fullRoster = roster({ players: [...starters, "b1", "b2", "b3", "b4", "b5", "b6"], reserve: ["b6"] }); // 14 active + 1 IR = 15 rostered
    const withDrop = activateIrDraft({ league: lg, playerId: "b6", playerName: "Reserve Guy 2", drop: { id: "b1", name: "Bench One" }, rationale: [], command: "" });
    const dropCase = fake(lg, fullRoster);
    const r2 = await executeProposal(asProposal(withDrop), dropCase.deps());
    ok(r2.status === "executed" && dropCase.calls.add === 1 && dropCase.calls.activate === 1, "full roster: drop sent before activation, both verified", r2.message);
    ok(!dropCase.mine.players.includes("b1") && !dropCase.mine.reserve.includes("b6") && dropCase.mine.players.includes("b6"), "the drop happened and he landed on the bench", JSON.stringify(dropCase.mine));

    // the drop fails → activation is never attempted at all
    const dropFails = fake(lg, fullRoster, { addDropError: new Error("Sleeper rejected the drop") });
    const r3 = await executeProposal(asProposal(withDrop), dropFails.deps());
    ok(r3.status === "failed" && dropFails.calls.add === 1 && dropFails.calls.activate === 0, "if the drop fails, activation is never attempted", r3.message);

    // live re-validation: no longer on IR → expired, nothing sent
    const notOnIr = fake(lg, roster());
    const r4 = await executeProposal(asProposal(irPlayer), notOnIr.deps());
    ok(r4.status === "expired" && notOnIr.calls.activate === 0, "player no longer on IR → expired, no write");

    // live re-validation: roster is now full but the proposal has no drop → expired
    const nowFull = fake(lg, fullRoster);
    const noDropNowFull = activateIrDraft({ league: lg, playerId: "b6", playerName: "Reserve Guy 2", drop: null, rationale: [], command: "" });
    const r6 = await executeProposal(asProposal(noDropNowFull), nowFull.deps());
    ok(r6.status === "expired" && nowFull.calls.activate === 0, "roster is now full and the proposal has no drop → expired, no write");

    // write succeeds but re-read doesn't confirm → verify_failed, never "executed"
    const silent = fake(lg, openRoster, { applyWrites: false });
    const r7 = await executeProposal(asProposal(irPlayer), silent.deps());
    ok(r7.status === "verify_failed", "activation sent but unconfirmed on re-read → verify_failed");
  }

  // ============================================================ execution: standalone release (DROP)
  {
    const lg = league();
    const full = roster(); // 14/14, b1..b5 on the bench, nobody on IR

    const releaseOnly = dropDraft({ league: lg, playerId: "b3", playerName: "Bench Three", rationale: [], command: "" });
    const clean = fake(lg, full);
    const r1 = await executeProposal(asProposal(releaseOnly), clean.deps());
    ok(r1.status === "executed" && clean.calls.add === 1 && !clean.mine.players.includes("b3"), "a bare release calls the same drop-only write and is verified", r1.message);
    ok(clean.mine.players.length === full.players.length - 1, "nobody is added in his place — the roster is simply smaller", String(clean.mine.players.length));

    // live re-validation: he's already gone (someone else released him, a trade, etc.) → expired
    const alreadyGone = fake(lg, roster({ players: starters.slice() })); // no bench at all, b3 not present
    const r2 = await executeProposal(asProposal(releaseOnly), alreadyGone.deps());
    ok(r2.status === "expired" && alreadyGone.calls.add === 0, "he's no longer on the roster → expired, no write sent");

    // Sleeper rejects the release
    const rejected = fake(lg, full, { addDropError: new Error("Sleeper rejected it") });
    const r3 = await executeProposal(asProposal(releaseOnly), rejected.deps());
    ok(r3.status === "failed", "Sleeper rejecting the release surfaces as failed, not a false success");

    // sent but unconfirmed on re-read → verify_failed, never claims success
    const unconfirmed = fake(lg, full, { applyWrites: false });
    const r4 = await executeProposal(asProposal(releaseOnly), unconfirmed.deps());
    ok(r4.status === "verify_failed", "release sent but a re-read still shows him rostered → verify_failed");

    // the release-then-IR-move sequence: two proposals, listed in order, run
    // one at a time by the bulk executor — proves the safety property that
    // makes pairing them work: the IR_MOVE is only valid once the release
    // has actually freed the slot.
    const fullIr = roster({ players: [...starters, "b1", "irGuy"], reserve: ["irGuy"] }); // IR already has 1/1 (league() defaults reserve_slots to 1)
    const release = dropDraft({ league: lg, playerId: "irGuy", playerName: "Current IR Guy", rationale: [], command: "" });
    const move = irDraft({ league: lg, playerId: "newIrGuy", playerName: "New IR Guy", injury: "IR", rationale: [], command: "" });
    const pair = fake(lg, { ...fullIr, players: [...fullIr.players, "newIrGuy"] });
    const injuryOf = (id: string) => (id === "newIrGuy" ? "IR" : null);
    const beforeRelease = await executeProposal(asProposal(move, "approved", "p-move"), pair.deps({ injuryOf }));
    ok(beforeRelease.status === "expired", "attempting the IR move BEFORE the release still correctly rejects — IR is still full", beforeRelease.message);
    const releaseResult = await executeProposal(asProposal(release, "approved", "p-release"), pair.deps({ injuryOf }));
    ok(releaseResult.status === "executed", "the release runs first and succeeds", releaseResult.message);
    const moveResult = await executeProposal(asProposal(move, "approved", "p-move-2"), pair.deps({ injuryOf }));
    ok(moveResult.status === "executed" && pair.mine.reserve.includes("newIrGuy"), "the IR move now succeeds — the slot the release freed is really being used, not assumed", moveResult.message);
  }

  // ============================================================ static separation
  {
    const dir = join(process.cwd(), "lib", "commandCenter");
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), "utf8");
      ok(!/commandCenterExec|sleeperWrite/.test(src.replace(/\/\/.*$/gm, "")), `engine module ${f} cannot reach the executor or the write layer`);
    }
    const exec = readFileSync(join(process.cwd(), "lib", "commandCenterExec.ts"), "utf8");
    ok(!/graphql|fetch\(/i.test(exec.replace(/\/\/.*$/gm, "")), "executor itself makes no raw requests — only injected writers");
  }

  // ============================================================ future-week lineups (set weeks ahead)
  {
    const lg = league();
    const toS = [...starters.slice(0, 8), "b1"];
    const fut: ProposalDraft = { kind: "SET_LINEUP", leagueId: "1", leagueName: "L", rosterId: 1, origin: "chat", command: "", rationale: [], params: { week: 5, future: true, fromStarters: [...starters], toStarters: toS, changes: [{ slot: "DEF", outName: "d", inName: "b1" }], gain: 3 } };
    const clean = sanitizeDraft(fut);
    ok(!!clean && (clean.params as { future?: boolean }).future === true && (clean.params as { week: number }).week === 5, "future flag and week survive sanitizing");
    ok(draftKey(fut) !== draftKey({ ...fut, params: { ...(fut.params as object), week: 6 } as never }), "each week of a league is its own proposal (no dedupe across weeks)");
    const live = (r: SnapRoster, inj: (id: string) => string | null = () => null, locked: (id: string) => boolean = () => false) => ({ snapshot: snap(lg, r), injuryOf: inj, isLocked: locked });
    ok(validateAgainstLive(asProposal(fut), live(roster({ starters: [...starters.slice(0, 8), "b2"] }))).ok, "FUTURE: this week's lineup changing doesn't expire a later week's lineup");
    ok(validateAgainstLive(asProposal(fut), live(roster(), () => null, () => true)).ok, "FUTURE: a game started THIS week doesn't block a later week's lineup");
    ok(!validateAgainstLive(asProposal(fut), live(roster({ players: roster().players.filter((x) => x !== "b1") }))).ok, "FUTURE: still expires if a player left the roster");
    ok(!validateAgainstLive(asProposal(fut), live(roster({ reserve: ["b1"] }))).ok, "FUTURE: still expires if a player is now on IR");
    ok(describeProposal0(fut).startsWith("Week 5 "), "FUTURE: description names the week");

    // executed only when the week's matchup shows the lineup
    const f1 = fake(lg, roster());
    const r1 = await executeProposal(asProposal(fut), f1.deps({ readWeekStarters: async () => toS }));
    ok(r1.status === "executed" && f1.calls.lineup === 1, "FUTURE: sent once and confirmed from that week's matchup", r1.status + " " + r1.message);
    const f2 = fake(lg, roster());
    const r2 = await executeProposal(asProposal(fut), f2.deps({ readWeekStarters: async () => [...starters] }));
    ok(r2.status === "verify_failed" && f2.calls.lineup === 1, "FUTURE: a matchup that doesn't match is verify_failed, never executed", r2.status);
    const f3 = fake(lg, roster());
    const r3 = await executeProposal(asProposal(fut), f3.deps());
    ok(r3.status === "verify_failed", "FUTURE: no way to re-read the week → verify_failed, never claimed done", r3.status);
    const f4 = fake(lg, roster());
    const r4 = await executeProposal(asProposal(fut), f4.deps({ readWeekStarters: async () => { throw new Error("503"); } }));
    ok(r4.status === "verify_failed", "FUTURE: a failed re-read is verify_failed", r4.status);
    const f5 = fake(lg, roster(), { writeError: new Error("rejected") });
    const r5 = await executeProposal(asProposal(fut), f5.deps({ readWeekStarters: async () => toS }));
    ok(r5.status === "failed", "FUTURE: a rejected write fails (no verification attempted)", r5.status);
    const f6 = fake(lg, roster());
    const r6 = await executeProposal(asProposal(fut), f6.deps({ permission: "PLANNING", readWeekStarters: async () => toS }));
    ok(f6.calls.lineup === 0 && r6.sent !== true, "FUTURE: Planning mode never sends");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
