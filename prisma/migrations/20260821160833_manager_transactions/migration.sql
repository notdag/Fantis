-- AlterTable
ALTER TABLE "SyncRun" ADD COLUMN     "transactionsOk" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "LeagueTransaction" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "sleeperTransactionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "creatorTeamName" TEXT,
    "rosterIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "adds" JSONB,
    "drops" JSONB,
    "waiverBid" INTEGER,

    CONSTRAINT "LeagueTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeagueTransaction_leagueId_week_idx" ON "LeagueTransaction"("leagueId", "week");

-- CreateIndex
CREATE INDEX "LeagueTransaction_week_idx" ON "LeagueTransaction"("week");

-- CreateIndex
CREATE INDEX "LeagueTransaction_createdAt_idx" ON "LeagueTransaction"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueTransaction_leagueId_sleeperTransactionId_key" ON "LeagueTransaction"("leagueId", "sleeperTransactionId");

-- AddForeignKey
ALTER TABLE "LeagueTransaction" ADD CONSTRAINT "LeagueTransaction_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;
