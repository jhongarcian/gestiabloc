CREATE TABLE "TenantTag" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bgColor" TEXT NOT NULL,
    "textColor" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantTag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantTag_tenantId_id_key" ON "TenantTag"("tenantId", "id");
CREATE UNIQUE INDEX "TenantTag_tenantId_name_key" ON "TenantTag"("tenantId", "name");
CREATE INDEX "TenantTag_tenantId_sortOrder_idx" ON "TenantTag"("tenantId", "sortOrder");

ALTER TABLE "TenantTag"
ADD CONSTRAINT "TenantTag_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
