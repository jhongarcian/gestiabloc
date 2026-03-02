CREATE TABLE "TaskStatusConfig" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "bgColor" TEXT NOT NULL,
  "textColor" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isSystemDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TaskStatusConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaskStatusConfig_tenantId_id_key"
ON "TaskStatusConfig"("tenantId", "id");

CREATE UNIQUE INDEX "TaskStatusConfig_tenantId_name_key"
ON "TaskStatusConfig"("tenantId", "name");

CREATE INDEX "TaskStatusConfig_tenantId_sortOrder_idx"
ON "TaskStatusConfig"("tenantId", "sortOrder");

ALTER TABLE "TaskStatusConfig"
ADD CONSTRAINT "TaskStatusConfig_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
