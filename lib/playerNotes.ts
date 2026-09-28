// Client helpers for the owner's free-text player notes, stored server-side
// via /api/manager/player-notes. Plain Sleeper player ids; no Sleeper token
// involved. Purely informational — see lib/playerPrefs.ts's `neverStart`
// for the categorical, actually-enforced rule.
export type PlayerNotes = Record<string, string>; // playerId -> note

export async function loadNotes(): Promise<PlayerNotes> {
  const res = await fetch("/api/manager/player-notes");
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Couldn't load your player notes.");
  return body.notes ?? {};
}

// Empty note deletes it.
export async function saveNote(playerId: string, note: string): Promise<void> {
  const res = await fetch("/api/manager/player-notes", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, note }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Couldn't save that note.");
}
