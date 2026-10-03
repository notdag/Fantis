-- CreateTable
CREATE TABLE "PlayerPreference" (
    "playerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerPreference_pkey" PRIMARY KEY ("playerId")
);
