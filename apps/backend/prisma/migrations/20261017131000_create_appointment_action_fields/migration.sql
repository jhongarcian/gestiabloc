ALTER TABLE "AutomationAction" ADD COLUMN "appointmentConfig" JSONB;
ALTER TABLE "Appointment" ALTER COLUMN "bookedByUserId" DROP NOT NULL;

ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_bookedByUserId_fkey";
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_bookedByUserId_fkey" FOREIGN KEY ("bookedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
