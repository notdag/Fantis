-- CreateTable
CREATE TABLE "WeeklyResult" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "rosterId" INTEGER NOT NULL,
    "points" DOUBLE PRECISION NOT NULL,
    "won" BOOLEAN,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "WeeklyResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaiverHistory" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "leagueName" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "rosterId" INTEGER NOT NULL,
    "waiverPosition" INTEGER,
    "faabUsed" INTEGER,
    "faabBudget" INTEGER,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaiverHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklyResult_leagueId_idx" ON "WeeklyResult"("leagueId");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyResult_leagueId_week_rosterId_key" ON "WeeklyResult"("leagueId", "week", "rosterId");

-- CreateIndex
CREATE INDEX "WaiverHistory_accountId_season_idx" ON "WaiverHistory"("accountId", "season");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverHistory_accountId_leagueId_season_key" ON "WaiverHistory"("accountId", "leagueId", "season");

-- AddForeignKey
ALTER TABLE "WeeklyResult" ADD CONSTRAINT "WeeklyResult_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaiverHistory" ADD CONSTRAINT "WaiverHistory_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SleeperAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
