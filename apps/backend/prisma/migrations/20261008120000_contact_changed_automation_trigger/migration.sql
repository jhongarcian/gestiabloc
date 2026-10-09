ALTER TYPE "AutomationTriggerType" ADD VALUE 'CONTACT_CHANGED';
ALTER TYPE "AutomationNodeEventSource" ADD VALUE 'CONTACT_CHANGED';

CREATE TYPE "AutomationChangeOperator" AS ENUM ('HAS_CHANGED', 'HAS_CHANGED_TO', 'ADDED', 'REMOVED');

CREATE TABLE "AutomationContactChangeRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "source" "AutomationConditionSource" NOT NULL,
    "operator" "AutomationChangeOperator" NOT NULL,
    "fieldKey" TEXT,
    "customFieldId" TEXT,
    "statusConfigId" TEXT,
    "assignedUserId" TEXT,
    "tagId" TEXT,
    "compareValue" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AutomationContactChangeRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutomationContactChangeRule_tenantId_id_key" ON "AutomationContactChangeRule"("tenantId", "id");
CREATE INDEX "AutomationContactChangeRule_tenantId_automationId_sortOrder_idx" ON "AutomationContactChangeRule"("tenantId", "automationId", "sortOrder");
ALTER TABLE "AutomationContactChangeRule" ADD CONSTRAINT "AutomationContactChangeRule_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
