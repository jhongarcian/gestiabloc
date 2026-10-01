ALTER TYPE "AutomationActionType" ADD VALUE 'GO_TO';

ALTER TABLE "AutomationAction"
ADD COLUMN "goToConfig" JSONB;
