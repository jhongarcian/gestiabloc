ALTER TABLE "ContactRelationship"
ADD COLUMN "relationshipPairKey" TEXT;

UPDATE "ContactRelationship"
SET "relationshipPairKey" = CASE
  WHEN "contactId" < "relatedContactId"
    THEN "contactId" || ':' || "relatedContactId"
  ELSE "relatedContactId" || ':' || "contactId"
END
WHERE "relationshipPairKey" IS NULL;

ALTER TABLE "ContactRelationship"
ALTER COLUMN "relationshipPairKey" SET NOT NULL;

DROP INDEX IF EXISTS "ContactRelationship_tenantId_contactId_relatedContactId_key";
CREATE UNIQUE INDEX "ContactRelationship_tenantId_relationshipPairKey_key"
ON "ContactRelationship"("tenantId", "relationshipPairKey");

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Contact_firstName_trgm_idx"
ON "Contact" USING GIN ("firstName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Contact_middleName_trgm_idx"
ON "Contact" USING GIN ("middleName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Contact_lastName_trgm_idx"
ON "Contact" USING GIN ("lastName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Contact_email_trgm_idx"
ON "Contact" USING GIN ("email" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Contact_phone_trgm_idx"
ON "Contact" USING GIN ("phone" gin_trgm_ops);
