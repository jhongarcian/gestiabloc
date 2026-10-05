ALTER TABLE "Notification" ADD COLUMN "dismissedAt" TIMESTAMP(3);

CREATE INDEX "Notification_tenantId_userId_dismissedAt_createdAt_idx"
ON "Notification"("tenantId", "userId", "dismissedAt", "createdAt");
