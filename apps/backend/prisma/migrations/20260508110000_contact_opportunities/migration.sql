CREATE TABLE "ContactOpportunity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactOpportunity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContactOpportunity_tenantId_id_key"
ON "ContactOpportunity"("tenantId", "id");

CREATE UNIQUE INDEX "ContactOpportunity_tenantId_contactId_pipelineId_key"
ON "ContactOpportunity"("tenantId", "contactId", "pipelineId");

CREATE INDEX "ContactOpportunity_tenantId_pipelineId_updatedAt_idx"
ON "ContactOpportunity"("tenantId", "pipelineId", "updatedAt");

CREATE INDEX "ContactOpportunity_tenantId_stageId_updatedAt_idx"
ON "ContactOpportunity"("tenantId", "stageId", "updatedAt");

CREATE INDEX "ContactOpportunity_tenantId_contactId_updatedAt_idx"
ON "ContactOpportunity"("tenantId", "contactId", "updatedAt");

ALTER TABLE "ContactOpportunity"
ADD CONSTRAINT "ContactOpportunity_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactOpportunity"
ADD CONSTRAINT "ContactOpportunity_contactId_fkey"
FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactOpportunity"
ADD CONSTRAINT "ContactOpportunity_pipelineId_fkey"
FOREIGN KEY ("pipelineId") REFERENCES "OpportunityPipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactOpportunity"
ADD CONSTRAINT "ContactOpportunity_stageId_fkey"
FOREIGN KEY ("stageId") REFERENCES "OpportunityPipelineStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
