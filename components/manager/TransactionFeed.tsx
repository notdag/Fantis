"use client";

import { useMemo, useState } from "react";
import { posChipStyle } from "@/lib/players";
import {
  transactionTypeChipStyle,
  transactionTypeLabel,
  type ManagedTransaction,
} from "@/lib/manager";
import { IconCheck, IconDollar, IconUsers } from "./MgrIcons";
import { PageHead, SectionHead } from "./PageHead";
import { StatCard, StatCardGrid } from "./StatCard";
import { DataTable, TableRow } from "./DataRow";

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

  // Type filter — the feed used to be every trade/waiver/free-agent move
  // mixed together with no way to isolate just trades, making "show me my
  // trade history" a scroll through everything else first.
  const [typeFilter, setTypeFilter] = useState<"all" | "trade" | "waiver" | "free_agent">("all");
  const filteredRecent = useMemo(
    () => (typeFilter === "all" ? recent : recent.filter((t) => t.type === typeFilter)),
    [recent, typeFilter]
  );

  const dayKey = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const groups = useMemo(() => {
    const map = new Map<string, ManagedTransaction[]>();
    for (const t of filteredRecent) {
      const key = dayKey(t.createdAt);
      (map.get(key) ?? map.set(key, []).get(key)!).push(t);
    }
    return map;
  }, [filteredRecent]);

  return (
    <>
      <section className="sec" style={{ paddingBottom: 0 }}>
        <PageHead
          description={
            <>
              Real trades, waiver claims, and free-agent pickups across every synced league —
              filed under whichever week they happened, current week
              {currentWeek != null ? ` (${currentWeek})` : ""} shown in the summary below.
            </>
          }
        />
        <StatCardGrid variant="hero">
          <StatCard
            icon={IconCheck}
            label="Moves this week"
            value={summary.complete.length}
            sub={`${summary.trades} trades · ${summary.waiver} waiver · ${summary.freeAgent} free agent`}
          />
          <StatCard
            icon={IconDollar}
            color="var(--amber)"
            label="FAAB spent"
            value={`$${summary.faabSpent}`}
            valueColor="var(--amber)"
            sub={`across ${summary.waiverClaims} claims`}
          />
          <StatCard
            icon={IconUsers}
            color={summary.activeLeagues * 2 >= inSeasonLeagueCount ? "var(--mint)" : "var(--muted)"}
            label="Leagues active"
            value={summary.activeLeagues}
            sub={`of ${inSeasonLeagueCount} in-season leagues`}
          />
        </StatCardGrid>
      </section>

      {recent.length === 0 ? (
        <section className="sec">
          <p className="hint">
            No transactions synced yet — run a sync during the season to start building this feed.
          </p>
        </section>
      ) : (
        <>
          <section className="sec" style={{ paddingBottom: 0 }}>
            <div className="field" style={{ marginBottom: 0, gap: 8 }}>
              {(
                [
                  ["all", `All (${recent.length})`],
                  ["trade", `Trades (${recent.filter((t) => t.type === "trade").length})`],
                  ["waiver", `Waivers (${recent.filter((t) => t.type === "waiver").length})`],
                  ["free_agent", `Free agents (${recent.filter((t) => t.type === "free_agent").length})`],
                ] as const
              ).map(([k, label]) => (
                <button key={k} className={`chip-filter ${typeFilter === k ? "on" : ""}`} onClick={() => setTypeFilter(k)}>
                  {label}
                </button>
              ))}
            </div>
          </section>
          {filteredRecent.length === 0 && (
            <section className="sec">
              <p className="hint">No {typeFilter.replace("_", " ")} transactions in this feed.</p>
            </section>
          )}
          {Array.from(groups.entries()).map(([day, rows]) => (
          <section className="sec" key={day}>
            <SectionHead title={day} right={`${rows.length} moves`} />
            <DataTable>
              {rows.map((t) => (
                <TableRow as="link" href={`/manager/${t.leagueId}`} key={t.id}>
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
                </TableRow>
              ))}
            </DataTable>
          </section>
          ))}
        </>
      )}
    </>
  );
}
