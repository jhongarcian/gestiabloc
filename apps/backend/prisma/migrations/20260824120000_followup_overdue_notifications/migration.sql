ALTER TYPE "NotificationType" ADD VALUE 'FOLLOW_UP_OVERDUE';

ALTER TABLE "ContactServiceFollowUpStep"
ADD COLUMN "overdueNotifiedAt" TIMESTAMP(3),
ADD COLUMN "overdueNotifiedDueAt" TIMESTAMP(3);

CREATE INDEX "ContactServiceFollowUpStep_tenantId_status_dueAt_overdueNotifiedDueAt_idx"
ON "ContactServiceFollowUpStep"("tenantId", "status", "dueAt", "overdueNotifiedDueAt");
