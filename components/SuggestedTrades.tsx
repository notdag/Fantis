"use client";

import { useMemo } from "react";
import { posChipStyle } from "@/lib/players";
import { useTradeValues } from "@/lib/useTradeValues";
import { findTradeSuggestions } from "@/lib/tradeSuggestions";
import type { LeagueBundle } from "@/lib/types";

// Real bench-depth-based trade ideas, shown above the full league board —
// see lib/tradeSuggestions.ts for the methodology and why it's scoped to
// RB/WR only (QB's inflated point scale makes cross-position comparisons
// misleading).
export default function SuggestedTrades({
  bundle,
  myUserId,
  onNavigate,
}: {
  bundle: LeagueBundle;
  myUserId: string | null;
  onNavigate: (tab: "trade") => void;
}) {
  const values = useTradeValues();
  const valuesLoading = Object.keys(values).length === 0;
  const myTeam = bundle.teams.find((t) => t.ownerId === myUserId) ?? null;

  const suggestions = useMemo(
    () => (valuesLoading || !myTeam ? [] : findTradeSuggestions(bundle, myTeam.rid, values)),
    [bundle, myTeam, values, valuesLoading]
  );

  if (!myTeam || valuesLoading || suggestions.length === 0) return null;

  return (
    <section className="sec suggestedtrades">
      <div className="sechead">
        <h2>Suggested Trades</h2>
        <span className="rt">real bench depth at RB/WR, matched against the rest of the league</span>
      </div>
      <div className="tradecards">
        {suggestions.map((s) => (
          <div className="tradecard" key={s.partnerRid}>
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
            <div className="tradecardfoot">
              {s.partnerName} is thin at {s.givePos}
              {" "}on their bench; you&rsquo;re deeper there than you are at {s.receivePos}.
            </div>
          </div>
        ))}
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        Same season-projection trade math as the Trade calculator, matched against real roster
        depth — a starting point to evaluate, not an offer to send blind.{" "}
        <button className="linklike" onClick={() => onNavigate("trade")}>
          Open Trade calculator →
        </button>
      </p>
    </section>
  );
}
