/*
  Warnings:

  - You are about to drop the `RankingPlayer` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "RankingPlayer";

-- CreateTable
CREATE TABLE "RankedPlayer" (
    "id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "pos" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "posRank" INTEGER NOT NULL,

    CONSTRAINT "RankedPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RankedPlayer_order_key" ON "RankedPlayer"("order");
