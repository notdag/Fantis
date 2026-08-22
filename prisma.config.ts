// Prisma 7 config — the CLI (migrate/generate) reads DATABASE_URL from here
// rather than from a `url` in schema.prisma's datasource block, which
// Prisma 7 no longer supports. The runtime client (lib/db.ts) is configured
// separately via a driver adapter, since this file only governs the CLI.
//
// Fantis keeps real secrets in .env.local (Next.js's own convention), but
// plain `dotenv/config` only loads .env by default — this CLI process runs
// outside Next's build pipeline and doesn't know that convention on its
// own, so .env.local has to be loaded explicitly.
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

config({ path: ".env" });
config({ path: ".env.local", override: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
