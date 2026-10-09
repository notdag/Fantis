"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import type { PlayerMap } from "@/lib/types";
import { playerPhotoUrl } from "@/lib/sleeper";
import { useSeasonTotals } from "@/lib/useDropCandidates";
import type { FaabLeague, WaiverLeague } from "./WaiverAssistant";

// Waiver Command overview (StatChasers-style): for every league, the best player still available (by Sleeper's
// season projection per game), the weakest player you'd drop for him, and the difference — plus each league's real
// bidding tendencies on demand. Availability is from the last sync; the claim itself happens in Mass add, which
// re-checks Sleeper live before sending.
const POS = ["ALL", "QB", "RB", "WR", "TE"] as const;
const POS_COLOR: Record<string, string> = { QB: "#5FDA9C", RB: "#59B4E8", WR: "#F0808A", TE: "#F0B876" };

interface Tendency {
  budget: number | null;
  claims: number;
  weeks?: number;
  avgPct?: number;
  maxPct?: number;
  perWeek?: number;
  bidders?: number;
  teams: number;
  managers: { name: string; claims: number; avgPct: number; maxPct: number; style: string }[];
}

export default function WaiverBoard({ leagues, faab, pmap }: { leagues: WaiverLeague[]; faab: FaabLeague[]; pmap: PlayerMap | null }) {
  const totals = useSeasonTotals();
  const [pos, setPos] = useState<(typeof POS)[number]>("ALL");
  const [open, setOpen] = useState<string | null>(null);
  const [tend, setTend] = useState<Record<string, Tendency | "loading" | "error">>({});
  const faabBy = useMemo(() => new Map(faab.map((f) => [f.leagueId, f])), [faab]);

  // Ranked free-agent pool per position, computed once (offense, on an NFL team, with a real projection).
  const pool = useMemo(() => {
    if (!pmap || !totals) return null;
    const out: { id: string; p: string; ppg: number }[] = [];
    for (const [id, t] of Object.entries(totals)) {
      const e = pmap[id];
      if (!e || !e.t || !["QB", "RB", "WR", "TE"].includes(e.p) || t.weeksCounted <= 0) continue;
      out.push({ id, p: e.p, ppg: t.pts / t.weeksCounted });
    }
    return out.sort((a, b) => b.ppg - a.ppg);
  }, [pmap, totals]);
  const ppg = (id: string) => {
    const t = totals?.[id];
    return t && t.weeksCounted > 0 ? t.pts / t.weeksCounted : 0;
  };

  const rows = useMemo(() => {
    if (!pool || !pmap) return [];
    return leagues.map((l) => {
      const taken = new Set(l.allRosteredPlayers);
      const best = pool.find((c) => !taken.has(c.id) && (pos === "ALL" || c.p === pos)) ?? null;
      const active = l.players.filter((id) => !l.reserve.includes(id));
      const open = l.rosterSize > 0 ? l.rosterSize - active.length : 0;
      // Suggested drop: your lowest-projected bench player (never a starter or someone on IR).
      const bench = active.filter((id) => !l.starters.includes(id) && pmap[id]);
      const drop = open > 0 ? null : bench.sort((a, b) => ppg(a) - ppg(b))[0] ?? null;
      const diff = best ? best.ppg - (drop ? ppg(drop) : 0) : null;
      const f = faabBy.get(l.leagueId);
      return { l, best, drop, open, diff, faabPct: f ? Math.round((f.remaining / f.budget) * 100) : null };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagues, pool, pmap, pos, faabBy]);

  const loadTend = async (leagueId: string) => {
    setOpen((o) => (o === leagueId ? null : leagueId));
    if (tend[leagueId]) return;
    setTend((t) => ({ ...t, [leagueId]: "loading" }));
    try {
      const r = await fetch(`/api/manager/waiver-tendency?leagueId=${leagueId}`);
      if (!r.ok) throw new Error();
      const b = (await r.json()) as Tendency;
      setTend((t) => ({ ...t, [leagueId]: b }));
    } catch {
      setTend((t) => ({ ...t, [leagueId]: "error" }));
    }
  };

  const upgrades = rows.filter((r) => r.diff != null && r.diff > 0.5).length;
  const openSpots = rows.reduce((s, r) => s + Math.max(0, r.open), 0);
  const faabAvg = (() => {
    const v = rows.map((r) => r.faabPct).filter((x): x is number => x != null);
    return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
  })();
  const mostCommon = (() => {
    const c = new Map<string, number>();
    for (const r of rows) if (r.best) c.set(r.best.id, (c.get(r.best.id) ?? 0) + 1);
    const top = [...c.entries()].sort((a, b) => b[1] - a[1])[0];
    return top ? { id: top[0], n: top[1] } : null;
  })();

  if (!pmap || !totals) return <p className="hint">Loading players and season projections…</p>;

  return (
    <section className="sec wb">
      <div className="wb-cards">
        <div><span>Worth a claim</span><b>{upgrades}</b><small>best available beats your weakest bench player by 0.5+ PPG</small></div>
        <div><span>Open roster spots</span><b>{openSpots}</b><small>across {rows.filter((r) => r.open > 0).length} leagues</small></div>
        <div><span>Avg FAAB remaining</span><b>{faabAvg == null ? "—" : `${faabAvg}%`}</b><small>FAAB leagues only</small></div>
        <div><span>Best available most often</span><b className="sm">{mostCommon ? pmap[mostCommon.id]?.n : "—"}</b><small>{mostCommon ? `top free agent in ${mostCommon.n} leagues` : ""}</small></div>
      </div>
      <div className="wb-bar">
        <span className="portmeta">Position</span>
        {POS.map((p) => (
          <button key={p} className={`chip-filter ${pos === p ? "on" : ""}`} onClick={() => setPos(p)}>{p === "ALL" ? "All" : p}</button>
        ))}
      </div>
      <div className="wb-table" role="table">
        <div className="wb-tr wb-th" role="row">
          <span>League</span><span>Open</span><span>FAAB</span><span>Best available</span><span>Suggested drop</span><span>Diff</span><span />
        </div>
        {rows
          .slice()
          .sort((a, b) => (b.diff ?? -99) - (a.diff ?? -99))
          .map((r) => (
            <Fragment key={r.l.leagueId}>
              <div className="wb-tr" role="row">
                <span className="wb-lg"><b>{r.l.leagueName}</b></span>
                <span className="num">{r.open > 0 ? r.open : r.open < 0 ? <em className="bad">over {-r.open}</em> : 0}</span>
                <span className={`num ${r.faabPct != null && r.faabPct < 25 ? "warn" : ""}`}>{r.faabPct == null ? "—" : `${r.faabPct}%`}</span>
                <span className="wb-pl">
                  {r.best ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={playerPhotoUrl(r.best.id)} alt="" loading="lazy" />
                      <span>
                        <b>{pmap[r.best.id]?.n}</b>
                        <small><i style={{ color: POS_COLOR[r.best.p] }}>{r.best.p}</i> {pmap[r.best.id]?.t} · {r.best.ppg.toFixed(1)} PPG{pmap[r.best.id]?.inj ? ` · ${pmap[r.best.id]?.inj}` : ""}</small>
                      </span>
                    </>
                  ) : (
                    <small>Nobody available</small>
                  )}
                </span>
                <span className="wb-pl">
                  {r.open > 0 ? (
                    <small className="good">Open spot — no drop</small>
                  ) : r.drop ? (
                    <span>
                      <b>{pmap[r.drop]?.n}</b>
                      <small><i style={{ color: POS_COLOR[pmap[r.drop]?.p ?? ""] }}>{pmap[r.drop]?.p}</i> {pmap[r.drop]?.t} · {ppg(r.drop).toFixed(1)} PPG</small>
                    </span>
                  ) : (
                    <small>No bench player to drop</small>
                  )}
                </span>
                <span className={`num ${r.diff != null && r.diff > 0 ? "good" : "bad"}`}>{r.diff == null ? "—" : `${r.diff > 0 ? "+" : ""}${r.diff.toFixed(1)}`}</span>
                <span className="wb-acts">
                  <Link className="wb-claim" href={`/manager/waiver?leagueId=${r.l.leagueId}`}>Claim</Link>
                  <button className="wb-view" onClick={() => void loadTend(r.l.leagueId)} aria-expanded={open === r.l.leagueId}>Bidding</button>
                </span>
              </div>
              {open === r.l.leagueId && <TendencyRow t={tend[r.l.leagueId]} />}
            </Fragment>
          ))}
      </div>
      <p className="hint">
        Best available = highest Sleeper season projection per game among players no team rosters in that league (as of the
        last sync). Claim opens Mass add for that league, which re-checks Sleeper live and suggests a FAAB bid from the
        league&rsquo;s own history before anything is sent.
      </p>
    </section>
  );
}

function TendencyRow({ t }: { t: Tendency | "loading" | "error" | undefined }) {
  if (!t || t === "loading") return <div className="wb-tend"><p className="hint">Loading this league&rsquo;s bidding history…</p></div>;
  if (t === "error") return <div className="wb-tend"><p className="hint" style={{ color: "var(--red)" }}>Couldn&rsquo;t load bidding history.</p></div>;
  if (!t.budget) return <div className="wb-tend"><p className="hint">Not a FAAB league — no bids to analyse.</p></div>;
  if (!t.claims) return <div className="wb-tend"><p className="hint">No completed FAAB claims synced for this league yet.</p></div>;
  return (
    <div className="wb-tend">
      <div className="wb-tcards">
        <div className="a"><span>Avg winning bid</span><b>{Math.round(t.avgPct ?? 0)}%</b></div>
        <div className="b"><span>Active bidders</span><b>{t.bidders}/{t.teams}</b></div>
        <div className="c"><span>Claims / week</span><b>{(t.perWeek ?? 0).toFixed(1)}</b></div>
        <div className="d"><span>Highest bid</span><b>{Math.round(t.maxPct ?? 0)}%</b></div>
      </div>
      <div className="wb-mgrs">
        {t.managers.map((m) => (
          <div key={m.name}>
            <span className="nm">{m.name}</span>
            <span className={`st ${m.style.toLowerCase()}`}>{m.style}</span>
            <span>avg {Math.round(m.avgPct)}%</span>
            <span>peak {Math.round(m.maxPct)}%</span>
            <span>{m.claims} claim{m.claims === 1 ? "" : "s"}</span>
          </div>
        ))}
      </div>
      <p className="hint">Bids as % of the ${t.budget} budget, from {t.claims} completed claims over {t.weeks} week{t.weeks === 1 ? "" : "s"}. Style: 25%+ average = aggressive, 8–25% = balanced, under 8% = conservative.</p>
    </div>
  );
}
