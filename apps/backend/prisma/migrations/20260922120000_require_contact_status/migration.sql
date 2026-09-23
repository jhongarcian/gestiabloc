-- Ensure every tenant has the three required contact statuses. Existing records
-- keep their configured colors and order, while the defaults remain available.
INSERT INTO "ContactStatusConfig" (
    "id",
    "tenantId",
    "name",
    "bgColor",
    "textColor",
    "sortOrder",
    "isActive",
    "isSystemDefault",
    "createdAt",
    "updatedAt"
)
SELECT
    md5(tenant."id" || ':contact-status:' || lower(default_status."name")),
    tenant."id",
    default_status."name",
    default_status."bgColor",
    default_status."textColor",
    default_status."sortOrder",
    true,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Tenant" AS tenant
CROSS JOIN (
    VALUES
        ('Active', '#DCFCE7', '#166534', 10),
        ('Inactive', '#E2E8F0', '#334155', 20),
        ('Pending', '#FEF3C7', '#92400E', 30)
) AS default_status("name", "bgColor", "textColor", "sortOrder")
ON CONFLICT ("tenantId", "name") DO UPDATE
SET
    "isActive" = true,
    "isSystemDefault" = true,
    "updatedAt" = CURRENT_TIMESTAMP;

-- Active is the default for every existing contact that did not have a status.
UPDATE "Contact" AS contact
SET "statusConfigId" = active_status."id"
FROM "ContactStatusConfig" AS active_status
WHERE
    contact."tenantId" = active_status."tenantId"
    AND active_status."name" = 'Active'
    AND contact."statusConfigId" IS NULL;

-- Preserve the intent of legacy clear-status actions by turning them into an
-- explicit reset to Active before removing the enum value.
UPDATE "AutomationAction" AS action
SET
    "type" = 'SET_CONTACT_STATUS',
    "statusConfigId" = active_status."id",
    "updatedAt" = CURRENT_TIMESTAMP
FROM "ContactStatusConfig" AS active_status
WHERE
    action."tenantId" = active_status."tenantId"
    AND active_status."name" = 'Active'
    AND action."type" = 'CLEAR_CONTACT_STATUS';

-- Manual automation processes keep a JSON snapshot of their actions, so update
-- queued and historical snapshots as well.
UPDATE "AutomationProcess" AS process
SET
    "actionSnapshot" = (
        SELECT jsonb_agg(
            CASE
                WHEN action_item."action"->>'type' = 'CLEAR_CONTACT_STATUS'
                    THEN action_item."action" || jsonb_build_object(
                        'type', 'SET_CONTACT_STATUS',
                        'statusConfigId', active_status."id"
                    )
                ELSE action_item."action"
            END
            ORDER BY action_item."position"
        )
        FROM jsonb_array_elements(
            CASE
                WHEN jsonb_typeof(process."actionSnapshot") = 'array'
                    THEN process."actionSnapshot"
                ELSE '[]'::jsonb
            END
        ) WITH ORDINALITY AS action_item("action", "position")
    ),
    "updatedAt" = CURRENT_TIMESTAMP
FROM "ContactStatusConfig" AS active_status
WHERE
    process."tenantId" = active_status."tenantId"
    AND active_status."name" = 'Active'
    AND jsonb_typeof(process."actionSnapshot") = 'array'
    AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
            CASE
                WHEN jsonb_typeof(process."actionSnapshot") = 'array'
                    THEN process."actionSnapshot"
                ELSE '[]'::jsonb
            END
        ) AS action_item("action")
        WHERE action_item."action"->>'type' = 'CLEAR_CONTACT_STATUS'
    );

ALTER TABLE "Contact"
ALTER COLUMN "statusConfigId" SET NOT NULL;

CREATE TYPE "AutomationActionType_new" AS ENUM (
    'SET_CONTACT_CUSTOM_FIELD',
    'CLEAR_CONTACT_CUSTOM_FIELD',
    'SET_CONTACT_STATUS',
    'SET_CONTACT_ASSIGNEE',
    'CLEAR_CONTACT_ASSIGNEE',
    'ADD_CONTACT_TAG',
    'REMOVE_CONTACT_TAG'
);

ALTER TABLE "AutomationAction"
ALTER COLUMN "type" TYPE "AutomationActionType_new"
USING ("type"::text::"AutomationActionType_new");

ALTER TYPE "AutomationActionType" RENAME TO "AutomationActionType_old";
ALTER TYPE "AutomationActionType_new" RENAME TO "AutomationActionType";
DROP TYPE "AutomationActionType_old";
