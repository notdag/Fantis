"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ProtoLeague } from "@/lib/protoData";
import { OUTLOOK_LABEL, outlook, winProb, type Outlook } from "@/lib/winProb";

// This week's win chances across every league (StatChasers' Matchups view): each league's projected score vs the
// opponent's, the chance of winning (lib/winProb.ts — an estimate from projections), and a favorite / toss-up /
// underdog label. Sorted closest-first by default, since those are the lineups where one decision matters most.
type Sort = "closest" | "best" | "worst";

export default function WinChances({ leagues, week }: { leagues: ProtoLeague[]; week: number }) {
  const [only, setOnly] = useState<Outlook | "all">("all");
  const [sort, setSort] = useState<Sort>("closest");
  const rows = useMemo(
    () =>
      leagues
        .map((l) => ({ l, p: winProb(l.myProj, l.oppProj) }))
        .filter((r): r is { l: ProtoLeague; p: number } => r.p != null),
    [leagues]
  );
  const counts = { favorite: 0, "toss-up": 0, underdog: 0 } as Record<Outlook, number>;
  for (const r of rows) counts[outlook(r.p)]++;
  const expected = rows.reduce((a, r) => a + r.p, 0);
  const shown = rows
    .filter((r) => only === "all" || outlook(r.p) === only)
    .sort((a, b) => (sort === "closest" ? Math.abs(a.p - 0.5) - Math.abs(b.p - 0.5) : sort === "best" ? b.p - a.p : a.p - b.p));
  const missing = leagues.length - rows.length;

  return (
    <section className="wc">
      <div className="wc-sum">
        <div><span>Expected wins</span><b>{expected.toFixed(1)}</b><small>of {rows.length}</small></div>
        <div className="f"><span>Favorite</span><b>{counts.favorite}</b><small>60%+</small></div>
        <div className="t"><span>Toss-up</span><b>{counts["toss-up"]}</b><small>40–60%</small></div>
        <div className="u"><span>Underdog</span><b>{counts.underdog}</b><small>under 40%</small></div>
      </div>
      <div className="wc-bar">
        {(["all", "favorite", "toss-up", "underdog"] as const).map((k) => (
          <button key={k} className={`chip-filter ${only === k ? "on" : ""}`} onClick={() => setOnly(k)}>
            {k === "all" ? `All ${rows.length}` : `${OUTLOOK_LABEL[k]} ${counts[k]}`}
          </button>
        ))}
        <span className="wc-gap" />
        <label className="wc-sort">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="closest">Closest first</option>
            <option value="best">Best chance first</option>
            <option value="worst">Worst chance first</option>
          </select>
        </label>
      </div>
      <ul className="wc-list">
        {shown.map(({ l, p }) => {
          const o = outlook(p);
          return (
            <li key={l.id}>
              <Link href={`/manager/${l.id}/matchup`} className="wc-row">
                <span className="wc-lg">
                  <b>{l.name}</b>
                  <small>vs {l.oppName ?? "opponent"}{l.myPts && l.myPts > 0 ? ` · live ${l.myPts.toFixed(1)}–${(l.oppPts ?? 0).toFixed(1)}` : ""}</small>
                </span>
                <span className="wc-pts">{l.myProj!.toFixed(1)}<i>vs</i>{l.oppProj!.toFixed(1)}</span>
                <span className="wc-meter" aria-hidden><i style={{ width: `${Math.round(p * 100)}%` }} className={o} /></span>
                <span className={`wc-pct ${o}`}>{Math.round(p * 100)}%</span>
                <span className={`wc-tag ${o}`}>{OUTLOOK_LABEL[o]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="wc-note">
        Week {week}. Win chance is an estimate from both teams&rsquo; projected points at the last sync, allowing for normal
        week-to-week swings (each score ±20% around its projection) — not a guarantee.
        {missing > 0 && ` ${missing} league${missing === 1 ? "" : "s"} without a projection for both teams ${missing === 1 ? "is" : "are"} left out.`}
      </p>
    </section>
  );
}
