CREATE TABLE "ContactTag" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactTag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContactTag_tenantId_id_key" ON "ContactTag"("tenantId", "id");
CREATE UNIQUE INDEX "ContactTag_tenantId_contactId_tagId_key" ON "ContactTag"("tenantId", "contactId", "tagId");
CREATE INDEX "ContactTag_tenantId_contactId_idx" ON "ContactTag"("tenantId", "contactId");
CREATE INDEX "ContactTag_tenantId_tagId_idx" ON "ContactTag"("tenantId", "tagId");

ALTER TABLE "ContactTag"
ADD CONSTRAINT "ContactTag_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactTag"
ADD CONSTRAINT "ContactTag_contactId_fkey"
FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactTag"
ADD CONSTRAINT "ContactTag_tagId_fkey"
FOREIGN KEY ("tagId") REFERENCES "TenantTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
