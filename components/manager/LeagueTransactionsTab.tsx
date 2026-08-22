"use client";

import { type ManagedLeague } from "@/lib/manager";
import { transactionTypeChipStyle, transactionTypeLabel, type ManagedTransaction } from "@/lib/manager";
import { posChipStyle } from "@/lib/players";
import LeagueIdentityBar from "./LeagueIdentityBar";
import { SectionHead } from "./PageHead";
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

// Same real data as the portfolio-wide /manager/transactions feed, just
// pre-filtered to this league (a trivial where:{leagueId} on the same
// LeagueTransaction table) — no hero-row summary here since one league's
// weekly activity is already a small, directly-scannable list.
export default function LeagueTransactionsTab({
  league,
  transactions,
}: {
  league: ManagedLeague;
  transactions: ManagedTransaction[];
}) {
  return (
    <>
      <LeagueIdentityBar league={league} />
      <section className="sec">
        <SectionHead title="Transactions" right="most recent first" />
        {transactions.length === 0 ? (
          <p className="hint">No transactions synced yet for this league.</p>
        ) : (
          <DataTable>
            {transactions.map((t) => (
              <TableRow key={t.id}>
                <span className="portmeta" style={{ minWidth: 60 }}>
                  {new Date(t.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
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
                {t.creatorTeamName && <span className="portmeta">{t.creatorTeamName}</span>}
              </TableRow>
            ))}
          </DataTable>
        )}
      </section>
    </>
  );
}
