CREATE TABLE "ServiceFollowUpExecutionLog" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "contactServiceId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "flowNodeId" TEXT,
  "stepId" TEXT,
  "eventType" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "details" TEXT,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ServiceFollowUpExecutionLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceFollowUpExecutionLog_tenantId_id_key"
  ON "ServiceFollowUpExecutionLog"("tenantId", "id");

CREATE INDEX "ServiceFollowUpExecutionLog_tenantId_templateId_createdA_idx"
  ON "ServiceFollowUpExecutionLog"("tenantId", "templateId", "createdAt");

CREATE INDEX "ServiceFollowUpExecutionLog_tenantId_contactServiceId_cre_idx"
  ON "ServiceFollowUpExecutionLog"("tenantId", "contactServiceId", "createdAt");

CREATE INDEX "ServiceFollowUpExecutionLog_tenantId_contactId_createdAt_idx"
  ON "ServiceFollowUpExecutionLog"("tenantId", "contactId", "createdAt");

CREATE INDEX "ServiceFollowUpExecutionLog_tenantId_actorUserId_create_idx"
  ON "ServiceFollowUpExecutionLog"("tenantId", "actorUserId", "createdAt");

ALTER TABLE "ServiceFollowUpExecutionLog"
  ADD CONSTRAINT "ServiceFollowUpExecutionLog_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServiceFollowUpExecutionLog"
  ADD CONSTRAINT "ServiceFollowUpExecutionLog_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "ServiceFollowUpTemplate"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServiceFollowUpExecutionLog"
  ADD CONSTRAINT "ServiceFollowUpExecutionLog_contactServiceId_fkey"
  FOREIGN KEY ("contactServiceId") REFERENCES "ContactService"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServiceFollowUpExecutionLog"
  ADD CONSTRAINT "ServiceFollowUpExecutionLog_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServiceFollowUpExecutionLog"
  ADD CONSTRAINT "ServiceFollowUpExecutionLog_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
