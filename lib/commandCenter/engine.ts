// The Command Center brain. Given a message and the session so far it runs a
// READ-ONLY workflow through the tool layer and returns display blocks plus an
// audit record. It never writes to Sleeper: there is no write function anywhere
// in lib/commandCenter, and an instruction that sounds like a change
// ("add him", "drop Player A everywhere") is answered with a refusal and a
// PREVIEW of what a later phase could propose.
import { buildActivateIrPlan, buildIrPlan, irAllowed, irSlots, SEVERITY, type DropRank, type PlanLeague } from "../bulkPlan";
import { classifyPlayer, positionEligible, rosterPositions, activeCount } from "./classify";
import { analyzeDrops } from "./drops";
import { countStates, leaguesWhereCandidate, tallyDrops, type DropTally } from "./aggregate";
import { parseIntent, hasFilter, type ViewFilter } from "./intent";
import { buildStartingSlots } from "../rosterSlots";
import { optimizeLineup } from "../lineupOptimizer";
import { scoringKey } from "../scoringKey";
import { BYE_WEEKS_2026 } from "../byeWeeks";
import { activateIrDraft, addDraft, canPropose, dropDraft, irDraft, type ActivateIrParams, type IrParams, type ProposalDraft } from "./proposals";
import { suggestBid, type FaabStats } from "../faabHistory";
import { cardOf, describeCard, normName, resolveName } from "./resolve";
import type { ReadOnlyTools } from "./tools";
import {
  canExecute,
  STATE_ORDER,
  type AvailState,
  type CcLeague,
  type DropAnalysis,
  type DropSignals,
  type LeagueResult,
  type LeagueSnapshot,
  type Permission,
  type PlayerCard,
  type SnapRoster,
} from "./types";
import type { PlayerMap, ProjectionMap } from "../types";
import type { GameState } from "../espnGames";
import type { RawMatchup, SleeperLeg, WeekRecordRow } from "./tools";

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

// WON/LOST/TIED = every starter on both sides is done (a fact, not a projection).
// WIN/LOSS/TOSS_UP = still in play: projected from points so far + what's left.
export type MatchupVerdict = "WON" | "LOST" | "TIED" | "WIN" | "TOSS_UP" | "LOSS" | "NO_OPPONENT" | "UNKNOWN";
export interface MatchupRow {
  leagueId: string;
  leagueName: string;
  verdict: MatchupVerdict;
  nowMine: number | null; // real points so far
  nowOpp: number | null;
  projMine: number | null; // projected final (real points + what's left)
  projOpp: number | null;
  leftMine: number; // starters whose game isn't finished yet (incl. in progress)
  leftOpp: number;
  playedMine: number;
  playedOpp: number;
  // Where the projected finish came from: Sleeper's own projection (what the app shows) or
  // Fantis's estimate built from Sleeper's per-player projections + live scores.
  source: "sleeper" | "fantis";
  estMine: number | null; // Fantis's own estimate, always computed, shown alongside
  estOpp: number | null;
  warnings: string[];
}

export interface SleeperInfo {
  hadAccess: boolean; // Sleeper access was connected
  used: number; // leagues where Sleeper's own projection was used
  authFailed: boolean; // Sleeper rejected the token
  failed: number; // leagues where the read failed (fell back to Fantis's estimate)
}

export type PlayoffStatus = "IN" | "BUBBLE" | "OUT" | "UNKNOWN";
export interface StandingRow {
  leagueId: string;
  leagueName: string;
  record: string; // "3-1" or "3-1-1"
  rank: number | null;
  of: number;
  playoffTeams: number | null;
  status: PlayoffStatus;
  gamesFromLine: number | null; // + = games ahead of the first team out; − = games behind the last team in
  fcRank: number | null; // my roster's FantasyCalc value rank among this league's rosters (1 = strongest)
  fcTotal: number | null;
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
  | { t: "drafts"; drafts: ProposalDraft[]; note: string }
  | { t: "week_record"; week: number; wins: number; losses: number; ties: number; unresolved: number; rows: WeekRecordRow[]; noData: string[] }
  | { t: "standings"; title: string; counts: Record<PlayoffStatus, number>; fc: { top3: number; bottomHalf: number; scored: number }; rows: StandingRow[]; truncated: number }
  | {
      t: "matchups";
      title: string;
      week: number;
      counts: Record<MatchupVerdict, number>;
      live: { leading: number; trailing: number; even: number; leftMine: number; leftOpp: number; games: { pre: number; inPlay: number; post: number } };
      rows: MatchupRow[];
      truncated: number;
    };

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
  matchups: { week: number; rows: MatchupRow[]; at: number; games: GameCounts; sleeper: SleeperInfo } | null;
  standings: { rows: StandingRow[]; at: number } | null;
}

export const newSession = (): Session => ({ targets: [], results: null, meta: null, filter: {}, drops: null, dropsScope: "", pending: null, matchups: null, standings: null });

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
  permission?: Permission; // the owner's chosen mode; defaults to READ_ONLY. The engine never executes in any mode.
  kickoffs?: () => Promise<Record<string, string> | null>; // team → kickoff ISO, to freeze started games in lineup proposals
  getGameStates?: () => Promise<Record<string, GameState> | null>; // live NFL game status (ESPN), fetched fresh per question
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
    hasStandings: !!prev.standings,
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
        permission,
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

  // The engine has NO write path in any permission mode. Execution lives in
  // lib/commandCenterExec.ts and only ever runs a proposal a person approved in the UI.
  const permission: Permission = env.permission ?? "READ_ONLY";
  void canExecute;

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
  const runScan = async (targets: PlayerCard[], filter: ViewFilter, wantDrops: boolean, exec?: string, customDropOrder?: PlayerCard[]) => {
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
      if (customDropOrder && customDropOrder.length > 0) {
        const actionable = view.filter((r) => ACTIONABLE.includes(r.state));
        await applyDropOrder(
          actionable.filter((r) => r.needsDrop === true),
          actionable.filter((r) => r.needsDrop === false),
          customDropOrder
        );
      } else {
        const faabStats = view.some((r) => r.faab) ? await env.tools.get_faab_stats() : null;
        const d = addDraftsFromScan(env, view, drops, text, faabStats);
        const b = draftsBlock(env, permission, d.drafts, d.skipped);
        if (b) blocks.push(b);
      }
    }
  };
  const liveTotals: AvailState[] = [];

  // ---- shared: apply the owner's own drop order (in the order given) to
  // whichever leagues need a drop, and straightforwardly add wherever there's
  // an open spot — used both by the "add X, Y, drop A, B" combined syntax and
  // the two-message drop_preferences follow-up (which passes openSlot: [],
  // since those leagues were already proposed on the earlier turn).
  const applyDropOrder = async (needy: LeagueResult[], openSlot: LeagueResult[], dropOrder: PlayerCard[]) => {
    if (needy.length === 0 && openSlot.length === 0) {
      blocks.push({ t: "text", tone: "info", text: "Nothing from the last scan needs a drop, so there's nothing for a drop order to apply to." });
      return;
    }
    const faabStats = [...needy, ...openSlot].some((r) => r.faab) ? await env.tools.get_faab_stats() : null;
    const drafts: ProposalDraft[] = [];
    for (const r of openSlot) {
      const league = env.tools.get_league_details(r.leagueId);
      const bidMin = numSetting(league.settings, "waiver_bid_min");
      const pos = env.pmap[r.playerId]?.p ?? "";
      const suggestion = r.faab ? suggestBid(faabStats, r.leagueId, pos, bidMin, bidMin) : { bid: 0, n: 0, sourced: false };
      const rationale = [r.detail, "Open roster spot — no drop needed"];
      if (r.faab) {
        rationale.push(
          suggestion.sourced
            ? `Suggested bid $${suggestion.bid} — based on ${suggestion.n} real winning ${pos} claim${suggestion.n === 1 ? "" : "s"} in this league`
            : `No ${pos} claim history in this league yet — using the $${suggestion.bid} bid minimum`
        );
      }
      drafts.push(addDraft({ league, addId: r.playerId, addName: posName(env, r.playerId), drop: null, waiver: r.state === "WAIVER", faab: r.faab, bid: suggestion.bid, rationale, command: text }));
    }
    const leagueIds = [...new Set(needy.map((r) => r.leagueId))];
    const snapsById = new Map<string, LeagueSnapshot>();
    for (const id of leagueIds) snapsById.set(id, await env.tools.get_league_snapshot(id, true));
    // Each drop name is claimed by at most one target per league — same rule
    // as a multi-target add's auto-suggested drops, just driven by the
    // owner's own list and order instead of Fantis's ranking.
    const claimedByLeague = new Map<string, Set<string>>();
    const noMatch: { leagueId: string; leagueName: string }[] = [];
    for (const r of needy) {
      const snap = snapsById.get(r.leagueId);
      const me = snap?.rosters?.find((x) => x.rosterId === snap.league.rosterId);
      if (!me) {
        noMatch.push({ leagueId: r.leagueId, leagueName: r.leagueName });
        continue;
      }
      const claimed = claimedByLeague.get(r.leagueId) ?? new Set<string>();
      const off = new Set([...me.reserve, ...me.taxi]);
      const starterSet = new Set(me.starters.filter((id) => id && id !== "0"));
      const pick = dropOrder.find((p) => me.players.includes(p.id) && !off.has(p.id) && !starterSet.has(p.id) && !env.signals.priority.has(p.id) && !claimed.has(p.id));
      if (!pick) {
        noMatch.push({ leagueId: r.leagueId, leagueName: r.leagueName });
        continue;
      }
      claimed.add(pick.id);
      claimedByLeague.set(r.leagueId, claimed);
      const league = env.tools.get_league_details(r.leagueId);
      const bidMin = numSetting(league.settings, "waiver_bid_min");
      const pos = env.pmap[r.playerId]?.p ?? "";
      const suggestion = r.faab ? suggestBid(faabStats, r.leagueId, pos, bidMin, bidMin) : { bid: 0, n: 0, sourced: false };
      const rationale = [r.detail, `Your drop order: dropping ${pick.name}`];
      if (r.faab) {
        rationale.push(
          suggestion.sourced
            ? `Suggested bid $${suggestion.bid} — based on ${suggestion.n} real winning ${pos} claim${suggestion.n === 1 ? "" : "s"} in this league`
            : `No ${pos} claim history in this league yet — using the $${suggestion.bid} bid minimum`
        );
      }
      drafts.push(
        addDraft({
          league,
          addId: r.playerId,
          addName: posName(env, r.playerId),
          drop: { id: pick.id, name: pick.name },
          waiver: r.state === "WAIVER",
          faab: r.faab,
          bid: suggestion.bid,
          rationale,
          command: text,
        })
      );
    }
    const matched = needy.length - noMatch.length;
    if (needy.length > 0) {
      blocks.push({
        t: "text",
        tone: drafts.length ? "good" : "info",
        text: `Your drop order (${dropOrder.map((p) => p.name).join(" → ")}) applies to ${matched} of ${needy.length} league${needy.length === 1 ? "" : "s"} that needed a drop${
          openSlot.length > 0 ? `; ${openSlot.length} more had an open roster spot and needed no drop` : ""
        }${noMatch.length > 0 ? `; ${noMatch.length} have none of your listed players as an eligible bench player (not rostered there, or only as a starter/on IR/priority-protected)` : ""}. Nothing has been changed.`,
      });
    }
    if (noMatch.length > 0) {
      blocks.push({ t: "decisions", title: "No match for your drop order", rows: noMatch.map((s) => ({ leagueId: s.leagueId, leagueName: s.leagueName, items: ["None of your listed drop players are eligible on this roster"] })), truncated: 0 });
    }
    const b = draftsBlock(env, permission, drafts, noMatch.length);
    if (b) blocks.push(b);
    recs.push(`${drafts.length} leagues matched (drop order + open slots)`);
  };

  // ---------------------------------------------------------------- intents
  switch (intent.kind) {
    case "help":
    case "unknown": {
      blocks.push({
        t: "text",
        tone: intent.kind === "unknown" ? "warn" : "info",
        text:
          (intent.kind === "unknown" ? "I didn't understand that as a read-only scan or question. " : "") +
          `I can scan your leagues, check a player everywhere, suggest drop candidates, and summarise patterns — I can't change anything. Try: "Run my weekly sweep" (IR + priority-list adds in one pass), "Find Antonio Williams everywhere", "Only show waiver leagues", "Give me the bottom 3 drops", "Find leagues where I have an injured player who could go on IR", or "Find my best waiver adds".`,
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
      if (view.some((r) => ACTIONABLE.includes(r.state))) {
        blocks.push(previewFor(env, view, session.drops));
        const faabStats = view.some((r) => r.faab) ? await env.tools.get_faab_stats() : null;
        const d = addDraftsFromScan(env, view, session.drops, text, faabStats);
        const b = draftsBlock(env, permission, d.drafts, d.skipped);
        if (b) blocks.push(b);
      }
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

    case "drop_preferences": {
      if (!session.results || session.targets.length === 0) {
        blocks.push({ t: "text", tone: "warn", text: "I don't have a recent add scan to apply this to — ask me to add the players first (e.g. \"add X and Y everywhere\"), then give me your drop order." });
        break;
      }
      const dropOrder = await resolveMentions(intent.mentions.map((m) => m.text), [], { filter: {}, wantDrops: false });
      if (!dropOrder) break; // ambiguous or not found — resolveMentions already asked/explained
      const view = applyFilter(session.results, session.filter);
      const needy = view.filter((r) => ACTIONABLE.includes(r.state) && r.needsDrop === true);
      // openSlot: [] — those leagues were already proposed (auto, no drop
      // needed) on the earlier "add ... everywhere" turn; this follow-up
      // only touches the ones that actually needed a drop.
      await applyDropOrder(needy, [], dropOrder);
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
      const rows = buildIrPlan(plan, (id) => env.pmap[id]?.inj ?? null, env.rank, (id) => env.signals.priority.has(id));
      blocks.push({ t: "scanStatus", meta });

      // Who's allowed to be released to make room on a full IR — TWO
      // separate commands, deliberately: a bare "move all my IR eligible
      // players to IR" stays pure report-only (releaseOrder stays null,
      // unrestricted, exactly as before this feature existed). Real
      // release+move pairs are only ever drafted when the owner explicitly
      // asks for it — either by naming a release order inline on this one
      // command ("...release A, B, C if needed"), or by saying "...and
      // drop"/"...then drop" with no names, which applies the owner's
      // standing IR Release list (Chat tab → My players) instead of
      // retyping it every time. Either way, once a release order is in
      // effect it's a STRICT allow-list — a league where none of those
      // names are really on IR is reported honestly as such, never falls
      // back to naming some other real occupant the owner didn't approve.
      let releaseOrder: PlayerCard[] | null = null;
      if (intent.releaseOrder && intent.releaseOrder.length > 0) {
        const resolved = await resolveMentions(intent.releaseOrder.map((m) => m.text), [], { filter: {}, wantDrops: false });
        if (!resolved) break; // ambiguous or not found — resolveMentions already asked/explained
        releaseOrder = resolved;
      } else if (intent.useStandingRelease && env.signals.irReleaseOrder && env.signals.irReleaseOrder.length > 0) {
        const fromPrefs = env.signals.irReleaseOrder.map((id) => cardOf(env.pmap, id)).filter((c): c is PlayerCard => !!c);
        if (fromPrefs.length > 0) releaseOrder = fromPrefs;
      }

      const byLeague = new Map<string, { leagueId: string; leagueName: string; items: string[] }>();
      const irDrafts: ProposalDraft[] = [];
      const movesByLeague = new Map<string, number>();
      // Each release name is claimed by at most one need per league — same
      // rule as every other distinct-assignment fix this session.
      const claimedReleaseByLeague = new Map<string, Set<string>>();
      let releasedPairs = 0;
      for (const r of rows) {
        const e = byLeague.get(r.leagueId) ?? { leagueId: r.leagueId, leagueName: r.leagueName, items: [] };
        const nm = posName(env, r.playerId);
        const label = `${nm} (${r.injury})${r.inStarters ? " — currently in your starting lineup" : ""}`;

        if (!r.needsDrop) {
          e.items.push(`${label}: an open IR slot is available`);
          byLeague.set(r.leagueId, e);
          irDrafts.push(
            irDraft({
              league: env.tools.get_league_details(r.leagueId),
              playerId: r.playerId,
              playerName: nm,
              injury: r.injury,
              rationale: [`Sleeper lists ${nm} as ${r.injury}`, "This league's IR rules allow it and there is an open IR slot", ...(r.inStarters ? ["He is currently in your starting lineup"] : [])],
              command: text,
            })
          );
          movesByLeague.set(r.leagueId, (movesByLeague.get(r.leagueId) ?? 0) + 1);
          continue;
        }

        // IR is full. If the owner gave a release order, use the first name
        // on it who's actually a real, currently-on-IR, non-Priority
        // occupant of THIS league (r.dropCandidates already excludes
        // Priority-listed players and anyone claimed by an earlier need).
        const claimed = claimedReleaseByLeague.get(r.leagueId) ?? new Set<string>();
        const pick = releaseOrder?.find((p) => r.dropCandidates.includes(p.id) && !claimed.has(p.id)) ?? null;
        if (pick) {
          claimed.add(pick.id);
          claimedReleaseByLeague.set(r.leagueId, claimed);
          e.items.push(`${label}: releasing ${pick.name} to make room, then moving him to IR`);
          byLeague.set(r.leagueId, e);
          // Listed release-then-move — the bulk executor runs one at a time,
          // in order, and stops on the first unverified result, so this
          // order is what makes the sequencing safe: the IR_MOVE only ever
          // runs after the release is confirmed.
          irDrafts.push(
            dropDraft({
              league: env.tools.get_league_details(r.leagueId),
              playerId: pick.id,
              playerName: pick.name,
              rationale: [`Your release order: releasing ${pick.name} to make room on IR`, `This frees the slot ${nm} (${r.injury}) needs`],
              command: text,
            })
          );
          irDrafts.push(
            irDraft({
              league: env.tools.get_league_details(r.leagueId),
              playerId: r.playerId,
              playerName: nm,
              injury: r.injury,
              rationale: [`Sleeper lists ${nm} as ${r.injury}`, `Only proposable after releasing ${pick.name} above — this league's IR is full otherwise`, ...(r.inStarters ? ["He is currently in your starting lineup"] : [])],
              command: text,
            })
          );
          movesByLeague.set(r.leagueId, (movesByLeague.get(r.leagueId) ?? 0) + 1);
          releasedPairs++;
          continue;
        }

        // Once a release order is in effect (inline or the standing IR
        // Release list), it's strict: never name a real IR occupant who
        // isn't on it, even informationally.
        e.items.push(
          `${label}: ${
            releaseOrder
              ? `IR full — none of your release list (${releaseOrder.map((p) => p.name).join(", ")}) is on IR in this league`
              : r.noRoom
                ? "IR is full and nobody on it can be released"
                : `IR full — would need to release ${r.dropId ? posName(env, r.dropId) : "someone"} from IR first`
          }`
        );
        byLeague.set(r.leagueId, e);
      }
      const list = [...byLeague.values()];
      blocks.push({
        t: "text",
        tone: list.length ? "good" : "info",
        text: `${rows.length} player${rows.length === 1 ? "" : "s"} across ${list.length} league${list.length === 1 ? "" : "s"} could be moved to IR under each league's own IR rules (Doubtful is never suggested).${
          releaseOrder ? ` ${releasedPairs} of those used your release order (${releaseOrder.map((p) => p.name).join(" → ")}).` : ""
        } Nothing has been moved.`,
      });
      blocks.push({ t: "decisions", title: "IR opportunities", rows: list.slice(0, ROW_CAP), truncated: Math.max(0, list.length - ROW_CAP) });
      // A player moving from the active roster to IR always frees an active
      // (bench) spot behind him — real roster math, not a guess, so this
      // tells the owner up front where a waiver add could follow without
      // needing its own drop.
      const openAfter: { leagueId: string; leagueName: string; slots: number }[] = [];
      for (const [leagueId, moves] of movesByLeague) {
        const lgPlan = plan.find((p) => p.leagueId === leagueId);
        const rp = lgPlan && rosterPositions(lgPlan.settings);
        if (!lgPlan || !rp) continue;
        const activeBefore = lgPlan.players.length - lgPlan.reserve.length;
        const slots = Math.max(0, rp.length - (activeBefore - moves));
        if (slots > 0) openAfter.push({ leagueId, leagueName: lgPlan.leagueName, slots });
      }
      const irb = draftsBlock(env, permission, irDrafts);
      if (irb) blocks.push(irb);
      if (openAfter.length > 0) {
        blocks.push({
          t: "text",
          tone: "info",
          text: `If all ${irDrafts.length} of those IR moves go through, ${openAfter.length} league${openAfter.length === 1 ? "" : "s"} would have an open bench slot afterward — worth knowing before a waiver add there.`,
        });
        blocks.push({
          t: "decisions",
          title: "Open bench slot after these IR moves",
          rows: openAfter.slice(0, ROW_CAP).map((o) => ({ leagueId: o.leagueId, leagueName: o.leagueName, items: [`${o.slots} open slot${o.slots === 1 ? "" : "s"} after the move${movesByLeague.get(o.leagueId)! > 1 ? "s" : ""}`] })),
          truncated: Math.max(0, openAfter.length - ROW_CAP),
        });
      }
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
      let games: GameCounts;
      let sleeper: SleeperInfo;
      const stored = session.matchups;
      // A stored result is only reused for a minute — scores change live.
      if (stored && stored.week === week && !intent.fresh && intent.verdict && now() - stored.at < 60_000) {
        rows = stored.rows; // follow-up: filter what we already read, no re-scan
        games = stored.games;
        sleeper = stored.sleeper;
      } else {
        const states = env.getGameStates ? await env.getGameStates().catch(() => null) : null;
        if (!states) {
          blocks.push({
            t: "text",
            tone: "warn",
            text: "I couldn't load which NFL games are played, in progress or still to come (ESPN's scoreboard didn't respond), so I can't tell who has played. I won't guess — nothing was counted. Try again in a moment.",
          });
          break;
        }
        const scanned = await scanMatchups(env, proj, states, (meta) => {
          session = { ...session, meta };
        });
        rows = scanned.rows;
        games = scanned.games;
        sleeper = scanned.sleeper;
        session = { ...session, matchups: { week, rows, at: now(), games, sleeper } };
      }
      const counts = countVerdicts(rows);
      const live = summarizeLive(rows, games);
      const matches = (r: MatchupRow) => {
        switch (intent.verdict) {
          case undefined: return true;
          case "LEADING": return r.nowMine != null && r.nowOpp != null && r.nowMine > r.nowOpp && !["WON", "LOST", "TIED"].includes(r.verdict);
          case "TRAILING": return r.nowMine != null && r.nowOpp != null && r.nowMine < r.nowOpp && !["WON", "LOST", "TIED"].includes(r.verdict);
          default: return r.verdict === intent.verdict;
        }
      };
      const shown = rows.filter(matches);
      const total = rows.length;
      const inPlay = counts.WIN + counts.LOSS + counts.TOSS_UP;
      const final = counts.WON + counts.LOST + counts.TIED;
      blocks.push({
        t: "text",
        tone: "good",
        text:
          `Week ${week}, live: ${final} matchup${final === 1 ? " is" : "s are"} already decided (${counts.WON} won, ${counts.LOST} lost, ${counts.TIED} tied). ` +
          `Of the ${inPlay} still in play, you're projected to win ${counts.WIN}, lose ${counts.LOSS}, and ${counts.TOSS_UP} are too close to call (within ${TOSS_UP_PTS} pts). ` +
          `Right now you're leading in ${live.leading} and trailing in ${live.trailing}${live.even ? ` (${live.even} level)` : ""}. ` +
          `Starters still to finish: yours ${live.leftMine}, opponents' ${live.leftOpp}. ` +
          `Projected total if it ends as expected: ${counts.WON + counts.WIN} wins, ${counts.LOST + counts.LOSS} losses, ${counts.TIED + counts.TOSS_UP} tied/too close${counts.NO_OPPONENT ? `, ${counts.NO_OPPONENT} with no opponent` : ""}. ` +
          (counts.UNKNOWN > 0 ? `${counts.UNKNOWN} league${counts.UNKNOWN === 1 ? "" : "s"} could not be read and are NOT counted as wins or losses.` : ""),
      });
      const inPlayRows = rows.filter((r) => ["WIN", "LOSS", "TOSS_UP"].includes(r.verdict));
      const disagree = inPlayRows.filter((r) => r.source === "sleeper" && r.estMine != null && r.estOpp != null && r.projMine != null && r.projOpp != null && Math.sign(r.projMine - r.projOpp) !== Math.sign(r.estMine - r.estOpp) && Math.abs(r.estMine - r.estOpp) >= TOSS_UP_PTS).length;
      if (sleeper.used > 0) {
        blocks.push({
          t: "text",
          tone: "info",
          text: `Predictions are Sleeper's own projected scores (the same numbers as your Sleeper app's matchup screen) in ${sleeper.used} league${sleeper.used === 1 ? "" : "s"}${sleeper.failed ? `; ${sleeper.failed} couldn't be read from Sleeper and use Fantis's own estimate instead (marked on the row)` : ""}.${disagree ? ` In ${disagree} of them Fantis's own estimate points the other way — shown on the row.` : ""}`,
        });
      } else if (!sleeper.hadAccess) {
        blocks.push({
          t: "text",
          tone: "warn",
          text: "These use Fantis's own estimate (real scores so far + Sleeper's per-player projections), not the predictions your Sleeper app shows. To use Sleeper's own predictions, connect Sleeper access on the Lineups page — it's only used to read them.",
        });
      } else if (sleeper.authFailed) {
        blocks.push({
          t: "text",
          tone: "warn",
          text: "Sleeper rejected the saved login token (it may have expired), so these use Fantis's own estimate. Reconnect Sleeper access on the Lineups page to use Sleeper's own predictions.",
        });
      }
      blocks.push({
        t: "text",
        tone: "info",
        text: "How this is built: points so far are your real Sleeper scores. A starter whose game is over counts exactly what he scored; one who hasn't played counts Sleeper's projection for the week; one mid-game counts points so far plus the projection scaled by game time remaining (an approximation). Projections use each league's PPR/half/standard setting; custom scoring isn't applied. It's a projection, not a win probability.",
      });
      blocks.push({
        t: "matchups",
        title: intent.verdict ? `Leagues — ${describeVerdictFilter(intent.verdict)} (${shown.length})` : `Every league — week ${week} (${total})`,
        week,
        counts,
        live,
        rows: shown.slice(0, ROW_CAP),
        truncated: Math.max(0, shown.length - ROW_CAP),
      });
      const gapLeagues = rows.filter((r) => r.warnings.some((w) => /no projection|empty/.test(w))).length;
      if (gapLeagues > 0) {
        blocks.push({ t: "text", tone: "warn", text: `${gapLeagues} league${gapLeagues === 1 ? " has" : "s have"} an empty starter slot or a starter with no projection — those count as 0 and are flagged on the row.` });
      }
      recs.push(`week ${week}: ${counts.WON + counts.WIN} won/projected wins, ${counts.LOST + counts.LOSS} lost/projected losses, ${counts.TOSS_UP} toss-ups`);
      break;
    }

    case "standings": {
      let rows: StandingRow[];
      const st = session.standings;
      if (st && !intent.fresh && now() - st.at < 5 * 60_000) rows = st.rows;
      else {
        const { snaps, meta } = await scanAll(env, false, "Reading standings");
        session = { ...session, meta };
        blocks.push({ t: "scanStatus", meta });
        rows = snaps.filter((sn) => sn.status !== "FAILED" && sn.rosters).map((sn) => standingRow(env, sn));
        session = { ...session, standings: { rows, at: now() } };
      }
      const counts: Record<PlayoffStatus, number> = { IN: 0, BUBBLE: 0, OUT: 0, UNKNOWN: 0 };
      for (const r of rows) counts[r.status]++;
      const scored = rows.filter((r) => r.fcRank != null);
      const top3 = scored.filter((r) => (r.fcRank as number) <= 3).length;
      const bottomHalf = scored.filter((r) => (r.fcRank as number) > r.of / 2).length;
      const early = rows.filter((r) => r.warnings.some((w) => /games played/.test(w))).length;
      const mismatch = rows.filter((r) => r.status === "OUT" && r.fcRank != null && r.fcRank <= 3).length;
      const shown = intent.filter ? rows.filter((r) => r.status === intent.filter) : rows;
      blocks.push({
        t: "text",
        tone: "good",
        text:
          (early >= rows.length / 2 ? `Very early read — most leagues have fewer than 3 games played, so standings are thin and will move. ` : "") +
          `Playoff position right now (real Sleeper records): in a playoff spot in ${counts.IN} of ${rows.length} leagues, on the bubble (within a game of the line) in ${counts.BUBBLE}, outside in ${counts.OUT}${counts.UNKNOWN ? `, ${counts.UNKNOWN} unknown (no playoff-team count on file)` : ""}. ` +
          (scored.length ? `By FantasyCalc roster value your team ranks top-3 in ${top3} leagues and bottom-half in ${bottomHalf} (of ${scored.length} with values). ` : "FantasyCalc values aren't loaded yet, so roster strength isn't shown. ") +
          (mismatch ? `${mismatch} league${mismatch === 1 ? "" : "s"} where you're outside the line despite a top-3 roster — likely bad luck, not a weak team. ` : "") +
          (early && early < rows.length / 2 ? `${early} leagues have fewer than 3 games played, so their standings are thin.` : ""),
      });
      blocks.push({ t: "standings", title: intent.filter ? `Leagues — ${intent.filter === "IN" ? "in a playoff spot" : intent.filter === "OUT" ? "outside the playoff line" : "on the bubble"} (${shown.length})` : `Every league (${rows.length})`, counts, fc: { top3, bottomHalf, scored: scored.length }, rows: shown.slice(0, ROW_CAP), truncated: Math.max(0, shown.length - ROW_CAP) });
      recs.push(`playoffs: ${counts.IN} in, ${counts.BUBBLE} bubble, ${counts.OUT} out`);
      break;
    }

    case "activate_ir": {
      const resolved = await resolveMentions(intent.mentions.map((m) => m.text), [], { filter: {}, wantDrops: false });
      if (!resolved) break; // ambiguous or not found — resolveMentions already asked/explained
      const players = resolved; // one or more named players, activated together
      const label = players.map((p) => p.name).join(", ");
      const { snaps, meta } = await scanAll(env, false, `Checking IR status for ${label}`);
      session = { ...session, meta };
      blocks.push({ t: "scanStatus", meta });
      const plan: PlanLeague[] = [];
      for (const s of snaps) {
        if (s.status === "FAILED" || !s.rosters) continue;
        const mine = s.rosters.find((r) => r.rosterId === s.league.rosterId)!;
        plan.push({ leagueId: s.league.id, leagueName: s.league.name, rosterId: mine.rosterId, settings: s.league.settings, starters: mine.starters, players: mine.players, reserve: mine.reserve, faabUsed: null });
      }
      const rowsByPlayer = new Map(players.map((p) => [p.id, buildActivateIrPlan(p.id, plan, env.rank, (id) => env.signals.priority.has(id))]));
      const totalRows = [...rowsByPlayer.values()].reduce((n, r) => n + r.length, 0);
      if (totalRows === 0) {
        blocks.push({ t: "text", tone: "info", text: `${players.length === 1 ? `${players[0].name} isn't` : `None of ${label} are`} on IR in any of your ${plan.length} readable leagues.` });
        break;
      }
      const drafts: ProposalDraft[] = [];
      // Each drop candidate is claimed by at most one named player per
      // league — same rule as a multi-target add's distinct drops — so two
      // IR players activated together in the same league never get proposed
      // to drop the same bench player.
      const claimedByLeague = new Map<string, Set<string>>();
      const skippedByPlayer = new Map(players.map((p) => [p.id, 0]));
      const decisionsByLeague = new Map<string, { leagueId: string; leagueName: string; items: string[] }>();
      for (const p of players) {
        for (const r of rowsByPlayer.get(p.id)!) {
          let dropId = r.dropId;
          let unclaimed = true;
          if (r.needsDrop) {
            const claimed = claimedByLeague.get(r.leagueId) ?? new Set<string>();
            const cand = r.dropCandidates.find((id) => !claimed.has(id));
            if (!cand) {
              unclaimed = false;
              skippedByPlayer.set(p.id, (skippedByPlayer.get(p.id) ?? 0) + 1);
            } else {
              claimed.add(cand);
              claimedByLeague.set(r.leagueId, claimed);
              dropId = cand;
            }
          }
          const entry = decisionsByLeague.get(r.leagueId) ?? { leagueId: r.leagueId, leagueName: r.leagueName, items: [] };
          entry.items.push(
            `${p.name}: ${r.needsDrop ? (unclaimed && dropId ? `would drop ${posName(env, dropId)} to make room` : r.dropId ? "no unclaimed bench candidate left after the others" : "roster full, nobody clear to drop") : "open roster spot — no drop needed"}`
          );
          decisionsByLeague.set(r.leagueId, entry);
          if (!unclaimed) continue;
          const drop = r.needsDrop && dropId ? { id: dropId, name: posName(env, dropId) } : null;
          drafts.push(
            activateIrDraft({
              league: env.tools.get_league_details(r.leagueId),
              playerId: p.id,
              playerName: p.name,
              drop,
              rationale: [`${p.name} is on IR in this league`, r.needsDrop ? `Roster is full — suggested drop: ${drop?.name}` : "Open roster spot — no drop needed"],
              command: text,
            })
          );
        }
      }
      const lines: string[] = [];
      for (const p of players) {
        const rows = rowsByPlayer.get(p.id)!;
        if (rows.length === 0) {
          lines.push(`${p.name} isn't on IR in any of your ${plan.length} readable leagues.`);
          continue;
        }
        const draftsForP = drafts.filter((d) => (d.params as ActivateIrParams).playerId === p.id);
        const skippedForP = skippedByPlayer.get(p.id) ?? 0;
        lines.push(
          `${p.name} is on IR in ${rows.length} league${rows.length === 1 ? "" : "s"}. ${draftsForP.length} can be proposed to move him to the bench${skippedForP > 0 ? `; ${skippedForP} would need a drop with no clear bench candidate` : ""}.`
        );
      }
      const trailer =
        players.length === 1
          ? "This only moves him to your bench — it doesn't set him as a starter (ask me to start him separately once he's active)."
          : "This only moves them to their bench — it doesn't set anyone as a starter (ask me to start any of them separately once active).";
      blocks.push({ t: "text", tone: drafts.length ? "good" : "info", text: `${lines.join(" ")} ${trailer} Nothing has been changed.` });
      blocks.push({ t: "decisions", title: "IR → bench", rows: [...decisionsByLeague.values()], truncated: 0 });
      const b = draftsBlock(env, permission, drafts, [...skippedByPlayer.values()].reduce((a, c) => a + c, 0));
      if (b) blocks.push(b);
      recs.push(`activate ${label} from IR in ${drafts.length} of ${totalRows} leagues`);
      break;
    }

    case "send_to_ir": {
      const resolved = await resolveMentions(intent.mentions.map((m) => m.text), [], { filter: {}, wantDrops: false });
      if (!resolved) break; // ambiguous or not found — resolveMentions already asked/explained
      const players = resolved; // one or more named players, sent together
      const label = players.map((p) => p.name).join(", ");
      const { snaps, meta } = await scanAll(env, false, `Checking where I can move ${label} to IR`);
      session = { ...session, meta };
      blocks.push({ t: "scanStatus", meta });
      // Every readable league where each is rostered is accounted for —
      // already on IR, or not eligible under that league's own rules
      // (healthy, or a status like Questionable/Doubtful that doesn't
      // qualify) — never silently dropped, same as activate_ir/force_start.
      type Candidate = { leagueId: string; leagueName: string; injury: string; inStarters: boolean };
      const alreadyOnIrByPlayer = new Map(players.map((p) => [p.id, [] as string[]]));
      const notEligibleByPlayer = new Map(players.map((p) => [p.id, [] as string[]]));
      const candidatesByPlayer = new Map(players.map((p) => [p.id, [] as Candidate[]]));
      const openSlotsByLeague = new Map<string, number>();
      for (const s of snaps) {
        if (s.status === "FAILED" || !s.rosters) continue;
        const me = s.rosters.find((r) => r.rosterId === s.league.rosterId)!;
        for (const p of players) {
          if (!me.players.includes(p.id)) continue; // not rostered here — not this league's problem
          if (me.reserve.includes(p.id)) {
            alreadyOnIrByPlayer.get(p.id)!.push(s.league.name);
            continue;
          }
          const inj = env.pmap[p.id]?.inj ?? null;
          if (!irAllowed(s.league.settings, inj)) {
            notEligibleByPlayer.get(p.id)!.push(s.league.name);
            continue;
          }
          candidatesByPlayer.get(p.id)!.push({ leagueId: s.league.id, leagueName: s.league.name, injury: inj!, inStarters: me.starters.includes(p.id) });
          if (!openSlotsByLeague.has(s.league.id)) openSlotsByLeague.set(s.league.id, Math.max(0, irSlots(s.league.settings) - me.reserve.length));
        }
      }
      const totalCandidates = [...candidatesByPlayer.values()].reduce((n, c) => n + c.length, 0);
      if (totalCandidates === 0) {
        const lines = players.map((p) => {
          const bits: string[] = [];
          if (alreadyOnIrByPlayer.get(p.id)!.length) bits.push(`already on IR in ${alreadyOnIrByPlayer.get(p.id)!.length}`);
          if (notEligibleByPlayer.get(p.id)!.length) bits.push(`not IR-eligible (healthy, or his real status doesn't qualify) in ${notEligibleByPlayer.get(p.id)!.length}`);
          return `${p.name} can't be moved to IR right now — ${bits.length ? bits.join(", and ") : `he isn't on your roster in any of your ${meta.ok + meta.partial} readable leagues`}.`;
        });
        blocks.push({ t: "text", tone: "info", text: lines.join(" ") });
        break;
      }
      // Real open-IR-slot competition, shared across the NAMED players when
      // more than one lands in the same league (most-out-first, same
      // severity order buildIrPlan already uses) — an unrelated, un-named
      // injured player on the same roster is never pulled into this; this
      // command is scoped to exactly who was asked for.
      const byLeague = new Map<string, { player: PlayerCard; c: Candidate }[]>();
      for (const p of players) {
        for (const c of candidatesByPlayer.get(p.id)!) {
          const arr = byLeague.get(c.leagueId) ?? [];
          arr.push({ player: p, c });
          byLeague.set(c.leagueId, arr);
        }
      }
      for (const arr of byLeague.values()) arr.sort((a, b) => (SEVERITY[a.c.injury] ?? 9) - (SEVERITY[b.c.injury] ?? 9));
      const drafts: ProposalDraft[] = [];
      const fullByPlayer = new Map(players.map((p) => [p.id, 0]));
      const decisionsByLeague = new Map<string, { leagueId: string; leagueName: string; items: string[] }>();
      for (const [leagueId, arr] of byLeague) {
        let open = openSlotsByLeague.get(leagueId) ?? 0;
        const leagueName = arr[0].c.leagueName;
        const entry = decisionsByLeague.get(leagueId) ?? { leagueId, leagueName, items: [] };
        for (const { player: p, c } of arr) {
          if (open > 0) {
            open -= 1;
            entry.items.push(`${p.name}: open IR slot — ${c.injury}`);
            drafts.push(
              irDraft({
                league: env.tools.get_league_details(leagueId),
                playerId: p.id,
                playerName: p.name,
                injury: c.injury,
                rationale: [`Sleeper lists ${p.name} as ${c.injury}`, "This league's IR rules allow it and there is an open IR slot", ...(c.inStarters ? ["He is currently in your starting lineup"] : [])],
                command: text,
              })
            );
          } else {
            entry.items.push(`${p.name}: IR is full — release someone from IR first`);
            fullByPlayer.set(p.id, (fullByPlayer.get(p.id) ?? 0) + 1);
          }
        }
        decisionsByLeague.set(leagueId, entry);
      }
      const lines: string[] = [];
      for (const p of players) {
        const cands = candidatesByPlayer.get(p.id)!;
        const draftsForP = drafts.filter((d) => (d.params as IrParams).playerId === p.id);
        const full = fullByPlayer.get(p.id) ?? 0;
        const bits: string[] = [];
        if (alreadyOnIrByPlayer.get(p.id)!.length) bits.push(`already on IR in ${alreadyOnIrByPlayer.get(p.id)!.length}`);
        if (notEligibleByPlayer.get(p.id)!.length) bits.push(`not IR-eligible in ${notEligibleByPlayer.get(p.id)!.length}`);
        lines.push(
          `${p.name} is real IR-eligible in ${cands.length} league${cands.length === 1 ? "" : "s"}. ${draftsForP.length} can be proposed to move him to IR${
            full > 0 ? `; ${full} have a full IR — you'd need to release someone off IR first` : ""
          }${bits.length ? `. Also: ${bits.join(", ")}` : ""}.`
        );
      }
      blocks.push({ t: "text", tone: drafts.length ? "good" : "info", text: `${lines.join(" ")} Nothing has been changed.` });
      blocks.push({ t: "decisions", title: "Move to IR", rows: [...decisionsByLeague.values()], truncated: 0 });
      const irb = draftsBlock(env, permission, drafts, [...fullByPlayer.values()].reduce((a, c) => a + c, 0));
      if (irb) blocks.push(irb);
      recs.push(`move ${label} to IR in ${drafts.length} of ${totalCandidates} leagues`);
      break;
    }

    case "force_start": {
      const resolved = await resolveMentions(intent.mentions.map((m) => m.text), [], { filter: {}, wantDrops: false });
      if (!resolved) break;
      const players = resolved; // one or more named players, forced together
      const proj = env.projections;
      const week = env.week;
      if (!proj || week == null) {
        blocks.push({ t: "text", tone: "warn", text: "This week's Sleeper projections haven't loaded yet, so I can't build a lineup change. Try again in a moment." });
        break;
      }
      const kickoffs = env.kickoffs ? await env.kickoffs().catch(() => null) : null;
      if (!kickoffs) {
        blocks.push({ t: "text", tone: "warn", text: "I couldn't load kickoff times, so I can't tell which games have already started. I won't touch lineups without that — try again in a moment." });
        break;
      }
      const label = players.map((p) => p.name).join(", ");
      const { snaps, meta } = await scanAll(env, false, `Checking where I can start ${label}`);
      session = { ...session, meta };
      blocks.push({ t: "scanStatus", meta });
      const nowMs = now();
      const isLocked = (id: string) => {
        const team = env.pmap[id]?.t;
        const ko = team ? kickoffs[team] : undefined;
        return !!ko && Date.parse(ko) <= nowMs;
      };
      const OUT = new Set(["Out", "IR", "PUP", "Sus", "Doubtful"]);
      const isUnavailable = (id: string) => {
        const e = env.pmap[id];
        if (!e) return true;
        if (e.inj && OUT.has(e.inj)) return true;
        return !!e.t && BYE_WEEKS_2026[e.t] === week;
      };
      // Forced priority: ONLY these named players, for this one command — the
      // owner's saved Priority list is deliberately not mixed in, so the
      // result is predictable. Ranked in the order they were named, purely
      // as a tie-break if two of them ever compete for the same single slot.
      const prio = new Map(players.map((p, i) => [p.id, i]));
      const drafts: ProposalDraft[] = [];
      const buckets = new Map(players.map((p) => [p.id, { onReserve: [] as string[], unavailableIn: [] as string[], lockedIn: [] as string[], noSlot: [] as string[], alreadyStarting: [] as string[], started: [] as string[] }]));
      for (const snap of snaps) {
        if (snap.status === "FAILED" || !snap.rosters) continue;
        const me = snap.rosters.find((r) => r.rosterId === snap.league.rosterId)!;
        const rosteredHere = players.filter((p) => me.players.includes(p.id));
        if (rosteredHere.length === 0) continue; // none of them are on this roster — not this league's problem
        const forceable: typeof players = [];
        for (const p of rosteredHere) {
          const b = buckets.get(p.id)!;
          if (me.reserve.includes(p.id) || me.taxi.includes(p.id)) {
            b.onReserve.push(snap.league.name);
          } else if (me.starters.includes(p.id)) {
            b.alreadyStarting.push(snap.league.name);
          } else if (isUnavailable(p.id)) {
            b.unavailableIn.push(snap.league.name); // Out/IR-status/bye — never force-started, same rule Optimize already follows
          } else if (isLocked(p.id)) {
            b.lockedIn.push(snap.league.name);
          } else {
            forceable.push(p);
          }
        }
        if (forceable.length === 0) continue;
        const rp = rosterPositions(snap.league.settings);
        if (!rp) continue;
        const slots = buildStartingSlots(rp).map((x) => x.code);
        if (slots.length === 0) continue;
        const off = new Set([...me.reserve, ...me.taxi]);
        const key = scoringKey(snap.league.settings);
        const res = optimizeLineup({
          slotCodes: slots,
          starters: me.starters,
          candidates: me.players.filter((id) => !off.has(id)),
          posOf: (id) => env.pmap[id]?.p ?? null,
          points: (id) => proj[id]?.[key] ?? 0,
          unavailable: isUnavailable,
          locked: isLocked,
          priorityRank: (id) => prio.get(id),
          avoid: (id) => env.signals.avoid.has(id),
        });
        const actuallyStarted = forceable.filter((p) => res.starters.includes(p.id));
        for (const p of forceable) {
          if (!res.starters.includes(p.id)) buckets.get(p.id)!.noSlot.push(snap.league.name); // no slot in this league's roster_positions can hold his position
        }
        if (actuallyStarted.length === 0) continue;
        for (const p of actuallyStarted) buckets.get(p.id)!.started.push(snap.league.name);
        const nm = (id: string | null) => (id ? posName(env, id) : null);
        drafts.push({
          kind: "SET_LINEUP",
          leagueId: snap.league.id,
          leagueName: snap.league.name,
          rosterId: snap.league.rosterId,
          params: {
            week,
            fromStarters: me.starters.map((x) => x || "0"),
            toStarters: res.starters,
            changes: res.changes.map((c) => ({ slot: c.slotCode, outName: nm(c.out), inName: nm(c.in) })),
            gain: Math.round(res.gain * 10) / 10,
          },
          rationale: [
            `You asked to start ${actuallyStarted.map((p) => p.name).join(", ")} here`,
            ...res.changes.map((c) => `${c.slotCode}: ${nm(c.in) ?? "empty"} in for ${nm(c.out) ?? "empty"}`),
            res.gain < 0 ? `This costs ${Math.abs(res.gain).toFixed(1)} projected points versus the best lineup — your call, not a mistake.` : `Also ${res.gain >= 0 ? "gains" : "costs"} ${Math.abs(res.gain).toFixed(1)} projected points.`,
          ],
          origin: "chat",
          command: text,
        });
      }
      const lines: string[] = [];
      for (const p of players) {
        const b = buckets.get(p.id)!;
        const rosteredCount = b.started.length + b.alreadyStarting.length + b.unavailableIn.length + b.lockedIn.length + b.onReserve.length + b.noSlot.length;
        if (rosteredCount === 0) {
          lines.push(`${p.name} isn't on your roster in any readable league.`);
          continue;
        }
        lines.push(
          `${p.name}: already starting in ${b.alreadyStarting.length} league${b.alreadyStarting.length === 1 ? "" : "s"}, can be started in ${b.started.length} more. ` +
            (b.onReserve.length ? `On IR/taxi in ${b.onReserve.length} (can't start until activated — ask me to activate him). ` : "") +
            (b.unavailableIn.length ? `Not started in ${b.unavailableIn.length} — his real status or bye makes him unavailable there; I never override that. ` : "") +
            (b.lockedIn.length ? `Too late in ${b.lockedIn.length} — his game already started. ` : "") +
            (b.noSlot.length ? `No eligible roster slot for his position in ${b.noSlot.length} league${b.noSlot.length === 1 ? "" : "s"}. ` : "")
        );
      }
      blocks.push({ t: "text", tone: drafts.length ? "good" : "info", text: `${lines.join(" ")} Nothing has been changed.`.trim() });
      if (drafts.length) {
        const b = draftsBlock(env, permission, drafts);
        if (b) blocks.push(b);
      }
      recs.push(`start ${label}: ${drafts.length} leagues affected`);
      break;
    }

    case "lineup_improvements": {
      const proj = env.projections;
      const week = env.week;
      if (!proj || week == null) {
        blocks.push({ t: "text", tone: "warn", text: "This week's Sleeper projections haven't loaded yet, so I can't compare lineups. Try again in a moment." });
        break;
      }
      const kickoffs = env.kickoffs ? await env.kickoffs().catch(() => null) : null;
      if (!kickoffs) {
        blocks.push({ t: "text", tone: "warn", text: "I couldn't load kickoff times, so I can't tell which games have already started. I won't propose lineup changes without that — try again in a moment." });
        break;
      }
      const { snaps, meta } = await scanAll(env, false, "Checking lineups");
      session = { ...session, meta };
      blocks.push({ t: "scanStatus", meta });
      const nowMs = now();
      const isLocked = (id: string) => {
        const team = env.pmap[id]?.t;
        const ko = team ? kickoffs[team] : undefined;
        return !!ko && Date.parse(ko) <= nowMs;
      };
      const OUT = new Set(["Out", "IR", "PUP", "Sus", "Doubtful"]);
      const isUnavailable = (id: string) => {
        const e = env.pmap[id];
        if (!e) return true;
        if (e.inj && OUT.has(e.inj)) return true;
        return !!e.t && BYE_WEEKS_2026[e.t] === week;
      };
      const order = env.signals.priorityOrder ?? [...env.signals.priority];
      const prio = new Map(order.map((id, i) => [id, i]));
      // The owner's curated /admin rankings, best-to-worst — passed as
      // rankTiebreak (a tiny nudge, not BulkOptimize's full rankings-mode
      // band), so it only settles a start/sit call the projections
      // themselves leave tied.
      const curatedOrder = env.curatedIds ? new Map(env.curatedIds.map((id, i) => [id, i])) : null;
      // Real kickoff day, from the same kickoff times used for lock checks —
      // not a guess. Thursday locks first (no reason to leave him in flex);
      // Monday locks last (keep him in the flexible slot till the latest
      // possible decision).
      const gameDay = (id: string): "THU" | "MON" | undefined => {
        const team = env.pmap[id]?.t;
        const ko = team ? kickoffs[team] : undefined;
        if (!ko) return undefined;
        const d = new Date(ko).getDay();
        if (d === 4) return "THU";
        if (d === 1) return "MON";
        return undefined;
      };
      const found: { draft: ProposalDraft; league: string; gain: number; reslotOnly: boolean }[] = [];
      for (const snap of snaps) {
        if (snap.status === "FAILED" || !snap.rosters) continue;
        const me = snap.rosters.find((r) => r.rosterId === snap.league.rosterId)!;
        const rp = rosterPositions(snap.league.settings);
        if (!rp) continue;
        const slots = buildStartingSlots(rp).map((x) => x.code);
        if (slots.length === 0) continue;
        const off = new Set([...me.reserve, ...me.taxi]);
        const key = scoringKey(snap.league.settings);
        const base = {
          slotCodes: slots,
          starters: me.starters,
          candidates: me.players.filter((id) => !off.has(id)),
          posOf: (id: string) => env.pmap[id]?.p ?? null,
          points: (id: string) => proj[id]?.[key] ?? 0,
          unavailable: isUnavailable,
          locked: isLocked,
          priorityRank: (id: string) => prio.get(id),
          avoid: (id: string) => env.signals.avoid.has(id),
        };
        const res = optimizeLineup({
          ...base,
          rankTiebreak: curatedOrder ? (id) => curatedOrder.get(id) : undefined,
          gameDay,
        });
        if (res.changes.length === 0) continue;
        // A real point-driven gain always clears the 0.05 bar on its own. If
        // it doesn't, check whether the change is purely an artifact of this
        // week's Thursday/Monday placement or curated-rankings tie-break by
        // re-running without them — if THAT finds no real improvement either,
        // the visible change here has ~zero point impact and is worth
        // proposing anyway (that's the whole point of those two features);
        // otherwise it's a genuine marginal gain too small to bother with.
        const reslotOnly = res.gain < 0.05 && optimizeLineup(base).gain < 0.05;
        if (res.gain < 0.05 && !reslotOnly) continue;
        const nm = (id: string | null) => (id ? posName(env, id) : null);
        found.push({
          league: snap.league.name,
          gain: res.gain,
          reslotOnly,
          draft: {
            kind: "SET_LINEUP",
            leagueId: snap.league.id,
            leagueName: snap.league.name,
            rosterId: snap.league.rosterId,
            params: {
              week,
              fromStarters: me.starters.map((x) => x || "0"),
              toStarters: res.starters,
              changes: res.changes.map((c) => ({ slot: c.slotCode, outName: nm(c.out), inName: nm(c.in) })),
              gain: Math.round(res.gain * 10) / 10,
            },
            rationale: [
              res.gain >= 0.05
                ? `Projected +${res.gain.toFixed(1)} using Sleeper's own weekly projections (${key})`
                : "No real point change — this only moves Thursday/Monday players into the right slot before their games lock",
              ...res.changes.map((c) => `${c.slotCode}: ${nm(c.in) ?? "empty"} in for ${nm(c.out) ?? "empty"}${c.out && isUnavailable(c.out) ? " (unavailable)" : ""}`),
              "Players whose games have started are left in place; injured and bye-week players are never started",
            ],
            origin: "chat",
            command: text,
          },
        });
      }
      found.sort((a, b) => b.gain - a.gain);
      const bestReal = found.find((f) => !f.reslotOnly);
      blocks.push({
        t: "text",
        tone: found.length ? "good" : "info",
        text: found.length
          ? bestReal
            ? `${found.length} of ${meta.ok + meta.partial} leagues have a better lineup available (best first, +${bestReal.gain.toFixed(1)})${found.length > 1 && found.some((f) => f.reslotOnly) ? ", including Thursday/Monday slot fixes with no point change" : ""}. These use your Priority/Avoid lists, your curated rankings, and Sleeper's projections; started games are frozen. Nothing has been changed.`
            : `${found.length} league${found.length === 1 ? "" : "s"} could have a Thursday/Monday player moved into the right slot — no point change, just correct placement before games lock. Nothing has been changed.`
          : "No lineup improvements found — every lineup already matches the best legal one right now.",
      });
      blocks.push({
        t: "decisions",
        title: "Lineup improvements",
        rows: found.slice(0, ROW_CAP).map((f) => ({ leagueId: f.draft.leagueId, leagueName: f.league, items: (f.draft.params as { changes: { slot: string; outName: string | null; inName: string | null }[] }).changes.map((c) => `${c.slot}: ${c.inName ?? "empty"} for ${c.outName ?? "empty"}`).concat([f.reslotOnly ? "slot fix — no point change" : `+${f.gain.toFixed(1)} projected`]) })),
        truncated: Math.max(0, found.length - ROW_CAP),
      });
      const lb = draftsBlock(env, permission, found.map((f) => f.draft));
      if (lb) blocks.push(lb);
      recs.push(`${found.length} leagues with a better lineup`);
      break;
    }

    case "week_record": {
      const week = intent.week ?? (env.week != null ? (intent.relative === "last" ? env.week - 1 : env.week) : null);
      if (week == null) {
        blocks.push({ t: "text", tone: "warn", text: "I don't know the current week yet, so I can't resolve \"last week\" — try naming the week number, e.g. \"my record for week 2\"." });
        break;
      }
      if (week < 1) {
        blocks.push({ t: "text", tone: "warn", text: "There's no week before week 1." });
        break;
      }
      const result = await env.tools.get_week_record(week);
      if (!result) {
        blocks.push({ t: "text", tone: "warn", text: `Couldn't read week ${week}'s results. Nothing was assumed.` });
        break;
      }
      const wins = result.rows.filter((r) => r.won === true).length;
      const losses = result.rows.filter((r) => r.won === false).length;
      const unresolved = result.rows.filter((r) => r.won == null).length;
      blocks.push({
        t: "text",
        tone: "good",
        text:
          `Week ${week}: ${wins}-${losses}${unresolved ? ` (${unresolved} bye/unresolved, not counted either way)` : ""} across ${result.rows.length} league${result.rows.length === 1 ? "" : "s"}, from Fantis's synced results.` +
          (result.noData.length ? ` ${result.noData.length} league${result.noData.length === 1 ? " has" : "s have"} no synced data for week ${week} yet — not counted as a loss.` : ""),
      });
      blocks.push({ t: "week_record", week, wins, losses, ties: 0, unresolved, rows: result.rows, noData: result.noData });
      recs.push(`week ${week}: ${wins}-${losses}${unresolved ? ` (${unresolved} unresolved)` : ""}`);
      break;
    }

    case "weekly_sweep": {
      // One pass, two halves, one combined review: IR-eligible players (same rule
      // as ir_opps) plus your Priority list's players wherever they're a free
      // agent or on waivers (same rule as a normal player scan). Reuses both
      // existing planners rather than a third one — if two priority players both
      // need a drop in the SAME league, they could be proposed the same bench
      // player; that's caught harmlessly at execution time (live re-validation
      // marks the second one "expired" once the first has actually run), never
      // a double drop.
      const { snaps, meta } = await scanAll(env, true, "Weekly sweep");
      session = { ...session, meta };
      blocks.push({ t: "scanStatus", meta });

      const plan: PlanLeague[] = [];
      for (const s of snaps) {
        if (s.status === "FAILED" || !s.rosters) continue;
        const mine = s.rosters.find((r) => r.rosterId === s.league.rosterId)!;
        plan.push({ leagueId: s.league.id, leagueName: s.league.name, rosterId: mine.rosterId, settings: s.league.settings, starters: mine.starters, players: mine.players, reserve: mine.reserve, faabUsed: null });
      }
      const irRows = buildIrPlan(plan, (id) => env.pmap[id]?.inj ?? null, env.rank, (id) => env.signals.priority.has(id));
      const irDrafts: ProposalDraft[] = [];
      for (const r of irRows) {
        if (r.needsDrop) continue; // IR full — never auto-proposed
        irDrafts.push(
          irDraft({
            league: env.tools.get_league_details(r.leagueId),
            playerId: r.playerId,
            playerName: posName(env, r.playerId),
            injury: r.injury,
            rationale: [`Sleeper lists ${posName(env, r.playerId)} as ${r.injury}`, "This league's IR rules allow it and there is an open IR slot", ...(r.inStarters ? ["He is currently in your starting lineup"] : [])],
            command: text,
          })
        );
      }

      const priorityIds = (env.signals.priorityOrder ?? [...env.signals.priority]).filter((id, i, arr) => arr.indexOf(id) === i);
      const addResults: LeagueResult[] = [];
      for (const pid of priorityIds) {
        const card = cardOf(env.pmap, pid);
        if (!card) continue; // not a real Sleeper player id — skip rather than guess
        for (const s of snaps) addResults.push(classifyPlayer(s, card, now()));
      }
      const actionableAdds = addResults.filter((r) => ACTIONABLE.includes(r.state));
      const snapsById = new Map(snaps.map((s) => [s.league.id, s]));
      const addDrops = computeDrops(env, snapsById, actionableAdds);
      const addFaabStats = actionableAdds.some((r) => r.faab) ? await env.tools.get_faab_stats() : null;
      const addResult = addDraftsFromScan(env, actionableAdds, addDrops, text, addFaabStats);

      const allDrafts = [...irDrafts, ...addResult.drafts];
      const priorityCount = priorityIds.length;
      blocks.push({
        t: "text",
        tone: allDrafts.length ? "good" : "info",
        text:
          `Weekly sweep: ${irDrafts.length} IR move${irDrafts.length === 1 ? "" : "s"} available, ${addResult.drafts.length} add/claim${addResult.drafts.length === 1 ? "" : "s"} across ${priorityCount} priority-list player${priorityCount === 1 ? "" : "s"}. Nothing has been changed.` +
          (priorityCount === 0 ? " Add players to your Priority list (Chat tab → My players) to include them in a sweep." : "") +
          (addResult.skipped > 0 ? ` ${addResult.skipped} priority-league combinations were left out because the drop requirement couldn't be determined.` : ""),
      });
      const b = draftsBlock(env, permission, allDrafts);
      if (b) blocks.push(b);
      recs.push(`weekly sweep: ${irDrafts.length} IR moves, ${addResult.drafts.length} adds/claims`);
      break;
    }

    case "execute_request": {
      if (canPropose(permission)) {
        blocks.push({
          t: "text",
          tone: "warn",
          text: `I don't ${intent.verb} anything from chat, in any mode. What I can do is turn it into a proposal for you to review: below are the changes I'd propose. Nothing has been sent to Sleeper — save them, then approve and execute each one yourself from the Proposals tab.`,
        });
      } else
      blocks.push({
        t: "text",
        tone: "bad",
        text: `I can't ${intent.verb} anything — Command Center is in READ-ONLY mode. I never add, drop, claim, move IR, set lineups or change anything on Sleeper from chat, and no message can switch modes. Nothing has been changed. Below is only a preview of what an approved action could look like.`,
      });
      if (intent.mentions.length > 0) {
        if (hasFilter(intent.filter)) {
          blocks.push({ t: "text", tone: "info", text: `Only showing leagues that match what you asked for: ${describeFilter(intent.filter)}.` });
        }
        const resolved = await resolveMentions(intent.mentions.map((m) => m.text), [], { filter: intent.filter, wantDrops: false, execVerb: intent.verb });
        if (!resolved) break;
        if (intent.dropOrder && intent.dropOrder.length > 0) {
          // "add X, Y, drop A, B if needed" in one message — resolve the
          // owner's drop-order names too, then apply them the same way the
          // two-message drop_preferences follow-up does.
          const dropOrder = await resolveMentions(intent.dropOrder.map((m) => m.text), [], { filter: {}, wantDrops: false });
          if (!dropOrder) break;
          await runScan(resolved, intent.filter, false, intent.verb, dropOrder);
          break;
        }
        await runScan(resolved, intent.filter, false, intent.verb);
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

// -------------------------------------------------------------- standings

const winPct = (r: { wins?: number; losses?: number; ties?: number }) => {
  const g = (r.wins ?? 0) + (r.losses ?? 0) + (r.ties ?? 0);
  return g === 0 ? 0 : ((r.wins ?? 0) + 0.5 * (r.ties ?? 0)) / g;
};
const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`;
export { ordinal };

// One league: my rank by real record (win%, then points for), against the league's
// own playoff_teams. No probabilities — only what the standings and roster values say.
function standingRow(env: EngineEnv, snap: LeagueSnapshot): StandingRow {
  const lg = snap.league;
  const rosters = snap.rosters ?? [];
  const me = rosters.find((r) => r.rosterId === lg.rosterId);
  const warnings: string[] = [];
  const base = { leagueId: lg.id, leagueName: lg.name, of: rosters.length };
  if (!me) return { ...base, record: "—", rank: null, playoffTeams: null, status: "UNKNOWN", gamesFromLine: null, fcRank: null, fcTotal: null, warnings: ["couldn't identify your roster"] };

  const ordered = [...rosters].sort((a, b) => winPct(b) - winPct(a) || (b.fpts ?? 0) - (a.fpts ?? 0));
  const rank = ordered.findIndex((r) => r.rosterId === me.rosterId) + 1;
  const P = numSetting(lg.settings, "playoff_teams") || null;
  const games = (me.wins ?? 0) + (me.losses ?? 0) + (me.ties ?? 0);
  if (games < 3) warnings.push(`only ${games} games played`);
  const record = `${me.wins ?? 0}-${me.losses ?? 0}${me.ties ? `-${me.ties}` : ""}`;

  let status: PlayoffStatus = "UNKNOWN";
  let gamesFromLine: number | null = null;
  if (P && P < rosters.length) {
    const lastIn = ordered[P - 1];
    const firstOut = ordered[P];
    // Games ahead of / behind the line, as (wins − losses) difference / 2.
    const diff = (a: SnapRoster, b: SnapRoster) => ((a.wins ?? 0) - (b.wins ?? 0) + (b.losses ?? 0) - (a.losses ?? 0)) / 2;
    if (rank <= P) {
      gamesFromLine = diff(me, firstOut);
      status = gamesFromLine >= 1 ? "IN" : "BUBBLE";
    } else {
      gamesFromLine = -diff(lastIn, me);
      status = -gamesFromLine < 1 ? "BUBBLE" : "OUT";
    }
  } else if (P) {
    status = "IN"; // everyone makes it
  } else warnings.push("no playoff-team count on file for this league");

  let fcRank: number | null = null;
  let fcTotal: number | null = null;
  const fv = env.signals.fcValueFor;
  if (fv) {
    const total = (r: SnapRoster) => r.players.reduce((sum, id) => sum + (fv(lg.id, id) ?? 0), 0);
    const totals = rosters.map((r) => ({ id: r.rosterId, t: total(r) }));
    if (totals.some((x) => x.t > 0)) {
      totals.sort((a, b) => b.t - a.t);
      fcRank = totals.findIndex((x) => x.id === me.rosterId) + 1;
      fcTotal = totals.find((x) => x.id === me.rosterId)?.t ?? null;
    }
  }
  return { ...base, record, rank, playoffTeams: P, status, gamesFromLine, fcRank, fcTotal, warnings };
}

// ---------------------------------------------------------------- drafts

const numSetting = (settings: unknown, key: string): number => {
  const inner = settings && typeof settings === "object" ? (settings as Record<string, unknown>).settings : null;
  const v = inner && typeof inner === "object" ? (inner as Record<string, unknown>)[key] : undefined;
  return typeof v === "number" ? v : 0;
};

// ADD / waiver-claim drafts from a scan. Only where the answer is certain: the
// player is free or on waivers AND we know whether a drop is needed AND (if one
// is) a droppable candidate exists. Anything uncertain is left out and counted.
function addDraftsFromScan(env: EngineEnv, rows: LeagueResult[], drops: Record<string, DropAnalysis> | null, command: string, faabStats: FaabStats | null): { drafts: ProposalDraft[]; skipped: number } {
  const drafts: ProposalDraft[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  // When more than one target needs a drop in the SAME league (a multi-player
  // "add X and Y" request), each gets a DISTINCT bench candidate — never
  // proposed to drop the same player twice. `candidates` is already ranked
  // weakest-first and isn't target-specific beyond excluding the incoming
  // player, so the fix is just tracking which ones this batch already claimed.
  const claimedByLeague = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!ACTIONABLE.includes(r.state)) continue;
    const key = `${r.leagueId}:${r.playerId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const league = env.tools.get_league_details(r.leagueId);
    let drop: { id: string; name: string } | null = null;
    const rationale = [r.detail];
    if (r.needsDrop === true) {
      const claimed = claimedByLeague.get(r.leagueId) ?? new Set<string>();
      const cand = drops?.[r.leagueId]?.candidates.find((c) => !claimed.has(c.playerId));
      if (!cand) {
        skipped++;
        continue;
      }
      claimed.add(cand.playerId);
      claimedByLeague.set(r.leagueId, claimed);
      drop = { id: cand.playerId, name: cand.name };
      rationale.push(`Roster is full — suggested drop: ${cand.name}`, ...cand.reasons.slice(0, 4));
    } else if (r.needsDrop === null) {
      skipped++;
      continue;
    } else {
      rationale.push("Open roster spot — no drop needed");
    }
const bidMin = numSetting(league.settings, "waiver_bid_min");
    const pos = env.pmap[r.playerId]?.p ?? "";
    const suggestion = r.faab ? suggestBid(faabStats, r.leagueId, pos, bidMin, bidMin) : { bid: 0, n: 0, sourced: false };
    if (r.faab) {
      rationale.push(
        suggestion.sourced
          ? `Suggested bid $${suggestion.bid} — based on ${suggestion.n} real winning ${pos} claim${suggestion.n === 1 ? "" : "s"} in this league`
          : `No ${pos} claim history in this league yet — using the $${suggestion.bid} bid minimum`
      );
    }
    drafts.push(
      addDraft({
        league,
        addId: r.playerId,
        addName: posName(env, r.playerId),
        drop,
        waiver: r.state === "WAIVER",
        faab: r.faab,
        bid: suggestion.bid,
        rationale,
        command,
      })
    );
  }
  return { drafts, skipped };
}

function draftsBlock(env: EngineEnv, permission: Permission, drafts: ProposalDraft[], skipped = 0): Block | null {
  if (drafts.length === 0) return null;
  const extra = skipped > 0 ? ` ${skipped} leagues were left out because the drop requirement or a droppable player couldn't be determined.` : "";
  return {
    t: "drafts",
    drafts,
    note: canPropose(permission)
      ? `${drafts.length} change${drafts.length === 1 ? "" : "s"} drafted as proposals. Nothing has been saved or sent to Sleeper — save the ones you want, then approve and execute each from the Proposals tab.${extra}`
      : `${drafts.length} change${drafts.length === 1 ? "" : "s"} could be proposed. You're in Read-only mode, so they can't be saved — switch to Propose only (top of this panel) to save them for review.${extra}`,
  };
}

// ------------------------------------------------------------- matchups

const TOSS_UP_PTS = 3;
type GameCounts = { pre: number; inPlay: number; post: number };

const VERDICT_FILTER_LABEL: Record<string, string> = {
  WIN: "projected wins",
  LOSS: "projected losses",
  TOSS_UP: "too close to call",
  WON: "already won",
  LOST: "already lost",
  LEADING: "leading right now",
  TRAILING: "trailing right now",
};
const describeVerdictFilter = (v: string) => VERDICT_FILTER_LABEL[v] ?? v;

function countVerdicts(rows: MatchupRow[]): Record<MatchupVerdict, number> {
  const c: Record<MatchupVerdict, number> = { WON: 0, LOST: 0, TIED: 0, WIN: 0, TOSS_UP: 0, LOSS: 0, NO_OPPONENT: 0, UNKNOWN: 0 };
  for (const r of rows) c[r.verdict]++;
  return c;
}

function summarizeLive(rows: MatchupRow[], games: GameCounts) {
  let leading = 0;
  let trailing = 0;
  let even = 0;
  let leftMine = 0;
  let leftOpp = 0;
  for (const r of rows) {
    if (r.nowMine == null || r.nowOpp == null || r.verdict === "UNKNOWN" || r.verdict === "NO_OPPONENT") continue;
    if (r.nowMine > r.nowOpp) leading++;
    else if (r.nowMine < r.nowOpp) trailing++;
    else even++;
    leftMine += r.leftMine;
    leftOpp += r.leftOpp;
  }
  return { leading, trailing, even, leftMine, leftOpp, games };
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
  states: Record<string, GameState>,
  onMeta: (m: ScanMeta) => void
): Promise<{ rows: MatchupRow[]; games: GameCounts; sleeper: SleeperInfo }> {
  const now = env.now ?? (() => Date.now());
  const started = now();
  const all = env.tools.get_my_leagues();
  const scope = all.filter((l) => l.status === "in_season" && !l.bestBall);
  const rows: MatchupRow[] = new Array(scope.length);
  let done = 0;
  let failed = 0;
  let next = 0;
  const hadAccess = env.tools.hasSleeperAccess();
  let sleeperOn = hadAccess;
  let sleeperUsed = 0;
  let sleeperFailed = 0;
  let authFailed = false;
  const label = "Reading this week's live matchups";
  const worker = async () => {
    while (next < scope.length) {
      const i = next++;
      const lg = scope[i];
      try {
        const { mine, opp } = await env.tools.get_matchup(lg.id);
        let sp: { mine: SleeperLeg; opp: SleeperLeg | null } | null = null;
        if (sleeperOn) {
          try {
            sp = await env.tools.get_sleeper_prediction(lg.id);
          } catch (e) {
            sleeperFailed++;
            // A rejected token would fail every remaining league the same way — stop asking.
            if (/unauthor|forbidden|token|expired|jwt/i.test(e instanceof Error ? e.message : "")) {
              authFailed = true;
              sleeperOn = false;
            }
          }
        }
        rows[i] = judgeMatchup(lg, mine, opp, proj, states, env.pmap, sp);
        if (rows[i].source === "sleeper") sleeperUsed++;
      } catch (e) {
        failed++;
        rows[i] = { leagueId: lg.id, leagueName: lg.name, verdict: "UNKNOWN", nowMine: null, nowOpp: null, projMine: null, projOpp: null, leftMine: 0, leftOpp: 0, playedMine: 0, playedOpp: 0, source: "fantis", estMine: null, estOpp: null, warnings: [e instanceof Error ? e.message : "could not be read"] };
      }
      done++;
      env.onProgress?.({ done, total: scope.length, label, failed });
    }
  };
  env.onProgress?.({ done: 0, total: scope.length, label, failed: 0 });
  await Promise.all(Array.from({ length: Math.min(env.concurrency ?? 6, Math.max(1, scope.length)) }, worker));
  const bad = rows.filter((r) => r.verdict === "UNKNOWN");
  const games: GameCounts = {
    pre: new Set(Object.entries(states).filter(([, g]) => g.state === "pre").map(([t]) => t)).size,
    inPlay: new Set(Object.entries(states).filter(([, g]) => g.state === "in").map(([t]) => t)).size,
    post: new Set(Object.entries(states).filter(([, g]) => g.state === "post").map(([t]) => t)).size,
  };
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
  return { rows, games, sleeper: { hadAccess, used: sleeperUsed, authFailed, failed: sleeperFailed } };
}

interface SideResult {
  now: number;
  final: number;
  left: number; // starters whose game isn't over
  played: number; // starters whose game is over
  gaps: number;
  emptySlots: number;
}

// One team's starters → points so far and projected final. Finished games count
// exactly what was scored; unplayed ones count the projection; in-progress ones
// count points so far plus the projection scaled by game time remaining. A
// starter on a bye counts 0 and as "done".
function projectSide(m: RawMatchup, proj: ProjectionMap, key: "pts_ppr" | "pts_half_ppr" | "pts_std", states: Record<string, GameState>, pmap: PlayerMap): SideResult {
  const starters = m.starters ?? [];
  const pts = m.starters_points ?? [];
  const r: SideResult = { now: 0, final: 0, left: 0, played: 0, gaps: 0, emptySlots: 0 };
  starters.forEach((id, i) => {
    if (!id || id === "0") {
      r.emptySlots++;
      return;
    }
    const actual = typeof pts[i] === "number" ? pts[i] : 0;
    const team = pmap[id]?.t || (/^[A-Z]{2,3}$/.test(id) ? id : "");
    const g = team ? states[team] : undefined;
    r.now += actual;
    if (!g) {
      // Not playing this week (bye) — or a player we can't place on a team.
      r.final += actual;
      r.played++;
      return;
    }
    if (g.state === "post") {
      r.final += actual;
      r.played++;
      return;
    }
    const p = proj[id]?.[key];
    if (typeof p !== "number") r.gaps++;
    const projected = typeof p === "number" ? p : 0;
    r.left++;
    r.final += g.state === "pre" ? actual + projected : actual + projected * (1 - g.elapsed);
  });
  return r;
}

function judgeMatchup(
  lg: CcLeague,
  mine: RawMatchup,
  opp: RawMatchup | null,
  proj: ProjectionMap,
  states: Record<string, GameState>,
  pmap: PlayerMap,
  sp: { mine: SleeperLeg; opp: SleeperLeg | null } | null = null
): MatchupRow {
  const { key, assumed } = scoringField(lg.settings);
  const a = projectSide(mine, proj, key, states, pmap);
  const warnings: string[] = [];
  if (assumed) warnings.push("scoring format not found — projections assume full PPR");
  if (a.emptySlots > 0) warnings.push(`you have ${a.emptySlots} empty starter slot${a.emptySlots === 1 ? "" : "s"} (counted as 0)`);
  if (a.gaps > 0) warnings.push(`${a.gaps} of your starters yet to play ${a.gaps === 1 ? "has" : "have"} no projection (counted as 0)`);
  const base = { leagueId: lg.id, leagueName: lg.name };
  if (opp === null) {
    return { ...base, verdict: "NO_OPPONENT", nowMine: round1(a.now), nowOpp: null, projMine: round1(a.final), projOpp: null, leftMine: a.left, leftOpp: 0, playedMine: a.played, playedOpp: 0, source: "fantis", estMine: round1(a.final), estOpp: null, warnings };
  }
  const b = projectSide(opp, proj, key, states, pmap);
  if (b.emptySlots > 0) warnings.push(`opponent has ${b.emptySlots} empty starter slot${b.emptySlots === 1 ? "" : "s"}`);
  if (b.gaps > 0) warnings.push(`${b.gaps} of the opponent's starters yet to play ${b.gaps === 1 ? "has" : "have"} no projection (counted as 0)`);
  const nowMine = round1(a.now);
  const nowOpp = round1(b.now);
  const projMine = round1(a.final);
  const projOpp = round1(b.final);
  const decided = a.left === 0 && b.left === 0;

  // Sleeper's own projected totals win when they look sane. Sleeper's projection is a
  // full-week total, so it can never be below what's already been scored; if it is, it
  // isn't the live number we assumed and we fall back rather than trust it.
  let useMine = projMine;
  let useOpp = projOpp;
  let source: "sleeper" | "fantis" = "fantis";
  if (sp && sp.opp && !decided) {
    const pm = sp.mine.proj_points;
    const po = sp.opp.proj_points;
    const okNum = typeof pm === "number" && typeof po === "number" && Number.isFinite(pm) && Number.isFinite(po) && pm > 0 && po > 0;
    const notStale = okNum && pm >= nowMine - 0.05 && po >= nowOpp - 0.05;
    if (okNum && notStale) {
      useMine = round1(pm);
      useOpp = round1(po);
      source = "sleeper";
    } else {
      warnings.push("Sleeper's projection looked unusable (missing or below points already scored) — using Fantis's estimate");
    }
  }

  let verdict: MatchupVerdict;
  if (decided) verdict = nowMine > nowOpp ? "WON" : nowMine < nowOpp ? "LOST" : "TIED";
  else {
    const margin = useMine - useOpp;
    verdict = Math.abs(margin) < TOSS_UP_PTS ? "TOSS_UP" : margin > 0 ? "WIN" : "LOSS";
  }
  return { ...base, verdict, nowMine, nowOpp, projMine: useMine, projOpp: useOpp, leftMine: a.left, leftOpp: b.left, playedMine: a.played, playedOpp: b.played, source, estMine: projMine, estOpp: projOpp, warnings };
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
