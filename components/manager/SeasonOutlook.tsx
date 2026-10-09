"use client";

import { useEffect, useMemo, useState } from "react";
import type { ManagedLeague, ManagedRoster } from "@/lib/manager";
import type { LeagueRosterRow } from "@/lib/leagueRank";
import { getMatchups, getState } from "@/lib/sleeper";
import { usePlayerMap } from "@/lib/usePlayerMap";
import { useSeasonTotals } from "@/lib/useDropCandidates";
import { BYE_WEEKS_2026 } from "@/lib/byeWeeks";
import { bestLineup, simulateSeason, type FcTeam } from "@/lib/seasonForecast";
import { winProb, outlook, OUTLOOK_LABEL } from "@/lib/winProb";

// My Team: season forecast, the schedule ahead with a win chance per week, and a bye-week planner (StatChasers' Team
// Hub). Real schedule from Sleeper, real rosters and records, Sleeper's season projection per game; the method and its
// simplifications are in lib/seasonForecast.ts and shown under each section.
const OUT_NOW = /^(out|ir|pup|sus|doubtful)/i;

function inner(settings: unknown, key: string): number | null {
  const s = settings as Record<string, unknown> | null;
  const i = s && typeof s.settings === "object" && s.settings ? (s.settings as Record<string, unknown>) : null;
  const v = i?.[key];
  return typeof v === "number" ? v : null;
}

export default function SeasonOutlook({
  league,
  roster,
  leagueRosters,
  rosterPositions,
}: {
  league: ManagedLeague;
  roster: ManagedRoster | null;
  leagueRosters: LeagueRosterRow[];
  rosterPositions: string[];
}) {
  const { pmap } = usePlayerMap();
  const totals = useSeasonTotals();
  const [week, setWeek] = useState<number | null>(null);
  const [schedule, setSchedule] = useState<Record<number, [number, number][]> | null>(null);
  const [err, setErr] = useState("");
  const playoffTeams = inner(league.settings, "playoff_teams") ?? 6;
  const lastRegular = (inner(league.settings, "playoff_week_start") ?? 15) - 1;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const st = await getState();
        const cur = Math.max(1, st.week || 1);
        if (!alive) return;
        setWeek(cur);
        const weeks = Array.from({ length: Math.max(0, lastRegular - cur + 1) }, (_, i) => cur + i);
        const res = await Promise.all(weeks.map((w) => getMatchups(league.id, w).then((rows) => [w, rows] as const).catch(() => [w, null] as const)));
        const out: Record<number, [number, number][]> = {};
        for (const [w, rows] of res) {
          if (!rows) continue;
          const byM = new Map<number, number[]>();
          for (const r of rows as { roster_id: number; matchup_id: number | null }[]) {
            if (r.matchup_id == null) continue;
            byM.set(r.matchup_id, [...(byM.get(r.matchup_id) ?? []), r.roster_id]);
          }
          out[w] = [...byM.values()].filter((p) => p.length === 2).map((p) => [p[0], p[1]] as [number, number]);
        }
        if (alive) setSchedule(out);
      } catch {
        if (alive) setErr("Couldn't load the schedule from Sleeper.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [league.id, lastRegular]);

  const slots = useMemo(() => rosterPositions.filter((s) => s !== "BN" && s !== "IR" && s !== "TAXI"), [rosterPositions]);
  const model = useMemo(() => {
    if (!pmap || !totals || !schedule || week == null || !roster) return null;
    const ppg = (id: string) => {
      const t = totals[id];
      return t && t.weeksCounted > 0 ? t.pts / t.weeksCounted : 0;
    };
    const pos = (id: string) => pmap[id]?.p;
    const avail = (w: number) => (id: string) => {
      const p = pmap[id];
      if (!p) return false;
      if (BYE_WEEKS_2026[p.t] === w) return false;
      if (w === week && p.inj && OUT_NOW.test(p.inj)) return false;
      return true;
    };
    const teams: FcTeam[] = leagueRosters.map((t) => ({ rosterId: t.rosterId, name: t.teamName ?? `Team ${t.rosterId}`, players: t.players, wins: t.wins ?? 0, losses: t.losses ?? 0, ties: t.ties ?? 0, pf: t.fpts ?? 0 }));
    const byId = new Map(teams.map((t) => [t.rosterId, t]));
    const cache = new Map<string, number>();
    const proj = (rid: number, w: number) => {
      const k = `${rid}:${w}`;
      if (!cache.has(k)) cache.set(k, bestLineup(byId.get(rid)?.players ?? [], slots, ppg, pos, avail(w)).points);
      return cache.get(k)!;
    };
    const sim = simulateSeason({ teams, schedule, proj, playoffTeams });
    const me = roster.rosterId;
    const weeks = Object.keys(schedule).map(Number).sort((a, b) => a - b);
    const strip = weeks.map((w) => {
      const pair = schedule[w].find((p) => p.includes(me));
      const opp = pair ? (pair[0] === me ? pair[1] : pair[0]) : null;
      const mine = proj(me, w);
      const theirs = opp != null ? proj(opp, w) : null;
      return { w, opp: opp != null ? byId.get(opp)?.name ?? `Team ${opp}` : null, mine, theirs, p: theirs != null ? winProb(mine, theirs) : null };
    });
    // Bye planner: my best healthy lineup, then week by week which of those starters are on bye and who could cover.
    const myPlayers = roster.players.filter((id) => !roster.reserve.includes(id));
    const core = bestLineup(myPlayers, slots, ppg, pos, (id) => !!pmap[id]).ids;
    const byes = weeks
      .map((w) => {
        const out = core.filter((id) => BYE_WEEKS_2026[pmap[id]?.t ?? ""] === w);
        const bench = myPlayers.filter((id) => !core.includes(id) && BYE_WEEKS_2026[pmap[id]?.t ?? ""] !== w);
        const cover = out.map((id) => ({ id, by: bench.filter((b) => pmap[b]?.p === pmap[id]?.p).sort((a, b) => ppg(b) - ppg(a))[0] ?? null }));
        return { w, out, cover };
      })
      .filter((b) => b.out.length > 0);
    return { sim: sim.get(me) ?? null, strip, byes, ppg, teams: teams.length };
  }, [pmap, totals, schedule, week, roster, leagueRosters, slots, playoffTeams]);

  if (!roster) return null;
  if (err) return <p className="hint">{err}</p>;
  if (!model) return <section className="sec so"><p className="hint">Building your season forecast…</p></section>;
  const s = model.sim;
  const byeSpots = playoffTeams === 6 ? 2 : 0;

  return (
    <>
      <section className="sec so">
        <h2 className="so-h">Season forecast</h2>
        <div className="so-grid">
          <div className="so-card"><span>Projected record</span><b>{s ? `${s.expWins.toFixed(1)}–${s.expLosses.toFixed(1)}` : "—"}</b></div>
          <div className="so-card"><span>Projected finish</span><b>{s ? `#${Math.round(s.avgFinish)}` : "—"}</b><small>of {model.teams}</small></div>
          <div className="so-bars">
            <Bar label={`Make playoffs (top ${playoffTeams})`} p={s?.playoffPct ?? 0} cls="g" />
            {byeSpots > 0 && <Bar label="Earn a first-round bye" p={s?.byePct ?? 0} cls="b" />}
          </div>
        </div>
        <p className="hint">
          From {model.strip.length} remaining regular-season week{model.strip.length === 1 ? "" : "s"}, every team&rsquo;s best lineup by
          Sleeper&rsquo;s projection per game (bye weeks removed; this week&rsquo;s Out/IR players too), and 4,000 simulated seasons —
          an estimate that assumes no trades, pickups or new injuries.
        </p>
      </section>

      <section className="sec so">
        <h2 className="so-h">Schedule</h2>
        <div className="so-strip">
          {model.strip.map((g) => {
            const o = g.p != null ? outlook(g.p) : null;
            return (
              <div key={g.w} className={`so-wk ${o ?? ""} ${g.w === week ? "now" : ""}`}>
                <span className="w">Wk {g.w}</span>
                <b className="opp" title={g.opp ?? ""}>{g.opp ?? "—"}</b>
                <span className="p">{g.p == null ? "—" : `${Math.round(g.p * 100)}%`}</span>
                <small>{g.theirs != null ? `${g.mine.toFixed(0)}–${g.theirs.toFixed(0)}` : ""}</small>
                {o && <i>{OUTLOOK_LABEL[o]}</i>}
              </div>
            );
          })}
        </div>
      </section>

      <section className="sec so">
        <h2 className="so-h">Bye-week planner</h2>
        {model.byes.length === 0 ? (
          <p className="hint">None of your likely starters has a bye in the remaining regular season.</p>
        ) : (
          <div className="so-byes">
            {model.byes.map((b) => {
              const uncovered = b.cover.filter((c) => !c.by).length;
              const sev = b.out.length >= 2 ? (uncovered ? "high" : "mod") : uncovered ? "mod" : "ok";
              return (
                <div key={b.w} className={`so-bye ${sev}`}>
                  <div className="h">
                    <b>Week {b.w}</b>
                    <span>{sev === "high" ? "High" : sev === "mod" ? "Moderate" : "Covered"} · {b.out.length} starter{b.out.length > 1 ? "s" : ""} on bye</span>
                  </div>
                  {b.cover.map((c) => (
                    <div key={c.id} className="r">
                      <span>{pmap?.[c.id]?.n} <small>{pmap?.[c.id]?.p} · {pmap?.[c.id]?.t}</small></span>
                      <span className={c.by ? "cov" : "no"}>{c.by ? `→ ${pmap?.[c.by]?.n} (${model.ppg(c.by).toFixed(1)} PPG)` : "no bench player at this position"}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

function Bar({ label, p, cls }: { label: string; p: number; cls: string }) {
  return (
    <div className={`so-bar ${cls}`}>
      <div><span>{label}</span><b>{Math.round(p * 100)}%</b></div>
      <i><em style={{ width: `${Math.round(p * 100)}%` }} /></i>
    </div>
  );
}
