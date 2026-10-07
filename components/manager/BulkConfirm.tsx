"use client";

import { useState, type ReactNode } from "react";
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

// Small enough to just read top to bottom; past this, forcing a scroll
// through every line before sending is what makes reviewing a real 70-200
// league batch impractical — so the list collapses behind a toggle instead,
// with `summary` (a real, computed breakdown — never a guess) standing in
// for it by default.
const COLLAPSE_ABOVE = 8;

// One review step before anything is sent: a real summary (and the full
// list, on request), then a single explicit confirm. Deliberately not a
// browser confirm() so the detail can be read properly when wanted.
export function BulkConfirm({
  title,
  summary,
  lines,
  confirmLabel,
  onConfirm,
  onCancel,
  disabled,
}: {
  title: string;
  // A short, real breakdown (e.g. "72 IR moves · 24 releases across 72
  // leagues") shown above the list — computed by the caller from the same
  // data as `lines`, never invented. Optional; omit for a small batch where
  // the full list is already short enough to just read.
  summary?: ReactNode;
  lines: ReactNode[];
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  // When true the confirm button is disabled instead of silently no-op'ing —
  // use this (not an onConfirm early-return) when confirming depends on
  // something else the user must do first (e.g. a review checkbox), so a
  // click always gives visible feedback.
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(lines.length <= COLLAPSE_ABOVE);
  return (
    <div className="card sync" style={{ marginBottom: 12, borderColor: "var(--amber)" }}>
      <p className="hint" style={{ margin: 0, color: "var(--bone)", fontWeight: 600 }}>{title}</p>
      {summary && <p className="hint" style={{ margin: "6px 0 0" }}>{summary}</p>}
      {lines.length > COLLAPSE_ABOVE && (
        <button className="ccexample" style={{ margin: "8px 0" }} onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Hide the full list" : `Show all ${lines.length} lines`}
        </button>
      )}
      {expanded && (
        <ul className="hint" style={{ margin: "8px 0", paddingLeft: 18, maxHeight: 220, overflowY: "auto" }}>
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
      <p className="hint" style={{ margin: "0 0 8px" }}>
        These are real changes on Sleeper and can&rsquo;t be undone from here.
      </p>
      <div className="field">
        <button className="btn" disabled={disabled} onClick={onConfirm}>{confirmLabel}</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
