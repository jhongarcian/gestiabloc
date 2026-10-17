ALTER TYPE "AppointmentStatus" ADD VALUE 'COMPLETED';
ALTER TYPE "AppointmentAuditAction" ADD VALUE 'STATUS_CHANGED';
ALTER TYPE "AutomationTriggerType" ADD VALUE 'APPOINTMENT_STATUS_CHANGED';
ALTER TYPE "AutomationNodeEventSource" ADD VALUE 'APPOINTMENT_STATUS_CHANGED';

ALTER TABLE "Automation" ADD COLUMN "appointmentTargetStatus" "AppointmentStatus";
ALTER TABLE "AutomationEvent" ADD COLUMN "contactSnapshot" JSONB;
