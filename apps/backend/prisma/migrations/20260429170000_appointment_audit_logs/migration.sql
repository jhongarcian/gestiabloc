CREATE TYPE "AppointmentAuditAction" AS ENUM (
  'CREATED',
  'REASSIGNED',
  'RESCHEDULED',
  'CANCELED'
);

CREATE TABLE "AppointmentAuditLog" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "action" "AppointmentAuditAction" NOT NULL,
  "actorDisplayName" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AppointmentAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AppointmentAuditLog_tenantId_appointmentId_createdAt_idx"
  ON "AppointmentAuditLog"("tenantId", "appointmentId", "createdAt");

CREATE INDEX "AppointmentAuditLog_tenantId_actorUserId_createdAt_idx"
  ON "AppointmentAuditLog"("tenantId", "actorUserId", "createdAt");

CREATE INDEX "AppointmentAuditLog_tenantId_action_createdAt_idx"
  ON "AppointmentAuditLog"("tenantId", "action", "createdAt");

CREATE UNIQUE INDEX "AppointmentAuditLog_tenantId_id_key"
  ON "AppointmentAuditLog"("tenantId", "id");

ALTER TABLE "AppointmentAuditLog"
  ADD CONSTRAINT "AppointmentAuditLog_tenantId_fkey"
  FOREIGN KEY ("tenantId")
  REFERENCES "Tenant"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "AppointmentAuditLog"
  ADD CONSTRAINT "AppointmentAuditLog_appointmentId_fkey"
  FOREIGN KEY ("appointmentId")
  REFERENCES "Appointment"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "AppointmentAuditLog"
  ADD CONSTRAINT "AppointmentAuditLog_actorUserId_fkey"
  FOREIGN KEY ("actorUserId")
  REFERENCES "User"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
