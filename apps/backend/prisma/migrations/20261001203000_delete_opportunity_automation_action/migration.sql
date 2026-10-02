ALTER TYPE "AutomationActionType" ADD VALUE 'DELETE_OPPORTUNITY';

ALTER TABLE "AutomationAction"
ADD COLUMN "deleteOpportunityConfig" JSONB;
