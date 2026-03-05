CREATE TYPE "ServiceProfessionalKind" AS ENUM ('INTERNAL_USER', 'EXTERNAL');
CREATE TYPE "ContactServiceStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELED');

CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "basePriceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "allowPartialPayments" BOOLEAN NOT NULL DEFAULT false,
    "minimumPartialPaymentCents" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServiceChecklistItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceChecklistItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServiceFollowUpTemplateStep" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notesTemplate" TEXT,
    "dueDaysFromStart" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceFollowUpTemplateStep_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServiceProfessional" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "kind" "ServiceProfessionalKind" NOT NULL,
    "userId" TEXT,
    "externalProfessionalName" TEXT,
    "externalContact" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceProfessional_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContactService" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "status" "ContactServiceStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "purchasedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "totalPriceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "allowPartialPayments" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactService_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContactServicePayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactServiceId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "paymentMethod" TEXT,
    "note" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactServicePayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContactServiceFollowUpStep" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactServiceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notesTemplate" TEXT,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "assignedToUserId" TEXT,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactServiceFollowUpStep_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Service_tenantId_id_key" ON "Service"("tenantId", "id");
CREATE UNIQUE INDEX "Service_tenantId_name_key" ON "Service"("tenantId", "name");
CREATE INDEX "Service_tenantId_sortOrder_idx" ON "Service"("tenantId", "sortOrder");
CREATE INDEX "Service_tenantId_isActive_sortOrder_idx" ON "Service"("tenantId", "isActive", "sortOrder");

CREATE UNIQUE INDEX "ServiceChecklistItem_tenantId_id_key" ON "ServiceChecklistItem"("tenantId", "id");
CREATE INDEX "ServiceChecklistItem_tenantId_serviceId_sortOrder_idx" ON "ServiceChecklistItem"("tenantId", "serviceId", "sortOrder");

CREATE UNIQUE INDEX "ServiceFollowUpTemplateStep_tenantId_id_key" ON "ServiceFollowUpTemplateStep"("tenantId", "id");
CREATE INDEX "ServiceFollowUpTemplateStep_tenantId_serviceId_sortOrder_idx" ON "ServiceFollowUpTemplateStep"("tenantId", "serviceId", "sortOrder");

CREATE UNIQUE INDEX "ServiceProfessional_tenantId_id_key" ON "ServiceProfessional"("tenantId", "id");
CREATE INDEX "ServiceProfessional_tenantId_serviceId_sortOrder_idx" ON "ServiceProfessional"("tenantId", "serviceId", "sortOrder");
CREATE INDEX "ServiceProfessional_tenantId_userId_idx" ON "ServiceProfessional"("tenantId", "userId");

CREATE UNIQUE INDEX "ContactService_tenantId_id_key" ON "ContactService"("tenantId", "id");
CREATE INDEX "ContactService_tenantId_contactId_createdAt_idx" ON "ContactService"("tenantId", "contactId", "createdAt");
CREATE INDEX "ContactService_tenantId_serviceId_createdAt_idx" ON "ContactService"("tenantId", "serviceId", "createdAt");
CREATE INDEX "ContactService_tenantId_status_createdAt_idx" ON "ContactService"("tenantId", "status", "createdAt");

CREATE UNIQUE INDEX "ContactServicePayment_tenantId_id_key" ON "ContactServicePayment"("tenantId", "id");
CREATE INDEX "ContactServicePayment_tenantId_contactServiceId_paidAt_idx" ON "ContactServicePayment"("tenantId", "contactServiceId", "paidAt");

CREATE UNIQUE INDEX "ContactServiceFollowUpStep_tenantId_id_key" ON "ContactServiceFollowUpStep"("tenantId", "id");
CREATE INDEX "ContactServiceFollowUpStep_tenantId_contactServiceId_sortOrder_idx" ON "ContactServiceFollowUpStep"("tenantId", "contactServiceId", "sortOrder");
CREATE INDEX "ContactServiceFollowUpStep_tenantId_assignedToUserId_dueAt_idx" ON "ContactServiceFollowUpStep"("tenantId", "assignedToUserId", "dueAt");

ALTER TABLE "Service"
ADD CONSTRAINT "Service_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServiceChecklistItem"
ADD CONSTRAINT "ServiceChecklistItem_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceChecklistItem"
ADD CONSTRAINT "ServiceChecklistItem_serviceId_fkey"
FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServiceFollowUpTemplateStep"
ADD CONSTRAINT "ServiceFollowUpTemplateStep_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceFollowUpTemplateStep"
ADD CONSTRAINT "ServiceFollowUpTemplateStep_serviceId_fkey"
FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServiceProfessional"
ADD CONSTRAINT "ServiceProfessional_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceProfessional"
ADD CONSTRAINT "ServiceProfessional_serviceId_fkey"
FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceProfessional"
ADD CONSTRAINT "ServiceProfessional_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContactService"
ADD CONSTRAINT "ContactService_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactService"
ADD CONSTRAINT "ContactService_contactId_fkey"
FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactService"
ADD CONSTRAINT "ContactService_serviceId_fkey"
FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactServicePayment"
ADD CONSTRAINT "ContactServicePayment_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactServicePayment"
ADD CONSTRAINT "ContactServicePayment_contactServiceId_fkey"
FOREIGN KEY ("contactServiceId") REFERENCES "ContactService"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactServicePayment"
ADD CONSTRAINT "ContactServicePayment_recordedById_fkey"
FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContactServiceFollowUpStep"
ADD CONSTRAINT "ContactServiceFollowUpStep_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactServiceFollowUpStep"
ADD CONSTRAINT "ContactServiceFollowUpStep_contactServiceId_fkey"
FOREIGN KEY ("contactServiceId") REFERENCES "ContactService"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactServiceFollowUpStep"
ADD CONSTRAINT "ContactServiceFollowUpStep_assignedToUserId_fkey"
FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
