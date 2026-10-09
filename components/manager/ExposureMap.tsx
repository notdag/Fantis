"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ProtoExposure } from "@/lib/protoData";
import type { PlayerMap } from "@/lib/types";
import { playerPhotoUrl } from "@/lib/sleeper";

// Player exposure (StatChasers-style bubble map): every player you roster, sized by how many of your in-season leagues
// hold him, grouped by position; a dot marks a real injury designation. Clicking opens Find-a-player for him.
const POS = ["QB", "RB", "WR", "TE"] as const;
const POS_COLOR: Record<string, string> = { QB: "#5FDA9C", RB: "#59B4E8", WR: "#F0808A", TE: "#F0B876" };
const LABEL: Record<string, string> = { QB: "Quarterbacks", RB: "Running backs", WR: "Wide receivers", TE: "Tight ends" };

export default function ExposureMap({ exposure, pmap, leagueCount }: { exposure: ProtoExposure[]; pmap: PlayerMap | null; leagueCount: number }) {
  const [pos, setPos] = useState<string>("ALL");
  const [status, setStatus] = useState<"all" | "injured">("all");
  const [view, setView] = useState<"map" | "table">("map");
  const by = useMemo(() => {
    const out: Record<string, { id: string; n: number; s: number; name: string; team: string; inj?: string }[]> = { QB: [], RB: [], WR: [], TE: [] };
    for (const e of exposure) {
      const p = pmap?.[e.id];
      if (!p || !(p.p in out)) continue;
      if (status === "injured" && !p.inj) continue;
      out[p.p].push({ id: e.id, n: e.leagues, s: e.starting, name: p.n, team: p.t, inj: p.inj ?? undefined });
    }
    return out;
  }, [exposure, pmap, status]);
  const max = Math.max(1, ...Object.values(by).flat().map((b) => b.n));
  const cols = POS.filter((p) => pos === "ALL" || pos === p);
  const injuredCount = exposure.filter((e) => pmap?.[e.id]?.inj).length;

  return (
    <section className="xm">
      <div className="xm-head">
        <h2>Player exposure</h2>
        <div className="xm-seg" role="group" aria-label="View">
          <button className={view === "map" ? "on" : ""} onClick={() => setView("map")}>Map</button>
          <button className={view === "table" ? "on" : ""} onClick={() => setView("table")}>Table</button>
        </div>
      </div>
      <p className="xm-note">How many of your {leagueCount} in-season leagues roster each player (best ball left out). Dot = injury designation.</p>
      <div className="xm-filters">
        {["ALL", ...POS].map((p) => (
          <button key={p} className={`chip-filter ${pos === p ? "on" : ""}`} onClick={() => setPos(p)}>{p === "ALL" ? "All" : p}</button>
        ))}
        <span className="xm-gap" />
        <button className={`chip-filter ${status === "all" ? "on" : ""}`} onClick={() => setStatus("all")}>Everyone</button>
        <button className={`chip-filter ${status === "injured" ? "on" : ""}`} onClick={() => setStatus("injured")}>Injured {injuredCount}</button>
      </div>
      {!pmap && <p className="xm-note">Loading players…</p>}
      {pmap && view === "map" && (
        <div className="xm-grid" style={{ gridTemplateColumns: cols.length === 1 ? "1fr" : ".8fr 1.4fr 1.4fr .8fr" }}>
          {cols.map((p) => (
            <div key={p} className="xm-col" style={{ ["--pc" as string]: POS_COLOR[p] }}>
              <h3><i />{LABEL[p]}<span>{by[p].length}</span></h3>
              <div className="xm-wrap">
                {by[p].slice(0, cols.length === 1 ? 80 : p === "RB" || p === "WR" ? 32 : 14).map((b) => {
                  const d = 36 + Math.round(58 * Math.sqrt(b.n / max));
                  return (
                    <Link key={b.id} href={`/manager/player?playerId=${b.id}`} className="xm-b" style={{ width: d, height: d }} title={`${b.name} (${b.team}) — on ${b.n} of your rosters, starting in ${b.s}${b.inj ? ` · ${b.inj}` : ""}`}>
                      {d > 56 && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={playerPhotoUrl(b.id)} alt="" loading="lazy" />
                      )}
                      <span className="nm">{b.name.split(" ").slice(-1)[0]}</span>
                      <span className="ct">{b.n}</span>
                      {b.inj && <span className={`inj ${/out|ir|doubt/i.test(b.inj) ? "r" : ""}`} />}
                    </Link>
                  );
                })}
                {by[p].length === 0 && <p className="xm-note">None.</p>}
              </div>
            </div>
          ))}
        </div>
      )}
      {pmap && view === "table" && (
        <div className="mgrtable">
          <div className="mgrrow head static">
            <span style={{ flex: 1 }}>Player</span>
            <span style={{ minWidth: 70, textAlign: "right" }}>Leagues</span>
            <span style={{ minWidth: 80, textAlign: "right" }}>Exposure</span>
            <span style={{ minWidth: 80, textAlign: "right" }}>Starting</span>
            <span style={{ minWidth: 110, textAlign: "right" }}>Status</span>
          </div>
          {cols
            .flatMap((p) => by[p].map((b) => ({ ...b, pos: p })))
            .sort((a, b) => b.n - a.n)
            .slice(0, 150)
            .map((b) => (
              <Link key={b.id} href={`/manager/player?playerId=${b.id}`} className="mgrrow">
                <span style={{ flex: 1, display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                  <span className="xm-pos" style={{ ["--pc" as string]: POS_COLOR[b.pos] }}>{b.pos}</span>
                  <span className="tname">{b.name}</span>
                  <span className="portmeta">{b.team}</span>
                </span>
                <span className="portvalue" style={{ minWidth: 70, textAlign: "right" }}>{b.n}</span>
                <span className="portmeta" style={{ minWidth: 80, textAlign: "right" }}>{Math.round((b.n / Math.max(1, leagueCount)) * 100)}%</span>
                <span className="portmeta" style={{ minWidth: 80, textAlign: "right" }}>{b.s}</span>
                <span className="portmeta" style={{ minWidth: 110, textAlign: "right", color: b.inj ? "var(--amber)" : undefined }}>{b.inj ?? "—"}</span>
              </Link>
            ))}
        </div>
      )}
    </section>
  );
}
