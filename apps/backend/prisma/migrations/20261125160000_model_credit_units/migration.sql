-- Existing one-credit requests remain valid. New model policies can reserve
-- multiple units and split them across monthly and purchased credit buckets.
BEGIN;
ALTER TABLE "AiCreditRequest" DROP CONSTRAINT "AiCreditRequest_state_check";
ALTER TABLE "AiCreditRequest" ADD CONSTRAINT "AiCreditRequest_state_check" CHECK (
  "channel" IN ('TEST', 'CONTACT_ASSISTANT') AND "status" IN ('RESERVED', 'COMMITTED', 'RELEASED') AND
  "monthlyUnits" BETWEEN 0 AND 1000 AND "purchasedUnits" BETWEEN 0 AND 1000 AND
  "monthlyUnits" + "purchasedUnits" BETWEEN 1 AND 1000 AND
  (("monthlyUnits" > 0 AND "periodId" IS NOT NULL) OR ("monthlyUnits" = 0 AND "periodId" IS NULL)) AND
  (("status" = 'RESERVED' AND "finishedAt" IS NULL) OR ("status" <> 'RESERVED' AND "finishedAt" IS NOT NULL))
);
ALTER TABLE "AiCreditLedger" DROP CONSTRAINT "AiCreditLedger_kind_check";
ALTER TABLE "AiCreditLedger" ADD CONSTRAINT "AiCreditLedger_kind_check" CHECK (
  "monthlyUnits" >= 0 AND "purchasedUnits" >= 0 AND
  (("kind" = 'MONTHLY_GRANT' AND "purchasedUnits" = 0 AND "periodId" IS NOT NULL) OR
   ("kind" = 'PURCHASE_GRANT' AND "monthlyUnits" = 0 AND "periodId" IS NULL) OR
   ("kind" IN ('RESERVE','COMMIT','RELEASE') AND "monthlyUnits" <= 1000 AND "purchasedUnits" <= 1000 AND
     "monthlyUnits" + "purchasedUnits" BETWEEN 1 AND 1000 AND
     (("monthlyUnits" > 0 AND "periodId" IS NOT NULL) OR ("monthlyUnits" = 0 AND "periodId" IS NULL)))) AND
  (("kind" IN ('MONTHLY_GRANT','PURCHASE_GRANT') AND "requestId" IS NULL AND "sourceKey" IS NOT NULL AND "sourceHash" IS NOT NULL) OR
   ("kind" IN ('RESERVE','COMMIT','RELEASE') AND "requestId" IS NOT NULL AND "sourceKey" IS NULL AND "sourceHash" IS NULL))
);
COMMIT;
