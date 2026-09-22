CREATE TYPE "AutomationProcessStatus" AS ENUM (
  'PREPARING', 'QUEUED', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'
);

CREATE TYPE "AutomationProcessBatchStatus" AS ENUM (
  'PENDING', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS'
);

CREATE TYPE "AutomationProcessContactStatus" AS ENUM (
  'PENDING', 'SUCCEEDED', 'FAILED'
);

CREATE TABLE "AutomationProcess" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "automationId" TEXT,
  "automationName" TEXT NOT NULL,
  "triggerType" "AutomationTriggerType" NOT NULL,
  "actionSnapshot" JSONB NOT NULL,
  "processName" TEXT NOT NULL,
  "status" "AutomationProcessStatus" NOT NULL DEFAULT 'PREPARING',
  "requestedByUserId" TEXT,
  "requestedByName" TEXT NOT NULL,
  "expectedContacts" INTEGER NOT NULL,
  "totalContacts" INTEGER NOT NULL DEFAULT 0,
  "processedContacts" INTEGER NOT NULL DEFAULT 0,
  "succeededContacts" INTEGER NOT NULL DEFAULT 0,
  "failedContacts" INTEGER NOT NULL DEFAULT 0,
  "totalBatches" INTEGER NOT NULL DEFAULT 0,
  "completedBatches" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationProcess_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationProcessBatch" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "processId" TEXT NOT NULL,
  "batchNumber" INTEGER NOT NULL,
  "status" "AutomationProcessBatchStatus" NOT NULL DEFAULT 'PENDING',
  "contactCount" INTEGER NOT NULL,
  "succeededContacts" INTEGER NOT NULL DEFAULT 0,
  "failedContacts" INTEGER NOT NULL DEFAULT 0,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lockedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationProcessBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationProcessContact" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "processId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "contactName" TEXT NOT NULL,
  "status" "AutomationProcessContactStatus" NOT NULL DEFAULT 'PENDING',
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationProcessContact_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AutomationExecution"
ADD COLUMN "processId" TEXT,
ADD COLUMN "processName" TEXT;

CREATE UNIQUE INDEX "AutomationProcess_tenantId_id_key" ON "AutomationProcess"("tenantId", "id");
CREATE INDEX "AutomationProcess_tenantId_createdAt_idx" ON "AutomationProcess"("tenantId", "createdAt");
CREATE INDEX "AutomationProcess_tenantId_status_createdAt_idx" ON "AutomationProcess"("tenantId", "status", "createdAt");
CREATE INDEX "AutomationProcess_tenantId_automationId_createdAt_idx" ON "AutomationProcess"("tenantId", "automationId", "createdAt");
CREATE INDEX "AutomationProcess_tenantId_requestedByUserId_createdAt_idx" ON "AutomationProcess"("tenantId", "requestedByUserId", "createdAt");
CREATE UNIQUE INDEX "AutomationProcessBatch_processId_batchNumber_key" ON "AutomationProcessBatch"("processId", "batchNumber");
CREATE INDEX "AutomationProcessBatch_tenantId_status_createdAt_idx" ON "AutomationProcessBatch"("tenantId", "status", "createdAt");
CREATE INDEX "AutomationProcessBatch_processId_status_batchNumber_idx" ON "AutomationProcessBatch"("processId", "status", "batchNumber");
CREATE UNIQUE INDEX "AutomationProcessContact_processId_contactId_key" ON "AutomationProcessContact"("processId", "contactId");
CREATE INDEX "AutomationProcessContact_batchId_status_idx" ON "AutomationProcessContact"("batchId", "status");
CREATE INDEX "AutomationProcessContact_processId_status_createdAt_idx" ON "AutomationProcessContact"("processId", "status", "createdAt");
CREATE INDEX "AutomationProcessContact_tenantId_contactId_idx" ON "AutomationProcessContact"("tenantId", "contactId");
CREATE INDEX "AutomationExecution_tenantId_processId_createdAt_idx" ON "AutomationExecution"("tenantId", "processId", "createdAt");

ALTER TABLE "AutomationProcess" ADD CONSTRAINT "AutomationProcess_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationProcess" ADD CONSTRAINT "AutomationProcess_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutomationProcess" ADD CONSTRAINT "AutomationProcess_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutomationProcessBatch" ADD CONSTRAINT "AutomationProcessBatch_processId_fkey" FOREIGN KEY ("processId") REFERENCES "AutomationProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationProcessContact" ADD CONSTRAINT "AutomationProcessContact_processId_fkey" FOREIGN KEY ("processId") REFERENCES "AutomationProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationProcessContact" ADD CONSTRAINT "AutomationProcessContact_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AutomationProcessBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_processId_fkey" FOREIGN KEY ("processId") REFERENCES "AutomationProcess"("id") ON DELETE SET NULL ON UPDATE CASCADE;
