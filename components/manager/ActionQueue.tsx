"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getPlayers, playerPhotoUrl } from "@/lib/sleeper";
import { posChipStyle } from "@/lib/players";
import { isSnoozed } from "@/lib/manager";
import { useSeasonTotals, pickReplacementCandidate } from "@/lib/useDropCandidates";
import AlertRow from "./AlertRow";
import type { PlayerMap } from "@/lib/types";

export interface ActionItem {
  id: string;
  leagueId: string;
  leagueName: string;
  type: string;
  severity: "action_required" | "review";
  message: string;
  playerId: string | null;
  week: number;
  createdAt: string;
  resolvedAt: string | null;
  snoozedUntil: string | null;
}

export interface ActionQueueRoster {
  leagueId: string;
  players: string[];
  starters: string[];
}

// Alert types where "who needs to replace whom" actually makes sense —
// empty_slot/draft/trade-deadline/unclaimed-team have no single outgoing
// player to suggest a same-position swap for.
const REPLACEABLE_TYPES = new Set(["injured_starter", "questionable_starter", "bye_starter"]);

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

export default function ActionQueue({
  items,
  rosters,
}: {
  items: ActionItem[];
  rosters: ActionQueueRoster[];
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

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
  const seasonTotals = useSeasonTotals();

  const [showSnoozed, setShowSnoozed] = useState(false);

  const rosterByLeague = useMemo(() => new Map(rosters.map((r) => [r.leagueId, r])), [rosters]);

  const { active, snoozed } = useMemo(() => {
    const active: ActionItem[] = [];
    const snoozed: ActionItem[] = [];
    for (const item of items) {
      // Before mount, isSnoozed's Date.now() comparison isn't run yet — same
      // hydration-safety pattern as everywhere else, so both buckets stay
      // stable across the server/client hydration boundary until mounted.
      if (mounted && isSnoozed(item)) snoozed.push(item);
      else active.push(item);
    }
    active.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "action_required" ? -1 : 1));
    return { active, snoozed };
  }, [items, mounted]);

  const actionRequiredCount = active.filter((i) => i.severity === "action_required").length;

  return (
    <>
      <section className="sec" style={{ paddingBottom: 0 }}>
        <div className="mgrhead">
          <div className="mgraccentbar" />
          <h1>Action Queue</h1>
          <p>
            Every open alert across every league, in one linear list — snooze or dismiss from here
            instead of hunting through each league. Where an alert is about one starting player
            (injured, questionable, or on bye), the best real season-points bench player at the same
            position is suggested as a replacement — confirm on Sleeper before making the swap.
          </p>
        </div>
        <div className="mgrstats">
          <div className="mgrstat">
            <div className="mgrstatbody">
              <p className="mgrstatlabel">Needs action</p>
              <p className="mgrstatvalue" style={{ color: actionRequiredCount > 0 ? "var(--red)" : "var(--mint)" }}>
                {actionRequiredCount}
              </p>
            </div>
          </div>
          <div className="mgrstat">
            <div className="mgrstatbody">
              <p className="mgrstatlabel">Review</p>
              <p className="mgrstatvalue">{active.length - actionRequiredCount}</p>
            </div>
          </div>
          <div className="mgrstat">
            <div className="mgrstatbody">
              <p className="mgrstatlabel">Snoozed</p>
              <p className="mgrstatvalue">{snoozed.length}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="sec">
        {active.length === 0 ? (
          <p className="hint">Nothing in the queue right now.</p>
        ) : (
          <div className="tradeinbox">
            {active.map((item) => {
              const roster = rosterByLeague.get(item.leagueId);
              const replacement =
                item.playerId && roster && REPLACEABLE_TYPES.has(item.type)
                  ? pickReplacementCandidate(item.playerId, roster.players, roster.starters, pmap, seasonTotals)
                  : null;
              const replacementLabel = replacement ? pmap?.[replacement.playerId] : null;
              return (
                <AlertRow
                  key={item.id}
                  alert={item}
                  mounted={mounted}
                  leading={
                    <Link href={`/manager/${item.leagueId}`} className="link" style={{ minWidth: 140 }}>
                      {item.leagueName}
                    </Link>
                  }
                  extra={
                    replacement && replacementLabel ? (
                      <div className="mgrplayer" style={{ marginRight: 8 }}>
                        <span className="portmeta">start instead:</span>
                        <Avatar playerId={replacement.playerId} pos={replacementLabel.p} size={22} />
                        <span className="portmeta" style={{ color: "var(--bone)" }}>
                          {replacementLabel.n}
                        </span>
                      </div>
                    ) : undefined
                  }
                />
              );
            })}
          </div>
        )}

        {snoozed.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <button className="chip-filter" onClick={() => setShowSnoozed((v) => !v)}>
              {showSnoozed ? "Hide" : `Show ${snoozed.length} snoozed`}
            </button>
            {showSnoozed && (
              <div className="tradeinbox" style={{ marginTop: 8, opacity: 0.75 }}>
                {snoozed.map((item) => (
                  <AlertRow
                    key={item.id}
                    alert={item}
                    mounted={mounted}
                    leading={
                      <Link href={`/manager/${item.leagueId}`} className="link" style={{ minWidth: 140 }}>
                        {item.leagueName}
                      </Link>
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}
