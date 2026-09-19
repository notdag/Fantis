"use client";

import { useMemo, useState } from "react";
import { buildStartingSlots, eligiblePositions } from "@/lib/rosterSlots";
import { usePlayerMap } from "@/lib/usePlayerMap";
import { posChipStyle } from "@/lib/players";
import { activateFromIR, moveToIR, setStarters, SleeperGraphQLError } from "@/lib/sleeperWrite";
import { isBestBall, type ManagedLeague, type ManagedRoster } from "@/lib/manager";
import type { PlayerMap } from "@/lib/types";
import ConnectWriteAccess from "./ConnectWriteAccess";
import BulkIR from "./BulkIR";
import BulkAdd from "./BulkAdd";
import { PlayerAvatar } from "./Avatar";
import { SectionHead } from "./PageHead";
import { StatCard, StatCardGrid } from "./StatCard";
import { Badge } from "./Badge";
import { DataTable, TableRow, TableHeaderRow } from "./DataRow";

export interface LineupLeague {
  league: ManagedLeague;
  roster: ManagedRoster | null;
  rosterPositions: string[];
  alertCount: number;
}

function playerLabel(pmap: PlayerMap | null, id: string) {
  const entry = pmap?.[id];
  if (!entry) return { name: id, pos: "", inj: null as string | null };
  return { name: entry.n, pos: entry.p, inj: entry.inj ?? null };
}

type RowState =
  | { kind: "idle" }
  | { kind: "pending"; action: string }
  | { kind: "error"; message: string }
  | { kind: "applied"; at: number };

function LeagueRow({
  item,
  pmap,
  token,
  currentWeek,
}: {
  item: LineupLeague;
  pmap: PlayerMap | null;
  token: string | null;
  currentWeek: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [starters, setStartersLocal] = useState<string[]>(item.roster?.starters ?? []);
  const [reserve, setReserveLocal] = useState<string[]>(item.roster?.reserve ?? []);
  const [state, setState] = useState<RowState>({ kind: "idle" });

  const slots = useMemo(() => buildStartingSlots(item.rosterPositions), [item.rosterPositions]);
  const roster = item.roster;

  if (!roster) {
    return (
      <TableRow>
        <span className="tname" style={{ flex: 1 }}>{item.league.name}</span>
        <span className="hint" style={{ margin: 0 }}>No roster synced yet.</span>
      </TableRow>
    );
  }

  const bench = roster.players.filter((id) => !starters.includes(id) && !reserve.includes(id));
  const dirty = JSON.stringify(starters) !== JSON.stringify(roster.starters);

  const applyLineup = async () => {
    if (!token) return;
    setState({ kind: "pending", action: "Applying lineup…" });
    try {
      const result = await setStarters(token, {
        leagueId: item.league.id,
        rosterId: roster.rosterId,
        starters,
        week: currentWeek,
      });
      setStartersLocal(result.starters);
      setState({ kind: "applied", at: Date.now() });
    } catch (e) {
      setStartersLocal(roster.starters); // revert optimistic edit to last-known-good
      setState({ kind: "error", message: e instanceof SleeperGraphQLError ? e.message : String(e) });
    }
  };

  const doMoveToIR = async (playerId: string) => {
    if (!token) return;
    setState({ kind: "pending", action: "Moving to IR…" });
    try {
      const result = await moveToIR(token, { leagueId: item.league.id, rosterId: roster.rosterId, playerId });
      setReserveLocal(result.reserve);
      setState({ kind: "applied", at: Date.now() });
    } catch (e) {
      setState({ kind: "error", message: e instanceof SleeperGraphQLError ? e.message : String(e) });
    }
  };

  const doActivate = async (playerId: string) => {
    if (!token) return;
    setState({ kind: "pending", action: "Activating…" });
    try {
      const result = await activateFromIR(token, { leagueId: item.league.id, rosterId: roster.rosterId, playerId });
      setReserveLocal(result.reserve);
      setState({ kind: "applied", at: Date.now() });
    } catch (e) {
      setState({ kind: "error", message: e instanceof SleeperGraphQLError ? e.message : String(e) });
    }
  };

  const pending = state.kind === "pending";

  return (
    <>
      <TableRow as="button" onClick={() => setExpanded((v) => !v)}>
        <span className="tname" style={{ flex: 1 }}>{item.league.name}</span>
        {item.alertCount > 0 && <Badge tone={{ color: "var(--red)", background: "color-mix(in srgb, var(--red) 20%, transparent)", borderColor: "color-mix(in srgb, var(--red) 52%, transparent)" }}>{item.alertCount} alert{item.alertCount === 1 ? "" : "s"}</Badge>}
        <span className="portmeta">{roster.wins}-{roster.losses}{roster.ties > 0 ? `-${roster.ties}` : ""}</span>
        <span className="portmeta">{expanded ? "Hide" : "Manage"}</span>
      </TableRow>
      {expanded && (
        <div className="mgrrow static" style={{ display: "block", padding: "0 0 16px 0" }}>
          {state.kind === "error" && (
            <div className="err" style={{ margin: "8px 0" }}>{state.message}</div>
          )}
          {state.kind === "applied" && (
            <p className="hint" style={{ color: "var(--mint)", margin: "8px 0" }}>
              Applied just now — not yet reflected in Fantis&rsquo;s own synced data until the
              next sync.
            </p>
          )}
          <DataTable>
            <TableHeaderRow>
              <span style={{ flex: 1, marginLeft: 34 }}>Slot</span>
              <span style={{ minWidth: 200 }}>Starter</span>
            </TableHeaderRow>
            {slots.map((slot, i) => {
              const currentId = starters[i];
              const current = currentId && currentId !== "0" ? playerLabel(pmap, currentId) : null;
              const eligible = eligiblePositions(slot.code);
              const options = bench.filter((id) => {
                const p = pmap?.[id];
                return p && eligible.includes(p.p);
              });
              return (
                <TableRow key={slot.key}>
                  <span className="portmeta" style={{ minWidth: 60 }}>{slot.code}</span>
                  {current && <PlayerAvatar playerId={currentId} pos={current.pos} size={24} />}
                  <span className="tname" style={{ flex: 1 }}>
                    {current ? current.name : <span style={{ color: "var(--red)" }}>Empty slot</span>}
                  </span>
                  <select
                    className="select sm"
                    value={currentId && currentId !== "0" ? currentId : ""}
                    disabled={!token || pending}
                    onChange={(e) => {
                      const next = [...starters];
                      next[i] = e.target.value;
                      setStartersLocal(next);
                    }}
                  >
                    <option value="">— empty —</option>
                    {current && <option value={currentId}>{current.name} (current)</option>}
                    {options.map((id) => (
                      <option key={id} value={id}>{playerLabel(pmap, id).name}</option>
                    ))}
                  </select>
                </TableRow>
              );
            })}
          </DataTable>
          {dirty && (
            <button className="btn sm" style={{ marginTop: 8 }} disabled={!token || pending} onClick={applyLineup}>
              {pending && state.action === "Applying lineup…" ? "Applying…" : "Apply Lineup"}
            </button>
          )}

          {bench.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <SectionHead level={3} title="Bench" style={{ marginBottom: 8 }} />
              <DataTable>
                {bench.map((id) => {
                  const p = playerLabel(pmap, id);
                  return (
                    <TableRow key={id}>
                      <PlayerAvatar playerId={id} pos={p.pos} size={24} />
                      <span className="tname" style={{ flex: 1 }}>{p.name}</span>
                      {p.pos && <span className="pos" style={posChipStyle(p.pos)}>{p.pos}</span>}
                      <button className="btn ghost sm" disabled={!token || pending} onClick={() => doMoveToIR(id)}>
                        Move to IR
                      </button>
                    </TableRow>
                  );
                })}
              </DataTable>
            </div>
          )}

          {reserve.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <SectionHead level={3} title="IR" style={{ marginBottom: 8 }} />
              <DataTable>
                {reserve.map((id) => {
                  const p = playerLabel(pmap, id);
                  return (
                    <TableRow key={id}>
                      <PlayerAvatar playerId={id} pos={p.pos} size={24} />
                      <span className="tname" style={{ flex: 1 }}>{p.name}</span>
                      {p.pos && <span className="pos" style={posChipStyle(p.pos)}>{p.pos}</span>}
                      <button className="btn ghost sm" disabled={!token || pending} onClick={() => doActivate(id)}>
                        Activate
                      </button>
                    </TableRow>
                  );
                })}
              </DataTable>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default function LineupManager({
  leagues: allLeagues,
  currentWeek,
}: {
  leagues: LineupLeague[];
  currentWeek: number;
}) {
  // Best ball leagues set their own lineups, so they're hidden from every
  // tab here by default (one toggle brings them back).
  const [hideBestBall, setHideBestBall] = useState(true);
  const bestBallCount = useMemo(
    () => allLeagues.filter((l) => isBestBall(l.league.settings)).length,
    [allLeagues]
  );
  const leagues = useMemo(
    () => (hideBestBall ? allLeagues.filter((l) => !isBestBall(l.league.settings)) : allLeagues),
    [allLeagues, hideBestBall]
  );
  const [token, setToken] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [tab, setTab] = useState<"lineups" | "ir" | "add">("lineups");
  const { pmap } = usePlayerMap();

  const needsAttention = useMemo(() => leagues.filter((l) => l.alertCount > 0), [leagues]);
  const rest = useMemo(() => leagues.filter((l) => l.alertCount === 0), [leagues]);

  return (
    <>
      <section className="sec">
        <SectionHead
          title="Lineups"
          right="set starters, IR and adds across every league, in one place"
        />
        <ConnectWriteAccess onTokenReady={setToken} />
        <div className="field" style={{ marginBottom: 16 }}>
          <button className={`chip-filter ${tab === "lineups" ? "on" : ""}`} onClick={() => setTab("lineups")}>
            Lineups
          </button>
          <button className={`chip-filter ${tab === "ir" ? "on" : ""}`} onClick={() => setTab("ir")}>
            Mass IR
          </button>
          <button className={`chip-filter ${tab === "add" ? "on" : ""}`} onClick={() => setTab("add")}>
            Mass Add / Claim
          </button>
          <span style={{ flex: 1 }} />
          {bestBallCount > 0 && (
            <button
              className={`chip-filter ${hideBestBall ? "on" : ""}`}
              onClick={() => setHideBestBall((v) => !v)}
              title="Best ball leagues set their own lineups"
            >
              {hideBestBall ? `Best ball hidden (${bestBallCount})` : `Hide ${bestBallCount} best ball`}
            </button>
          )}
        </div>
        {tab === "ir" && <BulkIR leagues={leagues} pmap={pmap} token={token} currentWeek={currentWeek} />}
        {tab === "add" && <BulkAdd leagues={leagues} pmap={pmap} token={token} />}
        {tab === "lineups" && (
        <>
        <StatCardGrid variant="grid">
          <StatCard label="Total leagues" value={leagues.length} />
          <StatCard
            label="Needs attention"
            value={needsAttention.length}
            valueColor={needsAttention.length > 0 ? "var(--red)" : "var(--mint)"}
          />
          <StatCard label="Week" value={currentWeek} />
        </StatCardGrid>
        <p className="hint" style={{ marginTop: 8 }}>
          Changes made here call Sleeper directly from your browser using the write access above —
          Fantis&rsquo;s own synced data (records, rosters shown elsewhere in Manager) updates on
          the next regular sync, not instantly.
        </p>
        </>
        )}
      </section>

      {tab === "lineups" && needsAttention.length > 0 && (
        <section className="sec">
          <SectionHead level={2} title="Needs attention" right={`${needsAttention.length} leagues`} />
          <DataTable>
            {needsAttention.map((item) => (
              <LeagueRow key={item.league.id} item={item} pmap={pmap} token={token} currentWeek={currentWeek} />
            ))}
          </DataTable>
        </section>
      )}

      {tab === "lineups" && (
      <section className="sec">
        <SectionHead
          title="All leagues"
          right={
            <button className="chip-filter" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Hide" : `Show ${rest.length} leagues`}
            </button>
          }
        />
        {showAll && (
          <DataTable>
            {rest.map((item) => (
              <LeagueRow key={item.league.id} item={item} pmap={pmap} token={token} currentWeek={currentWeek} />
            ))}
          </DataTable>
        )}
      </section>
      )}
    </>
  );
}
