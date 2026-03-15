-- CreateEnum
CREATE TYPE "TaskLinkedEntityType" AS ENUM ('SERVICE', 'PRODUCT');

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT,
    "statusConfigId" TEXT,
    "assignedToUserId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "linkedEntityName" TEXT,
    "linkedEntityType" "TaskLinkedEntityType",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Task_tenantId_id_key" ON "Task"("tenantId", "id");

-- CreateIndex
CREATE INDEX "Task_tenantId_dueDate_idx" ON "Task"("tenantId", "dueDate");

-- CreateIndex
CREATE INDEX "Task_tenantId_statusConfigId_idx" ON "Task"("tenantId", "statusConfigId");

-- CreateIndex
CREATE INDEX "Task_tenantId_assignedToUserId_idx" ON "Task"("tenantId", "assignedToUserId");

-- CreateIndex
CREATE INDEX "Task_tenantId_contactId_idx" ON "Task"("tenantId", "contactId");

-- CreateIndex
CREATE INDEX "Task_tenantId_createdAt_idx" ON "Task"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_tenantId_statusConfigId_fkey" FOREIGN KEY ("tenantId", "statusConfigId") REFERENCES "TaskStatusConfig"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_tenantId_assignedToUserId_fkey" FOREIGN KEY ("tenantId", "assignedToUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
