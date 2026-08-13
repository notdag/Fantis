"use client";

import Link from "next/link";
import { statusChipStyle, statusLabel, formatRelative, type ManagedLeague } from "@/lib/manager";

// Sleeper's league `settings` blob is untyped JSON here (see prisma/schema.prisma
// — deliberately not normalized). Every field below is read defensively;
// nothing is assumed to exist.
function settingsField(settings: unknown, key: string): unknown {
  if (!settings || typeof settings !== "object") return undefined;
  return (settings as Record<string, unknown>)[key];
}

export default function LeagueDetail({ league }: { league: ManagedLeague }) {
  const draftId = settingsField(league.settings, "draft_id");
  const avatar = settingsField(league.settings, "avatar");
  const previousLeagueId = settingsField(league.settings, "previous_league_id");
  const settingsBlob = settingsField(league.settings, "settings");
  const scoringSettings = settingsField(league.settings, "scoring_settings");
  const rosterPositions = settingsField(league.settings, "roster_positions");

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
