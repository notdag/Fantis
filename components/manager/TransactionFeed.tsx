"use client";

import { useMemo } from "react";
import Link from "next/link";
import { posChipStyle } from "@/lib/players";
import {
  transactionTypeChipStyle,
  transactionTypeLabel,
  type ManagedTransaction,
} from "@/lib/manager";
import { IconCheck, IconDollar, IconUsers } from "./MgrIcons";

function PlayerList({
  players,
  sign,
  color,
}: {
  players: ManagedTransaction["adds"];
  sign: string;
  color: string;
}) {
  if (!players || players.length === 0) return null;
  return (
    <span className="portmeta" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {players.map((p) => (
        <span key={p.playerId} style={{ color, display: "inline-flex", alignItems: "center", gap: 4 }}>
          {sign} {p.playerName}
          {p.pos && (
            <span className="pos" style={{ ...posChipStyle(p.pos), fontSize: 10 }}>
              {p.pos}
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

export default function TransactionFeed({
  recent,
  thisWeek,
  currentWeek,
  inSeasonLeagueCount,
}: {
  recent: ManagedTransaction[];
  thisWeek: ManagedTransaction[];
  currentWeek: number | null;
  inSeasonLeagueCount: number;
}) {
  const summary = useMemo(() => {
    const complete = thisWeek.filter((t) => t.status === "complete");
    const trades = complete.filter((t) => t.type === "trade").length;
    const waiver = complete.filter((t) => t.type === "waiver").length;
    const freeAgent = complete.filter((t) => t.type === "free_agent").length;
    const waiverRows = complete.filter((t) => t.type === "waiver" && t.waiverBid != null);
    const faabSpent = waiverRows.reduce((sum, t) => sum + (t.waiverBid ?? 0), 0);
    const activeLeagues = new Set(complete.map((t) => t.leagueId)).size;
    return { complete, trades, waiver, freeAgent, faabSpent, waiverClaims: waiverRows.length, activeLeagues };
  }, [thisWeek]);

  const dayKey = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const groups = useMemo(() => {
    const map = new Map<string, ManagedTransaction[]>();
    for (const t of recent) {
      const key = dayKey(t.createdAt);
      (map.get(key) ?? map.set(key, []).get(key)!).push(t);
    }
    return map;
  }, [recent]);

  return (
    <>
      <section className="sec" style={{ paddingBottom: 0 }}>
        <div className="mgrhead">
          <div className="mgraccentbar" />
          <h1>Transactions</h1>
          <p>
            Real trades, waiver claims, and free-agent pickups across every synced league — filed
            under whichever week they happened, current week{currentWeek != null ? ` (${currentWeek})` : ""}{" "}
            shown in the summary below.
          </p>
        </div>
        <div className="mgrherorow">
          <div className="mgrstat">
            <div
              className="mgrstaticon"
              style={{ color: "var(--bone)", background: "color-mix(in srgb, var(--bone) 12%, transparent)" }}
            >
              <IconCheck width={17} height={17} />
            </div>
            <div className="mgrstatbody">
              <p className="mgrstatlabel">Moves this week</p>
              <p className="mgrstatvalue">{summary.complete.length}</p>
              <p className="mgrstatsub">
                {summary.trades} trades · {summary.waiver} waiver · {summary.freeAgent} free agent
              </p>
            </div>
          </div>
          <div className="mgrstat">
            <div
              className="mgrstaticon"
              style={{ color: "var(--amber)", background: "color-mix(in srgb, var(--amber) 16%, transparent)" }}
            >
              <IconDollar width={17} height={17} />
            </div>
            <div className="mgrstatbody">
              <p className="mgrstatlabel">FAAB spent</p>
              <p className="mgrstatvalue" style={{ color: "var(--amber)" }}>${summary.faabSpent}</p>
              <p className="mgrstatsub">across {summary.waiverClaims} claims</p>
            </div>
          </div>
          <div className="mgrstat">
            <div
              className="mgrstaticon"
              style={{
                color: summary.activeLeagues * 2 >= inSeasonLeagueCount ? "var(--mint)" : "var(--muted)",
                background: `color-mix(in srgb, ${summary.activeLeagues * 2 >= inSeasonLeagueCount ? "var(--mint)" : "var(--muted)"} 16%, transparent)`,
              }}
            >
              <IconUsers width={17} height={17} />
            </div>
            <div className="mgrstatbody">
              <p className="mgrstatlabel">Leagues active</p>
              <p className="mgrstatvalue">{summary.activeLeagues}</p>
              <p className="mgrstatsub">of {inSeasonLeagueCount} in-season leagues</p>
            </div>
          </div>
        </div>
      </section>

      {recent.length === 0 ? (
        <section className="sec">
          <p className="hint">
            No transactions synced yet — run a sync during the season to start building this feed.
          </p>
        </section>
      ) : (
        Array.from(groups.entries()).map(([day, rows]) => (
          <section className="sec" key={day}>
            <div className="sechead">
              <h2 style={{ fontSize: 18 }}>{day}</h2>
              <span className="rt">{rows.length} moves</span>
            </div>
            <div className="mgrtable">
              {rows.map((t) => (
                <Link href={`/manager/${t.leagueId}`} className="mgrrow" key={t.id}>
                  <span className="portmeta" style={{ minWidth: 60 }}>
                    {new Date(t.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  </span>
                  <span className="tname" style={{ flex: 1 }}>{t.leagueName}</span>
                  <span className="pos" style={transactionTypeChipStyle(t.type)}>
                    {transactionTypeLabel(t.type)}
                  </span>
                  {t.status !== "complete" && (
                    <span className="portmeta" style={{ color: "var(--dim)" }}>{t.status}</span>
                  )}
                  <PlayerList players={t.adds} sign="+" color="var(--mint)" />
                  <PlayerList players={t.drops} sign="−" color="var(--red)" />
                  {t.waiverBid != null && (
                    <span className="portmeta" style={{ color: "var(--amber)" }}>${t.waiverBid}</span>
                  )}
                  {t.creatorTeamName && (
                    <span className="portmeta">{t.creatorTeamName}</span>
                  )}
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}
