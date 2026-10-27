-- CreateEnum
CREATE TYPE "AiActivityChannel" AS ENUM ('TEST', 'CONTACT_ASSISTANT');

-- CreateEnum
CREATE TYPE "AiQuestionOutcome" AS ENUM ('ANSWERED', 'NEEDS_REVIEW');

-- CreateTable
CREATE TABLE "AiInteraction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "channel" "AiActivityChannel" NOT NULL,
    "conversationId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "questionOutcome" "AiQuestionOutcome",
    "qualificationRun" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiInteraction_tenantId_createdAt_idx" ON "AiInteraction"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AiInteraction_tenantId_channel_createdAt_idx" ON "AiInteraction"("tenantId", "channel", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiInteraction_tenantId_actorId_channel_requestId_key" ON "AiInteraction"("tenantId", "actorId", "channel", "requestId");

-- AddForeignKey
ALTER TABLE "AiInteraction" ADD CONSTRAINT "AiInteraction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
