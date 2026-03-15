-- CreateEnum
CREATE TYPE "ContactCustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'PHONE', 'CURRENCY', 'DATE', 'SELECT', 'MULTI_SELECT', 'RADIO', 'TEXTAREA', 'CHECKBOX');

-- CreateTable
CREATE TABLE "ContactCustomField" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "fieldType" "ContactCustomFieldType" NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "isEncrypted" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "options" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactCustomField_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContactCustomField_tenantId_id_key" ON "ContactCustomField"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ContactCustomField_tenantId_key_key" ON "ContactCustomField"("tenantId", "key");

-- CreateIndex
CREATE INDEX "ContactCustomField_tenantId_sortOrder_idx" ON "ContactCustomField"("tenantId", "sortOrder");

-- AddForeignKey
ALTER TABLE "ContactCustomField" ADD CONSTRAINT "ContactCustomField_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
