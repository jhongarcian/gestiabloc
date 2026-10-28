CREATE TABLE "AutomationExecutionTenant" (
  "tenantId" TEXT NOT NULL PRIMARY KEY,
  "lastAdmittedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationExecutionTenant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AutomationRun_available_claim_idx" ON "AutomationRun"("status", "availableAt", "updatedAt");
CREATE INDEX "ContactServiceStep_owner_idx" ON "ContactServiceStep"("tenantId", "assignedToUserId");
