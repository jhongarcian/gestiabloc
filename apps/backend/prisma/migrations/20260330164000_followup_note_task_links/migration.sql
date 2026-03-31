ALTER TABLE "ContactNote"
ADD COLUMN "contactServiceId" TEXT,
ADD COLUMN "followUpTemplateId" TEXT,
ADD COLUMN "contactServiceFollowUpStepId" TEXT;

ALTER TABLE "Task"
ADD COLUMN "contactServiceId" TEXT,
ADD COLUMN "followUpTemplateId" TEXT,
ADD COLUMN "contactServiceFollowUpStepId" TEXT;

CREATE INDEX "ContactNote_tenantId_contactServiceId_createdAt_idx"
ON "ContactNote"("tenantId", "contactServiceId", "createdAt");

CREATE INDEX "ContactNote_tenantId_followUpTemplateId_createdAt_idx"
ON "ContactNote"("tenantId", "followUpTemplateId", "createdAt");

CREATE INDEX "ContactNote_tenantId_contactServiceFollowUpStepId_createdAt_idx"
ON "ContactNote"("tenantId", "contactServiceFollowUpStepId", "createdAt");

CREATE INDEX "Task_tenantId_contactServiceId_idx"
ON "Task"("tenantId", "contactServiceId");

CREATE INDEX "Task_tenantId_followUpTemplateId_idx"
ON "Task"("tenantId", "followUpTemplateId");

CREATE INDEX "Task_tenantId_contactServiceFollowUpStepId_idx"
ON "Task"("tenantId", "contactServiceFollowUpStepId");

ALTER TABLE "ContactNote"
ADD CONSTRAINT "ContactNote_contactServiceId_fkey"
FOREIGN KEY ("contactServiceId") REFERENCES "ContactService"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContactNote"
ADD CONSTRAINT "ContactNote_followUpTemplateId_fkey"
FOREIGN KEY ("followUpTemplateId") REFERENCES "ServiceFollowUpTemplate"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContactNote"
ADD CONSTRAINT "ContactNote_contactServiceFollowUpStepId_fkey"
FOREIGN KEY ("contactServiceFollowUpStepId") REFERENCES "ContactServiceFollowUpStep"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Task"
ADD CONSTRAINT "Task_contactServiceId_fkey"
FOREIGN KEY ("contactServiceId") REFERENCES "ContactService"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Task"
ADD CONSTRAINT "Task_followUpTemplateId_fkey"
FOREIGN KEY ("followUpTemplateId") REFERENCES "ServiceFollowUpTemplate"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Task"
ADD CONSTRAINT "Task_contactServiceFollowUpStepId_fkey"
FOREIGN KEY ("contactServiceFollowUpStepId") REFERENCES "ContactServiceFollowUpStep"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
