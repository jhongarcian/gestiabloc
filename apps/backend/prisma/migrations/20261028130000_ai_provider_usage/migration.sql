CREATE TABLE "AiProviderUsage" (
 "id" TEXT PRIMARY KEY, "logicalRequestId" TEXT NOT NULL, "tenantId" TEXT, "actorId" TEXT,
 "channel" TEXT NOT NULL, "purpose" TEXT NOT NULL, "provider" TEXT NOT NULL,
 "requestedModel" TEXT NOT NULL, "model" TEXT, "status" TEXT NOT NULL,
 "httpStatus" INTEGER, "durationMs" INTEGER NOT NULL, "inputTokens" INTEGER,
 "outputTokens" INTEGER, "cachedTokens" INTEGER, "reasoningTokens" INTEGER,
 "estimatedCostUsd" DECIMAL(20,9), "upperBoundCostUsd" DECIMAL(20,9),
 "rateVersion" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AiProviderUsage_tenantId_createdAt_idx" ON "AiProviderUsage"("tenantId", "createdAt");
CREATE INDEX "AiProviderUsage_logicalRequestId_idx" ON "AiProviderUsage"("logicalRequestId");
CREATE INDEX "AiProviderUsage_status_createdAt_idx" ON "AiProviderUsage"("status", "createdAt");
