// Green/amber/red banding for rank-style numbers (ADP, position rank) shown
// as small digits in tight table cells — flat gray text made them hard to
// scan or distinguish at a glance. Reuses the app's existing mint/amber/red
// tokens rather than introducing new colors.

// ADP bands roughly track redraft rounds in a 12-team league (round 3, round 8).
export function adpColor(adp: number | null): string {
  if (adp == null) return "var(--dim)";
  if (adp <= 36) return "var(--mint)";
  if (adp <= 96) return "var(--amber)";
  return "var(--red)";
}

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
