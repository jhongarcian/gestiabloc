-- Additive migration: original totals, receipts and billing snapshots remain unchanged.
CREATE TYPE "ServicePaymentType" AS ENUM ('SINGLE_PAYMENT', 'INSTALLMENTS', 'FLEXIBLE');
ALTER TABLE "Service" ADD COLUMN "paymentSettings" JSONB;
ALTER TABLE "ContactService" ADD COLUMN "paidCents" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "paymentType" "ServicePaymentType", ADD COLUMN "paymentPlan" JSONB,
 ADD COLUMN "financialRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ContactServicePayment" ADD COLUMN "voidedAt" TIMESTAMP(3),
 ADD COLUMN "voidedById" TEXT, ADD COLUMN "voidReason" TEXT, ADD COLUMN "replacesPaymentId" TEXT;
CREATE INDEX "ContactServicePayment_tenantId_contactServiceId_voidedAt_idx" ON "ContactServicePayment" ("tenantId", "contactServiceId", "voidedAt");
CREATE TABLE "ContactServicePaymentDue" (
 "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "contactServiceId" TEXT NOT NULL,
 "label" TEXT NOT NULL, "amountCents" INTEGER NOT NULL, "paidCents" INTEGER NOT NULL DEFAULT 0,
 "remainingCents" INTEGER NOT NULL, "dueDate" DATE, "sortOrder" INTEGER NOT NULL,
 CONSTRAINT "ContactServicePaymentDue_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "ContactServicePaymentDue_amount_check" CHECK ("amountCents" > 0 AND "paidCents" >= 0 AND "remainingCents" >= 0 AND "paidCents" + "remainingCents" = "amountCents"),
 CONSTRAINT "ContactServicePaymentDue_tenantId_contactServiceId_fkey" FOREIGN KEY ("tenantId", "contactServiceId") REFERENCES "ContactService" ("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ContactServicePaymentDue_tenantId_id_key" ON "ContactServicePaymentDue" ("tenantId", "id");
CREATE INDEX "ContactServicePaymentDue_tenantId_contactServiceId_sortOrder_idx" ON "ContactServicePaymentDue" ("tenantId", "contactServiceId", "sortOrder");
CREATE INDEX "ContactServicePaymentDue_tenantId_dueDate_remainingCents_idx" ON "ContactServicePaymentDue" ("tenantId", "dueDate", "remainingCents");
CREATE TABLE "ContactServiceFinancialChange" (
 "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "contactServiceId" TEXT NOT NULL,
 "requestKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL, "kind" TEXT NOT NULL, "revision" INTEGER NOT NULL,
 "actorUserId" TEXT NOT NULL, "reason" TEXT, "previous" JSONB, "next" JSONB, "result" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ContactServiceFinancialChange_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "ContactServiceFinancialChange_tenantId_contactServiceId_fkey" FOREIGN KEY ("tenantId", "contactServiceId") REFERENCES "ContactService" ("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ContactServiceFinancialChange_tenantId_requestKey_key" ON "ContactServiceFinancialChange" ("tenantId", "requestKey");
CREATE UNIQUE INDEX "CSFinancialChange_account_revision_key" ON "ContactServiceFinancialChange" ("tenantId", "contactServiceId", "revision");
CREATE INDEX "CSFinancialChange_account_created_idx" ON "ContactServiceFinancialChange" ("tenantId", "contactServiceId", "createdAt");
UPDATE "Service" SET "paymentSettings" = jsonb_build_object(
 'schemaVersion', 1,
 'enabledTypes', CASE WHEN NOT "allowPartialPayments" THEN '["SINGLE_PAYMENT"]'::jsonb
 WHEN "installmentCount" IS NOT NULL AND "installmentFrequency" IS NOT NULL THEN '["SINGLE_PAYMENT","INSTALLMENTS"]'::jsonb ELSE '["SINGLE_PAYMENT","FLEXIBLE"]'::jsonb END,
 'defaultType', CASE WHEN NOT "allowPartialPayments" THEN 'SINGLE_PAYMENT' WHEN "installmentCount" IS NOT NULL AND "installmentFrequency" IS NOT NULL THEN 'INSTALLMENTS' ELSE 'FLEXIBLE' END,
 'suggestedDepositCents', COALESCE("minimumPartialPaymentCents", 0),
 'installmentCount', LEAST(120, GREATEST(1, COALESCE("installmentCount", 4))),
 'installmentFrequency', COALESCE("installmentFrequency"::text, 'MONTHLY')
);
UPDATE "ContactService" cs SET "paidCents" = COALESCE((SELECT SUM(p."amountCents") FROM "ContactServicePayment" p WHERE p."tenantId" = cs."tenantId" AND p."contactServiceId" = cs.id AND p."voidedAt" IS NULL), 0);
-- Old paymentType values remain NULL: an admin confirms schedules before dates are shown.
