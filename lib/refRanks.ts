// "Reference ranks": ranks from outside sources (e.g. Flock's expert rank and
// Mason Dodd's rank) that the owner imports from their own CSV and wants to see
// next to their own rankings on the /admin tier board. Display-only — they
// never reorder or re-tier anything by themselves.
//
// Persisted in Postgres (`ReferenceRank`, via /api/admin/reference-ranks) so an
// upload is saved once and shows on every device/browser. (An earlier version
// kept them in localStorage; `readLegacyRefRanks` lets the board move any such
// data into the database once.)

const LEGACY_KEY = "fantis_ref_ranks_v1";

export interface RefRank {
  expert?: number;
  mason?: number;
}
export interface RefRanks {
  at: string | null; // most recent import
  count: number;
  ranks: Record<string, RefRank>; // key = refRankKey(looseName, pos)
}

export const EMPTY_REF_RANKS: RefRanks = { at: null, count: 0, ranks: {} };

export function refRankKey(looseName: string, pos: string): string {
  return `${looseName}|${pos}`;
}

// Row shape the API stores / returns.
export interface RefRankRow {
  key: string;
  name: string;
  pos: string;
  expert: number | null;
  mason: number | null;
  updatedAt?: string | Date;
}

export function refRanksFromRows(rows: RefRankRow[]): RefRanks {
  const ranks: Record<string, RefRank> = {};
  let latest = 0;
  for (const r of rows) {
    ranks[r.key] = { expert: r.expert ?? undefined, mason: r.mason ?? undefined };
    if (r.updatedAt) latest = Math.max(latest, new Date(r.updatedAt).getTime());
  }
  return { at: latest ? new Date(latest).toISOString() : null, count: rows.length, ranks };
}

export async function putRefRanks(rows: RefRankRow[]): Promise<void> {
  const res = await fetch("/api/admin/reference-ranks", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows: rows.map(({ key, name, pos, expert, mason }) => ({ key, name, pos, expert, mason })) }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Couldn't save the reference ranks.");
  }
}

export async function deleteRefRanks(): Promise<void> {
  const res = await fetch("/api/admin/reference-ranks", { method: "DELETE" });
  if (!res.ok) throw new Error("Couldn't clear the reference ranks.");
}

// Pre-database versions stored these in localStorage. Returns them as rows
// (name is the normalised name from the key) so they can be moved over once.
export function readLegacyRefRanks(): RefRankRow[] {
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw) as { ranks?: Record<string, RefRank> };
    return Object.entries(v.ranks ?? {}).flatMap(([key, r]) => {
      const [name, pos] = key.split("|");
      if (!name || !pos) return [];
      return [{ key, name, pos, expert: r.expert ?? null, mason: r.mason ?? null }];
    });
  } catch {
    return [];
  }
}

export function clearLegacyRefRanks(): void {
  try {
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    // ignore
  }
}
