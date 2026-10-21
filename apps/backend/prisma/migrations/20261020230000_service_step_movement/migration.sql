ALTER TYPE "ServiceStepProgressionStatus" ADD VALUE 'SUPERSEDED';
ALTER TABLE "ServiceStepOccurrence" ADD COLUMN "supersededAt" TIMESTAMP(3);
CREATE TABLE "ServiceStepMovement" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "contactServiceId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "fromOccurrenceId" TEXT NOT NULL,
  "fromStepId" TEXT NOT NULL,
  "fromStepTitle" TEXT NOT NULL,
  "toOccurrenceId" TEXT,
  "toStepId" TEXT,
  "toStepTitle" TEXT,
  "skippedStepIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "reason" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ServiceStepMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServiceStepMovement_kind_check" CHECK ("kind" IN ('MOVE', 'SKIP')),
  CONSTRAINT "ServiceStepMovement_enrollment_fkey" FOREIGN KEY ("tenantId", "contactServiceId") REFERENCES "ContactService"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ServiceStepMovement_tenantId_contactServiceId_requestId_key" ON "ServiceStepMovement"("tenantId", "contactServiceId", "requestId");
CREATE INDEX "ServiceStepMovement_tenantId_contactServiceId_createdAt_idx" ON "ServiceStepMovement"("tenantId", "contactServiceId", "createdAt");
