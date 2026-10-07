-- CreateTable
CREATE TABLE "ReferenceRank" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pos" TEXT NOT NULL,
    "expert" INTEGER,
    "mason" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferenceRank_pkey" PRIMARY KEY ("key")
);
