ALTER TABLE "ContactServiceFollowUpRun"
ADD COLUMN "waitingNodeId" TEXT;

ALTER TABLE "ServiceFollowUpNodeExecution"
ADD COLUMN "input" JSONB;
