-- Add draft/publish state to service follow-up templates
ALTER TABLE "ServiceFollowUpTemplate"
  ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "publishedAt" TIMESTAMP(3);
