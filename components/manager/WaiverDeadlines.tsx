"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCountdown, formatPacific, nextWaiverRun } from "@/lib/waiverSchedule";
import type { Claim } from "@/lib/inbox";

export interface DeadlineLeague {
  leagueId: string;
  leagueName: string;
  settings: unknown;
}

// "When do my waivers run next, and what's in flight?" — leagues grouped by
// their next real processing time (see lib/waiverSchedule.ts for how the time
// is derived and why it's labelled Pacific), with pending-claim counts once a
// claims scan has run and FAAB left per league. Read-only; nothing here sends.
export default function WaiverDeadlines({
  leagues,
  faabRemaining,
  claimsByLeague,
  claimsScanned,
  scanning,
  canScan,
  onScan,
}: {
  leagues: DeadlineLeague[];
  faabRemaining: Map<string, number>;
  claimsByLeague: Map<string, Claim[]>;
  claimsScanned: boolean;
  scanning: boolean;
  canScan: boolean;
  onScan: () => void;
}) {
  // Re-render once a minute so the countdowns stay honest.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const [openKey, setOpenKey] = useState<string | null>(null);

  const { groups, unknown } = useMemo(() => {
    const map = new Map<number, { at: Date; approximate: boolean; leagues: DeadlineLeague[] }>();
    let unknown = 0;
    for (const l of leagues) {
      const run = nextWaiverRun(l.settings, new Date(now));
      if (!run) {
        unknown++;
        continue;
      }
      // Bucket to the minute; approximate (daily) leagues get their own bucket
      // so an exact weekly run is never presented as if it were a guess.
      const key = run.at.getTime() + (run.approximate ? 1 : 0);
      const g = map.get(key) ?? { at: run.at, approximate: run.approximate, leagues: [] };
      g.leagues.push(l);
      map.set(key, g);
    }
    return { groups: [...map.values()].sort((a, b) => a.at.getTime() - b.at.getTime()), unknown };
  }, [leagues, now]);

  if (leagues.length === 0) return null;

  return (
    <section className="sec" style={{ paddingBottom: 0 }}>
      <div className="sechead">
        <h2>Next waiver runs</h2>
        <span className="rt">{leagues.length} leagues</span>
      </div>
      <p className="hint" style={{ margin: "0 0 10px" }}>
        When Sleeper next processes claims, grouped by time. Place or change claims <b>before</b> the time shown. Times are
        Pacific — inferred from when your leagues&rsquo; real claims were actually processed (Sleeper doesn&rsquo;t document its
        time zone).
        {!claimsScanned && (
          <>
            {" "}
            <button type="button" className="link" disabled={scanning || !canScan} onClick={onScan}>
              {scanning ? "Scanning claims…" : "Scan pending claims"}
            </button>{" "}
            to see which leagues already have one in.
          </>
        )}
      </p>

      {groups.slice(0, 4).map((g) => {
        const key = String(g.at.getTime()) + (g.approximate ? "a" : "");
        const ms = g.at.getTime() - now;
        const urgent = ms < 3 * 3600_000;
        const soon = ms < 24 * 3600_000;
        const color = urgent ? "var(--red)" : soon ? "var(--amber)" : "var(--bone)";
        const withClaims = g.leagues.filter((l) => (claimsByLeague.get(l.leagueId)?.length ?? 0) > 0);
        const faabLow = g.leagues
          .map((l) => ({ l, left: faabRemaining.get(l.leagueId) }))
          .filter((x): x is { l: DeadlineLeague; left: number } => typeof x.left === "number")
          .sort((a, b) => a.left - b.left);
        const open = openKey === key;
        return (
          <div key={key} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 14px", marginBottom: 8, background: "var(--panel)" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <b style={{ fontSize: 17, color }}>in {formatCountdown(ms)}</b>
              <span style={{ fontSize: 14 }}>
                {g.approximate ? "earliest " : ""}
                {formatPacific(g.at)}
              </span>
              <span className="portmeta">
                {g.leagues.length} league{g.leagues.length === 1 ? "" : "s"}
                {g.approximate ? " · daily waivers (may run on other days too)" : ""}
              </span>
              <span style={{ flex: 1 }} />
              {claimsScanned && (
                <span className="portmeta" style={{ color: withClaims.length ? "var(--mint)" : "var(--muted)" }}>
                  {withClaims.length} with a pending claim · {g.leagues.length - withClaims.length} without
                </span>
              )}
              <button type="button" className="link" onClick={() => setOpenKey(open ? null : key)}>
                {open ? "Hide leagues" : "Show leagues"}
              </button>
            </div>
            {faabLow.length > 0 && (
              <div className="portmeta" style={{ marginTop: 4 }}>
                Lowest FAAB left: {faabLow.slice(0, 3).map((x) => `${x.l.leagueName} $${x.left}`).join(" · ")}
              </div>
            )}
            {open && (
              <div style={{ marginTop: 8, maxHeight: 260, overflowY: "auto", borderTop: "1px solid var(--line-soft)" }}>
                {[...g.leagues]
                  .sort(
                    (a, b) =>
                      (claimsByLeague.get(b.leagueId)?.length ?? 0) - (claimsByLeague.get(a.leagueId)?.length ?? 0) ||
                      a.leagueName.localeCompare(b.leagueName)
                  )
                  .map((l) => {
                    const n = claimsByLeague.get(l.leagueId)?.length ?? 0;
                    const left = faabRemaining.get(l.leagueId);
                    return (
                      <div key={l.leagueId} style={{ display: "flex", gap: 12, padding: "5px 0", fontSize: 13.5, borderBottom: "1px solid var(--line-soft)" }}>
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.leagueName}</span>
                        {claimsScanned && (
                          <span style={{ color: n ? "var(--mint)" : "var(--dim)" }}>{n ? `${n} pending` : "none"}</span>
                        )}
                        {typeof left === "number" && <span className="portmeta">${left} left</span>}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        );
      })}
      {groups.length > 4 && <p className="hint">+{groups.length - 4} later run time{groups.length - 4 === 1 ? "" : "s"} not shown.</p>}
      {unknown > 0 && (
        <p className="hint">
          {unknown} league{unknown === 1 ? "" : "s"} have no waiver schedule in the synced data — run a sync to refresh them.
        </p>
      )}
    </section>
  );
}
