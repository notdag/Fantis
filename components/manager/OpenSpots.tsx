"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlayerMap } from "@/lib/usePlayerMap";
import { EMPTY_PREFS, loadPrefs, type PlayerPrefs } from "@/lib/playerPrefs";
import { buildIrPlan, type PlanLeague } from "@/lib/bulkPlan";
import { IconCheck, IconUsers } from "./MgrIcons";
import { PageHead, SectionHead } from "./PageHead";
import { StatCard, StatCardGrid } from "./StatCard";
import { DataTable, TableRow } from "./DataRow";
import ConnectWriteAccess from "./ConnectWriteAccess";
import BulkAdd from "./BulkAdd";
import { useDropRank } from "./useDropRank";
import type { LineupLeague } from "./LineupManager";

export default function OpenSpots({ leagues }: { leagues: LineupLeague[] }) {
  const { pmap } = usePlayerMap();
  const [token, setToken] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<PlayerPrefs>(EMPTY_PREFS);
  useEffect(() => {
    let cancelled = false;
    loadPrefs()
      .then((p) => { if (!cancelled) setPrefs(p); })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const open = useMemo(
    () =>
      leagues
        .filter((l) => l.roster)
        .map((l) => {
          const limit = l.rosterPositions.length;
          const active = l.roster!.players.length - l.roster!.reserve.length;
          return { leagueId: l.league.id, leagueName: l.league.name, active, limit, spots: limit - active, league: l };
        })
        .filter((l) => l.spots > 0)
        .sort((a, b) => b.spots - a.spots || a.leagueName.localeCompare(b.leagueName)),
    [leagues]
  );
  const totalSpots = open.reduce((sum, l) => sum + l.spots, 0);
  const openLeagues = useMemo(() => open.map((l) => l.league), [open]);

  // ---- preview only: which leagues would open a bench spot if the bulk IR
  // move (Command Center's "move all my IR eligible players to IR", or Mass
  // IR) were actually run. Same buildIrPlan real logic those use — this page
  // never moves anything, it only previews.
  const rank = useDropRank(pmap);
  const isPriority = useCallback((id: string) => prefs.priority.includes(id), [prefs.priority]);
  const irPlanLeagues = useMemo<PlanLeague[]>(
    () =>
      leagues
        .filter((l) => l.roster)
        .map((l) => ({
          leagueId: l.league.id,
          leagueName: l.league.name,
          rosterId: l.roster!.rosterId,
          settings: l.league.settings,
          starters: l.roster!.starters,
          players: l.roster!.players,
          reserve: l.roster!.reserve,
          faabUsed: l.roster!.faabUsed,
        })),
    [leagues]
  );
  const irRows = useMemo(
    () => (pmap ? buildIrPlan(irPlanLeagues, (id) => pmap[id]?.inj ?? null, rank, isPriority) : []),
    [irPlanLeagues, pmap, rank, isPriority]
  );
  const irMovable = irRows.filter((r) => !r.noRoom);
  const irBlocked = irRows.length - irMovable.length;
  // A player moving active → reserve always frees an active slot behind him
  // — real roster math, same rule the chat command's own report uses — but
  // only for moves that could actually happen (noRoom ones can't).
  const irOpenAfter = useMemo(() => {
    const movesByLeague = new Map<string, number>();
    for (const r of irMovable) movesByLeague.set(r.leagueId, (movesByLeague.get(r.leagueId) ?? 0) + 1);
    const limitByLeague = new Map(leagues.map((l) => [l.league.id, l.rosterPositions.length]));
    const out: { leagueId: string; leagueName: string; slots: number; moves: number }[] = [];
    for (const [leagueId, moves] of movesByLeague) {
      const lg = irPlanLeagues.find((p) => p.leagueId === leagueId);
      const limit = limitByLeague.get(leagueId);
      if (!lg || limit == null) continue;
      const activeBefore = lg.players.length - lg.reserve.length;
      const slots = Math.max(0, limit - (activeBefore - moves));
      if (slots > 0) out.push({ leagueId, leagueName: lg.leagueName, slots, moves });
    }
    return out.sort((a, b) => b.slots - a.slots || a.leagueName.localeCompare(b.leagueName));
  }, [irMovable, irPlanLeagues, leagues]);
  const irLeagueCount = new Set(irRows.map((r) => r.leagueId)).size;

  return (
    <>
      <section className="sec" style={{ paddingBottom: 0 }}>
        <PageHead
          description={
            <>
              Every in-season league where your active roster (IR excluded) isn&rsquo;t full —
              a waiver add there wouldn&rsquo;t need a drop first.
            </>
          }
        />
        <StatCardGrid variant="hero">
          <StatCard
            icon={IconUsers}
            color={open.length > 0 ? "var(--mint)" : "var(--muted)"}
            label="Leagues with an open spot"
            value={open.length}
            valueColor={open.length > 0 ? "var(--mint)" : undefined}
            sub={`of ${leagues.length} scanned`}
          />
          <StatCard icon={IconCheck} color="var(--muted)" label="Total open spots" value={totalSpots} />
        </StatCardGrid>
      </section>

      <section className="sec">
        {leagues.length === 0 ? (
          <p className="hint">No in-season leagues synced yet.</p>
        ) : open.length === 0 ? (
          <p className="hint">Every roster is full right now — nothing to add without a drop.</p>
        ) : (
          <DataTable>
            {open.map((l) => (
              <TableRow as="link" href={`/manager/${l.leagueId}`} key={l.leagueId}>
                <span className="tname" style={{ flex: 1 }}>{l.leagueName}</span>
                <span className="portmeta">{l.active}/{l.limit} filled</span>
                <span className="portmeta" style={{ color: "var(--mint)", fontWeight: 600, minWidth: 70, textAlign: "right" }}>
                  {l.spots} open
                </span>
              </TableRow>
            ))}
          </DataTable>
        )}
      </section>

      <section className="sec">
        <SectionHead
          title="If you ran the IR sweep"
          right={pmap ? `${irRows.length} real IR-eligible across ${irLeagueCount} league${irLeagueCount === 1 ? "" : "s"}` : undefined}
        />
        <p className="hint" style={{ margin: "0 0 12px" }}>
          A preview only — nothing is moved here. Run &ldquo;move all my IR eligible players to
          IR&rdquo; in Command Center, or use Mass IR, to actually do it.
        </p>
        {!pmap ? (
          <p className="hint">Loading players…</p>
        ) : irRows.length === 0 ? (
          <p className="hint">Nobody rostered across your leagues is currently IR-eligible.</p>
        ) : irOpenAfter.length === 0 ? (
          <p className="hint">
            {irMovable.length} of those moves could go through, but none would open a bench spot beyond what&rsquo;s already open above.
            {irBlocked > 0 && ` ${irBlocked} more ${irBlocked === 1 ? "is" : "are"} blocked — IR is already full there with nobody real to release first.`}
          </p>
        ) : (
          <>
            <DataTable>
              {irOpenAfter.map((l) => (
                <TableRow as="link" href={`/manager/${l.leagueId}`} key={l.leagueId}>
                  <span className="tname" style={{ flex: 1 }}>{l.leagueName}</span>
                  <span className="portmeta">{l.moves} move{l.moves === 1 ? "" : "s"} to IR</span>
                  <span className="portmeta" style={{ color: "var(--mint)", fontWeight: 600, minWidth: 90, textAlign: "right" }}>
                    {l.slots} would open
                  </span>
                </TableRow>
              ))}
            </DataTable>
            {irBlocked > 0 && (
              <p className="hint" style={{ margin: "8px 0 0" }}>
                {irBlocked} more eligible player{irBlocked === 1 ? " is" : "s are"} blocked — IR is already full there with nobody real to release first.
              </p>
            )}
          </>
        )}
      </section>

      {open.length > 0 && (
        <section className="sec">
          <SectionHead
            title="Waiver a player into these leagues"
            right={`${open.length} league${open.length === 1 ? "" : "s"}, no drop needed`}
          />
          <ConnectWriteAccess onTokenReady={setToken} />
          <BulkAdd leagues={openLeagues} pmap={pmap} token={token} prefs={prefs} />
        </section>
      )}
    </>
  );
}
