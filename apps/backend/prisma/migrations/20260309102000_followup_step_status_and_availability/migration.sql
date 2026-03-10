CREATE TYPE "ContactServiceFollowUpStepStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'SKIPPED');

ALTER TABLE "ContactServiceFollowUpStep"
  ADD COLUMN "status" "ContactServiceFollowUpStepStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "availableAt" TIMESTAMP(3);

UPDATE "ContactServiceFollowUpStep"
SET
  "status" = CASE WHEN "completedAt" IS NOT NULL THEN 'COMPLETED'::"ContactServiceFollowUpStepStatus" ELSE 'ACTIVE'::"ContactServiceFollowUpStepStatus" END,
  "availableAt" = COALESCE("dueAt", "createdAt");

CREATE INDEX "ContactServiceFollowUpStep_tenantId_contactServiceId_status_sortOr_idx"
  ON "ContactServiceFollowUpStep"("tenantId", "contactServiceId", "status", "sortOrder");
