"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { alertSeverityChipStyle, isSnoozed, type ManagedAlert } from "@/lib/manager";

// Shared snooze-row UI: same buttons/behavior whether it's shown per-league
// (LeagueDetail) or flattened across every league (Action Queue) — factored
// out so the two views can't quietly drift apart on how snooze works.
export default function AlertRow({
  alert,
  mounted,
  extra,
  leading,
}: {
  alert: ManagedAlert;
  mounted: boolean;
  extra?: React.ReactNode;
  leading?: React.ReactNode;
}) {
  const router = useRouter();
  const [snoozing, setSnoozing] = useState(false);

  const snooze = async (hours: number) => {
    setSnoozing(true);
    try {
      await fetch(`/api/manager/alerts/${alert.id}/snooze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours }),
      });
      router.refresh();
    } finally {
      setSnoozing(false);
    }
  };

  const snoozed = mounted && isSnoozed(alert);

  return (
    <div className="tradeinboxrow">
      {leading}
      <span className="pos" style={alertSeverityChipStyle(alert.severity)}>
        {alert.severity === "action_required" ? "action required" : "review"}
      </span>
      <span className="tname" style={{ flex: 1 }}>
        {alert.message}
      </span>
      {extra}
      {snoozed ? (
        <>
          <span className="portmeta">
            snoozed until {mounted ? new Date(alert.snoozedUntil!).toLocaleString() : "—"}
          </span>
          <button className="btn ghost sm" disabled={snoozing} onClick={() => snooze(0)}>
            Un-snooze
          </button>
        </>
      ) : (
        <div style={{ display: "flex", gap: 4 }}>
          <button className="btn ghost sm" disabled={snoozing} onClick={() => snooze(24)}>
            1d
          </button>
          <button className="btn ghost sm" disabled={snoozing} onClick={() => snooze(72)}>
            3d
          </button>
          <button className="btn ghost sm" disabled={snoozing} onClick={() => snooze(24 * 7)}>
            1wk
          </button>
          <button className="btn ghost sm" disabled={snoozing} onClick={() => snooze(24 * 365)}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
