import type { CSSProperties, ReactNode } from "react";

// One real badge component (2026-08b UI reset) wrapping the already-
// centralized color logic (statusChipStyle/alertSeverityChipStyle/
// transactionTypeChipStyle in lib/manager.ts, posChipStyle in
// lib/players.ts) — replaces the ad-hoc <span className="pos" style={...}>
// pattern repeated per-file. No new color logic; every badge here still
// represents a real, data-driven status, never decoration.
export function Badge({ tone, children }: { tone: CSSProperties; children: ReactNode }) {
  return (
    <span className="pos" style={tone}>
      {children}
    </span>
  );
}
