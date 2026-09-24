ALTER TYPE "AutomationActionType" ADD VALUE 'ADD_CONTACT_NOTE';

ALTER TABLE "AutomationAction"
ADD COLUMN "noteTitle" TEXT,
ADD COLUMN "noteBody" TEXT;

ALTER TABLE "ContactNote"
ADD COLUMN "automationId" TEXT,
ADD COLUMN "automationName" TEXT,
ALTER COLUMN "createdById" DROP NOT NULL;

ALTER TABLE "ContactNote"
DROP CONSTRAINT "ContactNote_createdById_fkey";

ALTER TABLE "ContactNote"
ADD CONSTRAINT "ContactNote_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContactNote"
ADD CONSTRAINT "ContactNote_automationId_fkey"
FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ContactNote_tenantId_automationId_createdAt_idx"
ON "ContactNote"("tenantId", "automationId", "createdAt");
