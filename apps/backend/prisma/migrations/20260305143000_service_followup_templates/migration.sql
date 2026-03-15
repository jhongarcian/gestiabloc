CREATE TABLE "ServiceFollowUpTemplate" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "flowNodes" JSONB,
  "flowEdges" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceFollowUpTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceFollowUpTemplate_tenantId_id_key"
  ON "ServiceFollowUpTemplate"("tenantId", "id");
CREATE INDEX "ServiceFollowUpTemplate_tenantId_serviceId_sortOrder_idx"
  ON "ServiceFollowUpTemplate"("tenantId", "serviceId", "sortOrder");

ALTER TABLE "ServiceFollowUpTemplate"
  ADD CONSTRAINT "ServiceFollowUpTemplate_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServiceFollowUpTemplate"
  ADD CONSTRAINT "ServiceFollowUpTemplate_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServiceFollowUpTemplateStep"
  ADD COLUMN "templateId" TEXT;

CREATE INDEX "ServiceFollowUpTemplateStep_tenantId_templateId_sortOrder_idx"
  ON "ServiceFollowUpTemplateStep"("tenantId", "templateId", "sortOrder");

ALTER TABLE "ServiceFollowUpTemplateStep"
  ADD CONSTRAINT "ServiceFollowUpTemplateStep_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "ServiceFollowUpTemplate"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
