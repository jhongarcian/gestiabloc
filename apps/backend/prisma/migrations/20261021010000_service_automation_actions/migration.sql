-- Add service actions without changing saved workflows or enrollment history.
ALTER TYPE "AutomationActionType" ADD VALUE 'MOVE_SERVICE_STEP';
ALTER TYPE "AutomationActionType" ADD VALUE 'COMPLETE_SERVICE_STEP';
ALTER TYPE "AutomationActionType" ADD VALUE 'SKIP_SERVICE_STEP';
ALTER TYPE "AutomationActionType" ADD VALUE 'SCHEDULE_SERVICE_STEP';
ALTER TYPE "AutomationActionType" ADD VALUE 'SET_SERVICE_STEP_OWNER';
ALTER TYPE "AutomationActionType" ADD VALUE 'SET_SERVICE_COORDINATOR';
ALTER TYPE "AutomationActionType" ADD VALUE 'SET_SERVICE_PROFESSIONAL';
ALTER TYPE "AutomationActionType" ADD VALUE 'SET_SERVICE_CHECKLIST_STATUS';
ALTER TYPE "AutomationActionType" ADD VALUE 'SET_SERVICE_STATUS';

ALTER TABLE "AutomationAction" ADD COLUMN "serviceConfig" JSONB;
ALTER TABLE "ContactServiceStep" ADD COLUMN "assignedToUserId" TEXT;
ALTER TABLE "ContactServiceStep" ADD CONSTRAINT "ContactServiceStep_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceStepMovement" ALTER COLUMN "actorUserId" DROP NOT NULL, ADD COLUMN "automationSource" JSONB;
ALTER TABLE "ServiceStepDeadlineChange" ALTER COLUMN "actorUserId" DROP NOT NULL, ADD COLUMN "automationSource" JSONB;
ALTER TABLE "AutomationRun" ADD COLUMN "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "ServiceAutomationActionResult" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "runId" TEXT NOT NULL, "nodeKey" TEXT NOT NULL,
  "contactServiceId" TEXT NOT NULL, "occurrenceId" TEXT, "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ServiceAutomationActionResult_tenantId_runId_nodeKey_key" ON "ServiceAutomationActionResult"("tenantId", "runId", "nodeKey");
CREATE INDEX "ServiceActionResult_enrollment_created_idx" ON "ServiceAutomationActionResult"("tenantId", "contactServiceId", "createdAt");
CREATE TABLE "AutomationExecutionLease" (
  "kind" TEXT NOT NULL, "jobId" TEXT NOT NULL, "tenantId" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL, "leaseToken" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("kind", "jobId")
);
CREATE UNIQUE INDEX "AutomationExecutionLease_scopeKey_key" ON "AutomationExecutionLease"("scopeKey");
CREATE INDEX "AutomationExecutionLease_expiresAt_idx" ON "AutomationExecutionLease"("expiresAt");
CREATE INDEX "AutomationExecutionLease_tenantId_expiresAt_idx" ON "AutomationExecutionLease"("tenantId", "expiresAt");

ALTER TABLE "ServiceAutomationActionResult" ADD CONSTRAINT "ServiceAutomationActionResult_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationExecutionLease" ADD CONSTRAINT "AutomationExecutionLease_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
