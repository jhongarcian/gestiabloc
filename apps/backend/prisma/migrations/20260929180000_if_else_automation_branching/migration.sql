ALTER TYPE "AutomationActionType" ADD VALUE IF NOT EXISTS 'IF_ELSE';

ALTER TABLE "AutomationAction"
ADD COLUMN "ifElseConfig" JSONB;

ALTER TABLE "AutomationRun"
ADD COLUMN "cursorPath" JSONB,
ADD COLUMN "branchDecisions" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "eventContext" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "AutomationNodeExecution"
ADD COLUMN "branchPath" JSONB;
