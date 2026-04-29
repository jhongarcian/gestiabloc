ALTER TABLE "ContactService"
ADD COLUMN "assignedProfessionalId" TEXT;

ALTER TABLE "ContactService"
ADD CONSTRAINT "ContactService_assignedProfessionalId_fkey"
FOREIGN KEY ("assignedProfessionalId")
REFERENCES "ServiceProfessional"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

CREATE INDEX "ContactService_tenantId_assignedProfessionalId_idx"
ON "ContactService"("tenantId", "assignedProfessionalId");
