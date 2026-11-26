ALTER TABLE "AiInteraction"
  ADD COLUMN "reviewReason" TEXT,
  ADD COLUMN "reviewCiphertext" TEXT,
  ADD COLUMN "reviewIv" TEXT,
  ADD COLUMN "reviewAuthTag" TEXT,
  ADD COLUMN "reviewKeyVersion" INTEGER,
  ADD COLUMN "reviewExpiresAt" TIMESTAMP(3),
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedById" TEXT,
  ADD COLUMN "reviewRevision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "AiInteraction" ADD CONSTRAINT "ai_review_payload_complete" CHECK (
  ("reviewCiphertext" IS NULL AND "reviewIv" IS NULL AND "reviewAuthTag" IS NULL AND "reviewKeyVersion" IS NULL)
  OR ("questionOutcome" IS NOT NULL AND "questionOutcome" = 'NEEDS_REVIEW' AND "reviewCiphertext" IS NOT NULL AND "reviewIv" IS NOT NULL AND "reviewAuthTag" IS NOT NULL AND "reviewKeyVersion" = 1 AND "reviewExpiresAt" IS NOT NULL)
);
ALTER TABLE "AiInteraction" ADD CONSTRAINT "ai_review_actor_complete" CHECK (("reviewedAt" IS NULL) = ("reviewedById" IS NULL));
ALTER TABLE "AiInteraction" ADD CONSTRAINT "ai_review_revision_nonnegative" CHECK ("reviewRevision" >= 0);
CREATE INDEX "AiInteraction_tenantId_questionOutcome_createdAt_id_idx" ON "AiInteraction"("tenantId", "questionOutcome", "createdAt", "id");
CREATE INDEX "AiInteraction_reviewExpiresAt_idx" ON "AiInteraction"("reviewExpiresAt");
