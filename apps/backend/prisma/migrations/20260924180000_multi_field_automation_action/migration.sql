-- AlterEnum
ALTER TYPE "AutomationActionType" ADD VALUE 'UPDATE_CONTACT_CUSTOM_FIELDS';

-- AlterTable
ALTER TABLE "AutomationAction" ADD COLUMN "customFieldUpdates" JSONB;
