-- CreateTable
CREATE TABLE "ContactCustomFieldValue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "value" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactCustomFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContactCustomFieldValue_tenantId_id_key" ON "ContactCustomFieldValue"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ContactCustomFieldValue_tenantId_contactId_fieldId_key" ON "ContactCustomFieldValue"("tenantId", "contactId", "fieldId");

-- CreateIndex
CREATE INDEX "ContactCustomFieldValue_tenantId_contactId_idx" ON "ContactCustomFieldValue"("tenantId", "contactId");

-- CreateIndex
CREATE INDEX "ContactCustomFieldValue_tenantId_fieldId_idx" ON "ContactCustomFieldValue"("tenantId", "fieldId");

-- AddForeignKey
ALTER TABLE "ContactCustomFieldValue" ADD CONSTRAINT "ContactCustomFieldValue_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactCustomFieldValue" ADD CONSTRAINT "ContactCustomFieldValue_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactCustomFieldValue" ADD CONSTRAINT "ContactCustomFieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "ContactCustomField"("id") ON DELETE CASCADE ON UPDATE CASCADE;
