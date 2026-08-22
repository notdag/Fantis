-- CreateTable
CREATE TABLE "Roster" (
    "leagueId" TEXT NOT NULL,
    "rosterId" INTEGER NOT NULL,
    "starters" TEXT[],
    "players" TEXT[],
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "ties" INTEGER NOT NULL DEFAULT 0,
    "fpts" DOUBLE PRECISION,
    "fptsAgainst" DOUBLE PRECISION,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "Roster_pkey" PRIMARY KEY ("leagueId")
);

-- CreateTable
CREATE TABLE "Matchup" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "myRosterId" INTEGER NOT NULL,
    "myMatchupId" INTEGER NOT NULL,
    "myPoints" DOUBLE PRECISION NOT NULL,
    "opponentRosterId" INTEGER,
    "opponentTeamName" TEXT,
    "opponentPoints" DOUBLE PRECISION,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "Matchup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "type" TEXT,
    "startTime" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "playerId" TEXT,
    "week" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Matchup_leagueId_idx" ON "Matchup"("leagueId");

-- CreateIndex
CREATE UNIQUE INDEX "Matchup_leagueId_week_key" ON "Matchup"("leagueId", "week");

-- CreateIndex
CREATE INDEX "Draft_leagueId_idx" ON "Draft"("leagueId");

-- CreateIndex
CREATE INDEX "Alert_leagueId_idx" ON "Alert"("leagueId");

-- AddForeignKey
ALTER TABLE "Roster" ADD CONSTRAINT "Roster_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matchup" ADD CONSTRAINT "Matchup_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;
