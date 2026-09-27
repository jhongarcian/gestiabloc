ALTER TYPE "AutomationActionType" ADD VALUE 'FORMAT_DATE_TIME';

ALTER TABLE "AutomationAction"
ADD COLUMN "dateTimeFormatterConfig" JSONB;

ALTER TABLE "AutomationRun"
ADD COLUMN "variables" JSONB NOT NULL DEFAULT '{}'::jsonb;
