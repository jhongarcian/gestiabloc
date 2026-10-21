ALTER TABLE "Automation" ADD COLUMN "serviceOfferingId" TEXT;
DROP INDEX "Automation_tenantId_serviceStepId_triggerType_key";
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_tenantId_serviceOfferingId_fkey" FOREIGN KEY ("tenantId", "serviceOfferingId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_service_offering_trigger_check" CHECK ("serviceOfferingId" IS NULL OR "serviceStepId" IS NOT NULL);
CREATE INDEX "Automation_tenantId_serviceStepId_triggerType_serviceOffering_idx" ON "Automation"("tenantId", "serviceStepId", "triggerType", "serviceOfferingId");
-- Keep the enrollment guard after Prisma's preceding migration removed its partial index.
CREATE UNIQUE INDEX IF NOT EXISTS "ServiceStepOccurrence_one_active_per_enrollment" ON "ServiceStepOccurrence"("tenantId", "contactServiceId") WHERE "status" = 'ACTIVE';
