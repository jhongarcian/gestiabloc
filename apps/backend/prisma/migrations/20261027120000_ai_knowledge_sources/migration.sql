-- CreateEnum
CREATE TYPE "AiSourceKind" AS ENUM ('FILE', 'LINK');

-- CreateEnum
CREATE TYPE "AiSourceStatus" AS ENUM ('UPLOADING', 'QUEUED', 'PROCESSING', 'READY', 'FAILED', 'OCR_REQUIRED', 'DELETING');

-- CreateTable
CREATE TABLE "ServiceAiSource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" "AiSourceKind" NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT,
    "finalUrl" TEXT,
    "filename" TEXT,
    "contentType" TEXT,
    "size" INTEGER,
    "checksum" TEXT,
    "storageKey" TEXT,
    "uploadedAt" TIMESTAMP(3),
    "status" "AiSourceStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "characterCount" INTEGER NOT NULL DEFAULT 0,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceAiSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSourceChunk" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "page" INTEGER,
    "content" TEXT NOT NULL,
    "searchText" TEXT NOT NULL,
    "searchVector" tsvector DEFAULT ''::tsvector,

    CONSTRAINT "AiSourceChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSourceStorageCleanup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSourceStorageCleanup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceAiSource_storageKey_key" ON "ServiceAiSource"("storageKey");

-- CreateIndex
CREATE INDEX "ServiceAiSource_tenantId_serviceId_deletedAt_createdAt_idx" ON "ServiceAiSource"("tenantId", "serviceId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceAiSource_status_availableAt_idx" ON "ServiceAiSource"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceAiSource_tenantId_id_key" ON "ServiceAiSource"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceAiSource_tenantId_requestId_key" ON "ServiceAiSource"("tenantId", "requestId");

-- CreateIndex
CREATE INDEX "AiSourceChunk_searchVector_idx" ON "AiSourceChunk" USING GIN ("searchVector");

-- CreateIndex
CREATE UNIQUE INDEX "AiSourceChunk_tenantId_sourceId_ordinal_key" ON "AiSourceChunk"("tenantId", "sourceId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "AiSourceStorageCleanup_storageKey_key" ON "AiSourceStorageCleanup"("storageKey");

-- CreateIndex
CREATE INDEX "AiSourceStorageCleanup_availableAt_idx" ON "AiSourceStorageCleanup"("availableAt");

-- AddForeignKey
ALTER TABLE "ServiceAiSource" ADD CONSTRAINT "ServiceAiSource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAiSource" ADD CONSTRAINT "ServiceAiSource_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSourceChunk" ADD CONSTRAINT "AiSourceChunk_tenantId_sourceId_fkey" FOREIGN KEY ("tenantId", "sourceId") REFERENCES "ServiceAiSource"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep the full-text index current for every chunk insert/update.
CREATE FUNCTION ai_source_chunk_search_vector() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."searchVector" := to_tsvector('simple'::regconfig, NEW."searchText");
  RETURN NEW;
END;
$$;
CREATE TRIGGER ai_source_chunk_search_vector_trigger
  BEFORE INSERT OR UPDATE OF "searchText" ON "AiSourceChunk"
  FOR EACH ROW EXECUTE FUNCTION ai_source_chunk_search_vector();

-- Preserve cleanup work even when a service or tenant is deleted by another route.
-- A grace period covers uploads still completing when their record is removed.
CREATE FUNCTION ai_source_schedule_storage_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."storageKey" IS NOT NULL THEN
    INSERT INTO "AiSourceStorageCleanup" (id, "tenantId", "serviceId", "sourceId", "storageKey", "availableAt")
    VALUES (gen_random_uuid()::text, OLD."tenantId", OLD."serviceId", OLD.id, OLD."storageKey",
      CASE WHEN OLD."uploadedAt" IS NULL THEN CURRENT_TIMESTAMP + INTERVAL '60 seconds' ELSE CURRENT_TIMESTAMP END)
    ON CONFLICT ("storageKey") DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER ai_source_schedule_storage_cleanup_trigger
  BEFORE DELETE ON "ServiceAiSource"
  FOR EACH ROW EXECUTE FUNCTION ai_source_schedule_storage_cleanup();
