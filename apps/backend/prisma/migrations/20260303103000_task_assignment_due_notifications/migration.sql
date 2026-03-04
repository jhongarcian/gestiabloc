-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TASK_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TASK_DUE';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "eventKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Notification_eventKey_key" ON "Notification"("eventKey");
