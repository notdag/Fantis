// Transparent drop-candidate model. It only ever produces "suggested drop
// candidates" with the facts behind each — never "the correct drop".
//
// Who is never offered: starters (no benching a starter by dropping him), IR
// and taxi players (dropping one doesn't free an active roster spot), players on
// the owner's Priority list, and anyone whose removal would leave the roster
// short of a position it must start (QB/TE/K/DEF). Everyone else on the bench
// is ranked weakest-first by: Avoid-list first, then Fantis's own value, then
// FantasyCalc's value as a separate tie-break (two labelled numbers, never
// blended — same rule as the rest of the app).
import { rosterPositions } from "./classify";
import type { DropAnalysis, DropCandidate, DropSignals, LeagueSnapshot } from "./types";

// Positions that must be filled by a specific slot, so the last healthy player
// at one is protected. FLEX/SUPER_FLEX are handled in `required`.
const HARD_POS = ["QB", "TE", "K", "DEF"] as const;

function required(rp: string[] | null, pos: string): number {
  if (!rp) return 0;
  const direct = rp.filter((s) => s === pos || (pos === "DEF" && s === "DST")).length;
  // In a superflex league a second QB is needed too.
  const sf = pos === "QB" ? rp.filter((s) => s === "SUPER_FLEX").length : 0;
  return direct + sf;
}

export function analyzeDrops(
  snap: LeagueSnapshot,
  signals: DropSignals,
  opts: { incomingId?: string; count?: number } = {}
): DropAnalysis | null {
  const mine = snap.rosters?.find((r) => r.rosterId === snap.league.rosterId);
  if (!mine) return null; // never analyze a roster we couldn't read
  const count = opts.count ?? 3;
  const rp = rosterPositions(snap.league.settings);

  const off = new Set([...mine.reserve, ...mine.taxi]);
  const active = mine.players.filter((id) => !off.has(id));
  const starterSet = new Set(mine.starters.filter((id) => id && id !== "0"));

  const posCount: Record<string, number> = {};
  for (const id of active) {
    const p = signals.info(id)?.pos ?? "";
    posCount[p] = (posCount[p] ?? 0) + 1;
  }

  let protectedCount = 0;
  const pool: string[] = [];
  for (const id of mine.players) {
    if (id === opts.incomingId) continue;
    const info = signals.info(id);
    const pos = info?.pos ?? "";
    if (off.has(id) || starterSet.has(id) || signals.priority.has(id)) {
      protectedCount++;
      continue;
    }
    if ((HARD_POS as readonly string[]).includes(pos) && (posCount[pos] ?? 0) - 1 < required(rp, pos)) {
      protectedCount++; // dropping him would leave a required position short
      continue;
    }
    pool.push(id);
  }

  const val = (id: string) => signals.fantisValue(id) ?? 0;
  const fc = (id: string) => signals.fcValue(id) ?? 0;
  const sorted = [...pool].sort(
    (a, b) =>
      Number(signals.avoid.has(b)) - Number(signals.avoid.has(a)) ||
      val(a) - val(b) ||
      fc(a) - fc(b) ||
      (signals.info(a)?.name ?? a).localeCompare(signals.info(b)?.name ?? b)
  );

  const top = sorted.slice(0, count);
  // "Arbitrary" = the leaders share identical (0, 0) values, so their order
  // among themselves carries no information.
  const unrankedTie =
    top.length >= 2 && top.every((id) => val(id) === 0 && fc(id) === 0 && !signals.avoid.has(id));

  const benchOfPos = (pos: string) =>
    pool.filter((id) => (signals.info(id)?.pos ?? "") === pos).length;

  const candidates: DropCandidate[] = top.map((id) => {
    const info = signals.info(id);
    const reasons: string[] = [];
    const fv = signals.fantisValue(id);
    const cv = signals.fcValue(id);
    const cur = signals.curated(id);
    if (signals.avoid.has(id)) reasons.push("On your Avoid list");
    reasons.push("Bench player — not in your starting lineup");
    if (fv != null && fv > 0) reasons.push(`Fantis value ${Math.round(fv)} (lowest ranks first among droppable bench players)`);
    else reasons.push("No Fantis value — not in the curated player list");
    if (cv != null && cv > 0) reasons.push(`FantasyCalc value ${Math.round(cv)}`);
    if (cur) reasons.push(`Your /admin ranking: #${cur.order + 1} overall, tier ${cur.tier}, pos rank ${cur.posRank}`);
    else reasons.push("Not ranked in your /admin rankings");
    if (info?.injury) reasons.push(`Injury status: ${info.injury}`);
    const same = info ? posCount[info.pos] ?? 0 : 0;
    if (info && same >= 3) reasons.push(`Roster depth: ${same} ${info.pos}s on the active roster (${benchOfPos(info.pos)} of them on the bench)`);
    return {
      playerId: id,
      name: info?.name ?? id,
      pos: info?.pos ?? "",
      reasons,
      fantisValue: fv,
      fcValue: cv,
      avoid: signals.avoid.has(id),
    };
  });

  return {
    leagueId: snap.league.id,
    candidates,
    protectedCount,
    poolSize: pool.length,
    unrankedTie,
    note:
      pool.length === 0
        ? "No droppable players: every roster player is a starter, on IR/taxi, protected by your Priority list, or required at a position."
        : pool.length < count
          ? `Only ${pool.length} droppable player${pool.length === 1 ? "" : "s"} on this roster.`
          : undefined,
  };
}
