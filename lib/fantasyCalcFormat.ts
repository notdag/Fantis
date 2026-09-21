// Which FantasyCalc value set fits a given Sleeper league. FantasyCalc's values
// depend on the league format, so instead of one fixed snapshot (redraft, 1QB,
// 12-team, PPR — what the older /api/fantasycalc-values proxy used) each league
// is mapped to the closest format their API supports:
//   isDynasty · numQbs (1|2) · numTeams (8|10|12|14) · ppr (0|0.5|1) · tep (none|te+|te++)
// Pure — no fetching. The mapping is an APPROXIMATION of each league's real
// settings (e.g. an 11-team league uses the 10 or 12 set); it is labelled as such
// wherever the numbers are shown.

export interface FcFormat {
  isDynasty: boolean;
  numQbs: 1 | 2;
  numTeams: 8 | 10 | 12 | 14;
  ppr: 0 | 0.5 | 1;
  tep: "none" | "te+" | "te++";
}

export const DEFAULT_FORMAT: FcFormat = { isDynasty: false, numQbs: 1, numTeams: 12, ppr: 1, tep: "none" };

const TEAM_SIZES = [8, 10, 12, 14] as const;
const nearest = <T extends number>(v: number, options: readonly T[]): T => options.reduce((best, o) => (Math.abs(o - v) < Math.abs(best - v) ? o : best), options[0]);

function inner(settings: unknown): Record<string, unknown> {
  const s = settings && typeof settings === "object" ? (settings as Record<string, unknown>).settings : null;
  return s && typeof s === "object" ? (s as Record<string, unknown>) : {};
}

// `settings` = a league's raw Sleeper JSON (League.settings). Anything missing falls
// back to the default rather than guessing something exotic.
export function leagueFormat(settings: unknown, totalRosters: number | null | undefined): FcFormat {
  const top = settings && typeof settings === "object" ? (settings as Record<string, unknown>) : {};
  const rp = Array.isArray(top.roster_positions) ? (top.roster_positions as string[]) : [];
  const scoring = top.scoring_settings && typeof top.scoring_settings === "object" ? (top.scoring_settings as Record<string, unknown>) : {};

  // Sleeper league type: 0 redraft, 1 keeper, 2 dynasty. Only true dynasty counts as dynasty.
  const isDynasty = inner(settings).type === 2;
  const qbSlots = rp.filter((x) => x === "QB").length + rp.filter((x) => x === "SUPER_FLEX").length;
  const numQbs: 1 | 2 = qbSlots >= 2 ? 2 : 1;
  const numTeams = typeof totalRosters === "number" && totalRosters > 0 ? nearest(totalRosters, TEAM_SIZES) : 12;
  const rec = typeof scoring.rec === "number" ? scoring.rec : 1;
  const ppr = nearest(rec, [0, 0.5, 1] as const);
  const bonusTe = typeof scoring.bonus_rec_te === "number" ? scoring.bonus_rec_te : 0;
  const tep: FcFormat["tep"] = bonusTe >= 0.75 ? "te++" : bonusTe >= 0.25 ? "te+" : "none";
  return { isDynasty, numQbs, numTeams, ppr, tep };
}

export const formatKey = (f: FcFormat): string => `${f.isDynasty ? "dyn" : "red"}-${f.numQbs}qb-${f.numTeams}t-${f.ppr}ppr-${f.tep}`;

export function parseFormatKey(key: string): FcFormat | null {
  const m = key.match(/^(dyn|red)-([12])qb-(8|10|12|14)t-(0|0\.5|1)ppr-(none|te\+|te\+\+)$/);
  if (!m) return null;
  return { isDynasty: m[1] === "dyn", numQbs: Number(m[2]) as 1 | 2, numTeams: Number(m[3]) as FcFormat["numTeams"], ppr: Number(m[4]) as FcFormat["ppr"], tep: m[5] as FcFormat["tep"] };
}

// The exact query string FantasyCalc's documented /values/current endpoint takes.
export const valuesQuery = (f: FcFormat): string =>
  `isDynasty=${f.isDynasty}&numQbs=${f.numQbs}&numTeams=${f.numTeams}&ppr=${f.ppr}&tep=${encodeURIComponent(f.tep)}`;

export const describeFormat = (f: FcFormat): string =>
  `${f.isDynasty ? "dynasty" : "redraft"}, ${f.numQbs === 2 ? "2QB/superflex" : "1QB"}, ${f.numTeams}-team, ${f.ppr === 1 ? "PPR" : f.ppr === 0.5 ? "half-PPR" : "standard"}${f.tep === "none" ? "" : `, TE premium ${f.tep}`}`;
