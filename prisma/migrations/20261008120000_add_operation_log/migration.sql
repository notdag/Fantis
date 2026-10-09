-- CreateTable
CREATE TABLE "OperationLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "leagueId" TEXT,
    "leagueName" TEXT,
    "playerId" TEXT,
    "playerName" TEXT,
    "action" TEXT NOT NULL,
    "message" TEXT,
    "batchId" TEXT,
    "opKey" TEXT,

    CONSTRAINT "OperationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperationLog_at_idx" ON "OperationLog"("at");
CREATE INDEX "OperationLog_leagueId_idx" ON "OperationLog"("leagueId");
CREATE INDEX "OperationLog_batchId_idx" ON "OperationLog"("batchId");
CREATE INDEX "OperationLog_opKey_idx" ON "OperationLog"("opKey");
