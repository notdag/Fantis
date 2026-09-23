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
}

export const EMPTY_PREFS: PlayerPrefs = { priority: [], avoid: [], irRelease: [] };

export async function loadPrefs(): Promise<PlayerPrefs> {
  const res = await fetch("/api/manager/preferences");
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Couldn't load your player preferences.");
  return { priority: body.priority ?? [], avoid: body.avoid ?? [], irRelease: body.irRelease ?? [] };
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
