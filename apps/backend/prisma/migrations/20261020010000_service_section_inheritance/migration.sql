CREATE TYPE "ServiceSectionMode" AS ENUM ('INHERIT', 'CUSTOM');
-- Preserve every existing offering's independent configuration.
ALTER TABLE "Service"
  ADD COLUMN "billingMode" "ServiceSectionMode" NOT NULL DEFAULT 'CUSTOM',
  ADD COLUMN "checklistMode" "ServiceSectionMode" NOT NULL DEFAULT 'CUSTOM',
  ADD COLUMN "professionalsMode" "ServiceSectionMode" NOT NULL DEFAULT 'CUSTOM';
ALTER TABLE "Service" ADD CONSTRAINT "Service_group_sections_custom_check" CHECK (
  "kind" <> 'GROUP' OR (
    "billingMode" = 'CUSTOM' AND "checklistMode" = 'CUSTOM' AND "professionalsMode" = 'CUSTOM'
  )
);
ALTER TABLE "ContactService" ADD COLUMN "billingSnapshot" JSONB;
-- Freeze available billing terms for purchases made before inheritance was introduced.
-- Existing totals/currency/payment policy remain authoritative.
UPDATE "ContactService" cs SET "billingSnapshot" = jsonb_build_object(
  'schemaVersion', 1, 'sourceServiceId', s."id",
  'basePriceCents', s."basePriceCents", 'currency', cs."currency",
  'isTaxExempt', s."isTaxExempt", 'allowPartialPayments', cs."allowPartialPayments",
  'minimumPartialPaymentCents', s."minimumPartialPaymentCents",
  'installmentCount', s."installmentCount", 'installmentFrequency', s."installmentFrequency",
  'taxEnabled', t."taxEnabled", 'taxLabel', t."taxLabel", 'defaultTaxRateBps', t."defaultTaxRateBps",
  'totalPriceCents', cs."totalPriceCents"
) FROM "Service" s, "Tenant" t
WHERE cs."serviceId" = s."id" AND cs."tenantId" = s."tenantId" AND t."id" = cs."tenantId";
