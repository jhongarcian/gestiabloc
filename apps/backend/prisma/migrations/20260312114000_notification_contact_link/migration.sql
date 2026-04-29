ALTER TABLE "Notification"
ADD COLUMN "contactId" TEXT;

CREATE INDEX "Notification_tenantId_userId_contactId_createdAt_idx"
  ON "Notification"("tenantId", "userId", "contactId", "createdAt");
