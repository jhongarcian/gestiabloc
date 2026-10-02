ALTER TYPE "AutomationActionType" ADD VALUE 'ADD_TO_WORKFLOW';
ALTER TYPE "AutomationRunStatus" ADD VALUE 'QUEUED' BEFORE 'RUNNING';
ALTER TYPE "AutomationNodeEventSource" ADD VALUE 'AUTOMATION_ACTION';

ALTER TABLE "AutomationAction"
ADD COLUMN "addToWorkflowConfig" JSONB;

ALTER TABLE "AutomationRun"
ADD COLUMN "causationKey" TEXT;

CREATE UNIQUE INDEX "AutomationRun_causationKey_key"
ON "AutomationRun"("causationKey");

CREATE INDEX "AutomationRun_queue_claim_idx"
ON "AutomationRun"("status", "createdAt", "leaseExpiresAt");
