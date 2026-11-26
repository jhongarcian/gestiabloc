CREATE UNIQUE INDEX "TenantSubscription_stripeCustomerId_key" ON "TenantSubscription"("stripeCustomerId");
CREATE UNIQUE INDEX "TenantSubscription_stripeSubscriptionId_key" ON "TenantSubscription"("stripeSubscriptionId");
ALTER TABLE "TenantSubscription"
 ADD COLUMN "billingLeaseToken" TEXT,
 ADD COLUMN "billingLeaseExpiresAt" TIMESTAMP(3),
 ADD COLUMN "pendingCheckoutId" TEXT,
 ADD COLUMN "pendingCheckoutExpiresAt" TIMESTAMP(3),
 ADD COLUMN "stripeScheduleId" TEXT,
 ADD COLUMN "billingSyncedAt" TIMESTAMP(3);
CREATE TABLE "BillingCommand" (
 "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "actorId" TEXT NOT NULL, "requestId" TEXT NOT NULL, "kind" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PENDING', "result" JSONB, "context" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3),
 CONSTRAINT "BillingCommand_status_check" CHECK ("status" IN ('PENDING','SUCCEEDED') AND ("status" <> 'SUCCEEDED' OR ("result" IS NOT NULL AND "completedAt" IS NOT NULL)))
);
CREATE UNIQUE INDEX "BillingCommand_tenantId_actorId_requestId_key" ON "BillingCommand"("tenantId", "actorId", "requestId");
CREATE INDEX "BillingCommand_tenantId_createdAt_idx" ON "BillingCommand"("tenantId", "createdAt");
CREATE TABLE "StripeBillingEvent" (
 "id" TEXT PRIMARY KEY, "type" TEXT NOT NULL, "tenantId" TEXT,
 "eventCreatedAt" TIMESTAMP(3) NOT NULL, "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "StripeBillingEvent_tenantId_processedAt_idx" ON "StripeBillingEvent"("tenantId", "processedAt");
CREATE INDEX "TenantSubscription_billingSyncedAt_idx" ON "TenantSubscription"("billingSyncedAt");
