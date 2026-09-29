ALTER TYPE "AutomationNodeExecutionStatus" ADD VALUE IF NOT EXISTS 'QUEUED';

CREATE TYPE "AutomationEventStatus" AS ENUM (
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'COMPLETED_WITH_ERRORS',
  'FAILED',
  'CANCELED'
);

CREATE TYPE "AutomationDispatchDecision" AS ENUM ('RUN', 'SKIP_TRIGGER', 'SKIP_FILTERS');
CREATE TYPE "AutomationDispatchStatus" AS ENUM (
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'SKIPPED',
  'CANCELED'
);
CREATE TYPE "AutomationSideEffectType" AS ENUM ('NOTIFICATION_DELIVERY', 'FILE_DELETE');
CREATE TYPE "AutomationSideEffectStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "AutomationEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "contactId" TEXT,
  "contactName" TEXT NOT NULL,
  "opportunityId" TEXT,
  "opportunitySnapshotId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "actorName" TEXT,
  "triggerType" "AutomationTriggerType" NOT NULL,
  "pipelineId" TEXT NOT NULL,
  "pipelineName" TEXT NOT NULL,
  "sourceStageId" TEXT,
  "sourceStageName" TEXT,
  "targetStageId" TEXT NOT NULL,
  "targetStageName" TEXT NOT NULL,
  "valueCents" INTEGER NOT NULL,
  "status" "AutomationEventStatus" NOT NULL DEFAULT 'QUEUED',
  "dispatchCount" INTEGER NOT NULL DEFAULT 0,
  "completedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "cursor" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "processingStartedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationDispatch" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "automationId" TEXT,
  "automationSnapshotId" TEXT NOT NULL,
  "automationName" TEXT NOT NULL,
  "automationOrder" INTEGER NOT NULL,
  "triggerType" "AutomationTriggerType" NOT NULL,
  "sourceStageId" TEXT,
  "targetStageId" TEXT,
  "decision" "AutomationDispatchDecision" NOT NULL,
  "decisionDetails" TEXT,
  "actionSnapshot" JSONB NOT NULL,
  "status" "AutomationDispatchStatus" NOT NULL DEFAULT 'QUEUED',
  "attemptId" TEXT NOT NULL,
  "triggerExecutionId" TEXT NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationDispatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationSideEffect" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "type" "AutomationSideEffectType" NOT NULL,
  "status" "AutomationSideEffectStatus" NOT NULL DEFAULT 'PENDING',
  "idempotencyKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationSideEffect_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AutomationRun" ADD COLUMN "dispatchId" TEXT;

CREATE UNIQUE INDEX "AutomationRun_dispatchId_key" ON "AutomationRun"("dispatchId");
CREATE UNIQUE INDEX "AutomationEvent_tenantId_id_key" ON "AutomationEvent"("tenantId", "id");
CREATE INDEX "AutomationEvent_tenantId_contactId_createdAt_idx" ON "AutomationEvent"("tenantId", "contactId", "createdAt");
CREATE INDEX "AutomationEvent_tenantId_status_availableAt_createdAt_idx" ON "AutomationEvent"("tenantId", "status", "availableAt", "createdAt");
CREATE INDEX "AutomationEvent_status_leaseExpiresAt_idx" ON "AutomationEvent"("status", "leaseExpiresAt");
CREATE INDEX "AutomationEvent_available_queue_idx"
  ON "AutomationEvent"("availableAt", "createdAt")
  WHERE "status" = 'QUEUED';
CREATE INDEX "AutomationEvent_expired_lease_idx"
  ON "AutomationEvent"("leaseExpiresAt", "createdAt")
  WHERE "status" = 'PROCESSING' AND "leaseExpiresAt" IS NOT NULL;

CREATE UNIQUE INDEX "AutomationDispatch_attemptId_key" ON "AutomationDispatch"("attemptId");
CREATE UNIQUE INDEX "AutomationDispatch_triggerExecutionId_key" ON "AutomationDispatch"("triggerExecutionId");
CREATE UNIQUE INDEX "AutomationDispatch_eventId_automationSnapshotId_key" ON "AutomationDispatch"("eventId", "automationSnapshotId");
CREATE INDEX "AutomationDispatch_tenantId_eventId_automationOrder_idx" ON "AutomationDispatch"("tenantId", "eventId", "automationOrder");
CREATE INDEX "AutomationDispatch_tenantId_status_createdAt_idx" ON "AutomationDispatch"("tenantId", "status", "createdAt");

CREATE UNIQUE INDEX "AutomationSideEffect_idempotencyKey_key" ON "AutomationSideEffect"("idempotencyKey");
CREATE INDEX "AutomationSideEffect_status_availableAt_createdAt_idx" ON "AutomationSideEffect"("status", "availableAt", "createdAt");
CREATE INDEX "AutomationSideEffect_status_leaseExpiresAt_idx" ON "AutomationSideEffect"("status", "leaseExpiresAt");
CREATE INDEX "AutomationSideEffect_pending_idx"
  ON "AutomationSideEffect"("availableAt", "createdAt")
  WHERE "status" = 'PENDING';

ALTER TABLE "AutomationEvent" ADD CONSTRAINT "AutomationEvent_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationEvent" ADD CONSTRAINT "AutomationEvent_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutomationEvent" ADD CONSTRAINT "AutomationEvent_opportunityId_fkey"
  FOREIGN KEY ("opportunityId") REFERENCES "ContactOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutomationEvent" ADD CONSTRAINT "AutomationEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AutomationDispatch" ADD CONSTRAINT "AutomationDispatch_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationDispatch" ADD CONSTRAINT "AutomationDispatch_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "AutomationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationDispatch" ADD CONSTRAINT "AutomationDispatch_automationId_fkey"
  FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_dispatchId_fkey"
  FOREIGN KEY ("dispatchId") REFERENCES "AutomationDispatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AutomationSideEffect" ADD CONSTRAINT "AutomationSideEffect_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
