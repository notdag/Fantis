"use client";

import type { ReactNode } from "react";
import type { TaskStatus } from "@/lib/bulkRun";

// Live per-row result cell shared by the IR and Add/Claim tables.
export function StatusCell({ status }: { status: TaskStatus | undefined }) {
  if (!status || status.kind === "queued") return <span className="portmeta" style={{ minWidth: 90 }}>{status ? "queued" : ""}</span>;
  if (status.kind === "running") return <span className="portmeta" style={{ minWidth: 90 }}>sending…</span>;
  if (status.kind === "done") {
    return (
      <span className="portmeta" style={{ minWidth: 90, color: "var(--mint)" }} title={status.note}>
        ✓ done{status.note ? ` · ${status.note}` : ""}
      </span>
    );
  }
  if (status.kind === "skipped") {
    return <span className="portmeta" style={{ minWidth: 90 }} title={status.reason}>skipped</span>;
  }
  return (
    <span className="portmeta" style={{ minWidth: 90, color: "var(--red)" }} title={status.message}>
      ✕ {status.message.length > 70 ? status.message.slice(0, 70) + "…" : status.message}
    </span>
  );
}

// One review step before anything is sent: every change listed, then a
// single explicit confirm. Deliberately not a browser confirm() so the list
// (including each proposed drop) can be read properly.
export function BulkConfirm({
  title,
  lines,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  lines: ReactNode[];
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="card sync" style={{ marginBottom: 12, borderColor: "var(--amber)" }}>
      <p className="hint" style={{ margin: 0, color: "var(--bone)", fontWeight: 600 }}>{title}</p>
      <ul className="hint" style={{ margin: "8px 0", paddingLeft: 18, maxHeight: 220, overflowY: "auto" }}>
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      <p className="hint" style={{ margin: "0 0 8px" }}>
        These are real changes on Sleeper and can&rsquo;t be undone from here.
      </p>
      <div className="field">
        <button className="btn" onClick={onConfirm}>{confirmLabel}</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
