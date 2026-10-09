"use client";

/*
 * THESIS: a fantasy week is a calendar of locks — sort every decision into the moment it stops being changeable
 *   (waivers, Thursday, Sunday early, Sunday late, Monday) — instead of a dashboard that treats all problems as now.
 * OWN-WORLD: cool light planner paper, ink-dark text, hairline day columns, one game-time orange for "next lock" and
 *   the primary action only; Hanken Grotesk; cards are flat tiles with a 1px edge; a right-hand sheet for detail.
 * STORY: the owner sees how many decisions remain before each kickoff, clears the leftmost column first, and opens any
 *   card to see that league's lineup with the problem highlighted.
 * FIRST VIEWPORT: one-line header with week and next lock; five day columns filling the width; the current column marked.
 * FORM: grounded candidate 4 (week planner of kickoff locks), seed 0a1ed833.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ProtoData, ProtoLeague } from "@/lib/protoData";
import { usePlayerMap } from "@/lib/usePlayerMap";
import { getWeekKickoffs } from "@/lib/espnGames";
import { kickoffSlot, type KickoffSlot } from "@/lib/kickoffSlot";
import { playerPhotoUrl } from "@/lib/sleeper";
import { formatPacific } from "@/lib/waiverSchedule";
import "./week.css";

type Col = "WAIVERS" | "THU" | "WKND" | "SUN_EARLY" | "SUN_LATE" | "MON";
const COLS: { id: Col; label: string; sub: string }[] = [
  { id: "WAIVERS", label: "Waivers", sub: "Before claims run" },
  { id: "THU", label: "Thursday", sub: "Locks first" },
  { id: "WKND", label: "Fri · Sat", sub: "Odd-day games" },
  { id: "SUN_EARLY", label: "Sunday early", sub: "10:00 AM PT" },
  { id: "SUN_LATE", label: "Sunday late", sub: "1:05 PM PT and night" },
  { id: "MON", label: "Monday", sub: "Locks last" },
];
const toCol = (s: KickoffSlot | undefined): Col => (s === "THU" ? "THU" : s === "FRI" || s === "SAT" ? "WKND" : s === "SUN_LATE" ? "SUN_LATE" : s === "MON" ? "MON" : "SUN_EARLY");

interface Card {
  key: string;
  col: Col;
  league: ProtoLeague;
  playerId: string | null;
  title: string;
  kind: "injured" | "bye" | "empty" | "open" | "over";
  at: string | null;
}

const KIND_LABEL: Record<Card["kind"], string> = { injured: "Injured starter", bye: "Bye-week starter", empty: "Empty slot", open: "Open roster spot", over: "Over the limit" };

export default function ProtoWeek({ data }: { data: ProtoData }) {
  const { pmap } = usePlayerMap();
  const week = Math.max(0, ...data.leagues.map((l) => l.week ?? 0)) || 1;
  const [kick, setKick] = useState<Record<string, string> | null>(null);
  const [kickErr, setKickErr] = useState(false);
  useEffect(() => {
    let alive = true;
    getWeekKickoffs(data.season, week)
      .then((k) => alive && setKick(k))
      .catch(() => alive && setKickErr(true));
    return () => {
      alive = false;
    };
  }, [data.season, week]);
  const [open, setOpen] = useState<Card | null>(null);
  const [now] = useState(() => Date.now());

  const byId = useMemo(() => new Map(data.leagues.map((l) => [l.id, l])), [data.leagues]);
  const nextLock = useMemo(() => {
    const times = Object.values(kick ?? {}).map((t) => Date.parse(t)).filter((t) => t > now).sort((a, b) => a - b);
    return times[0] ? new Date(times[0]) : null;
  }, [kick, now]);
  const nextCol: Col | null = nextLock ? toCol(kickoffSlot(nextLock.toISOString())) : null;
  const cards = useMemo(() => {
    const out: Card[] = [];
    // A player with no game this week (bye) has no lock of his own — it belongs with the next lock coming up.
    const slotOf = (pid: string | null) => {
      const team = pid ? pmap?.[pid]?.t : undefined;
      const iso = team ? kick?.[team] : undefined;
      return iso ? { col: toCol(kickoffSlot(iso)), at: iso } : { col: nextCol ?? "THU", at: nextLock?.toISOString() ?? null };
    };
    for (const a of data.alerts) {
      const league = byId.get(a.leagueId);
      if (!league || league.bestBall) continue;
      if (a.type === "injured_starter" || a.type === "bye_starter") {
        const s = slotOf(a.playerId);
        out.push({ key: a.id, col: s.col, at: s.at, league, playerId: a.playerId, title: a.message, kind: a.type === "bye_starter" ? "bye" : "injured" });
      }
    }
    for (const l of data.leagues) {
      if (l.bestBall) continue;
      if (l.emptySlots > 0) out.push({ key: `e${l.id}`, col: "THU", at: null, league: l, playerId: null, title: `${l.emptySlots} empty starting slot${l.emptySlots > 1 ? "s" : ""}`, kind: "empty" });
      if (l.openSpots < 0) out.push({ key: `o${l.id}`, col: "WAIVERS", at: l.waiverAt, league: l, playerId: null, title: `Roster ${-l.openSpots} over the limit`, kind: "over" });
    }
    return out;
  }, [data.alerts, data.leagues, byId, pmap, kick, nextCol, nextLock]);

  const openSpots = data.leagues.filter((l) => !l.bestBall && l.openSpots > 0);
  const waiverGroups = useMemo(() => {
    const m = new Map<string, ProtoLeague[]>();
    for (const l of data.leagues) {
      if (l.bestBall || !l.waiverAt) continue;
      (m.get(l.waiverAt) ?? m.set(l.waiverAt, []).get(l.waiverAt)!).push(l);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data.leagues]);

  const colCards = (c: Col) => cards.filter((x) => x.col === c);

  return (
    <div className="wk">
      <header className="wk-top">
        <Link href="/proto" className="wk-brand">Fantis</Link>
        <div className="wk-week">
          <b>Week {week}</b>
          <span>
            {cards.length} decision{cards.length === 1 ? "" : "s"}
            {nextLock ? <> · next lock {formatPacific(nextLock)}</> : kickErr ? " · game times unavailable" : ""}
          </span>
        </div>
        <nav className="wk-nav" aria-label="Tools">
          <Link href="/manager/lineups">Lineups</Link>
          <Link href="/manager/open-spots">Roster spots</Link>
          <Link href="/manager/waiver">Waivers</Link>
          <Link href="/manager/teams">Leagues</Link>
          <Link href="/manager/review">Review</Link>
        </nav>
      </header>

      <main className="wk-board" aria-label={`Week ${week} by lock time`}>
        {COLS.map((c) => {
          const list = colCards(c.id);
          const isWaivers = c.id === "WAIVERS";
          if (c.id === "WKND" && list.length === 0) return null;
          const count = list.length + (isWaivers ? openSpots.length : 0);
          return (
            <section key={c.id} className={`wk-col${nextCol === c.id ? " next" : ""}`} aria-label={c.label}>
              <header>
                <h2>{c.label}</h2>
                <span className="wk-count">{count}</span>
                <p>{nextCol === c.id ? "Next to lock" : c.sub}</p>
              </header>
              <div className="wk-cards">
                {isWaivers && (
                  <>
                    {openSpots.length > 0 && (
                      <Link className="wk-tile" href="/manager/open-spots">
                        <b>{openSpots.length} leagues</b>
                        <span>have an open roster spot to fill before claims run</span>
                      </Link>
                    )}
                    {waiverGroups.map(([at, ls]) => (
                      <div key={at} className="wk-run">
                        <span>{formatPacific(new Date(at))}</span>
                        <b>{ls.length} league{ls.length === 1 ? "" : "s"} process{ls.length === 1 ? "es" : ""}</b>
                      </div>
                    ))}
                  </>
                )}
                {list.map((x) => {
                  const p = x.playerId ? pmap?.[x.playerId] : undefined;
                  return (
                    <button key={x.key} className={`wk-card k-${x.kind}${open?.key === x.key ? " on" : ""}`} onClick={() => setOpen(x)}>
                      {x.playerId ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={playerPhotoUrl(x.playerId)} alt="" loading="lazy" />
                      ) : (
                        <span className="wk-glyph" aria-hidden>{x.kind === "empty" ? "–" : "!"}</span>
                      )}
                      <span className="wk-txt">
                        <b>{p ? p.n : KIND_LABEL[x.kind]}</b>
                        <span>{p ? `${p.p} · ${p.t}${p.inj ? ` · ${p.inj}` : ""}` : x.title}</span>
                        <small>{x.league.name}</small>
                      </span>
                    </button>
                  );
                })}
                {count === 0 && <p className="wk-empty">Nothing to decide here.</p>}
              </div>
            </section>
          );
        })}
      </main>

      <div className={`wk-sheet${open ? " open" : ""}`} role="dialog" aria-label="Decision detail" aria-hidden={!open}>
        {open && (
          <>
            <div className="wk-sheet-h">
              <span>{KIND_LABEL[open.kind]}</span>
              <button onClick={() => setOpen(null)} aria-label="Close">Close</button>
            </div>
            <h3>{open.title}</h3>
            <Link className="wk-lg" href={`/manager/${open.league.id}`}>{open.league.name}</Link>
            {open.at && <p className="wk-lock">Locks {formatPacific(new Date(open.at))}</p>}
            <h4>Starting lineup</h4>
            <ol className="wk-lineup">
              {open.league.starters.map((id, i) => {
                const p = id && id !== "0" ? pmap?.[id] : undefined;
                const hit = id === open.playerId || (open.kind === "empty" && (!id || id === "0"));
                return (
                  <li key={i} className={hit ? "hit" : ""}>
                    <span className="slot">{(open.league.slots[i] ?? "").replace("SUPER_FLEX", "SFLX").replace("REC_FLEX", "WR/TE")}</span>
                    <span className="nm">{p ? p.n : id && id !== "0" ? id : "Empty"}</span>
                    <span className="meta">{p ? `${p.t}${p.inj ? ` · ${p.inj}` : ""}` : ""}</span>
                  </li>
                );
              })}
            </ol>
            <p className="wk-bench">Bench: {open.league.bench.map((id) => pmap?.[id]?.n ?? id).join(", ") || "—"}</p>
            <div className="wk-acts">
              <Link className="wk-primary" href="/manager/lineups">Fix in Lineups</Link>
              <Link className="wk-ghost" href={`/manager/${open.league.id}`}>Open league</Link>
            </div>
          </>
        )}
      </div>
      {open && <button className="wk-scrim" aria-label="Close detail" onClick={() => setOpen(null)} />}
      <p className="wk-foot">Prototype E · real data from your last sync · nothing here changes Sleeper · <Link href="/proto">all prototypes</Link></p>
    </div>
  );
}
