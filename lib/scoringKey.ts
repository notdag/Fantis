// Which of Sleeper's three projection columns matches a league's reception
// scoring (`scoring_settings.rec`: 0 standard, 0.5 half-PPR, 1 full PPR).
// Custom scoring (TE premium, 6-point passing TDs) is only approximated by
// these — the same documented limitation everywhere projections are used.
export type ScoringKey = "pts_ppr" | "pts_half_ppr" | "pts_std";

export function scoringKey(settings: unknown): ScoringKey {
  const ss = settings && typeof settings === "object" ? (settings as Record<string, unknown>).scoring_settings : null;
  const rec = ss && typeof ss === "object" ? (ss as Record<string, unknown>).rec : undefined;
  if (rec === 0) return "pts_std";
  if (rec === 0.5) return "pts_half_ppr";
  return "pts_ppr";
}
