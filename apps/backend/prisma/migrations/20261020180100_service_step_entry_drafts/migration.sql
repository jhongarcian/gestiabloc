ALTER TABLE "Automation" ADD COLUMN "serviceStepId" TEXT;
CREATE UNIQUE INDEX "Automation_tenantId_serviceStepId_triggerType_key"
  ON "Automation"("tenantId", "serviceStepId", "triggerType");
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_service_step_trigger_check"
  CHECK (("serviceStepId" IS NOT NULL) = ("triggerType" = 'SERVICE_STEP_ENTERED'));
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_tenantId_serviceStepId_fkey"
  FOREIGN KEY ("tenantId", "serviceStepId") REFERENCES "ServiceStep"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing steps receive empty, disabled drafts. No historical entry is dispatched.
INSERT INTO "Automation" ("id", "tenantId", "name", "triggerType", "serviceStepId", "isEnabled", "updatedAt")
SELECT gen_random_uuid()::text, "tenantId", 'Step entered: ' || LEFT("title", 60) || ' · ' || "id",
       'SERVICE_STEP_ENTERED', "id", false, NOW()
FROM "ServiceStep";
