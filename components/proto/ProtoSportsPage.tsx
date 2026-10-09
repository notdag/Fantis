"use client";

/*
 * THESIS: the week's state of 200+ leagues read like the Sunday sports section — one headline that says what matters,
 *   and every league's standing in quiet agate — instead of a card dashboard competing for attention.
 * OWN-WORLD: cool newsprint ground, one black ink, a single red spot colour reserved for problems; Franklin gothic
 *   headlines over condensed agate figures; hairline column rules, no boxes, no shadows.
 * STORY: the owner reads the headline (what to fix and by when), scans the wire of fixes, then the standings, and
 *   clicks straight into a league or a tool.
 * FIRST VIEWPORT: nameplate and dateline; a lead story with the fix count as the headline and its action; the
 *   season scoreboard in the right column; the fix wire and agate standings start below the fold line.
 * FORM: grounded candidate 4 (sports-section agate page), seed 8ddced95.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import type { ProtoData, ProtoLeague } from "@/lib/protoData";
import "./sportspage.css";

const family = (name: string) => {
  const base = name.replace(/\s*#\s?\d+.*$/, "").trim();
  return base === name ? "Other leagues" : base;
};
const short = (l: ProtoLeague) => (family(l.name) === "Other leagues" ? l.name : l.tag);
const tagNum = (l: ProtoLeague) => Number(l.tag.match(/\d+/)?.[0] ?? 99999);
const issues = (l: ProtoLeague) => l.emptySlots + l.injured + l.bye + (l.openSpots < 0 ? 1 : 0);

export default function ProtoSportsPage({ data }: { data: ProtoData }) {
  const [hideBB, setHideBB] = useState(true);
  const [only, setOnly] = useState<"all" | "issues" | "losing">("all");
  const leagues = useMemo(() => data.leagues.filter((l) => !hideBB || !l.bestBall), [data.leagues, hideBB]);
  const week = Math.max(0, ...leagues.map((l) => l.week ?? 0)) || null;

  const t = useMemo(() => {
    const s = { w: 0, l: 0, t: 0, win: 0, lose: 0, even: 0, inSpot: 0, empty: [] as ProtoLeague[], inj: [] as ProtoLeague[], bye: [] as ProtoLeague[], over: [] as ProtoLeague[], open: [] as ProtoLeague[], best: null as ProtoLeague | null };
    for (const l of leagues) {
      s.w += l.wins;
      s.l += l.losses;
      s.t += l.ties;
      if (l.wins > l.losses) s.win++;
      else if (l.wins < l.losses) s.lose++;
      else s.even++;
      if (l.rank && l.playoffTeams && l.rank <= l.playoffTeams) s.inSpot++;
      if (l.emptySlots) s.empty.push(l);
      if (l.injured) s.inj.push(l);
      if (l.bye) s.bye.push(l);
      if (l.openSpots < 0) s.over.push(l);
      if (l.openSpots > 0) s.open.push(l);
      if (!s.best || l.pf > s.best.pf) s.best = l;
    }
    return s;
  }, [leagues]);
  const fixes = new Set([...t.empty, ...t.inj, ...t.bye, ...t.over].map((l) => l.id)).size;

  const groups = useMemo(() => {
    const m = new Map<string, ProtoLeague[]>();
    for (const l of leagues) {
      if (only === "issues" && !issues(l)) continue;
      if (only === "losing" && !(l.wins < l.losses)) continue;
      const f = family(l.name);
      (m.get(f) ?? m.set(f, []).get(f)!).push(l);
    }
    return [...m.entries()]
      .map(([f, ls]) => [f, ls.sort((a, b) => tagNum(a) - tagNum(b) || a.name.localeCompare(b.name))] as const)
      .sort((a, b) => (a[0] === "Other leagues" ? 1 : b[0] === "Other leagues" ? -1 : b[1].length - a[1].length));
  }, [leagues, only]);

  const headline =
    fixes === 0 ? "Every lineup is set" : `${fixes} lineup${fixes === 1 ? "" : "s"} need${fixes === 1 ? "s" : ""} a fix before kickoff`;
  const deck = [
    t.empty.length && `${t.empty.length} with an empty starting slot`,
    t.inj.length && `${t.inj.length} starting someone injured`,
    t.bye.length && `${t.bye.length} starting someone on a bye`,
    t.over.length && `${t.over.length} over the roster limit`,
  ].filter(Boolean) as string[];

  const wire: [string, ProtoLeague[], string, string][] = [
    ["Empty starting slot", t.empty, "/manager/lineups", "Fix lineups"],
    ["Injured starter", t.inj, "/manager/lineups", "Fix lineups"],
    ["Bye-week starter", t.bye, "/manager/lineups", "Fix lineups"],
    ["Over the roster limit", t.over, "/manager/teams", "Open leagues"],
    ["Open roster spot", t.open, "/manager/open-spots", "Fill spots"],
  ];

  return (
    <div className="sp">
      <header className="sp-mast">
        <div className="sp-ears">
          <span>Week {week ?? "—"} edition</span>
          <nav aria-label="Sections">
            <Link href="/manager/lineups">Lineups</Link>
            <Link href="/manager/open-spots">Roster spots</Link>
            <Link href="/manager/waiver">Waivers</Link>
            <Link href="/manager/review">Review</Link>
            <Link href="/manager/player">Players</Link>
          </nav>
        </div>
        <Link href="/proto" className="sp-name">Fantis</Link>
        <div className="sp-dateline">
          <span>{leagues.length} leagues</span>
          <span>Season record {t.w}–{t.l}{t.t ? `–${t.t}` : ""}</span>
          <span>{data.plansWaiting} plans waiting</span>
          <button onClick={() => setHideBB((v) => !v)}>{hideBB ? "Best ball left out" : "Best ball included"}</button>
        </div>
      </header>

      <main className="sp-page">
        <article className="sp-lead">
          <h1>{headline}</h1>
          <p className="sp-deck">
            {deck.length ? <>Of {leagues.length} leagues, {deck.join(", ")}.</> : "No empty slots, injured or bye-week starters in any league."}{" "}
            {t.open.length > 0 && <>Separately, {t.open.length} leagues have room to add a player.</>}
          </p>
          <div className="sp-acts">
            <Link className="sp-btn" href="/manager/lineups">Fix lineups</Link>
            <Link className="sp-link" href="/manager/open-spots">Fill open spots</Link>
            <Link className="sp-link" href="/manager/review">Review chat plans</Link>
          </div>
        </article>

        <aside className="sp-score" aria-label="Season scoreboard">
          <h2>Scoreboard</h2>
          <dl>
            <div><dt>Winning record</dt><dd>{t.win}</dd></div>
            <div><dt>Even</dt><dd>{t.even}</dd></div>
            <div><dt>Losing record</dt><dd>{t.lose}</dd></div>
            <div><dt>In a playoff spot</dt><dd>{t.inSpot}</dd></div>
          </dl>
          {t.best && (
            <p className="sp-note">
              Most points: <Link href={`/manager/${t.best.id}`}>{t.best.name}</Link>, {t.best.pf.toFixed(1)}.
            </p>
          )}
        </aside>

        <section className="sp-wire" aria-label="Fixes">
          <h2>The wire</h2>
          {wire.map(([label, ls, href, cta]) => (
            <div key={label} className="sp-item">
              <h3>
                {label} <span>{ls.length}</span>
              </h3>
              {ls.length === 0 ? (
                <p className="sp-none">None this week.</p>
              ) : (
                <p>
                  {ls.slice(0, 14).map((l, i) => (
                    <span key={l.id}>
                      <Link href={`/manager/${l.id}`} title={l.name}>{family(l.name) === "Other leagues" ? l.name : `${family(l.name)} ${l.tag}`}</Link>
                      {i < Math.min(ls.length, 14) - 1 ? "; " : ""}
                    </span>
                  ))}
                  {ls.length > 14 && <>; and {ls.length - 14} more</>}. <Link className="sp-more" href={href}>{cta} →</Link>
                </p>
              )}
            </div>
          ))}
        </section>

        <section className="sp-standings" aria-label="Standings">
          <div className="sp-st-head">
            <h2>Standings</h2>
            <div className="sp-filter" role="group" aria-label="Show">
              {(
                [
                  ["all", "All"],
                  ["issues", "Needs a fix"],
                  ["losing", "Losing"],
                ] as const
              ).map(([k, label]) => (
                <button key={k} aria-pressed={only === k} className={only === k ? "on" : ""} onClick={() => setOnly(k)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="sp-cols">
            {groups.map(([f, ls]) => (
              <table key={f} className="sp-agate">
                <caption>{f} <span>{ls.length}</span></caption>
                <thead>
                  <tr><th scope="col">Lg</th><th scope="col">W</th><th scope="col">L</th><th scope="col">Pos</th><th scope="col">PF</th><th scope="col"><span className="sr">Problems</span></th></tr>
                </thead>
                <tbody>
                  {ls.map((l) => (
                    <tr key={l.id} className={issues(l) ? "x" : ""}>
                      <th scope="row"><Link href={`/manager/${l.id}`} title={l.name}>{short(l)}</Link></th>
                      <td>{l.wins}</td>
                      <td>{l.losses}</td>
                      <td>{l.rank ? `${l.rank}/${l.teams}` : "—"}</td>
                      <td>{l.pf.toFixed(0)}</td>
                      <td className="m">{issues(l) ? <span title={[l.emptySlots && `${l.emptySlots} empty`, l.injured && `${l.injured} injured`, l.bye && `${l.bye} bye`, l.openSpots < 0 && "over limit"].filter(Boolean).join(", ")}>■</span> : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>
          <p className="sp-key">■ needs a fix (hover for what). Pos = standing / teams. From your last sync; nothing on this page changes Sleeper. Prototype C · <Link href="/proto/triage">see prototype D</Link></p>
        </section>
      </main>
    </div>
  );
}
