// One-off migration: copies lib/players.data.ts's RAW array into the new
// RankedPlayer table (see prisma/schema.prisma) as part of moving the
// curated player list from a checked-in file to the DB, so /admin edits
// apply directly instead of requiring a paste-and-deploy round trip. Safe
// to re-run — it replaces every row in one transaction rather than
// appending. Run with `npx tsx scripts/seedRankedPlayers.ts`.
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { RAW } from "../lib/players.data";

async function main() {
  // Dynamic import so it happens after the config() calls above run — a
  // static top-level import would get hoisted ahead of them by the ESM
  // loader, and lib/db.ts reads process.env.DATABASE_URL at module load.
  const { db } = await import("../lib/db");
  await db.$transaction([
    db.rankedPlayer.deleteMany(),
    db.rankedPlayer.createMany({
      data: RAW.map(([name, pos, team, tier, posRank], order) => ({
        order,
        name,
        pos,
        team,
        tier,
        posRank,
      })),
    }),
  ]);
  console.log(`Seeded ${RAW.length} players into RankedPlayer.`);
  await db.$disconnect();
}

main();
