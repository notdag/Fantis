"use client";

import { useState } from "react";
import { PLAYERS, posChipStyle } from "@/lib/players";
import type { Player } from "@/lib/types";

export default function Trade() {
  const [a, setA] = useState<Player[]>([]);
  const [b, setB] = useState<Player[]>([]);

  return (
    <section className="sec">
      <div className="sechead">
        <h2>Trade calculator</h2>
        <span className="rt">verdict disabled — no value metric configured</span>
      </div>
      <div className="trade">
        <TradeSide title="Side A" picks={a} setPicks={setA} accent="var(--mint)" other={b} />
        <div style={{ alignSelf: "center", textAlign: "center", padding: "8px 0" }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--dim)" }}>
            VS
          </div>
        </div>
        <TradeSide title="Side B" picks={b} setPicks={setB} accent="var(--amber)" other={a} />
      </div>

      {(a.length > 0 || b.length > 0) && (
        <div className="verdict" style={{ maxWidth: 640, margin: "22px auto 0" }}>
          <p className="hint" style={{ textAlign: "center" }}>
            The old verdict bar summed each side&rsquo;s hand-entered &ldquo;value&rdquo;
            score, which had no real methodology behind it — removed. Once a real trade
            value metric exists, this is where the tilting mint/amber bar comes back.
          </p>
        </div>
      )}
    </section>
  );
}

function TradeSide({
  title,
  picks,
  setPicks,
  accent,
  other,
}: {
  title: string;
  picks: Player[];
  setPicks: (p: Player[]) => void;
  accent: string;
  other: Player[];
}) {
  const [q, setQ] = useState("");
  const chosen = new Set([...picks, ...other].map((p) => p.name));
  const matches =
    q.trim().length < 1
      ? []
      : PLAYERS.filter(
          (p) => p.name.toLowerCase().includes(q.toLowerCase()) && !chosen.has(p.name)
        )
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, 7);
  const add = (p: Player) => {
    setPicks([...picks, p]);
    setQ("");
  };
  const remove = (n: string) => setPicks(picks.filter((p) => p.name !== n));

  return (
    <div className="side">
      <h4 style={{ color: accent }}>{title}</h4>
      {picks.map((p) => (
        <div className="picked" key={p.name}>
          <span className="pos" style={posChipStyle(p.pos)}>
            {p.pos}
            {p.posRank}
          </span>
          <span className="plname">{p.name}</span>
          <button className="x" onClick={() => remove(p.name)} style={{ marginLeft: "auto" }}>
            ✕
          </button>
        </div>
      ))}
      <div className="search">
        <input
          className="input"
          placeholder="Add a player…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ width: "100%" }}
        />
        {matches.length > 0 && (
          <div className="results">
            {matches.map((p) => (
              <div className="res" key={p.name} onClick={() => add(p)}>
                <span className="pos" style={posChipStyle(p.pos)}>
                  {p.pos}
                  {p.posRank}
                </span>
                <span className="plname">{p.name}</span>
                <span style={{ marginLeft: "auto", color: "var(--dim)" }}>{p.team}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
