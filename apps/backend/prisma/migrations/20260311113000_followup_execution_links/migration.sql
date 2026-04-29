ALTER TABLE "ServiceFollowUpTemplateStep"
ADD COLUMN "templateNodeId" TEXT;

CREATE INDEX "ServiceFollowUpTemplateStep_tenantId_templateId_templateNodeId_idx"
  ON "ServiceFollowUpTemplateStep"("tenantId", "templateId", "templateNodeId");

ALTER TABLE "ContactService"
ADD COLUMN "followUpTemplateId" TEXT;

CREATE INDEX "ContactService_tenantId_followUpTemplateId_idx"
  ON "ContactService"("tenantId", "followUpTemplateId");

ALTER TABLE "ContactService"
ADD CONSTRAINT "ContactService_followUpTemplateId_fkey"
  FOREIGN KEY ("followUpTemplateId") REFERENCES "ServiceFollowUpTemplate"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContactServiceFollowUpStep"
ADD COLUMN "templateNodeId" TEXT;

CREATE INDEX "ContactServiceFollowUpStep_tenantId_contactServiceId_templateN_idx"
  ON "ContactServiceFollowUpStep"("tenantId", "contactServiceId", "templateNodeId");
