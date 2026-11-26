CREATE TABLE "AiCreditWallet" (
  "tenantId" TEXT PRIMARY KEY REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "purchasedBalance" INTEGER NOT NULL DEFAULT 0,
  "purchasedReserved" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "AiCreditWallet_balances_check" CHECK (
    "revision" >= 0 AND "purchasedReserved" >= 0 AND "purchasedBalance" >= "purchasedReserved"
  )
);
CREATE TABLE "AiCreditPeriod" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL REFERENCES "AiCreditWallet"("tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
  "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3) NOT NULL,
  "granted" INTEGER NOT NULL DEFAULT 0, "used" INTEGER NOT NULL DEFAULT 0, "reserved" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "AiCreditPeriod_balances_check" CHECK (
    "endsAt" > "startsAt" AND "used" >= 0 AND "reserved" >= 0 AND "granted" >= "used" + "reserved"
  )
);
CREATE UNIQUE INDEX "AiCreditPeriod_tenantId_id_key" ON "AiCreditPeriod"("tenantId", "id");
CREATE UNIQUE INDEX "AiCreditPeriod_tenantId_startsAt_key" ON "AiCreditPeriod"("tenantId", "startsAt");
CREATE INDEX "AiCreditPeriod_tenantId_endsAt_idx" ON "AiCreditPeriod"("tenantId", "endsAt");
CREATE TABLE "AiCreditRequest" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL REFERENCES "AiCreditWallet"("tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
  "actorId" TEXT NOT NULL, "channel" TEXT NOT NULL, "requestId" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
  "status" TEXT NOT NULL, "periodId" TEXT, "monthlyUnits" INTEGER NOT NULL, "purchasedUnits" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" TIMESTAMP(3),
  FOREIGN KEY ("tenantId", "periodId") REFERENCES "AiCreditPeriod"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "AiCreditRequest_state_check" CHECK (
    "channel" IN ('TEST', 'CONTACT_ASSISTANT') AND "status" IN ('RESERVED', 'COMMITTED', 'RELEASED') AND
    "monthlyUnits" IN (0,1) AND "purchasedUnits" IN (0,1) AND "monthlyUnits" + "purchasedUnits" = 1 AND
    (("monthlyUnits" = 1 AND "periodId" IS NOT NULL) OR ("monthlyUnits" = 0 AND "periodId" IS NULL)) AND
    (("status" = 'RESERVED' AND "finishedAt" IS NULL) OR ("status" <> 'RESERVED' AND "finishedAt" IS NOT NULL))
  )
);
CREATE UNIQUE INDEX "AiCreditRequest_tenantId_id_key" ON "AiCreditRequest"("tenantId", "id");
CREATE UNIQUE INDEX "AiCreditRequest_tenantId_actorId_channel_requestId_key" ON "AiCreditRequest"("tenantId", "actorId", "channel", "requestId");
CREATE INDEX "AiCreditRequest_tenantId_status_expiresAt_idx" ON "AiCreditRequest"("tenantId", "status", "expiresAt");
CREATE TABLE "AiCreditLedger" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL REFERENCES "AiCreditWallet"("tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" TEXT NOT NULL, "monthlyUnits" INTEGER NOT NULL, "purchasedUnits" INTEGER NOT NULL,
  "requestId" TEXT, "periodId" TEXT, "sourceKey" TEXT, "sourceHash" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("tenantId", "requestId") REFERENCES "AiCreditRequest"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE,
  FOREIGN KEY ("tenantId", "periodId") REFERENCES "AiCreditPeriod"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "AiCreditLedger_kind_check" CHECK (
    "monthlyUnits" >= 0 AND "purchasedUnits" >= 0 AND
    (("kind" = 'MONTHLY_GRANT' AND "purchasedUnits" = 0 AND "periodId" IS NOT NULL) OR
     ("kind" = 'PURCHASE_GRANT' AND "monthlyUnits" = 0 AND "periodId" IS NULL) OR
     ("kind" IN ('RESERVE','COMMIT','RELEASE') AND "monthlyUnits" + "purchasedUnits" = 1 AND
       (("monthlyUnits" = 1 AND "periodId" IS NOT NULL) OR ("monthlyUnits" = 0 AND "periodId" IS NULL)))) AND
    (("kind" IN ('MONTHLY_GRANT','PURCHASE_GRANT') AND "requestId" IS NULL AND "sourceKey" IS NOT NULL AND "sourceHash" IS NOT NULL) OR
     ("kind" IN ('RESERVE','COMMIT','RELEASE') AND "requestId" IS NOT NULL AND "sourceKey" IS NULL AND "sourceHash" IS NULL))
  )
);
CREATE UNIQUE INDEX "AiCreditLedger_sourceKey_key" ON "AiCreditLedger"("sourceKey");
CREATE UNIQUE INDEX "AiCreditLedger_requestId_kind_key" ON "AiCreditLedger"("requestId", "kind");
CREATE INDEX "AiCreditLedger_tenantId_createdAt_idx" ON "AiCreditLedger"("tenantId", "createdAt");
