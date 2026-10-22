-- Deploy with every old application/worker instance stopped. No old cursor is replayed.
BEGIN;
LOCK TABLE "ContactServiceFollowUpRun", "ServiceFollowUpNodeExecution", "ServiceFollowUpTemplate", "ServiceFollowUpTemplateVersion", "ServiceFollowUpTemplateStep" IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "ContactServiceFollowUpRun" WHERE "leaseToken" IS NOT NULL AND "leaseExpiresAt" > CURRENT_TIMESTAMP) THEN
    RAISE EXCEPTION 'LEGACY_WORKER_LEASE_ACTIVE: stop old workers and wait for their leases to expire before retiring templates';
  END IF;
END $$;
ALTER TABLE "ContactService" ADD COLUMN     "retiredWorkflowSnapshot" JSONB;
ALTER TABLE "Task" ADD COLUMN     "retiredWorkflowSnapshot" JSONB;
ALTER TABLE "ContactNote" ADD COLUMN     "retiredWorkflowSnapshot" JSONB;

-- Freeze enrollment-specific provenance, run state and completed node outcomes before
-- dropping executable definitions. Existing saved steps, IDs, assignments and logs stay intact.
UPDATE "ContactService" cs SET "retiredWorkflowSnapshot" = jsonb_build_object(
  'schemaVersion', 1, 'retiredAt', CURRENT_TIMESTAMP,
  'template', (SELECT to_jsonb(t) FROM "ServiceFollowUpTemplate" t WHERE t."tenantId"=cs."tenantId" AND t.id=cs."followUpTemplateId"),
  'version', (SELECT to_jsonb(v) FROM "ServiceFollowUpTemplateVersion" v WHERE v."tenantId"=cs."tenantId" AND v.id=cs."followUpTemplateVersionId"),
  'run', (SELECT to_jsonb(r) - 'leaseToken' - 'leaseExpiresAt' FROM "ContactServiceFollowUpRun" r WHERE r."tenantId"=cs."tenantId" AND r."contactServiceId"=cs.id),
  'nodeExecutions', COALESCE((SELECT jsonb_agg(to_jsonb(n) ORDER BY n."startedAt", n.id)
    FROM "ServiceFollowUpNodeExecution" n JOIN "ContactServiceFollowUpRun" r ON r.id=n."runId" AND r."tenantId"=n."tenantId"
    WHERE r."tenantId"=cs."tenantId" AND r."contactServiceId"=cs.id), '[]'::jsonb),
  'defaultSteps', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s."sortOrder", s.id) FROM "ServiceFollowUpTemplateStep" s
    WHERE s."tenantId"=cs."tenantId" AND s."serviceId"=cs."serviceId" AND (s."templateId"=cs."followUpTemplateId" OR s."templateId" IS NULL)), '[]'::jsonb)
) WHERE cs."workflowKind"='LEGACY_TEMPLATE' OR cs."followUpTemplateId" IS NOT NULL OR cs."followUpTemplateVersionId" IS NOT NULL
  OR EXISTS (SELECT 1 FROM "ContactServiceFollowUpRun" r WHERE r."tenantId"=cs."tenantId" AND r."contactServiceId"=cs.id);

UPDATE "Task" source SET "retiredWorkflowSnapshot" = jsonb_build_object(
  'schemaVersion', 1, 'retiredAt', CURRENT_TIMESTAMP,
  'template', (SELECT jsonb_build_object('id',t.id,'name',t.name) FROM "ServiceFollowUpTemplate" t WHERE t."tenantId"=source."tenantId" AND t.id=source."followUpTemplateId"),
  'version', (SELECT jsonb_build_object('id',v.id,'versionNumber',v."versionNumber") FROM "ServiceFollowUpTemplateVersion" v WHERE v."tenantId"=source."tenantId" AND v.id=source."followUpTemplateVersionId")
) WHERE source."followUpTemplateId" IS NOT NULL OR source."followUpTemplateVersionId" IS NOT NULL;

UPDATE "ContactNote" source SET "retiredWorkflowSnapshot" = jsonb_build_object(
  'schemaVersion', 1, 'retiredAt', CURRENT_TIMESTAMP,
  'template', (SELECT jsonb_build_object('id',t.id,'name',t.name) FROM "ServiceFollowUpTemplate" t WHERE t."tenantId"=source."tenantId" AND t.id=source."followUpTemplateId"),
  'version', (SELECT jsonb_build_object('id',v.id,'versionNumber',v."versionNumber") FROM "ServiceFollowUpTemplateVersion" v WHERE v."tenantId"=source."tenantId" AND v.id=source."followUpTemplateVersionId")
) WHERE source."followUpTemplateId" IS NOT NULL OR source."followUpTemplateVersionId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "ServiceFollowUpTemplate" DROP CONSTRAINT "ServiceFollowUpTemplate_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "ServiceFollowUpTemplate" DROP CONSTRAINT "ServiceFollowUpTemplate_serviceId_fkey";

-- DropForeignKey
ALTER TABLE "ServiceFollowUpTemplate" DROP CONSTRAINT "ServiceFollowUpTemplate_activeVersionId_fkey";

-- DropForeignKey
ALTER TABLE "ServiceFollowUpTemplateVersion" DROP CONSTRAINT "ServiceFollowUpTemplateVersion_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "ServiceFollowUpTemplateVersion" DROP CONSTRAINT "ServiceFollowUpTemplateVersion_templateId_fkey";

-- DropForeignKey
ALTER TABLE "ServiceFollowUpTemplateVersion" DROP CONSTRAINT "ServiceFollowUpTemplateVersion_publishedById_fkey";

-- DropForeignKey
ALTER TABLE "ServiceFollowUpTemplateStep" DROP CONSTRAINT "ServiceFollowUpTemplateStep_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "ServiceFollowUpTemplateStep" DROP CONSTRAINT "ServiceFollowUpTemplateStep_serviceId_fkey";

-- DropForeignKey
ALTER TABLE "ServiceFollowUpTemplateStep" DROP CONSTRAINT "ServiceFollowUpTemplateStep_templateId_fkey";

-- DropForeignKey
ALTER TABLE "ContactService" DROP CONSTRAINT "ContactService_followUpTemplateId_fkey";

-- DropForeignKey
ALTER TABLE "ContactService" DROP CONSTRAINT "ContactService_followUpTemplateVersionId_fkey";

-- DropForeignKey
ALTER TABLE "ContactServiceFollowUpStep" DROP CONSTRAINT "ContactServiceFollowUpStep_runId_fkey";

-- DropForeignKey
ALTER TABLE "ContactServiceFollowUpRun" DROP CONSTRAINT "ContactServiceFollowUpRun_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "ContactServiceFollowUpRun" DROP CONSTRAINT "ContactServiceFollowUpRun_contactServiceId_fkey";

-- DropForeignKey
ALTER TABLE "ContactServiceFollowUpRun" DROP CONSTRAINT "ContactServiceFollowUpRun_templateVersionId_fkey";

-- DropForeignKey
ALTER TABLE "ContactServiceFollowUpRun" DROP CONSTRAINT "ContactServiceFollowUpRun_startedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "ServiceFollowUpNodeExecution" DROP CONSTRAINT "ServiceFollowUpNodeExecution_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "ServiceFollowUpNodeExecution" DROP CONSTRAINT "ServiceFollowUpNodeExecution_runId_fkey";

-- DropForeignKey
ALTER TABLE "ServiceFollowUpExecutionLog" DROP CONSTRAINT "ServiceFollowUpExecutionLog_templateId_fkey";

-- DropForeignKey
ALTER TABLE "ServiceFollowUpExecutionLog" DROP CONSTRAINT "ServiceFollowUpExecutionLog_templateVersionId_fkey";

-- DropForeignKey
ALTER TABLE "ServiceFollowUpExecutionLog" DROP CONSTRAINT "ServiceFollowUpExecutionLog_runId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_followUpTemplateId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_followUpTemplateVersionId_fkey";

-- DropForeignKey
ALTER TABLE "ContactNote" DROP CONSTRAINT "ContactNote_followUpTemplateId_fkey";

-- DropForeignKey
ALTER TABLE "ContactNote" DROP CONSTRAINT "ContactNote_followUpTemplateVersionId_fkey";

-- AlterTable


-- AlterTable


-- AlterTable


-- DropTable
DROP TABLE "ServiceFollowUpTemplate";

-- DropTable
DROP TABLE "ServiceFollowUpTemplateVersion";

-- DropTable
DROP TABLE "ServiceFollowUpTemplateStep";

-- DropTable
DROP TABLE "ContactServiceFollowUpRun";

-- DropTable
DROP TABLE "ServiceFollowUpNodeExecution";

-- DropEnum
DROP TYPE "FollowUpRunStatus";

-- DropEnum
DROP TYPE "FollowUpNodeExecutionStatus";


COMMIT;
