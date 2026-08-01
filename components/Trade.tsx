"use client";

import { useState } from "react";
import { PLAYERS, posChipStyle } from "@/lib/players";
import type { Player } from "@/lib/types";

export default function Trade() {
  const [a, setA] = useState<Player[]>([]);
  const [b, setB] = useState<Player[]>([]);
  const sum = (arr: Player[]) => arr.reduce((s, p) => s + p.value, 0);
  const va = sum(a);
  const vb = sum(b);
  const total = va + vb || 1;
  const pa = Math.round((va / total) * 100);
  const pb = 100 - pa;
  const diff = va - vb;
  const winner = Math.abs(diff) < 6 ? "Even trade" : diff > 0 ? "Side A wins" : "Side B wins";
  const winColor = Math.abs(diff) < 6 ? "var(--muted)" : diff > 0 ? "var(--mint)" : "var(--amber)";

  return (
    <section className="sec">
      <div className="sechead">
        <h2>Trade calculator</h2>
        <span className="rt">verdict updates live</span>
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

      <div className="verdict" style={{ maxWidth: 640, margin: "22px auto 0" }}>
        <div className="vbar">
          <div className="vfill" style={{ width: `${pa}%`, background: "var(--mint)" }} />
          <div className="vfill" style={{ width: `${pb}%`, background: "var(--amber)" }} />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 8,
            color: "var(--muted)",
            fontSize: 13,
          }}
        >
          <span className="num">A · {va}</span>
          <span className="num">{vb} · B</span>
        </div>
        <div className="vlabel" style={{ color: winColor }}>
          {winner}
          {Math.abs(diff) >= 6 ? ` (+${Math.abs(diff)})` : ""}
        </div>
      </div>
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
          .sort((a, b) => b.value - a.value)
          .slice(0, 7);
  const add = (p: Player) => {
    setPicks([...picks, p]);
    setQ("");
  };
  const remove = (n: string) => setPicks(picks.filter((p) => p.name !== n));
  const tot = picks.reduce((s, p) => s + p.value, 0);

  return (
    <div className="side">
      <h4 style={{ color: accent }}>{title}</h4>
      {picks.map((p) => (
        <div className="picked" key={p.name}>
          <span className="pos" style={posChipStyle(p.pos)}>
            {p.pos}
          </span>
          <span className="plname">{p.name}</span>
          <span className="val">{p.value}</span>
          <button className="x" onClick={() => remove(p.name)}>
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
                </span>
                <span className="plname">{p.name}</span>
                <span style={{ marginLeft: "auto", color: "var(--dim)" }}>{p.team}</span>
                <span className="val" style={{ color: accent }}>
                  {p.value}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="sum" style={{ color: accent }}>
        {tot}
      </div>
    </div>
  );
}
