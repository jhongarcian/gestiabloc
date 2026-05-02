CREATE TYPE "CalendarBlockRecurrencePattern" AS ENUM (
  'NONE',
  'DAILY',
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY'
);

ALTER TABLE "CalendarTimeBlock"
  ADD COLUMN "recurrencePattern" "CalendarBlockRecurrencePattern" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "recurrenceUntil" TIMESTAMP(3);

CREATE INDEX "CalendarTimeBlock_tenantId_recurrencePattern_recurrenceUntil_idx"
  ON "CalendarTimeBlock"("tenantId", "recurrencePattern", "recurrenceUntil");
