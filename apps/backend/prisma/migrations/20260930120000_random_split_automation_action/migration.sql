ALTER TYPE "AutomationActionType" ADD VALUE IF NOT EXISTS 'SPLIT';

ALTER TABLE "AutomationAction"
ADD COLUMN "splitConfig" JSONB;
