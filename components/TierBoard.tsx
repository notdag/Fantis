"use client";

import { useMemo, useRef, useState } from "react";
import { TIER_COLOR, TIER_LABELS, computePosRanks, posChipStyle } from "@/lib/players";
import type { Player } from "@/lib/types";

const TIER_COUNT = TIER_LABELS.length; // 8: S, A, B, C, D, E, F, G
const TIERS = Array.from({ length: TIER_COUNT }, (_, i) => i + 1);
const ADD_POSITIONS = ["QB", "RB", "WR", "TE"];

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

export default function TierBoard({ initialPlayers }: { initialPlayers: Player[] }) {
  const [board, setBoard] = useState<Board>(() => groupByTier(initialPlayers));
  const dragRef = useRef<{ tier: number; idx: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [prodSource, setProdSource] = useState<string | null>(null);

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

  // posRank derived live from board order, same rule the save route uses —
  // this is what the owner sees while dragging, so it matches what gets saved.
  const rankByName = useMemo(() => {
    const flat = board.flat();
    const ranks = computePosRanks(flat);
    const map: Record<string, number> = {};
    flat.forEach((p, i) => (map[p.name] = ranks[i]));
    return map;
  }, [board]);

  const moveWithinTier = (tier: number, idx: number, dir: -1 | 1) => {
    setBoard((b) => {
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
    setBoard((b) => {
      const p = b[tier][idx];
      const insertIdx =
        posFilter === "ALL" ? b[targetTier].length : appendIndexForPos(b[targetTier], p.pos);
      return movePlayer(b, { tier, idx }, { tier: targetTier, idx: insertIdx });
    });
  };

  const reset = () => {
    setBoard(groupByTier(initialPlayers));
    setSaveMsg(null);
    setProdSource(null);
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
    setBoard((b) => {
      const next = b.map((c) => [...c]);
      next[newTier - 1] = [...next[newTier - 1], player];
      return next;
    });
    setNewName("");
    setNewTeam("");
  };

  const removePlayer = (tier: number, idx: number) => {
    setBoard((b) => {
      const next = b.map((c) => [...c]);
      next[tier].splice(idx, 1);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setSaveMsg(null);
    setProdSource(null);
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
      if (body.written) {
        setSaveMsg({ text: "Saved to lib/players.data.ts — the app will hot-reload." });
      } else {
        setSaveMsg({
          text: "This deployment can't write files at runtime. Copy the generated source below into lib/players.data.ts and commit it.",
        });
        setProdSource(body.source);
      }
    } catch {
      setSaveMsg({ text: "Couldn't reach the server.", error: true });
    } finally {
      setSaving(false);
    }
  };

  const logout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.reload();
  };

  return (
    <section className="sec">
      <div className="sechead">
        <h2>Tier board</h2>
        <span className="rt">owner only</span>
      </div>
      <p className="hint" style={{ marginBottom: 10 }}>
        Drag a player up or down to reorder them, or past a tier band to
        re-tier them — position rank (QB1, RB4, …) updates live from where a
        player lands. Nothing is saved until you click Save. Rankings
        displays every position mixed together; filter to one position below
        to rank within just that position instead of the aggregate pile.
      </p>
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
      </div>

      <div className="field" style={{ marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input"
          placeholder="Player name"
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

      <div className="field" style={{ marginBottom: 14, alignItems: "center" }}>
        <button className="btn" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="btn ghost sm" onClick={reset} disabled={saving}>
          Reset
        </button>
        <button className="btn ghost sm" onClick={logout} style={{ marginLeft: "auto" }}>
          Log out
        </button>
      </div>
      {saveMsg && (
        <p className="hint" style={{ color: saveMsg.error ? "var(--red)" : "var(--mint)", marginBottom: 12 }}>
          {saveMsg.text}
        </p>
      )}
      {prodSource && (
        <textarea
          readOnly
          value={prodSource}
          style={{
            width: "100%",
            height: 220,
            marginBottom: 16,
            background: "var(--ink)",
            color: "var(--bone)",
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: 10,
            fontFamily: "monospace",
            fontSize: 12,
          }}
        />
      )}

      <div className="tierlist">
        {TIERS.map((t) => {
          const ti = t - 1;
          const color = TIER_COLOR[ti];
          const cards = board[ti]
            .map((p, ai) => ({ p, ai }))
            .filter(({ p }) => posFilter === "ALL" || p.pos === posFilter);

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
                  setBoard((b) => {
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
              {cards.map(({ p, ai }) => (
                <div
                  key={p.name}
                  className="tierrow"
                  draggable
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
                    setBoard((b) => movePlayer(b, from, { tier: ti, idx: ai + (before ? 0 : 1) }));
                    dragRef.current = null;
                  }}
                >
                  <span className="pos" style={posChipStyle(p.pos)}>
                    {p.pos}
                    {rankByName[p.name]}
                  </span>
                  <span className="plname">{p.name}</span>
                  <span className="plteam">{p.team}</span>
                  <div className="btnrow">
                    <button className="mini" title="Move up" onClick={() => moveWithinTier(ti, ai, -1)}>▲</button>
                    <button className="mini" title="Move down" onClick={() => moveWithinTier(ti, ai, 1)}>▼</button>
                    <button className="mini" title="Move to tier above" onClick={() => moveToTier(ti, ai, -1)}>«</button>
                    <button className="mini" title="Move to tier below" onClick={() => moveToTier(ti, ai, 1)}>»</button>
                    <button className="mini" title="Remove" onClick={() => removePlayer(ti, ai)}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
