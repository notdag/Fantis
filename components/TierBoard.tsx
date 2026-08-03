"use client";

import { useMemo, useRef, useState } from "react";
import { TIER_COLOR, computePosRanks, posChipStyle } from "@/lib/players";
import type { Player } from "@/lib/types";

const TIERS = [1, 2, 3, 4, 5, 6];

type Board = Player[][]; // index 0..5 = tier 1..6

function groupByTier(players: Player[]): Board {
  const board: Board = [[], [], [], [], [], []];
  for (const p of players) {
    const idx = Math.min(Math.max(p.tier - 1, 0), 5);
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

export default function TierBoard({ initialPlayers }: { initialPlayers: Player[] }) {
  const [board, setBoard] = useState<Board>(() => groupByTier(initialPlayers));
  const dragRef = useRef<{ tier: number; idx: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [prodSource, setProdSource] = useState<string | null>(null);

  // posRank derived live from board order, same rule the save route uses —
  // this is what the owner sees while dragging, so it matches what gets saved.
  const rankByName = useMemo(() => {
    const flat = board.flat();
    const ranks = computePosRanks(flat);
    const map: Record<string, number> = {};
    flat.forEach((p, i) => (map[p.name] = ranks[i]));
    return map;
  }, [board]);

  const moveWithinTier = (tier: number, idx: number, delta: number) => {
    setBoard((b) => {
      const col = b[tier];
      const target = idx + delta;
      if (target < 0 || target >= col.length) return b;
      const next = b.map((c) => [...c]);
      const [item] = next[tier].splice(idx, 1);
      next[tier].splice(target, 0, item);
      return next;
    });
  };

  const moveToTier = (tier: number, idx: number, dir: -1 | 1) => {
    const targetTier = tier + dir;
    if (targetTier < 0 || targetTier > 5) return;
    setBoard((b) => movePlayer(b, { tier, idx }, { tier: targetTier, idx: b[targetTier].length }));
  };

  const reset = () => {
    setBoard(groupByTier(initialPlayers));
    setSaveMsg(null);
    setProdSource(null);
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
      <p className="hint" style={{ marginBottom: 14 }}>
        Drag a player card to reorder within a tier or move it to another tier
        column — position rank (QB1, RB4, …) updates live from where a
        player lands. Nothing is saved until you click Save.
      </p>

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

      <div className="tierboard">
        {TIERS.map((t) => {
          const ti = t - 1;
          const color = TIER_COLOR[ti];
          return (
            <div
              key={t}
              className="tiercol"
              onDragOver={(e) => e.preventDefault()}
            >
              <header style={{ borderBottomColor: color, color }}>
                Tier {t}
                <span style={{ color: "var(--dim)", fontWeight: 500 }}>{board[ti].length}</span>
              </header>
              {board[ti].map((p, ci) => (
                <div
                  key={p.name}
                  className="tiercard"
                  draggable
                  onDragStart={() => {
                    dragRef.current = { tier: ti, idx: ci };
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = dragRef.current;
                    if (!from) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const before = e.clientY < rect.top + rect.height / 2;
                    setBoard((b) => movePlayer(b, from, { tier: ti, idx: ci + (before ? 0 : 1) }));
                    dragRef.current = null;
                  }}
                >
                  <div className="toprow">
                    <span className="pos" style={posChipStyle(p.pos)}>
                      {p.pos}
                      {rankByName[p.name]}
                    </span>
                    <span className="plname">{p.name}</span>
                    <span className="plteam">{p.team}</span>
                  </div>
                  <div className="btnrow">
                    <button className="mini" title="Move up" onClick={() => moveWithinTier(ti, ci, -1)}>▲</button>
                    <button className="mini" title="Move down" onClick={() => moveWithinTier(ti, ci, 1)}>▼</button>
                    <button className="mini" title="Move to tier above" onClick={() => moveToTier(ti, ci, -1)}>«</button>
                    <button className="mini" title="Move to tier below" onClick={() => moveToTier(ti, ci, 1)}>»</button>
                  </div>
                </div>
              ))}
              <div
                className="drop"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = dragRef.current;
                  if (!from) return;
                  setBoard((b) => movePlayer(b, from, { tier: ti, idx: b[ti].length }));
                  dragRef.current = null;
                }}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
