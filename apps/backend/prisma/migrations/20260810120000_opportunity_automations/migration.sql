CREATE TYPE "AutomationTriggerType" AS ENUM ('OPPORTUNITY_CREATED', 'OPPORTUNITY_STAGE_CHANGED');
CREATE TYPE "AutomationConditionSource" AS ENUM ('OPPORTUNITY_VALUE', 'CONTACT_STATUS', 'CONTACT_CUSTOM_FIELD', 'CONTACT_ASSIGNEE', 'CONTACT_TAGS');
CREATE TYPE "AutomationOperator" AS ENUM ('EQUALS', 'NOT_EQUALS', 'CONTAINS', 'NOT_CONTAINS', 'GREATER_THAN', 'GREATER_THAN_OR_EQUAL', 'LESS_THAN', 'LESS_THAN_OR_EQUAL', 'BETWEEN', 'INCLUDES_ANY', 'INCLUDES_ALL', 'EXCLUDES_ALL', 'IS_TRUE', 'IS_FALSE', 'IS_EMPTY', 'IS_NOT_EMPTY');
CREATE TYPE "AutomationActionType" AS ENUM ('SET_CONTACT_CUSTOM_FIELD', 'CLEAR_CONTACT_CUSTOM_FIELD', 'SET_CONTACT_STATUS', 'CLEAR_CONTACT_STATUS', 'SET_CONTACT_ASSIGNEE', 'CLEAR_CONTACT_ASSIGNEE', 'ADD_CONTACT_TAG', 'REMOVE_CONTACT_TAG');
CREATE TYPE "AutomationExecutionStatus" AS ENUM ('SUCCEEDED', 'FAILED');

CREATE TABLE "Automation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "triggerType" "AutomationTriggerType" NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "sourceStageId" TEXT,
    "targetStageId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationCondition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "source" "AutomationConditionSource" NOT NULL,
    "operator" "AutomationOperator" NOT NULL,
    "customFieldId" TEXT,
    "statusConfigId" TEXT,
    "assignedUserId" TEXT,
    "tagId" TEXT,
    "compareValue" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AutomationCondition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationAction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "type" "AutomationActionType" NOT NULL,
    "customFieldId" TEXT,
    "statusConfigId" TEXT,
    "assignedUserId" TEXT,
    "tagId" TEXT,
    "value" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AutomationAction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationExecution" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "automationId" TEXT,
    "automationName" TEXT NOT NULL,
    "triggerType" "AutomationTriggerType" NOT NULL,
    "status" "AutomationExecutionStatus" NOT NULL,
    "opportunityId" TEXT,
    "contactId" TEXT,
    "sourceStageId" TEXT,
    "targetStageId" TEXT,
    "actorUserId" TEXT,
    "actionCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutomationExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Automation_tenantId_id_key" ON "Automation"("tenantId", "id");
CREATE UNIQUE INDEX "Automation_tenantId_name_key" ON "Automation"("tenantId", "name");
CREATE INDEX "Automation_tenantId_isEnabled_sortOrder_idx" ON "Automation"("tenantId", "isEnabled", "sortOrder");
CREATE INDEX "Automation_tenantId_pipelineId_triggerType_isEnabled_idx" ON "Automation"("tenantId", "pipelineId", "triggerType", "isEnabled");
CREATE INDEX "Automation_tenantId_sourceStageId_idx" ON "Automation"("tenantId", "sourceStageId");
CREATE INDEX "Automation_tenantId_targetStageId_idx" ON "Automation"("tenantId", "targetStageId");

CREATE UNIQUE INDEX "AutomationCondition_tenantId_id_key" ON "AutomationCondition"("tenantId", "id");
CREATE INDEX "AutomationCondition_tenantId_automationId_sortOrder_idx" ON "AutomationCondition"("tenantId", "automationId", "sortOrder");
CREATE INDEX "AutomationCondition_tenantId_customFieldId_idx" ON "AutomationCondition"("tenantId", "customFieldId");
CREATE INDEX "AutomationCondition_tenantId_statusConfigId_idx" ON "AutomationCondition"("tenantId", "statusConfigId");
CREATE INDEX "AutomationCondition_tenantId_assignedUserId_idx" ON "AutomationCondition"("tenantId", "assignedUserId");
CREATE INDEX "AutomationCondition_tenantId_tagId_idx" ON "AutomationCondition"("tenantId", "tagId");

CREATE UNIQUE INDEX "AutomationAction_tenantId_id_key" ON "AutomationAction"("tenantId", "id");
CREATE INDEX "AutomationAction_tenantId_automationId_sortOrder_idx" ON "AutomationAction"("tenantId", "automationId", "sortOrder");
CREATE INDEX "AutomationAction_tenantId_customFieldId_idx" ON "AutomationAction"("tenantId", "customFieldId");
CREATE INDEX "AutomationAction_tenantId_statusConfigId_idx" ON "AutomationAction"("tenantId", "statusConfigId");
CREATE INDEX "AutomationAction_tenantId_assignedUserId_idx" ON "AutomationAction"("tenantId", "assignedUserId");
CREATE INDEX "AutomationAction_tenantId_tagId_idx" ON "AutomationAction"("tenantId", "tagId");

CREATE UNIQUE INDEX "AutomationExecution_tenantId_id_key" ON "AutomationExecution"("tenantId", "id");
CREATE INDEX "AutomationExecution_tenantId_createdAt_idx" ON "AutomationExecution"("tenantId", "createdAt");
CREATE INDEX "AutomationExecution_tenantId_automationId_createdAt_idx" ON "AutomationExecution"("tenantId", "automationId", "createdAt");
CREATE INDEX "AutomationExecution_tenantId_status_createdAt_idx" ON "AutomationExecution"("tenantId", "status", "createdAt");
CREATE INDEX "AutomationExecution_tenantId_opportunityId_createdAt_idx" ON "AutomationExecution"("tenantId", "opportunityId", "createdAt");

ALTER TABLE "Automation" ADD CONSTRAINT "Automation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationCondition" ADD CONSTRAINT "AutomationCondition_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationAction" ADD CONSTRAINT "AutomationAction_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
