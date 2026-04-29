UPDATE "ContactService"
SET "status" = 'IN_PROGRESS'
WHERE "status" = 'PENDING';

ALTER TYPE "ContactServiceStatus" RENAME TO "ContactServiceStatus_old";

CREATE TYPE "ContactServiceStatus" AS ENUM (
  'IN_PROGRESS',
  'PENDING_PAYMENT',
  'COMPLETED',
  'CANCELED'
);

ALTER TABLE "ContactService"
ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "ContactService"
ALTER COLUMN "status" TYPE "ContactServiceStatus"
USING ("status"::text::"ContactServiceStatus");

ALTER TABLE "ContactService"
ALTER COLUMN "status" SET DEFAULT 'IN_PROGRESS';

DROP TYPE "ContactServiceStatus_old";
