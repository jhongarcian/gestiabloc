ALTER TYPE "AutomationActionType" ADD VALUE 'CREATE_CONTACT';

ALTER TABLE "AutomationAction"
ADD COLUMN "createContactConfig" JSONB;
