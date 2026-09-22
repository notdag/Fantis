"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getMatchups, getProjections, getRosters, getState, getTransactions } from "@/lib/sleeper";
import { getWeekGameStates, getWeekKickoffs } from "@/lib/espnGames";
import { fetchMatchupLegs } from "@/lib/sleeperWrite";
import { useLeagueFcValues } from "@/lib/useLeagueFcValues";
import { getStoredToken } from "@/lib/sleeperToken";
import type { ProjectionMap } from "@/lib/types";
import { usePlayerMap } from "@/lib/usePlayerMap";
import { useTradeValues } from "@/lib/useTradeValues";
import { useFantasyCalcValues, fantasyCalcValue } from "@/lib/fantasyCalc";
import { EMPTY_PREFS, loadPrefs, type PlayerPrefs } from "@/lib/playerPrefs";
import { useCuratedRanks } from "./useCuratedRanks";
import { createReadOnlyTools, type RawMatchup } from "@/lib/commandCenter/tools";
import type { FaabStats } from "@/lib/faabHistory";
import {
  handleCommand,
  newSession,
  type AuditRecord,
  type Block,
  type MatchupVerdict,
  type PlayoffStatus,
  ordinal,
  type EngineEnv,
  type Progress,
  type Session,
} from "@/lib/commandCenter/engine";
import { canPropose, describeProposal, type Permission, type ProposalDraft } from "@/lib/commandCenter/proposals";
import { STATE_LABEL, STATE_ORDER, type AvailState, type CcLeague, type DropSignals } from "@/lib/commandCenter/types";

const EXAMPLES = [
  "Run my weekly sweep",
  "Find Antonio Williams everywhere",
  "Find my best waiver adds",
  "How many leagues am I winning this week?",
  "Where do I stand for the playoffs?",
  "Fix my lineups",
  "Show me my weakest players",
  "Find leagues where I have an injured player who could go on IR",
  "Show me every league where I have a roster decision to make",
];

interface Turn {
  id: number;
  command: string;
  blocks: Block[];
  audit?: AuditRecord;
  saved?: "saved" | "failed";
  error?: string;
}

interface AuditEntry {
  id: string;
  createdAt: string;
  command: string;
  intent: string;
  leaguesTotal: number;
  leaguesScanned: number;
  leaguesFailed: number;
  actionableLeagues: number | null;
  durationMs: number;
  errors: string[];
}

const stateClass = (s: AvailState) => `ccstate cc-${s.toLowerCase().replace(/_/g, "-")}`;

interface BlockCtx {
  permission: Permission;
  onSave: (drafts: ProposalDraft[]) => Promise<string>;
}

export default function CommandCenterAI({ leagues, permission, onProposalsSaved }: { leagues: CcLeague[]; permission: Permission; onProposalsSaved?: () => void }) {
  const { pmap } = usePlayerMap();
  const tradeValues = useTradeValues();
  const fc = useFantasyCalcValues();
  const curated = useCuratedRanks();
  const leagueFc = useLeagueFcValues();
  const [prefs, setPrefs] = useState<PlayerPrefs>(EMPTY_PREFS);
  const [prefsOk, setPrefsOk] = useState<boolean | null>(null);
  const [leg, setLeg] = useState<number | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const [season, setSeason] = useState<string | null>(null);
  const [projections, setProjections] = useState<ProjectionMap | null>(null);

  useEffect(() => {
    loadPrefs().then((p) => { setPrefs(p); setPrefsOk(true); }).catch(() => setPrefsOk(false));
    getState()
      .then((s) => {
        setLeg(s.leg || s.week || 1);
        const w = Math.max(1, s.week || 1);
        setWeek(w);
        setSeason(s.season);
        // This week's per-player point projections, for the "who am I projected to beat" question.
        getProjections(s.season, w).then(setProjections).catch(() => setProjections(null));
      })
      .catch(() => setLeg(null));
  }, []);

  // One tool layer (and its 5-minute league cache) for the whole page session.
  const tools = useMemo(() => {
    if (!pmap || leg == null) return null;
    return createReadOnlyTools({
      leagues,
      pmap,
      currentLeg: leg,
      week: week ?? undefined,
      // Real past winning FAAB bids for this account's leagues — a DB read via our own
      // API, not Sleeper. Fetched once and reused for the life of this tool layer.
      getFaabStats: async () => {
        try {
          const res = await fetch("/api/manager/faab-suggest");
          if (!res.ok) return null;
          const body = (await res.json()) as { stats?: FaabStats };
          return body.stats ?? null;
        } catch {
          return null;
        }
      },
      getMatchups: (id, w) => getMatchups(id, w) as unknown as Promise<RawMatchup[]>,
      // Sleeper's own projected scores, if the owner connected Sleeper access. Read-only query;
      // the token is read from this browser's storage at call time and goes only to sleeper.com.
      hasSleeperAccess: () => !!getStoredToken(),
      getSleeperLegs: async (id, w) => {
        const token = getStoredToken();
        if (!token) throw new Error("no Sleeper access connected");
        return fetchMatchupLegs(token, { leagueId: id, round: w });
      },
      snapshotDeps: { getRosters: (id) => getRosters(id), getTransactions: (id, l) => getTransactions(id, l) },
    });
  }, [pmap, leg, week, leagues]);

  const signals = useMemo<DropSignals | null>(() => {
    if (!pmap) return null;
    return {
      info: (id) => {
        const e = pmap[id];
        return e ? { id, name: e.n, pos: e.p, team: e.t || "", injury: e.inj ?? null, active: !!e.t } : null;
      },
      fantisValue: (id) => {
        const e = pmap[id];
        const v = e ? tradeValues[e.n]?.value : undefined;
        return v != null ? v : null;
      },
      fcValue: (id) => {
        const e = pmap[id];
        return e && fc ? fantasyCalcValue(fc, { name: e.n, pos: e.p }) || null : null;
      },
      curated: (id) => curated?.get(id) ?? null,
      // FantasyCalc values for THIS league's format, from our database, matched by Sleeper id.
      fcValueFor: leagueFc.ready ? (leagueId, id) => leagueFc.value(leagueId, id) : undefined,
      avoid: new Set(prefs.avoid),
      priority: new Set(prefs.priority),
      priorityOrder: prefs.priority,
    };
  }, [pmap, tradeValues, fc, curated, prefs, leagueFc]);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const session = useRef<Session>(newSession());
  const nextId = useRef(1);
  const [history, setHistory] = useState<AuditEntry[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyErr, setHistoryErr] = useState("");

  const ready = !!tools && !!signals && !!pmap;

  const ask = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || !tools || !signals || !pmap || running) return;
      setInput("");
      setRunning(true);
      setProgress(null);
      const id = nextId.current++;
      const env: EngineEnv = {
        tools,
        signals,
        pmap,
        curatedIds: curated ? [...curated.keys()] : null,
        rank: (pid) => {
          const e = pmap[pid];
          if (!e) return [0, 0];
          return [tradeValues[e.n]?.value ?? 0, fc ? fantasyCalcValue(fc, { name: e.n, pos: e.p }) : 0];
        },
        projections,
        week,
        permission,
        // Kickoff times, so lineup proposals never touch a game that has started.
        kickoffs: season && week ? () => getWeekKickoffs(season, week).catch(() => null) : undefined,
        // Which games are done / in progress / still to come — fetched fresh each time it's needed.
        getGameStates: season && week ? () => getWeekGameStates(season, week).catch(() => null) : undefined,
        onProgress: setProgress,
      };
      try {
        const out = await handleCommand(text, session.current, env);
        session.current = out.session;
        setTurns((t) => [{ id, command: text, blocks: out.blocks, audit: out.audit }, ...t]);
        // Audit trail (server, admin-cookie gated). A failed save is shown, never hidden.
        fetch("/api/manager/command-audit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(out.audit),
        })
          .then((r) => setTurns((t) => t.map((x) => (x.id === id ? { ...x, saved: r.ok ? "saved" : "failed" } : x))))
          .catch(() => setTurns((t) => t.map((x) => (x.id === id ? { ...x, saved: "failed" } : x))));
        setHistory(null);
      } catch (e) {
        setTurns((t) => [{ id, command: text, blocks: [], error: e instanceof Error ? e.message : "Something went wrong." }, ...t]);
      } finally {
        setRunning(false);
        setProgress(null);
      }
    },
    [tools, signals, pmap, running, curated, tradeValues, fc, projections, week, season, permission]
  );

  // Saving drafts is an explicit click (never chat text). It only records proposals; nothing is sent to Sleeper.
  const saveDrafts = async (drafts: ProposalDraft[]): Promise<string> => {
    if (!canPropose(permission)) return "Read-only mode — switch to Propose only to save proposals.";
    try {
      const res = await fetch("/api/manager/proposals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ drafts }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return body.error || "Couldn't save the proposals.";
      onProposalsSaved?.();
      const dup = body.duplicates ? ` ${body.duplicates} were already queued.` : "";
      return `Saved ${body.created?.length ?? 0} proposal${(body.created?.length ?? 0) === 1 ? "" : "s"} for review in the Proposals tab.${dup} Nothing was sent to Sleeper.`;
    } catch {
      return "Couldn't reach the server to save the proposals.";
    }
  };
  const blockCtx: BlockCtx = { permission, onSave: saveDrafts };

  const loadHistory = async () => {
    setHistoryErr("");
    try {
      const res = await fetch("/api/manager/command-audit");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't load history.");
      setHistory(body.entries as AuditEntry[]);
    } catch (e) {
      setHistoryErr(e instanceof Error ? e.message : "Couldn't load history.");
    }
  };

  const eligible = leagues.filter((l) => l.status === "in_season" && !l.bestBall).length;

  return (
    <section className="sec" style={{ paddingTop: 12 }}>
      <div className="card cc">
        <div className="cchead">
          <div>
            <h2 className="cctitle">Command Center AI</h2>
            <p className="hint" style={{ margin: "4px 0 0" }}>
              Ask about your {eligible} in-season leagues in plain English. It scans live from Sleeper and shows its work. Nothing is ever sent to Sleeper from chat, in any mode.
            </p>
          </div>
          <div className="ccmode" title="Current mode is shown in the panel header">
            <strong>READ-ONLY MODE</strong>
            <span>Nothing will be changed</span>
          </div>
        </div>

        <form
          className="field"
          style={{ marginTop: 14 }}
          onSubmit={(e) => {
            e.preventDefault();
            void ask(input);
          }}
        >
          <input
            className="input"
            placeholder={ready ? "Ask Fantis anything… e.g. Find Antonio Williams everywhere" : "Loading players and league data…"}
            value={input}
            disabled={!ready || running}
            onChange={(e) => setInput(e.target.value)}
            aria-label="Ask the Command Center"
          />
          <button className="btn" type="submit" disabled={!ready || running || !input.trim()}>
            {running ? "Working…" : "Ask"}
          </button>
        </form>

        <div className="field" style={{ marginTop: 10, gap: 6 }}>
          {EXAMPLES.map((ex) => (
            <button key={ex} className="ccexample" disabled={!ready || running} onClick={() => void ask(ex)}>
              {ex}
            </button>
          ))}
          {turns.length > 0 && (
            <button
              className="ccexample"
              disabled={running}
              onClick={() => {
                session.current = newSession();
                setTurns([]);
              }}
            >
              Start over
            </button>
          )}
        </div>
        {prefsOk === false && (
          <p className="hint" style={{ color: "var(--amber)" }}>
            Couldn&rsquo;t load your Priority/Avoid lists, so drop suggestions won&rsquo;t protect or prefer those players this session.
          </p>
        )}

        {running && progress && (
          <div className="ccprogress" role="status" aria-live="polite">
            <div className="ccprogresstext">
              <span>{progress.label}…</span>
              <span>
                {progress.done} / {progress.total} leagues{progress.failed ? ` · ${progress.failed} failed` : ""}
              </span>
            </div>
            <div className="ccbar"><div className="ccbarfill" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
            {progress.counts && (
              <div className="cccountsrow">
                {STATE_ORDER.filter((s) => (progress.counts?.[s] ?? 0) > 0).map((s) => (
                  <span key={s} className={stateClass(s)}>{STATE_LABEL[s]} {progress.counts?.[s]}</span>
                ))}
              </div>
            )}
          </div>
        )}
        {running && !progress && <p className="hint">Working…</p>}

        <div className="ccturns">
          {turns.map((t) => (
            <TurnView key={t.id} turn={t} onAsk={(s) => void ask(s)} disabled={running} ctx={blockCtx} />
          ))}
        </div>

        <p className="portmeta" style={{ margin: "14px 0 0" }}>
          Trade values and roster-strength ranks from{" "}
          <a className="link" href="https://fantasycalc.com" target="_blank" rel="noreferrer">FantasyCalc.com</a>.
        </p>
        <div style={{ marginTop: 14 }}>
          <button
            className="linklike"
            style={{ fontSize: 13 }}
            onClick={() => {
              const next = !historyOpen;
              setHistoryOpen(next);
              if (next && !history) void loadHistory();
            }}
          >
            {historyOpen ? "Hide command history" : "Command history (audit log)"}
          </button>
          {historyOpen && (
            <div className="cchistory">
              {historyErr && <div className="err">{historyErr}</div>}
              {!history && !historyErr && <p className="hint">Loading…</p>}
              {history && history.length === 0 && <p className="hint">No commands recorded yet.</p>}
              {history?.map((h) => (
                <div key={h.id} className="cchistoryrow">
                  <div>
                    <strong>{h.command}</strong>
                    <span className="portmeta"> · {h.intent} · {new Date(h.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="portmeta">
                    {h.leaguesScanned}/{h.leaguesTotal} leagues scanned{h.leaguesFailed ? ` · ${h.leaguesFailed} failed` : ""}
                    {h.actionableLeagues != null ? ` · ${h.actionableLeagues} actionable` : ""} · {(h.durationMs / 1000).toFixed(1)}s
                    {h.errors.length ? ` · ${h.errors.length} error${h.errors.length === 1 ? "" : "s"}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- rendering

function TurnView({ turn, onAsk, disabled, ctx }: { turn: Turn; onAsk: (s: string) => void; disabled: boolean; ctx: BlockCtx }) {
  return (
    <div className="ccturn">
      <div className="ccuser">{turn.command}</div>
      {turn.error && <div className="err">{turn.error}</div>}
      {turn.blocks.map((b, i) => (
        <BlockView key={i} block={b} onAsk={onAsk} disabled={disabled} ctx={ctx} />
      ))}
      {turn.audit && (
        <p className="portmeta" style={{ margin: "8px 0 0", fontSize: 12 }}>
          {turn.audit.toolCalls} read-only lookups · {(turn.audit.durationMs / 1000).toFixed(1)}s ·{" "}
          {turn.saved === "saved" ? "recorded in the audit log" : turn.saved === "failed" ? "audit log save FAILED" : "saving to the audit log…"}
        </p>
      )}
    </div>
  );
}

function BlockView({ block, onAsk, disabled, ctx }: { block: Block; onAsk: (s: string) => void; disabled: boolean; ctx: BlockCtx }) {
  switch (block.t) {
    case "text":
      return <p className={`cctext cctone-${block.tone ?? "info"}`}>{block.text}</p>;
    case "clarify":
      return (
        <div className="ccclarify">
          <p className="cctext cctone-warn">{block.question}</p>
          {block.options.map((o) => (
            <button key={o.n} className="ccoption" disabled={disabled} onClick={() => onAsk(String(o.n))}>
              <strong>{o.n}.</strong> {o.label}
            </button>
          ))}
        </div>
      );
    case "scanStatus": {
      const m = block.meta;
      return (
        <div className="ccscan">
          <p className="cctext">
            <strong>
              Scanned {m.ok + m.partial}/{m.inScope} leagues{m.failed === 0 && m.partial === 0 ? " successfully" : ""}
            </strong>
            {" · "}
            {m.ok} success · {m.partial} partial · {m.failed} failed · {(m.durationMs / 1000).toFixed(1)}s
            {m.excludedBestBall + m.excludedNotInSeason > 0 && (
              <span className="portmeta">
                {" "}
                · skipped {m.excludedBestBall} best-ball, {m.excludedNotInSeason} not in season
              </span>
            )}
          </p>
          {m.failedLeagues.length > 0 && (
            <details className="ccdetails">
              <summary style={{ color: "var(--red)" }}>{m.failedLeagues.length} league{m.failedLeagues.length === 1 ? "" : "s"} could not be scanned — treated as UNKNOWN, never as &ldquo;not available&rdquo;</summary>
              {m.failedLeagues.map((f) => <div key={f.id} className="portmeta">{f.name} — {f.error}</div>)}
            </details>
          )}
          {m.partialLeagues.length > 0 && (
            <details className="ccdetails">
              <summary style={{ color: "var(--amber)" }}>{m.partialLeagues.length} partial — transactions couldn&rsquo;t be read, so free agent vs waiver is unconfirmed</summary>
              {m.partialLeagues.map((f) => <div key={f.id} className="portmeta">{f.name} — {f.error}</div>)}
            </details>
          )}
        </div>
      );
    }
    case "counts":
      return (
        <div className="cccounts">
          <span className="portmeta" style={{ marginRight: 4 }}>{block.playerName}</span>
          {STATE_ORDER.map((s) => (
            <span key={s} className={`${stateClass(s)} ${block.counts[s] === 0 ? "cczero" : ""}`}>{STATE_LABEL[s]} {block.counts[s]}</span>
          ))}
        </div>
      );
    case "leagues":
      return <LeagueRows block={block} />;
    case "tally":
      return (
        <div className="cctally">
          <p className="cctext"><strong>{block.title}</strong></p>
          {block.rows.map((r) => (
            <div key={r.name + r.pos} className="cctallyrow">
              <span className="tname">{r.name}</span>
              <span className="portmeta">{r.pos}</span>
              <span style={{ flex: 1 }} />
              <span className="portmeta">suggested drop in {r.count} of {block.total} leagues</span>
              <button className="ccexample" disabled={disabled} onClick={() => onAsk(`Show me every league where ${r.name} is one of the bottom 3`)}>Show leagues</button>
            </div>
          ))}
        </div>
      );
    case "suggest":
      return (
        <div className="cctally">
          <p className="cctext"><strong>{block.title}</strong></p>
          {block.rows.map((r) => (
            <div key={r.name + r.pos} className="cctallyrow">
              <span className="tname">{r.name}</span>
              <span className="portmeta">{r.pos}</span>
              <span style={{ flex: 1 }} />
              <span className="portmeta">
                {r.free} free agent · {r.waiver} waiver · {r.needDrop} need a drop
              </span>
              <button className="ccexample" disabled={disabled} onClick={() => onAsk(`Find ${r.name} everywhere`)}>Scan</button>
            </div>
          ))}
        </div>
      );
    case "decisions":
      return (
        <div className="cctally">
          <p className="cctext"><strong>{block.title} ({block.rows.length})</strong></p>
          {block.rows.map((r) => (
            <div key={r.leagueId} className="ccdecision">
              <strong>{r.leagueName}</strong>
              <ul>
                {r.items.map((it, i) => <li key={i}>{it}</li>)}
              </ul>
            </div>
          ))}
          {block.truncated > 0 && <p className="hint">+{block.truncated} more not shown.</p>}
        </div>
      );
    case "preview":
      return <PreviewView block={block} />;
    case "drafts":
      return <DraftsView block={block} ctx={ctx} />;
    case "standings":
      return <StandingsRows block={block} onAsk={onAsk} disabled={disabled} />;
    case "matchups":
      return <MatchupRows block={block} onAsk={onAsk} disabled={disabled} />;
  }
}

function LeagueRows({ block }: { block: Extract<Block, { t: "leagues" }> }) {
  const [all, setAll] = useState(false);
  const rows = all ? block.rows : block.rows.slice(0, 15);
  const multi = new Set(block.rows.map((r) => r.playerName)).size > 1;
  return (
    <div className="cctally">
      <p className="cctext"><strong>{block.title}</strong></p>
      {block.rows.length === 0 && <p className="hint">No leagues match.</p>}
      {rows.map((r, i) => (
        <div key={`${r.leagueId}:${r.playerName}:${i}`} className="ccleague">
          <div className="ccrow">
            <span className={`${stateClass(r.state)} ccstatecol`}>{STATE_LABEL[r.state]}</span>
            <span className="ccname">
              {r.leagueName}
              {multi && r.playerName && <span className="portmeta"> · {r.playerName}</span>}
            </span>
            {(r.state === "AVAILABLE" || r.state === "WAIVER") ? (
              <span className={`ccneed ${r.needsDrop === true ? "ccneed-drop" : r.needsDrop === false ? "ccneed-open" : "ccneed-unk"}`}>
                {r.needsDrop === true ? "Drop required" : r.needsDrop === false ? "No drop needed" : "Drop unknown"}
              </span>
            ) : (
              <span />
            )}
          </div>
          {r.detail && <div className="portmeta ccindent">{r.detail}</div>}
          {r.drops && r.drops.candidates.length > 0 && (
            <details className="ccdetails ccindent">
              <summary>
                Suggested drop candidates: {r.drops.candidates.map((c) => c.name).join(" · ")}
              </summary>
              {r.drops.candidates.map((c, k) => (
                <div key={c.playerId} className="ccdrop">
                  <strong>{k + 1}. {c.name}</strong> <span className="portmeta">{c.pos}</span>
                  <ul>
                    {c.reasons.map((x, j) => <li key={j}>{x}</li>)}
                  </ul>
                </div>
              ))}
              <p className="portmeta">
                Lowest-ranked according to the current model — your call. Protected from suggestions: {r.drops.protectedCount} (starters, IR/taxi, Priority list, required positions).
                {r.drops.unrankedTie ? " These candidates have no Fantis/FantasyCalc value, so their order among themselves is arbitrary." : ""}
                {r.drops.note ? ` ${r.drops.note}` : ""}
              </p>
            </details>
          )}
          {r.drops && r.drops.candidates.length === 0 && r.drops.note && <div className="portmeta ccindent" style={{ color: "var(--amber)" }}>{r.drops.note}</div>}
        </div>
      ))}
      {block.rows.length > 15 && (
        <button className="ccexample" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${block.rows.length}`}
        </button>
      )}
      {block.truncated > 0 && <p className="hint">+{block.truncated} more not shown.</p>}
    </div>
  );
}

function PreviewView({ block }: { block: Extract<Block, { t: "preview" }> }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Set<string>>(() => new Set(block.items.map((i) => i.leagueId)));
  const toggle = (id: string) =>
    setSel((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <div className="ccpreview">
      <div className="ccbanner">{block.banner}</div>
      <div className="field" style={{ alignItems: "center", marginTop: 8 }}>
        <strong>Proposed changes</strong>
        <span className="portmeta">{block.items.length} league{block.items.length === 1 ? "" : "s"}</span>
        <span style={{ flex: 1 }} />
        <button className="ccexample" onClick={() => setOpen((v) => !v)}>{open ? "Hide" : `Review ${block.items.length} leagues`}</button>
      </div>
      {open && (
        <>
          <div className="field" style={{ margin: "8px 0", alignItems: "center" }}>
            <button className="ccexample" onClick={() => setSel(new Set(block.items.map((i) => i.leagueId)))}>Select all</button>
            <button className="ccexample" onClick={() => setSel(new Set())}>Deselect all</button>
            <span className="portmeta">{sel.size} selected</span>
            <span style={{ flex: 1 }} />
            <button className="btn sm" disabled title="Execution is disabled in Phase 1 — this build is read-only.">
              Execute — disabled (read-only)
            </button>
          </div>
          {block.items.map((it) => (
            <label key={it.leagueId} className="ccpreviewitem">
              <input type="checkbox" checked={sel.has(it.leagueId)} onChange={() => toggle(it.leagueId)} />
              <div>
                <strong>{it.leagueName}</strong>
                {it.actions.map((a, i) => (
                  <div key={i} className="portmeta">
                    <strong style={{ color: a.op === "DROP" ? "var(--red)" : a.op === "ADD" ? "var(--mint)" : "var(--amber)" }}>{a.op}</strong>: {a.playerName}
                  </div>
                ))}
                {it.suggestedDrops && it.suggestedDrops.length > 0 && (
                  <div className="portmeta">DROP (suggested, pick one): {it.suggestedDrops.map((d) => `${d.name} (${d.pos})`).join(" · ")}</div>
                )}
                {it.noDropRequired && <div className="portmeta">NO DROP REQUIRED</div>}
              </div>
            </label>
          ))}
          {block.truncated > 0 && <p className="hint">+{block.truncated} more not shown.</p>}
        </>
      )}
      <p className="portmeta" style={{ margin: "8px 0 0" }}>{block.banner}. Future flow: scan → analyze → propose → review → confirm → execute → verify.</p>
    </div>
  );
}

const VERDICT_LABEL: Record<MatchupVerdict, string> = {
  WON: "Won",
  LOST: "Lost",
  TIED: "Tied",
  WIN: "Projected win",
  TOSS_UP: "Too close",
  LOSS: "Projected loss",
  NO_OPPONENT: "No opponent",
  UNKNOWN: "Couldn't read",
};
const VERDICT_ASK: Partial<Record<MatchupVerdict, string>> = {
  WON: "Which leagues have I already won",
  LOST: "Which leagues have I already lost",
  WIN: "Show me the leagues I'm projected to win",
  LOSS: "Show me the leagues I'm projected to lose",
  TOSS_UP: "Show me the close ones",
};

const fmt = (n: number | null) => (n == null ? "—" : n.toFixed(1));
const signed = (n: number) => (n > 0 ? "+" : "") + n.toFixed(1);
const marginColor = (n: number) => (n > 0 ? "var(--mint)" : n < 0 ? "var(--red)" : "var(--dim)");

function MatchupRows({ block, onAsk, disabled }: { block: Extract<Block, { t: "matchups" }>; onAsk: (s: string) => void; disabled: boolean }) {
  const [all, setAll] = useState(false);
  const rows = all ? block.rows : block.rows.slice(0, 15);
  const c = block.counts;
  const lv = block.live;
  return (
    <div className="cctally">
      <div className="cccounts">
        {(["WON", "LOST", "TIED", "WIN", "TOSS_UP", "LOSS", "NO_OPPONENT", "UNKNOWN"] as MatchupVerdict[]).map((v) => (
          <button
            key={v}
            className={`ccstate ccv-${v.toLowerCase().replace(/_/g, "-")} ${c[v] === 0 ? "cczero" : ""}`}
            disabled={disabled || c[v] === 0 || !VERDICT_ASK[v]}
            onClick={() => VERDICT_ASK[v] && onAsk(VERDICT_ASK[v] as string)}
            style={{ border: 0, cursor: VERDICT_ASK[v] && c[v] ? "pointer" : "default" }}
          >
            {VERDICT_LABEL[v]} {c[v]}
          </button>
        ))}
      </div>
      <div className="cccounts">
        <button className="ccexample" disabled={disabled || lv.leading === 0} onClick={() => onAsk("Which leagues am I leading right now")}>Leading now {lv.leading}</button>
        <button className="ccexample" disabled={disabled || lv.trailing === 0} onClick={() => onAsk("Which leagues am I trailing right now")}>Trailing now {lv.trailing}</button>
        <span className="portmeta">Starters still to finish — you {lv.leftMine} · opponents {lv.leftOpp}</span>
      </div>
      <p className="cctext" style={{ marginTop: 10 }}><strong>{block.title}</strong></p>
      {block.rows.length === 0 && <p className="hint">No leagues match.</p>}
      {rows.map((r) => {
        const nowMargin = r.nowMine != null && r.nowOpp != null ? Math.round((r.nowMine - r.nowOpp) * 10) / 10 : null;
        const projMargin = r.projMine != null && r.projOpp != null ? Math.round((r.projMine - r.projOpp) * 10) / 10 : null;
        const decided = r.verdict === "WON" || r.verdict === "LOST" || r.verdict === "TIED";
        return (
          <div key={r.leagueId} className="ccleague">
            <div className="ccrow">
              <span className={`ccstate ccstatecol ccv-${r.verdict.toLowerCase().replace(/_/g, "-")}`}>{VERDICT_LABEL[r.verdict]}</span>
              <span className="ccname">{r.leagueName}</span>
              <span className="ccscore" style={{ color: marginColor((decided ? nowMargin : projMargin) ?? 0) }}>
                {(decided ? nowMargin : projMargin) != null ? signed((decided ? nowMargin : projMargin) as number) : "—"}
              </span>
            </div>
            {r.verdict !== "UNKNOWN" && (
              <>
                <div className="portmeta ccindent">
                  Now <strong className="ccnum">{fmt(r.nowMine)}</strong> – <strong className="ccnum">{fmt(r.nowOpp)}</strong>
                  {nowMargin != null && <span style={{ color: marginColor(nowMargin) }}> ({signed(nowMargin)})</span>}
                </div>
                {!decided && r.verdict !== "NO_OPPONENT" && (
                  <div className="portmeta ccindent">
                    {r.source === "sleeper" ? "Sleeper projects" : "Fantis estimate"} <strong className="ccnum">{fmt(r.projMine)}</strong> – <strong className="ccnum">{fmt(r.projOpp)}</strong>
                    {projMargin != null && <span style={{ color: marginColor(projMargin) }}> ({signed(projMargin)})</span>}
                  </div>
                )}
                {!decided && r.source === "sleeper" && r.estMine != null && r.estOpp != null && Math.sign(r.estMine - r.estOpp) !== Math.sign((r.projMine ?? 0) - (r.projOpp ?? 0)) && Math.abs(r.estMine - r.estOpp) >= 3 && (
                  <div className="portmeta ccindent" style={{ color: "var(--amber)" }}>
                    Fantis&rsquo;s own estimate disagrees: {fmt(r.estMine)} – {fmt(r.estOpp)}
                  </div>
                )}
                <div className="portmeta ccindent">
                  Starters — you: {r.playedMine} played · {r.leftMine} left{r.verdict !== "NO_OPPONENT" ? ` | opp: ${r.playedOpp} played · ${r.leftOpp} left` : ""}
                </div>
              </>
            )}
            {r.warnings.map((w, i) => <div key={i} className="portmeta ccindent" style={{ color: "var(--amber)" }}>{w}</div>)}
          </div>
        );
      })}
      {block.rows.length > 15 && (
        <button className="ccexample" onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `Show all ${block.rows.length}`}</button>
      )}
      {block.truncated > 0 && <p className="hint">+{block.truncated} more not shown.</p>}
    </div>
  );
}

function DraftsView({ block, ctx }: { block: Extract<Block, { t: "drafts" }>; ctx: BlockCtx }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState("");
  const can = canPropose(ctx.permission);
  const shown = open ? block.drafts : block.drafts.slice(0, 4);
  return (
    <div className="ccpreview">
      <div className="ccbanner">PROPOSALS — NOTHING HAS BEEN SAVED OR SENT</div>
      <p className="cctext" style={{ margin: "6px 0" }}>{block.note}</p>
      {shown.map((d, i) => (
        <div key={i} className="portmeta" style={{ margin: "3px 0" }}>
          <strong style={{ color: "var(--bone)" }}>{d.leagueName}</strong> — {describeProposal(d)}
        </div>
      ))}
      {block.drafts.length > 4 && (
        <button className="ccexample" onClick={() => setOpen((v) => !v)}>{open ? "Show fewer" : `Show all ${block.drafts.length}`}</button>
      )}
      <div className="field" style={{ marginTop: 8, alignItems: "center" }}>
        <button
          className="btn sm"
          disabled={!can || saving || !!result.startsWith("Saved")}
          title={can ? "Saves these for review only — nothing is sent to Sleeper" : "Switch to Propose only to save proposals"}
          onClick={async () => {
            setSaving(true);
            setResult(await ctx.onSave(block.drafts));
            setSaving(false);
          }}
        >
          {saving ? "Saving…" : `Save ${block.drafts.length} as proposals`}
        </button>
        {result && <span className="portmeta">{result}</span>}
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<PlayoffStatus, string> = { IN: "In a playoff spot", BUBBLE: "On the bubble", OUT: "Outside the line", UNKNOWN: "Unknown" };
const STATUS_ASK: Partial<Record<PlayoffStatus, string>> = { IN: "Only the leagues I'm in", BUBBLE: "Only the bubble leagues", OUT: "Only the leagues I'm out of" };

function StandingsRows({ block, onAsk, disabled }: { block: Extract<Block, { t: "standings" }>; onAsk: (s: string) => void; disabled: boolean }) {
  const [all, setAll] = useState(false);
  const rows = all ? block.rows : block.rows.slice(0, 15);
  const c = block.counts;
  return (
    <div className="cctally">
      <div className="cccounts">
        {(["IN", "BUBBLE", "OUT", "UNKNOWN"] as PlayoffStatus[]).map((k) => (
          <button
            key={k}
            className={`ccstate ccs-${k.toLowerCase()} ${c[k] === 0 ? "cczero" : ""}`}
            disabled={disabled || c[k] === 0 || !STATUS_ASK[k]}
            onClick={() => STATUS_ASK[k] && onAsk(STATUS_ASK[k] as string)}
            style={{ border: 0, cursor: STATUS_ASK[k] && c[k] ? "pointer" : "default" }}
          >
            {STATUS_LABEL[k]} {c[k]}
          </button>
        ))}
      </div>
      <p className="cctext" style={{ marginTop: 10 }}><strong>{block.title}</strong></p>
      {block.rows.length === 0 && <p className="hint">No leagues match.</p>}
      {rows.map((r) => (
        <div key={r.leagueId} className="ccleague">
          <div className="ccrow">
            <span className={`ccstate ccstatecol ccs-${r.status.toLowerCase()}`}>{STATUS_LABEL[r.status]}</span>
            <span className="ccname">{r.leagueName}</span>
            <span className="ccscore">{r.rank != null ? `${ordinal(r.rank)} of ${r.of}` : "—"}</span>
          </div>
          <div className="portmeta ccindent">
            Record <strong className="ccnum">{r.record}</strong>
            {r.playoffTeams != null && <> · top {r.playoffTeams} make the playoffs</>}
            {r.gamesFromLine != null && (
              <span style={{ color: r.gamesFromLine >= 0 ? "var(--mint)" : "var(--red)" }}> · {r.gamesFromLine >= 0 ? "+" : ""}{r.gamesFromLine.toFixed(1)} games {r.gamesFromLine >= 0 ? "ahead of the line" : "behind the line"}</span>
            )}
          </div>
          {r.fcRank != null && (
            <div className="portmeta ccindent">
              FantasyCalc roster value: <strong className="ccnum">{ordinal(r.fcRank)}</strong> of {r.of}
              {r.status === "OUT" && r.fcRank <= 3 && <span style={{ color: "var(--amber)" }}> — strong roster, behind on record</span>}
              {r.status === "IN" && r.fcRank > r.of / 2 && <span style={{ color: "var(--amber)" }}> — in on record, but a weaker roster</span>}
            </div>
          )}
          {r.warnings.map((w, i) => <div key={i} className="portmeta ccindent" style={{ color: "var(--amber)" }}>{w}</div>)}
        </div>
      ))}
      {block.rows.length > 15 && <button className="ccexample" onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `Show all ${block.rows.length}`}</button>}
      {block.truncated > 0 && <p className="hint">+{block.truncated} more not shown.</p>}
    </div>
  );
}
