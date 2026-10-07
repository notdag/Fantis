-- CreateTable
CREATE TABLE "PlayerNote" (
    "playerId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerNote_pkey" PRIMARY KEY ("playerId")
);
