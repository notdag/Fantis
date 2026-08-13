"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  statusChipStyle,
  statusLabel,
  formatRelative,
  type ManagedAccount,
  type ManagedLeague,
  type ManagedSyncRun,
} from "@/lib/manager";

type SortKey = "name" | "season" | "teams" | "status" | "synced";
type SortDir = "asc" | "desc";

const STATUSES = ["pre_draft", "drafting", "in_season", "complete"] as const;

export default function ManagerDashboard({
  accounts,
  leagues,
  lastRun,
}: {
  accounts: ManagedAccount[];
  leagues: ManagedLeague[];
  lastRun: ManagedSyncRun | null;
}) {
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

  const mostRecentSync = leagues.reduce<string | null>((latest, lg) => {
    if (!lg.lastSyncedAt) return latest;
    if (!latest || lg.lastSyncedAt > latest) return lg.lastSyncedAt;
    return latest;
  }, null);

  return (
    <>
      <section className="sec">
        <div className="sechead">
          <h2>Sleeper Manager</h2>
          <span className="rt">
            {leagues.length} league{leagues.length === 1 ? "" : "s"} across {accounts.length}{" "}
            connected account{accounts.length === 1 ? "" : "s"}
          </span>
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
            Last synced {formatRelative(mostRecentSync)}
            {lastRun && (
              <>
                {" "}
                · last run: {lastRun.status} ({lastRun.leaguesOk}/{lastRun.leaguesSeen} leagues ok
                {lastRun.leaguesFailed > 0 ? `, ${lastRun.leaguesFailed} failed` : ""})
              </>
            )}
          </div>
        </div>
      </section>

      {leagues.length === 0 ? (
        <section className="sec">
          <p className="hint">
            No leagues yet — connect a Sleeper username above to sync its real leagues in.
          </p>
        </section>
      ) : (
        <section className="sec">
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

          <div className="portoverview">
            {sorted.map((lg) => (
              <Link href={`/manager/${lg.id}`} className="portoverviewrow" key={lg.id}>
                <span className="tname">{lg.name}</span>
                <span className="portmeta">{lg.totalRosters} teams</span>
                <span className="portmeta">{lg.season}</span>
                <span className="pos" style={statusChipStyle(lg.status)}>
                  {statusLabel(lg.status)}
                </span>
                <span className="portmeta">synced {formatRelative(lg.lastSyncedAt)}</span>
              </Link>
            ))}
            {sorted.length === 0 && <p className="hint" style={{ padding: 16 }}>No leagues match these filters.</p>}
          </div>
        </section>
      )}
    </>
  );
}
