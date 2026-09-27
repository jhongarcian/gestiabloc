ALTER TYPE "AutomationActionType" ADD VALUE IF NOT EXISTS 'MATH_OPERATION';

ALTER TABLE "AutomationAction"
ADD COLUMN "mathOperationConfig" JSONB;
