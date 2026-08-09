// 2026 NFL regular-season bye weeks by team, from the league's published
// schedule release (cross-checked against SI, NFL.com, and RotoBaller
// coverage of the 2026 schedule). Not derivable from any Sleeper endpoint
// used elsewhere in this app, so it's a small hand-checked table rather
// than a fabricated one — re-verify against the official schedule if the
// league ever moves a team's bye.
export const BYE_WEEKS_2026: Record<string, number> = {
  CAR: 5,
  KC: 5,
  CIN: 6,
  DET: 6,
  MIA: 6,
  MIN: 6,
  BUF: 7,
  JAX: 7,
  LAC: 7,
  WAS: 7,
  HOU: 8,
  NO: 8,
  NYG: 8,
  SF: 8,
  PIT: 9,
  TEN: 9,
  CHI: 10,
  DEN: 10,
  PHI: 10,
  TB: 10,
  ATL: 11,
  CLE: 11,
  GB: 11,
  LAR: 11,
  NE: 11,
  SEA: 11,
  BAL: 13,
  IND: 13,
  LV: 13,
  NYJ: 13,
  ARI: 14,
  DAL: 14,
};
