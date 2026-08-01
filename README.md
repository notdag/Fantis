# Fantis 🏈

A fantasy football companion app. Link your league and get rankings, rosters,
standings, and a trade calculator — with a paid tier layered on later.

> New here? Read **CLAUDE.md** first — it's the full project brief. If you're
> building this with Claude Code, it reads CLAUDE.md automatically.

## What works today

A single-file React prototype (`fantis-mvp.jsx`) with:
- **Sleeper league sync** (public API, no login) → standings + full rosters
- **Rankings** table (position filter + tiers)
- **Trade calculator** with a tilting verdict bar

## Tech stack (target)

- **Next.js (App Router) + TypeScript** — app + API routes
- **PostgreSQL + Prisma** — users, linked leagues, rankings
- **NextAuth** — accounts
- **Stripe** — subscription tier
- League providers: Sleeper (done) · Yahoo (OAuth) · ESPN (unofficial)

## Quick start

```bash
npm install          # install dependencies
cp .env.example .env # then fill in the values in .env
npx prisma migrate dev
npm run dev          # open http://localhost:3000
```

## Project structure (after scaffolding)

```
app/            # pages and API routes
components/     # UI (ported from the prototype)
lib/            # league providers, rankings, helpers
prisma/         # schema.prisma + migrations
```

## Roadmap

1. Scaffold Next.js, port the prototype UI, keep Sleeper working
2. Add Postgres + Prisma; move rankings out of the hardcoded array into the DB
3. Add auth; save a user's linked leagues
4. Yahoo OAuth (behind the provider interface)
5. Stripe subscription + gate premium features
6. Real rankings/projections pipeline (replaces placeholder values)

## Notes

- Sleeper needs no API key. ESPN/Yahoo require the backend.
- Rankings values are an editable starter set — not betting/investment advice.
- Not affiliated with Sleeper, ESPN, or Yahoo.
