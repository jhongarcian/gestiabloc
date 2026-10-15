ALTER TYPE "AutomationTriggerType" ADD VALUE 'TASK_ADDED';
ALTER TYPE "AutomationConditionSource" ADD VALUE 'TASK_FIELD';
ALTER TYPE "AutomationNodeEventSource" ADD VALUE 'TASK_ADDED';

ALTER TABLE "AutomationNoteChainClaim" RENAME TO "AutomationTriggerChainClaim";
ALTER TABLE "AutomationTriggerChainClaim" RENAME CONSTRAINT "AutomationNoteChainClaim_pkey" TO "AutomationTriggerChainClaim_pkey";
ALTER TABLE "AutomationTriggerChainClaim" RENAME CONSTRAINT "AutomationNoteChainClaim_tenantId_fkey" TO "AutomationTriggerChainClaim_tenantId_fkey";

ALTER TABLE "AutomationEvent" ADD COLUMN "taskId" TEXT;
ALTER TABLE "AutomationEvent" ADD COLUMN "taskSnapshot" JSONB;
CREATE INDEX "AutomationEvent_tenantId_taskId_idx" ON "AutomationEvent"("tenantId", "taskId");
