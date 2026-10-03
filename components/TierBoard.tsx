"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TIER_COLOR, TIER_LABELS, computePosRanks, posChipStyle } from "@/lib/players";
import { usePlayerMap } from "@/lib/usePlayerMap";
import {
  buildSleeperIndex,
  findTeamDrift,
  findUnranked,
  injurySeverity,
  isInjured,
} from "@/lib/rankingsHelpers";
import type { Player } from "@/lib/types";

const TIER_COUNT = TIER_LABELS.length; // 8: S, A, B, C, D, E, F, G
const TIERS = Array.from({ length: TIER_COUNT }, (_, i) => i + 1);
const ADD_POSITIONS = ["QB", "RB", "WR", "TE"];
const UNDO_LIMIT = 50;
const PANEL_PAGE = 25;

type Board = Player[][]; // index 0..(TIER_COUNT-1) = tier 1..TIER_COUNT

function groupByTier(players: Player[]): Board {
  const board: Board = Array.from({ length: TIER_COUNT }, () => []);
  for (const p of players) {
    const idx = Math.min(Math.max(p.tier - 1, 0), TIER_COUNT - 1);
    board[idx].push(p);
  }
  return board;
}

function movePlayer(board: Board, from: { tier: number; idx: number }, to: { tier: number; idx: number }): Board {
  const next = board.map((col) => [...col]);
  const [item] = next[from.tier].splice(from.idx, 1);
  let toIdx = to.idx;
  if (from.tier === to.tier && from.idx < toIdx) toIdx -= 1;
  toIdx = Math.min(Math.max(toIdx, 0), next[to.tier].length);
  next[to.tier].splice(toIdx, 0, item);
  return next;
}

// Nearest same-position card in a direction, skipping over other positions —
// what "up/down" should mean once you've filtered the board to one position.
function findAdjacentSamePos(col: Player[], idx: number, pos: string, dir: 1 | -1): number | null {
  let i = idx + dir;
  while (i >= 0 && i < col.length) {
    if (col[i].pos === pos) return i;
    i += dir;
  }
  return null;
}

// Where a card should land when moved into a tier while filtered to one
// position: right after that position's last card there, not the absolute
// end (which could be past unrelated positions).
function appendIndexForPos(col: Player[], pos: string): number {
  let last = -1;
  col.forEach((p, i) => {
    if (p.pos === pos) last = i;
  });
  return last === -1 ? col.length : last + 1;
}

// Same idea, but for dropping onto a tier band header — lands before that
// position's first card in the tier (or the end, if there isn't one yet).
function prependIndexForPos(col: Player[], pos: string): number {
  const idx = col.findIndex((p) => p.pos === pos);
  return idx === -1 ? col.length : idx;
}

// Cheap identity of a board's saved content — what "unsaved changes" means.
const boardSig = (b: Board) =>
  b.map((col, ti) => col.map((p) => `${ti}|${p.name}|${p.pos}|${p.team}`).join(";")).join("#");

function injColor(inj: string): string {
  if (inj === "Doubtful" || inj === "Questionable") return "var(--amber)";
  return "var(--red)";
}

function InjBadge({ inj }: { inj: string | null | undefined }) {
  if (!inj || !isInjured(inj)) return null;
  return (
    <span
      title={`Sleeper injury status: ${inj}`}
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.3,
        color: injColor(inj),
        border: `1px solid ${injColor(inj)}`,
        borderRadius: 4,
        padding: "0 4px",
        lineHeight: "15px",
        flex: "none",
      }}
    >
      {inj === "Questionable" ? "Q" : inj === "Doubtful" ? "D" : inj}
    </span>
  );
}

export default function TierBoard({
  initialPlayers,
  exposure,
  exposureLeagues,
}: {
  initialPlayers: Player[];
  // Sleeper player_id → how many of the owner's in-season, non-best-ball
  // leagues roster him (computed server-side from the synced Roster table).
  exposure: Record<string, number>;
  exposureLeagues: number;
}) {
  const [board, setBoard] = useState<Board>(() => groupByTier(initialPlayers));
  const [savedBoard, setSavedBoard] = useState<Board>(board);
  const [history, setHistory] = useState<Board[]>([]);
  const dragRef = useRef<{ tier: number; idx: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const [newName, setNewName] = useState("");
  const [newPos, setNewPos] = useState("WR");
  const [newTeam, setNewTeam] = useState("");
  const [newTier, setNewTier] = useState(TIER_COUNT);
  const [addError, setAddError] = useState("");

  // "ALL" shows every position mixed per tier (how Rankings displays them);
  // picking a position scopes ranking (drag, up/down, tier-move) to just
  // that position, so you're never fighting through unrelated positions to
  // reorder e.g. WRs against each other.
  const [posFilter, setPosFilter] = useState("ALL");
  const setFilter = (p: string) => {
    setPosFilter(p);
    if (p !== "ALL") setNewPos(p);
  };
  const [query, setQuery] = useState("");
  const [injuredOnly, setInjuredOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTier, setBulkTier] = useState(TIER_COUNT);

  // Every edit goes through commit() so Undo can step back through it. Edits
  // are computed from the current board (not a functional updater) because
  // the history push is a side effect, and updater functions must stay pure
  // (React runs them twice in dev).
  const commit = (fn: (b: Board) => Board) => {
    const next = fn(board);
    if (next === board) return;
    setHistory((h) => [...h.slice(-(UNDO_LIMIT - 1)), board]);
    setBoard(next);
  };
  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setBoard(prev);
    setSaveMsg(null);
  };

  const dirty = useMemo(() => boardSig(board) !== boardSig(savedBoard), [board, savedBoard]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Sleeper's player dump (cached for the day in localStorage, same as every
  // other page) — gives each ranked player a live injury status and drives
  // the "Needs ranking" panel and team-drift check.
  const { pmap, loading: pmapLoading, error: pmapError, retry: pmapRetry } = usePlayerMap();
  const index = useMemo(() => (pmap ? buildSleeperIndex(pmap) : null), [pmap]);
  const flat = useMemo(() => board.flat(), [board]);

  const infoByName = useMemo(() => {
    const m: Record<string, { inj: string | null; leagues: number }> = {};
    if (!index) return m;
    for (const p of flat) {
      const hit = index.lookup(p);
      if (hit) m[p.name] = { inj: hit.e.inj ?? null, leagues: exposure[hit.id] ?? 0 };
    }
    return m;
  }, [index, flat, exposure]);

  const injuredRankedCount = useMemo(
    () => flat.filter((p) => isInjured(infoByName[p.name]?.inj)).length,
    [flat, infoByName]
  );

  const unranked = useMemo(() => (pmap ? findUnranked(pmap, flat, exposure) : []), [pmap, flat, exposure]);
  const drift = useMemo(() => (index ? findTeamDrift(index, flat) : []), [index, flat]);

  // posRank derived live from board order, same rule the save route uses —
  // this is what the owner sees while dragging, so it matches what gets saved.
  const rankByName = useMemo(() => {
    const ranks = computePosRanks(flat);
    const map: Record<string, number> = {};
    flat.forEach((p, i) => (map[p.name] = ranks[i]));
    return map;
  }, [flat]);

  const moveWithinTier = (tier: number, idx: number, dir: -1 | 1) => {
    commit((b) => {
      const col = b[tier];
      const p = col[idx];
      const target = posFilter === "ALL" ? idx + dir : findAdjacentSamePos(col, idx, p.pos, dir);
      if (target == null || target < 0 || target >= col.length) return b;
      const next = b.map((c) => [...c]);
      const arr = next[tier];
      [arr[idx], arr[target]] = [arr[target], arr[idx]];
      return next;
    });
  };

  const moveToTier = (tier: number, idx: number, dir: -1 | 1) => {
    const targetTier = tier + dir;
    if (targetTier < 0 || targetTier > TIER_COUNT - 1) return;
    commit((b) => {
      const p = b[tier][idx];
      const insertIdx =
        posFilter === "ALL" ? b[targetTier].length : appendIndexForPos(b[targetTier], p.pos);
      return movePlayer(b, { tier, idx }, { tier: targetTier, idx: insertIdx });
    });
  };

  const reset = () => {
    commit(() => savedBoard);
    setSelected(new Set());
    setSaveMsg(null);
  };

  const addPlayer = () => {
    const name = newName.trim();
    const team = newTeam.trim().toUpperCase();
    if (!name) {
      setAddError("Enter a name.");
      return;
    }
    if (!team) {
      setAddError("Enter a team.");
      return;
    }
    const exists = board.some((col) =>
      col.some((p) => p.name.toLowerCase() === name.toLowerCase())
    );
    if (exists) {
      setAddError(`${name} is already on the board.`);
      return;
    }
    setAddError("");
    // posRank is a placeholder here — rankByName (derived from board order)
    // is what's actually displayed and saved, this field is never read.
    const player: Player = { name, pos: newPos, team, tier: newTier, posRank: 0 };
    commit((b) => {
      const next = b.map((c) => [...c]);
      next[newTier - 1] = [...next[newTier - 1], player];
      return next;
    });
    setNewName("");
    setNewTeam("");
  };

  const removePlayer = (tier: number, idx: number) => {
    commit((b) => {
      const next = b.map((c) => [...c]);
      next[tier].splice(idx, 1);
      return next;
    });
  };

  // ── "Needs ranking" panel ──
  const [panelView, setPanelView] = useState<"injured" | "all">("injured");
  const [panelTier, setPanelTier] = useState(TIER_COUNT);
  const [panelLimit, setPanelLimit] = useState(PANEL_PAGE);
  const panelRows = useMemo(
    () =>
      unranked
        .filter((u) => (panelView === "injured" ? isInjured(u.inj) : true))
        .filter((u) => posFilter === "ALL" || u.pos === posFilter)
        // Most-hurt first, then most-rostered (findUnranked's own order is
        // preserved within a severity band by the stable sort).
        .sort((a, b) => (panelView === "injured" ? injurySeverity(a.inj) - injurySeverity(b.inj) : 0)),
    [unranked, panelView, posFilter]
  );
  const injuredUnrankedCount = useMemo(() => unranked.filter((u) => isInjured(u.inj)).length, [unranked]);

  const addCandidates = (rows: typeof panelRows) => {
    if (rows.length === 0) return;
    commit((b) => {
      const next = b.map((c) => [...c]);
      for (const u of rows) {
        next[panelTier - 1].push({ name: u.name, pos: u.pos, team: u.team, tier: panelTier, posRank: 0 });
      }
      return next;
    });
    setSaveMsg(null);
  };

  const syncTeams = () => {
    const moves = new Map(drift.filter((d) => d.to).map((d) => [d.name, d.to]));
    if (moves.size === 0) return;
    commit((b) => b.map((col) => col.map((p) => (moves.has(p.name) ? { ...p, team: moves.get(p.name)! } : p))));
  };
  const releasedDrift = drift.filter((d) => !d.to);

  // ── Multi-select bulk actions ──
  const toggleSelected = (name: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });

  const moveSelectedToTier = () => {
    const tier = bulkTier - 1;
    commit((b) => {
      const picked: Player[] = [];
      const next = b.map((col) =>
        col.filter((p) => {
          if (!selected.has(p.name)) return true;
          picked.push(p);
          return false;
        })
      );
      next[tier] = [...next[tier], ...picked];
      return next;
    });
    setSelected(new Set());
  };

  const removeSelected = () => {
    commit((b) => b.map((col) => col.filter((p) => !selected.has(p.name))));
    setSelected(new Set());
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const players = board.flatMap((col, ti) =>
        col.map((p) => ({ name: p.name, pos: p.pos, team: p.team, tier: ti + 1 }))
      );
      const res = await fetch("/api/admin/save-tiers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ players }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveMsg({ text: body.error || "Save failed.", error: true });
        return;
      }
      setSavedBoard(board);
      setSaveMsg({ text: "Saved — live everywhere on the next page load." });
    } catch {
      setSaveMsg({ text: "Couldn't reach the server.", error: true });
    } finally {
      setSaving(false);
    }
  };

  // Ctrl/Cmd+S saves, Ctrl/Cmd+Z undoes (but never inside a text box, where
  // Ctrl+Z should keep meaning "undo my typing").
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        void save();
      } else if (k === "z" && !e.shiftKey) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const logout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.reload();
  };

  const q = query.trim().toLowerCase();
  const isShown = (p: Player) =>
    (posFilter === "ALL" || p.pos === posFilter) &&
    (!q || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q)) &&
    (!injuredOnly || isInjured(infoByName[p.name]?.inj));
  const shownNames = useMemo(
    () => flat.filter(isShown).map((p) => p.name),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flat, posFilter, q, injuredOnly, infoByName]
  );

  return (
    <section className="sec">
      <div className="sechead">
        <h2>Tier board</h2>
        <span className="rt">owner only</span>
      </div>
      <p className="hint" style={{ marginBottom: 10 }}>
        Drag a player up or down to reorder them, or past a tier band to
        re-tier them — position rank (QB1, RB4, …) updates live from where a
        player lands. Nothing is saved until you click Save (or press Ctrl+S);
        Ctrl+Z steps back. Rankings displays every position mixed together;
        filter to one position below to rank within just that position instead
        of the aggregate pile.
      </p>

      {/* Sticky so Save / Undo stay reachable however far down the board you are. */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          background: "var(--ink)",
          padding: "8px 0",
          borderBottom: "1px solid var(--line-soft)",
          marginBottom: 12,
        }}
      >
        <div className="field" style={{ marginBottom: 0, alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <button className="btn" onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
          <button className="btn ghost sm" onClick={undo} disabled={saving || history.length === 0} title="Ctrl+Z">
            Undo{history.length ? ` (${history.length})` : ""}
          </button>
          <button className="btn ghost sm" onClick={reset} disabled={saving || !dirty}>
            Discard changes
          </button>
          {dirty && (
            <span className="hint" style={{ color: "var(--amber)", margin: 0 }}>
              ● Unsaved changes
            </span>
          )}
          {saveMsg && (
            <span className="hint" style={{ color: saveMsg.error ? "var(--red)" : "var(--mint)", margin: 0 }}>
              {saveMsg.text}
            </span>
          )}
          <button className="btn ghost sm" onClick={logout} style={{ marginLeft: "auto" }}>
            Log out
          </button>
        </div>

        {selected.size > 0 && (
          <div className="field" style={{ marginTop: 8, marginBottom: 0, alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <b style={{ fontSize: 13 }}>{selected.size} selected</b>
            <select className="select" value={bulkTier} onChange={(e) => setBulkTier(Number(e.target.value))}>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  Tier {TIER_LABELS[t - 1]}
                </option>
              ))}
            </select>
            <button className="btn sm" onClick={moveSelectedToTier}>
              Move to tier
            </button>
            <button className="btn ghost sm" onClick={removeSelected}>
              Remove
            </button>
            <button className="btn ghost sm" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        )}
      </div>

      {/* ── Needs ranking: unranked players on the owner's rosters ── */}
      <div
        style={{
          border: "1px solid var(--line)",
          borderRadius: 10,
          padding: "12px 14px",
          marginBottom: 14,
          background: "var(--panel)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
          <b style={{ fontSize: 14 }}>Needs ranking</b>
          <span className="hint" style={{ margin: 0 }}>
            {pmapLoading
              ? "Loading Sleeper player data…"
              : pmapError
                ? "Couldn't load Sleeper player data."
                : `${injuredUnrankedCount} injured · ${unranked.length} unranked in total, all on your rosters`}
          </span>
          {pmapError && (
            <button className="linklike" style={{ fontSize: 12.5 }} onClick={pmapRetry}>
              Retry
            </button>
          )}
        </div>
        <p className="hint" style={{ marginBottom: 8 }}>
          Players rostered in at least one of your {exposureLeagues} in-season leagues who
          aren&apos;t on this board — sorted most-hurt first, then by how many of your leagues
          hold them. Adding places them on the board (unsaved until you Save).
        </p>

        {exposureLeagues === 0 ? (
          <p className="hint" style={{ margin: 0 }}>
            No synced rosters yet — run a sync in Sleeper Manager and this panel will see which
            players are on your teams.
          </p>
        ) : (
          <>
            <div className="filters" style={{ marginBottom: 8 }}>
              <button
                className={`chip-filter ${panelView === "injured" ? "on" : ""}`}
                onClick={() => {
                  setPanelView("injured");
                  setPanelLimit(PANEL_PAGE);
                }}
              >
                Injured ({injuredUnrankedCount})
              </button>
              <button
                className={`chip-filter ${panelView === "all" ? "on" : ""}`}
                onClick={() => {
                  setPanelView("all");
                  setPanelLimit(PANEL_PAGE);
                }}
              >
                All unranked ({unranked.length})
              </button>
              <span className="hint" style={{ margin: "0 0 0 6px", alignSelf: "center" }}>
                position follows the filter below
              </span>
            </div>

            {panelRows.length === 0 ? (
              <p className="hint" style={{ margin: 0, color: "var(--mint)" }}>
                {pmap
                  ? panelView === "injured"
                    ? "✓ Every injured player on your rosters is already ranked."
                    : "✓ Every player on your rosters is already ranked."
                  : ""}
              </p>
            ) : (
              <>
                <div className="field" style={{ marginBottom: 8, alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <select className="select" value={panelTier} onChange={(e) => setPanelTier(Number(e.target.value))}>
                    {TIERS.map((t) => (
                      <option key={t} value={t}>
                        Add to tier {TIER_LABELS[t - 1]}
                      </option>
                    ))}
                  </select>
                  <button className="btn sm" onClick={() => addCandidates(panelRows)}>
                    Add all {panelRows.length} shown
                  </button>
                </div>
                <div style={{ border: "1px solid var(--line-soft)", borderRadius: 8, overflow: "hidden" }}>
                  {panelRows.slice(0, panelLimit).map((u) => (
                    <div
                      key={u.id}
                      className="tierrow"
                      style={{ cursor: "default" }}
                    >
                      <span className="pos" style={posChipStyle(u.pos)}>
                        {u.pos}
                      </span>
                      <span className="plname">{u.name}</span>
                      <InjBadge inj={u.inj} />
                      <span className="plteam">{u.team}</span>
                      <span className="plteam" title={`On ${u.leagues} of your ${exposureLeagues} leagues`}>
                        ×{u.leagues}
                      </span>
                      <button className="btn ghost sm" onClick={() => addCandidates([u])}>
                        + Add
                      </button>
                    </div>
                  ))}
                </div>
                {panelRows.length > panelLimit && (
                  <button
                    className="linklike"
                    style={{ fontSize: 12.5, marginTop: 6 }}
                    onClick={() => setPanelLimit((n) => n + PANEL_PAGE)}
                  >
                    Show {Math.min(PANEL_PAGE, panelRows.length - panelLimit)} more ({panelRows.length - panelLimit} left)
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* ── Team drift: board team text vs Sleeper's current team ── */}
      {drift.length > 0 && (
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: "10px 14px",
            marginBottom: 14,
            background: "var(--panel)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <b style={{ fontSize: 13.5 }}>{drift.length} ranked player{drift.length === 1 ? "" : "s"} changed team on Sleeper</b>
            {drift.length > releasedDrift.length && (
              <button className="btn sm" onClick={syncTeams}>
                Update {drift.length - releasedDrift.length} team{drift.length - releasedDrift.length === 1 ? "" : "s"}
              </button>
            )}
          </div>
          <p className="hint" style={{ margin: "6px 0 0" }}>
            {drift
              .filter((d) => d.to)
              .slice(0, 12)
              .map((d) => `${d.name} ${d.from}→${d.to}`)
              .join(" · ")}
            {drift.filter((d) => d.to).length > 12 ? " · …" : ""}
          </p>
          {releasedDrift.length > 0 && (
            <p className="hint" style={{ margin: "6px 0 0", color: "var(--amber)" }}>
              No team on Sleeper right now (released or retired) — not auto-updated, decide yourself:{" "}
              {releasedDrift.map((d) => d.name).join(", ")}
            </p>
          )}
        </div>
      )}

      <div className="filters">
        {["ALL", ...ADD_POSITIONS].map((p) => (
          <button
            key={p}
            className={`chip-filter ${posFilter === p ? "on" : ""}`}
            onClick={() => setFilter(p)}
          >
            {p}
          </button>
        ))}
        <button
          className={`chip-filter ${injuredOnly ? "on" : ""}`}
          onClick={() => setInjuredOnly((v) => !v)}
          disabled={!index}
          title="Show only ranked players Sleeper lists as injured"
        >
          Injured ({injuredRankedCount})
        </button>
      </div>

      <div className="field" style={{ marginBottom: 10, alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <input
          className="input"
          placeholder="Find a ranked player or team…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 260 }}
        />
        {(q || injuredOnly || posFilter !== "ALL") && (
          <>
            <span className="hint" style={{ margin: 0 }}>
              {shownNames.length} shown
            </span>
            <button className="btn ghost sm" onClick={() => setSelected(new Set(shownNames))}>
              Select all shown
            </button>
          </>
        )}
      </div>

      <div className="field" style={{ marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input"
          placeholder="Add by name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addPlayer()}
          style={{ maxWidth: 200 }}
        />
        <select className="select" value={newPos} onChange={(e) => setNewPos(e.target.value)}>
          {ADD_POSITIONS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <input
          className="input"
          placeholder="Team (e.g. SF)"
          value={newTeam}
          onChange={(e) => setNewTeam(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addPlayer()}
          style={{ maxWidth: 100 }}
        />
        <select
          className="select"
          value={newTier}
          onChange={(e) => setNewTier(Number(e.target.value))}
        >
          {TIERS.map((t) => (
            <option key={t} value={t}>
              Tier {TIER_LABELS[t - 1]}
            </option>
          ))}
        </select>
        <button className="btn sm" onClick={addPlayer}>
          Add player
        </button>
      </div>
      {addError && (
        <p className="hint" style={{ color: "var(--red)", marginBottom: 12 }}>
          {addError}
        </p>
      )}

      <div className="tierlist">
        {TIERS.map((t) => {
          const ti = t - 1;
          const color = TIER_COLOR[ti];
          const cards = board[ti]
            .map((p, ai) => ({ p, ai }))
            .filter(({ p }) => isShown(p));

          return (
            <div key={t}>
              <div
                className={`tierband ${cards.length === 0 ? "empty" : ""}`}
                style={{ background: color }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = dragRef.current;
                  if (!from) return;
                  commit((b) => {
                    const draggedPos = b[from.tier][from.idx]?.pos;
                    const insertIdx =
                      posFilter === "ALL" || !draggedPos
                        ? 0
                        : prependIndexForPos(b[ti], draggedPos);
                    return movePlayer(b, from, { tier: ti, idx: insertIdx });
                  });
                  dragRef.current = null;
                }}
              >
                {cards.length === 0 ? (
                  <>Tier {TIER_LABELS[ti]} — drop here</>
                ) : (
                  <>
                    {TIER_LABELS[ti]}
                    <span className="count">{cards.length}</span>
                  </>
                )}
              </div>
              {cards.map(({ p, ai }) => {
                const info = infoByName[p.name];
                return (
                  <div
                    key={p.name}
                    className="tierrow"
                    draggable
                    style={selected.has(p.name) ? { background: "var(--line-soft)" } : undefined}
                    onDragStart={() => {
                      dragRef.current = { tier: ti, idx: ai };
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = dragRef.current;
                      if (!from) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const before = e.clientY < rect.top + rect.height / 2;
                      commit((b) => movePlayer(b, from, { tier: ti, idx: ai + (before ? 0 : 1) }));
                      dragRef.current = null;
                    }}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${p.name}`}
                      checked={selected.has(p.name)}
                      onChange={() => toggleSelected(p.name)}
                      style={{ flex: "none", margin: 0 }}
                    />
                    <span className="pos" style={posChipStyle(p.pos)}>
                      {p.pos}
                      {rankByName[p.name]}
                    </span>
                    <span className="plname">{p.name}</span>
                    <InjBadge inj={info?.inj} />
                    <span className="plteam">{p.team}</span>
                    {info && info.leagues > 0 && (
                      <span className="plteam" title={`On ${info.leagues} of your ${exposureLeagues} leagues`}>
                        ×{info.leagues}
                      </span>
                    )}
                    <div className="btnrow">
                      <button className="mini" title="Move up" onClick={() => moveWithinTier(ti, ai, -1)}>▲</button>
                      <button className="mini" title="Move down" onClick={() => moveWithinTier(ti, ai, 1)}>▼</button>
                      <button className="mini" title="Move to tier above" onClick={() => moveToTier(ti, ai, -1)}>«</button>
                      <button className="mini" title="Move to tier below" onClick={() => moveToTier(ti, ai, 1)}>»</button>
                      <button className="mini" title="Remove" onClick={() => removePlayer(ti, ai)}>✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}
