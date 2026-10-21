CREATE TYPE "ServiceStepProgressionStatus" AS ENUM ('NONE', 'WAITING_AUTOMATION', 'PAUSED', 'ADVANCED', 'FINISHED');
ALTER TABLE "ServiceStepOccurrence"
  ADD COLUMN "completedByUserId" TEXT,
  ADD COLUMN "completionEventId" TEXT,
  ADD COLUMN "progressionStatus" "ServiceStepProgressionStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "progressionMessage" TEXT,
  ADD COLUMN "advancedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "ServiceStepOccurrence_completionEventId_key" ON "ServiceStepOccurrence"("completionEventId");
ALTER TABLE "Automation" DROP CONSTRAINT "Automation_service_step_trigger_check";
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_service_step_trigger_check"
  CHECK (("serviceStepId" IS NOT NULL) = ("triggerType" IN ('SERVICE_STEP_ENTERED', 'SERVICE_STEP_COMPLETED')));

-- Backfill disabled completion drafts without dispatching historical completions.
-- Choose readable, tenant-unique names without changing existing automations.
DO $$
DECLARE step RECORD; draft_name TEXT; suffix INTEGER;
BEGIN
  FOR step IN SELECT * FROM "ServiceStep" ORDER BY "tenantId", "id" LOOP
    draft_name := 'Step completed: ' || LEFT(step."title", 82);
    suffix := 1;
    WHILE EXISTS (SELECT 1 FROM "Automation" WHERE "tenantId" = step."tenantId" AND "name" = draft_name) LOOP
      suffix := suffix + 1;
      draft_name := 'Step completed: ' || LEFT(step."title", 82) || ' (' || suffix || ')';
    END LOOP;
    INSERT INTO "Automation" ("id", "tenantId", "name", "triggerType", "serviceStepId", "isEnabled", "updatedAt")
    VALUES (gen_random_uuid()::text, step."tenantId", draft_name, 'SERVICE_STEP_COMPLETED', step."id", false, CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
  END LOOP;
END $$;
