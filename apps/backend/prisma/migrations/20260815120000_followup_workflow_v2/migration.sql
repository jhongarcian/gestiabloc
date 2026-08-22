CREATE TYPE "FollowUpRunStatus" AS ENUM ('RUNNING', 'WAITING', 'AWAITING_STEP', 'COMPLETED', 'FAILED', 'NEEDS_REVIEW', 'CANCELED');
CREATE TYPE "FollowUpNodeExecutionStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "FollowUpStepResolutionSource" AS ENUM ('USER_COMPLETED', 'USER_SKIPPED', 'CONDITION_SKIPPED', 'FLOW_SKIPPED');
ALTER TYPE "NotificationType" ADD VALUE 'FOLLOW_UP_FAILED';

ALTER TABLE "ServiceFollowUpTemplate"
ADD COLUMN "draftDefinition" JSONB,
ADD COLUMN "needsRepair" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "activeVersionId" TEXT;

ALTER TABLE "ContactService"
ADD COLUMN "followUpTemplateVersionId" TEXT;

ALTER TABLE "ContactServiceFollowUpStep"
ADD COLUMN "runId" TEXT,
ADD COLUMN "resolutionSource" "FollowUpStepResolutionSource",
ADD COLUMN "resolutionReason" TEXT;

ALTER TABLE "ServiceFollowUpExecutionLog"
ADD COLUMN "templateVersionId" TEXT,
ADD COLUMN "runId" TEXT;

ALTER TABLE "Task" ADD COLUMN "followUpTemplateVersionId" TEXT;
ALTER TABLE "ContactNote" ADD COLUMN "followUpTemplateVersionId" TEXT;

CREATE TABLE "ServiceFollowUpTemplateVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 2,
    "checksum" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceFollowUpTemplateVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContactServiceFollowUpRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactServiceId" TEXT NOT NULL,
    "templateVersionId" TEXT,
    "startedByUserId" TEXT,
    "status" "FollowUpRunStatus" NOT NULL DEFAULT 'RUNNING',
    "cursorNodeId" TEXT,
    "activeStepId" TEXT,
    "resumeAt" TIMESTAMP(3),
    "variables" JSONB,
    "branchDecisions" JSONB,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "failureNodeId" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "failedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContactServiceFollowUpRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServiceFollowUpNodeExecution" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "status" "FollowUpNodeExecutionStatus" NOT NULL DEFAULT 'RUNNING',
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "output" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "ServiceFollowUpNodeExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceFollowUpTemplate_activeVersionId_key" ON "ServiceFollowUpTemplate"("activeVersionId");
CREATE UNIQUE INDEX "ServiceFollowUpTemplateVersion_templateId_versionNumber_key" ON "ServiceFollowUpTemplateVersion"("templateId", "versionNumber");
CREATE UNIQUE INDEX "ServiceFollowUpTemplateVersion_templateId_checksum_key" ON "ServiceFollowUpTemplateVersion"("templateId", "checksum");
CREATE INDEX "ServiceFollowUpTemplateVersion_tenantId_templateId_publishedAt_idx" ON "ServiceFollowUpTemplateVersion"("tenantId", "templateId", "publishedAt");
CREATE INDEX "ContactService_tenantId_followUpTemplateVersionId_idx" ON "ContactService"("tenantId", "followUpTemplateVersionId");
CREATE INDEX "ContactServiceFollowUpStep_tenantId_runId_sortOrder_idx" ON "ContactServiceFollowUpStep"("tenantId", "runId", "sortOrder");
CREATE UNIQUE INDEX "ContactServiceFollowUpStep_one_active_v2_run_key" ON "ContactServiceFollowUpStep"("contactServiceId") WHERE "status" = 'ACTIVE' AND "runId" IS NOT NULL;
CREATE UNIQUE INDEX "ContactServiceFollowUpRun_contactServiceId_key" ON "ContactServiceFollowUpRun"("contactServiceId");
CREATE UNIQUE INDEX "ContactServiceFollowUpRun_tenantId_id_key" ON "ContactServiceFollowUpRun"("tenantId", "id");
CREATE INDEX "ContactServiceFollowUpRun_tenantId_status_resumeAt_idx" ON "ContactServiceFollowUpRun"("tenantId", "status", "resumeAt");
CREATE INDEX "ContactServiceFollowUpRun_tenantId_startedByUserId_idx" ON "ContactServiceFollowUpRun"("tenantId", "startedByUserId");
CREATE INDEX "ContactServiceFollowUpRun_status_resumeAt_leaseExpiresAt_idx" ON "ContactServiceFollowUpRun"("status", "resumeAt", "leaseExpiresAt");
CREATE UNIQUE INDEX "ServiceFollowUpNodeExecution_runId_nodeId_key" ON "ServiceFollowUpNodeExecution"("runId", "nodeId");
CREATE INDEX "ServiceFollowUpNodeExecution_tenantId_status_startedAt_idx" ON "ServiceFollowUpNodeExecution"("tenantId", "status", "startedAt");
CREATE INDEX "ServiceFollowUpExecutionLog_tenantId_templateVersionId_createdAt_idx" ON "ServiceFollowUpExecutionLog"("tenantId", "templateVersionId", "createdAt");
CREATE INDEX "ServiceFollowUpExecutionLog_tenantId_runId_createdAt_idx" ON "ServiceFollowUpExecutionLog"("tenantId", "runId", "createdAt");
CREATE INDEX "Task_tenantId_followUpTemplateVersionId_idx" ON "Task"("tenantId", "followUpTemplateVersionId");
CREATE INDEX "ContactNote_tenantId_followUpTemplateVersionId_createdAt_idx" ON "ContactNote"("tenantId", "followUpTemplateVersionId", "createdAt");

ALTER TABLE "ServiceFollowUpTemplateVersion" ADD CONSTRAINT "ServiceFollowUpTemplateVersion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceFollowUpTemplateVersion" ADD CONSTRAINT "ServiceFollowUpTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ServiceFollowUpTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceFollowUpTemplateVersion" ADD CONSTRAINT "ServiceFollowUpTemplateVersion_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceFollowUpTemplate" ADD CONSTRAINT "ServiceFollowUpTemplate_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "ServiceFollowUpTemplateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContactService" ADD CONSTRAINT "ContactService_followUpTemplateVersionId_fkey" FOREIGN KEY ("followUpTemplateVersionId") REFERENCES "ServiceFollowUpTemplateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContactServiceFollowUpRun" ADD CONSTRAINT "ContactServiceFollowUpRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactServiceFollowUpRun" ADD CONSTRAINT "ContactServiceFollowUpRun_contactServiceId_fkey" FOREIGN KEY ("contactServiceId") REFERENCES "ContactService"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactServiceFollowUpRun" ADD CONSTRAINT "ContactServiceFollowUpRun_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "ServiceFollowUpTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContactServiceFollowUpRun" ADD CONSTRAINT "ContactServiceFollowUpRun_startedByUserId_fkey" FOREIGN KEY ("startedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContactServiceFollowUpStep" ADD CONSTRAINT "ContactServiceFollowUpStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ContactServiceFollowUpRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceFollowUpNodeExecution" ADD CONSTRAINT "ServiceFollowUpNodeExecution_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceFollowUpNodeExecution" ADD CONSTRAINT "ServiceFollowUpNodeExecution_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ContactServiceFollowUpRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceFollowUpExecutionLog" ADD CONSTRAINT "ServiceFollowUpExecutionLog_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "ServiceFollowUpTemplateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceFollowUpExecutionLog" ADD CONSTRAINT "ServiceFollowUpExecutionLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ContactServiceFollowUpRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_followUpTemplateVersionId_fkey" FOREIGN KEY ("followUpTemplateVersionId") REFERENCES "ServiceFollowUpTemplateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContactNote" ADD CONSTRAINT "ContactNote_followUpTemplateVersionId_fkey" FOREIGN KEY ("followUpTemplateVersionId") REFERENCES "ServiceFollowUpTemplateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
