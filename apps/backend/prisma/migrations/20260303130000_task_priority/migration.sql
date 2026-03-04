-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "priority" "TaskPriority";

-- CreateIndex
CREATE INDEX "Task_tenantId_priority_idx" ON "Task"("tenantId", "priority");
