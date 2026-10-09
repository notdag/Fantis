"use client";

/*
 * THESIS: the landing page IS the product's command bar — you type (or tap) what a 200-league manager would ask and
 *   the Command Center answers live below it — instead of the category's hero headline + screenshot + feature grid.
 * OWN-WORLD: Fantis v2's dark console — navy-graphite ground, hairline seams, one amber accent for the next lock and
 *   primary actions, mint/red only for win/loss; Manrope at 800 for display, tabular numbers everywhere.
 * STORY: a visitor sees the headline, watches the command bar type a real request, sees the demo answer it, scrolls a
 *   week (Tuesday waivers → Monday night), plays with the win-chance math, sees how it's built, and syncs a league.
 * FIRST VIEWPORT: headline + one line + two buttons on the left, the command bar and the live demo window filling the
 *   right/below; "Sample leagues" label on the demo.
 * FORM: assigned surface structure 7 (command-bar hero driving a live demo), seed 99dd512d.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { DEMO_DECISIONS, DEMO_LEAGUES, DEMO_MATCHUPS, DEMO_WAIVERS, type DemoDay } from "./demoData";
import { outlook, OUTLOOK_LABEL, winProb } from "@/lib/winProb";
import "./landing.css";

type View = "week" | "triage" | "odds" | "waivers";
const PROMPTS: { text: string; view: View }[] = [
  { text: "What locks first this week?", view: "week" },
  { text: "Walk me through every fix", view: "triage" },
  { text: "Where am I favored?", view: "odds" },
  { text: "Best pickup in every league", view: "waivers" },
];
const VIEW_LABEL: Record<View, string> = { week: "This week", triage: "Triage", odds: "Win chances", waivers: "Waivers" };
const DAY_LABEL: Record<DemoDay, string> = { WAIVERS: "Waivers", THU: "Thursday", SUN_EARLY: "Sun early", SUN_LATE: "Sun late", MON: "Monday" };
const POS_COLOR: Record<string, string> = { QB: "#5FDA9C", RB: "#59B4E8", WR: "#F0808A", TE: "#F0B876" };

function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const u = () => setR(m.matches);
    u();
    m.addEventListener("change", u);
    return () => m.removeEventListener("change", u);
  }, []);
  return r;
}

// Adds .in to every [data-reveal] element once it scrolls into view (content is visible by default without JS).
function useReveal() {
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>(".ld [data-reveal]")];
    document.documentElement.classList.add("ld-js");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

export default function Landing() {
  const reduced = useReducedMotion();
  useReveal();
  const [view, setView] = useState<View>("week");
  const [typed, setTyped] = useState("");
  const [input, setInput] = useState("");
  const [userDrove, setUserDrove] = useState(false);
  const promptIdx = useRef(0);

  // The command bar types each sample request, then the demo below answers it — until the visitor takes over.
  useEffect(() => {
    if (userDrove || reduced) return; // reduced motion: the first prompt is shown whole, nothing types
    let cancelled = false;
    const run = async () => {
      while (!cancelled) {
        const p = PROMPTS[promptIdx.current % PROMPTS.length];
        for (let i = 1; i <= p.text.length && !cancelled; i++) {
          setTyped(p.text.slice(0, i));
          await new Promise((r) => setTimeout(r, 38));
        }
        if (cancelled) return;
        setView(p.view);
        await new Promise((r) => setTimeout(r, 4200));
        promptIdx.current++;
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [userDrove, reduced]);

  const ask = (text: string) => {
    setUserDrove(true);
    const t = text.toLowerCase();
    const v: View = /waiver|pickup|add|claim|free/.test(t) ? "waivers" : /favor|win|odds|chance|matchup/.test(t) ? "odds" : /fix|triage|walk|through|queue/.test(t) ? "triage" : "week";
    setTyped(text);
    setInput("");
    setView(v);
  };

  return (
    <div className="ld">
      {/* ── hero */}
      <section className="ld-hero">
        <div className="ld-copy">
          <h1>
            Run every league
            <br />
            like it&rsquo;s <span>your only one.</span>
          </h1>
          <p className="ld-lede">
            Fantis is a command center for Sleeper fantasy football: lineups, waivers, IR and win chances across every league you
            manage — with the math shown, and nothing sent to Sleeper until you confirm it.
          </p>
          <div className="ld-ctas">
            <Link className="ld-btn" href="/leagues">Sync your Sleeper league</Link>
            <Link className="ld-link" href="/rankings">Browse the rankings →</Link>
          </div>
          <p className="ld-fine">Read-only sync with your Sleeper username. No password, about 60 seconds.</p>
        </div>

        <div className="ld-stage">
          <form
            className="ld-cmd"
            onSubmit={(e) => {
              e.preventDefault();
              if (input.trim()) ask(input.trim());
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
              <path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3" />
            </svg>
            <input
              aria-label="Ask the demo Command Center"
              value={input}
              placeholder={userDrove ? "Ask the demo — try “best pickups”" : ""}
              onFocus={() => setUserDrove(true)}
              onChange={(e) => setInput(e.target.value)}
            />
            {!userDrove && !input && (
              <span className="ld-typed" aria-hidden>
                {reduced ? PROMPTS[0].text : typed}
                {!reduced && <i className="ld-caret" />}
              </span>
            )}
            <kbd>⏎</kbd>
          </form>
          <div className="ld-chips" role="group" aria-label="Try a command">
            {PROMPTS.map((p) => (
              <button key={p.view} className={view === p.view ? "on" : ""} onClick={() => ask(p.text)}>
                {p.text}
              </button>
            ))}
          </div>
          <DemoWindow view={view} setView={(v) => (setUserDrove(true), setView(v))} />
        </div>
      </section>

      {/* ── proof strip (real, countable facts about the build) */}
      <section className="ld-facts" data-reveal>
        <div><b>5</b><span>lock windows per week, Thursday to Monday, each sorted for you</span></div>
        <div><b>882</b><span>automated checks across the planner, the send flows and the math</span></div>
        <div><b>0</b><span>changes sent to Sleeper without your confirmation</span></div>
        <div><b>1</b><span>place for every league — instead of 200 browser tabs</span></div>
      </section>

      <WeekStory />
      <MathSection />
      <BuiltSection />

      <section className="ld-final" data-reveal>
        <h2>Bring your league. See your week.</h2>
        <p>Sync a Sleeper username to see every roster, standing and the rankings — free, read-only, no password.</p>
        <div className="ld-ctas center">
          <Link className="ld-btn" href="/leagues">Sync your Sleeper league</Link>
          <Link className="ld-link" href="/trade">Try the trade calculator →</Link>
        </div>
      </section>
    </div>
  );
}

/* ───────────────────────────── the live demo window ───────────────────────────── */

function DemoWindow({ view, setView }: { view: View; setView: (v: View) => void }) {
  return (
    <div className="ld-win" aria-label="Command Center demo with sample leagues">
      <div className="ld-win-bar">
        <span className="dots" aria-hidden><i /><i /><i /></span>
        <span className="url">fantis.vercel.app/manager</span>
        <span className="tag">Sample leagues</span>
      </div>
      <div className="ld-win-top">
        <span className="brand"><b>F</b> Command</span>
        <span className="lg">{DEMO_LEAGUES.length} leagues</span>
        <span className="sync">Sync all</span>
      </div>
      <div className="ld-win-tabs" role="tablist">
        {(Object.keys(VIEW_LABEL) as View[]).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
            {VIEW_LABEL[v]}
          </button>
        ))}
      </div>
      <div className="ld-win-body" key={view}>
        {view === "week" && <WeekView />}
        {view === "triage" && <TriageView />}
        {view === "odds" && <OddsView />}
        {view === "waivers" && <WaiverView />}
      </div>
    </div>
  );
}

function WeekView() {
  const days: DemoDay[] = ["WAIVERS", "THU", "SUN_EARLY", "SUN_LATE", "MON"];
  return (
    <div className="dv-week">
      {days.map((d, ci) => {
        const list = DEMO_DECISIONS.filter((x) => x.day === d);
        return (
          <div key={d} className={`dv-col ${d === "THU" ? "next" : ""}`} style={{ ["--i" as string]: ci }}>
            <header>
              <b>{DAY_LABEL[d]}</b>
              <span>{list.length}</span>
              {d === "THU" && <em>Next to lock</em>}
            </header>
            {list.map((x, i) => (
              <div key={x.id} className="dv-card" style={{ ["--d" as string]: `${ci * 70 + i * 60}ms` }}>
                <i style={{ background: POS_COLOR[x.pos] }} />
                <span>
                  <b>{x.player}</b>
                  <small className={x.kind.startsWith("Open") ? "g" : x.kind === "Empty slot" ? "r" : "a"}>{x.kind}</small>
                  <small>{x.league}</small>
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function TriageView() {
  const queue = DEMO_DECISIONS.filter((d) => d.day !== "WAIVERS");
  const [i, setI] = useState(0);
  const [done, setDone] = useState(0);
  const cur = queue[i % queue.length];
  return (
    <div className="dv-tri">
      <aside>
        <div className="prog"><i style={{ width: `${(done / queue.length) * 100}%` }} /></div>
        {(["Injured starter", "Bye-week starter", "Empty slot"] as const).map((k) => (
          <div key={k} className="grp">
            <span>{k}</span>
            <b>{queue.filter((q) => q.kind === k).length}</b>
          </div>
        ))}
      </aside>
      <div className="focus" key={cur.id}>
        <small>{cur.kind} · {(i % queue.length) + 1} of {queue.length} · locks {DAY_LABEL[cur.day]}</small>
        <em>{cur.league}</em>
        <h4>{cur.player} {cur.kind === "Empty slot" ? "slot is empty" : cur.kind === "Injured starter" ? "is listed out" : "is on bye"}</h4>
        <p>{cur.fix}</p>
        <div className="acts">
          <button className="pri" onClick={() => (setDone((d) => Math.min(queue.length, d + 1)), setI((n) => n + 1))}>Fix the lineup</button>
          <button onClick={() => setI((n) => n + 1)}>Next <kbd>J</kbd></button>
        </div>
      </div>
    </div>
  );
}

function OddsView() {
  const rows = useMemo(() => DEMO_MATCHUPS.map((m) => ({ ...m, p: winProb(m.mine, m.theirs) ?? 0.5 })).sort((a, b) => b.p - a.p), []);
  const exp = rows.reduce((s, r) => s + r.p, 0);
  return (
    <div className="dv-odds">
      <div className="sum">
        <span>Expected wins</span>
        <b>{exp.toFixed(1)}</b>
        <small>of {rows.length}</small>
      </div>
      {rows.map((r, i) => {
        const o = outlook(r.p);
        return (
          <div key={r.league} className="row" style={{ ["--d" as string]: `${i * 55}ms` }}>
            <span className="nm">{r.league}<small>vs {r.opp}</small></span>
            <span className="pts">{r.mine.toFixed(1)} <i>vs</i> {r.theirs.toFixed(1)}</span>
            <span className="bar"><i className={o} style={{ ["--w" as string]: `${Math.round(r.p * 100)}%` }} /></span>
            <span className={`pct ${o}`}>{Math.round(r.p * 100)}%</span>
            <span className={`tag ${o}`}>{OUTLOOK_LABEL[o]}</span>
          </div>
        );
      })}
    </div>
  );
}

function WaiverView() {
  return (
    <div className="dv-wv">
      {DEMO_WAIVERS.map((w, i) => (
        <div key={w.league} className="row" style={{ ["--d" as string]: `${i * 60}ms` }}>
          <span className="nm">{w.league}<small>FAAB {w.faab}% left</small></span>
          <span className="pl"><i style={{ color: POS_COLOR[w.pos] }}>{w.pos}</i> {w.best}<small>{w.ppg.toFixed(1)} PPG</small></span>
          <span className="dr">{w.drop === "open spot" ? <em>open spot — no drop</em> : <>drop {w.drop}<small>{w.dropPpg.toFixed(1)} PPG</small></>}</span>
          <span className="df">+{(w.ppg - w.dropPpg).toFixed(1)}</span>
          <span className="cl">Claim</span>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────────── a week, scroll-driven ───────────────────────────── */

const BEATS: { day: DemoDay; when: string; title: string; body: string }[] = [
  { day: "WAIVERS", when: "Tuesday night", title: "Claims go in before waivers run", body: "Every league's best available player next to the weakest bench player you'd drop — with a bid suggested from what that league actually pays." },
  { day: "THU", when: "Thursday, 5:15 PM PT", title: "The first lock gets fixed first", body: "Decisions are sorted by when they lock. Thursday's injured starter is at the top; Monday's can wait." },
  { day: "SUN_EARLY", when: "Sunday, 10:00 AM PT", title: "Early games, true slots", body: "Early-Sunday players go in their own slots and FLEX stays open for the late games — your latest, best-informed call." },
  { day: "SUN_LATE", when: "Sunday, 1:25 PM PT", title: "Questionables, decided once", body: "Mark a player won't-play and the replacement is set in every league that starts him, after one review." },
  { day: "MON", when: "Monday night", title: "The week closes clean", body: "Every send is re-checked against your live Sleeper roster first, and confirmed by reading it back. Nothing is called done unless it is." },
];

function WeekStory() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i));
      },
      { rootMargin: "-45% 0px -45% 0px" }
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);
  const beat = BEATS[active];
  const items = DEMO_DECISIONS.filter((d) => d.day === beat.day);
  return (
    <section className="ld-story">
      <h2 data-reveal>One week, start to finish</h2>
      <div className="ld-story-grid">
        <div className="ld-steps">
          {BEATS.map((b, i) => (
            <div key={b.day} ref={(el) => { refs.current[i] = el; }} data-i={i} className={`ld-step ${i === active ? "on" : ""}`}>
              <span className="when">{b.when}</span>
              <h3>{b.title}</h3>
              <p>{b.body}</p>
            </div>
          ))}
        </div>
        <div className="ld-sticky">
          <div className="ld-rail" aria-hidden>
            {BEATS.map((b, i) => (
              <span key={b.day} className={i < active ? "past" : i === active ? "now" : ""}>{DAY_LABEL[b.day]}</span>
            ))}
          </div>
          <div className="ld-phone" key={beat.day}>
            <div className="ph-head">
              <b>{DAY_LABEL[beat.day]}</b>
              <span>{items.length} to do</span>
            </div>
            {items.map((x, i) => (
              <div key={x.id} className="ph-card" style={{ ["--d" as string]: `${i * 90}ms` }}>
                <i style={{ background: POS_COLOR[x.pos] }} />
                <span>
                  <b>{x.player}</b>
                  <small>{x.kind} · {x.league}</small>
                  <em>{x.fix}</em>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────── math you can inspect ───────────────────────────── */

function MathSection() {
  const [mine, setMine] = useState(124);
  const [theirs, setTheirs] = useState(116);
  const p = winProb(mine, theirs) ?? 0.5;
  const o = outlook(p);
  return (
    <section className="ld-math">
      <div className="ld-math-copy" data-reveal>
        <h2>Math you can inspect</h2>
        <p>
          Every number in Fantis traces to a real source or a written-down formula. Win chance, for example, treats each team&rsquo;s
          weekly score as swinging about 20% around its projection — drag the projections and watch it move.
        </p>
        <code>P(win) = Φ( (mine − theirs) ⁄ √((0.2·mine)² + (0.2·theirs)²) )</code>
        <p className="small">
          Trade values work the same way: Sleeper&rsquo;s season projection as the base, nudged by this week&rsquo;s Vegas player props,
          capped so one thin market can&rsquo;t swing a season.
        </p>
      </div>
      <div className="ld-calc" data-reveal>
        <label>
          <span>Your projection <b>{mine}</b></span>
          <input type="range" min={70} max={180} value={mine} onChange={(e) => setMine(Number(e.target.value))} />
        </label>
        <label>
          <span>Opponent&rsquo;s projection <b>{theirs}</b></span>
          <input type="range" min={70} max={180} value={theirs} onChange={(e) => setTheirs(Number(e.target.value))} />
        </label>
        <div className={`ld-dial ${o}`}>
          <svg viewBox="0 0 120 64" aria-hidden>
            <path d="M8 60a52 52 0 0 1 104 0" className="track" />
            <path d="M8 60a52 52 0 0 1 104 0" className="fill" style={{ strokeDasharray: `${p * 163.4} 200` }} />
          </svg>
          <b>{Math.round(p * 100)}%</b>
          <span>{OUTLOOK_LABEL[o]}</span>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────── how it's built (portfolio) ───────────────────────────── */

function BuiltSection() {
  const rows: [string, string][] = [
    ["Next.js App Router + TypeScript", "One app: server components read Postgres, client components talk to Sleeper's public API directly."],
    ["Postgres via Prisma", "Synced leagues, rosters, weekly results, an activity log of every send, and the owner's curated rankings."],
    ["A planner that can't send", "The command parser and planner only draft changes; one small executor sends them, after a fresh roster read, once, and verifies by reading back."],
    ["Deterministic language parser", "Phrases like \"add X, drop Y if needed\" or \"set weeks 5–17\" are parsed by rules and a player-name index — no LLM, no guessing a name."],
    ["Safety rails for bulk work", "Duplicate guard across reloads, timeouts reported as \"outcome unknown\" (never retried), and a summary before anything goes out."],
    ["Real data, labelled", "Sleeper, FantasyCalc, live odds and props — each credited where it's shown, every estimate marked as one."],
  ];
  return (
    <section className="ld-built">
      <h2 data-reveal>How it&rsquo;s built</h2>
      <p className="ld-built-lede" data-reveal>Designed around one manager running 200+ Sleeper leagues — then opened up for anyone with a Sleeper account.</p>
      <dl>
        {rows.map(([t, d], i) => (
          <div key={t} data-reveal style={{ ["--d" as string]: `${i * 60}ms` }}>
            <dt>{t}</dt>
            <dd>{d}</dd>
          </div>
        ))}
      </dl>
      <div className="ld-stack" data-reveal>
        {["Next.js", "React 19", "TypeScript", "Prisma", "Postgres", "Vercel", "Sleeper API", "FantasyCalc", "ESPN scoreboard"].map((s) => (
          <span key={s}>{s}</span>
        ))}
      </div>
    </section>
  );
}
