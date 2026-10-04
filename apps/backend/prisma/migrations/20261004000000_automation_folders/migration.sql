CREATE TABLE "AutomationFolder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AutomationFolder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutomationFolder_tenantId_id_key" ON "AutomationFolder"("tenantId", "id");
CREATE UNIQUE INDEX "AutomationFolder_tenantId_normalizedName_key" ON "AutomationFolder"("tenantId", "normalizedName");
CREATE INDEX "AutomationFolder_tenantId_sortOrder_idx" ON "AutomationFolder"("tenantId", "sortOrder");
ALTER TABLE "AutomationFolder" ADD CONSTRAINT "AutomationFolder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Automation" ADD COLUMN "folderId" TEXT;
ALTER TABLE "Automation" ADD COLUMN "librarySortOrder" INTEGER NOT NULL DEFAULT 0;
UPDATE "Automation" SET "librarySortOrder" = "sortOrder";
CREATE INDEX "Automation_tenantId_folderId_librarySortOrder_idx" ON "Automation"("tenantId", "folderId", "librarySortOrder");
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_tenantId_folderId_fkey" FOREIGN KEY ("tenantId", "folderId") REFERENCES "AutomationFolder"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
