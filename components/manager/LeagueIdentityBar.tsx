"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { statusChipStyle, statusLabel, type ManagedLeague } from "@/lib/manager";

// Sleeper's league `settings` blob is untyped JSON here (see prisma/schema.prisma
// — deliberately not normalized). Every field below is read defensively;
// nothing is assumed to exist.
function settingsField(settings: unknown, key: string): unknown {
  if (!settings || typeof settings !== "object") return undefined;
  return (settings as Record<string, unknown>)[key];
}

// Shared identity block (name, status, team count/format, group tag,
// Open in Sleeper / Open via automation) reused at the top of every
// /manager/[leagueId]/* content page — extracted from the old single-page
// LeagueDetail.tsx so all 8 routes show the same real league identity
// without duplicating the group-edit/automation logic 8 times. The
// league switcher and "League info" panel moved out of this block: the
// switcher now lives in the shared ManagerHeader, and the info panel is
// its own /info route.
export default function LeagueIdentityBar({ league }: { league: ManagedLeague }) {
  const router = useRouter();
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

  const scoringSettings = settingsField(league.settings, "scoring_settings");
  const scoringRec =
    scoringSettings && typeof scoringSettings === "object"
      ? (scoringSettings as Record<string, unknown>).rec
      : undefined;
  const formatLabel =
    typeof scoringRec === "number"
      ? scoringRec === 1
        ? "PPR"
        : scoringRec === 0.5
          ? "Half-PPR"
          : scoringRec === 0
            ? "Standard"
            : `${scoringRec} pt/rec`
      : null;

  return (
    <section className="sec" style={{ paddingBottom: 0 }}>
      <div className="mgrhead">
        <div className="mgraccentbar" />
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <h1>{league.name}</h1>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="pos" style={statusChipStyle(league.status)}>
              {statusLabel(league.status)}
            </span>
            <span className="portmeta">
              {league.totalRosters} team{formatLabel ? ` ${formatLabel}` : ""}
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
          </span>
        </div>
      </div>

      <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <a className="btn" href={`https://sleeper.com/leagues/${league.id}`} target="_blank" rel="noreferrer">
          Open in Sleeper →
        </a>
        <button className="btn ghost" onClick={openViaAutomation} disabled={automationState === "waiting"}>
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
  );
}
