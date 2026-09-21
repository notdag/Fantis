-- CreateTable
CREATE TABLE "FantasyCalcPlayer" (
    "fcId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "team" TEXT,
    "age" DOUBLE PRECISION,
    "birthday" TEXT,
    "college" TEXT,
    "draftInfo" JSONB,
    "sleeperId" TEXT,
    "mflId" TEXT,
    "espnId" TEXT,
    "fleaflickerId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FantasyCalcPlayer_pkey" PRIMARY KEY ("fcId")
);

-- CreateTable
CREATE TABLE "FantasyCalcValue" (
    "id" TEXT NOT NULL,
    "formatKey" TEXT NOT NULL,
    "fcId" INTEGER NOT NULL,
    "sleeperId" TEXT,
    "name" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "team" TEXT,
    "value" INTEGER NOT NULL,
    "overallRank" INTEGER NOT NULL,
    "positionRank" INTEGER NOT NULL,
    "trend30Day" INTEGER,
    "starter" BOOLEAN NOT NULL DEFAULT false,
    "redraftValue" INTEGER,
    "combinedValue" INTEGER,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FantasyCalcValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FantasyCalcFetch" (
    "key" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "FantasyCalcFetch_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "FantasyCalcPlayer_sleeperId_idx" ON "FantasyCalcPlayer"("sleeperId");

-- CreateIndex
CREATE INDEX "FantasyCalcValue_formatKey_sleeperId_idx" ON "FantasyCalcValue"("formatKey", "sleeperId");

-- CreateIndex
CREATE UNIQUE INDEX "FantasyCalcValue_formatKey_fcId_key" ON "FantasyCalcValue"("formatKey", "fcId");
