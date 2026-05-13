CREATE TABLE "OpportunityPipeline" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpportunityPipeline_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OpportunityPipelineStage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpportunityPipelineStage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OpportunityPipeline_tenantId_id_key"
ON "OpportunityPipeline"("tenantId", "id");

CREATE UNIQUE INDEX "OpportunityPipeline_tenantId_name_key"
ON "OpportunityPipeline"("tenantId", "name");

CREATE INDEX "OpportunityPipeline_tenantId_sortOrder_idx"
ON "OpportunityPipeline"("tenantId", "sortOrder");

CREATE UNIQUE INDEX "OpportunityPipelineStage_tenantId_id_key"
ON "OpportunityPipelineStage"("tenantId", "id");

CREATE UNIQUE INDEX "OpportunityPipelineStage_pipelineId_name_key"
ON "OpportunityPipelineStage"("pipelineId", "name");

CREATE INDEX "OpportunityPipelineStage_tenantId_pipelineId_sortOrder_idx"
ON "OpportunityPipelineStage"("tenantId", "pipelineId", "sortOrder");

ALTER TABLE "OpportunityPipeline"
ADD CONSTRAINT "OpportunityPipeline_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OpportunityPipelineStage"
ADD CONSTRAINT "OpportunityPipelineStage_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OpportunityPipelineStage"
ADD CONSTRAINT "OpportunityPipelineStage_pipelineId_fkey"
FOREIGN KEY ("pipelineId") REFERENCES "OpportunityPipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
