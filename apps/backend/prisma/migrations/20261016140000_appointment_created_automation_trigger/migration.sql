ALTER TYPE "AutomationTriggerType" ADD VALUE 'APPOINTMENT_CREATED';
ALTER TYPE "AutomationConditionSource" ADD VALUE 'APPOINTMENT_FIELD';
ALTER TYPE "AutomationNodeEventSource" ADD VALUE 'APPOINTMENT_CREATED';

ALTER TABLE "AutomationEvent"
  ADD COLUMN "appointmentId" TEXT,
  ADD COLUMN "appointmentSnapshot" JSONB;

CREATE INDEX "AutomationEvent_tenantId_appointmentId_idx" ON "AutomationEvent"("tenantId", "appointmentId");
