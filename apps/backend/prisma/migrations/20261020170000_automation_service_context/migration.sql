-- Immutable enrollment attribution; null preserves existing contact-only automation behavior.
-- Intentionally no live foreign keys: execution history survives source record deletion.
ALTER TABLE "AutomationEvent" ADD COLUMN "serviceContext" JSONB;
ALTER TABLE "AutomationRun" ADD COLUMN "serviceContext" JSONB;
ALTER TABLE "AutomationNodeExecution" ADD COLUMN "serviceContext" JSONB;
ALTER TABLE "AutomationExecution" ADD COLUMN "serviceContext" JSONB;
