-- PostgreSQL requires new enum values to be committed before later migrations use them.
ALTER TYPE "AutomationTriggerType" ADD VALUE 'OPPORTUNITY_CHANGED';
ALTER TYPE "AutomationNodeEventSource" ADD VALUE 'OPPORTUNITY_CHANGED';
