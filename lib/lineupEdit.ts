// Manual lineup edits for the Optimize tool: "I want THIS player in my FLEX". Pure — no React, no I/O.
// The optimizer proposes a lineup; the owner can override any unlocked slot, and every override is checked
// against the same hard rules the optimizer itself obeys (healthy, not locked, never-start, position-eligible)
// so a hand-picked lineup can never be one Sleeper would reject or one that starts an injured player.
import { eligiblePositions } from "./rosterSlots";

const EMPTY = "0";
const isEmpty = (id: string | undefined) => !id || id === EMPTY;

export interface EditCtx {
  slotCodes: string[];
  // Everyone who could start: the roster minus IR/reserve.
  candidates: string[];
  posOf: (id: string) => string | null;
  unavailable: (id: string) => boolean; // out / IR / bye — scores nothing this week
  locked: (id: string) => boolean; // his game already started
  neverStart?: (id: string) => boolean;
}

const fits = (ctx: EditCtx, slotIdx: number, id: string) => {
  const pos = ctx.posOf(id);
  return !!pos && eligiblePositions(ctx.slotCodes[slotIdx]).includes(pos);
};

// A slot whose current occupant's game has started can't change (Sleeper locks it).
export function slotLocked(ctx: EditCtx, lineup: string[], slotIdx: number): boolean {
  const occ = lineup[slotIdx];
  return !isEmpty(occ) && ctx.locked(occ);
}

// Result of putting `playerId` into slot `slotIdx` of `lineup`, or null when that isn't a legal move.
// If he's already starting in another slot the two players swap places — which is only legal when the
// player being displaced is eligible for (and free to move into) the other slot.
export function applyPick(ctx: EditCtx, lineup: string[], slotIdx: number, playerId: string): string[] | null {
  if (slotIdx < 0 || slotIdx >= lineup.length) return null;
  if (lineup[slotIdx] === playerId) return lineup;
  if (slotLocked(ctx, lineup, slotIdx)) return null;
  if (isEmpty(playerId)) return null; // clearing a slot isn't offered as a "pick"
  if (!ctx.candidates.includes(playerId)) return null;
  if (ctx.unavailable(playerId) || ctx.locked(playerId) || ctx.neverStart?.(playerId)) return null;
  if (!fits(ctx, slotIdx, playerId)) return null;

  const next = [...lineup];
  const from = lineup.indexOf(playerId); // where he's starting now, if he is
  const displaced = lineup[slotIdx];
  if (from >= 0) {
    // swap: the displaced player moves into the picked player's old slot
    if (slotLocked(ctx, lineup, from)) return null;
    if (!isEmpty(displaced) && !fits(ctx, from, displaced)) return null;
    next[from] = isEmpty(displaced) ? EMPTY : displaced;
  }
  next[slotIdx] = playerId;
  return next;
}

// Everyone who can legally go in this slot right now (including the current occupant), best-first is the
// caller's job — this only decides legality.
export function slotOptions(ctx: EditCtx, lineup: string[], slotIdx: number): string[] {
  if (slotLocked(ctx, lineup, slotIdx)) return [];
  return ctx.candidates.filter((id) => lineup[slotIdx] === id || applyPick(ctx, lineup, slotIdx, id) !== null);
}

export interface LineupSwap {
  slotIndex: number;
  slotCode: string;
  out: string | null;
  in: string | null;
}

// Slot-by-slot difference between the lineup on Sleeper now and a proposed one.
export function diffLineups(slotCodes: string[], current: string[], proposed: string[]): LineupSwap[] {
  const out: LineupSwap[] = [];
  slotCodes.forEach((code, i) => {
    const a = isEmpty(current[i]) ? null : current[i];
    const b = isEmpty(proposed[i]) ? null : proposed[i];
    if (a !== b) out.push({ slotIndex: i, slotCode: code, out: a, in: b });
  });
  return out;
}
