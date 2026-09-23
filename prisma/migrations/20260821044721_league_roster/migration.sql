-- CreateTable
CREATE TABLE "LeagueRoster" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "rosterId" INTEGER NOT NULL,
    "ownerId" TEXT,
    "players" TEXT[],
    "starters" TEXT[],

    CONSTRAINT "LeagueRoster_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeagueRoster_leagueId_idx" ON "LeagueRoster"("leagueId");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueRoster_leagueId_rosterId_key" ON "LeagueRoster"("leagueId", "rosterId");

-- AddForeignKey
ALTER TABLE "LeagueRoster" ADD CONSTRAINT "LeagueRoster_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;
