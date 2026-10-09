"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHead } from "./PageHead";
import { StatCard, StatCardGrid } from "./StatCard";
import { DataTable, TableHeaderRow, TableRow } from "./DataRow";

export interface LeagueMate {
  ownerId: string;
  name: string; // their most-used team name across your shared leagues
  leagues: { id: string; name: string; record: string }[];
  h2hW: number;
  h2hL: number;
  h2hT: number;
  wins: number; // their record summed across the shared leagues
  losses: number;
}

const PAGE = 50;

export default function LeagueMates({ mates }: { mates: LeagueMate[] }) {
  const [q, setQ] = useState("");
  const [minShared, setMinShared] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const repeat = mates.filter((m) => m.leagues.length >= 2).length;
  const top = mates[0];
  const h2h = mates.reduce((a, m) => [a[0] + m.h2hW, a[1] + m.h2hL], [0, 0]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return mates.filter((m) => m.leagues.length >= minShared && (!t || m.name.toLowerCase().includes(t) || m.leagues.some((l) => l.name.toLowerCase().includes(t))));
  }, [mates, q, minShared]);

  return (
    <>
      <section className="sec" style={{ paddingBottom: 0 }}>
        <PageHead description="Who keeps showing up in your leagues, how many leagues you share, and your real head-to-head record against each of them." />
        <StatCardGrid variant="grid">
          <StatCard label="LeagueMates" value={mates.length} sub="unique managers across your leagues" />
          <StatCard label="Repeat LeagueMates" value={repeat} sub="shared in 2+ leagues" />
          <StatCard label="Highest overlap" value={top ? `${top.leagues.length} leagues` : "—"} sub={top?.name} />
          <StatCard label="Your head-to-head" value={`${h2h[0]}–${h2h[1]}`} valueColor={h2h[0] >= h2h[1] ? "var(--mint)" : "var(--red)"} sub="vs everyone, synced weeks" />
        </StatCardGrid>
      </section>
      <section className="sec">
        <div className="field" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <input className="input" style={{ maxWidth: 300 }} placeholder="Search managers or leagues…" value={q} onChange={(e) => (setQ(e.target.value), setLimit(PAGE))} aria-label="Search managers" />
          {[1, 2, 5, 10].map((n) => (
            <button key={n} className={`chip-filter ${minShared === n ? "on" : ""}`} onClick={() => (setMinShared(n), setLimit(PAGE))}>
              {n === 1 ? "Everyone" : `${n}+ leagues`}
            </button>
          ))}
        </div>
        <DataTable>
          <TableHeaderRow>
            <span style={{ flex: 1 }}>Manager</span>
            <span style={{ minWidth: 110, textAlign: "right" }}>Shared leagues</span>
            <span style={{ minWidth: 120, textAlign: "right" }}>Your H2H</span>
            <span style={{ minWidth: 120, textAlign: "right" }}>Their record</span>
          </TableHeaderRow>
          {shown.slice(0, limit).map((m) => {
            const isOpen = open === m.ownerId;
            const h = m.h2hW + m.h2hL + m.h2hT;
            return (
              <div key={m.ownerId}>
                <TableRow as="button" onClick={() => setOpen(isOpen ? null : m.ownerId)}>
                  <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <span className="lm-av" aria-hidden>{m.name.slice(0, 1).toUpperCase()}</span>
                    <span className="tname" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</span>
                  </span>
                  <span className="portvalue" style={{ minWidth: 110, textAlign: "right" }}>{m.leagues.length}</span>
                  <span className="portmeta" style={{ minWidth: 120, textAlign: "right", fontWeight: 700, color: h === 0 ? undefined : m.h2hW > m.h2hL ? "var(--mint)" : m.h2hW < m.h2hL ? "var(--red)" : undefined }}>
                    {h === 0 ? "not played" : `${m.h2hW}–${m.h2hL}${m.h2hT ? `–${m.h2hT}` : ""}`}
                  </span>
                  <span className="portmeta" style={{ minWidth: 120, textAlign: "right" }}>{m.wins}–{m.losses}</span>
                </TableRow>
                {isOpen && (
                  <ul className="lm-list">
                    {m.leagues.map((l) => (
                      <li key={l.id}>
                        <Link href={`/manager/${l.id}/standings`}>{l.name}</Link>
                        <span className="portmeta">{l.record}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </DataTable>
        {shown.length === 0 && <p className="hint">No managers match.</p>}
        {shown.length > limit && (
          <button className="btn ghost sm" style={{ marginTop: 12 }} onClick={() => setLimit((l) => l + PAGE)}>
            Show {Math.min(PAGE, shown.length - limit)} more of {shown.length}
          </button>
        )}
      </section>
    </>
  );
}
