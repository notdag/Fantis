// Turns a league's real roster_positions (e.g. ["QB","RB","RB","WR","WR",
// "TE","FLEX","FLEX","FLEX","BN",...]) into individually selectable
// starting slots for Start/Sit — one row per real slot, in the league's
// own order, bench excluded.

export interface StartingSlot {
  key: string; // stable per-slot React key ("RB-0", "FLEX-2", ...)
  code: string; // raw Sleeper slot code
  label: string;
}

const SLOT_LABELS: Record<string, string> = {
  QB: "Quarterback",
  RB: "Running Back",
  WR: "Wide Receiver",
  TE: "Tight End",
  FLEX: "Flex",
  SUPER_FLEX: "Superflex",
  WRRB_FLEX: "WR/RB Flex",
  REC_FLEX: "WR/TE Flex",
  K: "Kicker",
  DEF: "Defense",
  DL: "D-Line",
  LB: "Linebacker",
  DB: "Defensive Back",
  IDP_FLEX: "IDP Flex",
};

// Which roster positions (as they appear on PlayerMapEntry.p) can fill
// each slot type. Slot codes not listed here fall back to an exact
// position match (slot code === player position).
const SLOT_ELIGIBLE: Record<string, string[]> = {
  FLEX: ["RB", "WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  WRRB_FLEX: ["WR", "RB"],
  REC_FLEX: ["WR", "TE"],
  IDP_FLEX: ["DL", "LB", "DB"],
};

export function buildStartingSlots(rosterPositions: string[]): StartingSlot[] {
  const counts: Record<string, number> = {};
  const slots: StartingSlot[] = [];
  for (const code of rosterPositions) {
    if (code === "BN") continue;
    const i = counts[code] ?? 0;
    counts[code] = i + 1;
    slots.push({ key: `${code}-${i}`, code, label: SLOT_LABELS[code] || code });
  }
  return slots;
}

export function eligiblePositions(code: string): string[] {
  return SLOT_ELIGIBLE[code] || [code];
}
