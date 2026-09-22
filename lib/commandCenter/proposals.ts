// Proposals: the structured, reviewable form of "a change Fantis could make".
// PURE — no fetching, no Sleeper calls, no writes. The read-only engine produces
// drafts; a person approves them; a separate executor (lib/commandCenterExec.ts,
// the only place that may call the Sleeper write layer) carries out approved
// ones. This file also owns the permission ladder and the status state machine
// so the rules live in one tested place.
import { irAllowed, irSlots } from "../bulkPlan";
import { activeCount, rosterPositions } from "./classify";
import type { CcLeague, LeagueSnapshot, Permission, SnapRoster } from "./types";

// ------------------------------------------------------------ permissions

export type { Permission };

export const PERMISSION_ORDER: Permission[] = ["READ_ONLY", "PROPOSE_ONLY", "EXECUTE_APPROVED", "AUTO_EXECUTE"];

export const PERMISSION_LABEL: Record<Permission, string> = {
  READ_ONLY: "Read-only",
  PROPOSE_ONLY: "Propose only",
  EXECUTE_APPROVED: "Execute approved",
  AUTO_EXECUTE: "Auto-execute (trusted rules)",
};

export const PERMISSION_BLURB: Record<Permission, string> = {
  READ_ONLY: "Scan and recommend. Nothing can be saved or changed.",
  PROPOSE_ONLY: "Also save proposals for review. Nothing is sent to Sleeper.",
  EXECUTE_APPROVED: "Also send a proposal to Sleeper, but only after you approve that specific one and confirm it.",
  AUTO_EXECUTE: "Also run a few narrow rules you switch on yourself while this page is open. Everything is logged and verified.",
};

const rank = (p: Permission) => PERMISSION_ORDER.indexOf(p);
export const atLeast = (p: Permission, min: Permission) => rank(p) >= rank(min);
export const canPropose = (p: Permission) => atLeast(p, "PROPOSE_ONLY");
export const canExecuteApproved = (p: Permission) => atLeast(p, "EXECUTE_APPROVED");
export const canAutoExecute = (p: Permission) => p === "AUTO_EXECUTE";
export const isPermission = (v: unknown): v is Permission => typeof v === "string" && (PERMISSION_ORDER as string[]).includes(v);

// ---------------------------------------------------------------- proposals

export type ProposalKind = "ADD" | "IR_MOVE" | "ACTIVATE_IR" | "SET_LINEUP";

export interface AddParams {
  addId: string;
  addName: string;
  dropId: string | null;
  dropName: string | null;
  faab: boolean;
  bid: number;
  expectWaiver: boolean; // the scan saw him on waivers, so send a claim, not an instant add
}
export interface IrParams {
  playerId: string;
  playerName: string;
  injury: string;
}
export interface ActivateIrParams {
  playerId: string;
  playerName: string;
  dropId: string | null; // needed only if moving him off IR would put the active roster over the limit
  dropName: string | null;
}
export interface LineupParams {
  week: number;
  fromStarters: string[]; // the lineup this was computed against — must still be current
  toStarters: string[];
  changes: { slot: string; outName: string | null; inName: string | null }[];
  gain: number; // projected points gained (Sleeper's own projections)
}

export type ProposalParams = AddParams | IrParams | ActivateIrParams | LineupParams;

export interface ProposalDraft {
  kind: ProposalKind;
  leagueId: string;
  leagueName: string;
  rosterId: number;
  params: ProposalParams;
  rationale: string[];
  origin: "chat" | "auto";
  command: string;
}

export type ProposalStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "expired" // the world changed before it could run — must be re-proposed
  | "executing"
  | "executed" // sent AND verified on Sleeper
  | "submitted" // waiver claim sent and seen pending (can't be "done" until the waiver runs)
  | "failed" // Sleeper rejected it or the request errored
  | "verify_failed"; // sent, but a re-read could not confirm the result

export interface ProposalEvent {
  at: number;
  status: ProposalStatus;
  message: string;
}

export interface Proposal extends ProposalDraft {
  id: string;
  status: ProposalStatus;
  createdAt: number;
  updatedAt: number;
  events: ProposalEvent[];
}

// Legal moves only. In particular nothing but "approved" can become "executing",
// and "executed"/"submitted" can only be reached from "executing".
const NEXT: Record<ProposalStatus, ProposalStatus[]> = {
  proposed: ["approved", "rejected", "expired"],
  approved: ["proposed", "rejected", "expired", "executing"],
  executing: ["executed", "submitted", "failed", "verify_failed", "expired"],
  executed: [],
  submitted: [],
  rejected: [],
  expired: [],
  failed: [],
  verify_failed: [],
};
export const canTransition = (from: ProposalStatus, to: ProposalStatus) => NEXT[from].includes(to);
export const isTerminal = (s: ProposalStatus) => NEXT[s].length === 0;

export const KIND_LABEL: Record<ProposalKind, string> = { ADD: "Add / claim", IR_MOVE: "Move to IR", ACTIVATE_IR: "Activate from IR", SET_LINEUP: "Set lineup" };

export function describeProposal(d: Pick<ProposalDraft, "kind" | "params" | "leagueName">): string {
  switch (d.kind) {
    case "ADD": {
      const p = d.params as AddParams;
      const verb = p.expectWaiver ? `Waiver claim ${p.addName}` : `Add ${p.addName}`;
      return `${verb}${p.dropName ? `, drop ${p.dropName}` : ", no drop"}${p.expectWaiver && p.faab ? ` (bid $${p.bid})` : ""}`;
    }
    case "IR_MOVE": {
      const p = d.params as IrParams;
      return `Move ${p.playerName} (${p.injury}) to IR`;
    }
    case "ACTIVATE_IR": {
      const p = d.params as ActivateIrParams;
      return `Move ${p.playerName} from IR to bench${p.dropName ? `, drop ${p.dropName}` : ", no drop"}`;
    }
    case "SET_LINEUP": {
      const p = d.params as LineupParams;
      const suffix = p.gain >= 0.05 ? `(+${p.gain.toFixed(1)} projected)` : "(slot fix — no point change)";
      return `Set lineup: ${p.changes.map((c) => `${c.inName ?? "empty"} for ${c.outName ?? "empty"} at ${c.slot}`).join("; ")} ${suffix}`;
    }
  }
}

// ---------------------------------------------------------------- builders

export function addDraft(args: {
  league: CcLeague;
  addId: string;
  addName: string;
  drop: { id: string; name: string } | null;
  waiver: boolean;
  faab: boolean;
  bid?: number;
  rationale: string[];
  command: string;
}): ProposalDraft {
  return {
    kind: "ADD",
    leagueId: args.league.id,
    leagueName: args.league.name,
    rosterId: args.league.rosterId,
    params: {
      addId: args.addId,
      addName: args.addName,
      dropId: args.drop?.id ?? null,
      dropName: args.drop?.name ?? null,
      faab: args.faab,
      bid: Math.max(0, Math.trunc(args.bid ?? 0)),
      expectWaiver: args.waiver,
    },
    rationale: args.rationale,
    origin: "chat",
    command: args.command,
  };
}

export function irDraft(args: { league: CcLeague; playerId: string; playerName: string; injury: string; rationale: string[]; command: string; origin?: "chat" | "auto" }): ProposalDraft {
  return {
    kind: "IR_MOVE",
    leagueId: args.league.id,
    leagueName: args.league.name,
    rosterId: args.league.rosterId,
    params: { playerId: args.playerId, playerName: args.playerName, injury: args.injury },
    rationale: args.rationale,
    origin: args.origin ?? "chat",
    command: args.command,
  };
}

export function activateIrDraft(args: {
  league: CcLeague;
  playerId: string;
  playerName: string;
  drop: { id: string; name: string } | null;
  rationale: string[];
  command: string;
}): ProposalDraft {
  return {
    kind: "ACTIVATE_IR",
    leagueId: args.league.id,
    leagueName: args.league.name,
    rosterId: args.league.rosterId,
    params: { playerId: args.playerId, playerName: args.playerName, dropId: args.drop?.id ?? null, dropName: args.drop?.name ?? null },
    rationale: args.rationale,
    origin: "chat",
    command: args.command,
  };
}

// ------------------------------------------------------ live re-validation

export interface LiveContext {
  snapshot: LeagueSnapshot; // FRESH read taken immediately before executing
  injuryOf: (playerId: string) => string | null;
  isLocked: (playerId: string) => boolean; // his game has started
}

export type Validation = { ok: true } | { ok: false; reason: string };
const no = (reason: string): Validation => ({ ok: false, reason });

function mine(snapshot: LeagueSnapshot): SnapRoster | null {
  return snapshot.rosters?.find((r) => r.rosterId === snapshot.league.rosterId) ?? null;
}

// Everything approved on Monday must still be true when it runs on Tuesday.
// Returns the first reason it isn't; the executor then marks the proposal
// "expired" instead of sending anything.
export function validateAgainstLive(p: Pick<ProposalDraft, "kind" | "params" | "rosterId">, live: LiveContext): Validation {
  const snap = live.snapshot;
  if (snap.status === "FAILED" || !snap.rosters) return no("couldn't re-read the league to confirm this is still valid");
  const me = mine(snap);
  if (!me || me.rosterId !== p.rosterId) return no("couldn't confirm which roster is yours");
  const settings = snap.league.settings;

  switch (p.kind) {
    case "ADD": {
      const a = p.params as AddParams;
      if (snap.rosters.some((r) => r.players.includes(a.addId))) return no(`${a.addName} is no longer available — a team has rostered him`);
      const limit = rosterPositions(settings)?.length ?? null;
      const active = activeCount(snap);
      const full = limit != null && active != null ? active >= limit : null;
      if (full === null) return no("couldn't read your roster size to confirm the drop requirement");
      if (full && !a.dropId) return no("your roster is full and this proposal has no drop");
      if (!full && a.dropId) return no("your roster is no longer full — re-propose without the drop");
      if (a.dropId) {
        if (!me.players.includes(a.dropId)) return no(`${a.dropName ?? "the drop"} is no longer on your roster`);
        if (me.starters.includes(a.dropId)) return no(`${a.dropName ?? "the drop"} is now in your starting lineup`);
        if (me.reserve.includes(a.dropId) || me.taxi.includes(a.dropId)) return no(`${a.dropName ?? "the drop"} is on IR/taxi — dropping him wouldn't free a roster spot`);
      }
      return { ok: true };
    }
    case "IR_MOVE": {
      const a = p.params as IrParams;
      if (!me.players.includes(a.playerId)) return no(`${a.playerName} is no longer on your roster`);
      if (me.reserve.includes(a.playerId)) return no(`${a.playerName} is already on IR`);
      const inj = live.injuryOf(a.playerId);
      if (!irAllowed(settings, inj)) return no(`${a.playerName}'s current status (${inj ?? "healthy"}) isn't IR-eligible in this league`);
      if (me.reserve.length >= irSlots(settings)) return no("IR is now full");
      return { ok: true };
    }
    case "ACTIVATE_IR": {
      const a = p.params as ActivateIrParams;
      if (!me.reserve.includes(a.playerId)) return no(`${a.playerName} is no longer on IR`);
      const limit = rosterPositions(settings)?.length ?? null;
      const activeAfter = activeCount(snap) != null ? (activeCount(snap) as number) + 1 : null;
      const needsDrop = limit != null && activeAfter != null ? activeAfter > limit : null;
      if (needsDrop === null) return no("couldn't read your roster size to confirm the drop requirement");
      if (needsDrop && !a.dropId) return no("activating him now needs a drop and this proposal has none");
      if (!needsDrop && a.dropId) return no("a drop is no longer needed to activate him — re-propose without one");
      if (a.dropId) {
        if (!me.players.includes(a.dropId)) return no(`${a.dropName ?? "the drop"} is no longer on your roster`);
        if (me.starters.includes(a.dropId)) return no(`${a.dropName ?? "the drop"} is now in your starting lineup`);
        if (me.reserve.includes(a.dropId)) return no(`${a.dropName ?? "the drop"} is on IR — dropping him wouldn't free an active roster spot`);
      }
      return { ok: true };
    }
    case "SET_LINEUP": {
      const a = p.params as LineupParams;
      if (a.fromStarters.length !== me.starters.length || a.fromStarters.some((id, i) => (me.starters[i] ?? "0") !== id)) {
        return no("your lineup changed since this was proposed");
      }
      const off = new Set([...me.reserve, ...me.taxi]);
      for (const id of a.toStarters) {
        if (id === "0" || id === "") continue;
        if (!me.players.includes(id)) return no("a player in the proposed lineup is no longer on your roster");
        if (off.has(id)) return no("a player in the proposed lineup is now on IR/taxi");
      }
      for (let i = 0; i < a.toStarters.length; i++) {
        if (a.toStarters[i] !== a.fromStarters[i]) {
          const out = a.fromStarters[i];
          const inn = a.toStarters[i];
          if ((out && out !== "0" && live.isLocked(out)) || (inn && inn !== "0" && live.isLocked(inn))) return no("a game in this change has already started");
        }
      }
      return { ok: true };
    }
  }
}

// -------------------------------------------------- auto-execution (Phase 5)

// A trusted rule is deliberately tiny and reversible. Today there is exactly one:
// move a player Sleeper lists as IR or PUP to an OPEN IR slot in a league whose own
// rules allow it. Never Out/Doubtful/Questionable, never anything that needs a
// drop, never a lineup or waiver change.
export interface AutoConfig {
  enabled: boolean; // master switch for the runner
  irMove: boolean; // the one rule
  maxPerRun: number;
  maxPerDay: number;
  intervalMin: number;
}
export const DEFAULT_AUTO: AutoConfig = { enabled: false, irMove: false, maxPerRun: 10, maxPerDay: 30, intervalMin: 15 };

export function normalizeAuto(v: unknown): AutoConfig {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const n = (x: unknown, d: number, lo: number, hi: number) => (typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.trunc(x))) : d);
  return {
    enabled: o.enabled === true,
    irMove: o.irMove === true,
    maxPerRun: n(o.maxPerRun, DEFAULT_AUTO.maxPerRun, 1, 25),
    maxPerDay: n(o.maxPerDay, DEFAULT_AUTO.maxPerDay, 1, 100),
    intervalMin: n(o.intervalMin, DEFAULT_AUTO.intervalMin, 5, 240),
  };
}

const AUTO_IR_STATUSES = new Set(["IR", "PUP"]);

export function selectAutoIrMoves(
  snapshots: LeagueSnapshot[],
  injuryOf: (playerId: string) => string | null,
  nameOf: (playerId: string) => string,
  budget: number
): ProposalDraft[] {
  const out: ProposalDraft[] = [];
  for (const snap of snapshots) {
    if (out.length >= budget) break;
    if (snap.status === "FAILED" || !snap.rosters) continue;
    const me = mine(snap);
    if (!me) continue;
    const settings = snap.league.settings;
    let open = irSlots(settings) - me.reserve.length;
    if (open <= 0) continue;
    for (const id of me.players) {
      if (open <= 0 || out.length >= budget) break;
      if (me.reserve.includes(id)) continue;
      const inj = injuryOf(id);
      if (!inj || !AUTO_IR_STATUSES.has(inj) || !irAllowed(settings, inj)) continue;
      open--;
      out.push(
        irDraft({
          league: snap.league,
          playerId: id,
          playerName: nameOf(id),
          injury: inj,
          rationale: [`Sleeper lists ${nameOf(id)} as ${inj}`, "This league has an open IR slot and allows it", "Auto rule: IR/PUP → open IR slot (no drop, no lineup change)"],
          command: "auto: IR/PUP → open IR slot",
          origin: "auto",
        })
      );
    }
  }
  return out;
}

// ------------------------------------------------------------- sanitizing

const idStr = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9]{1,32}$/.test(v);
const short = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
const strArr = (v: unknown, n: number, len: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, n).map((x) => x.slice(0, len)) : []);

// Untrusted input (the API body) → a well-formed draft, or null. Only fields the
// executor understands survive; ids must be plain alphanumerics because they are
// later placed into GraphQL text.
export function sanitizeDraft(x: unknown): ProposalDraft | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const kind = o.kind;
  if (kind !== "ADD" && kind !== "IR_MOVE" && kind !== "ACTIVATE_IR" && kind !== "SET_LINEUP") return null;
  if (!idStr(o.leagueId) || !/^[0-9]+$/.test(String(o.leagueId))) return null;
  if (typeof o.rosterId !== "number" || !Number.isInteger(o.rosterId) || o.rosterId < 1) return null;
  const p = (o.params && typeof o.params === "object" ? o.params : {}) as Record<string, unknown>;
  let params: ProposalParams;
  if (kind === "ADD") {
    if (!idStr(p.addId)) return null;
    if (p.dropId != null && !idStr(p.dropId)) return null;
    params = {
      addId: p.addId as string,
      addName: short(p.addName, 80),
      dropId: (p.dropId as string | null | undefined) ?? null,
      dropName: p.dropName == null ? null : short(p.dropName, 80),
      faab: p.faab === true,
      bid: typeof p.bid === "number" && Number.isFinite(p.bid) ? Math.max(0, Math.min(10000, Math.trunc(p.bid))) : 0,
      expectWaiver: p.expectWaiver === true,
    };
  } else if (kind === "IR_MOVE") {
    if (!idStr(p.playerId)) return null;
    params = { playerId: p.playerId as string, playerName: short(p.playerName, 80), injury: short(p.injury, 20) };
  } else if (kind === "ACTIVATE_IR") {
    if (!idStr(p.playerId)) return null;
    if (p.dropId != null && !idStr(p.dropId)) return null;
    params = { playerId: p.playerId as string, playerName: short(p.playerName, 80), dropId: (p.dropId as string | null | undefined) ?? null, dropName: p.dropName == null ? null : short(p.dropName, 80) };
  } else {
    const from = strArr(p.fromStarters, 40, 32);
    const to = strArr(p.toStarters, 40, 32);
    if (from.length === 0 || from.length !== to.length || ![...from, ...to].every((id) => id === "0" || idStr(id))) return null;
    const week = typeof p.week === "number" ? Math.trunc(p.week) : 0;
    if (week < 1 || week > 25) return null;
    const changes = Array.isArray(p.changes)
      ? (p.changes as Record<string, unknown>[]).slice(0, 40).map((c) => ({ slot: short(c?.slot, 20), outName: c?.outName == null ? null : short(c.outName, 80), inName: c?.inName == null ? null : short(c.inName, 80) }))
      : [];
    params = { week, fromStarters: from, toStarters: to, changes, gain: typeof p.gain === "number" && Number.isFinite(p.gain) ? Math.round(p.gain * 10) / 10 : 0 };
  }
  return {
    kind,
    leagueId: String(o.leagueId),
    leagueName: short(o.leagueName, 120),
    rosterId: o.rosterId,
    params,
    rationale: strArr(o.rationale, 12, 240),
    origin: o.origin === "auto" ? "auto" : "chat",
    command: short(o.command, 200),
  };
}

// A stable identity for "the same change", so proposing it twice doesn't queue it twice.
export function draftKey(d: Pick<ProposalDraft, "kind" | "leagueId" | "params">): string {
  switch (d.kind) {
    case "ADD":
      return `ADD:${d.leagueId}:${(d.params as AddParams).addId}`;
    case "IR_MOVE":
      return `IR:${d.leagueId}:${(d.params as IrParams).playerId}`;
    case "ACTIVATE_IR":
      return `ACTIVATE:${d.leagueId}:${(d.params as ActivateIrParams).playerId}`;
    case "SET_LINEUP":
      return `LINEUP:${d.leagueId}:${(d.params as LineupParams).week}`;
  }
}
