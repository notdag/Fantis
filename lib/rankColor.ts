// Green/amber/red banding for the position-rank number shown as a small
// digit in tight table cells — flat gray text made it hard to scan at a
// glance. Reuses the app's existing mint/amber/red tokens rather than
// introducing new colors. ADP (an overall, cross-position rank) is
// deliberately left uncolored next to it — coloring both made the two
// numbers hard to tell apart at that size.

// Position rank bands scale to how many players are in the pool at that
// position, so a shallow position (TE) and a deep one (RB) both get a
// meaningful top/middle/bottom split instead of one fixed cutoff.
export function posRankColor(posRank: number | null, poolSize: number): string {
  if (posRank == null || poolSize <= 0) return "var(--dim)";
  const pct = posRank / poolSize;
  if (pct <= 1 / 3) return "var(--mint)";
  if (pct <= 2 / 3) return "var(--amber)";
  return "var(--red)";
}
