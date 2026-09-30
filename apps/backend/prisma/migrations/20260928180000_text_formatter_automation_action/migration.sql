ALTER TYPE "AutomationActionType" ADD VALUE 'FORMAT_TEXT';

ALTER TABLE "AutomationAction"
ADD COLUMN "textFormatterConfig" JSONB;
