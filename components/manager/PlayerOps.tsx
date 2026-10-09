"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SectionHead } from "./PageHead";
import { openCommandCenter } from "./FloatingCommandCenter";
import { requestChatPrefill } from "./ccStore";

// Player Operations (Command Center 2.0): one player, every league — where he is (yours / another team / waivers / free)
// and the plan buttons that go with it. Plans are drafted by the Command Center chat (drops, FAAB bids, IR room and every
// safety rule included) and land in the Review Queue; nothing on this panel sends anything to Sleeper.

type State = "MINE_STARTING" | "MINE_BENCH" | "MINE_IR" | "OTHER_TEAM" | "WAIVER" | "FREE";
interface Row {
  leagueId: string;
  leagueName: string;
  bestBall: boolean;
  state: State;
  detail: string;
}

const GROUPS: { key: string; label: string; states: State[]; color: string }[] = [
  { key: "free", label: "Free agent", states: ["FREE"], color: "var(--mint)" },
  { key: "waiver", label: "On waivers", states: ["WAIVER"], color: "var(--amber)" },
  { key: "mine", label: "On your team", states: ["MINE_STARTING", "MINE_BENCH", "MINE_IR"], color: "var(--bone)" },
  { key: "other", label: "On another team", states: ["OTHER_TEAM"], color: "var(--dim)" },
];

export default function PlayerOps({ playerId, name }: { playerId: string; name: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [hideBestBall, setHideBestBall] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/manager/player-status?playerId=${encodeURIComponent(playerId)}`)
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b.error || `HTTP ${r.status}`);
        if (!cancelled) {
          setRows(b.leagues as Row[]);
          setError("");
        }
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load."));
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  const shown = useMemo(() => (rows ?? []).filter((r) => !hideBestBall || !r.bestBall), [rows, hideBestBall]);
  const by = (states: State[]) => shown.filter((r) => states.includes(r.state));
  const mine = by(["MINE_STARTING", "MINE_BENCH", "MINE_IR"]);
  const addable = by(["FREE", "WAIVER"]);
  const plan = (text: string) => {
    requestChatPrefill(text);
    openCommandCenter();
  };
  const bestBallCount = (rows ?? []).filter((r) => r.bestBall).length;

  return (
    <section className="sec">
      <SectionHead title="Player operations" right="as of the last sync — every send re-checks Sleeper first" />
      {error && <p className="hint" style={{ color: "var(--red)" }}>{error}</p>}
      {!rows && !error && <p className="hint">Checking every league…</p>}
      {rows && (
        <>
          <div className="pops-grid">
            {GROUPS.map((g) => {
              const list = by(g.states);
              return (
                <button key={g.key} type="button" className={`pops-cell${open === g.key ? " on" : ""}`} onClick={() => setOpen((o) => (o === g.key ? null : g.key))} disabled={list.length === 0}>
                  <span className="pops-n" style={{ color: list.length ? g.color : "var(--dim)" }}>{list.length}</span>
                  <span className="pops-l">{g.label}</span>
                </button>
              );
            })}
          </div>
          {bestBallCount > 0 && (
            <button type="button" className={`chip-filter ${hideBestBall ? "on" : ""}`} style={{ marginTop: 8 }} onClick={() => setHideBestBall((v) => !v)}>
              {hideBestBall ? `Best ball hidden (${bestBallCount})` : "Showing best ball"}
            </button>
          )}

          <div className="pops-actions">
            {addable.length > 0 && (
              <button type="button" className="btn sm" onClick={() => plan(`add ${name} everywhere`)}>
                Plan adds in {addable.length} league{addable.length === 1 ? "" : "s"}
              </button>
            )}
            {mine.length > 0 && (
              <>
                <button type="button" className="btn ghost sm" onClick={() => plan(`make sure ${name} starts this week`)}>Plan: start him</button>
                <button type="button" className="btn ghost sm" onClick={() => plan(`put ${name} on IR`)}>Plan: move to IR</button>
                <button type="button" className="btn ghost sm" onClick={() => plan(`drop ${name} everywhere`)}>Plan: drop everywhere</button>
              </>
            )}
            <span className="portmeta">
              Opens the chat with the command typed in — press Enter to draft per-league proposals (drops, FAAB, IR room checked), then send them from the{" "}
              <Link href="/manager/review">Review Queue</Link>.
            </span>
          </div>

          {open && (
            <ul className="pops-list">
              {by(GROUPS.find((g) => g.key === open)!.states).map((r) => (
                <li key={r.leagueId}>
                  <Link href={`/manager/${r.leagueId}`} className="tname">{r.leagueName}</Link>
                  <span className="portmeta">{r.detail}{r.bestBall ? " · best ball" : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
