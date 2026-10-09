"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ProtoData, ProtoLeague } from "@/lib/protoData";
import { usePlayerMap } from "@/lib/usePlayerMap";
import { playerPhotoUrl } from "@/lib/sleeper";
import "./statchasers.css";

// Prototype A — "StatChasers style": a top bar with a league switcher, a horizontal menu with dropdowns, a titled page
// with a segmented view switch, outlook cards, a filterable league breakdown and a player-exposure bubble map.
// Real data, read-only; links go to the existing /manager tools.

type View = "overview" | "attention" | "exposure";
type Bucket = "all" | "in" | "bubble" | "out" | "attention";

const NAV: { label: string; items: [string, string][] }[] = [
  { label: "Command Center", items: [["Overview", "/proto/statchasers"], ["Review queue", "/manager/review"], ["Activity log", "/manager/activity"]] },
  { label: "Leagues", items: [["All leagues", "/manager/teams"], ["Weekly record", "/manager/record"], ["Matchups", "/manager/matchups"], ["Byes", "/manager/byes"], ["Injuries", "/manager/injuries"]] },
  { label: "Lineups", items: [["Optimize", "/manager/lineups"], ["Set future weeks", "/manager/lineups"], ["Mass IR", "/manager/lineups"]] },
  { label: "Waivers", items: [["Waiver assistant", "/manager/waiver"], ["Empty roster spots", "/manager/open-spots"], ["Trades & claims", "/manager/inbox"]] },
  { label: "Players", items: [["Find a player", "/manager/player"], ["Rankings", "/rankings"]] },
];

const POS = ["QB", "RB", "WR", "TE"] as const;
const POS_COLOR: Record<string, string> = { QB: "#5FDA9C", RB: "#59B4E8", WR: "#F0808A", TE: "#F0B876" };

function bucketOf(l: ProtoLeague): Exclude<Bucket, "all" | "attention"> {
  if (l.rank == null || !l.playoffTeams) return "bubble";
  if (l.rank <= l.playoffTeams) return "in";
  if (l.rank <= l.playoffTeams + 2) return "bubble";
  return "out";
}
const needs = (l: ProtoLeague) => l.injured + l.bye + l.emptySlots > 0 || l.openSpots < 0;
const rec = (l: ProtoLeague) => `${l.wins}-${l.losses}${l.ties ? `-${l.ties}` : ""}`;

function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
const I = {
  trophy: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4",
  trend: "M3 17l6-6 4 4 8-8M15 7h6v6",
  pulse: "M3 12h4l3-8 4 16 3-8h4",
  chev: "M6 9l6 6 6-6",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3",
  sync: "M21 12a9 9 0 0 1-15.5 6.3L3 16M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M3 21v-5h5",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  bubbles: "M8 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 20a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM17 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
};

export default function ProtoStatChasers({ data }: { data: ProtoData }) {
  const { pmap } = usePlayerMap();
  const [view, setView] = useState<View>("overview");
  const [bucket, setBucket] = useState<Bucket>("all");
  const [showAll, setShowAll] = useState(false);
  const [q, setQ] = useState("");
  const [current, setCurrent] = useState(data.leagues[0]?.id ?? "");
  const [switcher, setSwitcher] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [pos, setPos] = useState<string>("ALL");
  const [hideBB, setHideBB] = useState(true);

  const leagues = useMemo(() => data.leagues.filter((l) => !hideBB || !l.bestBall), [data.leagues, hideBB]);
  const counts = useMemo(() => {
    const c = { in: 0, bubble: 0, out: 0, attention: 0, win: 0, even: 0, lose: 0 };
    for (const l of leagues) {
      c[bucketOf(l)]++;
      if (needs(l)) c.attention++;
      if (l.wins > l.losses) c.win++;
      else if (l.wins === l.losses) c.even++;
      else c.lose++;
    }
    return c;
  }, [leagues]);
  const health = useMemo(
    () => ({
      injured: leagues.filter((l) => l.injured > 0).length,
      empty: leagues.filter((l) => l.emptySlots > 0).length,
      open: leagues.filter((l) => l.openSpots > 0).length,
      over: leagues.filter((l) => l.openSpots < 0).length,
    }),
    [leagues]
  );
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return leagues
      .filter((l) => (bucket === "all" ? true : bucket === "attention" ? needs(l) : bucketOf(l) === bucket))
      .filter((l) => !t || l.name.toLowerCase().includes(t));
  }, [leagues, bucket, q]);
  const shown = showAll ? rows : rows.slice(0, 12);
  const cur = data.leagues.find((l) => l.id === current);

  const bubbles = useMemo(() => {
    const by: Record<string, { id: string; n: number; s: number; name: string; inj?: string }[]> = { QB: [], RB: [], WR: [], TE: [] };
    for (const e of data.exposure) {
      const p = pmap?.[e.id];
      if (!p || !(p.p in by)) continue;
      by[p.p].push({ id: e.id, n: e.leagues, s: e.starting, name: p.n, inj: p.inj ?? undefined });
    }
    for (const k of Object.keys(by)) by[k] = by[k].slice(0, k === "RB" || k === "WR" ? 28 : 12);
    return by;
  }, [data.exposure, pmap]);
  const maxShare = Math.max(1, ...Object.values(bubbles).flat().map((b) => b.n));

  return (
    <div className="sc">
      {/* ── top bar */}
      <header className="sc-top">
        <Link href="/proto" className="sc-brand">
          <span className="sc-mark">F</span>
          <span>
            <b>Fantis</b>
            <em>Command</em>
          </span>
        </Link>
        <div className="sc-switch">
          <button className="sc-league" onClick={() => setSwitcher((v) => !v)} aria-expanded={switcher}>
            <span className="sc-dot">{cur?.tag ?? "—"}</span>
            <span className="sc-league-name">{cur?.name ?? "Pick a league"}</span>
            <Icon d={I.chev} size={14} />
          </button>
          <span className="sc-chip">Sleeper</span>
          {switcher && (
            <div className="sc-pop" role="listbox">
              {data.leagues.slice(0, 400).map((l) => (
                <button key={l.id} className={l.id === current ? "on" : ""} onClick={() => (setCurrent(l.id), setSwitcher(false))}>
                  <span>{l.name}</span>
                  <small>{rec(l)}</small>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="sc-right">
          <Link href="/manager" className="sc-btn-outline">
            <Icon d={I.sync} size={15} /> Sync all
          </Link>
          <span className="sc-user">notdag</span>
        </div>
      </header>
      <nav className="sc-nav" onMouseLeave={() => setOpenMenu(null)}>
        {NAV.map((n, i) => (
          <div key={n.label} className="sc-navitem" onMouseEnter={() => setOpenMenu(n.label)}>
            <button className={i === 0 ? "on" : ""} onClick={() => setOpenMenu((o) => (o === n.label ? null : n.label))}>
              {n.label} <Icon d={I.chev} size={13} />
            </button>
            {openMenu === n.label && (
              <div className="sc-menu">
                {n.items.map(([label, href]) => (
                  <Link key={label} href={href}>{label}</Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      <main className="sc-main">
        <div className="sc-head">
          <div>
            <h1>My Portfolio</h1>
            <p>Every in-season league you manage — {leagues.length} shown{hideBB ? `, best ball hidden` : ""}.</p>
          </div>
          <div className="sc-seg" role="tablist">
            {(
              [
                ["overview", "Overview", I.grid],
                ["attention", `Needs attention · ${counts.attention}`, I.alert],
                ["exposure", "Exposure", I.bubbles],
              ] as [View, string, string][]
            ).map(([k, label, d]) => (
              <button key={k} role="tab" aria-selected={view === k} className={view === k ? "on" : ""} onClick={() => (setView(k), k === "attention" && setBucket("attention"))}>
                <Icon d={d} size={15} /> {label}
              </button>
            ))}
          </div>
        </div>

        {view !== "exposure" && (
          <>
            <section className="sc-cards">
              <article className="sc-card c-amber">
                <div className="sc-card-h">
                  <span className="sc-ic"><Icon d={I.trophy} /></span>
                  <div>
                    <h3>Playoff outlook</h3>
                    <p>{counts.in} teams in a playoff spot right now.</p>
                  </div>
                </div>
                <dl>
                  <div><dt>In a playoff spot</dt><dd>{counts.in}</dd></div>
                  <div><dt>Within 2 spots</dt><dd>{counts.bubble}</dd></div>
                  <div><dt>Outside</dt><dd>{counts.out}</dd></div>
                </dl>
              </article>
              <article className="sc-card c-mint">
                <div className="sc-card-h">
                  <span className="sc-ic"><Icon d={I.trend} /></span>
                  <div>
                    <h3>Record snapshot</h3>
                    <p>{counts.win >= counts.lose ? "More leagues winning than losing." : "More leagues losing than winning."}</p>
                  </div>
                </div>
                <dl>
                  <div><dt>Winning record</dt><dd>{counts.win}</dd></div>
                  <div><dt>.500</dt><dd>{counts.even}</dd></div>
                  <div><dt>Losing record</dt><dd>{counts.lose}</dd></div>
                </dl>
              </article>
              <article className="sc-card c-blue">
                <div className="sc-card-h">
                  <span className="sc-ic"><Icon d={I.pulse} /></span>
                  <div>
                    <h3>Roster health</h3>
                    <p>{health.injured + health.empty + health.over === 0 ? "Every lineup is clean." : "A few lineups need a look."}</p>
                  </div>
                </div>
                <dl>
                  <div><dt>Injured starters</dt><dd className={health.injured ? "warn" : ""}>{health.injured}</dd></div>
                  <div><dt>Empty starting slot</dt><dd className={health.empty ? "bad" : ""}>{health.empty}</dd></div>
                  <div><dt>Open roster spot</dt><dd>{health.open}</dd></div>
                  <div><dt>Over the limit</dt><dd className={health.over ? "bad" : ""}>{health.over}</dd></div>
                </dl>
              </article>
            </section>

            <section className="sc-section">
              <h2>League Breakdown</h2>
              <p className="sc-note">In-season leagues only. Playoff spot = current standing vs the league&rsquo;s playoff teams, from the last sync.</p>
              <div className="sc-pills">
                {(
                  [
                    ["all", `All: ${leagues.length}`, ""],
                    ["in", `In: ${counts.in}`, "p-mint"],
                    ["bubble", `Bubble: ${counts.bubble}`, "p-blue"],
                    ["out", `Outside: ${counts.out}`, "p-amber"],
                    ["attention", `Needs attention: ${counts.attention}`, "p-red"],
                  ] as [Bucket, string, string][]
                ).map(([k, label, cls]) => (
                  <button key={k} className={`sc-pill ${cls} ${bucket === k ? "on" : ""}`} onClick={() => setBucket(k)}>{label}</button>
                ))}
                <label className="sc-search">
                  <Icon d={I.search} size={15} />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search leagues…" aria-label="Search leagues" />
                </label>
                <button className={`sc-pill ${hideBB ? "on" : ""}`} onClick={() => setHideBB((v) => !v)}>{hideBB ? "Best ball hidden" : "Best ball shown"}</button>
              </div>
              <div className="sc-table" role="table">
                <div className="sc-tr sc-th" role="row">
                  <span>League</span><span>Record</span><span>Standing</span><span>This week</span><span>Lineup</span><span>IR</span><span>FAAB</span><span />
                </div>
                {shown.map((l) => {
                  const b = bucketOf(l);
                  const live = l.myPts != null && (l.myPts > 0 || (l.oppPts ?? 0) > 0);
                  return (
                    <div className="sc-tr" role="row" key={l.id}>
                      <span className="sc-lg">
                        <span className="sc-dot">{l.tag}</span>
                        <span>
                          <b>{l.name}</b>
                          <small>{l.teams} teams{l.bestBall ? " · best ball" : ""}</small>
                        </span>
                      </span>
                      <span className="num">{rec(l)}</span>
                      <span className={`num ${b === "in" ? "good" : b === "out" ? "bad" : ""}`}>{l.rank ? `#${l.rank}` : "—"}<small>/{l.teams}</small></span>
                      <span className="num">{live ? <>{l.myPts!.toFixed(1)} <small>vs {l.oppPts?.toFixed(1) ?? "—"}</small></> : <small>not started</small>}</span>
                      <span className="sc-flags">
                        {l.emptySlots > 0 && <i className="f-red">{l.emptySlots} empty</i>}
                        {l.injured > 0 && <i className="f-amber">{l.injured} inj</i>}
                        {l.bye > 0 && <i className="f-amber">{l.bye} bye</i>}
                        {l.openSpots > 0 && <i className="f-mint">{l.openSpots} open</i>}
                        {l.openSpots < 0 && <i className="f-red">over by {-l.openSpots}</i>}
                        {!needs(l) && l.openSpots === 0 && <small>clean</small>}
                      </span>
                      <span className="num">{l.irTotal ? `${l.irUsed}/${l.irTotal}` : "—"}</span>
                      <span className="num">{l.faabLeft == null ? "—" : `$${l.faabLeft}`}</span>
                      <Link className="sc-open" href={`/manager/${l.id}`}>Open</Link>
                    </div>
                  );
                })}
                {rows.length === 0 && <p className="sc-empty">No leagues match this filter.</p>}
              </div>
              {rows.length > 12 && (
                <button className="sc-more" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show all ${rows.length} leagues`}</button>
              )}
            </section>
          </>
        )}

        {view === "exposure" && (
          <section className="sc-section">
            <h2>Player Exposure</h2>
            <p className="sc-note">Circle size = leagues where he&rsquo;s on your roster (best ball excluded). Dot = injury designation.</p>
            <div className="sc-pills">
              {["ALL", ...POS].map((p) => (
                <button key={p} className={`sc-pill ${pos === p ? "on" : ""}`} style={p !== "ALL" && pos === p ? { background: POS_COLOR[p], color: "#0b0d12" } : undefined} onClick={() => setPos(p)}>{p}</button>
              ))}
            </div>
            {!pmap && <p className="sc-note">Loading players…</p>}
            <div className="sc-bubbles">
              {POS.filter((p) => pos === "ALL" || pos === p).map((p) => (
                <div key={p} className="sc-bcol" style={{ ["--pc" as string]: POS_COLOR[p] }}>
                  <h4><i />{p === "QB" ? "Quarterbacks" : p === "RB" ? "Running backs" : p === "WR" ? "Wide receivers" : "Tight ends"}<span>{bubbles[p].length}</span></h4>
                  <div className="sc-bwrap">
                    {bubbles[p].map((b) => {
                      const d = 34 + Math.round(60 * Math.sqrt(b.n / maxShare));
                      return (
                        <Link key={b.id} href={`/manager/player?playerId=${b.id}`} className="sc-bubble" style={{ width: d, height: d }} title={`${b.name} — on ${b.n} rosters, starting in ${b.s}`}>
                          {d > 54 && <img src={playerPhotoUrl(b.id)} alt="" loading="lazy" />}
                          <span className="nm">{b.name.split(" ").slice(-1)[0]}</span>
                          <span className="ct">{b.n}</span>
                          {b.inj && <span className={`inj ${/out|ir/i.test(b.inj) ? "r" : ""}`} title={b.inj} />}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
      <footer className="sc-foot">Prototype A · real data from your last sync · nothing here changes Sleeper · <Link href="/proto/sports">prototype C</Link> · <Link href="/proto/triage">prototype D</Link></footer>
    </div>
  );
}
