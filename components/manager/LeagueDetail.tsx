"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  statusChipStyle,
  statusLabel,
  formatRelative,
  alertSeverityChipStyle,
  type ManagedAlert,
  type ManagedDraft,
  type ManagedLeague,
  type ManagedMatchup,
  type ManagedRoster,
} from "@/lib/manager";
import { getPlayers } from "@/lib/sleeper";
import { posChipStyle } from "@/lib/players";
import { buildStartingSlots } from "@/lib/rosterSlots";
import type { PlayerMap } from "@/lib/types";

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
}: {
  league: ManagedLeague;
  roster: ManagedRoster | null;
  matchup: ManagedMatchup | null;
  alerts: ManagedAlert[];
  draft: ManagedDraft | null;
}) {
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

  const draftId = settingsField(league.settings, "draft_id");
  const avatar = settingsField(league.settings, "avatar");
  const previousLeagueId = settingsField(league.settings, "previous_league_id");
  const settingsBlob = settingsField(league.settings, "settings");
  const scoringSettings = settingsField(league.settings, "scoring_settings");
  const rosterPositions = settingsField(league.settings, "roster_positions");
  const rosterPositionsArr = Array.isArray(rosterPositions) ? (rosterPositions as string[]) : [];

  return (
    <>
      <section className="sec">
        <div className="sechead">
          <h2>{league.name}</h2>
          <Link href="/manager" className="link">
            ← All leagues
          </Link>
        </div>

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
                <span>Status</span>
                <b>
                  <span className="pos" style={statusChipStyle(league.status)}>
                    {statusLabel(league.status)}
                  </span>
                </b>
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
                <b>{formatRelative(league.lastSyncedAt)}</b>
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

        <a
          className="btn"
          style={{ marginTop: 16, display: "inline-block" }}
          href={`https://sleeper.com/leagues/${league.id}`}
          target="_blank"
          rel="noreferrer"
        >
          Open in Sleeper →
        </a>
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
                <div className="tradeinboxrow" key={a.id}>
                  <span className="pos" style={alertSeverityChipStyle(a.severity)}>
                    {a.severity === "action_required" ? "action required" : "review"}
                  </span>
                  <span className="tname" style={{ flex: 1 }}>
                    {a.message}
                  </span>
                </div>
              ))}
          </div>
        </section>
      )}

      {matchup && (
        <section className="sec">
          <div className="sechead">
            <h2 style={{ fontSize: 18 }}>This week&rsquo;s matchup</h2>
            <span className="rt">week {matchup.week}</span>
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
              {roster.ties > 0 ? `-${roster.ties}` : ""} · synced {formatRelative(roster.lastSyncedAt)}
            </span>
          </div>
          <RosterSection roster={roster} pmap={pmap} rosterPositions={rosterPositionsArr} />
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
    <div className="portoverview">
      {slots.map((slot, i) => {
        const playerId = roster.starters[i];
        const empty = !playerId || playerId === "0";
        const label = empty ? null : playerLabel(pmap, playerId);
        return (
          <div className="portoverviewrow" style={{ cursor: "default" }} key={slot.key}>
            <span className="portmeta" style={{ minWidth: 44 }}>
              {slot.code}
            </span>
            {empty ? (
              <span className="tname" style={{ color: "var(--red)" }}>
                Empty slot
              </span>
            ) : (
              <>
                <span className="tname">{label!.name}</span>
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
        <div className="portoverviewrow" style={{ cursor: "default", opacity: 0.7 }}>
          <span className="tname">Bench</span>
          <span className="portmeta">
            {bench.map((id) => playerLabel(pmap, id).name).join(", ")}
          </span>
        </div>
      )}
    </div>
  );
}
