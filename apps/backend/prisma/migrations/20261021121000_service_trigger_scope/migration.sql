ALTER TABLE "Automation" DROP CONSTRAINT "Automation_service_offering_trigger_check";
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_service_offering_trigger_check"
  CHECK ("serviceOfferingId" IS NULL OR "serviceStepId" IS NOT NULL OR "serviceGroupId" IS NOT NULL);
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_service_enrollment_trigger_check"
  CHECK (("serviceGroupId" IS NOT NULL AND "serviceTriggerConfig" IS NOT NULL) =
    ("triggerType"::text IN ('SERVICE_ENROLLED', 'SERVICE_STATUS_CHANGED', 'SERVICE_CHECKLIST_STATUS_CHANGED', 'SERVICE_PAYMENT_CHANGED')));
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_tenantId_serviceGroupId_fkey"
  FOREIGN KEY ("tenantId", "serviceGroupId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
