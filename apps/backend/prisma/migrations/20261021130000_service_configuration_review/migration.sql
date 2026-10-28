CREATE TABLE "ContactServiceConfigurationChange" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactServiceId" TEXT NOT NULL,
    "baselineDigest" TEXT NOT NULL,
    "targetDigest" TEXT NOT NULL,
    "preview" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "appliedByUserId" TEXT,
    "appliedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContactServiceConfigurationChange_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ContactServiceConfigurationChange_enrollment_fkey" FOREIGN KEY ("tenantId", "contactServiceId") REFERENCES "ContactService"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ContactServiceConfigurationChange_tenantId_id_key" ON "ContactServiceConfigurationChange"("tenantId", "id");
CREATE INDEX "ContactServiceConfigurationChange_enrollment_idx" ON "ContactServiceConfigurationChange"("tenantId", "contactServiceId", "createdAt");
