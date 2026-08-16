"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  statusChipStyle,
  statusLabel,
  formatRelative,
  formatUpcoming,
  alertSeverityChipStyle,
  automationConnected,
  isSnoozed,
  type ManagedAccount,
  type ManagedAlert,
  type ManagedDraft,
  type ManagedLeague,
  type ManagedSyncRun,
} from "@/lib/manager";
import { avatar } from "@/lib/sleeper";
import { IconUsers, IconFlag, IconCalendar, IconCheck, IconSearch } from "./MgrIcons";

// League settings is untyped JSON (see prisma/schema.prisma) — read
// defensively, same pattern as LeagueDetail.tsx's settingsField().
function leagueAvatarId(settings: unknown): string | null {
  if (!settings || typeof settings !== "object") return null;
  const v = (settings as Record<string, unknown>).avatar;
  return typeof v === "string" ? v : null;
}

function LeagueAvatar({ league }: { league: ManagedLeague }) {
  const id = leagueAvatarId(league.settings);
  const url = avatar(id);
  if (!url) {
    return (
      <span
        className="mgravatar"
        style={{
          width: 24,
          height: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 10,
          fontWeight: 700,
          color: "var(--dim)",
          background: "var(--ink)",
        }}
      >
        {league.name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="mgravatar"
      src={url}
      alt=""
      style={{ width: 24, height: 24 }}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
      }}
    />
  );
}

type SortKey = "name" | "season" | "teams" | "status" | "synced";
type SortDir = "asc" | "desc";

const STATUSES = ["pre_draft", "drafting", "in_season", "complete"] as const;

export default function ManagerDashboard({
  accounts,
  leagues,
  lastRun,
  alertsByLeague,
  draftsByLeague,
  automationLastPingAt,
}: {
  accounts: ManagedAccount[];
  leagues: ManagedLeague[];
  lastRun: ManagedSyncRun | null;
  alertsByLeague: Record<string, ManagedAlert[]>;
  draftsByLeague: Record<string, ManagedDraft>;
  automationLastPingAt: string | null;
}) {
  // Shared guard for every Date.now()-dependent render below
  // (automationConnected, formatRelative, formatUpcoming, draftsThisWeek) —
  // each of those differs between the server render and the client
  // hydration pass a moment later, which is a real hydration mismatch
  // (React error #418), not just cosmetic, when it changes DOM structure
  // (the connected/not-connected branch) and still worth avoiding even for
  // plain text (a relative-time string silently "jumping" on load reads as
  // a bug). Rendering the same stable placeholder on both the server pass
  // and the client's first hydration pass keeps them identical; real values
  // only take effect after hydration finishes, via this effect.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const connected = mounted && automationConnected(automationLastPingAt);
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | (typeof STATUSES)[number]>("ALL");
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showAllClear, setShowAllClear] = useState(false);
  // The connect form is only useful once, for first-time setup — once at
  // least one account is already connected, it's just clutter above the
  // real "Sync now" action, so it starts collapsed behind a small link.
  const [showConnectForm, setShowConnectForm] = useState(accounts.length === 0);
  // The whole header/sync card block collapses to one compact line once
  // there's at least one connected account and nothing's actually wrong —
  // Daryl wants Today to be the first thing on screen, not setup chrome he
  // only ever needed once. Forced open on first-time setup or a real sync
  // failure, since those genuinely need to be seen, not hidden behind a click.
  const hasSyncFailure = (lastRun?.leaguesFailed ?? 0) > 0;
  const [detailsOpen, setDetailsOpen] = useState(accounts.length === 0 || hasSyncFailure);

  const connect = async () => {
    const u = username.trim();
    if (!u || connecting) return;
    setConnecting(true);
    setConnectError("");
    try {
      const res = await fetch("/api/manager/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setConnectError(body.error || "Couldn't connect that account.");
        return;
      }
      setUsername("");
      router.refresh();
    } catch {
      setConnectError("Couldn't reach the server.");
    } finally {
      setConnecting(false);
    }
  };

  const syncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncError("");
    try {
      const res = await fetch("/api/manager/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncError(body.error || "Sync failed.");
        return;
      }
      router.refresh();
    } catch {
      setSyncError("Couldn't reach the server.");
    } finally {
      setSyncing(false);
    }
  };

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("asc");
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leagues.filter(
      (lg) =>
        (statusFilter === "ALL" || lg.status === statusFilter) &&
        (!q || lg.name.toLowerCase().includes(q))
    );
  }, [leagues, query, statusFilter]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const rows = [...filtered];
    rows.sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name) * dir;
        case "season":
          return a.season.localeCompare(b.season) * dir;
        case "teams":
          return (a.totalRosters - b.totalRosters) * dir;
        case "status":
          return a.status.localeCompare(b.status) * dir;
        case "synced":
          return ((a.lastSyncedAt ?? "").localeCompare(b.lastSyncedAt ?? "")) * dir;
        default:
          return 0;
      }
    });
    return rows;
  }, [filtered, sortBy, sortDir]);

  // Real per-status counts (unfiltered by the search box, since the chips
  // themselves are the status filter) — shown on each chip so you know
  // what "In season" etc. actually contains before clicking it.
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const lg of leagues) counts[lg.status] = (counts[lg.status] ?? 0) + 1;
    return counts;
  }, [leagues]);

  // Exception-based grouping: the whole point is that the groups themselves
  // do the triage, no filter click needed. Real Alert rows only — a league
  // with zero rows genuinely means "synced, nothing found," not "not
  // checked yet."
  //
  // draftsThisWeek below depends on Date.now(), same hydration hazard as
  // `connected` above — gated on `mounted` (in the dependency array) so it
  // stays 0 (matching the server render) until after hydration, then
  // recomputes for real.
  const groups = useMemo(() => {
    const actionRequired: { league: ManagedLeague; alerts: ManagedAlert[] }[] = [];
    const commissioner: { league: ManagedLeague; alerts: ManagedAlert[] }[] = [];
    const upcomingDrafts: { league: ManagedLeague; draft: ManagedDraft | undefined }[] = [];
    const review: { league: ManagedLeague; alerts: ManagedAlert[] }[] = [];
    const allClear: ManagedLeague[] = [];
    let draftsThisWeek = 0;

    for (const lg of leagues) {
      // Snoozed alerts are real/active (still counted toward "All clear"
      // being false), but don't clutter the exception groups — same
      // filtering as the Commissioner/Player search server pages.
      const alerts = (alertsByLeague[lg.id] ?? []).filter((a) => !isSnoozed(a));
      const required = alerts.filter((a) => a.severity === "action_required");
      const unclaimed = alerts.filter((a) => a.type === "unclaimed_team");
      const draftAlert = alerts.find((a) => a.type === "draft_upcoming");
      const otherReview = alerts.filter(
        (a) => a.severity === "review" && a.type !== "unclaimed_team" && a.type !== "draft_upcoming"
      );

      if (required.length > 0) actionRequired.push({ league: lg, alerts: required });
      if (unclaimed.length > 0) commissioner.push({ league: lg, alerts: unclaimed });
      if (draftAlert) {
        const draft = draftsByLeague[lg.id];
        upcomingDrafts.push({ league: lg, draft });
        if (mounted && draft?.startTime) {
          const days = (new Date(draft.startTime).getTime() - Date.now()) / 86400000;
          if (days >= 0 && days <= 7) draftsThisWeek += 1;
        }
      }
      if (otherReview.length > 0) review.push({ league: lg, alerts: otherReview });
      if (alerts.length === 0) allClear.push(lg);
    }

    return { actionRequired, commissioner, upcomingDrafts, review, allClear, draftsThisWeek };
  }, [leagues, alertsByLeague, draftsByLeague, mounted]);

  const mostRecentSync = leagues.reduce<string | null>((latest, lg) => {
    if (!lg.lastSyncedAt) return latest;
    if (!latest || lg.lastSyncedAt > latest) return lg.lastSyncedAt;
    return latest;
  }, null);

  return (
    <>
      <section className="sec" style={{ paddingTop: 12, paddingBottom: detailsOpen ? undefined : 12 }}>
        <div className="field" style={{ alignItems: "center", gap: 10 }}>
          <span className="hint" style={{ margin: 0 }}>
            {leagues.length} league{leagues.length === 1 ? "" : "s"} · synced{" "}
            {mounted ? formatRelative(mostRecentSync) : "—"}
            {hasSyncFailure && (
              <span style={{ color: "var(--red)" }}> · {lastRun!.leaguesFailed} failed</span>
            )}
            {" · "}
            {connected ? (
              <span style={{ color: "var(--mint)" }}>● connected</span>
            ) : (
              <span style={{ color: "var(--dim)" }}>○ not connected</span>
            )}
          </span>
          <button className="btn ghost sm" onClick={syncNow} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync now"}
          </button>
          <button className="linklike" onClick={() => setDetailsOpen((v) => !v)} style={{ fontSize: 13 }}>
            {detailsOpen ? "Hide details" : "Details"}
          </button>
        </div>

        {detailsOpen && (
          <div className="card sync" style={{ marginTop: 12 }}>
            {showConnectForm ? (
              <div className="field">
                <input
                  className="input"
                  placeholder="Sleeper username to connect"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && connect()}
                />
                <button className="btn" onClick={connect} disabled={connecting || !username.trim()}>
                  {connecting ? "Connecting…" : "Connect"}
                </button>
                {accounts.length > 0 && (
                  <button className="btn ghost" onClick={() => setShowConnectForm(false)}>
                    Cancel
                  </button>
                )}
              </div>
            ) : (
              <button className="linklike" onClick={() => setShowConnectForm(true)} style={{ fontSize: 13 }}>
                + Connect another account
              </button>
            )}
            {connectError && <div className="err">{connectError}</div>}
            {syncError && <div className="err">{syncError}</div>}
            <div className="hint" style={{ marginTop: 8 }}>
              {accounts.length} connected account{accounts.length === 1 ? "" : "s"}
              {lastRun && (
                <>
                  {" "}
                  · last run: {lastRun.status} ({lastRun.leaguesOk}/{lastRun.leaguesSeen} leagues ok
                  {lastRun.leaguesFailed > 0 ? `, ${lastRun.leaguesFailed} failed` : ""})
                </>
              )}
            </div>
            {!connected && (
              <div className="hint" style={{ marginTop: 4 }}>
                <a
                  className="link"
                  href="/automation/fantis-sleeper-manager.user.js"
                  target="_blank"
                  rel="noreferrer"
                >
                  Install the userscript
                </a>{" "}
                (requires Tampermonkey) to open leagues from an alert automatically.
              </div>
            )}
            {lastRun?.errors && lastRun.errors.length > 0 && (
              <div className="mgrtable" style={{ marginTop: 8 }}>
                {lastRun.errors.map((e, i) => (
                  <div className="mgrrow static" key={`${e.leagueId}-${i}`}>
                    <span className="tname" style={{ flex: 1 }}>{e.leagueName ?? e.leagueId}</span>
                    <span className="portmeta">{e.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {leagues.length > 0 && (
        <section className="sec">
          <div className="sechead">
            <h2 style={{ fontSize: 18 }}>Today</h2>
            <span className="rt">what needs you right now</span>
          </div>
          <div className="mgrstats">
            <div className="mgrstat">
              <div
                className="mgrstaticon"
                style={{ color: "var(--muted)", background: "color-mix(in srgb, var(--muted) 16%, transparent)" }}
              >
                <IconUsers width={17} height={17} />
              </div>
              <div className="mgrstatbody">
                <p className="mgrstatlabel">Total leagues</p>
                <p className="mgrstatvalue">{leagues.length}</p>
              </div>
            </div>
            <div className="mgrstat">
              <div
                className="mgrstaticon"
                style={{ color: "var(--red)", background: "color-mix(in srgb, var(--red) 16%, transparent)" }}
              >
                <IconFlag width={17} height={17} />
              </div>
              <div className="mgrstatbody">
                <p className="mgrstatlabel">Need attention</p>
                <p className="mgrstatvalue" style={{ color: "var(--red)" }}>{groups.actionRequired.length}</p>
              </div>
            </div>
            <div className="mgrstat">
              <div
                className="mgrstaticon"
                style={{ color: "var(--amber)", background: "color-mix(in srgb, var(--amber) 16%, transparent)" }}
              >
                <IconCalendar width={17} height={17} />
              </div>
              <div className="mgrstatbody">
                <p className="mgrstatlabel">Drafts this week</p>
                <p className="mgrstatvalue">{groups.draftsThisWeek}</p>
              </div>
            </div>
            <div className="mgrstat">
              <div
                className="mgrstaticon"
                style={{ color: "var(--mint)", background: "color-mix(in srgb, var(--mint) 16%, transparent)" }}
              >
                <IconCheck width={17} height={17} />
              </div>
              <div className="mgrstatbody">
                <p className="mgrstatlabel">All clear</p>
                <p className="mgrstatvalue" style={{ color: "var(--mint)" }}>{groups.allClear.length}</p>
              </div>
            </div>
          </div>

          {groups.actionRequired.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div className="sechead" style={{ marginBottom: 8 }}>
                <h3 style={{ fontSize: 14, margin: 0 }}>Your team</h3>
                <span className="rt">{groups.actionRequired.length} leagues</span>
              </div>
              <div className="mgrtable">
                {groups.actionRequired.map(({ league, alerts }) => (
                  <Link href={`/manager/${league.id}`} className="mgrrow" key={league.id}>
                    <span className="tname" style={{ flex: 1 }}>{league.name}</span>
                    <span className="pos" style={alertSeverityChipStyle("action_required")}>
                      {alerts.length} issue{alerts.length === 1 ? "" : "s"}
                    </span>
                    <span className="portmeta">
                      {alerts[0].message}
                      {alerts.length > 1 ? ` +${alerts.length - 1} more` : ""}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {groups.commissioner.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div className="sechead" style={{ marginBottom: 8 }}>
                <h3 style={{ fontSize: 14, margin: 0 }}>Commissioner</h3>
                <span className="rt">{groups.commissioner.length} leagues</span>
              </div>
              <div className="mgrtable">
                {groups.commissioner.map(({ league, alerts }) => (
                  <Link href={`/manager/${league.id}`} className="mgrrow" key={league.id}>
                    <span className="tname" style={{ flex: 1 }}>{league.name}</span>
                    <span className="pos" style={alertSeverityChipStyle("review")}>review</span>
                    <span className="portmeta">{alerts[0].message}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {(groups.upcomingDrafts.length > 0 || groups.review.length > 0) && (
            <div style={{ marginTop: 18 }}>
              <div className="sechead" style={{ marginBottom: 8 }}>
                <h3 style={{ fontSize: 14, margin: 0 }}>Drafts & deadlines</h3>
                <span className="rt">{groups.upcomingDrafts.length + groups.review.length} leagues</span>
              </div>
              <div className="mgrtable">
                {groups.upcomingDrafts.map(({ league, draft }) => (
                  <Link href={`/manager/${league.id}`} className="mgrrow" key={league.id}>
                    <span className="tname" style={{ flex: 1 }}>{league.name}</span>
                    <span className="portvalue">{mounted ? formatUpcoming(draft?.startTime) : "—"}</span>
                  </Link>
                ))}
                {groups.review.map(({ league, alerts }) => (
                  <Link href={`/manager/${league.id}`} className="mgrrow" key={league.id}>
                    <span className="tname" style={{ flex: 1 }}>{league.name}</span>
                    <span className="pos" style={alertSeverityChipStyle("review")}>review</span>
                    <span className="portmeta">{alerts[0].message}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {groups.actionRequired.length === 0 &&
            groups.commissioner.length === 0 &&
            groups.upcomingDrafts.length === 0 &&
            groups.review.length === 0 && (
              <p className="hint" style={{ marginTop: 18 }}>Nothing needs you right now.</p>
            )}
        </section>
      )}

      {groups.allClear.length > 0 && (
        <section className="sec">
          <div className="sechead">
            <h2 style={{ fontSize: 18 }}>All clear</h2>
            <button className="chip-filter" onClick={() => setShowAllClear((v) => !v)}>
              {showAllClear ? "Hide" : `Show ${groups.allClear.length} leagues`}
            </button>
          </div>
          {showAllClear && (
            <div className="mgrtable">
              {groups.allClear.map((league) => (
                <Link href={`/manager/${league.id}`} className="mgrrow" key={league.id}>
                  <span className="tname" style={{ flex: 1 }}>{league.name}</span>
                  <span className="pos" style={alertSeverityChipStyle("clear")}>clear</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {leagues.length === 0 ? (
        <section className="sec">
          <p className="hint">
            No leagues yet — connect a Sleeper username above to sync its real leagues in.
          </p>
        </section>
      ) : (
        <section className="sec">
          <div className="sechead">
            <h2 style={{ fontSize: 18 }}>All leagues</h2>
            <span className="rt">browse everything, not just exceptions</span>
          </div>
          <div className="field" style={{ marginBottom: 12, alignItems: "center" }}>
            <input
              className="input"
              placeholder="Search leagues…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ maxWidth: 280 }}
            />
            <button
              className={`chip-filter ${statusFilter === "ALL" ? "on" : ""}`}
              onClick={() => setStatusFilter("ALL")}
            >
              All <span className="portmeta">{leagues.length}</span>
            </button>
            {STATUSES.map((s) => (
              <button
                key={s}
                className={`chip-filter ${statusFilter === s ? "on" : ""}`}
                onClick={() => setStatusFilter(s)}
              >
                {statusLabel(s)} <span className="portmeta">{statusCounts[s] ?? 0}</span>
              </button>
            ))}
          </div>

          <div
            className="field"
            style={{
              marginBottom: 0,
              gap: 12,
              position: "sticky",
              top: 0,
              zIndex: 1,
              background: "var(--ink)",
              padding: "8px 0",
            }}
          >
            {(["name", "season", "teams", "status", "synced"] as SortKey[]).map((k) => (
              <button
                key={k}
                className={`sorth ${sortBy === k ? "on" : ""}`}
                onClick={() => toggleSort(k)}
              >
                {k === "name"
                  ? "Name"
                  : k === "season"
                    ? "Season"
                    : k === "teams"
                      ? "Teams"
                      : k === "status"
                        ? "Status"
                        : "Synced"}
                {sortBy === k && <span className="arrow">{sortDir === "asc" ? "↑" : "↓"}</span>}
              </button>
            ))}
          </div>

          <div className="mgrtable">
            {sorted.map((lg) => (
              <Link href={`/manager/${lg.id}`} className="mgrrow" key={lg.id}>
                <LeagueAvatar league={lg} />
                <span className="tname" style={{ flex: 1 }}>{lg.name}</span>
                <span className="portmeta">{lg.totalRosters} teams</span>
                <span className="portmeta">{lg.season}</span>
                <span className="pos" style={statusChipStyle(lg.status)}>
                  {statusLabel(lg.status)}
                </span>
                <span className="portmeta">synced {mounted ? formatRelative(lg.lastSyncedAt) : "—"}</span>
              </Link>
            ))}
            {sorted.length === 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  padding: "32px 16px",
                  color: "var(--dim)",
                }}
              >
                <IconSearch width={22} height={22} />
                <span style={{ color: "var(--bone)", fontSize: 13, fontWeight: 600 }}>No leagues found</span>
                <span className="hint" style={{ margin: 0 }}>Try a different search or status filter.</span>
              </div>
            )}
          </div>
          {sorted.length > 0 && (
            <div className="hint" style={{ marginTop: 8, display: "flex", justifyContent: "space-between" }}>
              <span>
                {sorted.length} league{sorted.length === 1 ? "" : "s"} shown
                {sorted.length !== leagues.length ? ` of ${leagues.length}` : ""}
              </span>
              <span>
                {sorted.reduce((sum, lg) => sum + lg.totalRosters, 0)} total teams
              </span>
            </div>
          )}
        </section>
      )}
    </>
  );
}
