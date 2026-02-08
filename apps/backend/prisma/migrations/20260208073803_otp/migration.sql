/*
  Warnings:

  - The values [CLIENT_ADMIN,CLIENT_USER] on the enum `TenantRole` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PlatformRole" ADD VALUE 'SUPPORT';
ALTER TYPE "PlatformRole" ADD VALUE 'MARKETING';

-- AlterEnum
BEGIN;
CREATE TYPE "TenantRole_new" AS ENUM ('TENANT_ADMIN', 'TENANT_USER');
ALTER TABLE "Membership" ALTER COLUMN "role" TYPE "TenantRole_new" USING ("role"::text::"TenantRole_new");
ALTER TABLE "Invite" ALTER COLUMN "role" TYPE "TenantRole_new" USING ("role"::text::"TenantRole_new");
ALTER TYPE "TenantRole" RENAME TO "TenantRole_old";
ALTER TYPE "TenantRole_new" RENAME TO "TenantRole";
DROP TYPE "public"."TenantRole_old";
COMMIT;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "addressLine1" TEXT,
ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "timezone" TEXT,
ADD COLUMN     "website" TEXT;
