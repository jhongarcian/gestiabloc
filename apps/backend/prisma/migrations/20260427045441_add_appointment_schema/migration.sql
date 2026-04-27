-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "CalendarScheduleScope" AS ENUM ('TENANT', 'USER');

-- CreateEnum
CREATE TYPE "CalendarAvailabilityKind" AS ENUM ('OPEN', 'BLOCK');

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "serviceId" TEXT,
    "bookedByUserId" TEXT NOT NULL,
    "assignedToUserId" TEXT,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "isAllDay" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarAvailabilityRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "scope" "CalendarScheduleScope" NOT NULL,
    "kind" "CalendarAvailabilityKind" NOT NULL DEFAULT 'OPEN',
    "dayOfWeek" INTEGER NOT NULL,
    "startTimeMinutes" INTEGER NOT NULL,
    "endTimeMinutes" INTEGER NOT NULL,
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarAvailabilityRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarTimeBlock" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "scope" "CalendarScheduleScope" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "isAllDay" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarTimeBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Appointment_tenantId_startAt_idx" ON "Appointment"("tenantId", "startAt");

-- CreateIndex
CREATE INDEX "Appointment_tenantId_endAt_idx" ON "Appointment"("tenantId", "endAt");

-- CreateIndex
CREATE INDEX "Appointment_tenantId_status_startAt_idx" ON "Appointment"("tenantId", "status", "startAt");

-- CreateIndex
CREATE INDEX "Appointment_tenantId_assignedToUserId_startAt_idx" ON "Appointment"("tenantId", "assignedToUserId", "startAt");

-- CreateIndex
CREATE INDEX "Appointment_tenantId_contactId_startAt_idx" ON "Appointment"("tenantId", "contactId", "startAt");

-- CreateIndex
CREATE INDEX "Appointment_tenantId_serviceId_startAt_idx" ON "Appointment"("tenantId", "serviceId", "startAt");

-- CreateIndex
CREATE INDEX "Appointment_tenantId_bookedByUserId_startAt_idx" ON "Appointment"("tenantId", "bookedByUserId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_tenantId_id_key" ON "Appointment"("tenantId", "id");

-- CreateIndex
CREATE INDEX "CalendarAvailabilityRule_tenantId_scope_userId_isActive_idx" ON "CalendarAvailabilityRule"("tenantId", "scope", "userId", "isActive");

-- CreateIndex
CREATE INDEX "CalendarAvailabilityRule_tenantId_dayOfWeek_startTimeMinute_idx" ON "CalendarAvailabilityRule"("tenantId", "dayOfWeek", "startTimeMinutes", "endTimeMinutes");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarAvailabilityRule_tenantId_id_key" ON "CalendarAvailabilityRule"("tenantId", "id");

-- CreateIndex
CREATE INDEX "CalendarTimeBlock_tenantId_startsAt_idx" ON "CalendarTimeBlock"("tenantId", "startsAt");

-- CreateIndex
CREATE INDEX "CalendarTimeBlock_tenantId_endsAt_idx" ON "CalendarTimeBlock"("tenantId", "endsAt");

-- CreateIndex
CREATE INDEX "CalendarTimeBlock_tenantId_scope_userId_startsAt_idx" ON "CalendarTimeBlock"("tenantId", "scope", "userId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarTimeBlock_tenantId_id_key" ON "CalendarTimeBlock"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_bookedByUserId_fkey" FOREIGN KEY ("bookedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarAvailabilityRule" ADD CONSTRAINT "CalendarAvailabilityRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarAvailabilityRule" ADD CONSTRAINT "CalendarAvailabilityRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarTimeBlock" ADD CONSTRAINT "CalendarTimeBlock_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarTimeBlock" ADD CONSTRAINT "CalendarTimeBlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
