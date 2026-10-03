ALTER TYPE "AutomationActionType" ADD VALUE 'REMOVE_FROM_WORKFLOW';

ALTER TABLE "AutomationAction"
ADD COLUMN "removeFromWorkflowConfig" JSONB;

ALTER TABLE "AutomationRun"
ADD COLUMN "exitRequestedAt" TIMESTAMP(3),
ADD COLUMN "exitReasonCode" TEXT,
ADD COLUMN "exitReasonDetails" TEXT;
