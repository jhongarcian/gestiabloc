CREATE TYPE "ContactImportStatus" AS ENUM ('DRAFT', 'QUEUED', 'PROCESSING', 'CANCEL_REQUESTED', 'CANCELED', 'COMPLETED', 'COMPLETED_WITH_ISSUES', 'FAILED');
CREATE TYPE "ContactImportPhase" AS ENUM ('VALIDATING', 'IMPORTING', 'REPORTING');

CREATE TABLE "ContactImport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "status" "ContactImportStatus" NOT NULL DEFAULT 'DRAFT',
    "phase" "ContactImportPhase",
    "headers" JSONB,
    "mappings" JSONB,
    "settings" JSONB,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "createdRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "lastCommittedRow" INTEGER NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "reportKey" TEXT,
    "sourceDeletedAt" TIMESTAMP(3),
    "issuesDeletedAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContactImport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContactImportIssue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContactImportIssue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContactImport_tenantId_id_key" ON "ContactImport"("tenantId", "id");
CREATE INDEX "ContactImport_status_availableAt_createdAt_idx" ON "ContactImport"("status", "availableAt", "createdAt");
CREATE INDEX "ContactImport_status_leaseExpiresAt_idx" ON "ContactImport"("status", "leaseExpiresAt");
CREATE INDEX "ContactImport_tenantId_createdAt_idx" ON "ContactImport"("tenantId", "createdAt");
CREATE UNIQUE INDEX "ContactImport_one_active_per_tenant_idx" ON "ContactImport"("tenantId") WHERE "status" IN ('QUEUED', 'PROCESSING', 'CANCEL_REQUESTED');
CREATE UNIQUE INDEX "ContactImportIssue_importId_rowNumber_key" ON "ContactImportIssue"("importId", "rowNumber");
CREATE INDEX "ContactImportIssue_tenantId_importId_rowNumber_idx" ON "ContactImportIssue"("tenantId", "importId", "rowNumber");
ALTER TABLE "ContactImport" ADD CONSTRAINT "ContactImport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactImportIssue" ADD CONSTRAINT "ContactImportIssue_importId_fkey" FOREIGN KEY ("importId") REFERENCES "ContactImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Contact_email_normalized_import_idx" ON "Contact"("tenantId", lower("email")) WHERE "email" IS NOT NULL;
