-- CreateTable
CREATE TABLE "Action" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'open_league',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "targetUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationPing" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "lastPingAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,

    CONSTRAINT "AutomationPing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Action_leagueId_idx" ON "Action"("leagueId");

-- CreateIndex
CREATE INDEX "Action_status_idx" ON "Action"("status");

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;
