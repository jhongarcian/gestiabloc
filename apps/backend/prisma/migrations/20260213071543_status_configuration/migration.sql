-- CreateEnum
CREATE TYPE "ContactGender" AS ENUM ('FEMALE', 'MALE', 'NON_BINARY', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ContactSmokerStatus" AS ENUM ('UNKNOWN', 'NEVER', 'CURRENT', 'FORMER');

-- CreateTable
CREATE TABLE "ContactStatusConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bgColor" TEXT NOT NULL,
    "textColor" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystemDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactStatusConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "secondaryPhone" TEXT,
    "email" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "mailingAddressLine1" TEXT,
    "mailingAddressLine2" TEXT,
    "mailingCity" TEXT,
    "mailingState" TEXT,
    "mailingPostalCode" TEXT,
    "mailingCountry" TEXT,
    "statusConfigId" TEXT,
    "assignedToUserId" TEXT,
    "ssnLast4" TEXT,
    "ssnCiphertext" TEXT,
    "ssnIv" TEXT,
    "ssnAuthTag" TEXT,
    "ssnKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "emergencyContactRelationship" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" "ContactGender",
    "height" TEXT,
    "weight" TEXT,
    "deceasedAt" TIMESTAMP(3),
    "medicarePartA" BOOLEAN,
    "medicarePartB" BOOLEAN,
    "smokerStatus" "ContactSmokerStatus",
    "servicingAgentUserId" TEXT,
    "additionalAgentUserId" TEXT,
    "leadDate" TIMESTAMP(3),
    "leadSource" TEXT,
    "leadOtherSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactStatusConfig_tenantId_sortOrder_idx" ON "ContactStatusConfig"("tenantId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ContactStatusConfig_tenantId_id_key" ON "ContactStatusConfig"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ContactStatusConfig_tenantId_name_key" ON "ContactStatusConfig"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Contact_tenantId_lastName_firstName_idx" ON "Contact"("tenantId", "lastName", "firstName");

-- CreateIndex
CREATE INDEX "Contact_tenantId_statusConfigId_idx" ON "Contact"("tenantId", "statusConfigId");

-- CreateIndex
CREATE INDEX "Contact_tenantId_assignedToUserId_idx" ON "Contact"("tenantId", "assignedToUserId");

-- CreateIndex
CREATE INDEX "Contact_tenantId_servicingAgentUserId_idx" ON "Contact"("tenantId", "servicingAgentUserId");

-- CreateIndex
CREATE INDEX "Contact_tenantId_additionalAgentUserId_idx" ON "Contact"("tenantId", "additionalAgentUserId");

-- CreateIndex
CREATE INDEX "Contact_tenantId_email_idx" ON "Contact"("tenantId", "email");

-- CreateIndex
CREATE INDEX "Contact_tenantId_phone_idx" ON "Contact"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "Contact_tenantId_ssnLast4_idx" ON "Contact"("tenantId", "ssnLast4");

-- AddForeignKey
ALTER TABLE "ContactStatusConfig" ADD CONSTRAINT "ContactStatusConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_tenantId_statusConfigId_fkey" FOREIGN KEY ("tenantId", "statusConfigId") REFERENCES "ContactStatusConfig"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_tenantId_assignedToUserId_fkey" FOREIGN KEY ("tenantId", "assignedToUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_tenantId_servicingAgentUserId_fkey" FOREIGN KEY ("tenantId", "servicingAgentUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_tenantId_additionalAgentUserId_fkey" FOREIGN KEY ("tenantId", "additionalAgentUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
