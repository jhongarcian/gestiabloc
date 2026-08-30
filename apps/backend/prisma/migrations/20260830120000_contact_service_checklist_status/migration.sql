CREATE TYPE "ContactServiceChecklistStatus" AS ENUM (
  'NOT_RECEIVED',
  'INFORMED',
  'MISSING',
  'RECEIVED'
);

ALTER TABLE "ContactServiceChecklistItem"
ADD COLUMN "status" "ContactServiceChecklistStatus" NOT NULL DEFAULT 'NOT_RECEIVED';

UPDATE "ContactServiceChecklistItem"
SET "status" = 'RECEIVED'
WHERE "completedAt" IS NOT NULL;

CREATE TABLE "ContactServiceChecklistActivity" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "contactServiceId" TEXT NOT NULL,
  "contactServiceChecklistItemId" TEXT,
  "itemLabel" TEXT NOT NULL,
  "previousStatus" "ContactServiceChecklistStatus" NOT NULL,
  "status" "ContactServiceChecklistStatus" NOT NULL,
  "actorUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContactServiceChecklistActivity_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ContactServiceChecklistActivity" (
  "id",
  "tenantId",
  "contactServiceId",
  "contactServiceChecklistItemId",
  "itemLabel",
  "previousStatus",
  "status",
  "createdAt"
)
SELECT
  'checklist-backfill-' || checklist_entry."id",
  checklist_entry."tenantId",
  checklist_entry."contactServiceId",
  checklist_entry."id",
  checklist_definition."label",
  'NOT_RECEIVED'::"ContactServiceChecklistStatus",
  'RECEIVED'::"ContactServiceChecklistStatus",
  checklist_entry."completedAt"
FROM "ContactServiceChecklistItem" AS checklist_entry
INNER JOIN "ServiceChecklistItem" AS checklist_definition
  ON checklist_definition."id" = checklist_entry."checklistItemId"
WHERE checklist_entry."completedAt" IS NOT NULL;

CREATE UNIQUE INDEX "ContactServiceChecklistActivity_tenantId_id_key"
ON "ContactServiceChecklistActivity"("tenantId", "id");

CREATE INDEX "ContactServiceChecklistItem_tenantId_contactServiceId_statu_idx"
ON "ContactServiceChecklistItem"("tenantId", "contactServiceId", "status");

CREATE INDEX "ContactServiceChecklistActivity_tenantId_contactServiceId_c_idx"
ON "ContactServiceChecklistActivity"("tenantId", "contactServiceId", "createdAt");

CREATE INDEX "ContactServiceChecklistActivity_tenantId_contactServiceChec_idx"
ON "ContactServiceChecklistActivity"("tenantId", "contactServiceChecklistItemId", "createdAt");

CREATE INDEX "ContactServiceChecklistActivity_tenantId_actorUserId_create_idx"
ON "ContactServiceChecklistActivity"("tenantId", "actorUserId", "createdAt");

ALTER TABLE "ContactServiceChecklistActivity"
ADD CONSTRAINT "ContactServiceChecklistActivity_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactServiceChecklistActivity"
ADD CONSTRAINT "ContactServiceChecklistActivity_contactServiceId_fkey"
FOREIGN KEY ("contactServiceId") REFERENCES "ContactService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactServiceChecklistActivity"
ADD CONSTRAINT "ContactServiceChecklistActivity_contactServiceChecklistIte_fkey"
FOREIGN KEY ("contactServiceChecklistItemId") REFERENCES "ContactServiceChecklistItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContactServiceChecklistActivity"
ADD CONSTRAINT "ContactServiceChecklistActivity_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
