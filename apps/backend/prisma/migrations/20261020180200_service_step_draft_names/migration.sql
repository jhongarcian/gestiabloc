-- Keep automatic names readable; preserve any draft already edited or published by an administrator.
DO $$
DECLARE
  draft RECORD;
  candidate TEXT;
  suffix INTEGER;
BEGIN
  FOR draft IN
    SELECT a."id", a."tenantId", s."title"
    FROM "Automation" a JOIN "ServiceStep" s ON s."id" = a."serviceStepId" AND s."tenantId" = a."tenantId"
    WHERE a."triggerType" = 'SERVICE_STEP_ENTERED' AND NOT a."isEnabled"
      AND a."name" = 'Step entered: ' || LEFT(s."title", 60) || ' · ' || s."id"
      AND NOT EXISTS (SELECT 1 FROM "AutomationAction" action WHERE action."automationId" = a."id")
    ORDER BY a."createdAt", a."id"
  LOOP
    suffix := 1;
    candidate := 'Step entered: ' || LEFT(draft."title", 84);
    WHILE EXISTS (SELECT 1 FROM "Automation" WHERE "tenantId" = draft."tenantId" AND "name" = candidate AND "id" <> draft."id") LOOP
      suffix := suffix + 1;
      candidate := 'Step entered: ' || LEFT(draft."title", 84) || ' (' || suffix || ')';
    END LOOP;
    UPDATE "Automation" SET "name" = candidate WHERE "id" = draft."id";
  END LOOP;
END $$;
