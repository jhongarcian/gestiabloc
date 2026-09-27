CREATE INDEX "AutomationRun_wait_monitoring_idx"
ON "AutomationRun"("tenantId", "automationId", "status", "waitingNodeKey", "resumeAt");
