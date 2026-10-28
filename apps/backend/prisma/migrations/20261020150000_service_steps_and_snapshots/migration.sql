-- CreateEnum
CREATE TYPE "ServiceStepTimeUnit" AS ENUM ('MINUTES', 'HOURS', 'DAYS');

-- CreateEnum
CREATE TYPE "ServiceWorkflowKind" AS ENUM ('LEGACY_TEMPLATE', 'SERVICE_STEPS', 'NONE');

-- CreateEnum
CREATE TYPE "ServiceStepOccurrenceStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'SKIPPED', 'CANCELED');

-- AlterTable
ALTER TABLE "ContactService" ADD COLUMN     "assignedProfessionalSnapshot" JSONB,
ADD COLUMN     "configurationSnapshot" JSONB,
ADD COLUMN     "workflowKind" "ServiceWorkflowKind" NOT NULL DEFAULT 'LEGACY_TEMPLATE';

-- AlterTable
ALTER TABLE "ContactServiceChecklistItem" ADD COLUMN     "descriptionSnapshot" TEXT,
ADD COLUMN     "isRequiredSnapshot" BOOLEAN,
ADD COLUMN     "labelSnapshot" TEXT,
ADD COLUMN     "sortOrderSnapshot" INTEGER;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "stepsMode" "ServiceSectionMode" NOT NULL DEFAULT 'CUSTOM';

-- CreateTable
CREATE TABLE "ServiceStep" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "completionDuration" INTEGER NOT NULL DEFAULT 3,
    "completionUnit" "ServiceStepTimeUnit" NOT NULL DEFAULT 'DAYS',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactServiceStep" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactServiceId" TEXT NOT NULL,
    "sourceStepId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "completionDuration" INTEGER NOT NULL,
    "completionUnit" "ServiceStepTimeUnit" NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactServiceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceStepOccurrence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactServiceId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "entryKey" TEXT NOT NULL,
    "occurrenceNumber" INTEGER NOT NULL,
    "status" "ServiceStepOccurrenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "enteredAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolutionReason" TEXT,
    "enteredByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceStepOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceStep_configuration_idx" ON "ServiceStep"("tenantId", "serviceId", "archivedAt", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceStep_tenantId_id_key" ON "ServiceStep"("tenantId", "id");

-- CreateIndex
CREATE INDEX "ContactServiceStep_tenantId_contactServiceId_sortOrder_idx" ON "ContactServiceStep"("tenantId", "contactServiceId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ContactServiceStep_tenantId_contactServiceId_id_key" ON "ContactServiceStep"("tenantId", "contactServiceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ContactServiceStep_tenantId_contactServiceId_sourceStepId_key" ON "ContactServiceStep"("tenantId", "contactServiceId", "sourceStepId");

-- CreateIndex
CREATE INDEX "ServiceStepOccurrence_tenantId_contactServiceId_status_idx" ON "ServiceStepOccurrence"("tenantId", "contactServiceId", "status");

-- CreateIndex
CREATE INDEX "ServiceStepOccurrence_tenantId_status_dueAt_idx" ON "ServiceStepOccurrence"("tenantId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceStepOccurrence_tenantId_contactServiceId_entryKey_key" ON "ServiceStepOccurrence"("tenantId", "contactServiceId", "entryKey");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceStepOccurrence_tenantId_stepId_occurrenceNumber_key" ON "ServiceStepOccurrence"("tenantId", "stepId", "occurrenceNumber");

-- AddForeignKey
ALTER TABLE "ServiceStep" ADD CONSTRAINT "ServiceStep_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactServiceStep" ADD CONSTRAINT "ContactServiceStep_tenantId_contactServiceId_fkey" FOREIGN KEY ("tenantId", "contactServiceId") REFERENCES "ContactService"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceStepOccurrence" ADD CONSTRAINT "ServiceStepOccurrence_tenantId_contactServiceId_stepId_fkey" FOREIGN KEY ("tenantId", "contactServiceId", "stepId") REFERENCES "ContactServiceStep"("tenantId", "contactServiceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Invariants for the new service-step configuration and entry history.
ALTER TABLE "Service" ADD CONSTRAINT "Service_group_steps_custom_check" CHECK ("kind" <> 'GROUP' OR "stepsMode" = 'CUSTOM');
ALTER TABLE "ServiceStep" ADD CONSTRAINT "ServiceStep_duration_check" CHECK (
  "completionDuration" > 0 AND "completionDuration"::BIGINT * CASE "completionUnit" WHEN 'DAYS' THEN 1440 WHEN 'HOURS' THEN 60 ELSE 1 END <= 5256000);
ALTER TABLE "ContactServiceStep" ADD CONSTRAINT "ContactServiceStep_duration_check" CHECK (
  "completionDuration" > 0 AND "completionDuration"::BIGINT * CASE "completionUnit" WHEN 'DAYS' THEN 1440 WHEN 'HOURS' THEN 60 ELSE 1 END <= 5256000);
ALTER TABLE "ServiceStepOccurrence" ADD CONSTRAINT "ServiceStepOccurrence_dates_check" CHECK (
  "occurrenceNumber" > 0 AND "dueAt" >= "enteredAt" AND ("resolvedAt" IS NULL OR "resolvedAt" >= "enteredAt"));
CREATE UNIQUE INDEX "ServiceStepOccurrence_one_active_per_enrollment" ON "ServiceStepOccurrence"("tenantId", "contactServiceId") WHERE "status" = 'ACTIVE';

-- Freeze available legacy attribution and checklist details, preserving existing IDs,
-- statuses, timestamps, billing snapshots, and template execution history.
UPDATE "ContactServiceChecklistItem" item SET
  "labelSnapshot"=source."label", "descriptionSnapshot"=source."description",
  "isRequiredSnapshot"=source."isRequired", "sortOrderSnapshot"=source."sortOrder"
FROM "ServiceChecklistItem" source WHERE source."id"=item."checklistItemId" AND source."tenantId"=item."tenantId";

UPDATE "ContactService" cs SET "assignedProfessionalSnapshot"=jsonb_build_object(
  'id', p."id", 'kind', p."kind", 'userId', p."userId", 'externalProfessionalName', p."externalProfessionalName",
  'externalContact', p."externalContact", 'notes', p."notes", 'sortOrder', p."sortOrder",
  'user', CASE WHEN u."id" IS NULL THEN NULL ELSE jsonb_build_object('name',u."name",'email',u."email",'image',u."image") END)
FROM "ServiceProfessional" p LEFT JOIN "User" u ON u."id"=p."userId"
WHERE cs."assignedProfessionalId"=p."id" AND cs."tenantId"=p."tenantId";

UPDATE "ContactService" cs SET "workflowKind"='NONE'
WHERE cs."followUpTemplateId" IS NULL AND NOT EXISTS (SELECT 1 FROM "ContactServiceFollowUpStep" f WHERE f."contactServiceId"=cs."id");

UPDATE "ContactService" cs SET "configurationSnapshot"=jsonb_build_object(
  'schemaVersion',1, 'legacy',true,
  'service',jsonb_build_object('id',s."id",'name',s."name",'description',s."description",'parentServiceId',s."parentServiceId"),
  'workflowKind',cs."workflowKind", 'billing',cs."billingSnapshot", 'followUpTemplateVersionId',cs."followUpTemplateVersionId",
  'steps','[]'::jsonb,
  'checklistItems',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i."checklistItemId",'label',i."labelSnapshot",'description',i."descriptionSnapshot",'isRequired',i."isRequiredSnapshot",'sortOrder',i."sortOrderSnapshot") ORDER BY i."sortOrderSnapshot",i."createdAt") FROM "ContactServiceChecklistItem" i WHERE i."contactServiceId"=cs."id" AND i."tenantId"=cs."tenantId"),'[]'::jsonb),
  'professionals',COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id',p."id",'kind',p."kind",'userId',p."userId",'externalProfessionalName',p."externalProfessionalName",
    'externalContact',p."externalContact",'notes',p."notes",'sortOrder',p."sortOrder",
    'user',CASE WHEN u."id" IS NULL THEN NULL ELSE jsonb_build_object('name',u."name",'email',u."email",'image',u."image") END
  ) ORDER BY p."sortOrder",p."createdAt") FROM "ServiceProfessional" p LEFT JOIN "User" u ON u."id"=p."userId"
  WHERE p."tenantId"=cs."tenantId" AND p."archivedAt" IS NULL AND p."serviceId"=CASE WHEN s."professionalsMode"='INHERIT' THEN s."parentServiceId" ELSE s."id" END),'[]'::jsonb)
) FROM "Service" s WHERE s."id"=cs."serviceId" AND s."tenantId"=cs."tenantId";
