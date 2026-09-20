// Pure planning rules for the bulk tools on /manager/lineups (Mass IR,
// Mass Add/Claim). No fetching, no React, no Sleeper calls — just "given
// what Fantis already knows about each roster and each league's own real
// settings, what would be a sensible set of moves?". Everything here is a
// *suggestion* the user reviews before anything is sent; the executor in
// lib/bulkRun.ts only ever runs the rows the user leaves checked.

export interface PlanLeague {
  leagueId: string;
  leagueName: string;
  rosterId: number;
  settings: unknown; // raw Sleeper league JSON (League.settings)
  starters: string[];
  players: string[];
  reserve: string[];
  faabUsed: number | null;
}

// Value used to rank who to drop: Fantis's own curated trade value first,
// FantasyCalc's as a tie-breaker only (uncurated players are all 0 on the
// first, so the tie-break is what actually orders them). Never blended into
// one number — same rule as everywhere else in the app.
export type DropRank = (playerId: string) => [number, number];

function setting(settings: unknown, key: string): unknown {
  if (!settings || typeof settings !== "object") return undefined;
  return (settings as Record<string, unknown>)[key];
}

// Sleeper's league JSON nests the rule fields (`reserve_slots`,
// `reserve_allow_*`, `waiver_*`, `taxi_*`) inside a `settings` object, while
// `roster_positions` sits at the top level — confirmed against real synced
// data (reading them off the top level finds nothing).
function num(settings: unknown, key: string): number {
  const inner = setting(settings, "settings");
  const v = inner && typeof inner === "object" ? (inner as Record<string, unknown>)[key] : undefined;
  return typeof v === "number" ? v : 0;
}

export function irSlots(settings: unknown): number {
  return num(settings, "reserve_slots");
}

// Sleeper's own per-league IR rules (`reserve_allow_*`, confirmed real
// fields on GET /league/{id}). Differs league to league — one league may
// allow Out but not Doubtful — so this is always evaluated per league.
// "IR"/"PUP" are treated as always eligible whenever the league has any IR
// slots: an assumption, flagged for first-run verification against a real
// move. Questionable and healthy players are never eligible.
export function irAllowed(settings: unknown, injuryStatus: string | null | undefined): boolean {
  if (irSlots(settings) <= 0 || !injuryStatus) return false;
  switch (injuryStatus) {
    case "IR":
    case "PUP":
      return true;
    case "Out":
      return num(settings, "reserve_allow_out") === 1;
    case "Doubtful":
      // Owner's choice: a Doubtful player might still play, so he's never
      // moved to IR in bulk — even in leagues whose rules would allow it.
      return false;
    case "Sus":
      return num(settings, "reserve_allow_sus") === 1;
    case "NA":
      return num(settings, "reserve_allow_na") === 1;
    case "DNR":
      return num(settings, "reserve_allow_dnr") === 1;
    case "COV":
      return num(settings, "reserve_allow_cov") === 1;
    default:
      return false;
  }
}

// Most-out first, so if a league can't fit everyone the surest cases get
// the open slots.
const SEVERITY: Record<string, number> = { IR: 0, PUP: 0, Out: 1, Sus: 2, COV: 3, DNR: 4, NA: 5, Doubtful: 6 };

function byRankAsc(rank: DropRank) {
  return (a: string, b: string) => {
    const [a1, a2] = rank(a);
    const [b1, b2] = rank(b);
    return a1 - b1 || a2 - b2;
  };
}

// ---------------------------------------------------------------- Mass IR

export interface IrRow {
  key: string;
  leagueId: string;
  leagueName: string;
  rosterId: number;
  playerId: string;
  injury: string;
  inStarters: boolean;
  // Set when the league's IR is full: who to drop from IR to make room.
  // (Dropping a BENCH player would not free an IR slot — only vacating one
  // of the IR slots does — so candidates are current IR players.)
  needsDrop: boolean;
  dropId: string | null;
  dropCandidates: string[];
  // Full IR and no one left to drop — nothing sensible to propose.
  noRoom: boolean;
}

export function buildIrPlan(
  leagues: PlanLeague[],
  injuryOf: (playerId: string) => string | null,
  rank: DropRank
): IrRow[] {
  const rows: IrRow[] = [];
  const asc = byRankAsc(rank);

  for (const lg of leagues) {
    const slots = irSlots(lg.settings);
    if (slots <= 0) continue;

    const eligible = lg.players
      .filter((id) => !lg.reserve.includes(id))
      .map((id) => ({ id, inj: injuryOf(id) }))
      .filter((p): p is { id: string; inj: string } => !!p.inj && irAllowed(lg.settings, p.inj))
      .sort((a, b) => (SEVERITY[a.inj] ?? 9) - (SEVERITY[b.inj] ?? 9));
    if (eligible.length === 0) continue;

    let open = Math.max(0, slots - lg.reserve.length);
    // Current IR players, cheapest first — the drop pool when IR is full.
    const pool = [...lg.reserve].sort(asc);
    const used = new Set<string>();

    for (const p of eligible) {
      const base = {
        key: `${lg.leagueId}:${p.id}`,
        leagueId: lg.leagueId,
        leagueName: lg.leagueName,
        rosterId: lg.rosterId,
        playerId: p.id,
        injury: p.inj,
        inStarters: lg.starters.includes(p.id),
      };
      if (open > 0) {
        open -= 1;
        rows.push({ ...base, needsDrop: false, dropId: null, dropCandidates: [], noRoom: false });
        continue;
      }
      const candidates = pool.filter((id) => !used.has(id));
      const pick = candidates[0] ?? null;
      if (pick) used.add(pick);
      rows.push({
        ...base,
        needsDrop: true,
        dropId: pick,
        dropCandidates: pool,
        noRoom: pick === null,
      });
    }
  }
  return rows;
}

// ------------------------------------------------------------ Mass add/claim

export interface AddRow {
  key: string;
  leagueId: string;
  leagueName: string;
  rosterId: number;
  playerId: string;
  full: boolean; // active roster already at its limit → needs a drop
  dropId: string | null;
  dropCandidates: string[]; // bench players only, cheapest first
  faab: boolean;
  budgetLeft: number | null;
  bidMin: number;
  bid: number;
}

export function buildAddPlan(
  playerId: string,
  leagues: PlanLeague[],
  rosteredLeagueIds: ReadonlySet<string>,
  rank: DropRank
): AddRow[] {
  const asc = byRankAsc(rank);
  const rows: AddRow[] = [];

  for (const lg of leagues) {
    if (rosteredLeagueIds.has(lg.leagueId)) continue; // someone already has him
    if (lg.players.includes(playerId)) continue;

    const rosterSize = (() => {
      const rp = setting(lg.settings, "roster_positions");
      return Array.isArray(rp) ? rp.length : 0;
    })();
    const active = lg.players.length - lg.reserve.length;
    const full = rosterSize > 0 && active >= rosterSize;

    // Bench only: never a starter, never IR (an IR drop wouldn't free an
    // active roster spot), never the incoming player.
    const bench = lg.players
      .filter((id) => id !== playerId && !lg.starters.includes(id) && !lg.reserve.includes(id))
      .sort(asc);

    const faab = num(lg.settings, "waiver_type") === 2;
    const budget = num(lg.settings, "waiver_budget");
    const bidMin = num(lg.settings, "waiver_bid_min");
    rows.push({
      key: `${lg.leagueId}:${playerId}`,
      leagueId: lg.leagueId,
      leagueName: lg.leagueName,
      rosterId: lg.rosterId,
      playerId,
      full,
      dropId: full ? bench[0] ?? null : null,
      dropCandidates: bench,
      faab,
      budgetLeft: faab && budget > 0 ? Math.max(0, budget - (lg.faabUsed ?? 0)) : null,
      bidMin,
      bid: bidMin,
    });
  }
  return rows;
}
