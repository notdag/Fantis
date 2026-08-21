"use client";

import { useEffect, useMemo, useState } from "react";
import { getPlayers, playerPhotoUrl } from "@/lib/sleeper";
import { posChipStyle } from "@/lib/players";
import { alertSeverityChipStyle } from "@/lib/manager";
import type { PlayerMap } from "@/lib/types";
import { IconFlag, IconShield, IconUsers } from "./MgrIcons";
import { PageHead, SectionHead } from "./PageHead";
import { StatCard, StatCardGrid } from "./StatCard";
import { DataTable, TableRow } from "./DataRow";

export interface InjuryLeagueRow {
  leagueId: string;
  leagueName: string;
  players: string[];
  starters: string[];
}

function Avatar({ playerId, pos, size }: { playerId: string; pos?: string; size: number }) {
  const ring = pos ? posChipStyle(pos).color : "var(--line)";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="mgravatar"
      src={playerPhotoUrl(playerId)}
      alt=""
      style={{ width: size, height: size, borderColor: ring }}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
      }}
    />
  );
}

export default function InjuryReport({ leagues }: { leagues: InjuryLeagueRow[] }) {
  const [pmap, setPmap] = useState<PlayerMap | null>(null);
  useEffect(() => {
    let cancelled = false;
    getPlayers()
      .then((m) => {
        if (!cancelled) setPmap(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Same real "is this player effectively unavailable" definition already
  // used everywhere else in the app (checkInjuredStarters in
  // managerAlerts.ts, components/Portfolio.tsx) — Out/Doubtful/IR, not a
  // new invented category. Bench players are included here on purpose:
  // the existing injured_starter alert only covers starters.
  const byStatus = useMemo(() => {
    if (!pmap) return new Map<string, { leagueId: string; leagueName: string; playerId: string; starting: boolean }[]>();
    const map = new Map<string, { leagueId: string; leagueName: string; playerId: string; starting: boolean }[]>();
    const seen = new Set<string>();
    for (const lg of leagues) {
      for (const playerId of lg.players) {
        const entry = pmap[playerId];
        if (!entry?.inj || !/out|doubtful|ir/i.test(entry.inj)) continue;
        const key = `${lg.leagueId}:${playerId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const list = map.get(entry.inj) ?? [];
        list.push({ leagueId: lg.leagueId, leagueName: lg.leagueName, playerId, starting: lg.starters.includes(playerId) });
        map.set(entry.inj, list);
      }
    }
    return map;
  }, [leagues, pmap]);

  // Real Sleeper status strings, ordered most to least urgent — "Out" and
  // "IR" first since those are the ones you can't get points from at all.
  const STATUS_ORDER = ["Out", "IR", "Doubtful"];
  const statuses = Array.from(byStatus.keys()).sort((a, b) => {
    const ai = STATUS_ORDER.indexOf(a);
    const bi = STATUS_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  const loading = !pmap;
  const totalStarting = Array.from(byStatus.values()).flat().filter((r) => r.starting).length;
  const outCount = byStatus.get("Out")?.length ?? 0;
  const doubtfulCount = byStatus.get("Doubtful")?.length ?? 0;
  const irCount = byStatus.get("IR")?.length ?? 0;

  return (
    <>
      <section className="sec" style={{ paddingBottom: 0 }}>
        <PageHead
          title="Injury Report"
          description="Every rostered player listed Out, Doubtful, or IR across every in-season league — bench included, not just the starters the existing alerts already cover."
        />
        {!loading && (outCount + doubtfulCount + irCount) > 0 && (
          <StatCardGrid variant="grid">
            <StatCard icon={IconFlag} color="var(--red)" label="Out" value={outCount} valueColor="var(--red)" />
            <StatCard icon={IconFlag} color="var(--amber)" label="Doubtful" value={doubtfulCount} valueColor="var(--amber)" />
            <StatCard icon={IconShield} color="var(--red)" label="IR" value={irCount} valueColor="var(--red)" />
            <StatCard
              icon={IconUsers}
              color={totalStarting > 0 ? "var(--red)" : "var(--mint)"}
              label="Starting while injured"
              value={totalStarting}
              valueColor={totalStarting > 0 ? "var(--red)" : undefined}
              sub={totalStarting > 0 ? "already have a real alert on Today" : undefined}
            />
          </StatCardGrid>
        )}
      </section>

      {loading ? (
        <section className="sec">
          <p className="hint">Loading real roster and injury data…</p>
        </section>
      ) : statuses.length === 0 ? (
        <section className="sec">
          <p className="hint">Nobody rostered across your leagues is currently Out, Doubtful, or IR.</p>
        </section>
      ) : (
        statuses.map((status) => {
          const rows = byStatus.get(status)!;
          return (
            <section className="sec" key={status}>
              <SectionHead title={status} right={`${rows.length} rostered`} />
              <DataTable>
                {rows.map((r, i) => {
                  const entry = pmap![r.playerId];
                  return (
                    <TableRow as="link" href={`/manager/${r.leagueId}`} key={`${r.leagueId}-${r.playerId}-${i}`}>
                      <Avatar playerId={r.playerId} pos={entry.p} size={26} />
                      <span className="mgrplayername">{entry.n}</span>
                      {entry.p && (
                        <span className="pos" style={posChipStyle(entry.p)}>
                          {entry.p}
                        </span>
                      )}
                      <span className="tname" style={{ flex: 1 }}>{r.leagueName}</span>
                      {r.starting && (
                        <span className="pos" style={alertSeverityChipStyle("action_required")}>
                          starting
                        </span>
                      )}
                    </TableRow>
                  );
                })}
              </DataTable>
            </section>
          );
        })
      )}
    </>
  );
}
