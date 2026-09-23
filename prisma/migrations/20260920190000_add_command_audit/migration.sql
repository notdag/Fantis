-- CreateTable
CREATE TABLE "CommandAudit" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "command" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "players" JSONB NOT NULL,
    "leaguesTotal" INTEGER NOT NULL,
    "leaguesScanned" INTEGER NOT NULL,
    "leaguesPartial" INTEGER NOT NULL,
    "leaguesFailed" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "counts" JSONB,
    "actionableLeagues" INTEGER,
    "recommendations" JSONB NOT NULL,
    "errors" JSONB NOT NULL,
    "toolCalls" INTEGER NOT NULL,

    CONSTRAINT "CommandAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommandAudit_createdAt_idx" ON "CommandAudit"("createdAt");
