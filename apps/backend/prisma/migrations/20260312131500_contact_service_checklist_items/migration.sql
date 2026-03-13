CREATE TABLE "ContactServiceChecklistItem" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "contactServiceId" TEXT NOT NULL,
  "checklistItemId" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContactServiceChecklistItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContactServiceChecklistItem_tenantId_contactServiceId_checklistI_key"
ON "ContactServiceChecklistItem"("tenantId", "contactServiceId", "checklistItemId");

CREATE UNIQUE INDEX "ContactServiceChecklistItem_tenantId_id_key"
ON "ContactServiceChecklistItem"("tenantId", "id");

CREATE INDEX "ContactServiceChecklistItem_tenantId_contactServiceId_completedA_idx"
ON "ContactServiceChecklistItem"("tenantId", "contactServiceId", "completedAt");

CREATE INDEX "ContactServiceChecklistItem_tenantId_checklistItemId_idx"
ON "ContactServiceChecklistItem"("tenantId", "checklistItemId");

ALTER TABLE "ContactServiceChecklistItem"
ADD CONSTRAINT "ContactServiceChecklistItem_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactServiceChecklistItem"
ADD CONSTRAINT "ContactServiceChecklistItem_contactServiceId_fkey"
FOREIGN KEY ("contactServiceId") REFERENCES "ContactService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactServiceChecklistItem"
ADD CONSTRAINT "ContactServiceChecklistItem_checklistItemId_fkey"
FOREIGN KEY ("checklistItemId") REFERENCES "ServiceChecklistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
