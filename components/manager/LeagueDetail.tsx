"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  statusChipStyle,
  statusLabel,
  formatRelative,
  type ManagedAlert,
  type ManagedDraft,
  type ManagedLeague,
  type ManagedMatchup,
  type ManagedRoster,
} from "@/lib/manager";
import { getPlayers, playerPhotoUrl } from "@/lib/sleeper";
import { posChipStyle } from "@/lib/players";
import { buildStartingSlots } from "@/lib/rosterSlots";
import { useSeasonTotals } from "@/lib/useDropCandidates";
import { computeLeagueRank, type LeagueRosterRow } from "@/lib/leagueRank";
import AlertRow from "./AlertRow";
import type { PlayerMap } from "@/lib/types";

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

// Sleeper's league `settings` blob is untyped JSON here (see prisma/schema.prisma
// — deliberately not normalized). Every field below is read defensively;
// nothing is assumed to exist.
function settingsField(settings: unknown, key: string): unknown {
  if (!settings || typeof settings !== "object") return undefined;
  return (settings as Record<string, unknown>)[key];
}

export default function LeagueDetail({
  league,
  roster,
  matchup,
  alerts,
  draft,
  leagueRosters,
}: {
  league: ManagedLeague;
  roster: ManagedRoster | null;
  matchup: ManagedMatchup | null;
  alerts: ManagedAlert[];
  draft: ManagedDraft | null;
  leagueRosters: LeagueRosterRow[];
}) {
  // formatRelative() depends on Date.now(), which differs between the
  // server render and the client hydration pass a moment later — rendering
  // "—" on both the server pass and the client's first hydration pass (same
  // reasoning as ManagerDashboard.tsx) avoids a real hydration mismatch
  // (React error #418), then the real relative text appears right after.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const router = useRouter();
  // League ID/season/teams/connected-via/last-synced is real but rarely
  // useful to see every visit — collapsed behind a toggle rather than
  // always taking space above the actually-useful roster/alerts content.
  const [infoOpen, setInfoOpen] = useState(false);

  // League Groups: a free-text label the owner sets to organize leagues by
  // whatever grouping matters to them (buy-in tier, friend group, etc.) —
  // Fantis's own data, never read from or written to Sleeper.
  const [editingGroup, setEditingGroup] = useState(false);
  const [groupValue, setGroupValue] = useState(league.group ?? "");
  const [savingGroup, setSavingGroup] = useState(false);
  const saveGroup = async () => {
    setSavingGroup(true);
    try {
      await fetch(`/api/manager/leagues/${league.id}/group`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group: groupValue.trim() || null }),
      });
      setEditingGroup(false);
      router.refresh();
    } finally {
      setSavingGroup(false);
    }
  };
  // Player id -> name/position/team/injury resolved client-side, same
  // day-cached pattern as TeamHub.tsx/Portfolio.tsx — keeps live Sleeper
  // calls out of Server Components.
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

  // Real league-wide rank + team value from every roster in this league
  // (LeagueRoster — zero extra Sleeper calls, see prisma/schema.prisma) and
  // the same real season-projection data Trade/Waiver already use.
  const seasonTotals = useSeasonTotals();
  const leagueRank = useMemo(
    () => (roster ? computeLeagueRank(leagueRosters, roster.rosterId, seasonTotals) : null),
    [leagueRosters, roster, seasonTotals]
  );

  // Real, league-wide best-available: every real Sleeper player (with a
  // current NFL team and a real season projection) who isn't on ANY
  // roster in this league — not curated-list matching, just pmap directly,
  // since this only needs "is he rostered here," not name-fuzzy-matched
  // trade value. Zero extra Sleeper calls: leagueRosters + pmap + season
  // totals are all already fetched elsewhere on this page.
  const OFFENSE_POS = useMemo(() => new Set(["QB", "RB", "WR", "TE"]), []);
  const bestAvailable = useMemo(() => {
    if (!pmap || !seasonTotals || leagueRosters.length === 0) return [];
    const rostered = new Set(leagueRosters.flatMap((r) => r.players));
    const rows: { id: string; name: string; pos: string; team: string; pts: number }[] = [];
    for (const id in pmap) {
      if (rostered.has(id)) continue;
      const p = pmap[id];
      if (!OFFENSE_POS.has(p.p) || !p.t) continue;
      const pts = seasonTotals[id]?.pts;
      if (!pts || pts <= 0) continue;
      rows.push({ id, name: p.n, pos: p.p, team: p.t, pts });
    }
    rows.sort((a, b) => b.pts - a.pts);
    return rows.slice(0, 10);
  }, [pmap, seasonTotals, leagueRosters, OFFENSE_POS]);

  // "Open via automation": queues a real Action row, then polls its status
  // for up to ~15s. The plain "Open in Sleeper" link below never depends
  // on this — automation is additive, never the only path to a league.
  const [automationState, setAutomationState] = useState<
    "idle" | "waiting" | "opened" | "failed" | "timeout"
  >("idle");

  const openViaAutomation = async () => {
    setAutomationState("waiting");
    try {
      const res = await fetch("/api/manager/automation/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId: league.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.actionId) {
        setAutomationState("failed");
        return;
      }
      const actionId = body.actionId as string;
      const deadline = Date.now() + 15000;
      const poll = async () => {
        if (Date.now() > deadline) {
          setAutomationState("timeout");
          return;
        }
        const r = await fetch(`/api/manager/automation/actions/${actionId}`).catch(() => null);
        const b = r ? await r.json().catch(() => null) : null;
        if (b?.action?.status === "completed") {
          setAutomationState("opened");
        } else if (b?.action?.status === "failed") {
          setAutomationState("failed");
        } else {
          setTimeout(poll, 2000);
        }
      };
      poll();
    } catch {
      setAutomationState("failed");
    }
  };

  const draftId = settingsField(league.settings, "draft_id");
  const avatar = settingsField(league.settings, "avatar");
  const previousLeagueId = settingsField(league.settings, "previous_league_id");
  const settingsBlob = settingsField(league.settings, "settings");
  const scoringSettings = settingsField(league.settings, "scoring_settings");
  const rosterPositions = settingsField(league.settings, "roster_positions");
  const rosterPositionsArr = Array.isArray(rosterPositions) ? (rosterPositions as string[]) : [];

  return (
    <>
      <section className="sec" style={{ paddingBottom: 0 }}>
        <div className="mgrhead">
          <div className="mgraccentbar" />
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <h1>{league.name}</h1>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="pos" style={statusChipStyle(league.status)}>
                {statusLabel(league.status)}
              </span>
              {editingGroup ? (
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    className="input"
                    style={{ padding: "4px 8px", fontSize: 12.5, width: 140 }}
                    placeholder="Group name…"
                    value={groupValue}
                    autoFocus
                    onChange={(e) => setGroupValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveGroup()}
                  />
                  <button className="btn ghost sm" disabled={savingGroup} onClick={saveGroup}>
                    Save
                  </button>
                  <button
                    className="linklike"
                    style={{ fontSize: 12.5 }}
                    onClick={() => {
                      setGroupValue(league.group ?? "");
                      setEditingGroup(false);
                    }}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  className={league.group ? "pos" : "linklike"}
                  style={
                    league.group
                      ? {
                          color: "var(--amber)",
                          background: "color-mix(in srgb, var(--amber) 16%, transparent)",
                          borderColor: "color-mix(in srgb, var(--amber) 45%, transparent)",
                          cursor: "pointer",
                        }
                      : { fontSize: 13 }
                  }
                  onClick={() => setEditingGroup(true)}
                >
                  {league.group ?? "+ Add group"}
                </button>
              )}
              <button className="linklike" onClick={() => setInfoOpen((v) => !v)} style={{ fontSize: 13 }}>
                {infoOpen ? "Hide info" : "League info"}
              </button>
              <Link href="/manager" className="link">
                ← All leagues
              </Link>
            </span>
          </div>
        </div>

        {infoOpen && (
          <div className="portsummary">
            <div className="portcard">
              <div className="portcardhead">League</div>
              <div className="portcardrows">
                <div className="portcardrow">
                  <span>League ID</span>
                  <b>{league.id}</b>
                </div>
                <div className="portcardrow">
                  <span>Season</span>
                  <b>{league.season}</b>
                </div>
                <div className="portcardrow">
                  <span>Teams</span>
                  <b>{league.totalRosters}</b>
                </div>
                <div className="portcardrow">
                  <span>Connected via</span>
                  <b>{league.accountUsername}</b>
                </div>
                {typeof previousLeagueId === "string" && (
                  <div className="portcardrow">
                    <span>Previous season</span>
                    <b>{previousLeagueId}</b>
                  </div>
                )}
              </div>
            </div>

            <div className="portcard">
              <div className="portcardhead">Sync</div>
              <div className="portcardrows">
                <div className="portcardrow">
                  <span>Last synced</span>
                  <b>{mounted ? formatRelative(league.lastSyncedAt) : "—"}</b>
                </div>
                {typeof draftId === "string" && (
                  <div className="portcardrow">
                    <span>Draft</span>
                    <a
                      className="link"
                      href={`https://sleeper.com/draft/nfl/${draftId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open draft →
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <a
            className="btn"
            href={`https://sleeper.com/leagues/${league.id}`}
            target="_blank"
            rel="noreferrer"
          >
            Open in Sleeper →
          </a>
          <button
            className="btn ghost"
            onClick={openViaAutomation}
            disabled={automationState === "waiting"}
          >
            {automationState === "waiting" ? "Waiting for automation…" : "Open via automation"}
          </button>
          {automationState === "opened" && <span style={{ color: "var(--mint)" }}>Opened ✓</span>}
          {automationState === "failed" && (
            <span className="hint" style={{ color: "var(--red)" }}>
              Automation failed — use the link instead.
            </span>
          )}
          {automationState === "timeout" && (
            <span className="hint">No automation detected — install the userscript, or use the link.</span>
          )}
        </div>
      </section>

      {alerts.length > 0 && (
        <section className="sec">
          <div className="sechead">
            <h2 style={{ fontSize: 18 }}>Alerts</h2>
            <span className="rt">{alerts.length} from the last sync</span>
          </div>
          <div className="tradeinbox">
            {[...alerts]
              .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "action_required" ? -1 : 1))
              .map((a) => (
                <AlertRow key={a.id} alert={a} mounted={mounted} />
              ))}
          </div>
        </section>
      )}

      {matchup && (
        <section className="sec">
          <div className="sechead">
            <h2 style={{ fontSize: 18 }}>This week&rsquo;s matchup</h2>
            <Link href={`/manager/${league.id}/matchup`} className="link">
              View full matchup →
            </Link>
          </div>
          <div className="portoverview">
            <div className="portoverviewrow" style={{ cursor: "default" }}>
              <span className="tname">You</span>
              <span className="portvalue">{matchup.myPoints.toFixed(1)}</span>
            </div>
            <div className="portoverviewrow" style={{ cursor: "default" }}>
              <span className="tname">{matchup.opponentTeamName ?? "Opponent"}</span>
              <span className="portvalue">
                {matchup.opponentPoints != null ? matchup.opponentPoints.toFixed(1) : "—"}
              </span>
            </div>
          </div>
        </section>
      )}

      {roster && (
        <section className="sec">
          <div className="sechead">
            <h2 style={{ fontSize: 18 }}>My roster</h2>
            <span className="rt">
              {roster.wins}-{roster.losses}
              {roster.ties > 0 ? `-${roster.ties}` : ""}
              {leagueRank?.rank != null ? ` · rank ${leagueRank.rank} of ${leagueRank.totalTeams}` : ""}
              {roster.waiverPosition != null ? ` · waiver #${roster.waiverPosition}` : ""}
              {roster.faabUsed != null ? ` · $${roster.faabUsed} FAAB used` : ""} · synced{" "}
              {mounted ? formatRelative(roster.lastSyncedAt) : "—"}
            </span>
          </div>
          <RosterSection roster={roster} pmap={pmap} rosterPositions={rosterPositionsArr} />
        </section>
      )}

      {bestAvailable.length > 0 && (
        <section className="sec">
          <div className="sechead">
            <h2 style={{ fontSize: 18 }}>Best available in this league</h2>
            <span className="rt">real season points · not on any roster here</span>
          </div>
          <div className="mgrtable">
            {bestAvailable.map((p) => (
              <div className="mgrrow static" key={p.id}>
                <Avatar playerId={p.id} pos={p.pos} size={26} />
                <span className="tname" style={{ flex: 1 }}>{p.name}</span>
                <span className="pos" style={posChipStyle(p.pos)}>{p.pos}</span>
                <span className="portmeta">{p.team}</span>
                <span className="portvalue">{Math.round(p.pts)} pts</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {(Boolean(rosterPositions) || Boolean(scoringSettings) || Boolean(settingsBlob)) && (
        <section className="sec">
          <div className="sechead">
            <h2 style={{ fontSize: 18 }}>Raw league settings</h2>
            <span className="rt">from Sleeper's own /league response</span>
          </div>
          <p className="hint">
            Sleeper doesn&rsquo;t document every field in this payload — shown as-is rather than
            guessed at. Format/scoring detail (PPR, dynasty/keeper flags, etc.) lives in here once
            you know which keys matter for your leagues.
          </p>
          <pre className="hint" style={{ overflow: "auto", maxHeight: 320, marginTop: 10 }}>
            {JSON.stringify({ settingsBlob, scoringSettings, rosterPositions, avatar }, null, 2)}
          </pre>
        </section>
      )}
    </>
  );
}

// Player id -> real name/position/team/injury via pmap (fetched client-side
// in the parent, day-cached). Shows a plain id if pmap hasn't loaded yet or
// a player id is unrecognized, rather than blocking the whole section.
function playerLabel(pmap: PlayerMap | null, id: string) {
  const entry = pmap?.[id];
  if (!entry) return { name: id, pos: "", team: "", inj: null as string | null };
  return { name: entry.n, pos: entry.p, team: entry.t, inj: entry.inj ?? null };
}

function RosterSection({
  roster,
  pmap,
  rosterPositions,
}: {
  roster: ManagedRoster;
  pmap: PlayerMap | null;
  rosterPositions: string[];
}) {
  const slots = buildStartingSlots(rosterPositions);
  const bench = roster.players.filter((id) => !roster.starters.includes(id));

  return (
    <div className="mgrtable">
      {slots.map((slot, i) => {
        const playerId = roster.starters[i];
        const empty = !playerId || playerId === "0";
        const label = empty ? null : playerLabel(pmap, playerId);
        return (
          <div className="mgrrow static" key={slot.key}>
            <span className="portmeta" style={{ minWidth: 44 }}>
              {slot.code}
            </span>
            {empty ? (
              <span className="tname" style={{ color: "var(--red)" }}>
                Empty slot
              </span>
            ) : (
              <>
                <Avatar playerId={playerId} pos={label!.pos} size={26} />
                <span className="tname" style={{ flex: 1 }}>{label!.name}</span>
                {label!.pos && (
                  <span className="pos" style={posChipStyle(label!.pos)}>
                    {label!.pos}
                  </span>
                )}
                {label!.inj && /out|doubtful|ir/i.test(label!.inj) && (
                  <span className="portmeta" style={{ color: "var(--red)" }}>
                    {label!.inj}
                  </span>
                )}
              </>
            )}
          </div>
        );
      })}
      {bench.length > 0 && (
        <div className="mgrrow static" style={{ opacity: 0.85 }}>
          <span className="tname">Bench</span>
          <span className="portmeta">
            {bench.map((id) => playerLabel(pmap, id).name).join(", ")}
          </span>
        </div>
      )}
    </div>
  );
}
