-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "accountRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "description" TEXT;
