"use client";

import { useMemo, useState } from "react";
import { PLAYERS, posChipStyle } from "@/lib/players";
import { useTradeValues } from "@/lib/useTradeValues";
import { useFantasyCalcValues, fantasyCalcValue, type FantasyCalcMaps } from "@/lib/fantasyCalc";
import { findTradeSuggestions, type TradeSuggestion, type RosterPlayerLite } from "@/lib/tradeSuggestions";
import { stripSuffix } from "@/lib/playerIdMap";
import type { TradeValueResult } from "@/lib/tradeValue";
import type { LeagueBundle, Player } from "@/lib/types";

// A roster player from a suggestion may not be in the curated PLAYERS list
// (suggestions are scoped to real bench depth, not just the top of the
// market) — fall back to what the suggestion itself knows (pos/team), with
// tier/posRank left at 0 rather than a fabricated rank. Picked/result rows
// only render posRank when it's real (> 0).
function toPlayer(rp: RosterPlayerLite): Player {
  const curated = PLAYERS.find(
    (p) => p.name === rp.name || stripSuffix(p.name) === stripSuffix(rp.name)
  );
  if (curated) return curated;
  return { name: rp.name, pos: rp.pos, team: rp.team, tier: 0, posRank: 0 };
}

export default function Trade({
  sel,
  myUserId,
  onNavigate,
}: {
  sel: LeagueBundle | null;
  myUserId: string | null;
  onNavigate: (tab: "leagues") => void;
}) {
  const [a, setA] = useState<Player[]>([]);
  const [b, setB] = useState<Player[]>([]);
  const values = useTradeValues();
  const fcValues = useFantasyCalcValues();
  const loading = Object.keys(values).length === 0;

  const myTeam = sel?.teams.find((t) => t.ownerId === myUserId) ?? null;
  const suggestions = useMemo(
    () => (!sel || !myTeam || loading ? [] : findTradeSuggestions(sel, myTeam.rid, values)),
    [sel, myTeam, values, loading]
  );

  const applySuggestion = (s: TradeSuggestion) => {
    setA([toPlayer(s.give)]);
    setB([toPlayer(s.receive)]);
  };

  const sum = (picks: Player[]) =>
    picks.reduce((total, p) => total + (values[p.name]?.value ?? 0), 0);
  const missing = (picks: Player[]) => picks.filter((p) => !values[p.name]).length;

  const sumA = sum(a);
  const sumB = sum(b);
  const total = sumA + sumB;
  const missingCount = missing(a) + missing(b);
  const hasPicks = a.length > 0 || b.length > 0;

  // FantasyCalc's real values, purely informational — a second opinion
  // shown alongside Fantis's own methodology, never blended into the
  // tilting verdict bar above (see CLAUDE.md: that bar sums Fantis's own
  // documented calculation, not a resurrected or borrowed score).
  const fcSum = (picks: Player[]) =>
    fcValues ? picks.reduce((t, p) => t + fantasyCalcValue(fcValues, p), 0) : 0;
  const fcSumA = fcSum(a);
  const fcSumB = fcSum(b);

  return (
    <section className="sec">
      <div className="sechead">
        <h2>Trade calculator</h2>
        <span className="rt">value = season proj. pts + weekly market delta</span>
      </div>

      {!sel && (
        <div className="tradenudge">
          <p><b>Sync your league</b> to get trade suggestions built from your team&rsquo;s real bench depth, not just a manual search.</p>
          <button className="btn ghost sm" onClick={() => onNavigate("leagues")}>
            Sync a league →
          </button>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="tradesuggest">
          <div className="tradesuggesthead">
            Suggested for {myTeam?.name}
            <span className="rt">real bench depth at RB/WR, matched against the rest of the league</span>
          </div>
          <div className="tradecards">
            {suggestions.map((s) => (
              <button
                className="tradecard tradecardbtn"
                key={s.partnerRid}
                onClick={() => applySuggestion(s)}
              >
                <div className="tradecardhead">{s.partnerName}</div>
                <div className="tradecardbody">
                  <div className="tradeside">
                    <span className="tradelabel">You send</span>
                    <div className="tradeplrow">
                      <span className="pos" style={posChipStyle(s.give.pos)}>
                        {s.give.pos}
                      </span>
                      <span className="tradeplname">{s.give.name}</span>
                    </div>
                    <span className="tradeval">
                      {s.give.value.toFixed(1)} pts · {s.give.team}
                    </span>
                  </div>
                  <div className="tradearrow">⇄</div>
                  <div className="tradeside">
                    <span className="tradelabel">You get</span>
                    <div className="tradeplrow">
                      <span className="pos" style={posChipStyle(s.receive.pos)}>
                        {s.receive.pos}
                      </span>
                      <span className="tradeplname">{s.receive.name}</span>
                    </div>
                    <span className="tradeval">
                      {s.receive.value.toFixed(1)} pts · {s.receive.team}
                    </span>
                  </div>
                </div>
                <div className="tradecardfoot">Tap to load this trade below →</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="trade">
        <TradeSide
          title="Side A"
          picks={a}
          setPicks={setA}
          accent="var(--mint)"
          other={b}
          values={values}
          fcValues={fcValues}
        />
        <div className="tradevs" aria-hidden="true">
          VS
        </div>
        <TradeSide
          title="Side B"
          picks={b}
          setPicks={setB}
          accent="var(--amber)"
          other={a}
          values={values}
          fcValues={fcValues}
        />
      </div>

      {hasPicks && (
        <div className="verdict" style={{ maxWidth: 640, margin: "22px auto 0" }}>
          {loading ? (
            <p className="hint" style={{ textAlign: "center" }}>
              Loading trade values…
            </p>
          ) : total <= 0 ? (
            <p className="hint" style={{ textAlign: "center" }}>
              No computed trade value for these players yet — Sleeper doesn&rsquo;t have a
              season projection for them.
            </p>
          ) : (
            <>
              <div className="vbar">
                <div
                  className="vfill"
                  style={{ width: `${(sumA / total) * 100}%`, background: "var(--mint)" }}
                />
                <div
                  className="vfill"
                  style={{ width: `${(sumB / total) * 100}%`, background: "var(--amber)" }}
                />
              </div>
              <div className="vlabel">
                {Math.abs(sumA - sumB) < total * 0.02
                  ? "Roughly even"
                  : sumA > sumB
                    ? `Side A favored by ${(sumA - sumB).toFixed(1)} pts`
                    : `Side B favored by ${(sumB - sumA).toFixed(1)} pts`}
              </div>
              {fcValues && fcSumA + fcSumB > 0 && (
                <div className="vlabel-fc">
                  <a href="https://www.fantasycalc.com" target="_blank" rel="noreferrer">
                    FantasyCalc
                  </a>
                  :{" "}
                  {Math.abs(fcSumA - fcSumB) < (fcSumA + fcSumB) * 0.02
                    ? "roughly even"
                    : fcSumA > fcSumB
                      ? `Side A favored by ${Math.round(fcSumA - fcSumB).toLocaleString()}`
                      : `Side B favored by ${Math.round(fcSumB - fcSumA).toLocaleString()}`}
                  {" "}— a second, independently-sourced opinion, not part of the verdict above
                </div>
              )}
            </>
          )}
          {missingCount > 0 && (
            <p className="hint" style={{ textAlign: "center", marginTop: 10 }}>
              {missingCount} player{missingCount > 1 ? "s" : ""} above{" "}
              {missingCount > 1 ? "have" : "has"} no season projection yet and aren&rsquo;t
              counted.
            </p>
          )}
        </div>
      )}

      <div className="methodpanel">
        <h3>How trade value works</h3>
        <ol>
          <li><b>Season baseline</b> — Sleeper&rsquo;s own full-PPR season point projection, the same number shown as &ldquo;Szn Pts&rdquo; in Rankings.</li>
          <li><b>This week&rsquo;s market</b> — if the player has live SportsGameOdds props, they&rsquo;re converted to expected points and compared against that player&rsquo;s own season pace.</li>
          <li><b>Blended once, capped</b> — the gap between market and pace is added to the season value a single time, capped at &plusmn;20% of weekly pace so one thin market can&rsquo;t swing a season number.</li>
          <li><b>No props, no guess</b> — most players most weeks have no live prop market; value is just the season projection, unmodified.</li>
        </ol>
        <p className="hint" style={{ marginTop: 12 }}>Not investment or betting advice.</p>
      </div>
    </section>
  );
}

function TradeSide({
  title,
  picks,
  setPicks,
  accent,
  other,
  values,
  fcValues,
}: {
  title: string;
  picks: Player[];
  setPicks: (p: Player[]) => void;
  accent: string;
  other: Player[];
  values: Record<string, TradeValueResult>;
  fcValues: FantasyCalcMaps | null;
}) {
  const [q, setQ] = useState("");
  const chosen = new Set([...picks, ...other].map((p) => p.name));
  const matches =
    q.trim().length < 1
      ? []
      : PLAYERS.filter(
          (p) => p.name.toLowerCase().includes(q.toLowerCase()) && !chosen.has(p.name)
        )
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, 7);
  const add = (p: Player) => {
    setPicks([...picks, p]);
    setQ("");
  };
  const remove = (n: string) => setPicks(picks.filter((p) => p.name !== n));
  const sideTotal = picks.reduce((s, p) => s + (values[p.name]?.value ?? 0), 0);
  const fcSideTotal = fcValues
    ? picks.reduce((s, p) => s + fantasyCalcValue(fcValues, p), 0)
    : 0;

  return (
    <div className="side">
      <div className="sidehead">
        <h4 style={{ color: accent }}>{title}</h4>
        {picks.length > 0 && <span className="sidetotal">{sideTotal.toFixed(1)} pts</span>}
      </div>
      {picks.length > 0 && fcValues && fcSideTotal > 0 && (
        <div className="sidetotal-fc">FantasyCalc: {Math.round(fcSideTotal).toLocaleString()}</div>
      )}
      {picks.length === 0 && <p className="sideempty">No players added yet</p>}
      {picks.map((p) => {
        const v = values[p.name];
        return (
          <div className="picked" key={p.name}>
            <span className="pos" style={posChipStyle(p.pos)}>
              {p.pos}
              {p.posRank > 0 ? p.posRank : ""}
            </span>
            <span className="plname">{p.name}</span>
            <span className="val">{v ? v.value.toFixed(1) : "—"}</span>
            {fcValues && (
              <span className="val-fc" title="FantasyCalc's own value, via fantasycalc.com">
                FC {Math.round(fantasyCalcValue(fcValues, p)) || "—"}
              </span>
            )}
            <button className="x" onClick={() => remove(p.name)} aria-label={`Remove ${p.name}`}>
              ✕
            </button>
          </div>
        );
      })}
      <div className="search">
        <input
          className="input"
          placeholder="Add a player…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ width: "100%" }}
        />
        {matches.length > 0 && (
          <div className="results">
            {matches.map((p) => (
              <div className="res" key={p.name} onClick={() => add(p)}>
                <span className="pos" style={posChipStyle(p.pos)}>
                  {p.pos}
                  {p.posRank}
                </span>
                <span className="plname">{p.name}</span>
                <span style={{ marginLeft: "auto", color: "var(--dim)" }}>{p.team}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
