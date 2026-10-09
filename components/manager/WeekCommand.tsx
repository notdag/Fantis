"use client";

/*
 * THESIS: one command surface where the week is the home screen — decisions laid out by when they lock — and working
 *   through them is a triage flow, inside a familiar console shell (league switcher, top menu, view switch).
 * OWN-WORLD: StatChasers-like dark console (navy-graphite ground, hairline rows, amber underline for the active place),
 *   calmer: no glows; one amber accent for "next lock" and primary actions, red/amber/green only for status; Manrope.
 * STORY: open → see how many decisions remain before each lock → click one (or press J) → fix it from the focus panel
 *   → Next until the week is clear; Portfolio for the big picture.
 * FIRST VIEWPORT: top bar + menu; title "This week" with the Week / Triage / Portfolio switch; a four-number strip;
 *   the lock columns.
 * FORM: user-directed combination of prototypes A (StatChasers shell), D (Triage) and E (This Week).
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProtoData, ProtoLeague } from "@/lib/protoData";
import { usePlayerMap } from "@/lib/usePlayerMap";
import { getWeekKickoffs } from "@/lib/espnGames";
import { kickoffSlot, type KickoffSlot } from "@/lib/kickoffSlot";
import { playerPhotoUrl } from "@/lib/sleeper";
import { formatPacific } from "@/lib/waiverSchedule";
import "@/components/proto/combo.css";
import ExposureMap from "./ExposureMap";
import WinChances from "./WinChances";
import { winProb } from "@/lib/winProb";

type View = "week" | "triage" | "matchups" | "portfolio";
type Col = "WAIVERS" | "THU" | "WKND" | "SUN_EARLY" | "SUN_LATE" | "MON";
type Kind = "empty" | "injured" | "bye" | "over" | "open" | "other";
interface Item {
  key: string;
  kind: Kind;
  col: Col;
  at: string | null;
  league: ProtoLeague;
  playerId: string | null;
  title: string;
  fix: { label: string; href: string };
}

const COLS: { id: Col; label: string; sub: string }[] = [
  { id: "WAIVERS", label: "Waivers", sub: "Before claims run" },
  { id: "THU", label: "Thursday", sub: "Locks first" },
  { id: "WKND", label: "Fri · Sat", sub: "Odd-day games" },
  { id: "SUN_EARLY", label: "Sunday early", sub: "10:00 AM PT" },
  { id: "SUN_LATE", label: "Sunday late", sub: "1:05 PM PT and night" },
  { id: "MON", label: "Monday", sub: "Locks last" },
];
const COL_ORDER = COLS.map((c) => c.id);
const KIND: Record<Kind, string> = {
  empty: "Empty starting slot",
  injured: "Injured starter",
  bye: "Bye-week starter",
  over: "Over the roster limit",
  open: "Open roster spot",
  other: "Other alerts",
};
const KIND_ORDER: Kind[] = ["empty", "injured", "bye", "over", "open", "other"];
const toCol = (s: KickoffSlot | undefined): Col => (s === "THU" ? "THU" : s === "FRI" || s === "SAT" ? "WKND" : s === "SUN_LATE" ? "SUN_LATE" : s === "MON" ? "MON" : "SUN_EARLY");


function Ic({ d, s = 16 }: { d: string; s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
const IC = {
  chev: "M6 9l6 6 6-6",
  cal: "M4 6h16v14H4zM4 10h16M9 3v4M15 3v4",
  inbox: "M4 13l2.5-7h11L20 13M4 13v6h16v-6M4 13h4l1.5 2.5h5L16 13h4",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  sync: "M21 12a9 9 0 0 1-15.5 6.3L3 16M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M3 21v-5h5",
  x: "M6 6l12 12M18 6L6 18",
};

// The Command Center home (from prototype G): the week laid out by lock time, a triage queue to work through it, and a
// portfolio view. Read-only — every fix links to the existing tools.
export default function WeekCommand({ data, portfolioExtra }: { data: ProtoData; portfolioExtra?: React.ReactNode }) {
  const { pmap } = usePlayerMap();
  const [view, setView] = useState<View>("week");
  const [now] = useState(() => Date.now());
  const week = Math.max(0, ...data.leagues.map((l) => l.week ?? 0)) || 1;
  const [kick, setKick] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    let alive = true;
    getWeekKickoffs(data.season, week).then((k) => alive && setKick(k)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [data.season, week]);

  const active = useMemo(() => data.leagues.filter((l) => !l.bestBall), [data.leagues]);
  const byId = useMemo(() => new Map(data.leagues.map((l) => [l.id, l])), [data.leagues]);
  const nextLock = useMemo(() => {
    const t = Object.values(kick ?? {}).map(Date.parse).filter((x) => x > now).sort((a, b) => a - b)[0];
    return t ? new Date(t) : null;
  }, [kick, now]);
  const nextCol: Col | null = nextLock ? toCol(kickoffSlot(nextLock.toISOString())) : null;

  // One list of decisions, ordered the way the week unfolds; the board, the triage queue and Next/Prev all walk it.
  const items = useMemo(() => {
    const out: Item[] = [];
    const lockOf = (pid: string | null) => {
      const iso = pid ? kick?.[pmap?.[pid]?.t ?? ""] : undefined;
      return iso ? { col: toCol(kickoffSlot(iso)), at: iso } : { col: nextCol ?? ("THU" as Col), at: nextLock?.toISOString() ?? null };
    };
    const seenEmpty = new Set<string>();
    for (const a of data.alerts) {
      const l = byId.get(a.leagueId);
      if (!l || l.bestBall) continue;
      const kind: Kind = a.type === "injured_starter" ? "injured" : a.type === "bye_starter" ? "bye" : a.type === "empty_slot" ? "empty" : "other";
      if (kind === "empty") seenEmpty.add(l.id);
      const lk = kind === "other" ? { col: "WAIVERS" as Col, at: null } : lockOf(a.playerId);
      out.push({ key: a.id, kind, col: lk.col, at: lk.at, league: l, playerId: a.playerId, title: a.message, fix: kind === "other" ? { label: "Open league", href: `/manager/${l.id}` } : { label: "Fix the lineup", href: "/manager/lineups" } });
    }
    for (const l of active) {
      if (l.emptySlots > 0 && !seenEmpty.has(l.id))
        out.push({ key: `e${l.id}`, kind: "empty", col: nextCol ?? "THU", at: nextLock?.toISOString() ?? null, league: l, playerId: null, title: `${l.emptySlots} empty starting slot${l.emptySlots > 1 ? "s" : ""}`, fix: { label: "Fix the lineup", href: "/manager/lineups" } });
      if (l.openSpots < 0) out.push({ key: `o${l.id}`, kind: "over", col: "WAIVERS", at: l.waiverAt, league: l, playerId: null, title: `Roster is ${-l.openSpots} over the limit`, fix: { label: "Open league", href: `/manager/${l.id}` } });
      if (l.openSpots > 0) out.push({ key: `s${l.id}`, kind: "open", col: "WAIVERS", at: l.waiverAt, league: l, playerId: null, title: `${l.openSpots} open roster spot${l.openSpots > 1 ? "s" : ""}`, fix: { label: "Fill the spot", href: "/manager/open-spots" } });
    }
    // Lineup fixes first, in the order they lock; roster-room items (open spots) after, since they don't lock a lineup.
    const late = (i: Item) => (i.kind === "open" || i.kind === "other" ? 1 : 0);
    return out.sort((a, b) => late(a) - late(b) || COL_ORDER.indexOf(a.col) - COL_ORDER.indexOf(b.col) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.league.name.localeCompare(b.league.name, undefined, { numeric: true }));
  }, [data.alerts, active, byId, pmap, kick, nextCol, nextLock]);

  const [done, setDone] = useState<Set<string>>(new Set());
  const queue = useMemo(() => items.filter((i) => !done.has(i.key) && i.kind !== "other"), [items, done]);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const focus = queue.find((i) => i.key === focusKey) ?? (view === "triage" ? queue[0] : null) ?? null;
  const idx = focus ? queue.indexOf(focus) : -1;

  const step = useCallback(
    (d: number) => {
      if (!queue.length) return;
      const n = queue[(Math.max(0, idx) + d + queue.length) % queue.length];
      setFocusKey(n.key);
      if (view === "week") setSheet(true);
    },
    [queue, idx, view]
  );
  const markDone = useCallback(() => {
    if (!focus) return;
    const next = queue[idx + 1] ?? queue[idx - 1] ?? null;
    setDone((s) => new Set(s).add(focus.key));
    setFocusKey(next?.key ?? null);
    if (!next) setSheet(false);
  }, [focus, queue, idx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j") {
        e.preventDefault();
        step(1);
      } else if (e.key === "k") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "e") {
        e.preventDefault();
        markDone();
      } else if (e.key === "Escape") {
        setSheet(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, markDone]);

  const openItem = (i: Item) => {
    setFocusKey(i.key);
    if (view === "week") setSheet(true);
  };

  const rec = active.reduce((a, l) => [a[0] + l.wins, a[1] + l.losses], [0, 0]);
  const probs = active.map((l) => winProb(l.myProj, l.oppProj)).filter((p): p is number => p != null);
  const expectedWins = probs.length ? probs.reduce((a, p) => a + p, 0) : null;
  const openCount = active.filter((l) => l.openSpots > 0).length;
  const lineupCount = queue.filter((i) => i.kind !== "open").length;

  const renderFocus = (item: Item, compact?: boolean) => {
    const p = item.playerId ? pmap?.[item.playerId] : undefined;
    const l = item.league;
    return (
      <div className="cb-focus" key={item.key}>
        <p className="cb-pos">
          {KIND[item.kind]} · {idx + 1} of {queue.length}
          {item.at && <> · locks {formatPacific(new Date(item.at))}</>}
        </p>
        <Link className="cb-lg" href={`/manager/${l.id}`}>{l.name}</Link>
        <div className="cb-headline">
          {item.playerId && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={playerPhotoUrl(item.playerId)} alt="" />
          )}
          <h2>{item.title}</h2>
        </div>
        {p && <p className="cb-sub">{p.p} · {p.t}{p.inj ? ` · ${p.inj}` : ""}</p>}
        <dl className={`cb-facts${compact ? " c" : ""}`}>
          <div><dt>Record</dt><dd>{l.wins}–{l.losses}{l.ties ? `–${l.ties}` : ""}</dd></div>
          <div><dt>Standing</dt><dd>{l.rank ? `${l.rank} of ${l.teams}` : "—"}</dd></div>
          <div><dt>Opponent</dt><dd>{l.oppName ?? "—"}</dd></div>
          <div><dt>Roster</dt><dd>{l.openSpots > 0 ? `${l.openSpots} open` : l.openSpots < 0 ? `${-l.openSpots} over` : "full"}</dd></div>
          <div><dt>IR</dt><dd>{l.irTotal ? `${l.irUsed} of ${l.irTotal}` : "none"}</dd></div>
          <div><dt>FAAB</dt><dd>{l.faabLeft == null ? "—" : `$${l.faabLeft}`}</dd></div>
        </dl>
        {(item.kind === "injured" || item.kind === "bye" || item.kind === "empty") && (
          <ol className="cb-lineup">
            {l.starters.map((id, i) => {
              const sp = id && id !== "0" ? pmap?.[id] : undefined;
              const hit = id === item.playerId || (item.kind === "empty" && (!id || id === "0"));
              return (
                <li key={i} className={hit ? "hit" : ""}>
                  <span className="slot">{(l.slots[i] ?? "").replace("SUPER_FLEX", "SF").replace("REC_FLEX", "W/T")}</span>
                  <span className="nm">{sp ? sp.n : id && id !== "0" ? "…" : "Empty"}</span>
                  <span className="meta">{sp ? `${sp.t}${sp.inj ? ` · ${sp.inj}` : ""}` : ""}</span>
                </li>
              );
            })}
          </ol>
        )}
        <div className="cb-acts">
          <Link className="cb-primary" href={item.fix.href}>{item.fix.label}</Link>
          <button className="cb-ghost" onClick={markDone}>Mark done <kbd>E</kbd></button>
          <button className="cb-ghost" onClick={() => step(1)}>Next <kbd>J</kbd></button>
        </div>
        <p className="cb-small">Mark done only clears it here; the next sync checks it again.</p>
      </div>
    );
  };

  return (
    <div className="cb cb-embed">

      <main className="cb-main">
        <div className="cb-head">
          <div>
            <h1>{view === "portfolio" ? "My portfolio" : `Week ${week}`}</h1>
            <p>
              {view === "portfolio"
                ? `${active.length} in-season leagues, best ball left out.`
                : `${queue.length} decision${queue.length === 1 ? "" : "s"} left${nextLock ? ` · next lock ${formatPacific(nextLock)}` : ""}.`}
            </p>
          </div>
          <div className="cb-seg" role="tablist" aria-label="View">
            {(
              [
                ["week", "This week", IC.cal],
                ["triage", `Triage · ${queue.length}`, IC.inbox],
                ["matchups", "Win chances", IC.chart],
                ["portfolio", "Portfolio", IC.grid],
              ] as [View, string, string][]
            ).map(([k, label, d]) => (
              <button key={k} role="tab" aria-selected={view === k} className={view === k ? "on" : ""} onClick={() => (setView(k), setSheet(false))}>
                <Ic d={d} s={15} /> {label}
              </button>
            ))}
          </div>
        </div>

        <dl className="cb-strip">
          <div><dt>Lineup fixes</dt><dd className={lineupCount ? "warn" : ""}>{lineupCount}</dd></div>
          <div><dt>Next lock</dt><dd>{nextLock ? formatPacific(nextLock) : "—"}</dd></div>
          <div><dt>Open roster spots</dt><dd>{openCount}</dd></div>
          <div><dt>Season record</dt><dd>{rec[0]}–{rec[1]}</dd></div>
          <div><dt>Plans to review</dt><dd>{data.plansWaiting}</dd></div>
          <div><dt>Expected wins</dt><dd>{expectedWins == null ? "—" : expectedWins.toFixed(1)}</dd></div>
        </dl>

        {view === "week" && (!kick || !pmap) && (
          <div className="cb-board" aria-busy="true" aria-label="Loading game times">
            {COLS.filter((c) => c.id !== "WKND").map((c) => (
              <section key={c.id} className="cb-col">
                <header><h3>{c.label}</h3><p>{c.sub}</p></header>
                <span className="cb-skel" /><span className="cb-skel" /><span className="cb-skel" />
              </section>
            ))}
          </div>
        )}
        {view === "week" && kick && pmap && (
          <div className="cb-board" aria-label="Decisions by lock time">
            {COLS.map((c) => {
              const list = queue.filter((i) => i.col === c.id && i.kind !== "open");
              const opens = c.id === "WAIVERS" ? queue.filter((i) => i.kind === "open") : [];
              if (c.id === "WKND" && list.length === 0) return null;
              return (
                <section key={c.id} className={`cb-col${nextCol === c.id ? " next" : ""}`} aria-label={c.label}>
                  <header>
                    <h3>{c.label}</h3>
                    <span>{list.length + opens.length}</span>
                    <p>{nextCol === c.id ? "Next to lock" : c.sub}</p>
                  </header>
                  {opens.length > 0 && (
                    <button className="cb-tile" onClick={() => openItem(opens[0])}>
                      <b>{opens.length} leagues</b>
                      <span>with an open roster spot — work through them one by one</span>
                    </button>
                  )}
                  {list.map((i) => {
                    const p = i.playerId ? pmap?.[i.playerId] : undefined;
                    return (
                      <button key={i.key} className={`cb-card k-${i.kind}${focus?.key === i.key && sheet ? " on" : ""}`} onClick={() => openItem(i)}>
                        {i.playerId ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={playerPhotoUrl(i.playerId)} alt="" loading="lazy" />
                        ) : (
                          <span className="cb-glyph" aria-hidden>{i.kind === "over" ? "+" : "–"}</span>
                        )}
                        <span className="cb-txt">
                          <b>{p ? p.n : KIND[i.kind]}</b>
                          <span>{p ? `${KIND[i.kind]} · ${p.t}` : i.title}</span>
                          <small>{i.league.name}</small>
                        </span>
                      </button>
                    );
                  })}
                  {list.length + opens.length === 0 && <p className="cb-empty">Nothing to decide.</p>}
                </section>
              );
            })}
          </div>
        )}

        {view === "triage" && (
          <div className="cb-triage">
            <aside className="cb-inbox" aria-label="Inbox">
              <div className="cb-progress" aria-hidden><i style={{ width: `${items.length ? ((items.length - queue.length) / items.length) * 100 : 100}%` }} /></div>
              {KIND_ORDER.filter((k) => k !== "other").map((k) => {
                const list = queue.filter((i) => i.kind === k);
                return (
                  <details key={k} open={focus?.kind === k}>
                    <summary>
                      <span>{KIND[k]}</span>
                      <b>{list.length}</b>
                    </summary>
                    <ul>
                      {list.map((i) => (
                        <li key={i.key}>
                          <button className={focus?.key === i.key ? "on" : ""} onClick={() => setFocusKey(i.key)}>{i.league.name}</button>
                        </li>
                      ))}
                    </ul>
                  </details>
                );
              })}
              {done.size > 0 && <button className="cb-undo" onClick={() => setDone(new Set())}>Bring back {done.size} marked done</button>}
            </aside>
            <section className="cb-stage">
              {focus ? renderFocus(focus) : (
                <div className="cb-clear">
                  <h2>All clear</h2>
                  <p>Nothing left to fix across {active.length} leagues.</p>
                </div>
              )}
            </section>
          </div>
        )}

        {view === "matchups" && <WinChances leagues={active} week={week} />}

        {view === "portfolio" && (
          <>
            <Portfolio leagues={active} />
            <ExposureMap exposure={data.exposure} pmap={pmap} leagueCount={active.length} />
            {portfolioExtra && <div className="cb-extra">{portfolioExtra}</div>}
          </>
        )}
      </main>

      <div className={`cb-sheet${sheet && focus ? " open" : ""}`} role="dialog" aria-label="Decision" aria-hidden={!(sheet && focus)}>
        <button className="cb-close" onClick={() => setSheet(false)} aria-label="Close"><Ic d={IC.x} /></button>
        {sheet && focus && renderFocus(focus, true)}
      </div>
      {sheet && focus && <button className="cb-scrim" aria-label="Close" onClick={() => setSheet(false)} />}
      <p className="cb-foot">J / K next and back · E mark done · Esc close. Counts are from your last sync — every send re-checks Sleeper first.</p>
    </div>
  );
}

function Portfolio({ leagues }: { leagues: ProtoLeague[] }) {
  const [only, setOnly] = useState<"all" | "in" | "out" | "fix">("all");
  const [all, setAll] = useState(false);
  const inSpot = (l: ProtoLeague) => !!(l.rank && l.playoffTeams && l.rank <= l.playoffTeams);
  const fix = (l: ProtoLeague) => l.injured + l.bye + l.emptySlots > 0 || l.openSpots < 0;
  const c = {
    win: leagues.filter((l) => l.wins > l.losses).length,
    even: leagues.filter((l) => l.wins === l.losses).length,
    lose: leagues.filter((l) => l.wins < l.losses).length,
    in: leagues.filter(inSpot).length,
    fix: leagues.filter(fix).length,
  };
  const rows = leagues.filter((l) => (only === "in" ? inSpot(l) : only === "out" ? !inSpot(l) : only === "fix" ? fix(l) : true));
  return (
    <>
      <div className="cb-cards">
        <article><h3>Record</h3><dl><div><dt>Winning</dt><dd>{c.win}</dd></div><div><dt>Even</dt><dd>{c.even}</dd></div><div><dt>Losing</dt><dd>{c.lose}</dd></div></dl></article>
        <article><h3>Playoff picture</h3><dl><div><dt>In a playoff spot</dt><dd>{c.in}</dd></div><div><dt>Outside</dt><dd>{leagues.length - c.in}</dd></div></dl></article>
        <article><h3>Lineups</h3><dl><div><dt>Need a fix</dt><dd className={c.fix ? "warn" : ""}>{c.fix}</dd></div><div><dt>Clean</dt><dd>{leagues.length - c.fix}</dd></div></dl></article>
      </div>
      <div className="cb-pills">
        {(
          [
            ["all", `All ${leagues.length}`],
            ["in", `In a playoff spot ${c.in}`],
            ["out", `Outside ${leagues.length - c.in}`],
            ["fix", `Needs a fix ${c.fix}`],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={only === k ? "on" : ""} aria-pressed={only === k} onClick={() => setOnly(k)}>{label}</button>
        ))}
      </div>
      <div className="cb-table" role="table">
        <div className="cb-tr cb-th" role="row"><span>League</span><span>Record</span><span>Standing</span><span>Points for</span><span>Lineup</span><span /></div>
        {(all ? rows : rows.slice(0, 15)).map((l) => (
          <div className="cb-tr" role="row" key={l.id}>
            <span className="nm"><span className="cb-dot">{l.tag}</span>{l.name}</span>
            <span className="num">{l.wins}–{l.losses}</span>
            <span className={`num ${inSpot(l) ? "good" : ""}`}>{l.rank ? `${l.rank} / ${l.teams}` : "—"}</span>
            <span className="num">{l.pf.toFixed(1)}</span>
            <span>{fix(l) ? <i className="flag">needs a fix</i> : <small>clean</small>}</span>
            <Link href={`/manager/${l.id}`} className="cb-open">Open</Link>
          </div>
        ))}
      </div>
      {rows.length > 15 && <button className="cb-more" onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `Show all ${rows.length}`}</button>}
    </>
  );
}
