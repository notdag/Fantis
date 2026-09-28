"use client";

import { useState } from "react";
import { PERMISSION_BLURB, PERMISSION_LABEL, PERMISSION_ORDER, type Permission } from "@/lib/commandCenter/proposals";
import { usePermission, writeBulkEnabled, writePermission } from "./ccStore";
import { getStoredToken } from "@/lib/sleeperToken";

// The one place the mode changes. It can only be changed by clicking here —
// never by anything typed in the chat. Switching to Live needs one explicit
// confirmation; switching back to Planning is always a single click.
export default function PermissionBar() {
  const permission = usePermission();
  const [pending, setPending] = useState(false);
  const [ack, setAck] = useState(false);

  const hasToken = typeof window !== "undefined" && !!getStoredToken();

  const choose = (p: Permission) => {
    if (p === permission) return;
    if (p === "PLANNING") {
      writePermission("PLANNING");
      writeBulkEnabled(false);
      setPending(false);
      return;
    }
    setAck(false);
    setPending(true);
  };

  return (
    <div className="ccperm">
      <div className="ccpermrow" role="group" aria-label="Command Center mode">
        {PERMISSION_ORDER.map((p) => (
          <button
            key={p}
            className={`ccpermbtn ${p === permission ? "on" : ""}`}
            aria-pressed={p === permission}
            onClick={() => choose(p)}
            title={PERMISSION_BLURB[p]}
          >
            {PERMISSION_LABEL[p]}
          </button>
        ))}
        {permission === "LIVE" && (
          <button
            className="ccstop"
            onClick={() => {
              writePermission("PLANNING");
              writeBulkEnabled(false);
            }}
            title="Switch back to Planning"
          >
            Back to Planning
          </button>
        )}
      </div>
      <p className="ccpermblurb">{PERMISSION_BLURB[permission]}</p>

      {pending && (
        <div className="ccpermconfirm">
          <p className="cctext" style={{ margin: 0 }}>
            <strong>Switch to Live?</strong>
          </p>
          <p className="hint" style={{ margin: "6px 0" }}>
            This lets you send a proposal to Sleeper — one at a time, or as a reviewed batch you select and confirm once. Each one is re-checked against live
            data right before it runs, and verified after.
          </p>
          {!hasToken && (
            <p className="hint" style={{ color: "var(--red)", margin: "6px 0" }}>
              Sleeper access isn&rsquo;t connected in this browser. Connect it on the Lineups page first — without it nothing can be sent.
            </p>
          )}
          <label className="hint" style={{ display: "flex", gap: 8, alignItems: "center", margin: "6px 0" }}>
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            I understand this can change my real Sleeper leagues.
          </label>
          <div className="field">
            <button
              className="btn sm"
              disabled={!ack}
              onClick={() => {
                writePermission("LIVE");
                setPending(false);
              }}
            >
              Yes, switch to Live
            </button>
            <button className="btn ghost sm" onClick={() => setPending(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
