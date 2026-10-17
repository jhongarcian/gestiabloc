ALTER TYPE "AutomationTriggerType" ADD VALUE 'BIRTHDAY_REMINDER';
ALTER TYPE "AutomationNodeEventSource" ADD VALUE 'BIRTHDAY_REMINDER';

ALTER TABLE "Automation" ADD COLUMN "birthdayLocalTime" TEXT;
ALTER TABLE "AutomationEvent" ADD COLUMN "birthdaySnapshot" JSONB;

CREATE TABLE "AutomationBirthdayClaim" (
    "tenantId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "occurrenceYear" INTEGER NOT NULL,
    "localDate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutomationBirthdayClaim_pkey" PRIMARY KEY ("tenantId","automationId","contactId","occurrenceYear")
);

CREATE INDEX "AutomationBirthdayClaim_tenantId_occurrenceYear_idx" ON "AutomationBirthdayClaim"("tenantId", "occurrenceYear");
ALTER TABLE "AutomationBirthdayClaim" ADD CONSTRAINT "AutomationBirthdayClaim_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Contact_birthday_month_day_idx" ON "Contact" (
    "tenantId",
    (EXTRACT(MONTH FROM "dateOfBirth")),
    (EXTRACT(DAY FROM "dateOfBirth"))
) WHERE "dateOfBirth" IS NOT NULL AND "deceasedAt" IS NULL;
