-- AlterEnum
ALTER TYPE "FilePurpose" ADD VALUE 'AI_AVATAR';

-- CreateTable
CREATE TABLE "TenantAiSettings" (
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'AI Helper',
    "language" TEXT NOT NULL DEFAULT 'English',
    "tone" TEXT NOT NULL DEFAULT 'Professional',
    "instructions" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "avatarPresetId" TEXT NOT NULL DEFAULT 'bot',
    "avatarFileId" TEXT,
    "avatarRevision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantAiSettings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateIndex
CREATE UNIQUE INDEX "File_tenantId_id_key" ON "File"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "TenantAiSettings" ADD CONSTRAINT "TenantAiSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantAiSettings" ADD CONSTRAINT "TenantAiSettings_tenantId_avatarFileId_fkey" FOREIGN KEY ("tenantId", "avatarFileId") REFERENCES "File"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
