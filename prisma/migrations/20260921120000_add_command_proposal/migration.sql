-- CreateTable
CREATE TABLE "CommandProposal" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "leagueName" TEXT NOT NULL,
    "rosterId" INTEGER NOT NULL,
    "params" JSONB NOT NULL,
    "rationale" JSONB NOT NULL,
    "origin" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "events" JSONB NOT NULL,

    CONSTRAINT "CommandProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommandProposal_status_idx" ON "CommandProposal"("status");

-- CreateIndex
CREATE INDEX "CommandProposal_createdAt_idx" ON "CommandProposal"("createdAt");

-- CreateIndex
CREATE INDEX "CommandProposal_dedupeKey_idx" ON "CommandProposal"("dedupeKey");
