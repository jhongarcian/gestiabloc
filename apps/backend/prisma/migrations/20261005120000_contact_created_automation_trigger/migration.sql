ALTER TYPE "AutomationTriggerType" ADD VALUE 'CONTACT_CREATED';
ALTER TYPE "AutomationConditionSource" ADD VALUE 'CONTACT_FIELD';
ALTER TYPE "AutomationNodeEventSource" ADD VALUE 'CONTACT_CREATED';

ALTER TABLE "Automation" ALTER COLUMN "pipelineId" DROP NOT NULL;
ALTER TABLE "AutomationCondition" ADD COLUMN "fieldKey" TEXT;
ALTER TABLE "AutomationEvent"
  ALTER COLUMN "opportunitySnapshotId" DROP NOT NULL,
  ALTER COLUMN "pipelineId" DROP NOT NULL,
  ALTER COLUMN "pipelineName" DROP NOT NULL,
  ALTER COLUMN "targetStageId" DROP NOT NULL,
  ALTER COLUMN "targetStageName" DROP NOT NULL,
  ALTER COLUMN "valueCents" DROP NOT NULL;
