CREATE TYPE "SecurityLevel" AS ENUM ('LOW', 'MEDIUM', 'MAX');

ALTER TABLE "Membership"
ADD COLUMN "securityLevel" "SecurityLevel" NOT NULL DEFAULT 'LOW';

UPDATE "Membership"
SET "securityLevel" = 'MAX'
WHERE "role" = 'TENANT_ADMIN';

CREATE INDEX "Membership_tenantId_securityLevel_idx"
ON "Membership"("tenantId", "securityLevel");
