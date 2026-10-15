CREATE TABLE "AutomationNoteChainClaim" (
    "tenantId" TEXT NOT NULL,
    "chainId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationNoteChainClaim_pkey" PRIMARY KEY ("tenantId","chainId","automationId")
);

ALTER TABLE "AutomationNoteChainClaim" ADD CONSTRAINT "AutomationNoteChainClaim_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
