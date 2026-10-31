CREATE UNIQUE INDEX "BillingCommand_tenantId_id_key" ON "BillingCommand"("tenantId","id");
CREATE TABLE "AiCreditPurchase" (
 "id" TEXT PRIMARY KEY,
 "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "packKey" TEXT NOT NULL, "credits" INTEGER NOT NULL, "amountCents" INTEGER NOT NULL, "currency" TEXT NOT NULL DEFAULT 'usd',
 "stripePriceId" TEXT NOT NULL, "sessionId" TEXT, "paymentIntentId" TEXT,
 "status" TEXT NOT NULL DEFAULT 'PENDING', "reviewReason" TEXT, "checkedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY ("tenantId","id") REFERENCES "BillingCommand"("tenantId","id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "AiCreditPurchase_amount_check" CHECK ("credits" > 0 AND "amountCents" > 0 AND "currency" = 'usd'),
 CONSTRAINT "AiCreditPurchase_status_check" CHECK ("status" IN ('PENDING','PAID','EXPIRED','REVIEW'))
);
CREATE UNIQUE INDEX "AiCreditPurchase_sessionId_key" ON "AiCreditPurchase"("sessionId");
CREATE UNIQUE INDEX "AiCreditPurchase_tenantId_id_key" ON "AiCreditPurchase"("tenantId","id");
CREATE UNIQUE INDEX "AiCreditPurchase_paymentIntentId_key" ON "AiCreditPurchase"("paymentIntentId");
CREATE INDEX "AiCreditPurchase_tenantId_status_idx" ON "AiCreditPurchase"("tenantId","status");
CREATE INDEX "AiCreditPurchase_status_checkedAt_idx" ON "AiCreditPurchase"("status","checkedAt");
