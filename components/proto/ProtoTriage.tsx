"use client";

/*
 * THESIS: managing 200+ leagues is a queue, not a dashboard — one problem at a time, with its evidence and its fix,
 *   then the next — instead of a page of cards and tables to scan.
 * OWN-WORLD: near-white ground, near-black ink, a fine neutral scale, one field-green accent spent only on the primary
 *   action and progress; hairline borders, ghost secondary buttons, generous space, Geist at two weights.
 * STORY: the owner opens the inbox, sees every problem grouped with counts, works through them with one key or click
 *   each, and leaves knowing the queue is empty.
 * FIRST VIEWPORT: thin top bar; the grouped inbox on the left; the current problem large in the centre with its proof
 *   and one green primary action; the week at a glance on the right.
 * FORM: challenger fusion (monochrome product canon) for the second prototype, seed 8ddced95.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProtoData, ProtoLeague } from "@/lib/protoData";
import "./triage.css";

type Group = "empty" | "injured" | "bye" | "over" | "open" | "other";
interface Item {
  key: string;
  group: Group;
  league: ProtoLeague;
  title: string;
  detail: string;
  action: { label: string; href: string };
}

const GROUPS: { id: Group; label: string; hint: string }[] = [
  { id: "empty", label: "Empty starting slot", hint: "Scores zero if left" },
  { id: "injured", label: "Injured starter", hint: "Out or doubtful in a lineup" },
  { id: "bye", label: "Bye-week starter", hint: "Not playing this week" },
  { id: "over", label: "Over the roster limit", hint: "Sleeper blocks lineup changes" },
  { id: "open", label: "Open roster spot", hint: "Room to add someone" },
  { id: "other", label: "Other alerts", hint: "Drafts, deadlines, orphan teams" },
];

function Icon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export default function ProtoTriage({ data }: { data: ProtoData }) {
  const byId = useMemo(() => new Map(data.leagues.map((l) => [l.id, l])), [data.leagues]);
  const items = useMemo(() => {
    const out: Item[] = [];
    const seen = new Set<string>();
    for (const a of data.alerts) {
      const league = byId.get(a.leagueId);
      if (!league || league.bestBall) continue;
      const group: Group = a.type === "empty_slot" ? "empty" : a.type === "injured_starter" ? "injured" : a.type === "bye_starter" ? "bye" : "other";
      seen.add(`${group}:${a.leagueId}`);
      out.push({
        key: a.id,
        group,
        league,
        title: a.message,
        detail: GROUPS.find((g) => g.id === group)!.hint,
        action: group === "other" ? { label: "Open league", href: `/manager/${a.leagueId}` } : { label: "Fix the lineup", href: "/manager/lineups" },
      });
    }
    for (const l of data.leagues) {
      if (l.bestBall) continue;
      if (l.emptySlots > 0 && !seen.has(`empty:${l.id}`))
        out.push({ key: `e:${l.id}`, group: "empty", league: l, title: `${l.emptySlots} empty starting slot${l.emptySlots > 1 ? "s" : ""}`, detail: "Scores zero if left", action: { label: "Fix the lineup", href: "/manager/lineups" } });
      if (l.openSpots < 0)
        out.push({ key: `o:${l.id}`, group: "over", league: l, title: `Roster is ${-l.openSpots} over the limit`, detail: "Sleeper won't accept lineup changes until someone is dropped", action: { label: "Open league", href: `/manager/${l.id}` } });
      if (l.openSpots > 0)
        out.push({ key: `s:${l.id}`, group: "open", league: l, title: `${l.openSpots} open roster spot${l.openSpots > 1 ? "s" : ""}`, detail: "A free agent or waiver claim can go straight in, no drop needed", action: { label: "Fill the spot", href: "/manager/open-spots" } });
    }
    const order = GROUPS.map((g) => g.id);
    return out.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.league.name.localeCompare(b.league.name, undefined, { numeric: true }));
  }, [data.alerts, data.leagues, byId]);

  const [done, setDone] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Group | null>(null);
  const queue = useMemo(() => items.filter((i) => !done.has(i.key)), [items, done]);
  const [curKey, setCurKey] = useState<string | null>(null);
  const cur = queue.find((i) => i.key === curKey) ?? queue[0] ?? null;
  const idx = cur ? queue.indexOf(cur) : -1;

  const go = useCallback((d: number) => {
    if (!queue.length) return;
    const n = queue[(Math.max(0, idx) + d + queue.length) % queue.length];
    setCurKey(n.key);
  }, [queue, idx]);
  const markDone = useCallback(() => {
    if (!cur) return;
    const next = queue[idx + 1] ?? queue[idx - 1] ?? null;
    setDone((s) => new Set(s).add(cur.key));
    setCurKey(next?.key ?? null);
  }, [cur, queue, idx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        go(1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "e") {
        e.preventDefault();
        markDone();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, markDone]);

  const active = data.leagues.filter((l) => !l.bestBall);
  const rec = active.reduce((a, l) => [a[0] + l.wins, a[1] + l.losses], [0, 0]);
  const win = active.filter((l) => l.wins > l.losses).length;
  const lose = active.filter((l) => l.wins < l.losses).length;
  const synced = Math.min(...active.map((l) => l.syncedHoursAgo ?? 999));
  const countOf = (g: Group) => queue.filter((i) => i.group === g).length;
  const total = items.length;

  return (
    <div className="tr">
      <header className="tr-top">
        <Link href="/proto" className="tr-brand">Fantis</Link>
        <Link href="/manager" className="tr-search">
          <Icon d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3" />
          <span>Search leagues and players</span>
          <kbd>Ctrl K</kbd>
        </Link>
        <nav className="tr-links" aria-label="Tools">
          <Link href="/manager/lineups">Lineups</Link>
          <Link href="/manager/waiver">Waivers</Link>
          <Link href="/manager/teams">Leagues</Link>
          <Link href="/manager/review">Review{data.plansWaiting ? ` · ${data.plansWaiting}` : ""}</Link>
        </nav>
        <span className="tr-sync">{synced < 999 ? `Synced ${synced < 1 ? "under an hour" : `${synced}h`} ago` : "Not synced"}</span>
      </header>

      <div className="tr-body">
        <aside className="tr-inbox" aria-label="Inbox">
          <div className="tr-inbox-h">
            <h2>Inbox</h2>
            <span>{queue.length} left</span>
          </div>
          <div className="tr-progress" aria-hidden><i style={{ width: `${total ? ((total - queue.length) / total) * 100 : 100}%` }} /></div>
          <ul>
            {GROUPS.map((g) => {
              const n = countOf(g.id);
              const list = queue.filter((i) => i.group === g.id);
              return (
                <li key={g.id}>
                  <button className={`tr-group${open === g.id ? " open" : ""}`} onClick={() => setOpen((o) => (o === g.id ? null : g.id))} aria-expanded={open === g.id} disabled={n === 0}>
                    <span>{g.label}</span>
                    <b>{n}</b>
                  </button>
                  {open === g.id && n > 0 && (
                    <ul className="tr-sub">
                      {list.map((i) => (
                        <li key={i.key}>
                          <button className={cur?.key === i.key ? "on" : ""} onClick={() => setCurKey(i.key)}>{i.league.name}</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          {done.size > 0 && (
            <button className="tr-undo" onClick={() => setDone(new Set())}>Bring back {done.size} marked done</button>
          )}
        </aside>

        <main className="tr-focus">
          {cur ? (
            <>
              <p className="tr-pos">
                {GROUPS.find((g) => g.id === cur.group)!.label} · {idx + 1} of {queue.length}
              </p>
              <Link href={`/manager/${cur.league.id}`} className="tr-league">{cur.league.name}</Link>
              <h1>{cur.title}</h1>
              <p className="tr-why">{cur.detail}.</p>

              <dl className="tr-facts">
                <div><dt>Record</dt><dd>{cur.league.wins}–{cur.league.losses}{cur.league.ties ? `–${cur.league.ties}` : ""}</dd></div>
                <div><dt>Standing</dt><dd>{cur.league.rank ? `${cur.league.rank} of ${cur.league.teams}` : "—"}</dd></div>
                <div><dt>This week</dt><dd>{cur.league.myPts && cur.league.myPts > 0 ? `${cur.league.myPts.toFixed(1)} – ${cur.league.oppPts?.toFixed(1) ?? "—"}` : cur.league.oppName ? `vs ${cur.league.oppName}` : "—"}</dd></div>
                <div><dt>Roster</dt><dd>{cur.league.openSpots > 0 ? `${cur.league.openSpots} open` : cur.league.openSpots < 0 ? `${-cur.league.openSpots} over` : "full"}</dd></div>
                <div><dt>IR</dt><dd>{cur.league.irTotal ? `${cur.league.irUsed} of ${cur.league.irTotal}` : "none"}</dd></div>
                <div><dt>FAAB</dt><dd>{cur.league.faabLeft == null ? "—" : `$${cur.league.faabLeft} left`}</dd></div>
              </dl>

              <div className="tr-actions">
                <Link className="tr-primary" href={cur.action.href}>{cur.action.label}</Link>
                <button className="tr-ghost" onClick={markDone}>Mark done <kbd>E</kbd></button>
                <button className="tr-ghost" onClick={() => go(1)}>Next <kbd>J</kbd></button>
              </div>
              <p className="tr-small">&ldquo;Mark done&rdquo; only clears it from this list; the next sync checks it again.</p>
            </>
          ) : (
            <div className="tr-clear">
              <h1>Inbox clear</h1>
              <p>Nothing left to fix across {active.length} leagues. The next sync will bring back anything new.</p>
              {done.size > 0 && <button className="tr-ghost" onClick={() => setDone(new Set())}>Show the {done.size} you marked done</button>}
            </div>
          )}
        </main>

        <aside className="tr-glance" aria-label="This week at a glance">
          <h2>At a glance</h2>
          <dl>
            <div><dt>Season record</dt><dd>{rec[0]}–{rec[1]}</dd></div>
            <div><dt>Leagues winning</dt><dd>{win}</dd></div>
            <div><dt>Leagues losing</dt><dd>{lose}</dd></div>
            <div><dt>Active leagues</dt><dd>{active.length}</dd></div>
            <div><dt>Chat plans waiting</dt><dd>{data.plansWaiting}</dd></div>
          </dl>
          <p className="tr-small">Prototype D · real data from your last sync · nothing here changes Sleeper · <Link href="/proto/sports">prototype C</Link></p>
        </aside>
      </div>
    </div>
  );
}
