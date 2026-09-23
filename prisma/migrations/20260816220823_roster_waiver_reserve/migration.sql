-- AlterTable
ALTER TABLE "Roster" ADD COLUMN     "faabUsed" INTEGER,
ADD COLUMN     "reserve" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "waiverPosition" INTEGER;
