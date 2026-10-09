// Win chance for one head-to-head fantasy week, from both teams' projected points.
//
// Documented formula (an estimate, never presented as a certainty): each team's weekly score is treated as normally
// distributed around its projection with a standard deviation of SPREAD × projection (fantasy weekly scores swing
// roughly ±20% around projection). The chance of outscoring the opponent is then
//   P(win) = Φ( (mine − theirs) / √(σ_mine² + σ_theirs²) )
// where Φ is the standard normal CDF. Same shape as StatChasers' "normal week-to-week variance" win odds.
export const SPREAD = 0.2;

// Abramowitz–Stegun 7.1.26 approximation of erf (max error 1.5e-7) — plenty for a percentage.
function erf(x: number): number {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}
export const normalCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

// null when either projection is missing or zero (no lineup yet) — never a made-up 50%.
export function winProb(mine: number | null | undefined, theirs: number | null | undefined): number | null {
  if (mine == null || theirs == null || mine <= 0 || theirs <= 0) return null;
  const sd = Math.sqrt((SPREAD * mine) ** 2 + (SPREAD * theirs) ** 2);
  return normalCdf((mine - theirs) / sd);
}

export type Outlook = "favorite" | "toss-up" | "underdog";
export const outlook = (p: number): Outlook => (p >= 0.6 ? "favorite" : p <= 0.4 ? "underdog" : "toss-up");
export const OUTLOOK_LABEL: Record<Outlook, string> = { favorite: "Favorite", "toss-up": "Toss-up", underdog: "Underdog" };
