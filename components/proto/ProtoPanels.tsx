"use client";

/*
 * THESIS: one persistent workspace — leagues on the left, the chosen league in the middle, what to do on the right —
 *   where navigation only swaps panel contents, never the page, instead of a site of separate pages to click through.
 * OWN-WORLD: graphite ground, panels divided by 1px seams (no shadows, no cards), Onest at two weights, one teal accent
 *   for selection and the primary action, amber/red only for warnings; position colour as small tinted tags.
 * STORY: the owner filters the list, arrows through leagues, sees each lineup and its problems instantly, and jumps to
 *   the right tool from the action panel.
 * FIRST VIEWPORT: thin top bar with search; three full-height panels: league list, league view, action panel.
 * FORM: challenger fusion (dark working surface with persistent tiled panels), seed 0a1ed833.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProtoData, ProtoLeague } from "@/lib/protoData";
import { usePlayerMap } from "@/lib/usePlayerMap";
import { formatPacific } from "@/lib/waiverSchedule";
import "./panels.css";

type Filter = "all" | "attention" | "open" | "losing";
const POS_COLOR: Record<string, string> = { QB: "#5fda9c", RB: "#59b4e8", WR: "#f0808a", TE: "#f0b876", K: "#9aa0ab", DEF: "#9aa0ab" };
const needs = (l: ProtoLeague) => l.injured + l.bye + l.emptySlots > 0 || l.openSpots < 0;
const slotLabel = (s: string) => (s === "SUPER_FLEX" ? "SF" : s === "REC_FLEX" ? "W/T" : s === "WRRB_FLEX" ? "W/R" : s === "FLEX" ? "FLX" : s);

export default function ProtoPanels({ data }: { data: ProtoData }) {
  const { pmap } = usePlayerMap();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const leagues = useMemo(() => data.leagues.filter((l) => !l.bestBall), [data.leagues]);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return leagues
      .filter((l) => !t || l.name.toLowerCase().includes(t))
      .filter((l) => (filter === "attention" ? needs(l) : filter === "open" ? l.openSpots > 0 : filter === "losing" ? l.wins < l.losses : true))
      .sort((a, b) => Number(needs(b)) - Number(needs(a)) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [leagues, filter, q]);
  const [selId, setSelId] = useState<string | null>(null);
  const sel = list.find((l) => l.id === selId) ?? list[0] ?? null;
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const i = sel ? list.indexOf(sel) : -1;
      const n = list[Math.min(list.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (n) {
        setSelId(n.id);
        listRef.current?.querySelector(`[data-id="${n.id}"]`)?.scrollIntoView({ block: "nearest" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list, sel]);

  const alertsHere = sel ? data.alerts.filter((a) => a.leagueId === sel.id) : [];
  const counts = {
    all: leagues.length,
    attention: leagues.filter(needs).length,
    open: leagues.filter((l) => l.openSpots > 0).length,
    losing: leagues.filter((l) => l.wins < l.losses).length,
  };
  const player = (id: string) => (id && id !== "0" ? pmap?.[id] : undefined);

  return (
    <div className="pn">
      <header className="pn-top">
        <Link href="/proto" className="pn-brand">Fantis</Link>
        <label className="pn-search">
          <span className="sr">Search leagues</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search leagues" />
        </label>
        <nav className="pn-nav" aria-label="Tools">
          <Link href="/manager/lineups">Lineups</Link>
          <Link href="/manager/waiver">Waivers</Link>
          <Link href="/manager/open-spots">Roster spots</Link>
          <Link href="/manager/review">Review{data.plansWaiting ? ` ${data.plansWaiting}` : ""}</Link>
        </nav>
      </header>

      <div className="pn-body">
        <aside className="pn-list" aria-label="Leagues">
          <div className="pn-filter" role="group" aria-label="Filter leagues">
            {(
              [
                ["all", "All"],
                ["attention", "Needs work"],
                ["open", "Open spot"],
                ["losing", "Losing"],
              ] as [Filter, string][]
            ).map(([k, label]) => (
              <button key={k} aria-pressed={filter === k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>
                {label} <span>{counts[k]}</span>
              </button>
            ))}
          </div>
          <ul ref={listRef}>
            {list.map((l) => (
              <li key={l.id}>
                <button data-id={l.id} className={sel?.id === l.id ? "on" : ""} onClick={() => setSelId(l.id)}>
                  <span className="nm">{l.name}</span>
                  <span className="rec">{l.wins}-{l.losses}</span>
                  <span className="dots" aria-hidden>
                    {l.emptySlots + l.injured + l.bye > 0 && <i className="w" />}
                    {l.openSpots < 0 && <i className="r" />}
                    {l.openSpots > 0 && <i className="o" />}
                  </span>
                </button>
              </li>
            ))}
            {list.length === 0 && <li className="pn-none">No leagues match.</li>}
          </ul>
          <p className="pn-hint">↑ ↓ to move between leagues</p>
        </aside>

        <main className="pn-main" aria-live="polite">
          {sel ? (
            <div className="pn-view" key={sel.id}>
              <div className="pn-head">
                <h1>{sel.name}</h1>
                <dl>
                  <div><dt>Record</dt><dd>{sel.wins}-{sel.losses}{sel.ties ? `-${sel.ties}` : ""}</dd></div>
                  <div><dt>Standing</dt><dd>{sel.rank ? `${sel.rank} / ${sel.teams}` : "—"}</dd></div>
                  <div><dt>Week {sel.week ?? ""}</dt><dd>{sel.myPts && sel.myPts > 0 ? `${sel.myPts.toFixed(1)} – ${sel.oppPts?.toFixed(1)}` : sel.oppName ? `vs ${sel.oppName}` : "—"}</dd></div>
                  <div><dt>Points for</dt><dd>{sel.pf.toFixed(1)}</dd></div>
                </dl>
              </div>

              <section>
                <h2>Starting lineup</h2>
                <ol className="pn-lineup">
                  {sel.starters.map((id, i) => {
                    const p = player(id);
                    const isEmpty = !id || id === "0";
                    if (!pmap && !isEmpty)
                      return (
                        <li key={i}>
                          <span className="slot">{slotLabel(sel.slots[i] ?? "")}</span>
                          <span className="pn-skel" />
                        </li>
                      );
                    const bad = isEmpty ? "empty" : !p ? "" : p.inj && /out|ir|doubtful|sus/i.test(p.inj) ? "out" : p.inj ? "q" : "";
                    return (
                      <li key={i} className={bad ? `b-${bad}` : ""}>
                        <span className="slot">{slotLabel(sel.slots[i] ?? "")}</span>
                        {p ? (
                          <>
                            <span className="pos" style={{ ["--pc" as string]: POS_COLOR[p.p] ?? "#9aa0ab" }}>{p.p}</span>
                            <span className="nm">{p.n}</span>
                            <span className="meta">{p.t}{p.inj ? ` · ${p.inj}` : ""}</span>
                          </>
                        ) : isEmpty ? (
                          <span className="nm empty">Empty slot</span>
                        ) : (
                          <span className="nm">Unknown player {id}</span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </section>

              <section className="pn-two">
                <div>
                  <h2>Bench <span>{sel.bench.length}</span></h2>
                  <ul className="pn-plain">
                    {sel.bench.map((id) => {
                      const p = player(id);
                      return (
                        <li key={id}>
                          {p && <span className="pos" style={{ ["--pc" as string]: POS_COLOR[p.p] ?? "#9aa0ab" }}>{p.p}</span>}
                          <span className="nm">{p?.n ?? id}</span>
                          <span className="meta">{p?.inj ?? ""}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div>
                  <h2>IR <span>{sel.irUsed}/{sel.irTotal || 0}</span></h2>
                  <ul className="pn-plain">
                    {sel.reserve.length === 0 && <li className="meta">Empty</li>}
                    {sel.reserve.map((id) => {
                      const p = player(id);
                      return (
                        <li key={id}>
                          {p && <span className="pos" style={{ ["--pc" as string]: POS_COLOR[p.p] ?? "#9aa0ab" }}>{p.p}</span>}
                          <span className="nm">{p?.n ?? id}</span>
                          <span className="meta">{p?.inj ?? ""}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </section>
            </div>
          ) : (
            <p className="pn-none">Pick a league.</p>
          )}
        </main>

        <aside className="pn-side" aria-label="Actions">
          {sel && (
            <div key={sel.id} className="pn-view">
              <h2>To do here</h2>
              {alertsHere.length === 0 && sel.openSpots === 0 && sel.emptySlots === 0 ? (
                <p className="pn-ok">Nothing to fix in this league.</p>
              ) : (
                <ul className="pn-todo">
                  {alertsHere.map((a) => (
                    <li key={a.id} className={a.severity === "action_required" ? "r" : "w"}>{a.message}</li>
                  ))}
                  {sel.openSpots > 0 && <li className="o">{sel.openSpots} open roster spot{sel.openSpots > 1 ? "s" : ""}</li>}
                  {sel.openSpots < 0 && <li className="r">Roster {-sel.openSpots} over the limit</li>}
                </ul>
              )}
              <div className="pn-acts">
                <Link className="pn-primary" href="/manager/lineups">Optimize lineup</Link>
                <Link className="pn-ghost" href={`/manager/waiver?leagueId=${sel.id}`}>Waivers for this league</Link>
                <Link className="pn-ghost" href={`/manager/${sel.id}`}>Open full league</Link>
              </div>
              <h2>League</h2>
              <dl className="pn-facts">
                <div><dt>FAAB left</dt><dd>{sel.faabLeft == null ? "Not FAAB" : `$${sel.faabLeft} of $${sel.faabBudget}`}</dd></div>
                <div><dt>Next waivers</dt><dd>{sel.waiverAt ? formatPacific(new Date(sel.waiverAt)) : "—"}</dd></div>
                <div><dt>Roster room</dt><dd>{sel.openSpots > 0 ? `${sel.openSpots} open` : sel.openSpots < 0 ? `${-sel.openSpots} over` : "Full"}</dd></div>
                <div><dt>Teams</dt><dd>{sel.teams}{sel.playoffTeams ? ` · ${sel.playoffTeams} make playoffs` : ""}</dd></div>
                <div><dt>Last sync</dt><dd>{sel.syncedHoursAgo == null ? "—" : `${sel.syncedHoursAgo}h ago`}</dd></div>
              </dl>
            </div>
          )}
          <p className="pn-foot">Prototype F · real data from your last sync · nothing here changes Sleeper · <Link href="/proto">all prototypes</Link></p>
        </aside>
      </div>
    </div>
  );
}
