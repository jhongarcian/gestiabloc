CREATE TABLE "ContactServiceNote" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "contactServiceId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContactServiceNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContactServiceNote_tenantId_id_key"
ON "ContactServiceNote"("tenantId", "id");

CREATE INDEX "ContactServiceNote_tenantId_contactServiceId_createdAt_idx"
ON "ContactServiceNote"("tenantId", "contactServiceId", "createdAt");

CREATE INDEX "ContactServiceNote_tenantId_createdById_idx"
ON "ContactServiceNote"("tenantId", "createdById");

ALTER TABLE "ContactServiceNote"
ADD CONSTRAINT "ContactServiceNote_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactServiceNote"
ADD CONSTRAINT "ContactServiceNote_contactServiceId_fkey"
FOREIGN KEY ("contactServiceId") REFERENCES "ContactService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactServiceNote"
ADD CONSTRAINT "ContactServiceNote_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
