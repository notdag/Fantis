"use client";

import { useState } from "react";
import { PERMISSION_BLURB, PERMISSION_LABEL, PERMISSION_ORDER, atLeast, type Permission } from "@/lib/commandCenter/proposals";
import { usePermission, writeAutoConfig, writeBulkEnabled, writePermission, readAutoConfig } from "./ccStore";
import { getStoredToken } from "@/lib/sleeperToken";

// The one place the mode changes. It can only be changed by clicking here — never
// by anything typed in the chat. Going UP needs an explicit confirmation (and for
// the top level a typed word); going DOWN is always one click, and "Stop" drops
// straight to Read-only and switches every auto rule off.
export default function PermissionBar() {
  const permission = usePermission();
  const [pending, setPending] = useState<Permission | null>(null);
  const [ack, setAck] = useState(false);
  const [typed, setTyped] = useState("");

  const hasToken = typeof window !== "undefined" && !!getStoredToken();

  const choose = (p: Permission) => {
    if (p === permission) return;
    if (!atLeast(p, permission) || p === "READ_ONLY" || p === "PROPOSE_ONLY") {
      // stepping down, or up to a level that can't change anything on Sleeper
      apply(p);
      return;
    }
    setPending(p);
    setAck(false);
    setTyped("");
  };

  const apply = (p: Permission) => {
    writePermission(p);
    if (!atLeast(p, "EXECUTE_APPROVED")) writeBulkEnabled(false);
    if (p !== "AUTO_EXECUTE") writeAutoConfig({ ...readAutoConfig(), enabled: false });
    setPending(null);
  };

  const stop = () => {
    writePermission("READ_ONLY");
    writeBulkEnabled(false);
    writeAutoConfig({ ...readAutoConfig(), enabled: false });
    setPending(null);
  };

  const needsWord = pending === "AUTO_EXECUTE";
  const canConfirm = ack && (!needsWord || typed.trim().toUpperCase() === "AUTO") && (pending === "PROPOSE_ONLY" || hasToken);

  return (
    <div className="ccperm">
      <div className="ccpermrow" role="group" aria-label="Command Center mode">
        {PERMISSION_ORDER.map((p) => (
          <button
            key={p}
            className={`ccpermbtn ${p === permission ? "on" : ""} ${p === "AUTO_EXECUTE" ? "risky" : ""}`}
            aria-pressed={p === permission}
            onClick={() => choose(p)}
            title={PERMISSION_BLURB[p]}
          >
            {PERMISSION_LABEL[p]}
          </button>
        ))}
        {permission !== "READ_ONLY" && (
          <button className="ccstop" onClick={stop} title="Switch to Read-only and turn every auto rule off">
            Stop
          </button>
        )}
      </div>
      <p className="ccpermblurb">{PERMISSION_BLURB[permission]}</p>

      {pending && (
        <div className="ccpermconfirm">
          <p className="cctext" style={{ margin: 0 }}>
            <strong>Switch to {PERMISSION_LABEL[pending]}?</strong>
          </p>
          <p className="hint" style={{ margin: "6px 0" }}>
            {pending === "EXECUTE_APPROVED" &&
              "This lets you send a proposal to Sleeper — one at a time, only after you approve it and confirm it. Each is re-checked against live data first and verified after. Nothing is ever sent from chat."}
            {pending === "AUTO_EXECUTE" &&
              "This lets the Proposals tab run the trusted rules you switch on (currently only: move an IR/PUP player into an open IR slot) on a timer while this page is open, with daily caps. It stops itself at the first problem. You can press Stop at any time."}
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
          {needsWord && (
            <input className="input" placeholder='Type AUTO to confirm' value={typed} onChange={(e) => setTyped(e.target.value)} style={{ marginBottom: 8 }} />
          )}
          <div className="field">
            <button className="btn sm" disabled={!canConfirm} onClick={() => apply(pending)}>
              Yes, switch
            </button>
            <button className="btn ghost sm" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
