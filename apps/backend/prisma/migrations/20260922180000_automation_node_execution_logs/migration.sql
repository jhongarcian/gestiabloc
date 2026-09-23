CREATE TYPE "AutomationNodeKind" AS ENUM ('TRIGGER', 'ACTION');

CREATE TYPE "AutomationNodeExecutionStatus" AS ENUM ('EXECUTED', 'SKIPPED', 'FAILED');

CREATE TYPE "AutomationNodeEventSource" AS ENUM ('MANUAL_ENROLLMENT', 'OPPORTUNITY_CREATED', 'OPPORTUNITY_STAGE_CHANGED');

CREATE TABLE "AutomationNodeExecution" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "automationId" TEXT,
    "automationName" TEXT NOT NULL,
    "contactId" TEXT,
    "contactName" TEXT NOT NULL,
    "actorUserId" TEXT,
    "processId" TEXT,
    "opportunityId" TEXT,
    "attemptId" TEXT NOT NULL,
    "eventSource" "AutomationNodeEventSource" NOT NULL,
    "nodeKind" "AutomationNodeKind" NOT NULL,
    "nodeOrder" INTEGER NOT NULL,
    "nodeKey" TEXT NOT NULL,
    "nodeLabel" TEXT NOT NULL,
    "status" "AutomationNodeExecutionStatus" NOT NULL,
    "reasonCode" TEXT,
    "details" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationNodeExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutomationNodeExecution_tenantId_id_key" ON "AutomationNodeExecution"("tenantId", "id");
CREATE INDEX "AutomationNodeExecution_tenantId_automationId_occurredAt_idx" ON "AutomationNodeExecution"("tenantId", "automationId", "occurredAt");
CREATE INDEX "AutomationNodeExecution_tenantId_contactId_occurredAt_idx" ON "AutomationNodeExecution"("tenantId", "contactId", "occurredAt");
CREATE INDEX "AutomationNodeExecution_tenantId_status_occurredAt_idx" ON "AutomationNodeExecution"("tenantId", "status", "occurredAt");
CREATE INDEX "AutomationNodeExecution_attemptId_nodeOrder_idx" ON "AutomationNodeExecution"("attemptId", "nodeOrder");
CREATE INDEX "AutomationNodeExecution_tenantId_processId_occurredAt_idx" ON "AutomationNodeExecution"("tenantId", "processId", "occurredAt");

ALTER TABLE "AutomationNodeExecution" ADD CONSTRAINT "AutomationNodeExecution_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationNodeExecution" ADD CONSTRAINT "AutomationNodeExecution_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutomationNodeExecution" ADD CONSTRAINT "AutomationNodeExecution_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutomationNodeExecution" ADD CONSTRAINT "AutomationNodeExecution_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutomationNodeExecution" ADD CONSTRAINT "AutomationNodeExecution_processId_fkey" FOREIGN KEY ("processId") REFERENCES "AutomationProcess"("id") ON DELETE SET NULL ON UPDATE CASCADE;
