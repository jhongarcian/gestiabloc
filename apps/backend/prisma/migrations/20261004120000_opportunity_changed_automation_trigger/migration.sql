ALTER TABLE "Automation"
ADD COLUMN "targetResult" "OpportunityResult";

ALTER TABLE "AutomationExecution"
ADD COLUMN "sourceResult" "OpportunityResult",
ADD COLUMN "targetResult" "OpportunityResult";

ALTER TABLE "AutomationRun"
ADD COLUMN "sourceResult" "OpportunityResult",
ADD COLUMN "targetResult" "OpportunityResult";

ALTER TABLE "AutomationEvent"
ADD COLUMN "sourceResult" "OpportunityResult",
ADD COLUMN "targetResult" "OpportunityResult";

ALTER TABLE "AutomationDispatch"
ADD COLUMN "targetResult" "OpportunityResult";

UPDATE "Automation"
SET "triggerType" = 'OPPORTUNITY_CHANGED'
WHERE "triggerType" = 'OPPORTUNITY_STAGE_CHANGED';

ALTER TABLE "Automation"
ADD CONSTRAINT "Automation_opportunity_changed_target_check"
CHECK (
  (
    "triggerType" = 'OPPORTUNITY_CHANGED'
    AND num_nonnulls("targetStageId", "targetResult") = 1
    AND ("targetResult" IS NULL OR "targetResult" IN ('WON', 'LOST'))
  )
  OR (
    "triggerType" <> 'OPPORTUNITY_CHANGED'
    AND "targetResult" IS NULL
  )
);

CREATE INDEX "Automation_tenantId_targetResult_idx"
ON "Automation"("tenantId", "targetResult");
