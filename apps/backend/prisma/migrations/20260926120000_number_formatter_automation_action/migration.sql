ALTER TYPE "AutomationActionType" ADD VALUE 'FORMAT_NUMBER';

ALTER TABLE "AutomationAction"
ADD COLUMN "numberFormatterConfig" JSONB;
