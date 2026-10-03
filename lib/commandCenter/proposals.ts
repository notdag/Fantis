// Proposals: the structured, reviewable form of "a change Fantis could make".
// PURE — no fetching, no Sleeper calls, no writes. The read-only engine produces
// drafts; a separate executor (lib/commandCenterExec.ts, the only place that may
// call the Sleeper write layer) carries out the ones a person sends. This file
// also owns the two-state permission model (Planning/Live) and the status state
// machine so the rules live in one tested place.
import { irAllowed, irSlots } from "../bulkPlan";
import { activeCount, rosterPositions } from "./classify";
import type { CcLeague, LeagueSnapshot, Permission, SnapRoster } from "./types";

// ------------------------------------------------------------ permissions

export type { Permission };

export const PERMISSION_ORDER: Permission[] = ["PLANNING", "LIVE"];

export const PERMISSION_LABEL: Record<Permission, string> = {
  PLANNING: "Planning",
  LIVE: "Live",
};

export const PERMISSION_BLURB: Record<Permission, string> = {
  PLANNING: "Scan, chat and save proposals for review. Nothing is ever sent to Sleeper.",
  LIVE: "Proposals can be sent to Sleeper — one at a time, or as a reviewed batch. Each shows exactly what it will do; you confirm once and it's re-checked, sent, then verified.",
};

export const canSend = (p: Permission) => p === "LIVE";
export const isPermission = (v: unknown): v is Permission => typeof v === "string" && (PERMISSION_ORDER as string[]).includes(v);

// ---------------------------------------------------------------- proposals

export type ProposalKind = "ADD" | "IR_MOVE" | "ACTIVATE_IR" | "SET_LINEUP" | "DROP";

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

// A standalone release — no add involved. Used both as a bare "drop this
// player" request and, paired with an IR_MOVE right after it in the same
// proposal list, to release a current IR occupant so a NEW player has room
// to move onto IR — the bulk executor runs proposals one at a time in
// order and stops on the first unverified result, so listing the DROP
// immediately before its paired IR_MOVE is what makes the sequencing safe:
// the IR_MOVE only ever runs after the release is confirmed, and its own
// live re-validation would correctly reject it if the slot never opened.
export interface DropParams {
  playerId: string;
  playerName: string;
}

export type ProposalParams = AddParams | IrParams | ActivateIrParams | LineupParams | DropParams;

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

// Legal moves only. There is no separate approval step: a person sends a
// proposal straight from "proposed" to "executing". "approved" stays legal
// too, purely so a proposal saved before that step was removed still works.
// "executed"/"submitted" can only be reached from "executing".
const NEXT: Record<ProposalStatus, ProposalStatus[]> = {
  proposed: ["rejected", "expired", "executing"],
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

export const KIND_LABEL: Record<ProposalKind, string> = { ADD: "Add / claim", IR_MOVE: "Move to IR", ACTIVATE_IR: "Activate from IR", SET_LINEUP: "Set lineup", DROP: "Release" };

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
    case "DROP": {
      const p = d.params as DropParams;
      return `Release ${p.playerName} — no replacement`;
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

export function dropDraft(args: { league: CcLeague; playerId: string; playerName: string; rationale: string[]; command: string }): ProposalDraft {
  return {
    kind: "DROP",
    leagueId: args.league.id,
    leagueName: args.league.name,
    rosterId: args.league.rosterId,
    params: { playerId: args.playerId, playerName: args.playerName },
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
    case "DROP": {
      const a = p.params as DropParams;
      if (!me.players.includes(a.playerId)) return no(`${a.playerName} is no longer on your roster`);
      return { ok: true };
    }
  }
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
  if (kind !== "ADD" && kind !== "IR_MOVE" && kind !== "ACTIVATE_IR" && kind !== "SET_LINEUP" && kind !== "DROP") return null;
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
  } else if (kind === "DROP") {
    if (!idStr(p.playerId)) return null;
    params = { playerId: p.playerId as string, playerName: short(p.playerName, 80) };
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
    case "DROP":
      return `DROP:${d.leagueId}:${(d.params as DropParams).playerId}`;
  }
}
