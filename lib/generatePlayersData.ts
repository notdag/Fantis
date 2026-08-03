// Regenerates lib/players.data.ts's contents from an ordered player list.
// Server-only (used by app/api/admin/save-tiers/route.ts) — keeps the file
// format in one place instead of duplicating it in the route.
interface OutPlayer {
  name: string;
  pos: string;
  team: string;
  tier: number;
  posRank: number;
}

export function generatePlayersData(players: OutPlayer[]): string {
  const lines = players
    .map(
      (p) =>
        `  [${JSON.stringify(p.name)},${JSON.stringify(p.pos)},${JSON.stringify(p.team)},${p.tier},${p.posRank}],`
    )
    .join("\n");

  return `// Curated player list — tier + rank. Order is the master rank (top to
// bottom, all positions mixed); posRank is derived from position within
// that order. Editable by hand, but the intended way to change it is the
// owner-only tier board at /admin (components/TierBoard.tsx), which
// overwrites this file on save. See CLAUDE.md.

export type PlayerTuple = [name: string, pos: string, team: string, tier: number, posRank: number];

export const RAW: PlayerTuple[] = [
${lines}
];
`;
}
