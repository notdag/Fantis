// The Command Center brain. Given a message and the session so far it runs a
// READ-ONLY workflow through the tool layer and returns display blocks plus an
// audit record. It never writes to Sleeper: there is no write function anywhere
// in lib/commandCenter, and an instruction that sounds like a change
// ("add him", "drop Player A everywhere") is answered with a refusal and a
// PREVIEW of what a later phase could propose.
import { buildIrPlan, irAllowed, irSlots, type DropRank, type PlanLeague } from "../bulkPlan";
import { classifyPlayer, positionEligible, rosterPositions, activeCount } from "./classify";
import { analyzeDrops } from "./drops";
import { countStates, leaguesWhereCandidate, tallyDrops, type DropTally } from "./aggregate";
import { parseIntent, type ViewFilter } from "./intent";
import { cardOf, describeCard, normName, resolveName } from "./resolve";
import type { ReadOnlyTools } from "./tools";
import {
  CURRENT_PERMISSION,
  canExecute,
  STATE_ORDER,
  type AvailState,
  type CcLeague,
  type DropAnalysis,
  type DropSignals,
  type LeagueResult,
  type LeagueSnapshot,
  type PlayerCard,
} from "./types";
import type { PlayerMap, ProjectionMap } from "../types";

// ------------------------------------------------------------------ output

export interface ScanMeta {
  inScope: number; // leagues we tried
  ok: number;
  partial: number;
  failed: number;
  failedLeagues: { id: string; name: string; error: string }[];
  partialLeagues: { id: string; name: string; error: string }[];
  excludedBestBall: number;
  excludedNotInSeason: number;
  durationMs: number;
  fetchedAt: number;
}

export type MatchupVerdict = "WIN" | "TOSS_UP" | "LOSS" | "INCOMPLETE" | "NO_OPPONENT" | "UNKNOWN";
export interface MatchupRow {
  leagueId: string;
  leagueName: string;
  verdict: MatchupVerdict;
  mine: number | null;
  opp: number | null;
  margin: number | null;
  warnings: string[];
}

export interface PreviewAction {
  op: "ADD" | "WAIVER CLAIM" | "DROP";
  playerName: string;
  note?: string;
}
export interface PreviewItem {
  leagueId: string;
  leagueName: string;
  actions: PreviewAction[];
  noDropRequired?: boolean;
  suggestedDrops?: { name: string; pos: string }[];
}

export type Block =
  | { t: "text"; text: string; tone?: "info" | "good" | "warn" | "bad" }
  | { t: "clarify"; question: string; options: { n: number; label: string }[] }
  | { t: "scanStatus"; meta: ScanMeta }
  | { t: "counts"; playerName: string; counts: Record<AvailState, number>; total: number }
  | {
      t: "leagues";
      title: string;
      rows: {
        leagueId: string;
        leagueName: string;
        playerName: string;
        state: AvailState;
        detail: string;
        needsDrop: boolean | null;
        drops?: DropAnalysis;
      }[];
      truncated: number;
    }
  | { t: "tally"; title: string; rows: { name: string; pos: string; count: number }[]; total: number }
  | { t: "suggest"; title: string; rows: { name: string; pos: string; free: number; waiver: number; needDrop: number }[] }
  | { t: "decisions"; title: string; rows: { leagueId: string; leagueName: string; items: string[] }[]; truncated: number }
  | { t: "preview"; banner: string; items: PreviewItem[]; truncated: number }
  | { t: "matchups"; title: string; week: number; counts: Record<MatchupVerdict, number>; rows: MatchupRow[]; truncated: number };

export interface AuditRecord {
  command: string;
  intent: string;
  permission: string;
  players: { id: string; name: string }[];
  leaguesTotal: number;
  leaguesScanned: number;
  leaguesPartial: number;
  leaguesFailed: number;
  durationMs: number;
  counts: Partial<Record<AvailState, number>> | null;
  actionableLeagues: number | null;
  recommendations: string[];
  errors: string[];
  toolCalls: number;
}

interface Pending {
  options: PlayerCard[];
  resolved: PlayerCard[];
  rest: string[]; // mention texts still to resolve
  filter: ViewFilter;
  wantDrops: boolean;
  execVerb?: string;
}

export interface Session {
  targets: PlayerCard[];
  results: LeagueResult[] | null; // every league × target, unfiltered
  meta: ScanMeta | null;
  filter: ViewFilter;
  drops: Record<string, DropAnalysis> | null;
  dropsScope: string;
  pending: Pending | null;
  matchups: { week: number; rows: MatchupRow[]; at: number } | null;
}

export const newSession = (): Session => ({ targets: [], results: null, meta: null, filter: {}, drops: null, dropsScope: "", pending: null, matchups: null });

export interface Progress {
  done: number;
  total: number;
  label: string;
  counts?: Partial<Record<AvailState, number>>;
  failed: number;
}

export interface EngineEnv {
  tools: ReadOnlyTools;
  signals: DropSignals;
  pmap: PlayerMap;
  curatedIds: string[] | null;
  rank: DropRank; // [fantisValue, fcValue], higher = keep
  projections?: ProjectionMap | null; // Sleeper's single-week point projections for `week`
  week?: number | null;
  onProgress?: (p: Progress) => void;
  concurrency?: number;
  now?: () => number;
}

export interface EngineOutput {
  session: Session;
  blocks: Block[];
  audit: AuditRecord;
}

const READ_ONLY_LINE = "READ-ONLY MODE — nothing has been changed on Sleeper.";
const PREVIEW_BANNER = "PREVIEW ONLY — NOTHING HAS BEEN CHANGED";
const ACTIONABLE: AvailState[] = ["AVAILABLE", "WAIVER"];
const ROW_CAP = 400;

// ---------------------------------------------------------------- scanning

async function scanAll(
  env: EngineEnv,
  withTx: boolean,
  label: string,
  onSnap?: (s: LeagueSnapshot) => Partial<Record<AvailState, number>> | undefined
): Promise<{ snaps: LeagueSnapshot[]; meta: ScanMeta }> {
  const now = env.now ?? (() => Date.now());
  const started = now();
  const all = env.tools.get_my_leagues();
  const scope = all.filter((l) => l.status === "in_season" && !l.bestBall);
  const excludedBestBall = all.filter((l) => l.bestBall).length;
  const excludedNotInSeason = all.filter((l) => !l.bestBall && l.status !== "in_season").length;

  const snaps: LeagueSnapshot[] = new Array(scope.length);
  let done = 0;
  let failed = 0;
  let counts: Partial<Record<AvailState, number>> | undefined;
  let next = 0;
  const worker = async () => {
    while (next < scope.length) {
      const i = next++;
      const snap = await env.tools.get_league_snapshot(scope[i].id, withTx);
      snaps[i] = snap;
      if (snap.status === "FAILED") failed++;
      done++;
      counts = onSnap?.(snap) ?? counts;
      env.onProgress?.({ done, total: scope.length, label, counts, failed });
    }
  };
  env.onProgress?.({ done: 0, total: scope.length, label, failed: 0 });
  await Promise.all(Array.from({ length: Math.min(env.concurrency ?? 6, Math.max(1, scope.length)) }, worker));

  const meta: ScanMeta = {
    inScope: scope.length,
    ok: snaps.filter((s) => s.status === "SUCCESS").length,
    partial: snaps.filter((s) => s.status === "PARTIAL").length,
    failed: snaps.filter((s) => s.status === "FAILED").length,
    failedLeagues: snaps.filter((s) => s.status === "FAILED").map((s) => ({ id: s.league.id, name: s.league.name, error: s.error ?? "unknown error" })),
    partialLeagues: snaps.filter((s) => s.status === "PARTIAL").map((s) => ({ id: s.league.id, name: s.league.name, error: s.error ?? "partial data" })),
    excludedBestBall,
    excludedNotInSeason,
    durationMs: now() - started,
    fetchedAt: started,
  };
  return { snaps, meta };
}

// --------------------------------------------------------------- view logic

function applyFilter(results: LeagueResult[], f: ViewFilter): LeagueResult[] {
  return results.filter((r) => {
    if (f.states?.length && !f.states.includes(r.state)) return false;
    if (f.needsDrop !== undefined) {
      if (!ACTIONABLE.includes(r.state)) return false;
      if (r.needsDrop !== f.needsDrop) return false; // null (unknown) matches neither
    }
    return true;
  });
}

const describeFilter = (f: ViewFilter): string => {
  const parts: string[] = [];
  if (f.states?.length) parts.push(f.states.map((s) => s.replace(/_/g, " ").toLowerCase()).join(" / "));
  if (f.needsDrop === false) parts.push("no drop required");
  if (f.needsDrop === true) parts.push("drop required");
  return parts.join(", ") || "all leagues";
};

const posName = (env: EngineEnv, id: string) => env.pmap[id]?.n ?? id;

function scanSummaryBlocks(session: Session): Block[] {
  const blocks: Block[] = [];
  if (session.meta) blocks.push({ t: "scanStatus", meta: session.meta });
  for (const p of session.targets) {
    const mine = (session.results ?? []).filter((r) => r.playerId === p.id);
    blocks.push({ t: "counts", playerName: p.name, counts: countStates(mine), total: mine.length });
  }
  return blocks;
}

// Most useful first: things you can act on, then things that need a second
// look, then the leagues where he's simply taken.
const STATE_PRIORITY: Record<AvailState, number> = {
  AVAILABLE: 0, WAIVER: 1, UNKNOWN: 2, SCAN_FAILED: 3, NOT_ELIGIBLE: 4, ON_MY_ROSTER: 5, ON_OTHER_ROSTER: 6,
};

function resultRows(env: EngineEnv, session: Session, unsorted: LeagueResult[]) {
  const rows = [...unsorted].sort((a, b) => STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state]);
  const shown = rows.slice(0, ROW_CAP);
  return {
    rows: shown.map((r) => ({
      leagueId: r.leagueId,
      leagueName: r.leagueName,
      playerName: posName(env, r.playerId),
      state: r.state,
      detail: r.detail,
      needsDrop: r.needsDrop,
      drops: session.drops?.[r.leagueId],
    })),
    truncated: rows.length - shown.length,
  };
}

// Suggested drops for every actionable league that needs one. Pure local
// computation over already-read rosters.
function computeDrops(env: EngineEnv, snapsById: Map<string, LeagueSnapshot>, rows: LeagueResult[], count = 3): Record<string, DropAnalysis> {
  const out: Record<string, DropAnalysis> = {};
  for (const r of rows) {
    if (!ACTIONABLE.includes(r.state) || r.needsDrop !== true || out[r.leagueId]) continue;
    const snap = snapsById.get(r.leagueId);
    if (!snap) continue;
    const a = analyzeDrops(snap, env.signals, { incomingId: r.playerId, count });
    if (a) out[r.leagueId] = a;
  }
  return out;
}

function previewFor(env: EngineEnv, rows: LeagueResult[], drops: Record<string, DropAnalysis> | null): Block {
  const actionable = rows.filter((r) => ACTIONABLE.includes(r.state));
  const shown = actionable.slice(0, 120);
  return {
    t: "preview",
    banner: PREVIEW_BANNER,
    truncated: actionable.length - shown.length,
    items: shown.map((r) => {
      const d = drops?.[r.leagueId];
      return {
        leagueId: r.leagueId,
        leagueName: r.leagueName,
        actions: [{ op: r.state === "WAIVER" ? ("WAIVER CLAIM" as const) : ("ADD" as const), playerName: posName(env, r.playerId) }],
        noDropRequired: r.needsDrop === false,
        suggestedDrops: r.needsDrop ? d?.candidates.map((c) => ({ name: c.name, pos: c.pos })) : undefined,
      };
    }),
  };
}

// ------------------------------------------------------------------ handler

export async function handleCommand(text: string, prev: Session, env: EngineEnv): Promise<EngineOutput> {
  const now = env.now ?? (() => Date.now());
  const t0 = now();
  const callsBefore = env.tools.callLog.length;
  let session: Session = { ...prev };
  const blocks: Block[] = [];
  const errors: string[] = [];
  const recs: string[] = [];

  const intent = parseIntent(text, env.tools.index, {
    hasScan: !!prev.results,
    hasDrops: !!prev.drops && Object.keys(prev.drops).length > 0,
    pending: !!prev.pending,
    hasMatchups: !!prev.matchups,
  });

  // Any new non-choice command abandons a pending clarification (user changed their mind).
  if (intent.kind !== "choice" && session.pending) session = { ...session, pending: null };

  const finish = (): EngineOutput => {
    const meta = session.meta;
    const counts = session.results && session.targets[0] ? countStates(session.results.filter((r) => r.playerId === session.targets[0].id)) : null;
    const actionable = session.results ? new Set(applyFilter(session.results, session.filter).filter((r) => ACTIONABLE.includes(r.state)).map((r) => r.leagueId)).size : null;
    return {
      session,
      blocks,
      audit: {
        command: text,
        intent: intent.kind,
        permission: CURRENT_PERMISSION,
        players: session.targets.map((p) => ({ id: p.id, name: p.name })),
        leaguesTotal: meta?.inScope ?? 0,
        leaguesScanned: meta?.ok ?? 0,
        leaguesPartial: meta?.partial ?? 0,
        leaguesFailed: meta?.failed ?? 0,
        durationMs: now() - t0,
        counts,
        actionableLeagues: actionable,
        recommendations: recs.slice(0, 12),
        errors: [...errors, ...(meta?.failedLeagues ?? []).slice(0, 20).map((f) => `${f.name}: ${f.error}`)],
        toolCalls: env.tools.callLog.length - callsBefore,
      },
    };
  };

  // Hard guard: even if a later phase flips the permission constant, this
  // build has no write implementation. Belt and braces.
  if (canExecute()) throw new Error("Write permissions are not implemented in Phase 1.");

  // ---- resolve player names for intents that carry them
  const resolveMentions = async (
    mentionTexts: string[],
    already: PlayerCard[],
    carry: { filter: ViewFilter; wantDrops: boolean; execVerb?: string }
  ): Promise<PlayerCard[] | null> => {
    const resolved = [...already];
    for (let i = 0; i < mentionTexts.length; i++) {
      const r = resolveName(mentionTexts[i], env.tools.index);
      if (r.status === "none") {
        blocks.push({ t: "text", tone: "warn", text: `I couldn't find a player called "${mentionTexts[i]}". Nothing was searched — check the spelling or give me the full name.` });
        return null;
      }
      if (r.status === "ambiguous") {
        session = {
          ...session,
          pending: { options: r.options, resolved, rest: mentionTexts.slice(i + 1), ...carry },
        };
        blocks.push({
          t: "clarify",
          question: `${r.reason} I won't guess — which player do you mean? (reply with a number)`,
          options: r.options.map((c, k) => ({ n: k + 1, label: describeCard(c) })),
        });
        return null;
      }
      if (!resolved.some((p) => p.id === r.player.id)) resolved.push(r.player);
      if (r.ignored.length > 0) {
        blocks.push({
          t: "text",
          tone: "info",
          text: `Matched ${describeCard(r.player)}. Ignored ${r.ignored.length} namesake${r.ignored.length === 1 ? "" : "s"} with no current NFL team: ${r.ignored.map(describeCard).join("; ")}.`,
        });
      }
    }
    return resolved;
  };

  // ---- core: scan the given targets
  const runScan = async (targets: PlayerCard[], filter: ViewFilter, wantDrops: boolean, exec?: string) => {
    const label = `Scanning for ${targets.map((p) => p.name).join(", ")}`;
    const { snaps, meta } = await scanAll(env, true, label, (snap) => {
      // live counts for the progress display
      const c: Partial<Record<AvailState, number>> = {};
      for (const s of STATE_ORDER) c[s] = 0;
      liveTotals.push(...targets.map((p) => classifyPlayer(snap, p, now()).state));
      for (const s of liveTotals) c[s] = (c[s] ?? 0) + 1;
      return c;
    });
    const results = snaps.flatMap((s) => targets.map((p) => classifyPlayer(s, p, now())));
    const snapsById = new Map(snaps.map((s) => [s.league.id, s]));
    const view = applyFilter(results, filter);
    const drops = computeDrops(env, snapsById, view);
    session = { ...session, targets, results, meta, filter, drops, dropsScope: targets.map((p) => p.name).join(", ") };

    const texts: Block[] = [];
    for (const p of targets) {
      const mine = results.filter((r) => r.playerId === p.id);
      const c = countStates(mine);
      const actionable = c.AVAILABLE + c.WAIVER;
      const confirmedTotal = mine.length - c.SCAN_FAILED - c.UNKNOWN;
      const needDrop = mine.filter((r) => ACTIONABLE.includes(r.state) && r.needsDrop === true).length;
      texts.push({
        t: "text",
        tone: actionable > 0 ? "good" : "info",
        text:
          `Confirmed for ${describeCard(p)}: on the free-agent list in ${c.AVAILABLE} league${c.AVAILABLE === 1 ? "" : "s"} and on waivers in ${c.WAIVER}; ` +
          `already yours in ${c.ON_MY_ROSTER}; rostered by someone else in ${c.ON_OTHER_ROSTER}. ` +
          `Recommended add/claim in ${actionable} league${actionable === 1 ? "" : "s"}` +
          (actionable > 0 ? `, ${needDrop} of which would require a drop. ` : ". ") +
          (c.UNKNOWN + c.SCAN_FAILED > 0
            ? `${c.UNKNOWN + c.SCAN_FAILED} league${c.UNKNOWN + c.SCAN_FAILED === 1 ? "" : "s"} could not be verified (${c.SCAN_FAILED} scan failed, ${c.UNKNOWN} unknown) and are NOT counted as unavailable. `
            : "") +
          `${confirmedTotal} of ${mine.length} leagues were confirmed.`,
      });
      recs.push(`${p.name}: ${actionable} actionable (${c.AVAILABLE} free agent, ${c.WAIVER} waiver), ${needDrop} need a drop`);
    }
    blocks.push(...scanSummaryBlocks(session), ...texts);

    const lr = resultRows(env, session, view);
    blocks.push({ t: "leagues", title: `Leagues — ${describeFilter(filter)} (${view.length})`, rows: lr.rows, truncated: lr.truncated });

    const analyses = Object.values(drops);
    if (analyses.length > 0) {
      const tally = tallyDrops(analyses);
      blocks.push({
        t: "tally",
        title: `Suggested drop candidates across ${analyses.length} league${analyses.length === 1 ? "" : "s"} that would require a drop (lowest-ranked according to the current model)`,
        rows: tally.slice(0, 12).map((x) => ({ name: x.name, pos: x.pos, count: x.count })),
        total: analyses.length,
      });
    }
    void exec;
    void wantDrops;
    if (view.some((r) => ACTIONABLE.includes(r.state))) {
      blocks.push(previewFor(env, view, drops));
    }
  };
  const liveTotals: AvailState[] = [];

  // ---------------------------------------------------------------- intents
  switch (intent.kind) {
    case "help":
    case "unknown": {
      blocks.push({
        t: "text",
        tone: intent.kind === "unknown" ? "warn" : "info",
        text:
          (intent.kind === "unknown" ? "I didn't understand that as a read-only scan or question. " : "") +
          `I can scan your leagues, check a player everywhere, suggest drop candidates, and summarise patterns — I can't change anything. Try: "Find Antonio Williams everywhere", "Only show waiver leagues", "Give me the bottom 3 drops", "Find leagues where I have an injured player who could go on IR", or "Find my best waiver adds".`,
      });
      break;
    }

    case "reset": {
      session = newSession();
      blocks.push({ t: "text", text: "Cleared the current context. Ask me to scan for a player to start again." });
      break;
    }

    case "choice": {
      const p = session.pending;
      if (!p) {
        blocks.push({ t: "text", tone: "warn", text: "There's nothing waiting for a choice." });
        break;
      }
      const picked = p.options[intent.n - 1];
      if (!picked) {
        blocks.push({ t: "clarify", question: `Please pick a number between 1 and ${p.options.length}.`, options: p.options.map((c, k) => ({ n: k + 1, label: describeCard(c) })) });
        break;
      }
      session = { ...session, pending: null };
      const resolved = await resolveMentions(p.rest, [...p.resolved, picked], p);
      if (resolved) {
        await runScan(resolved, p.filter, p.wantDrops, p.execVerb);
      }
      break;
    }

    case "scan_player": {
      const resolved = await resolveMentions(
        intent.mentions.map((m) => m.text),
        [],
        { filter: intent.filter, wantDrops: intent.wantDrops }
      );
      if (resolved) await runScan(resolved, intent.filter, intent.wantDrops);
      break;
    }

    case "scan_leagues": {
      const { snaps, meta } = await scanAll(env, false, "Scanning leagues");
      session = { ...session, meta };
      void snaps;
      blocks.push({ t: "scanStatus", meta });
      blocks.push({ t: "text", text: `Scanned ${meta.ok + meta.partial}/${meta.inScope} leagues. What should I look for? For example a player name, "best waiver adds", "bottom 3 drops", or "IR opportunities".` });
      break;
    }

    case "filter": {
      const all = session.results;
      if (!all) break;
      // "the rest" / follow-ups replace the filter rather than stacking, so the user can always reason about it
      const filter = { ...intent.filter };
      const view = applyFilter(all, filter);
      session = { ...session, filter };
      const n = view.length;
      blocks.push({ t: "text", text: `Filtered the previous scan (no new scan): ${describeFilter(filter)} — ${n} result${n === 1 ? "" : "s"}.${all.some((r) => r.needsDrop === null && ACTIONABLE.includes(r.state)) && filter.needsDrop !== undefined ? " Leagues whose roster size couldn't be read match neither drop filter." : ""}` });
      const lr = resultRows(env, session, view);
      blocks.push({ t: "leagues", title: `Leagues — ${describeFilter(filter)} (${n})`, rows: lr.rows, truncated: lr.truncated });
      if (view.some((r) => ACTIONABLE.includes(r.state))) blocks.push(previewFor(env, view, session.drops));
      break;
    }

    case "clear_filter": {
      const all = session.results;
      if (!all) break;
      session = { ...session, filter: {} };
      const lr = resultRows(env, session, all);
      blocks.push({ t: "text", text: "Showing every scanned league again." });
      blocks.push({ t: "leagues", title: `Leagues — all (${all.length})`, rows: lr.rows, truncated: lr.truncated });
      break;
    }

    case "drops": {
      // A named player means "drops for adding him": run/refresh that scan.
      if (intent.mentions.length > 0) {
        const resolved = await resolveMentions(intent.mentions.map((m) => m.text), [], { filter: {}, wantDrops: true });
        if (resolved) await runScan(resolved, {}, true);
        break;
      }
      if (session.results) {
        const view = applyFilter(session.results, session.filter);
        const need = view.filter((r) => ACTIONABLE.includes(r.state) && r.needsDrop === true);
        if (need.length === 0) {
          blocks.push({ t: "text", tone: "info", text: "None of the leagues in the current view would require a drop, so there are no drop candidates to suggest. (Leagues whose roster size couldn't be read are excluded.)" });
          break;
        }
        const snapsById = new Map<string, LeagueSnapshot>();
        for (const r of need) snapsById.set(r.leagueId, await env.tools.get_league_snapshot(r.leagueId, true));
        const drops = computeDrops(env, snapsById, need, intent.count);
        session = { ...session, drops, dropsScope: session.targets.map((p) => p.name).join(", ") };
        pushDropBlocks(blocks, env, session, need, drops, intent.count);
        recs.push(`bottom ${intent.count} drop candidates for ${Object.keys(drops).length} leagues`);
        break;
      }
      // No context: bottom N on every roster.
      const { snaps, meta } = await scanAll(env, false, "Reading rosters");
      const drops: Record<string, DropAnalysis> = {};
      for (const s of snaps) {
        if (s.status === "FAILED") continue;
        const a = analyzeDrops(s, env.signals, { count: intent.count });
        if (a) drops[s.league.id] = a;
      }
      session = { ...session, meta, drops, dropsScope: "every roster" };
      blocks.push({ t: "scanStatus", meta });
      pushDropBlocks(blocks, env, session, null, drops, intent.count);
      recs.push(`bottom ${intent.count} on ${Object.keys(drops).length} rosters`);
      break;
    }

    case "aggregate_drops": {
      const analyses = Object.values(session.drops ?? {});
      const tally = tallyDrops(analyses);
      blocks.push({
        t: "tally",
        title: `Most common suggested drop candidates (${analyses.length} leagues, ${session.dropsScope || "current analysis"})`,
        rows: tally.slice(0, 20).map((x) => ({ name: x.name, pos: x.pos, count: x.count })),
        total: analyses.length,
      });
      break;
    }

    case "candidate_leagues": {
      const analyses = Object.values(session.drops ?? {});
      const tally = tallyDrops(analyses);
      const q = normName(intent.text);
      const hits = tally.filter((x) => q.includes(normName(x.name)));
      if (hits.length === 0) {
        blocks.push({ t: "text", tone: "warn", text: "I couldn't match a player from the current drop analysis in that message. Name one of the suggested candidates." });
        break;
      }
      const names = new Set(hits.map((h) => normName(h.name)));
      if (hits.length > 1 && names.size === 1) {
        blocks.push({ t: "text", tone: "warn", text: `Two different players in the analysis are named ${hits[0].name} — ${hits.map((h) => `${h.pos} (${h.count} leagues)`).join(" / ")}. Say which position you mean.` });
        break;
      }
      const h = hits[0];
      const ids = leaguesWhereCandidate(analyses, h.playerId);
      if (intent.countOnly) {
        blocks.push({ t: "text", text: `${h.name} is a suggested drop candidate (bottom ${analyses[0]?.candidates.length ?? 3}) in ${ids.length} of ${analyses.length} analysed leagues. Suggested candidate = lowest-ranked according to the current model, not a verdict.` });
        break;
      }
      const rows = ids.map((id) => {
        const lg = env.tools.get_league_details(id);
        return { leagueId: id, leagueName: lg.name, playerName: h.name, state: "ON_MY_ROSTER" as AvailState, detail: analyses.find((a) => a.leagueId === id)?.candidates.find((c) => c.playerId === h.playerId)?.reasons[1] ?? "", needsDrop: null, drops: session.drops?.[id] };
      });
      blocks.push({ t: "text", text: `${h.name} is one of the suggested drop candidates in ${ids.length} league${ids.length === 1 ? "" : "s"}. Nothing has been changed.` });
      blocks.push({ t: "leagues", title: `Leagues where ${h.name} is a bottom-${analyses[0]?.candidates.length ?? 3} candidate (${ids.length})`, rows, truncated: 0 });
      break;
    }

    case "waiver_opps": {
      const curated = env.curatedIds;
      if (!curated) {
        blocks.push({ t: "text", tone: "warn", text: "Your curated rankings haven't loaded yet, so I can't rank available players. Try again in a moment." });
        break;
      }
      const { snaps, meta } = await scanAll(env, true, "Finding available players");
      const agg = new Map<string, { free: number; waiver: number; needDrop: number }>();
      for (const s of snaps) {
        if (s.status === "FAILED" || !s.rosters) continue;
        const taken = new Set(s.rosters.flatMap((r) => r.players));
        const opts = curated
          .filter((id) => !taken.has(id) && env.pmap[id]?.t && positionEligible(s.league.settings, env.pmap[id].p) === true)
          .sort((a, b) => { const [a1, a2] = env.rank(a); const [b1, b2] = env.rank(b); return b1 - a1 || b2 - a2; });
        let taken3 = 0;
        for (const id of opts) {
          if (taken3 >= 3) break;
          const card = cardOf(env.pmap, id);
          if (!card) continue;
          const r = classifyPlayer(s, card, now());
          if (!ACTIONABLE.includes(r.state)) continue;
          taken3++;
          const e = agg.get(id) ?? { free: 0, waiver: 0, needDrop: 0 };
          if (r.state === "AVAILABLE") e.free++;
          else e.waiver++;
          if (r.needsDrop) e.needDrop++;
          agg.set(id, e);
        }
      }
      session = { ...session, meta };
      const rows = [...agg.entries()]
        .sort((a, b) => b[1].free + b[1].waiver - (a[1].free + a[1].waiver))
        .slice(0, 15)
        .map(([id, e]) => ({ name: posName(env, id), pos: env.pmap[id]?.p ?? "", ...e }));
      blocks.push({ t: "scanStatus", meta });
      blocks.push({ t: "text", text: `For each league I took the top 3 highest-valued (Fantis value, then FantasyCalc) players from your curated list who are unrostered there. Waiver vs free agent uses each league's own waiver window. These are suggestions, not verdicts.` });
      blocks.push({ t: "suggest", title: "Most frequently available high-value players", rows });
      recs.push(...rows.slice(0, 5).map((r) => `${r.name}: available in ${r.free + r.waiver} leagues`));
      break;
    }

    case "ir_opps": {
      const { snaps, meta } = await scanAll(env, false, "Checking injuries");
      session = { ...session, meta };
      const plan: PlanLeague[] = [];
      for (const s of snaps) {
        if (s.status === "FAILED" || !s.rosters) continue;
        const mine = s.rosters.find((r) => r.rosterId === s.league.rosterId)!;
        plan.push({ leagueId: s.league.id, leagueName: s.league.name, rosterId: mine.rosterId, settings: s.league.settings, starters: mine.starters, players: mine.players, reserve: mine.reserve, faabUsed: null });
      }
      const rows = buildIrPlan(plan, (id) => env.pmap[id]?.inj ?? null, env.rank);
      blocks.push({ t: "scanStatus", meta });
      const byLeague = new Map<string, { leagueId: string; leagueName: string; items: string[] }>();
      for (const r of rows) {
        const e = byLeague.get(r.leagueId) ?? { leagueId: r.leagueId, leagueName: r.leagueName, items: [] };
        e.items.push(`${posName(env, r.playerId)} (${r.injury})${r.inStarters ? " — currently in your starting lineup" : ""}: ${r.needsDrop ? (r.noRoom ? "IR is full and nobody on it can be released" : `IR full — would need to release ${r.dropId ? posName(env, r.dropId) : "someone"} from IR first`) : "an open IR slot is available"}`);
        byLeague.set(r.leagueId, e);
      }
      const list = [...byLeague.values()];
      blocks.push({ t: "text", tone: list.length ? "good" : "info", text: `${rows.length} player${rows.length === 1 ? "" : "s"} across ${list.length} league${list.length === 1 ? "" : "s"} could be moved to IR under each league's own IR rules (Doubtful is never suggested). Nothing has been moved.` });
      blocks.push({ t: "decisions", title: "IR opportunities", rows: list.slice(0, ROW_CAP), truncated: Math.max(0, list.length - ROW_CAP) });
      recs.push(`${rows.length} IR-eligible players in ${list.length} leagues`);
      break;
    }

    case "roster_decisions": {
      const { snaps, meta } = await scanAll(env, false, "Checking rosters");
      session = { ...session, meta };
      const out: { leagueId: string; leagueName: string; items: string[] }[] = [];
      for (const s of snaps) {
        if (s.status === "FAILED" || !s.rosters) continue;
        const mine = s.rosters.find((r) => r.rosterId === s.league.rosterId)!;
        const items: string[] = [];
        const empty = mine.starters.filter((id) => !id || id === "0").length;
        if (empty > 0) items.push(`${empty} empty starting slot${empty === 1 ? "" : "s"}`);
        for (const id of mine.starters) {
          const inj = env.pmap[id]?.inj;
          if (id && id !== "0" && inj && ["Out", "IR", "PUP", "Sus", "Doubtful"].includes(inj)) items.push(`${posName(env, id)} (${inj}) is in your starting lineup`);
        }
        const slots = irSlots(s.league.settings);
        for (const id of mine.players) {
          const inj = env.pmap[id]?.inj ?? null;
          if (!mine.reserve.includes(id) && irAllowed(s.league.settings, inj)) {
            items.push(`${posName(env, id)} (${inj}) is IR-eligible and not on IR${mine.reserve.length >= slots ? " (IR full)" : ""}`);
          }
        }
        const limit = rosterPositions(s.league.settings)?.length ?? null;
        const active = activeCount(s);
        if (limit && active != null && active > limit) items.push(`Roster is over the limit (${active}/${limit})`);
        if (items.length) out.push({ leagueId: s.league.id, leagueName: s.league.name, items });
      }
      blocks.push({ t: "scanStatus", meta });
      blocks.push({ t: "text", tone: out.length ? "warn" : "good", text: `${out.length} of ${meta.ok + meta.partial} scanned leagues have a roster decision waiting: empty starter slots, injured starters, IR-eligible players not on IR, or an over-limit roster.` });
      blocks.push({ t: "decisions", title: "Roster decisions", rows: out.slice(0, ROW_CAP), truncated: Math.max(0, out.length - ROW_CAP) });
      recs.push(`${out.length} leagues with decisions`);
      break;
    }

    case "win_projection": {
      const proj = env.projections;
      const week = env.week;
      if (!proj || week == null) {
        blocks.push({ t: "text", tone: "warn", text: "This week's Sleeper projections haven't loaded yet, so I can't compare lineups. Try again in a moment. Nothing was counted." });
        break;
      }
      let rows: MatchupRow[];
      const stored = session.matchups;
      // A stored result is only reused for a few minutes — lineups change.
      if (stored && stored.week === week && !intent.fresh && intent.verdict && now() - stored.at < 5 * 60_000) {
        rows = stored.rows; // follow-up: filter what we already read, no re-scan
      } else {
        rows = await scanMatchups(env, proj, week, (meta) => {
          session = { ...session, meta };
        });
        session = { ...session, matchups: { week, rows, at: now() } };
      }
      const counts = countVerdicts(rows);
      const shown = intent.verdict ? rows.filter((r) => r.verdict === intent.verdict) : rows;
      const total = rows.length;
      const decided = counts.WIN + counts.LOSS;
      const readable = total - counts.UNKNOWN;
      blocks.push({
        t: "text",
        tone: "good",
        text:
          `Week ${week}: projected to win ${counts.WIN} of ${total} leagues and to lose ${counts.LOSS}. ` +
          `${counts.TOSS_UP} are too close to call (within ${TOSS_UP_PTS} pts), ${counts.INCOMPLETE} can't be judged because a lineup has an empty slot or a starter with no projection, ` +
          `and ${counts.NO_OPPONENT} have no opponent this week. ` +
          (counts.UNKNOWN > 0 ? `${counts.UNKNOWN} league${counts.UNKNOWN === 1 ? "" : "s"} could not be read and are NOT counted as wins or losses. ` : "") +
          `${readable} of ${total} leagues were readable, ${decided} clear calls.`,
      });
      blocks.push({
        t: "text",
        tone: "info",
        text: "How to read this: each side is the sum of Sleeper's own single-week point projections for the starters currently set (using each league's PPR/half/standard setting; custom scoring isn't applied). It is a projection, not a win probability, and live scores from games already played are not included.",
      });
      blocks.push({
        t: "matchups",
        title: intent.verdict ? `Leagues — ${VERDICT_LABEL[intent.verdict].toLowerCase()} (${shown.length})` : `Every league — week ${week} (${total})`,
        week,
        counts,
        rows: shown.slice(0, ROW_CAP),
        truncated: Math.max(0, shown.length - ROW_CAP),
      });
      recs.push(`week ${week}: ${counts.WIN} projected wins, ${counts.LOSS} losses, ${counts.TOSS_UP} toss-ups, ${counts.INCOMPLETE} incomplete`);
      break;
    }

    case "execute_request": {
      blocks.push({
        t: "text",
        tone: "bad",
        text: `I can't ${intent.verb} anything — Command Center is in READ-ONLY mode (Phase 1). I never add, drop, claim, move IR, set lineups or change anything on Sleeper, and no message can switch that on. Nothing has been changed. Below is only a preview of what a future approved action could look like.`,
      });
      if (intent.mentions.length > 0) {
        const resolved = await resolveMentions(intent.mentions.map((m) => m.text), [], { filter: {}, wantDrops: false, execVerb: intent.verb });
        if (resolved) await runScan(resolved, {}, false, intent.verb);
        break;
      }
      const analyses = Object.values(session.drops ?? {});
      const q = normName(text);
      const cand = tallyDrops(analyses).find((x) => q.includes(normName(x.name)));
      if (cand) {
        const ids = leaguesWhereCandidate(analyses, cand.playerId);
        blocks.push({ t: "text", text: `${cand.name} appears as a suggested drop candidate in ${ids.length} league${ids.length === 1 ? "" : "s"}. Nothing has been changed.` });
        blocks.push({
          t: "preview",
          banner: PREVIEW_BANNER,
          truncated: Math.max(0, ids.length - 120),
          items: ids.slice(0, 120).map((id) => ({ leagueId: id, leagueName: env.tools.get_league_details(id).name, actions: [{ op: "DROP" as const, playerName: cand.name }] })),
        });
      } else if (session.results) {
        const view = applyFilter(session.results, session.filter);
        if (view.some((r) => ACTIONABLE.includes(r.state))) blocks.push(previewFor(env, view, session.drops));
      } else {
        blocks.push({ t: "text", text: "Tell me which player to look at first (for example \"Find Antonio Williams everywhere\") and I'll show a preview." });
      }
      break;
    }
  }

  blocks.push({ t: "text", tone: "info", text: READ_ONLY_LINE });
  return finish();
}

// ------------------------------------------------------------- matchups

const TOSS_UP_PTS = 3;
const VERDICT_LABEL: Record<MatchupVerdict, string> = {
  WIN: "Projected win",
  TOSS_UP: "Too close to call",
  LOSS: "Projected loss",
  INCOMPLETE: "Lineup incomplete",
  NO_OPPONENT: "No opponent",
  UNKNOWN: "Couldn't read",
};

function countVerdicts(rows: MatchupRow[]): Record<MatchupVerdict, number> {
  const c: Record<MatchupVerdict, number> = { WIN: 0, TOSS_UP: 0, LOSS: 0, INCOMPLETE: 0, NO_OPPONENT: 0, UNKNOWN: 0 };
  for (const r of rows) c[r.verdict]++;
  return c;
}

// Sleeper's projection field that matches a league's reception scoring.
function scoringField(settings: unknown): { key: "pts_ppr" | "pts_half_ppr" | "pts_std"; assumed: boolean } {
  const sc = settings && typeof settings === "object" ? (settings as Record<string, unknown>).scoring_settings : null;
  const rec = sc && typeof sc === "object" ? (sc as Record<string, unknown>).rec : undefined;
  if (typeof rec !== "number") return { key: "pts_ppr", assumed: true };
  return { key: rec >= 1 ? "pts_ppr" : rec >= 0.5 ? "pts_half_ppr" : "pts_std", assumed: false };
}

async function scanMatchups(
  env: EngineEnv,
  proj: ProjectionMap,
  week: number,
  onMeta: (m: ScanMeta) => void
): Promise<MatchupRow[]> {
  const now = env.now ?? (() => Date.now());
  const started = now();
  const all = env.tools.get_my_leagues();
  const scope = all.filter((l) => l.status === "in_season" && !l.bestBall);
  const rows: MatchupRow[] = new Array(scope.length);
  let done = 0;
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < scope.length) {
      const i = next++;
      const lg = scope[i];
      try {
        const { mine, opp } = await env.tools.get_matchup(lg.id);
        rows[i] = judgeMatchup(lg, mine.starters ?? [], opp ? opp.starters ?? [] : null, proj);
      } catch (e) {
        failed++;
        rows[i] = { leagueId: lg.id, leagueName: lg.name, verdict: "UNKNOWN", mine: null, opp: null, margin: null, warnings: [e instanceof Error ? e.message : "could not be read"] };
      }
      done++;
      env.onProgress?.({ done, total: scope.length, label: "Checking this week's matchups", failed });
    }
  };
  env.onProgress?.({ done: 0, total: scope.length, label: "Checking this week's matchups", failed: 0 });
  await Promise.all(Array.from({ length: Math.min(env.concurrency ?? 6, Math.max(1, scope.length)) }, worker));
  const bad = rows.filter((r) => r.verdict === "UNKNOWN");
  onMeta({
    inScope: scope.length,
    ok: scope.length - bad.length,
    partial: 0,
    failed: bad.length,
    failedLeagues: bad.map((r) => ({ id: r.leagueId, name: r.leagueName, error: r.warnings[0] ?? "unknown error" })),
    partialLeagues: [],
    excludedBestBall: all.filter((l) => l.bestBall).length,
    excludedNotInSeason: all.filter((l) => !l.bestBall && l.status !== "in_season").length,
    durationMs: now() - started,
    fetchedAt: started,
  });
  void week;
  return rows;
}

function judgeMatchup(lg: CcLeague, mine: string[], opp: string[] | null, proj: ProjectionMap): MatchupRow {
  const { key, assumed } = scoringField(lg.settings);
  const sum = (ids: string[]) => {
    let total = 0;
    let gaps = 0;
    for (const id of ids) {
      if (!id || id === "0") {
        gaps++;
        continue;
      }
      const v = proj[id]?.[key];
      if (typeof v === "number") total += v;
      else gaps++;
    }
    return { total, gaps };
  };
  const base = { leagueId: lg.id, leagueName: lg.name };
  const warnings: string[] = [];
  if (assumed) warnings.push("scoring format not found — assumed full PPR");
  const m = sum(mine);
  if (opp === null) return { ...base, verdict: "NO_OPPONENT", mine: round1(m.total), opp: null, margin: null, warnings };
  const o = sum(opp);
  const mineTotal = round1(m.total);
  const oppTotal = round1(o.total);
  if (m.gaps > 0) warnings.push(`your lineup has ${m.gaps} empty slot${m.gaps === 1 ? "" : "s"} or starter${m.gaps === 1 ? "" : "s"} with no projection`);
  if (o.gaps > 0) warnings.push(`opponent's lineup has ${o.gaps} empty slot${o.gaps === 1 ? "" : "s"} or starter${o.gaps === 1 ? "" : "s"} with no projection`);
  const margin = round1(mineTotal - oppTotal);
  if (m.gaps > 0 || o.gaps > 0) return { ...base, verdict: "INCOMPLETE", mine: mineTotal, opp: oppTotal, margin, warnings };
  const verdict: MatchupVerdict = Math.abs(margin) < TOSS_UP_PTS ? "TOSS_UP" : margin > 0 ? "WIN" : "LOSS";
  return { ...base, verdict, mine: mineTotal, opp: oppTotal, margin, warnings };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function pushDropBlocks(blocks: Block[], env: EngineEnv, session: Session, need: LeagueResult[] | null, drops: Record<string, DropAnalysis>, count: number) {
  const analyses = Object.values(drops);
  const tally: DropTally[] = tallyDrops(analyses);
  blocks.push({
    t: "text",
    text: `Suggested drop candidates (lowest-ranked according to the current model — not a verdict) for ${analyses.length} league${analyses.length === 1 ? "" : "s"}. Starters, IR/taxi players, your Priority list and required positions are never offered.`,
  });
  blocks.push({
    t: "tally",
    title: `Most common bottom-${count} candidates (${analyses.length} leagues)`,
    rows: tally.slice(0, 15).map((x) => ({ name: x.name, pos: x.pos, count: x.count })),
    total: analyses.length,
  });
  const rows = analyses.slice(0, ROW_CAP).map((a) => ({
    leagueId: a.leagueId,
    leagueName: env.tools.get_league_details(a.leagueId).name,
    playerName: need?.find((r) => r.leagueId === a.leagueId) ? posName(env, need.find((r) => r.leagueId === a.leagueId)!.playerId) : "",
    state: "ON_MY_ROSTER" as AvailState,
    detail: a.note ?? "",
    needsDrop: null,
    drops: a,
  }));
  blocks.push({ t: "leagues", title: `Bottom-${count} by league (${analyses.length})`, rows, truncated: Math.max(0, analyses.length - ROW_CAP) });
  void session;
}

export type { CcLeague };
