ALTER TABLE "ServiceChecklistItem" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "ServiceProfessional" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "ServiceChecklistItem_tenantId_serviceId_archivedAt_sortOrder_idx"
ON "ServiceChecklistItem"("tenantId", "serviceId", "archivedAt", "sortOrder");
CREATE INDEX "ServiceProfessional_tenantId_serviceId_archivedAt_sortOrder_idx"
ON "ServiceProfessional"("tenantId", "serviceId", "archivedAt", "sortOrder");
