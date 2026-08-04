"use client";

import { useState } from "react";
import { PLAYERS, posChipStyle } from "@/lib/players";
import { useTradeValues } from "@/lib/useTradeValues";
import type { TradeValueResult } from "@/lib/tradeValue";
import type { Player } from "@/lib/types";

export default function Trade() {
  const [a, setA] = useState<Player[]>([]);
  const [b, setB] = useState<Player[]>([]);
  const values = useTradeValues();
  const loading = Object.keys(values).length === 0;

  const sum = (picks: Player[]) =>
    picks.reduce((total, p) => total + (values[p.name]?.value ?? 0), 0);
  const missing = (picks: Player[]) => picks.filter((p) => !values[p.name]).length;

  const sumA = sum(a);
  const sumB = sum(b);
  const total = sumA + sumB;
  const missingCount = missing(a) + missing(b);
  const hasPicks = a.length > 0 || b.length > 0;

  return (
    <section className="sec">
      <div className="sechead">
        <h2>Trade calculator</h2>
        <span className="rt">value = season proj. pts + weekly market delta</span>
      </div>
      <div className="trade">
        <TradeSide title="Side A" picks={a} setPicks={setA} accent="var(--mint)" other={b} values={values} />
        <div style={{ alignSelf: "center", textAlign: "center", padding: "8px 0" }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--dim)" }}>
            VS
          </div>
        </div>
        <TradeSide title="Side B" picks={b} setPicks={setB} accent="var(--amber)" other={a} values={values} />
      </div>

      {hasPicks && (
        <div className="verdict" style={{ maxWidth: 640, margin: "22px auto 0" }}>
          {loading ? (
            <p className="hint" style={{ textAlign: "center" }}>
              Loading trade values…
            </p>
          ) : total <= 0 ? (
            <p className="hint" style={{ textAlign: "center" }}>
              No computed trade value for these players yet — Sleeper doesn&rsquo;t have a
              season projection for them.
            </p>
          ) : (
            <>
              <div className="vbar">
                <div
                  className="vfill"
                  style={{ width: `${(sumA / total) * 100}%`, background: "var(--mint)" }}
                />
                <div
                  className="vfill"
                  style={{ width: `${(sumB / total) * 100}%`, background: "var(--amber)" }}
                />
              </div>
              <div className="vlabel">
                {Math.abs(sumA - sumB) < total * 0.02
                  ? "Roughly even"
                  : sumA > sumB
                    ? `Side A favored by ${(sumA - sumB).toFixed(1)} pts`
                    : `Side B favored by ${(sumB - sumA).toFixed(1)} pts`}
              </div>
            </>
          )}
          <p className="hint" style={{ textAlign: "center", marginTop: 10 }}>
            Value is Sleeper&rsquo;s season-long PPR point projection, nudged (capped at
            &plusmn;20% of weekly pace) by how this week&rsquo;s live SportsGameOdds props
            compare to that pace.
            {missingCount > 0 &&
              ` ${missingCount} player${missingCount > 1 ? "s" : ""} above ${
                missingCount > 1 ? "have" : "has"
              } no season projection yet and aren't counted.`}{" "}
            Not investment or betting advice.
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
  values,
}: {
  title: string;
  picks: Player[];
  setPicks: (p: Player[]) => void;
  accent: string;
  other: Player[];
  values: Record<string, TradeValueResult>;
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
      {picks.map((p) => {
        const v = values[p.name];
        return (
          <div className="picked" key={p.name}>
            <span className="pos" style={posChipStyle(p.pos)}>
              {p.pos}
              {p.posRank}
            </span>
            <span className="plname">{p.name}</span>
            <span className="val">{v ? v.value.toFixed(1) : "—"}</span>
            <button className="x" onClick={() => remove(p.name)}>
              ✕
            </button>
          </div>
        );
      })}
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
