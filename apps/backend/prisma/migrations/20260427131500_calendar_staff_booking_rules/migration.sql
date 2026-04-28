DO $$
BEGIN
  CREATE TYPE "CalendarBufferAvailabilityMode" AS ENUM ('BUSY', 'UNAVAILABLE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Tenant"
ADD COLUMN IF NOT EXISTS "calendarMeetingDurationMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN IF NOT EXISTS "calendarMinimumScheduleNoticeMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "calendarMaximumBookingsPerDay" INTEGER,
ADD COLUMN IF NOT EXISTS "calendarMaximumBookingsPerSlot" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS "calendarPreBufferMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "calendarPostBufferMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "calendarBufferAvailabilityMode" "CalendarBufferAvailabilityMode" NOT NULL DEFAULT 'BUSY';

ALTER TABLE "Membership"
ADD COLUMN IF NOT EXISTS "calendarEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "calendarColor" TEXT;
