-- CreateTable
CREATE TABLE "ServiceAiFaq" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "exactAnswer" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceAiFaq_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceAiFaq_tenantId_serviceId_sortOrder_id_idx" ON "ServiceAiFaq"("tenantId", "serviceId", "sortOrder", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceAiFaq_tenantId_id_key" ON "ServiceAiFaq"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "ServiceAiFaq" ADD CONSTRAINT "ServiceAiFaq_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAiFaq" ADD CONSTRAINT "ServiceAiFaq_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
