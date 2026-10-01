ALTER TYPE "AutomationActionType" ADD VALUE 'UPDATE_OPPORTUNITY';

ALTER TABLE "AutomationAction"
ADD COLUMN "opportunityConfig" JSONB;

ALTER TABLE "AutomationEvent"
ADD COLUMN "chainId" TEXT NOT NULL DEFAULT gen_random_uuid(),
ADD COLUMN "parentEventId" TEXT,
ADD COLUMN "chainDepth" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "transitionHistory" JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN "sourceAutomationId" TEXT,
ADD COLUMN "sourceAutomationName" TEXT,
ADD COLUMN "sourceNodeKey" TEXT,
ADD COLUMN "causationKey" TEXT;

CREATE UNIQUE INDEX "AutomationEvent_causationKey_key"
ON "AutomationEvent"("causationKey");

CREATE INDEX "AutomationEvent_tenantId_chainId_chainDepth_idx"
ON "AutomationEvent"("tenantId", "chainId", "chainDepth");
