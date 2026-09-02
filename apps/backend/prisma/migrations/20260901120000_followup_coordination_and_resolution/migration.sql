ALTER TABLE "ContactService"
ADD COLUMN "followUpCoordinatorUserId" TEXT;

ALTER TABLE "ContactServiceFollowUpStep"
ADD COLUMN "resolvedByUserId" TEXT,
ADD COLUMN "resolvedAt" TIMESTAMP(3);

ALTER TABLE "ServiceFollowUpExecutionLog"
ALTER COLUMN "templateId" DROP NOT NULL;

ALTER TABLE "ServiceFollowUpExecutionLog"
DROP CONSTRAINT "ServiceFollowUpExecutionLog_templateId_fkey";

ALTER TABLE "ServiceFollowUpExecutionLog"
ADD CONSTRAINT "ServiceFollowUpExecutionLog_templateId_fkey"
FOREIGN KEY ("templateId") REFERENCES "ServiceFollowUpTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContactService"
ADD CONSTRAINT "ContactService_followUpCoordinatorUserId_fkey"
FOREIGN KEY ("followUpCoordinatorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContactServiceFollowUpStep"
ADD CONSTRAINT "ContactServiceFollowUpStep_resolvedByUserId_fkey"
FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ContactService_tenantId_followUpCoordinatorUserId_idx"
ON "ContactService"("tenantId", "followUpCoordinatorUserId");

CREATE INDEX "ContactServiceFollowUpStep_tenantId_resolvedByUserId_res_idx"
ON "ContactServiceFollowUpStep"("tenantId", "resolvedByUserId", "resolvedAt");

WITH relevant_steps AS (
  SELECT
    step."contactServiceId",
    step."assignedToUserId"
  FROM "ContactServiceFollowUpStep" AS step
  WHERE (
    EXISTS (
      SELECT 1
      FROM "ContactServiceFollowUpStep" AS open_step
      WHERE open_step."contactServiceId" = step."contactServiceId"
        AND open_step."status" NOT IN ('COMPLETED', 'SKIPPED')
    )
    AND step."status" NOT IN ('COMPLETED', 'SKIPPED')
  ) OR NOT EXISTS (
    SELECT 1
    FROM "ContactServiceFollowUpStep" AS open_step
    WHERE open_step."contactServiceId" = step."contactServiceId"
      AND open_step."status" NOT IN ('COMPLETED', 'SKIPPED')
  )
), unanimous_owners AS (
  SELECT
    "contactServiceId",
    MIN("assignedToUserId") AS "coordinatorUserId"
  FROM relevant_steps
  GROUP BY "contactServiceId"
  HAVING COUNT(*) > 0
    AND COUNT("assignedToUserId") = COUNT(*)
    AND COUNT(DISTINCT "assignedToUserId") = 1
)
UPDATE "ContactService" AS service_enrollment
SET "followUpCoordinatorUserId" = unanimous_owners."coordinatorUserId"
FROM unanimous_owners
WHERE service_enrollment."id" = unanimous_owners."contactServiceId";

UPDATE "ContactServiceFollowUpStep"
SET "resolvedAt" = "completedAt"
WHERE "status" IN ('COMPLETED', 'SKIPPED')
  AND "completedAt" IS NOT NULL;

WITH latest_resolution AS (
  SELECT DISTINCT ON (execution_log."stepId")
    execution_log."stepId",
    execution_log."actorUserId",
    execution_log."createdAt",
    execution_log."payload" ->> 'status' AS "status"
  FROM "ServiceFollowUpExecutionLog" AS execution_log
  WHERE execution_log."eventType" = 'STEP_STATUS_UPDATED'
    AND execution_log."stepId" IS NOT NULL
    AND execution_log."actorUserId" IS NOT NULL
    AND execution_log."payload" ->> 'status' IN ('COMPLETED', 'SKIPPED')
  ORDER BY execution_log."stepId", execution_log."createdAt" DESC
)
UPDATE "ContactServiceFollowUpStep" AS step
SET
  "resolvedByUserId" = latest_resolution."actorUserId",
  "resolvedAt" = COALESCE(step."resolvedAt", latest_resolution."createdAt")
FROM latest_resolution
WHERE step."id" = latest_resolution."stepId"
  AND step."status"::TEXT = latest_resolution."status";
