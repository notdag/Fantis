// Client helpers for the owner's lineup preferences (priority + avoid lists),
// stored server-side via /api/manager/preferences. Plain Sleeper player ids;
// no Sleeper token involved.
export interface PlayerPrefs {
  priority: string[]; // ordered, index 0 = top pick
  avoid: string[];
  // Ordered allow-list for "who to release to make room on a full IR" —
  // when non-empty, this is the ONLY set of players the IR-opportunities
  // scan will ever suggest releasing, in this order. Empty = no restriction
  // (falls back to ranking every real IR occupant by value, as before).
  irRelease: string[];
  // Hard exclude — never started, in any league, full stop. Stronger than
  // "avoid" (which still starts him if nobody else can fill the slot):
  // this is a real standing rule ("move X away from my lineup"), enforced
  // directly by the optimizer, not just a preference it weighs.
  neverStart: string[];
  // Ordered "put these in FLEX first" list (index 0 = most wanted there).
  // A tie-break in the optimizer, not a hard rule — see lineupOptimizer's
  // flexFirst. A player can only be on one list, so priority wins.
  flexFirst: string[];
}

export const EMPTY_PREFS: PlayerPrefs = { priority: [], avoid: [], irRelease: [], neverStart: [], flexFirst: [] };

export async function loadPrefs(): Promise<PlayerPrefs> {
  const res = await fetch("/api/manager/preferences");
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Couldn't load your player preferences.");
  return { priority: body.priority ?? [], avoid: body.avoid ?? [], irRelease: body.irRelease ?? [], neverStart: body.neverStart ?? [], flexFirst: body.flexFirst ?? [] };
}

export async function savePrefs(prefs: PlayerPrefs): Promise<void> {
  const res = await fetch("/api/manager/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prefs),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Couldn't save your player preferences.");
}
