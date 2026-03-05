CREATE TABLE "TenantLinkedEntity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TaskLinkedEntityType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantLinkedEntity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantLinkedEntity_tenantId_id_key" ON "TenantLinkedEntity"("tenantId", "id");
CREATE UNIQUE INDEX "TenantLinkedEntity_tenantId_type_name_key" ON "TenantLinkedEntity"("tenantId", "type", "name");
CREATE INDEX "TenantLinkedEntity_tenantId_type_sortOrder_idx" ON "TenantLinkedEntity"("tenantId", "type", "sortOrder");

ALTER TABLE "TenantLinkedEntity" ADD CONSTRAINT "TenantLinkedEntity_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
