-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CUSTOM_FIELD_ACCESS_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CUSTOM_FIELD_ACCESS_GRANTED';

-- CreateEnum
CREATE TYPE "ContactCustomFieldAccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "ContactCustomField"
ADD COLUMN "isSensitive" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ContactCustomFieldAccessRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "requesterUserId" TEXT NOT NULL,
    "status" "ContactCustomFieldAccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactCustomFieldAccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactCustomFieldAccessGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantedByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "remainingReads" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactCustomFieldAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactCustomFieldAccessRequest_tenantId_status_createdAt_idx" ON "ContactCustomFieldAccessRequest"("tenantId", "status", "createdAt");
CREATE INDEX "ContactCustomFieldAccessRequest_tenantId_fieldId_requesterUserId_status_idx" ON "ContactCustomFieldAccessRequest"("tenantId", "fieldId", "requesterUserId", "status");
CREATE INDEX "ContactCustomFieldAccessRequest_tenantId_requesterUserId_status_createdAt_idx" ON "ContactCustomFieldAccessRequest"("tenantId", "requesterUserId", "status", "createdAt");

CREATE UNIQUE INDEX "ContactCustomFieldAccessGrant_tenantId_fieldId_userId_key" ON "ContactCustomFieldAccessGrant"("tenantId", "fieldId", "userId");
CREATE INDEX "ContactCustomFieldAccessGrant_tenantId_userId_createdAt_idx" ON "ContactCustomFieldAccessGrant"("tenantId", "userId", "createdAt");
CREATE INDEX "ContactCustomFieldAccessGrant_tenantId_fieldId_createdAt_idx" ON "ContactCustomFieldAccessGrant"("tenantId", "fieldId", "createdAt");
CREATE INDEX "ContactCustomFieldAccessGrant_tenantId_userId_expiresAt_idx" ON "ContactCustomFieldAccessGrant"("tenantId", "userId", "expiresAt");

-- AddForeignKey
ALTER TABLE "ContactCustomFieldAccessRequest" ADD CONSTRAINT "ContactCustomFieldAccessRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactCustomFieldAccessRequest" ADD CONSTRAINT "ContactCustomFieldAccessRequest_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "ContactCustomField"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactCustomFieldAccessRequest" ADD CONSTRAINT "ContactCustomFieldAccessRequest_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactCustomFieldAccessRequest" ADD CONSTRAINT "ContactCustomFieldAccessRequest_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContactCustomFieldAccessGrant" ADD CONSTRAINT "ContactCustomFieldAccessGrant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactCustomFieldAccessGrant" ADD CONSTRAINT "ContactCustomFieldAccessGrant_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "ContactCustomField"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactCustomFieldAccessGrant" ADD CONSTRAINT "ContactCustomFieldAccessGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactCustomFieldAccessGrant" ADD CONSTRAINT "ContactCustomFieldAccessGrant_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
