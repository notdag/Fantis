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
  type ManagedAccount,
  type ManagedAlert,
  type ManagedDraft,
  type ManagedLeague,
  type ManagedSyncRun,
} from "@/lib/manager";
import { IconUsers, IconFlag, IconCalendar, IconCheck } from "./MgrIcons";

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
      const alerts = alertsByLeague[lg.id] ?? [];
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
      <section className="sec" style={{ paddingBottom: 0 }}>
        <div className="mgrhead">
          <div className="mgraccentbar" />
          <h1>Sleeper Manager</h1>
          <p>
            {leagues.length} league{leagues.length === 1 ? "" : "s"} across {accounts.length} connected
            account{accounts.length === 1 ? "" : "s"}.
          </p>
        </div>

        <div className="card sync">
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
            <button className="btn ghost" onClick={syncNow} disabled={syncing || accounts.length === 0}>
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          </div>
          {connectError && <div className="err">{connectError}</div>}
          {syncError && <div className="err">{syncError}</div>}
          <div className="hint" style={{ marginTop: 8 }}>
            Last synced {mounted ? formatRelative(mostRecentSync) : "—"}
            {lastRun && (
              <>
                {" "}
                · last run: {lastRun.status} ({lastRun.leaguesOk}/{lastRun.leaguesSeen} leagues ok
                {lastRun.leaguesFailed > 0 ? `, ${lastRun.leaguesFailed} failed` : ""})
              </>
            )}
          </div>
          <div className="hint" style={{ marginTop: 4 }}>
            {connected ? (
              <span style={{ color: "var(--mint)" }}>● Browser automation connected</span>
            ) : (
              <>
                <span style={{ color: "var(--dim)" }}>○ Browser automation not connected</span> —{" "}
                <a
                  className="link"
                  href="/automation/fantis-sleeper-manager.user.js"
                  target="_blank"
                  rel="noreferrer"
                >
                  install the userscript
                </a>{" "}
                (requires Tampermonkey) to open leagues from an alert automatically.
              </>
            )}
          </div>
        </div>
      </section>

      {lastRun && (
        <section className="sec">
          <div className="sechead">
            <h2 style={{ fontSize: 18 }}>Sync health</h2>
            <span className="rt">
              {lastRun.leaguesOk}/{lastRun.leaguesSeen} leagues synced
            </span>
          </div>
          {lastRun.leaguesFailed > 0 ? (
            <>
              <p className="hint" style={{ color: "var(--red)" }}>
                {lastRun.leaguesFailed} league{lastRun.leaguesFailed === 1 ? "" : "s"} failed to sync
              </p>
              {lastRun.errors && lastRun.errors.length > 0 && (
                <div className="mgrtable">
                  {lastRun.errors.map((e, i) => (
                    <div className="mgrrow static" key={`${e.leagueId}-${i}`}>
                      <span className="tname" style={{ flex: 1 }}>{e.leagueName ?? e.leagueId}</span>
                      <span className="portmeta">{e.message}</span>
                    </div>
                  ))}
                </div>
              )}
              <button
                className="btn ghost"
                style={{ marginTop: 8 }}
                onClick={syncNow}
                disabled={syncing || accounts.length === 0}
              >
                {syncing ? "Retrying…" : "Retry"}
              </button>
            </>
          ) : (
            <p className="hint">Every league synced cleanly last run.</p>
          )}
        </section>
      )}

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
              All
            </button>
            {STATUSES.map((s) => (
              <button
                key={s}
                className={`chip-filter ${statusFilter === s ? "on" : ""}`}
                onClick={() => setStatusFilter(s)}
              >
                {statusLabel(s)}
              </button>
            ))}
          </div>

          <div className="field" style={{ marginBottom: 8, gap: 12 }}>
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
                <span className="tname" style={{ flex: 1 }}>{lg.name}</span>
                <span className="portmeta">{lg.totalRosters} teams</span>
                <span className="portmeta">{lg.season}</span>
                <span className="pos" style={statusChipStyle(lg.status)}>
                  {statusLabel(lg.status)}
                </span>
                <span className="portmeta">synced {mounted ? formatRelative(lg.lastSyncedAt) : "—"}</span>
              </Link>
            ))}
            {sorted.length === 0 && <p className="hint" style={{ padding: 16 }}>No leagues match these filters.</p>}
          </div>
        </section>
      )}
    </>
  );
}
