ALTER TYPE "AppointmentStatus" RENAME TO "AppointmentStatus_old";

CREATE TYPE "AppointmentStatus" AS ENUM (
  'SCHEDULED',
  'CONFIRMED',
  'SHOW',
  'NO_SHOW',
  'CANCELED'
);

ALTER TABLE "Appointment"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "AppointmentStatus"
  USING (
    CASE
      WHEN "status"::text = 'COMPLETED' THEN 'SHOW'
      ELSE "status"::text
    END
  )::"AppointmentStatus",
  ALTER COLUMN "status" SET DEFAULT 'SCHEDULED';

DROP TYPE "AppointmentStatus_old";
