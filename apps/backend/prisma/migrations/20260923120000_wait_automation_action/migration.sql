ALTER TYPE "AutomationActionType" ADD VALUE 'WAIT';
ALTER TYPE "AutomationExecutionStatus" ADD VALUE 'EXITED';
ALTER TYPE "AutomationNodeExecutionStatus" ADD VALUE 'WAITING';

CREATE TYPE "AutomationRunStatus" AS ENUM ('RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED', 'EXITED');

ALTER TABLE "AutomationAction"
ADD COLUMN "nodeKey" TEXT,
ADD COLUMN "waitConfig" JSONB;

UPDATE "AutomationAction"
SET "nodeKey" = "id"
WHERE "nodeKey" IS NULL;

ALTER TABLE "AutomationAction"
ALTER COLUMN "nodeKey" SET NOT NULL;

CREATE UNIQUE INDEX "AutomationAction_tenantId_automationId_nodeKey_key"
ON "AutomationAction"("tenantId", "automationId", "nodeKey");

CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "automationId" TEXT,
    "automationName" TEXT NOT NULL,
    "contactId" TEXT,
    "contactName" TEXT NOT NULL,
    "actorUserId" TEXT,
    "opportunityId" TEXT,
    "attemptId" TEXT NOT NULL,
    "eventSource" "AutomationNodeEventSource" NOT NULL,
    "triggerType" "AutomationTriggerType" NOT NULL,
    "sourceStageId" TEXT,
    "targetStageId" TEXT,
    "actionSnapshot" JSONB NOT NULL,
    "cursorIndex" INTEGER NOT NULL DEFAULT 0,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "resumeAt" TIMESTAMP(3),
    "waitingNodeKey" TEXT,
    "waitingNodeExecutionId" TEXT,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "failureNodeKey" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "failedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "exitedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutomationRun_tenantId_id_key" ON "AutomationRun"("tenantId", "id");
CREATE UNIQUE INDEX "AutomationRun_tenantId_attemptId_key" ON "AutomationRun"("tenantId", "attemptId");
CREATE INDEX "AutomationRun_tenantId_automationId_createdAt_idx" ON "AutomationRun"("tenantId", "automationId", "createdAt");
CREATE INDEX "AutomationRun_tenantId_contactId_createdAt_idx" ON "AutomationRun"("tenantId", "contactId", "createdAt");
CREATE INDEX "AutomationRun_status_resumeAt_leaseExpiresAt_idx" ON "AutomationRun"("status", "resumeAt", "leaseExpiresAt");

ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_automationId_fkey"
FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_contactId_fkey"
FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
