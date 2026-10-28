-- Preserve the exact default already assigned to every existing entry.
ALTER TABLE "ServiceStepOccurrence"
  ADD COLUMN "defaultDueAt" TIMESTAMP(3),
  ADD COLUMN "deadlineOverride" JSONB,
  ADD COLUMN "deadlineRevision" INTEGER NOT NULL DEFAULT 0;
UPDATE "ServiceStepOccurrence" SET "defaultDueAt" = "dueAt";
ALTER TABLE "ServiceStepOccurrence" ALTER COLUMN "defaultDueAt" SET NOT NULL;
CREATE UNIQUE INDEX "ServiceStepOccurrence_tenantId_contactServiceId_id_key" ON "ServiceStepOccurrence"("tenantId", "contactServiceId", "id");
CREATE TABLE "ServiceStepDeadlineChange" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "contactServiceId" TEXT NOT NULL,
  "occurrenceId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "previousDueAt" TIMESTAMP(3) NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "previousSchedule" JSONB NOT NULL,
  "schedule" JSONB NOT NULL,
  "previousRevision" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ServiceStepDeadlineChange_occurrence_fkey" FOREIGN KEY ("tenantId", "contactServiceId", "occurrenceId") REFERENCES "ServiceStepOccurrence"("tenantId", "contactServiceId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ServiceStepDeadlineChange_tenantId_occurrenceId_requestId_key" ON "ServiceStepDeadlineChange"("tenantId", "occurrenceId", "requestId");
CREATE INDEX "ServiceStepDeadlineChange_tenantId_occurrenceId_revision_idx" ON "ServiceStepDeadlineChange"("tenantId", "occurrenceId", "revision");
