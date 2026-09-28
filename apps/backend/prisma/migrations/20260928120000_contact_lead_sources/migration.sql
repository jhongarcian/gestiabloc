CREATE TABLE "ContactLeadSourceConfig" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isSystemDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContactLeadSourceConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContactLeadSourceConfig_tenantId_id_key"
ON "ContactLeadSourceConfig"("tenantId", "id");

CREATE UNIQUE INDEX "ContactLeadSourceConfig_tenantId_name_key"
ON "ContactLeadSourceConfig"("tenantId", "name");

CREATE INDEX "ContactLeadSourceConfig_tenantId_sortOrder_idx"
ON "ContactLeadSourceConfig"("tenantId", "sortOrder");

ALTER TABLE "ContactLeadSourceConfig"
ADD CONSTRAINT "ContactLeadSourceConfig_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "Contact"
SET "leadSource" = 'Marketing'
WHERE LOWER(BTRIM("leadSource")) = 'marketing';

UPDATE "Contact"
SET "leadSource" = 'Referral'
WHERE LOWER(BTRIM("leadSource")) = 'referral';

WITH canonical_sources AS (
  SELECT
    "tenantId",
    LOWER(BTRIM("leadSource")) AS source_key,
    MIN(BTRIM("leadSource")) AS canonical_name
  FROM "Contact"
  WHERE "leadSource" IS NOT NULL
    AND BTRIM("leadSource") <> ''
    AND LOWER(BTRIM("leadSource")) NOT IN ('marketing', 'referral')
  GROUP BY "tenantId", LOWER(BTRIM("leadSource"))
)
UPDATE "Contact" AS contact
SET "leadSource" = canonical_sources.canonical_name
FROM canonical_sources
WHERE contact."tenantId" = canonical_sources."tenantId"
  AND LOWER(BTRIM(contact."leadSource")) = canonical_sources.source_key;

UPDATE "Contact"
SET "leadSource" = NULL
WHERE "leadSource" IS NOT NULL
  AND BTRIM("leadSource") = '';

INSERT INTO "ContactLeadSourceConfig" (
  "id",
  "tenantId",
  "name",
  "sortOrder",
  "isSystemDefault",
  "createdAt",
  "updatedAt"
)
SELECT
  'lead-source-marketing-' || tenant."id",
  tenant."id",
  'Marketing',
  10,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Tenant" AS tenant;

INSERT INTO "ContactLeadSourceConfig" (
  "id",
  "tenantId",
  "name",
  "sortOrder",
  "isSystemDefault",
  "createdAt",
  "updatedAt"
)
SELECT
  'lead-source-referral-' || tenant."id",
  tenant."id",
  'Referral',
  20,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Tenant" AS tenant;

INSERT INTO "ContactLeadSourceConfig" (
  "id",
  "tenantId",
  "name",
  "sortOrder",
  "isSystemDefault",
  "createdAt",
  "updatedAt"
)
SELECT
  'lead-source-custom-' || MD5(contact."tenantId" || ':' || contact."leadSource"),
  contact."tenantId",
  contact."leadSource",
  20 + (ROW_NUMBER() OVER (
    PARTITION BY contact."tenantId"
    ORDER BY contact."leadSource"
  ) * 10)::INTEGER,
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT "tenantId", "leadSource"
  FROM "Contact"
  WHERE "leadSource" IS NOT NULL
    AND "leadSource" NOT IN ('Marketing', 'Referral')
) AS contact;

CREATE UNIQUE INDEX "ContactLeadSourceConfig_tenantId_name_ci_key"
ON "ContactLeadSourceConfig"("tenantId", LOWER("name"));
