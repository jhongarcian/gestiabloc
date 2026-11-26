ALTER TABLE "AiCreditRequest"
  ADD COLUMN "responseCiphertext" TEXT,
  ADD COLUMN "responseIv" TEXT,
  ADD COLUMN "responseAuthTag" TEXT,
  ADD COLUMN "responseKeyVersion" INTEGER,
  ADD COLUMN "responseExpiresAt" TIMESTAMP(3),
  ADD CONSTRAINT "AiCreditRequest_replay_check" CHECK (
    ("responseCiphertext" IS NULL AND "responseIv" IS NULL AND "responseAuthTag" IS NULL AND "responseKeyVersion" IS NULL AND "responseExpiresAt" IS NULL) OR
    ("status" = 'COMMITTED' AND "responseCiphertext" IS NOT NULL AND "responseIv" IS NOT NULL AND "responseAuthTag" IS NOT NULL AND "responseKeyVersion" IS NOT NULL AND "responseKeyVersion" = 1 AND "responseExpiresAt" IS NOT NULL)
  );
CREATE INDEX "AiCreditRequest_responseExpiresAt_idx" ON "AiCreditRequest"("responseExpiresAt");
CREATE INDEX "AiCreditRequest_status_expiresAt_idx" ON "AiCreditRequest"("status", "expiresAt");
