CREATE TYPE "OpportunityResult" AS ENUM ('OPEN', 'WON', 'LOST');

ALTER TABLE "ContactOpportunity"
ADD COLUMN "valueCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "result" "OpportunityResult" NOT NULL DEFAULT 'OPEN',
ADD COLUMN "closedAt" TIMESTAMP(3);
