-- AlterEnum
ALTER TYPE "AutomationActionType" ADD VALUE 'CREATE_TASK';

-- AlterTable
ALTER TABLE "AutomationAction" ADD COLUMN "taskConfig" JSONB;

-- AlterTable
ALTER TABLE "Task"
ADD COLUMN "automationId" TEXT,
ADD COLUMN "automationName" TEXT;

-- AlterTable
ALTER TABLE "TaskReminder" ALTER COLUMN "createdById" DROP NOT NULL;

-- DropForeignKey
ALTER TABLE "TaskReminder" DROP CONSTRAINT "TaskReminder_createdById_fkey";

-- AddForeignKey
ALTER TABLE "TaskReminder"
ADD CONSTRAINT "TaskReminder_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task"
ADD CONSTRAINT "Task_automationId_fkey"
FOREIGN KEY ("automationId") REFERENCES "Automation"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Task_tenantId_automationId_createdAt_idx"
ON "Task"("tenantId", "automationId", "createdAt");
