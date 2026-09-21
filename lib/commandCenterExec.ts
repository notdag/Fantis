// The ONLY place the Command Center may change anything on Sleeper. Everything
// here goes through the existing, schema-checked write layer (lib/sleeperWrite.ts,
// injected as `writers` so it can be tested with fakes), and every path is gated:
//
//   1. the mode must allow it (Execute-approved / Auto-execute),
//   2. the proposal must be "approved" (a person clicked Approve, or — for the one
//      trusted auto rule — the rule that created it),
//   3. Sleeper access must be connected,
//   4. the proposal is RE-VALIDATED against a fresh live read; if the world changed
//      it is marked "expired" and nothing is sent,
//   5. one write, no automatic retry (writes here are not idempotent),
//   6. the result is VERIFIED by re-reading Sleeper. Success is only ever reported
//      after that; anything unconfirmed is "verify_failed", never "executed".
//
// The chat engine (lib/commandCenter/**) cannot import this file or the write layer.
import {
  atLeast,
  canAutoExecute,
  canExecuteApproved,
  validateAgainstLive,
  type AddParams,
  type IrParams,
  type LineupParams,
  type Permission,
  type Proposal,
  type ProposalStatus,
} from "./commandCenter/proposals";
import type { CcLeague, LeagueSnapshot } from "./commandCenter/types";

export interface ExecWriters {
  addDropFreeAgent(token: string, p: { leagueId: string; rosterId: number; addPlayerId?: string; dropPlayerId?: string }): Promise<unknown>;
  claimWaiver(token: string, p: { leagueId: string; rosterId: number; addPlayerId: string; dropPlayerId?: string; bid: number }): Promise<unknown>;
  moveToIR(token: string, p: { leagueId: string; rosterId: number; playerId: string }): Promise<unknown>;
  setStarters(token: string, p: { leagueId: string; rosterId: number; starters: string[]; week: number }): Promise<unknown>;
  fetchLeagueTransactions(
    token: string,
    p: { leagueId: string; rosterId: number }
  ): Promise<{ trades: unknown[]; waivers: { status: string; adds?: Record<string, number> | null; roster_ids?: number[] | null }[] }>;
}

export type ExecMode = "individual" | "bulk" | "auto";

export interface ExecDeps {
  permission: Permission;
  mode: ExecMode;
  bulkEnabled?: boolean; // Phase 4 switch, off unless the owner turned it on
  autoRuleEnabled?: boolean; // Phase 5 rule switch
  token: string | null;
  league: (leagueId: string) => CcLeague | null;
  readSnapshot: (league: CcLeague) => Promise<LeagueSnapshot>; // FRESH read, never cached
  injuryOf: (playerId: string) => string | null;
  isLocked: (playerId: string) => boolean;
  writers: ExecWriters;
  isAuthError: (e: unknown) => boolean;
}

export interface ExecResult {
  status: ProposalStatus; // the status the proposal should move to
  message: string; // plain-language outcome, stored in the proposal's event log
  authError?: boolean; // Sleeper rejected the login token — stop everything
  sent?: boolean; // whether a write was actually sent to Sleeper
}

const FINISHED_WAIVER = new Set(["complete", "completed", "failed", "cancelled", "canceled", "rejected", "vetoed", "expired"]);

// One at a time per proposal: a double click can never send it twice.
const inFlight = new Set<string>();

// Auto rule scope, re-checked at execution time (not trusted from the row alone).
const AUTO_IR = new Set(["IR", "PUP"]);

export function gate(p: Proposal, d: ExecDeps): string | null {
  if (d.mode === "auto") {
    if (!canAutoExecute(d.permission)) return "Auto-execute mode is not enabled";
    if (!d.autoRuleEnabled) return "the auto rule is switched off";
    if (p.origin !== "auto" || p.kind !== "IR_MOVE") return "only the trusted IR/PUP auto rule can run automatically";
    if (!AUTO_IR.has((p.params as IrParams).injury)) return "the auto rule only covers players listed IR or PUP";
  } else if (!canExecuteApproved(d.permission)) {
    return "the current mode doesn't allow executing — switch to Execute approved";
  }
  if (d.mode === "bulk" && (!d.bulkEnabled || !atLeast(d.permission, "EXECUTE_APPROVED"))) return "bulk execution is switched off";
  if (p.status !== "approved") return `it hasn't been approved (status: ${p.status})`;
  if (!d.token) return "Sleeper access isn't connected";
  return null;
}

export async function executeProposal(p: Proposal, d: ExecDeps): Promise<ExecResult> {
  const blocked = gate(p, d);
  if (blocked) return { status: "failed", message: `Not sent — ${blocked}.`, sent: false };
  if (inFlight.has(p.id)) return { status: "failed", message: "Not sent — this proposal is already running.", sent: false };
  inFlight.add(p.id);
  try {
    const league = d.league(p.leagueId);
    if (!league) return { status: "expired", message: "Not sent — this league is no longer in your synced leagues.", sent: false };

    // 4. re-validate against a fresh read
    let snap: LeagueSnapshot;
    try {
      snap = await d.readSnapshot(league);
    } catch (e) {
      return { status: "failed", message: `Not sent — couldn't re-read the league first (${msg(e)}).`, sent: false };
    }
    const v = validateAgainstLive(p, { snapshot: snap, injuryOf: d.injuryOf, isLocked: d.isLocked });
    if (!v.ok) return { status: "expired", message: `Not sent — no longer valid: ${v.reason}.`, sent: false };

    const token = d.token as string;
    // 5 + 6. one write, then verify
    switch (p.kind) {
      case "ADD":
        return await runAdd(p, league, token, d);
      case "IR_MOVE":
        return await runIr(p, league, token, d);
      case "SET_LINEUP":
        return await runLineup(p, league, token, d);
    }
  } finally {
    inFlight.delete(p.id);
  }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const failed = (d: ExecDeps, e: unknown, what: string): ExecResult => ({
  status: "failed",
  message: `${what} failed: ${msg(e)}`,
  authError: d.isAuthError(e),
  sent: true,
});

async function reread(league: CcLeague, d: ExecDeps): Promise<LeagueSnapshot | null> {
  try {
    const s = await d.readSnapshot(league);
    return s.rosters ? s : null;
  } catch {
    return null;
  }
}
const myRoster = (s: LeagueSnapshot) => s.rosters?.find((r) => r.rosterId === s.league.rosterId) ?? null;

async function runAdd(p: Proposal, league: CcLeague, token: string, d: ExecDeps): Promise<ExecResult> {
  const a = p.params as AddParams;
  const base = { leagueId: p.leagueId, rosterId: p.rosterId, addPlayerId: a.addId, dropPlayerId: a.dropId ?? undefined };
  let viaClaim = a.expectWaiver;
  try {
    if (viaClaim) {
      await d.writers.claimWaiver(token, { ...base, addPlayerId: a.addId, bid: a.bid });
    } else {
      try {
        await d.writers.addDropFreeAgent(token, base);
      } catch (e) {
        // A player still on waivers can't be a straight add — Sleeper says so in the error.
        if (e instanceof Error && /waiver/i.test(e.message) && !d.isAuthError(e)) {
          viaClaim = true;
          await d.writers.claimWaiver(token, { ...base, addPlayerId: a.addId, bid: a.bid });
        } else throw e;
      }
    }
  } catch (e) {
    return failed(d, e, viaClaim ? "Waiver claim" : "Add");
  }

  if (viaClaim) {
    // A claim isn't "done" until the waiver runs. Verified = we can see it pending.
    try {
      const tx = await d.writers.fetchLeagueTransactions(token, { leagueId: p.leagueId, rosterId: p.rosterId });
      const seen = tx.waivers.some((w) => !FINISHED_WAIVER.has(w.status) && !!w.adds && a.addId in w.adds && (w.roster_ids ?? []).includes(p.rosterId));
      if (seen) return { status: "submitted", message: `Waiver claim for ${a.addName} sent and confirmed pending on Sleeper${a.dropName ? ` (drop ${a.dropName})` : ""}. It isn't final until the waiver run.`, sent: true };
    } catch {
      // fall through to unverified
    }
    return { status: "verify_failed", message: `Claim for ${a.addName} was sent, but I couldn't see it pending on Sleeper — check the app before assuming it went through.`, sent: true };
  }

  const after = await reread(league, d);
  const me = after && myRoster(after);
  if (me && me.players.includes(a.addId) && (!a.dropId || !me.players.includes(a.dropId))) {
    return { status: "executed", message: `Added ${a.addName}${a.dropName ? ` and dropped ${a.dropName}` : ""} — confirmed on Sleeper.`, sent: true };
  }
  return { status: "verify_failed", message: `The add was sent, but a re-read of your roster doesn't show ${a.addName}${a.dropName ? ` / the drop of ${a.dropName}` : ""}. Check Sleeper before doing anything else.`, sent: true };
}

async function runIr(p: Proposal, league: CcLeague, token: string, d: ExecDeps): Promise<ExecResult> {
  const a = p.params as IrParams;
  try {
    await d.writers.moveToIR(token, { leagueId: p.leagueId, rosterId: p.rosterId, playerId: a.playerId });
  } catch (e) {
    return failed(d, e, "Move to IR");
  }
  const after = await reread(league, d);
  const me = after && myRoster(after);
  if (me && me.reserve.includes(a.playerId)) return { status: "executed", message: `${a.playerName} moved to IR — confirmed on Sleeper.`, sent: true };
  return { status: "verify_failed", message: `The IR move was sent, but a re-read doesn't show ${a.playerName} on IR. Check Sleeper.`, sent: true };
}

async function runLineup(p: Proposal, league: CcLeague, token: string, d: ExecDeps): Promise<ExecResult> {
  const a = p.params as LineupParams;
  try {
    await d.writers.setStarters(token, { leagueId: p.leagueId, rosterId: p.rosterId, starters: a.toStarters, week: a.week });
  } catch (e) {
    return failed(d, e, "Lineup change");
  }
  const after = await reread(league, d);
  const me = after && myRoster(after);
  if (me && me.starters.length === a.toStarters.length && a.toStarters.every((id, i) => (me.starters[i] || "0") === id)) {
    return { status: "executed", message: `Lineup set (${a.changes.length} change${a.changes.length === 1 ? "" : "s"}) — confirmed on Sleeper.`, sent: true };
  }
  return { status: "verify_failed", message: "The lineup was sent, but a re-read doesn't match what was proposed. Check Sleeper.", sent: true };
}
