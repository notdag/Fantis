/*
  Warnings:

  - Added the required column `dedupKey` to the `Alert` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable: add as nullable first so existing rows can be backfilled,
-- then tighten to NOT NULL once every row has a real value.
ALTER TABLE "Alert" ADD COLUMN     "dedupKey" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "snoozedUntil" TIMESTAMP(3);

-- Backfill: same formula lib/managerAlerts.ts now computes going forward —
-- playerId-based for per-player alert types, a fixed type-based key for the
-- three singleton types (draft/trade-deadline/unclaimed), message-based
-- fallback (only empty_slot reaches this branch in practice).
UPDATE "Alert" SET "dedupKey" =
  CASE
    WHEN "playerId" IS NOT NULL THEN "type" || ':' || "playerId"
    WHEN "type" IN ('draft_upcoming', 'trade_deadline_upcoming', 'unclaimed_team') THEN "type" || ':' || "type"
    ELSE "type" || ':' || "message"
  END
WHERE "dedupKey" IS NULL;

ALTER TABLE "Alert" ALTER COLUMN "dedupKey" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Alert_leagueId_resolvedAt_idx" ON "Alert"("leagueId", "resolvedAt");
