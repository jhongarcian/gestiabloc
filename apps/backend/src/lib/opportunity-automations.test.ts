import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  AutomationUpsertSchema,
  AutomationDeleteOpportunityConfigSchema,
  AutomationAddToWorkflowConfigSchema,
  AutomationRemoveFromWorkflowConfigSchema,
  AutomationInternalNotificationConfigSchema,
  AutomationOpportunityConfigSchema,
  AutomationExecutionError,
  automationActionContinuation,
  automationWorkflowReferenceIds,
  automationWorkflowTargetIds,
  automationSplitBucket,
  evaluateAutomationOperator,
  executeAutomationSegmentTx,
  executeCreateContactAction,
  executeOpportunityAutomations,
  getAutomationOperatorsForFieldType,
  recordAutomationFailure,
  resumeDueAutomationRuns,
  deleteAutomationContactFileObjects,
  validateAutomationGoToControlFlow,
  validateAutomationConfiguration,
} from "./opportunity-automations.js"

describe("Internal notification automation action", () => {
  const baseConfig = {
    actionName: "Notify owner",
    recipient: { mode: "SPECIFIC_USER" as const, userId: "user-active" },
    titleTemplate: "Review {contact.name}",
    bodyTemplate: "Prepared on {automation.prepared_date}",
  }

  test("validates templates and tenant-scoped active recipients", async () => {
    assert.equal(AutomationInternalNotificationConfigSchema.safeParse(baseConfig).success, true)
    assert.equal(AutomationInternalNotificationConfigSchema.safeParse({
      ...baseConfig,
      actionName: " ",
    }).success, false)

    const prismaClient = {
      opportunityPipeline: { findUnique: async () => ({ id: "pipeline-1", stages: [] }) },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [] },
      membership: { findMany: async () => [
        { userId: "user-active", status: "ACTIVE" },
        { userId: "user-disabled", status: "DISABLED" },
      ] },
      tenantTag: { findMany: async () => [] },
    }
    const formatter = {
      type: "FORMAT_DATE_TIME" as const,
      dateTimeFormatterConfig: {
        mode: "DATE" as const,
        source: { type: "CURRENT_DATE" as const },
        format: "MMM D, YYYY" as const,
        outputKey: "prepared_date",
      },
    }
    const notification = {
      type: "SEND_INTERNAL_NOTIFICATION" as const,
      internalNotificationConfig: baseConfig,
    }
    const valid = AutomationUpsertSchema.parse({
      name: "Notify teammate",
      isEnabled: false,
      trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      conditions: [],
      actions: [formatter, notification],
    })
    const normalized = await validateAutomationConfiguration(prismaClient, "tenant-1", valid)
    assert.equal(
      (normalized.actions[1] as any).internalNotificationConfig.actionName,
      "Notify owner",
    )

    const unavailableRecipient = AutomationUpsertSchema.parse({
      ...valid,
      actions: [formatter, {
        ...notification,
        internalNotificationConfig: {
          ...baseConfig,
          recipient: { mode: "SPECIFIC_USER", userId: "user-disabled" },
        },
      }],
    })
    await assert.rejects(
      validateAutomationConfiguration(prismaClient, "tenant-1", unavailableRecipient),
      /Select an active teammate/,
    )

    const forwardReference = AutomationUpsertSchema.parse({
      ...valid,
      actions: [notification, formatter],
    })
    await assert.rejects(
      validateAutomationConfiguration(prismaClient, "tenant-1", forwardReference),
      /not available before this action/,
    )
  })

  test("uses an assignee set by an earlier action and returns a durable notification", async () => {
    let assignedToUserId: string | null = null
    let createdNotification: Record<string, any> | null = null
    let nodeLogs: Array<Record<string, any>> = []
    const prismaTx = {
      automation: {
        findMany: async () => [{
          id: "automation-1",
          name: "Owner review",
          triggerType: "OPPORTUNITY_CREATED",
          pipelineId: "pipeline-work",
          targetStageId: null,
          conditions: [],
          actions: [
            {
              nodeKey: "00000000-0000-4000-8000-000000000001",
              type: "SET_CONTACT_ASSIGNEE",
              assignedUserId: "user-jane",
            },
            {
              nodeKey: "00000000-0000-4000-8000-000000000002",
              type: "SEND_INTERNAL_NOTIFICATION",
              internalNotificationConfig: {
                actionName: "Notify owner",
                recipient: { mode: "CONTACT_ASSIGNEE" },
                titleTemplate: "Review {contact.name}",
                bodyTemplate: "Email {contact.email}",
              },
            },
          ],
        }],
      },
      contact: {
        findFirst: async (args: { select?: Record<string, unknown> }) => {
          if (args.select?.assignedToUserId && Object.keys(args.select).length === 1) {
            return { assignedToUserId }
          }
          return {
            id: "contact-1",
            firstName: "Taylor",
            middleName: null,
            lastName: "Reed",
            email: "taylor@example.com",
            statusConfigId: "active",
            assignedToUserId,
            statusConfig: { name: "Active" },
            assignedToMembership: assignedToUserId
              ? { user: { name: "Jane Smith", email: "jane@example.com" } }
              : null,
            tags: [],
            customFieldValues: [],
          }
        },
        update: async ({ data }: { data: { assignedToUserId?: string | null } }) => {
          if ("assignedToUserId" in data) assignedToUserId = data.assignedToUserId ?? null
        },
      },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [{ id: "active", name: "Active" }] },
      membership: {
        findMany: async () => [{
          userId: "user-jane",
          user: { name: "Jane Smith", email: "jane@example.com" },
        }],
        findUnique: async () => ({ status: "ACTIVE" }),
      },
      tenantTag: { findMany: async () => [] },
      opportunityPipeline: {
        findMany: async () => [{ id: "pipeline-work", name: "Work", stages: [] }],
      },
      notification: {
        upsert: async ({ create }: { create: Record<string, any> }) => {
          createdNotification = create
          return { id: "notification-1" }
        },
      },
      automationRun: {
        create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "run-1", ...data }),
        update: async () => undefined,
      },
      automationExecution: { create: async () => undefined },
      automationNodeExecution: {
        createMany: async ({ data }: { data: Array<Record<string, any>> }) => { nodeLogs = data },
      },
    }

    const result = await executeOpportunityAutomations(prismaTx, {
      tenantId: "tenant-1",
      actorUserId: "user-1",
      triggerType: "OPPORTUNITY_CREATED",
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-work",
      valueCents: 0,
      sourceStageId: null,
      targetStageId: "stage-new",
    })

    assert.deepEqual(result.notificationIds, ["notification-1"])
    assert.equal(assignedToUserId, "user-jane")
    const notificationRecord = createdNotification as Record<string, any> | null
    assert.ok(notificationRecord)
    assert.equal(notificationRecord.userId, "user-jane")
    assert.equal(notificationRecord.contactId, "contact-1")
    assert.equal(notificationRecord.type, "AUTOMATION_NOTIFICATION")
    assert.equal(notificationRecord.title, "Review Taylor Reed")
    assert.equal(notificationRecord.body, "Email taylor@example.com")
    assert.match(String(notificationRecord.eventKey), /^automation-notification:run-1:/)
    assert.equal(nodeLogs[2]?.details, "Sent internal notification “Review Taylor Reed” to Jane Smith.")
  })

  test("fails when the contact has no active assignee", async () => {
    await assert.rejects(
      executeAutomationSegmentTx({
        contact: {
          findFirst: async () => ({ assignedToUserId: null }),
        },
      }, {
        run: {
          id: "run-1",
          tenantId: "tenant-1",
          automationId: "automation-1",
          automationName: "Owner review",
          triggerType: "OPPORTUNITY_CREATED",
          contactId: "contact-1",
          contactName: "Taylor Reed",
          actorUserId: null,
          opportunityId: "opportunity-1",
          sourceStageId: null,
          targetStageId: null,
          attemptId: "attempt-1",
          eventSource: "OPPORTUNITY_CREATED",
          variables: {},
          eventContext: {},
        } as any,
        actions: [{
          nodeKey: "00000000-0000-4000-8000-000000000001",
          type: "SEND_INTERNAL_NOTIFICATION",
          internalNotificationConfig: {
            actionName: "Notify owner",
            recipient: { mode: "CONTACT_ASSIGNEE" },
            titleTemplate: "Review contact",
            bodyTemplate: null,
          },
        }] as any,
        catalog: {
          fieldMap: new Map(),
          fieldKeyMap: new Map(),
          activeStatusIds: new Set(),
          activeTaskStatusIds: new Set(),
          taskStatusMap: new Map(),
          activeUserIds: new Set(),
          tagIds: new Set(),
          statusMap: new Map(),
          userMap: new Map(),
          tagMap: new Map(),
          pipelineMap: new Map(),
          stageMap: new Map(),
          stagePipelineMap: new Map(),
          timezone: "America/Chicago",
        },
        startIndex: 0,
      }),
      /does not have an active assignee/,
    )
  })
})

describe("validateAutomationGoToControlFlow", () => {
  const split = (routes: Array<{ branchKey: string; name: string; actions: any[] }>) => ({
    nodeKey: "split-root",
    type: "SPLIT",
    splitConfig: { actionName: "Split", routes: routes.map((route) => ({ ...route, percentage: 50 })) },
  })

  test("allows a terminal cross-route jump into the middle of another route", () => {
    assert.doesNotThrow(() => validateAutomationGoToControlFlow([
      split([
        {
          branchKey: "route-a",
          name: "Route A",
          actions: [{ nodeKey: "go", type: "GO_TO", goToConfig: { targetNodeKey: "target" } }],
        },
        {
          branchKey: "route-b",
          name: "Route B",
          actions: [
            { nodeKey: "bypassed", type: "CLEAR_CONTACT_ASSIGNEE" },
            { nodeKey: "target", type: "SET_CONTACT_STATUS" },
          ],
        },
      ]),
    ]))
  })

  test("includes Default actions as Go To targets and rejects cycles through Default", () => {
    const routingAction = {
      nodeKey: "if-root",
      type: "IF_ELSE",
      ifElseConfig: {
        branches: [
          { branchKey: "matched", isDefault: false, actions: [{ nodeKey: "go", type: "GO_TO", goToConfig: { targetNodeKey: "default-action" } }] },
          { branchKey: "default", isDefault: true, actions: [{ nodeKey: "default-action", type: "CLEAR_CONTACT_ASSIGNEE" }] },
        ],
      },
    }
    assert.doesNotThrow(() => validateAutomationGoToControlFlow([routingAction]))
    routingAction.ifElseConfig.branches[1]!.actions = [{
      nodeKey: "default-action",
      type: "GO_TO",
      goToConfig: { targetNodeKey: "go" },
    }]
    assert.throws(
      () => validateAutomationGoToControlFlow([routingAction]),
      (error: any) => error?.code === "AUTOMATION_FLOW_CYCLE",
    )
  })

  test("rejects same-path backward jumps and multi-node cycles", () => {
    assert.throws(
      () => validateAutomationGoToControlFlow([
        { nodeKey: "first", type: "CLEAR_CONTACT_ASSIGNEE" },
        { nodeKey: "go", type: "GO_TO", goToConfig: { targetNodeKey: "first" } },
      ]),
      (error: any) => error?.code === "AUTOMATION_FLOW_CYCLE",
    )
    assert.throws(
      () => validateAutomationGoToControlFlow([
        split([
          { branchKey: "route-a", name: "Route A", actions: [{ nodeKey: "go-a", type: "GO_TO", goToConfig: { targetNodeKey: "go-b" } }] },
          { branchKey: "route-b", name: "Route B", actions: [{ nodeKey: "go-b", type: "GO_TO", goToConfig: { targetNodeKey: "go-a" } }] },
        ]),
      ]),
      (error: any) => error?.code === "AUTOMATION_FLOW_CYCLE",
    )
  })

  test("rejects a jump that bypasses a required automation value", () => {
    assert.throws(
      () => validateAutomationGoToControlFlow([
        split([
          {
            branchKey: "route-a",
            name: "Route A",
            actions: [{ nodeKey: "go", type: "GO_TO", goToConfig: { targetNodeKey: "note" } }],
          },
          {
            branchKey: "route-b",
            name: "Route B",
            actions: [
              { nodeKey: "formatter", type: "FORMAT_TEXT", textFormatterConfig: { outputKey: "lead_name" } },
              { nodeKey: "note", type: "ADD_CONTACT_NOTE", noteTitle: "Lead", noteBody: "{automation.lead_name}" },
            ],
          },
        ]),
      ]),
      (error: any) => error?.code === "GO_TO_VALUE_UNAVAILABLE",
    )

    assert.throws(
      () => validateAutomationGoToControlFlow([
        split([
          {
            branchKey: "route-a",
            name: "Route A",
            actions: [{ nodeKey: "go", type: "GO_TO", goToConfig: { targetNodeKey: "create-contact" } }],
          },
          {
            branchKey: "route-b",
            name: "Route B",
            actions: [
              { nodeKey: "formatter", type: "FORMAT_TEXT", textFormatterConfig: { outputKey: "lead_name" } },
              {
                nodeKey: "create-contact",
                type: "CREATE_CONTACT",
                createContactConfig: {
                  actionName: "Create contact",
                  firstNameTemplate: "{automation.lead_name}",
                  lastNameTemplate: "Household",
                  statusConfigId: "active",
                  customFieldValues: [],
                },
              },
            ],
          },
        ]),
      ]),
      (error: any) => error?.code === "GO_TO_VALUE_UNAVAILABLE",
    )
  })
})

describe("Create contact automation action", () => {
  const customFields = [
    {
      id: "field-note",
      key: "new_contact_note",
      label: "New contact note",
      fieldType: "TEXT" as const,
      isRequired: false,
      isActive: true,
      isEncrypted: false,
      isSensitive: false,
      options: [],
    },
    {
      id: "field-score",
      key: "lead_score",
      label: "Lead score",
      fieldType: "NUMBER" as const,
      isRequired: false,
      isActive: true,
      isEncrypted: false,
      isSensitive: false,
      options: [],
    },
  ]

  const config = {
    actionName: "Create household contact",
    firstNameTemplate: "{contact.first_name}",
    middleNameTemplate: "",
    lastNameTemplate: "Household",
    emailTemplate: "new@example.com",
    phoneTemplate: "+15551234567",
    dateOfBirth: { type: "FIXED" as const, value: "1990-05-03" },
    statusConfigId: "active",
    assignedToUserId: "user-1",
    customFieldValues: [
      {
        customFieldId: "field-note",
        source: { type: "TEMPLATE" as const, template: "Created for {contact.first_name}" },
      },
      {
        customFieldId: "field-score",
        source: { type: "FIXED" as const, value: 42 },
      },
    ],
  }

  test("validates tenant fields, status, templates, and fixed typed values", async () => {
    const prismaClient = {
      opportunityPipeline: { findUnique: async () => ({ id: "pipeline-1", stages: [] }) },
      contactCustomField: { findMany: async () => customFields },
      contactStatusConfig: { findMany: async () => [{ id: "active", isActive: true }] },
      membership: { findMany: async () => [{ userId: "user-1", status: "ACTIVE" }] },
      tenantTag: { findMany: async () => [] },
    }
    const input = AutomationUpsertSchema.parse({
      name: "Create related record",
      isEnabled: false,
      trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      conditions: [],
      actions: [{ type: "CREATE_CONTACT", createContactConfig: config }],
    })
    const normalized = await validateAutomationConfiguration(prismaClient, "tenant-1", input)
    assert.equal((normalized.actions[0] as any).createContactConfig.actionName, "Create household contact")
    assert.equal((normalized.actions[0] as any).createContactConfig.assignedToUserId, "user-1")
    assert.equal((normalized.actions[0] as any).createContactConfig.customFieldValues[1].source.value, 42)

    const invalid = AutomationUpsertSchema.parse({
      ...input,
      actions: [{
        type: "CREATE_CONTACT",
        createContactConfig: {
          ...config,
          customFieldValues: [{
            customFieldId: "field-score",
            source: { type: "FIXED", value: "not a number" },
          }],
        },
      }],
    })
    await assert.rejects(
      validateAutomationConfiguration(prismaClient, "tenant-1", invalid),
      /Lead score must be a number/,
    )

    const invalidAssignee = AutomationUpsertSchema.parse({
      ...input,
      actions: [{
        type: "CREATE_CONTACT",
        createContactConfig: { ...config, assignedToUserId: "inactive-user" },
      }],
    })
    await assert.rejects(
      validateAutomationConfiguration(prismaClient, "tenant-1", invalidAssignee),
      /active tenant member for the new contact/,
    )
  })

  test("creates the contact and typed custom values while keeping the source context", async () => {
    const createdContacts: Array<Record<string, any>> = []
    const customWrites: Array<Record<string, any>> = []
    const lockKeys: string[] = []
    const lockQueries: string[] = []
    const prismaTx = {
      $queryRaw: async (parts: TemplateStringsArray, _namespace: string, lockKey: string) => {
        lockKeys.push(lockKey)
        lockQueries.push(parts.join("?"))
        return [{ lockAcquired: 1 }]
      },
      contact: {
        findFirst: async ({ where }: { where: Record<string, any> }) => {
          if (where.OR) return null
          return {
            id: "source-contact",
            firstName: "Taylor",
            middleName: null,
            lastName: "Reed",
            customFieldValues: [],
          }
        },
        create: async ({ data }: { data: Record<string, any> }) => {
          createdContacts.push(data)
          return { id: "new-contact" }
        },
      },
      contactCustomField: { findMany: async () => customFields },
      contactCustomFieldValue: {
        createMany: async ({ data }: { data: Array<Record<string, any>> }) => {
          customWrites.push(...data)
        },
      },
    }
    const fieldMap = new Map(customFields.map((field) => [field.id, field]))
    const result = await executeCreateContactAction(prismaTx, {
      config,
      tenantId: "tenant-1",
      sourceContactId: "source-contact",
      catalog: {
        fieldMap,
        fieldKeyMap: new Map(customFields.map((field) => [field.key, field])),
        activeStatusIds: new Set(["active"]),
        activeTaskStatusIds: new Set(),
        taskStatusMap: new Map(),
        activeUserIds: new Set(["user-1"]),
        tagIds: new Set(),
        statusMap: new Map([["active", "Active"]]),
        userMap: new Map(),
        tagMap: new Map(),
        pipelineMap: new Map(),
        stageMap: new Map(),
        stagePipelineMap: new Map(),
        timezone: "America/Chicago",
      },
      occurredAt: new Date("2026-10-02T12:00:00.000Z"),
      automationValues: {},
    })

    assert.equal(result, "Created contact “Taylor Household”.")
    assert.equal(createdContacts.length, 1)
    assert.equal(createdContacts[0]?.email, "new@example.com")
    assert.equal(createdContacts[0]?.phone, "+15551234567")
    assert.equal(createdContacts[0]?.dateOfBirth.toISOString(), "1990-05-03T12:00:00.000Z")
    assert.equal(createdContacts[0]?.assignedToUserId, "user-1")
    assert.deepEqual(customWrites.map((item) => [item.fieldId, item.value]), [
      ["field-note", "Created for Taylor"],
      ["field-score", 42],
    ])
    assert.deepEqual(lockKeys, [
      "tenant-1:email:new@example.com",
      "tenant-1:phone:+15551234567",
    ])
    assert.equal(lockQueries.length, 2)
    assert.match(lockQueries[0]!, /SELECT 1 AS "lockAcquired"\s+FROM advisory_lock/)
    assert.doesNotMatch(lockQueries[0]!, /^\s*SELECT pg_advisory_xact_lock/)
  })

  test("skips successfully when the rendered email already belongs to a tenant contact", async () => {
    let creates = 0
    const duplicateWheres: Array<Record<string, any>> = []
    const prismaTx = {
      $queryRaw: async () => [],
      contact: {
        findFirst: async ({ where }: { where: Record<string, any> }) => {
          if (where.OR) {
            duplicateWheres.push(where)
            return { email: "NEW@EXAMPLE.COM", phone: null }
          }
          return {
            id: "source-contact",
            firstName: "Taylor",
            middleName: null,
            lastName: "Reed",
            customFieldValues: [],
          }
        },
        create: async () => { creates += 1; return { id: "new-contact" } },
      },
      contactCustomField: { findMany: async () => customFields },
      contactCustomFieldValue: { createMany: async () => undefined },
    }
    const fieldMap = new Map(customFields.map((field) => [field.id, field]))
    const result = await executeCreateContactAction(prismaTx, {
      config,
      tenantId: "tenant-1",
      sourceContactId: "source-contact",
      catalog: {
        fieldMap,
        fieldKeyMap: new Map(customFields.map((field) => [field.key, field])),
        activeStatusIds: new Set(["active"]),
        activeTaskStatusIds: new Set(),
        taskStatusMap: new Map(),
        activeUserIds: new Set(["user-1"]),
        tagIds: new Set(),
        statusMap: new Map(),
        userMap: new Map(),
        tagMap: new Map(),
        pipelineMap: new Map(),
        stageMap: new Map(),
        stagePipelineMap: new Map(),
        timezone: "America/Chicago",
      },
      occurredAt: new Date("2026-10-02T12:00:00.000Z"),
      automationValues: {},
    })

    assert.equal(result, "Skipped creating contact because the email already belongs to a contact.")
    assert.equal(creates, 0)
    assert.deepEqual(duplicateWheres[0]?.OR?.[0], {
      email: { equals: "new@example.com", mode: "insensitive" },
    })
  })

  test("fails before creation when the configured assignee is no longer active", async () => {
    await assert.rejects(
      executeCreateContactAction({}, {
        config,
        tenantId: "tenant-1",
        sourceContactId: "source-contact",
        catalog: {
          fieldMap: new Map(),
          fieldKeyMap: new Map(),
          activeStatusIds: new Set(["active"]),
          activeTaskStatusIds: new Set(),
          taskStatusMap: new Map(),
          activeUserIds: new Set(),
          tagIds: new Set(),
          statusMap: new Map(),
          userMap: new Map(),
          tagMap: new Map(),
          pipelineMap: new Map(),
          stageMap: new Map(),
          stagePipelineMap: new Map(),
          timezone: "America/Chicago",
        },
        occurredAt: new Date("2026-10-02T12:00:00.000Z"),
        automationValues: {},
      }),
      /contact assignee is no longer available/,
    )
  })
})

describe("If/Else Default runtime", () => {
  test("preserves a nested Default path when continuing after a Wait", () => {
    const actions = [{
      nodeKey: "outer-if",
      type: "IF_ELSE",
      ifElseConfig: {
        actionName: "Outer",
        branches: [
          { branchKey: "outer-match", name: "Match", isDefault: false, matchMode: "ALL", conditions: [], actions: [] },
          {
            branchKey: "outer-default",
            name: "Default",
            isDefault: true,
            matchMode: "ALL",
            conditions: [],
            actions: [
              { nodeKey: "default-wait", type: "WAIT", waitConfig: { mode: "DURATION", amount: 30, unit: "MINUTES" } },
              {
                nodeKey: "inner-if",
                type: "IF_ELSE",
                ifElseConfig: {
                  actionName: "Inner",
                  branches: [
                    { branchKey: "inner-match", name: "Match", isDefault: false, matchMode: "ALL", conditions: [], actions: [] },
                    { branchKey: "inner-default", name: "Default", isDefault: true, matchMode: "ALL", conditions: [], actions: [{ nodeKey: "after-wait", type: "CLEAR_CONTACT_ASSIGNEE" }] },
                  ],
                },
              },
            ],
          },
        ],
      },
    }]
    const decisions = {
      "outer-if": { branchKey: "outer-default", branchName: "Default", decidedAt: "2026-10-02T12:00:00.000Z" },
      "inner-if": { branchKey: "inner-default", branchName: "Default", decidedAt: "2026-10-02T12:00:00.000Z" },
    }

    assert.deepEqual(
      automationActionContinuation(actions as any, decisions, "inner-if").map((step) => step.action.nodeKey),
      ["inner-if", "after-wait"],
    )
  })

  test("executes Default actions and logs unselected condition actions as skipped", async () => {
    const actions = [{
      nodeKey: "if-else-node",
      type: "IF_ELSE" as const,
      ifElseConfig: {
        actionName: "Route contact",
        branches: [
          {
            branchKey: "condition-branch",
            name: "Matched",
            isDefault: false,
            matchMode: "ALL" as const,
            conditions: [{ conditionKey: "never-match", source: "CURRENT_DATE_TIME" as const, operator: "IS_EMPTY" as const }],
            actions: [{ nodeKey: "unselected-action", type: "CLEAR_CONTACT_ASSIGNEE" as const }],
          },
          {
            branchKey: "default-branch",
            name: "Default",
            isDefault: true,
            matchMode: "ALL" as const,
            conditions: [],
            actions: [
              { nodeKey: "default-first", type: "CLEAR_CONTACT_ASSIGNEE" as const },
              { nodeKey: "default-second", type: "CLEAR_CONTACT_ASSIGNEE" as const },
            ],
          },
        ],
      },
    }]
    let contactUpdates = 0
    const emptyMap = new Map()
    const result = await executeAutomationSegmentTx({
      contact: { update: async () => { contactUpdates += 1 } },
      automationRun: { update: async () => undefined },
      automationExecution: { create: async () => undefined },
    }, {
      run: {
        id: "default-run",
        tenantId: "tenant-1",
        automationId: "automation-1",
        automationName: "Default test",
        contactId: "contact-1",
        contactName: "Taylor Reed",
        actorUserId: "user-1",
        opportunityId: "opportunity-1",
        attemptId: "attempt-1",
        eventSource: "OPPORTUNITY_CREATED",
        triggerType: "OPPORTUNITY_CREATED",
        sourceStageId: null,
        targetStageId: null,
        cursorIndex: 0,
        cursorPath: null,
        branchDecisions: {},
        variables: {},
      },
      actions: actions as any,
      startIndex: 0,
      catalog: {
        fieldMap: emptyMap,
        fieldKeyMap: emptyMap,
        activeStatusIds: new Set(),
        activeTaskStatusIds: new Set(),
        taskStatusMap: emptyMap,
        activeUserIds: new Set(),
        tagIds: new Set(),
        statusMap: emptyMap,
        userMap: emptyMap,
        tagMap: emptyMap,
        pipelineMap: emptyMap,
        stageMap: emptyMap,
        stagePipelineMap: emptyMap,
        timezone: "America/Chicago",
      },
    })

    assert.equal(result.status, "SUCCEEDED")
    assert.equal(contactUpdates, 2)
    assert.equal(result.logs.find((log) => log.nodeKey === "if-else-node")?.reasonCode, "DEFAULT_BRANCH_SELECTED")
    assert.equal(result.logs.find((log) => log.nodeKey === "unselected-action")?.reasonCode, "BRANCH_NOT_SELECTED")
    assert.equal(result.logs.find((log) => log.nodeKey === "default-first")?.status, "EXECUTED")
    assert.equal(result.logs.find((log) => log.nodeKey === "default-second")?.status, "EXECUTED")
    assert.equal(result.logs.find((log) => log.nodeKey === "default-first")?.branchPath?.[0]?.branchName, "Default")
  })
})

describe("Go To runtime", () => {
  test("enters the exact destination and continues without executing earlier destination actions", async () => {
    const runId = "run-go-to"
    const splitNodeKey = "split-node"
    const sourceRoute = {
      branchKey: "source-route",
      name: "Source route",
      percentage: 50,
      actions: [{ nodeKey: "go-node", type: "GO_TO" as const, goToConfig: { targetNodeKey: "target-node" } }],
    }
    const destinationRoute = {
      branchKey: "destination-route",
      name: "Destination route",
      percentage: 50,
      actions: [
        { nodeKey: "bypassed-node", type: "CLEAR_CONTACT_ASSIGNEE" as const },
        { nodeKey: "target-node", type: "CLEAR_CONTACT_ASSIGNEE" as const },
        { nodeKey: "after-target-node", type: "CLEAR_CONTACT_ASSIGNEE" as const },
      ],
    }
    const sourceFirst = automationSplitBucket(runId, splitNodeKey) <= 50
    const actions = [{
      nodeKey: splitNodeKey,
      type: "SPLIT" as const,
      splitConfig: {
        actionName: "Split",
        routes: sourceFirst ? [sourceRoute, destinationRoute] : [destinationRoute, sourceRoute],
      },
    }]
    let contactUpdates = 0
    let savedRun: Record<string, unknown> | null = null
    const prismaTx = {
      contact: { update: async () => { contactUpdates += 1 } },
      automationRun: { update: async ({ data }: { data: Record<string, unknown> }) => { savedRun = data } },
      automationExecution: { create: async () => undefined },
    }
    const emptyMap = new Map()
    const result = await executeAutomationSegmentTx(prismaTx, {
      run: {
        id: runId,
        tenantId: "tenant-1",
        automationId: "automation-1",
        automationName: "Go To test",
        contactId: "contact-1",
        contactName: "Taylor Reed",
        actorUserId: "user-1",
        opportunityId: "opportunity-1",
        attemptId: "attempt-1",
        eventSource: "OPPORTUNITY_CREATED",
        triggerType: "OPPORTUNITY_CREATED",
        sourceStageId: null,
        targetStageId: null,
        cursorIndex: 0,
        cursorPath: null,
        branchDecisions: {},
        variables: {},
      },
      actions: actions as any,
      startIndex: 0,
      catalog: {
        fieldMap: emptyMap,
        fieldKeyMap: emptyMap,
        activeStatusIds: new Set(),
        activeTaskStatusIds: new Set(),
        taskStatusMap: emptyMap,
        activeUserIds: new Set(),
        tagIds: new Set(),
        statusMap: emptyMap,
        userMap: emptyMap,
        tagMap: emptyMap,
        pipelineMap: emptyMap,
        stageMap: emptyMap,
        stagePipelineMap: emptyMap,
        timezone: "America/Chicago",
      },
    })

    assert.equal(result.status, "SUCCEEDED")
    assert.equal(contactUpdates, 2)
    assert.equal(result.logs.find((log) => log.nodeKey === "go-node")?.reasonCode, "GO_TO_ROUTED")
    assert.equal(result.logs.find((log) => log.nodeKey === "bypassed-node")?.reasonCode, "GO_TO_BYPASSED")
    assert.equal(result.logs.find((log) => log.nodeKey === "target-node")?.status, "EXECUTED")
    assert.equal((savedRun as Record<string, unknown> | null)?.status, "SUCCEEDED")
  })
})

describe("Update/create opportunity runtime", () => {
  const emptyMap = new Map()
  const catalog = {
    fieldMap: emptyMap,
    fieldKeyMap: emptyMap,
    activeStatusIds: new Set<string>(),
    activeTaskStatusIds: new Set<string>(),
    taskStatusMap: emptyMap,
    activeUserIds: new Set<string>(),
    tagIds: new Set<string>(),
    statusMap: emptyMap,
    userMap: emptyMap,
    tagMap: emptyMap,
    pipelineMap: new Map([["pipeline-1", "Work"]]),
    stageMap: new Map([["stage-1", "New"], ["stage-2", "Follow-up"]]),
    stagePipelineMap: new Map([["stage-1", "pipeline-1"], ["stage-2", "pipeline-1"]]),
    timezone: "America/Chicago",
  }
  const action = (
    resultMode: "KEEP_CURRENT" | "OPEN" | "WON" | "LOST" = "KEEP_CURRENT",
    valueCents = 25_000,
  ) => ({
    nodeKey: "update-opportunity-1",
    type: "UPDATE_OPPORTUNITY" as const,
    opportunityConfig: {
      actionName: "Move opportunity",
      pipelineId: "pipeline-1",
      pipelineNameSnapshot: "Work",
      stageId: "stage-2",
      stageNameSnapshot: "Follow-up",
      resultMode,
      valueCents,
    },
  })
  const run = (eventContext: Record<string, unknown> = {}) => ({
    id: "run-1",
    tenantId: "tenant-1",
    automationId: "automation-1",
    automationName: "Opportunity flow",
    contactId: "contact-1",
    contactName: "Taylor Reed",
    actorUserId: "user-1",
    opportunityId: "trigger-opportunity",
    attemptId: "attempt-1",
    eventSource: "OPPORTUNITY_CREATED" as const,
    triggerType: "OPPORTUNITY_CREATED" as const,
    sourceStageId: null,
    targetStageId: "stage-1",
    cursorIndex: 0,
    eventContext,
    variables: {},
  })

  test("creates a missing opportunity and queues a causal created event", async () => {
    let createdData: Record<string, unknown> | null = null
    let childEvent: Record<string, unknown> | null = null
    const prismaTx = {
      contactOpportunity: {
        findUnique: async () => null,
        create: async ({ data }: any) => {
          createdData = data
          return { id: "created-opportunity", valueCents: data.valueCents }
        },
      },
      automationRun: { update: async () => undefined },
      automationExecution: { create: async () => undefined },
    }
    const result = await executeAutomationSegmentTx(prismaTx, {
      run: run({ chainId: "chain-1", chainDepth: 0, transitionHistory: [] }),
      actions: [action("WON")],
      catalog,
      startIndex: 0,
      occurredAt: new Date("2026-10-01T15:00:00.000Z"),
      queueOpportunityEvent: async (_tx, event) => { childEvent = event as unknown as Record<string, unknown> },
    })

    assert.equal((createdData as Record<string, unknown> | null)?.valueCents, 25_000)
    assert.equal((createdData as Record<string, unknown> | null)?.result, "WON")
    assert.equal((childEvent as Record<string, unknown> | null)?.triggerType, "OPPORTUNITY_CREATED")
    assert.equal((childEvent as Record<string, unknown> | null)?.chainId, "chain-1")
    assert.equal((childEvent as Record<string, unknown> | null)?.chainDepth, 1)
    assert.equal((childEvent as Record<string, unknown> | null)?.causationKey, "automation-run:run-1:node:update-opportunity-1")
    assert.match(result.logs[0]?.details ?? "", /Created opportunity in Work/)
  })

  test("moves an existing opportunity backward or forward and emits only stage changes", async () => {
    const updatedAt = new Date("2026-10-01T14:00:00.000Z")
    let updateData: Record<string, unknown> | null = null
    const childEvents: Record<string, unknown>[] = []
    const prismaTx = {
      contactOpportunity: {
        findUnique: async () => ({
          id: "opportunity-1",
          stageId: "stage-1",
          valueCents: 10_000,
          result: "OPEN",
          closedAt: null,
          updatedAt,
        }),
        updateMany: async ({ data }: any) => { updateData = data; return { count: 1 } },
      },
      automationRun: { update: async () => undefined },
      automationExecution: { create: async () => undefined },
    }
    await executeAutomationSegmentTx(prismaTx, {
      run: run({ chainId: "chain-1", chainDepth: 2, transitionHistory: [] }),
      actions: [action("LOST")],
      catalog,
      startIndex: 0,
      occurredAt: new Date("2026-10-01T15:00:00.000Z"),
      queueOpportunityEvent: async (_tx, event) => { childEvents.push(event as unknown as Record<string, unknown>) },
    })

    assert.equal((updateData as Record<string, unknown> | null)?.stageId, "stage-2")
    assert.equal((updateData as Record<string, unknown> | null)?.valueCents, 25_000)
    assert.equal((updateData as Record<string, unknown> | null)?.result, "LOST")
    assert.equal(childEvents.length, 1)
    assert.equal(childEvents[0]?.triggerType, "OPPORTUNITY_STAGE_CHANGED")
    assert.equal(childEvents[0]?.valueCents, 25_000)
  })

  test("updates value and result without creating a stage event and rejects repeated transitions", async () => {
    let queueCalls = 0
    let updateCalls = 0
    const updatePayloads: Record<string, unknown>[] = []
    const existing = {
      id: "opportunity-1",
      stageId: "stage-2",
      valueCents: 10_000,
      result: "OPEN",
      closedAt: null,
      updatedAt: new Date("2026-10-01T14:00:00.000Z"),
    }
    const prismaTx = {
      contactOpportunity: {
        findUnique: async () => existing,
        updateMany: async ({ data }: any) => {
          updateCalls += 1
          updatePayloads.push(data)
          return { count: 1 }
        },
      },
      automationRun: { update: async () => undefined },
      automationExecution: { create: async () => undefined },
    }
    const noOp = await executeAutomationSegmentTx(prismaTx, {
      run: run(),
      actions: [action("KEEP_CURRENT", 10_000)],
      catalog,
      startIndex: 0,
      queueOpportunityEvent: async () => { queueCalls += 1 },
    })
    assert.equal(updateCalls, 0)
    assert.equal(queueCalls, 0)
    assert.match(noOp.logs[0]?.details ?? "", /No changes were needed/)

    await executeAutomationSegmentTx(prismaTx, {
      run: run(),
      actions: [action("WON")],
      catalog,
      startIndex: 0,
      queueOpportunityEvent: async () => { queueCalls += 1 },
    })
    assert.equal(updateCalls, 1)
    assert.equal(queueCalls, 0)
    assert.equal(updatePayloads[0]?.valueCents, 25_000)

    existing.stageId = "stage-1"
    await assert.rejects(
      executeAutomationSegmentTx(prismaTx, {
        run: run({
          chainDepth: 3,
          transitionHistory: [{
            kind: "STAGE_CHANGED",
            opportunityKey: "opportunity-1",
            pipelineId: "pipeline-1",
            sourceStageId: "stage-1",
            targetStageId: "stage-2",
          }],
        }),
        actions: [action()],
        catalog,
        startIndex: 0,
        queueOpportunityEvent: async () => { queueCalls += 1 },
      }),
      (error: any) =>
        error?.code === "OPPORTUNITY_AUTOMATION_LOOP" &&
        error?.nodeExecutions?.[0]?.reasonCode === "OPPORTUNITY_AUTOMATION_LOOP",
    )
    assert.equal(updateCalls, 1)
  })
})

describe("Delete opportunity runtime", () => {
  const emptyMap = new Map()
  const catalog = {
    fieldMap: emptyMap,
    fieldKeyMap: emptyMap,
    activeStatusIds: new Set<string>(),
    activeTaskStatusIds: new Set<string>(),
    taskStatusMap: emptyMap,
    activeUserIds: new Set<string>(),
    tagIds: new Set<string>(),
    statusMap: emptyMap,
    userMap: emptyMap,
    tagMap: emptyMap,
    pipelineMap: new Map([["pipeline-1", "Work"]]),
    stageMap: new Map([["stage-2", "Follow-up"]]),
    stagePipelineMap: new Map([["stage-2", "pipeline-1"]]),
    timezone: "America/Chicago",
  }
  const action = {
    nodeKey: "delete-opportunity-1",
    type: "DELETE_OPPORTUNITY" as const,
    deleteOpportunityConfig: {
      actionName: "Remove work opportunity",
      pipelineId: "pipeline-1",
      pipelineNameSnapshot: "Work",
    },
  }
  const run = {
    id: "run-delete-opportunity",
    tenantId: "tenant-1",
    automationId: "automation-1",
    automationName: "Opportunity cleanup",
    contactId: "contact-1",
    contactName: "Taylor Reed",
    actorUserId: "user-1",
    opportunityId: "trigger-opportunity",
    attemptId: "attempt-delete-opportunity",
    eventSource: "OPPORTUNITY_CREATED" as const,
    triggerType: "OPPORTUNITY_CREATED" as const,
    sourceStageId: null,
    targetStageId: "stage-1",
    cursorIndex: 0,
    variables: {},
  }

  test("deletes only the selected pipeline opportunity and continues to later actions", async () => {
    const updatedAt = new Date("2026-10-01T14:00:00.000Z")
    let deleteWhere: Record<string, unknown> | null = null
    let laterActionCalls = 0
    let queuedEvents = 0
    const prismaTx = {
      contactOpportunity: {
        findUnique: async () => ({
          id: "opportunity-1",
          stageId: "stage-2",
          valueCents: 25_000,
          result: "LOST",
          updatedAt,
        }),
        deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
          deleteWhere = where
          return { count: 1 }
        },
      },
      contact: { update: async () => { laterActionCalls += 1 } },
      automationRun: { update: async () => undefined },
      automationExecution: { create: async () => undefined },
    }
    const result = await executeAutomationSegmentTx(prismaTx, {
      run,
      actions: [action, { nodeKey: "next-action", type: "CLEAR_CONTACT_ASSIGNEE" }],
      catalog,
      startIndex: 0,
      queueOpportunityEvent: async () => { queuedEvents += 1 },
    })

    assert.deepEqual(deleteWhere, {
      tenantId: "tenant-1",
      id: "opportunity-1",
      pipelineId: "pipeline-1",
      updatedAt,
    })
    assert.equal(laterActionCalls, 1)
    assert.equal(queuedEvents, 0)
    assert.equal(result.logs[0]?.nodeLabel, "Remove work opportunity")
    assert.match(result.logs[0]?.details ?? "", /Deleted opportunity from Work · Follow-up · \$250\.00 · Lost/)
    assert.equal(result.logs[1]?.status, "EXECUTED")
  })

  test("succeeds as a no-op when the selected pipeline has no opportunity", async () => {
    let deleteCalls = 0
    const prismaTx = {
      contactOpportunity: {
        findUnique: async () => null,
        deleteMany: async () => { deleteCalls += 1; return { count: 0 } },
      },
      automationRun: { update: async () => undefined },
      automationExecution: { create: async () => undefined },
    }
    const result = await executeAutomationSegmentTx(prismaTx, {
      run,
      actions: [action],
      catalog,
      startIndex: 0,
    })

    assert.equal(deleteCalls, 0)
    assert.equal(result.logs[0]?.status, "EXECUTED")
    assert.equal(result.logs[0]?.details, "No opportunity existed in Work. No changes were needed.")
  })

  test("deletes Open, Won, and Lost opportunities without outcome-specific restrictions", async () => {
    const resultLabels: string[] = []
    for (const result of ["OPEN", "WON", "LOST"] as const) {
      const prismaTx = {
        contactOpportunity: {
          findUnique: async () => ({
            id: `opportunity-${result.toLowerCase()}`,
            stageId: "stage-2",
            valueCents: 100,
            result,
            updatedAt: new Date("2026-10-01T14:00:00.000Z"),
          }),
          deleteMany: async () => ({ count: 1 }),
        },
        automationRun: { update: async () => undefined },
        automationExecution: { create: async () => undefined },
      }
      const execution = await executeAutomationSegmentTx(prismaTx, {
        run: { ...run, id: `run-${result.toLowerCase()}` },
        actions: [action],
        catalog,
        startIndex: 0,
      })
      resultLabels.push(execution.logs[0]?.details ?? "")
    }

    assert.match(resultLabels[0] ?? "", /· Open\.$/)
    assert.match(resultLabels[1] ?? "", /· Won\.$/)
    assert.match(resultLabels[2] ?? "", /· Lost\.$/)
  })

  test("allows a later Update/create opportunity action to recreate the deleted record", async () => {
    let lookupCount = 0
    let createCalls = 0
    let queuedEvents = 0
    const prismaTx = {
      contactOpportunity: {
        findUnique: async () => {
          lookupCount += 1
          return lookupCount === 1
            ? {
                id: "opportunity-1",
                stageId: "stage-2",
                valueCents: 25_000,
                result: "OPEN",
                updatedAt: new Date("2026-10-01T14:00:00.000Z"),
              }
            : null
        },
        deleteMany: async () => ({ count: 1 }),
        create: async ({ data }: { data: Record<string, any> }) => {
          createCalls += 1
          return { id: "recreated-opportunity", valueCents: data.valueCents }
        },
      },
      automationRun: { update: async () => undefined },
      automationExecution: { create: async () => undefined },
    }
    const updateAction = {
      nodeKey: "recreate-opportunity",
      type: "UPDATE_OPPORTUNITY" as const,
      opportunityConfig: {
        actionName: "Recreate opportunity",
        pipelineId: "pipeline-1",
        pipelineNameSnapshot: "Work",
        stageId: "stage-2",
        stageNameSnapshot: "Follow-up",
        resultMode: "OPEN" as const,
        valueCents: 50_000,
      },
    }
    const execution = await executeAutomationSegmentTx(prismaTx, {
      run: { ...run, eventContext: { chainId: "chain-1", chainDepth: 0, transitionHistory: [] } },
      actions: [action, updateAction],
      catalog,
      startIndex: 0,
      queueOpportunityEvent: async () => { queuedEvents += 1 },
    })

    assert.equal(createCalls, 1)
    assert.equal(queuedEvents, 1)
    assert.match(execution.logs[1]?.details ?? "", /Created opportunity in Work/)
  })

  test("reports an optimistic-concurrency conflict for safe queue retry", async () => {
    const prismaTx = {
      contactOpportunity: {
        findUnique: async () => ({
          id: "opportunity-1",
          stageId: "stage-2",
          valueCents: 25_000,
          result: "OPEN",
          updatedAt: new Date("2026-10-01T14:00:00.000Z"),
        }),
        deleteMany: async () => ({ count: 0 }),
      },
      automationRun: { update: async () => undefined },
      automationExecution: { create: async () => undefined },
    }

    await assert.rejects(
      executeAutomationSegmentTx(prismaTx, {
        run,
        actions: [action],
        catalog,
        startIndex: 0,
      }),
      (error: any) => error?.code === "OPPORTUNITY_CHANGED_CONCURRENTLY",
    )
  })
})

describe("Add to workflow runtime", () => {
  const emptyMap = new Map()
  const catalog = {
    fieldMap: emptyMap,
    fieldKeyMap: emptyMap,
    activeStatusIds: new Set<string>(),
    activeTaskStatusIds: new Set<string>(),
    taskStatusMap: emptyMap,
    activeUserIds: new Set<string>(),
    tagIds: new Set<string>(),
    statusMap: emptyMap,
    userMap: emptyMap,
    tagMap: emptyMap,
    pipelineMap: emptyMap,
    stageMap: emptyMap,
    stagePipelineMap: emptyMap,
    timezone: "America/Chicago",
  }
  const action = {
    nodeKey: "add-workflow-node",
    type: "ADD_TO_WORKFLOW" as const,
    addToWorkflowConfig: {
      actionName: "Start onboarding",
      targetAutomationId: "target-automation",
      targetAutomationNameSnapshot: "Onboarding",
    },
  }
  const run = {
    id: "source-run",
    tenantId: "tenant-1",
    automationId: "source-automation",
    automationName: "Lead intake",
    contactId: "contact-1",
    contactName: "Taylor Reed",
    actorUserId: "user-1",
    opportunityId: "opportunity-1",
    attemptId: "source-attempt",
    eventSource: "OPPORTUNITY_CREATED" as const,
    triggerType: "OPPORTUNITY_CREATED" as const,
    sourceStageId: null,
    targetStageId: "stage-1",
    cursorIndex: 0,
    variables: {},
    eventContext: { pipelineId: "pipeline-1", workflowAutomationIds: ["source-automation"] },
  }

  test("queues a pinned independent target run and writes its start log", async () => {
    let childRun: Record<string, any> | null = null
    let startLog: Record<string, any> | null = null
    const prismaTx = {
      automation: {
        findFirst: async () => ({
          id: "target-automation",
          name: "Onboarding",
          triggerType: "OPPORTUNITY_CREATED",
          targetStageId: null,
          actions: [{ nodeKey: "target-action", type: "CLEAR_CONTACT_ASSIGNEE" }],
        }),
      },
      automationRun: {
        findUnique: async () => null,
        create: async ({ data }: { data: Record<string, any> }) => {
          childRun = data
          return { id: "child-run" }
        },
        update: async () => undefined,
      },
      automationNodeExecution: {
        create: async ({ data }: { data: Record<string, any> }) => { startLog = data },
      },
      automationExecution: { create: async () => undefined },
    }
    const result = await executeAutomationSegmentTx(prismaTx, {
      run,
      actions: [action],
      catalog,
      startIndex: 0,
    })

    assert.equal(result.queuedRunCount, 1)
    assert.equal((childRun as Record<string, any> | null)?.status, "QUEUED")
    assert.equal((childRun as Record<string, any> | null)?.eventSource, "AUTOMATION_ACTION")
    assert.equal((childRun as Record<string, any> | null)?.opportunityId, "opportunity-1")
    assert.deepEqual((childRun as Record<string, any> | null)?.variables, {})
    assert.equal((childRun as Record<string, any> | null)?.actionSnapshot?.[0]?.nodeKey, "target-action")
    assert.deepEqual((childRun as Record<string, any> | null)?.eventContext?.workflowAutomationIds, [
      "source-automation",
      "target-automation",
    ])
    assert.equal((startLog as Record<string, any> | null)?.status, "QUEUED")
    assert.equal((startLog as Record<string, any> | null)?.nodeLabel, "Started by workflow")
    assert.equal(result.logs[0]?.details, "Queued “Onboarding” to start.")
  })

  test("stops a repeated workflow at runtime", async () => {
    let created = false
    await assert.rejects(
      executeAutomationSegmentTx({
        automation: { findFirst: async () => ({
          id: "target-automation",
          name: "Onboarding",
          triggerType: "OPPORTUNITY_CREATED",
          targetStageId: null,
          actions: [{ nodeKey: "target-action", type: "CLEAR_CONTACT_ASSIGNEE" }],
        }) },
        automationRun: {
          findUnique: async () => null,
          create: async () => { created = true },
        },
      }, {
        run: {
          ...run,
          eventContext: { workflowAutomationIds: ["source-automation", "target-automation"] },
        },
        actions: [action],
        catalog,
        startIndex: 0,
      }),
      (error: any) => error?.code === "AUTOMATION_WORKFLOW_LOOP",
    )
    assert.equal(created, false)
  })

  test("validates the Add to workflow configuration shape", () => {
    assert.deepEqual(AutomationAddToWorkflowConfigSchema.parse(action.addToWorkflowConfig), action.addToWorkflowConfig)
  })
})

describe("Remove from workflow runtime", () => {
  const emptyMap = new Map()
  const catalog = {
    fieldMap: emptyMap,
    fieldKeyMap: emptyMap,
    activeStatusIds: new Set<string>(),
    activeTaskStatusIds: new Set<string>(),
    taskStatusMap: emptyMap,
    activeUserIds: new Set<string>(),
    tagIds: new Set<string>(),
    statusMap: emptyMap,
    userMap: emptyMap,
    tagMap: emptyMap,
    pipelineMap: emptyMap,
    stageMap: emptyMap,
    stagePipelineMap: emptyMap,
    timezone: "America/Chicago",
  }
  const run = {
    id: "source-run",
    tenantId: "tenant-1",
    automationId: "source-automation",
    automationName: "Lead intake",
    contactId: "contact-1",
    contactName: "Taylor Reed",
    actorUserId: "user-1",
    opportunityId: "opportunity-1",
    attemptId: "source-attempt",
    eventSource: "OPPORTUNITY_CREATED" as const,
    triggerType: "OPPORTUNITY_CREATED" as const,
    sourceStageId: null,
    targetStageId: "stage-1",
    cursorIndex: 0,
    variables: {},
  }
  const removeAction = (targetAutomationId: string) => ({
    nodeKey: "remove-workflow-node",
    type: "REMOVE_FROM_WORKFLOW" as const,
    removeFromWorkflowConfig: {
      actionName: "End nurture",
      targetAutomationId,
      targetAutomationNameSnapshot: "Lead nurture",
    },
  })

  test("exits a self-targeted run after recording the removal action", async () => {
    const runUpdates: Array<Record<string, any>> = []
    const executions: Array<Record<string, any>> = []
    const result = await executeAutomationSegmentTx({
      automation: { findFirst: async () => ({ id: "source-automation", name: "Lead intake" }) },
      automationDispatch: { findMany: async () => [] },
      automationRun: {
        findMany: async () => [],
        findUnique: async () => null,
        updateMany: async (args: Record<string, any>) => {
          runUpdates.push(args)
          return { count: 1 }
        },
      },
      automationExecution: { create: async ({ data }: { data: Record<string, any> }) => { executions.push(data) } },
      automationNodeExecution: {
        updateMany: async () => ({ count: 0 }),
        findMany: async () => [],
        createMany: async () => undefined,
      },
    }, {
      run,
      actions: [removeAction("source-automation"), { nodeKey: "later-action", type: "CLEAR_CONTACT_ASSIGNEE" }],
      catalog,
      startIndex: 0,
    })

    assert.equal(result.status, "EXITED")
    assert.equal(result.logs[0]?.status, "EXECUTED")
    assert.equal(result.logs[1]?.status, "SKIPPED")
    assert.equal(result.logs[1]?.reasonCode, "CONTACT_REMOVED_FROM_WORKFLOW")
    assert.equal(runUpdates.at(-1)?.data.status, "EXITED")
    assert.equal(executions.at(-1)?.status, "EXITED")
  })

  test("exits a self-targeted run inside a selected branch", async () => {
    const result = await executeAutomationSegmentTx({
      automation: { findFirst: async () => ({ id: "source-automation", name: "Lead intake" }) },
      automationDispatch: { findMany: async () => [] },
      automationRun: {
        findMany: async () => [],
        findUnique: async () => null,
        updateMany: async () => ({ count: 1 }),
      },
      automationExecution: { create: async () => undefined },
      automationNodeExecution: {
        updateMany: async () => ({ count: 0 }),
        findMany: async () => [],
        createMany: async () => undefined,
      },
    }, {
      run,
      actions: [{
        nodeKey: "route-removal",
        type: "IF_ELSE",
        ifElseConfig: {
          actionName: "Choose route",
          branches: [
            {
              branchKey: "selected-branch",
              name: "Selected",
              isDefault: false,
              matchMode: "ALL",
              conditions: [{
                conditionKey: "current-time-present",
                source: "CURRENT_DATE_TIME",
                operator: "IS_NOT_EMPTY",
              }],
              actions: [
                removeAction("source-automation"),
                { nodeKey: "later-branch-action", type: "CLEAR_CONTACT_ASSIGNEE" },
              ],
            },
            {
              branchKey: "default-branch",
              name: "Default",
              isDefault: true,
              matchMode: "ALL",
              conditions: [],
              actions: [],
            },
          ],
        },
      }],
      catalog,
      startIndex: 0,
    })

    assert.equal(result.status, "EXITED")
    assert.equal(result.logs.find((log) => log.nodeKey === "remove-workflow-node")?.status, "EXECUTED")
    assert.equal(result.logs.find((log) => log.nodeKey === "later-branch-action")?.reasonCode, "CONTACT_REMOVED_FROM_WORKFLOW")
  })

  test("cancels every active target run and succeeds when the source continues", async () => {
    const runUpdates: Array<Record<string, any>> = []
    const dispatchUpdates: Array<Record<string, any>> = []
    const activeRuns = [
      { ...run, id: "queued-run", automationId: "target-automation", automationName: "Lead nurture", attemptId: "queued-attempt", status: "QUEUED", actionSnapshot: [], cursorPath: null },
      { ...run, id: "waiting-run", automationId: "target-automation", automationName: "Lead nurture", attemptId: "waiting-attempt", status: "WAITING", actionSnapshot: [], cursorPath: null },
      { ...run, id: "running-run", automationId: "target-automation", automationName: "Lead nurture", attemptId: "running-attempt", status: "RUNNING", actionSnapshot: [], cursorPath: null },
    ]
    const result = await executeAutomationSegmentTx({
      automation: { findFirst: async () => ({ id: "target-automation", name: "Lead nurture" }) },
      automationDispatch: {
        findMany: async () => [{
          id: "queued-dispatch",
          automationId: "target-automation",
          automationName: "Lead nurture",
          triggerExecutionId: "trigger-log",
          attemptId: "dispatch-attempt",
          actionSnapshot: [],
          event: {
            contactName: "Taylor Reed",
            actorUserId: "user-1",
            opportunityId: "opportunity-1",
            triggerType: "OPPORTUNITY_CREATED",
          },
        }],
        updateMany: async (args: Record<string, any>) => {
          dispatchUpdates.push(args)
          return { count: 1 }
        },
      },
      automationRun: {
        findMany: async () => activeRuns,
        findUnique: async () => null,
        updateMany: async (args: Record<string, any>) => {
          runUpdates.push(args)
          return { count: 1 }
        },
      },
      automationExecution: { create: async () => undefined },
      automationNodeExecution: {
        updateMany: async () => ({ count: 1 }),
        findMany: async () => [],
        createMany: async () => undefined,
      },
    }, {
      run,
      actions: [removeAction("target-automation")],
      catalog,
      startIndex: 0,
    })

    assert.equal(result.status, "SUCCEEDED")
    assert.match(result.logs[0]?.details ?? "", /4 active instances/)
    assert.equal(dispatchUpdates[0]?.where.status, "QUEUED")
    assert.equal(dispatchUpdates[0]?.data.status, "CANCELED")
    assert.equal(runUpdates.find((update) => update.where.id === "running-run")?.data.exitReasonCode, "CONTACT_REMOVED_FROM_WORKFLOW")
    assert.equal(runUpdates.find((update) => update.where.id === "waiting-run")?.data.status, "EXITED")
    assert.equal(runUpdates.at(-1)?.data.status, "SUCCEEDED")
  })

  test("honors a cooperative exit request before another action can start", async () => {
    const runUpdates: Array<Record<string, any>> = []
    const result = await executeAutomationSegmentTx({
      automationRun: {
        updateMany: async (args: Record<string, any>) => {
          runUpdates.push(args)
          return { count: 1 }
        },
      },
      automationExecution: { create: async () => undefined },
    }, {
      run: {
        ...run,
        exitRequestedAt: new Date("2026-10-02T12:00:00.000Z"),
        exitReasonCode: "CONTACT_REMOVED_FROM_WORKFLOW",
        exitReasonDetails: "Removed by another workflow.",
      },
      actions: [{ nodeKey: "must-not-run", type: "CLEAR_CONTACT_ASSIGNEE" }],
      catalog,
      startIndex: 0,
    })

    assert.equal(result.status, "EXITED")
    assert.equal(result.logs[0]?.status, "SKIPPED")
    assert.equal(runUpdates[0]?.data.status, "EXITED")
  })

  test("cannot finalize a run as successful when cancellation wins the completion race", async () => {
    let exitVisible = false
    const executionStatuses: string[] = []
    const result = await executeAutomationSegmentTx({
      contact: { update: async () => ({ id: "contact-1" }) },
      automationRun: {
        findUnique: async () => exitVisible
          ? {
              status: "RUNNING",
              exitRequestedAt: new Date("2026-10-02T12:00:00.000Z"),
              exitReasonCode: "CONTACT_REMOVED_FROM_WORKFLOW",
              exitReasonDetails: "Cancellation won the race.",
            }
          : null,
        updateMany: async ({ data }: { data: Record<string, any> }) => {
          if (data.status === "SUCCEEDED") {
            exitVisible = true
            return { count: 0 }
          }
          return { count: 1 }
        },
      },
      automationExecution: {
        create: async ({ data }: { data: Record<string, any> }) => { executionStatuses.push(data.status) },
      },
    }, {
      run,
      actions: [{ nodeKey: "clear-assignee", type: "CLEAR_CONTACT_ASSIGNEE" }],
      catalog,
      startIndex: 0,
    })

    assert.equal(result.status, "EXITED")
    assert.deepEqual(executionStatuses, ["EXITED"])
  })

  test("treats removal with no active target instance as a successful no-op", async () => {
    const result = await executeAutomationSegmentTx({
      automation: { findFirst: async () => ({ id: "target-automation", name: "Lead nurture" }) },
      automationDispatch: { findMany: async () => [] },
      automationRun: {
        findMany: async () => [],
        findUnique: async () => null,
        updateMany: async () => ({ count: 1 }),
      },
      automationExecution: { create: async () => undefined },
    }, {
      run,
      actions: [removeAction("target-automation")],
      catalog,
      startIndex: 0,
    })

    assert.equal(result.status, "SUCCEEDED")
    assert.match(result.logs[0]?.details ?? "", /No changes were needed/)
  })

  test("allows the contact to enter the target workflow again after removal", async () => {
    let createdRuns = 0
    const result = await executeAutomationSegmentTx({
      automation: {
        findFirst: async () => ({
          id: "target-automation",
          name: "Lead nurture",
          triggerType: "OPPORTUNITY_CREATED",
          targetStageId: null,
          actions: [{ nodeKey: "target-action", type: "CLEAR_CONTACT_ASSIGNEE" }],
        }),
      },
      automationDispatch: { findMany: async () => [] },
      automationRun: {
        findMany: async () => [],
        findUnique: async () => null,
        create: async () => { createdRuns += 1; return { id: "new-target-run" } },
        updateMany: async () => ({ count: 1 }),
      },
      automationExecution: { create: async () => undefined },
      automationNodeExecution: { create: async () => undefined },
    }, {
      run: { ...run, eventContext: { workflowAutomationIds: ["source-automation"] } },
      actions: [
        removeAction("target-automation"),
        {
          nodeKey: "add-workflow-again",
          type: "ADD_TO_WORKFLOW",
          addToWorkflowConfig: {
            actionName: "Restart nurture",
            targetAutomationId: "target-automation",
            targetAutomationNameSnapshot: "Lead nurture",
          },
        },
      ],
      catalog,
      startIndex: 0,
    })

    assert.equal(result.status, "SUCCEEDED")
    assert.equal(result.queuedRunCount, 1)
    assert.equal(createdRuns, 1)
  })

  test("validates the Remove from workflow configuration shape", () => {
    const config = removeAction("target-automation").removeFromWorkflowConfig
    assert.deepEqual(AutomationRemoveFromWorkflowConfigSchema.parse(config), config)
    assert.throws(() => AutomationRemoveFromWorkflowConfigSchema.parse({
      ...config,
      actionName: "   ",
    }))
    assert.throws(() => AutomationUpsertSchema.parse({
      name: "Missing removal configuration",
      isEnabled: false,
      trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      conditions: [],
      actions: [{ type: "REMOVE_FROM_WORKFLOW" }],
    }))
  })

  test("tracks removal dependencies without adding cycle-detection edges", () => {
    const actions = [removeAction("target-automation")]
    assert.deepEqual(automationWorkflowReferenceIds(actions), ["target-automation"])
    assert.deepEqual(automationWorkflowTargetIds(actions), [])
  })
})

describe("evaluateAutomationOperator", () => {
  test("evaluates numeric comparisons and ranges", () => {
    assert.equal(evaluateAutomationOperator("GREATER_THAN", 20_000, 10_000, "number"), true)
    assert.equal(
      evaluateAutomationOperator("BETWEEN", 15_000, { min: 10_000, max: 20_000 }, "number"),
      true,
    )
    assert.equal(evaluateAutomationOperator("LESS_THAN", 20_000, 10_000, "number"), false)
  })

  test("evaluates strings, arrays, booleans, and empty values", () => {
    assert.equal(evaluateAutomationOperator("CONTAINS", "Qualified lead", "lead", "string"), true)
    assert.equal(
      evaluateAutomationOperator("INCLUDES_ALL", ["A", "B"], ["A", "B"], "stringArray"),
      true,
    )
    assert.equal(evaluateAutomationOperator("IS_TRUE", true, null, "boolean"), true)
    assert.equal(evaluateAutomationOperator("IS_EMPTY", null, null, "string"), true)
  })

  test("uses field-appropriate operator catalogs", () => {
    assert.ok(getAutomationOperatorsForFieldType("NUMBER").includes("BETWEEN"))
    assert.ok(getAutomationOperatorsForFieldType("MULTI_SELECT").includes("INCLUDES_ANY"))
    assert.deepEqual(getAutomationOperatorsForFieldType("CHECKBOX"), [
      "IS_TRUE",
      "IS_FALSE",
      "IS_EMPTY",
      "IS_NOT_EMPTY",
    ])
  })
})

describe("deleteAutomationContactFileObjects", () => {
  test("deduplicates storage objects and retries transient deletion failures", async () => {
    let attempts = 0
    await deleteAutomationContactFileObjects(
      [
        { id: "file-orphan", tenantId: "tenant-1", key: "notes/orphan.pdf" },
        { id: "file-orphan", tenantId: "tenant-1", key: "notes/orphan.pdf" },
      ],
      async ({ path }) => {
        assert.equal(path, "notes/orphan.pdf")
        attempts += 1
        if (attempts < 3) throw new Error("Temporary storage error")
      },
    )
    assert.equal(attempts, 3)
  })
})

describe("AutomationUpsertSchema", () => {
  test("accepts up to 100 action nodes in one path", () => {
    const base = {
      name: "Long automation",
      isEnabled: false,
      trigger: { type: "OPPORTUNITY_CREATED" as const, pipelineId: "pipeline-1" },
      conditions: [],
    }
    const actions = Array.from({ length: 100 }, () => ({ type: "CLEAR_CONTACT_ASSIGNEE" as const }))

    assert.equal(AutomationUpsertSchema.safeParse({ ...base, actions }).success, true)
    assert.equal(
      AutomationUpsertSchema.safeParse({
        ...base,
        actions: [...actions, { type: "CLEAR_CONTACT_ASSIGNEE" as const }],
      }).success,
      false,
    )
  })

  test("accepts legacy null routing fields on Split and If/Else actions", () => {
    const result = AutomationUpsertSchema.safeParse({
      name: "Nested routing",
      isEnabled: false,
      trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      conditions: [],
      actions: [{
        type: "SPLIT",
        nodeKey: "00000000-0000-4000-8000-000000000001",
        customFieldUpdates: null,
        statusConfigId: null,
        assignedUserId: null,
        tagId: null,
        waitConfig: null,
        noteTitle: null,
        noteBody: null,
        taskConfig: null,
        dateTimeFormatterConfig: null,
        numberFormatterConfig: null,
        textFormatterConfig: null,
        mathOperationConfig: null,
        ifElseConfig: null,
        splitConfig: {
          actionName: "Split",
          routes: [
            {
              branchKey: "00000000-0000-4000-8000-000000000002",
              name: "Route 1",
              percentage: 50,
              actions: [{
                type: "IF_ELSE",
                nodeKey: "00000000-0000-4000-8000-000000000003",
                splitConfig: null,
                ifElseConfig: {
                  actionName: "If/Else",
                  branches: [
                    {
                      branchKey: "00000000-0000-4000-8000-000000000004",
                      name: "Branch 1",
                      isDefault: false,
                      matchMode: "ALL",
                      conditions: [{
                        source: "CONTACT_FIELD",
                        fieldKey: "name",
                        operator: "IS_NOT_EMPTY",
                      }],
                      actions: [{ type: "SET_CONTACT_STATUS", statusConfigId: "active" }],
                    },
                    {
                      branchKey: "00000000-0000-4000-8000-000000000005",
                      name: "Default",
                      isDefault: true,
                      matchMode: "ALL",
                      conditions: [],
                      actions: [],
                    },
                  ],
                },
              }],
            },
            {
              branchKey: "00000000-0000-4000-8000-000000000006",
              name: "Route 2",
              percentage: 50,
              actions: [],
            },
          ],
        },
      }],
    })

    assert.equal(result.success, true)
  })

  test("accepts creation and stage-change trigger shapes", () => {
    const base = {
      name: "Qualified opportunity",
      isEnabled: false,
      conditions: [],
      actions: [{ type: "SET_CONTACT_STATUS", statusConfigId: "status-active" }],
    }
    assert.equal(
      AutomationUpsertSchema.safeParse({
        ...base,
        trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      }).success,
      true,
    )
    assert.equal(
      AutomationUpsertSchema.safeParse({
        ...base,
        trigger: {
          type: "OPPORTUNITY_STAGE_CHANGED",
          pipelineId: "pipeline-1",
          targetStageId: "stage-2",
        },
      }).success,
      true,
    )
  })

  test("accepts assignee and tag filters", () => {
    const result = AutomationUpsertSchema.safeParse({
      name: "Route assigned opportunity",
      isEnabled: false,
      trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      conditions: [
        {
          source: "CONTACT_ASSIGNEE",
          operator: "EQUALS",
          assignedUserId: "user-1",
        },
        {
          source: "CONTACT_TAGS",
          operator: "NOT_EQUALS",
          tagId: "tag-1",
        },
      ],
      actions: [{ type: "CLEAR_CONTACT_ASSIGNEE" }],
    })

    assert.equal(result.success, true)
  })

  test("rejects an empty action list", () => {
    const noActions = AutomationUpsertSchema.safeParse({
      name: "Invalid",
      isEnabled: false,
      trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      conditions: [],
      actions: [],
    })
    assert.equal(noActions.success, false)
  })

  test("accepts date/time formatter configurations and automation value tokens", () => {
    const result = AutomationUpsertSchema.safeParse({
      name: "Format appointment",
      isEnabled: false,
      trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      conditions: [],
      actions: [
        {
          type: "FORMAT_DATE_TIME",
          dateTimeFormatterConfig: {
            mode: "DATE_TIME",
            source: { type: "CURRENT_DATE" },
            format: "MMM D, YYYY hh:mm:ss A",
            outputKey: "appointment_date",
          },
        },
        {
          type: "ADD_CONTACT_NOTE",
          noteTitle: "Appointment",
          noteBody: "Scheduled {automation.appointment_date}",
        },
      ],
    })

    assert.equal(result.success, true)
  })

  test("accepts every number formatter mode", () => {
    const source = { type: "CONTACT_FIELD", key: "weight" }
    const base = {
      name: "Format numbers",
      isEnabled: false,
      trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      conditions: [],
    }
    const configs = [
      { mode: "TEXT_TO_NUMBER", source, decimalMark: "PERIOD", outputKey: "raw_weight" },
      { mode: "FORMAT_NUMBER", source, decimalMark: "PERIOD", groupingStyle: "COMMA_PERIOD", outputKey: "weight" },
      { mode: "FORMAT_CURRENCY", source, decimalMark: "PERIOD", currencyCode: "USD", outputKey: "premium" },
      { mode: "FORMAT_PHONE_NUMBER", source: { type: "CONTACT_FIELD", key: "phone" }, countryCode: "+1", phoneFormat: "E164", outputKey: "phone" },
      { mode: "RANDOM_NUMBER", min: 1, max: 100, outputKey: "draw" },
    ]
    for (const numberFormatterConfig of configs) {
      assert.equal(AutomationUpsertSchema.safeParse({
        ...base,
        actions: [{ type: "FORMAT_NUMBER", numberFormatterConfig }],
      }).success, true)
    }
  })

  test("accepts every text formatter mode", () => {
    const common = {
      actionName: "Normalize text",
      source: { type: "CONTACT_FIELD", key: "name" },
      outputKey: "formatted_text",
    }
    const configs = [
      ...["UPPER_CASE", "LOWER_CASE", "TITLE_CASE", "CAPITALIZE", "TRIM_WHITESPACE", "WORD_COUNT", "LENGTH", "EXTRACT_EMAIL", "EXTRACT_URL"]
        .map((mode) => ({ ...common, mode })),
      { ...common, mode: "DEFAULT_VALUE", defaultValue: "Unknown" },
      { ...common, mode: "TRIM", maxLength: 100 },
      { ...common, mode: "REPLACE_TEXT", searchText: "old", replacementText: "new" },
      { ...common, mode: "FIND", searchText: "value" },
      { ...common, mode: "SPLIT_TEXT", separator: " ", segment: 1 },
    ]
    for (const textFormatterConfig of configs) {
      assert.equal(AutomationUpsertSchema.safeParse({
        name: "Format text",
        isEnabled: false,
        trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
        conditions: [],
        actions: [{ type: "FORMAT_TEXT", textFormatterConfig }],
      }).success, true)
    }
  })

  test("accepts number and date Math operation configurations", () => {
    const base = {
      name: "Calculate values",
      isEnabled: false,
      trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      conditions: [],
    }
    assert.equal(AutomationUpsertSchema.safeParse({
      ...base,
      actions: [{
        type: "MATH_OPERATION",
        mathOperationConfig: {
          mode: "NUMBER",
          source: { type: "CUSTOM_FIELD", key: "premium" },
          operation: "MULTIPLY",
          operand: 1.1,
          outputKey: "adjusted_premium",
        },
      }],
    }).success, true)
    assert.equal(AutomationUpsertSchema.safeParse({
      ...base,
      actions: [{
        type: "MATH_OPERATION",
        mathOperationConfig: {
          mode: "DATE",
          source: { type: "CONTACT_FIELD", key: "date_of_birth" },
          operation: "ADD",
          amount: 1,
          unit: "YEARS",
          outputKey: "next_birthday",
        },
      }],
    }).success, true)
  })

  test("rejects the removed clear-contact-status action", () => {
    const result = AutomationUpsertSchema.safeParse({
      name: "Invalid clear status action",
      isEnabled: false,
      trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      conditions: [],
      actions: [{ type: "CLEAR_CONTACT_STATUS" }],
    })

    assert.equal(result.success, false)
  })

  test("accepts distinct standard and custom-field updates and rejects duplicates or overflow", () => {
    const base = {
      name: "Update contact fields",
      isEnabled: false,
      trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      conditions: [],
    }
    const valid = AutomationUpsertSchema.safeParse({
      ...base,
      actions: [{
        type: "UPDATE_CONTACT_CUSTOM_FIELDS",
        customFieldUpdates: [
          { contactFieldKey: "phone", operation: "SET", value: "+15551234567" },
          { customFieldId: "field-name", operation: "SET", value: "Ready" },
          { customFieldId: "field-old", operation: "CLEAR" },
        ],
      }],
    })
    assert.equal(valid.success, true)

    const duplicate = AutomationUpsertSchema.safeParse({
      ...base,
      actions: [{
        type: "UPDATE_CONTACT_CUSTOM_FIELDS",
        customFieldUpdates: [
          { customFieldId: "field-name", operation: "SET", value: "Ready" },
          { customFieldId: "field-name", operation: "CLEAR" },
        ],
      }],
    })
    assert.equal(duplicate.success, false)

    const duplicateContactField = AutomationUpsertSchema.safeParse({
      ...base,
      actions: [{
        type: "UPDATE_CONTACT_CUSTOM_FIELDS",
        customFieldUpdates: [
          { contactFieldKey: "email", operation: "SET", value: "new@example.com" },
          { contactFieldKey: "email", operation: "CLEAR" },
        ],
      }],
    })
    assert.equal(duplicateContactField.success, false)

    const overflow = AutomationUpsertSchema.safeParse({
      ...base,
      actions: [{
        type: "UPDATE_CONTACT_CUSTOM_FIELDS",
        customFieldUpdates: Array.from({ length: 21 }, (_, index) => ({
          customFieldId: `field-${index}`,
          operation: "SET",
          value: `Value ${index}`,
        })),
      }],
    })
    assert.equal(overflow.success, false)
  })

  test("normalizes multi-field values and prevents clearing required fields", async () => {
    const prismaClient = {
      opportunityPipeline: { findUnique: async () => ({ id: "pipeline-1", stages: [] }) },
      contactCustomField: { findMany: async () => [
        {
          id: "field-name",
          key: "name_code",
          label: "Name code",
          fieldType: "TEXT",
          isRequired: false,
          isActive: true,
          isEncrypted: false,
          isSensitive: false,
          options: [],
        },
        {
          id: "field-old",
          key: "old_value",
          label: "Old value",
          fieldType: "TEXT",
          isRequired: false,
          isActive: true,
          isEncrypted: false,
          isSensitive: false,
          options: [],
        },
        {
          id: "field-required",
          key: "required_value",
          label: "Required value",
          fieldType: "TEXT",
          isRequired: true,
          isActive: true,
          isEncrypted: false,
          isSensitive: false,
          options: [],
        },
      ] },
      contactStatusConfig: { findMany: async () => [] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [] },
    }
    const validInput = AutomationUpsertSchema.parse({
      name: "Update fields",
      isEnabled: false,
      trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      conditions: [],
      actions: [{
        type: "UPDATE_CONTACT_CUSTOM_FIELDS",
        customFieldUpdates: [
          { contactFieldKey: "email", operation: "SET", value: "  NEW@EXAMPLE.COM  " },
          { customFieldId: "field-name", operation: "SET", value: "  Ready  " },
          { customFieldId: "field-old", operation: "CLEAR" },
        ],
      }],
    })
    const normalized = await validateAutomationConfiguration(prismaClient, "tenant-1", validInput)
    const normalizedAction = normalized.actions[0] as { customFieldUpdates?: unknown } | undefined
    assert.deepEqual(normalizedAction?.customFieldUpdates, [
      { contactFieldKey: "email", operation: "SET", value: "NEW@EXAMPLE.COM" },
      { customFieldId: "field-name", operation: "SET", value: "Ready" },
      { customFieldId: "field-old", operation: "CLEAR" },
    ])

    const invalidInput = AutomationUpsertSchema.parse({
      ...validInput,
      actions: [{
        type: "UPDATE_CONTACT_CUSTOM_FIELDS",
        customFieldUpdates: [{ customFieldId: "field-required", operation: "CLEAR" }],
      }],
    })
    await assert.rejects(
      validateAutomationConfiguration(prismaClient, "tenant-1", invalidInput),
      /Required value cannot be cleared/,
    )

    const invalidContactInput = AutomationUpsertSchema.parse({
      ...validInput,
      actions: [{
        type: "UPDATE_CONTACT_CUSTOM_FIELDS",
        customFieldUpdates: [{ contactFieldKey: "firstName", operation: "CLEAR" }],
      }],
    })
    await assert.rejects(
      validateAutomationConfiguration(prismaClient, "tenant-1", invalidContactInput),
      /First name cannot be cleared/,
    )
  })

  test("allows only unique formatter values produced before their template consumers", async () => {
    const prismaClient = {
      opportunityPipeline: { findUnique: async () => ({ id: "pipeline-1", stages: [] }) },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [] },
    }
    const formatter = {
      type: "FORMAT_DATE_TIME" as const,
      dateTimeFormatterConfig: {
        mode: "DATE" as const,
        source: { type: "CURRENT_DATE" as const },
        format: "MMM D, YYYY" as const,
        outputKey: "appointment_date",
      },
    }
    const note = {
      type: "ADD_CONTACT_NOTE" as const,
      noteTitle: "Appointment",
      noteBody: "Scheduled {automation.appointment_date}",
    }
    const valid = AutomationUpsertSchema.parse({
      name: "Valid formatter order",
      isEnabled: false,
      trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      conditions: [],
      actions: [formatter, note],
    })
    const normalized = await validateAutomationConfiguration(prismaClient, "tenant-1", valid)
    assert.equal(normalized.actions[0]?.type, "FORMAT_DATE_TIME")

    const forwardReference = AutomationUpsertSchema.parse({
      ...valid,
      name: "Invalid formatter order",
      actions: [note, formatter],
    })
    await assert.rejects(
      validateAutomationConfiguration(prismaClient, "tenant-1", forwardReference),
      /not available before this action/,
    )

    const duplicate = AutomationUpsertSchema.parse({
      ...valid,
      name: "Duplicate formatter values",
      actions: [formatter, formatter],
    })
    await assert.rejects(
      validateAutomationConfiguration(prismaClient, "tenant-1", duplicate),
      /already created by an earlier formatter/,
    )
  })

  test("validates compatible number formatter sources and shared output ordering", async () => {
    const prismaClient = {
      opportunityPipeline: { findUnique: async () => ({ id: "pipeline-1", stages: [] }) },
      contactCustomField: { findMany: async () => [{
        id: "field-premium",
        key: "premium",
        label: "Premium",
        fieldType: "CURRENCY",
        isRequired: false,
        isActive: true,
        isEncrypted: false,
        isSensitive: false,
        options: [],
      }] },
      contactStatusConfig: { findMany: async () => [] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [] },
    }
    const raw = {
      type: "FORMAT_NUMBER" as const,
      numberFormatterConfig: {
        mode: "TEXT_TO_NUMBER" as const,
        source: { type: "CUSTOM_FIELD" as const, key: "premium" },
        decimalMark: "PERIOD" as const,
        outputKey: "raw_premium",
      },
    }
    const formatted = {
      type: "FORMAT_NUMBER" as const,
      numberFormatterConfig: {
        mode: "FORMAT_CURRENCY" as const,
        source: { type: "AUTOMATION_VALUE" as const, key: "raw_premium" },
        decimalMark: "PERIOD" as const,
        currencyCode: "USD" as const,
        outputKey: "premium_label",
      },
    }
    const note = {
      type: "ADD_CONTACT_NOTE" as const,
      noteTitle: "Premium",
      noteBody: "Current premium: {automation.premium_label}",
    }
    const valid = AutomationUpsertSchema.parse({
      name: "Format premium",
      isEnabled: false,
      trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      conditions: [],
      actions: [raw, formatted, note],
    })
    const normalized = await validateAutomationConfiguration(prismaClient, "tenant-1", valid)
    assert.equal(normalized.actions[1]?.type, "FORMAT_NUMBER")

    const forwardReference = AutomationUpsertSchema.parse({
      ...valid,
      actions: [formatted, raw, note],
    })
    await assert.rejects(
      validateAutomationConfiguration(prismaClient, "tenant-1", forwardReference),
      /not available before this action/,
    )
  })

  test("validates Text formatter sources, custom labels, and typed chaining", async () => {
    const prismaClient = {
      opportunityPipeline: { findUnique: async () => ({ id: "pipeline-1", stages: [] }) },
      contactCustomField: { findMany: async () => [{
        id: "field-notes",
        key: "intake_notes",
        label: "Intake notes",
        fieldType: "TEXTAREA",
        isRequired: false,
        isActive: true,
        isEncrypted: false,
        isSensitive: false,
        options: [],
      }] },
      contactStatusConfig: { findMany: async () => [] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [] },
    }
    const valid = AutomationUpsertSchema.parse({
      name: "Normalize contact text",
      isEnabled: false,
      trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      conditions: [],
      actions: [
        {
          type: "FORMAT_TEXT",
          textFormatterConfig: {
            actionName: "Normalize intake notes",
            mode: "TITLE_CASE",
            source: { type: "CUSTOM_FIELD", key: "intake_notes" },
            outputKey: "normalized_notes",
          },
        },
        {
          type: "FORMAT_TEXT",
          textFormatterConfig: {
            actionName: "Count note characters",
            mode: "LENGTH",
            source: { type: "AUTOMATION_VALUE", key: "normalized_notes" },
            outputKey: "note_length",
          },
        },
        {
          type: "FORMAT_NUMBER",
          numberFormatterConfig: {
            mode: "FORMAT_NUMBER",
            source: { type: "AUTOMATION_VALUE", key: "note_length" },
            decimalMark: "PERIOD",
            groupingStyle: "COMMA_PERIOD",
            outputKey: "note_length_label",
          },
        },
        {
          type: "ADD_CONTACT_NOTE",
          noteTitle: "Intake summary",
          noteBody: "{automation.normalized_notes} ({automation.note_length_label})",
        },
      ],
    })
    const normalized = await validateAutomationConfiguration(prismaClient, "tenant-1", valid)
    assert.equal(normalized.actions[0]?.type, "FORMAT_TEXT")
    assert.deepEqual(
      (normalized.actions[0] as any).textFormatterConfig,
      (valid.actions[0] as any)?.textFormatterConfig,
    )

    const incompatible = AutomationUpsertSchema.parse({
      ...valid,
      actions: [valid.actions[1], valid.actions[0]],
    })
    await assert.rejects(
      validateAutomationConfiguration(prismaClient, "tenant-1", incompatible),
      /not available before this action/,
    )
  })

  test("validates Math chaining and typed date formatter sources", async () => {
    const prismaClient = {
      opportunityPipeline: { findUnique: async () => ({ id: "pipeline-1", stages: [] }) },
      contactCustomField: { findMany: async () => [
        {
          id: "field-premium",
          key: "premium",
          label: "Premium",
          fieldType: "CURRENCY",
          isRequired: false,
          isActive: true,
          isEncrypted: false,
          isSensitive: false,
          options: [],
        },
        {
          id: "field-renewal",
          key: "renewal_date",
          label: "Renewal date",
          fieldType: "DATE",
          isRequired: false,
          isActive: true,
          isEncrypted: false,
          isSensitive: false,
          options: [],
        },
      ] },
      contactStatusConfig: { findMany: async () => [] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [] },
    }
    const actions = [
      {
        type: "FORMAT_NUMBER" as const,
        numberFormatterConfig: {
          mode: "TEXT_TO_NUMBER" as const,
          source: { type: "CUSTOM_FIELD" as const, key: "premium" },
          decimalMark: "PERIOD" as const,
          outputKey: "raw_premium",
        },
      },
      {
        type: "MATH_OPERATION" as const,
        mathOperationConfig: {
          mode: "NUMBER" as const,
          source: { type: "AUTOMATION_VALUE" as const, key: "raw_premium" },
          operation: "MULTIPLY" as const,
          operand: 1.1,
          outputKey: "adjusted_premium",
        },
      },
      {
        type: "MATH_OPERATION" as const,
        mathOperationConfig: {
          mode: "NUMBER" as const,
          source: { type: "AUTOMATION_VALUE" as const, key: "adjusted_premium" },
          operation: "ADD" as const,
          operand: 25,
          outputKey: "renewal_premium",
        },
      },
      {
        type: "FORMAT_NUMBER" as const,
        numberFormatterConfig: {
          mode: "FORMAT_CURRENCY" as const,
          source: { type: "AUTOMATION_VALUE" as const, key: "renewal_premium" },
          decimalMark: "PERIOD" as const,
          currencyCode: "USD",
          outputKey: "renewal_premium_label",
        },
      },
      {
        type: "MATH_OPERATION" as const,
        mathOperationConfig: {
          mode: "DATE" as const,
          source: { type: "CUSTOM_FIELD" as const, key: "renewal_date" },
          operation: "ADD" as const,
          amount: 1,
          unit: "YEARS" as const,
          outputKey: "next_renewal",
        },
      },
      {
        type: "FORMAT_DATE_TIME" as const,
        dateTimeFormatterConfig: {
          mode: "DATE" as const,
          source: { type: "AUTOMATION_VALUE" as const, key: "next_renewal" },
          format: "MMM D, YYYY" as const,
          outputKey: "renewal_label",
        },
      },
    ]
    const valid = AutomationUpsertSchema.parse({
      name: "Calculate renewal",
      isEnabled: false,
      trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      conditions: [],
      actions,
    })
    const normalized = await validateAutomationConfiguration(prismaClient, "tenant-1", valid)
    assert.equal(normalized.actions[1]?.type, "MATH_OPERATION")
    assert.equal(normalized.actions[2]?.type, "MATH_OPERATION")
    assert.equal(normalized.actions[3]?.type, "FORMAT_NUMBER")
    assert.equal(normalized.actions[5]?.type, "FORMAT_DATE_TIME")

    const formattedNumberFirst = AutomationUpsertSchema.parse({
      ...valid,
      actions: [
        {
          type: "FORMAT_NUMBER",
          numberFormatterConfig: {
            mode: "FORMAT_NUMBER",
            source: { type: "CUSTOM_FIELD", key: "premium" },
            decimalMark: "PERIOD",
            groupingStyle: "COMMA_PERIOD",
            outputKey: "formatted_premium",
          },
        },
        {
          type: "MATH_OPERATION",
          mathOperationConfig: {
            mode: "NUMBER",
            source: { type: "AUTOMATION_VALUE", key: "formatted_premium" },
            operation: "ADD",
            operand: 1,
            outputKey: "invalid_total",
          },
        },
      ],
    })
    await assert.rejects(
      validateAutomationConfiguration(prismaClient, "tenant-1", formattedNumberFirst),
      /not a number/,
    )
  })

  test("validates and sanitizes add-contact-note actions", () => {
    const result = AutomationUpsertSchema.safeParse({
      name: "Add a note",
      isEnabled: false,
      trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      conditions: [],
      actions: [{
        type: "ADD_CONTACT_NOTE",
        noteTitle: " <strong>New opportunity</strong> ",
        noteBody: " First line\r\n<script>ignored</script> Second line ",
      }],
    })

    assert.equal(result.success, true)
    if (!result.success) return
    assert.equal(result.data.actions[0]?.type, "ADD_CONTACT_NOTE")
    if (result.data.actions[0]?.type !== "ADD_CONTACT_NOTE") return
    assert.equal(result.data.actions[0].noteTitle, "New opportunity")
    assert.equal(result.data.actions[0].noteBody, "First line\nignored Second line")

    assert.equal(AutomationUpsertSchema.safeParse({
      name: "Invalid note",
      isEnabled: false,
      trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      conditions: [],
      actions: [{ type: "ADD_CONTACT_NOTE", noteTitle: "<span></span>", noteBody: "Body" }],
    }).success, false)
  })

  test("validates duration and fixed-date wait shapes", () => {
    const base = {
      name: "Wait for follow-up",
      isEnabled: false,
      trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      conditions: [],
    }
    assert.equal(AutomationUpsertSchema.safeParse({
      ...base,
      actions: [{ type: "WAIT", waitConfig: { mode: "DURATION", amount: 30, unit: "MINUTES" } }],
    }).success, true)
    assert.equal(AutomationUpsertSchema.safeParse({
      ...base,
      actions: [{
        type: "WAIT",
        waitConfig: {
          mode: "FIXED_DATE",
          dateTime: "2026-10-01T15:00:00.000Z",
          timing: "BEFORE",
          pastBehavior: "CONTINUE",
        },
      }],
    }).success, false)
  })

  test("rejects a wait go-to destination that is not later in the flow", async () => {
    const waitNodeKey = "00000000-0000-4000-8000-000000000001"
    const earlierNodeKey = "00000000-0000-4000-8000-000000000002"
    const input = AutomationUpsertSchema.parse({
      name: "Invalid jump",
      isEnabled: false,
      trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      conditions: [],
      actions: [
        { type: "SET_CONTACT_STATUS", nodeKey: earlierNodeKey, statusConfigId: "active" },
        {
          type: "WAIT",
          nodeKey: waitNodeKey,
          waitConfig: {
            mode: "FIXED_DATE",
            dateTime: "2026-01-01T00:00:00.000Z",
            timing: "ON",
            pastBehavior: "GO_TO_STEP",
            targetNodeKey: earlierNodeKey,
          },
        },
      ],
    })
    const prismaClient = {
      opportunityPipeline: { findUnique: async () => ({ id: "pipeline-1", stages: [] }) },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [{ id: "active", isActive: true }] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [] },
    }
    await assert.rejects(
      validateAutomationConfiguration(prismaClient, "tenant-1", input),
      /only go to an action that appears later/,
    )
  })

  test("requires delete contact to be the final action", async () => {
    const prismaClient = {
      opportunityPipeline: { findUnique: async () => ({ id: "pipeline-1", stages: [] }) },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [{ id: "active", isActive: true }] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [] },
    }
    const base = {
      name: "Delete completed contact",
      isEnabled: false,
      trigger: { type: "OPPORTUNITY_CREATED" as const, pipelineId: "pipeline-1" },
      conditions: [],
    }
    const valid = AutomationUpsertSchema.parse({
      ...base,
      actions: [
        { type: "SET_CONTACT_STATUS", statusConfigId: "active" },
        { type: "DELETE_CONTACT" },
      ],
    })
    const normalized = await validateAutomationConfiguration(prismaClient, "tenant-1", valid)
    assert.equal(normalized.actions.at(-1)?.type, "DELETE_CONTACT")

    const invalid = AutomationUpsertSchema.parse({
      ...base,
      actions: [
        { type: "DELETE_CONTACT" },
        { type: "SET_CONTACT_STATUS", statusConfigId: "active" },
      ],
    })
    await assert.rejects(
      validateAutomationConfiguration(prismaClient, "tenant-1", invalid),
      /only be the last action/,
    )
  })

  test("normalizes recursive If/Else branches and enforces terminal placement", async () => {
    const prismaClient = {
      opportunityPipeline: { findUnique: async () => ({ id: "pipeline-1", stages: [] }) },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [{ id: "active", isActive: true }] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [] },
    }
    const ifElse = {
      type: "IF_ELSE" as const,
      ifElseConfig: {
        actionName: "Route qualified contacts",
        branches: [
          {
            name: "Qualified",
            isDefault: false,
            matchMode: "ALL" as const,
            conditions: [{
              source: "CONTACT_FIELD" as const,
              fieldKey: "name",
              operator: "EQUALS" as const,
              compareValue: "John",
            }],
            actions: [{ type: "SET_CONTACT_STATUS" as const, statusConfigId: "active" }],
          },
          {
            name: "Default",
            isDefault: true,
            matchMode: "ALL" as const,
            conditions: [],
            actions: [],
          },
        ],
      },
    }
    const base = {
      name: "Branch contacts",
      isEnabled: false,
      trigger: { type: "OPPORTUNITY_CREATED" as const, pipelineId: "pipeline-1" },
      conditions: [],
    }
    const valid = AutomationUpsertSchema.parse({ ...base, actions: [ifElse] })
    const normalized = await validateAutomationConfiguration(prismaClient, "tenant-1", valid)
    const config = normalized.actions[0]?.ifElseConfig
    assert.equal(normalized.actions[0]?.type, "IF_ELSE")
    assert.equal(typeof normalized.actions[0]?.nodeKey, "string")
    assert.equal(typeof config?.branches[0]?.branchKey, "string")
    assert.equal(typeof config?.branches[0]?.conditions[0]?.conditionKey, "string")

    const withDefaultActions = AutomationUpsertSchema.parse({
      ...base,
      actions: [{
        ...ifElse,
        ifElseConfig: {
          ...ifElse.ifElseConfig,
          branches: [
            ifElse.ifElseConfig.branches[0],
            {
              ...ifElse.ifElseConfig.branches[1],
              actions: [{ type: "SET_CONTACT_STATUS", statusConfigId: "active" }],
            },
          ],
        },
      }],
    })
    const normalizedWithDefaultActions = await validateAutomationConfiguration(prismaClient, "tenant-1", withDefaultActions)
    assert.equal(normalizedWithDefaultActions.actions[0]?.ifElseConfig?.branches[1]?.actions[0]?.type, "SET_CONTACT_STATUS")
    assert.equal(typeof normalizedWithDefaultActions.actions[0]?.ifElseConfig?.branches[1]?.actions[0]?.nodeKey, "string")

    const defaultWithConditions = AutomationUpsertSchema.parse({
      ...base,
      actions: [{
        ...ifElse,
        ifElseConfig: {
          ...ifElse.ifElseConfig,
          branches: [ifElse.ifElseConfig.branches[0], {
            ...ifElse.ifElseConfig.branches[1],
            conditions: ifElse.ifElseConfig.branches[0].conditions,
          }],
        },
      }],
    })
    await assert.rejects(
      validateAutomationConfiguration(prismaClient, "tenant-1", defaultWithConditions),
      /Default branch cannot contain conditions/,
    )

    const invalid = AutomationUpsertSchema.parse({
      ...base,
      actions: [ifElse, { type: "SET_CONTACT_STATUS", statusConfigId: "active" }],
    })
    await assert.rejects(
      validateAutomationConfiguration(prismaClient, "tenant-1", invalid),
      /only be the final action in its path/,
    )
  })

  test("normalizes Split routes, permits empty controls, and requires a 100% total", async () => {
    const prismaClient = {
      opportunityPipeline: { findUnique: async () => ({ id: "pipeline-1", stages: [] }) },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [{ id: "active", isActive: true }] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [] },
    }
    const split = {
      type: "SPLIT" as const,
      splitConfig: {
        actionName: "Random experiment",
        routes: [
          {
            name: "Treatment",
            percentage: 60,
            actions: [{ type: "SET_CONTACT_STATUS" as const, statusConfigId: "active" }],
          },
          { name: "Control", percentage: 40, actions: [] },
        ],
      },
    }
    const base = {
      name: "Split contacts",
      isEnabled: false,
      trigger: { type: "OPPORTUNITY_CREATED" as const, pipelineId: "pipeline-1" },
      conditions: [],
    }
    const valid = AutomationUpsertSchema.parse({ ...base, actions: [split] })
    const normalized = await validateAutomationConfiguration(prismaClient, "tenant-1", valid)
    assert.equal(normalized.actions[0]?.type, "SPLIT")
    assert.equal(typeof normalized.actions[0]?.nodeKey, "string")
    assert.equal(typeof normalized.actions[0]?.splitConfig?.routes[0]?.branchKey, "string")
    assert.equal(normalized.actions[0]?.splitConfig?.routes[1]?.actions.length, 0)

    const invalidPercentages = AutomationUpsertSchema.parse({
      ...base,
      actions: [{
        ...split,
        splitConfig: {
          ...split.splitConfig,
          routes: split.splitConfig.routes.map((route) => ({ ...route, percentage: 30 })),
        },
      }],
    })
    await assert.rejects(
      validateAutomationConfiguration(prismaClient, "tenant-1", invalidPercentages),
      /must total 100%/,
    )

    const invalidPlacement = AutomationUpsertSchema.parse({
      ...base,
      actions: [split, { type: "SET_CONTACT_STATUS", statusConfigId: "active" }],
    })
    await assert.rejects(
      validateAutomationConfiguration(prismaClient, "tenant-1", invalidPlacement),
      /only be the final action in its path/,
    )
  })

  test("validates Update/create opportunity targets and refreshes saved name snapshots", async () => {
    const prismaClient = {
      opportunityPipeline: { findMany: async () => [
        { id: "pipeline-1", name: "Work", stages: [{ id: "stage-1", name: "New" }] },
        { id: "pipeline-2", name: "Renewals", stages: [{ id: "stage-2", name: "Follow-up" }] },
      ] },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [] },
    }
    const valid = AutomationUpsertSchema.parse({
      name: "Move opportunity",
      isEnabled: true,
      trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      conditions: [],
      actions: [{
        type: "UPDATE_OPPORTUNITY",
        opportunityConfig: {
          actionName: "  Move renewal  ",
          pipelineId: "pipeline-2",
          pipelineNameSnapshot: "Old pipeline name",
          stageId: "stage-2",
          stageNameSnapshot: "Old stage name",
          resultMode: "OPEN",
          valueCents: 5_000,
        },
      }],
    })
    const normalized = await validateAutomationConfiguration(prismaClient, "tenant-1", valid)
    assert.deepEqual(normalized.actions[0]?.opportunityConfig, {
      actionName: "Move renewal",
      pipelineId: "pipeline-2",
      pipelineNameSnapshot: "Renewals",
      stageId: "stage-2",
      stageNameSnapshot: "Follow-up",
      resultMode: "OPEN",
      valueCents: 5_000,
    })

    const legacyConfig = AutomationOpportunityConfigSchema.parse({
      actionName: "Legacy opportunity action",
      pipelineId: "pipeline-2",
      pipelineNameSnapshot: "Renewals",
      stageId: "stage-2",
      stageNameSnapshot: "Follow-up",
      resultMode: "KEEP_CURRENT",
      createValueCents: 7_500,
    })
    assert.equal(legacyConfig.valueCents, 7_500)
    assert.equal("createValueCents" in legacyConfig, false)

    const invalid = AutomationUpsertSchema.parse({
      ...valid,
      actions: [{
        ...valid.actions[0],
        opportunityConfig: { ...(valid.actions[0] as any).opportunityConfig, stageId: "stage-1" },
      }],
    })
    await assert.rejects(
      validateAutomationConfiguration(prismaClient, "tenant-1", invalid),
      /belongs to the selected opportunity pipeline/,
    )
  })

  test("validates Delete opportunity pipelines and refreshes the saved name snapshot", async () => {
    const prismaClient = {
      opportunityPipeline: { findMany: async () => [
        { id: "pipeline-1", name: "Work", stages: [{ id: "stage-1", name: "New" }] },
        { id: "pipeline-2", name: "Renewals", stages: [] },
      ] },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [] },
    }
    const valid = AutomationUpsertSchema.parse({
      name: "Delete renewal opportunity",
      isEnabled: true,
      trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      conditions: [],
      actions: [{
        type: "DELETE_OPPORTUNITY",
        deleteOpportunityConfig: {
          actionName: "  Remove renewal  ",
          pipelineId: "pipeline-2",
          pipelineNameSnapshot: "Old pipeline name",
        },
      }],
    })
    const normalized = await validateAutomationConfiguration(prismaClient, "tenant-1", valid)
    assert.deepEqual(normalized.actions[0]?.deleteOpportunityConfig, {
      actionName: "Remove renewal",
      pipelineId: "pipeline-2",
      pipelineNameSnapshot: "Renewals",
    })
    assert.deepEqual(
      AutomationDeleteOpportunityConfigSchema.parse(normalized.actions[0]?.deleteOpportunityConfig),
      normalized.actions[0]?.deleteOpportunityConfig,
    )

    const invalid = AutomationUpsertSchema.parse({
      ...valid,
      actions: [{
        ...(valid.actions[0] as any),
        deleteOpportunityConfig: {
          ...(valid.actions[0] as any).deleteOpportunityConfig,
          pipelineId: "missing-pipeline",
        },
      }],
    })
    await assert.rejects(
      validateAutomationConfiguration(prismaClient, "tenant-1", invalid),
      /Select an available opportunity pipeline/,
    )
  })

  test("validates published workflow targets, refreshes snapshots, and rejects dependency cycles", async () => {
    const sourceId = "00000000-0000-4000-8000-000000000101"
    const targetId = "00000000-0000-4000-8000-000000000102"
    const baseClient = {
      opportunityPipeline: { findMany: async () => [
        { id: "pipeline-1", name: "Work", stages: [{ id: "stage-1", name: "New" }] },
      ] },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [] },
    }
    const payload = AutomationUpsertSchema.parse({
      name: "Lead intake",
      isEnabled: true,
      trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      conditions: [],
      actions: [{
        type: "ADD_TO_WORKFLOW",
        addToWorkflowConfig: {
          actionName: "  Start onboarding  ",
          targetAutomationId: targetId,
          targetAutomationNameSnapshot: "Old name",
        },
      }],
    })
    const valid = await validateAutomationConfiguration({
      ...baseClient,
      automation: { findMany: async () => [{ id: targetId, name: "Client onboarding", actions: [] }] },
    }, "tenant-1", payload, { sourceAutomationId: sourceId })
    assert.deepEqual(valid.actions[0]?.addToWorkflowConfig, {
      actionName: "Start onboarding",
      targetAutomationId: targetId,
      targetAutomationNameSnapshot: "Client onboarding",
    })

    await assert.rejects(
      validateAutomationConfiguration({
        ...baseClient,
        automation: { findMany: async () => [
          {
            id: targetId,
            name: "Client onboarding",
            actions: [{
              type: "ADD_TO_WORKFLOW",
              addToWorkflowConfig: {
                actionName: "Back to intake",
                targetAutomationId: sourceId,
                targetAutomationNameSnapshot: "Lead intake",
              },
            }],
          },
          { id: sourceId, name: "Lead intake", actions: [] },
        ] },
      }, "tenant-1", payload, { sourceAutomationId: sourceId }),
      (error: any) => error?.code === "AUTOMATION_WORKFLOW_CYCLE",
    )
  })

  test("validates Remove from workflow targets, refreshes snapshots, and allows self targeting", async () => {
    const sourceId = "00000000-0000-4000-8000-000000000201"
    const targetId = "00000000-0000-4000-8000-000000000202"
    const baseClient = {
      opportunityPipeline: { findMany: async () => [
        { id: "pipeline-1", name: "Work", stages: [{ id: "stage-1", name: "New" }] },
      ] },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [] },
    }
    const removalPayload = (targetAutomationId: string) => AutomationUpsertSchema.parse({
      name: "Renamed lead intake",
      isEnabled: true,
      trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      conditions: [],
      actions: [{
        type: "REMOVE_FROM_WORKFLOW",
        removeFromWorkflowConfig: {
          actionName: "  End workflow  ",
          targetAutomationId,
          targetAutomationNameSnapshot: "Old name",
        },
      }],
    })
    const published = [
      { id: sourceId, name: "Lead intake", actions: [] },
      {
        id: targetId,
        name: "Client nurture",
        actions: [{
          type: "ADD_TO_WORKFLOW",
          addToWorkflowConfig: {
            actionName: "Back to intake",
            targetAutomationId: sourceId,
            targetAutomationNameSnapshot: "Lead intake",
          },
        }],
      },
    ]

    const external = await validateAutomationConfiguration({
      ...baseClient,
      automation: { findMany: async () => published },
    }, "tenant-1", removalPayload(targetId), { sourceAutomationId: sourceId })
    assert.deepEqual(external.actions[0]?.removeFromWorkflowConfig, {
      actionName: "End workflow",
      targetAutomationId: targetId,
      targetAutomationNameSnapshot: "Client nurture",
    })

    const self = await validateAutomationConfiguration({
      ...baseClient,
      automation: { findMany: async () => published },
    }, "tenant-1", removalPayload(sourceId), { sourceAutomationId: sourceId })
    assert.equal(self.actions[0]?.removeFromWorkflowConfig?.targetAutomationNameSnapshot, "Renamed lead intake")

    await assert.rejects(
      validateAutomationConfiguration({
        ...baseClient,
        automation: { findMany: async () => published.filter((automation) => automation.id !== targetId) },
      }, "tenant-1", removalPayload(targetId), { sourceAutomationId: sourceId }),
      (error: any) => error?.code === "TARGET_AUTOMATION_NOT_PUBLISHED",
    )
  })
})

describe("executeOpportunityAutomations", () => {
  test("matches a stage trigger by the stage entered, regardless of the source stage", async () => {
    let where: Record<string, unknown> | undefined
    const prismaTx = {
      automation: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          where = args.where
          return []
        },
      },
    }

    await executeOpportunityAutomations(prismaTx, {
      tenantId: "tenant-1",
      actorUserId: "user-1",
      triggerType: "OPPORTUNITY_STAGE_CHANGED",
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-1",
      valueCents: 0,
      sourceStageId: "stage-1",
      targetStageId: "stage-2",
    })

    assert.deepEqual(where, {
      tenantId: "tenant-1",
      isEnabled: true,
      triggerType: "OPPORTUNITY_STAGE_CHANGED",
      pipelineId: "pipeline-1",
      targetStageId: "stage-2",
    })
  })

  test("scopes opportunity-created candidates to the event trigger and pipeline", async () => {
    let where: Record<string, unknown> | undefined
    let nodeLogWrites = 0
    const result = await executeOpportunityAutomations({
      automation: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          where = args.where
          return []
        },
      },
      automationNodeExecution: {
        createMany: async () => { nodeLogWrites += 1 },
      },
    }, {
      tenantId: "tenant-1",
      actorUserId: "user-1",
      triggerType: "OPPORTUNITY_CREATED",
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-work",
      valueCents: 0,
      sourceStageId: null,
      targetStageId: "stage-new",
    })

    assert.deepEqual(where, {
      tenantId: "tenant-1",
      isEnabled: true,
      triggerType: "OPPORTUNITY_CREATED",
      pipelineId: "pipeline-work",
    })
    assert.equal(result.matchedCount, 0)
    assert.equal(result.executedCount, 0)
    assert.equal(nodeLogWrites, 0)
  })

  test("does not persist a run or logs when a contact does not match the trigger filters", async () => {
    let contactUpdates = 0
    let tagRemovals = 0
    let executions = 0
    let runs = 0
    let nodeLogs: Array<Record<string, unknown>> = []
    const prismaTx = {
      automation: {
        findMany: async () => [
          {
            id: "automation-1",
            name: "John opportunities",
            triggerType: "OPPORTUNITY_CREATED",
            pipelineId: "pipeline-work",
            targetStageId: null,
            conditions: [
              {
                source: "CONTACT_ASSIGNEE",
                operator: "EQUALS",
                assignedUserId: "john",
              },
              {
                source: "CONTACT_STATUS",
                operator: "EQUALS",
                statusConfigId: "inactive",
              },
            ],
            actions: [
              { type: "REMOVE_CONTACT_TAG", tagId: "lead-tag" },
              { type: "SET_CONTACT_STATUS", statusConfigId: "inactive" },
              { type: "ADD_CONTACT_NOTE", noteTitle: "Should not run", noteBody: "Filters did not match." },
            ],
          },
        ],
      },
      contact: {
        findFirst: async () => ({
          id: "contact-1",
          firstName: "Taylor",
          middleName: null,
          lastName: "Reed",
          statusConfigId: "active",
          assignedToUserId: "mary",
          tags: [{ tagId: "lead-tag" }],
          customFieldValues: [],
        }),
        update: async () => {
          contactUpdates += 1
        },
      },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [
        { id: "active", name: "Active" },
        { id: "inactive", name: "Inactive" },
      ] },
      membership: { findMany: async () => [
        { userId: "john", user: { name: "John", email: "john@example.com" } },
        { userId: "mary", user: { name: "Mary", email: "mary@example.com" } },
      ] },
      tenantTag: { findMany: async () => [{ id: "lead-tag", name: "Lead" }] },
      opportunityPipeline: { findMany: async () => [{ id: "pipeline-work", name: "Work", stages: [] }] },
      contactTag: {
        deleteMany: async () => {
          tagRemovals += 1
        },
      },
      contactNote: {
        create: async () => {
          throw new Error("The note action must not run when filters do not match.")
        },
      },
      automationExecution: {
        create: async () => {
          executions += 1
        },
      },
      automationRun: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          runs += 1
          return { id: "run-1", ...data }
        },
        update: async () => undefined,
      },
      automationNodeExecution: {
        createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
          nodeLogs = data
        },
      },
    }

    const result = await executeOpportunityAutomations(prismaTx, {
      tenantId: "tenant-1",
      actorUserId: "user-1",
      triggerType: "OPPORTUNITY_CREATED",
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-work",
      valueCents: 0,
      sourceStageId: null,
      targetStageId: "stage-new",
    })

    assert.deepEqual(result, {
      matchedCount: 0,
      executedCount: 0,
      notificationIds: [],
      fileCleanupCandidates: [],
      contactDeleted: false,
    })
    assert.equal(tagRemovals, 0)
    assert.equal(contactUpdates, 0)
    assert.equal(executions, 0)
    assert.equal(runs, 0)
    assert.deepEqual(nodeLogs, [])
  })

  test("runs a published automation without requiring prior contact enrollment", async () => {
    let contactUpdates = 0
    let tagRemovals = 0
    let executions = 0
    let nodeLogs: Array<Record<string, unknown>> = []
    const prismaTx = {
      automation: {
        findMany: async () => [
          {
            id: "automation-1",
            name: "John opportunities",
            triggerType: "OPPORTUNITY_CREATED",
            pipelineId: "pipeline-work",
            targetStageId: null,
            conditions: [
              {
                source: "CONTACT_ASSIGNEE",
                operator: "EQUALS",
                assignedUserId: "john",
              },
            ],
            actions: [
              { type: "REMOVE_CONTACT_TAG", tagId: "lead-tag" },
              { type: "SET_CONTACT_STATUS", statusConfigId: "inactive" },
            ],
          },
        ],
      },
      contact: {
        findFirst: async () => ({
          id: "contact-1",
          firstName: "Taylor",
          middleName: null,
          lastName: "Reed",
          statusConfigId: "active",
          assignedToUserId: "john",
          tags: [{ tagId: "lead-tag" }],
          customFieldValues: [],
        }),
        update: async () => {
          contactUpdates += 1
        },
      },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [{ id: "inactive", name: "Inactive" }] },
      membership: { findMany: async () => [{ userId: "john", user: { name: "John", email: "john@example.com" } }] },
      tenantTag: { findMany: async () => [{ id: "lead-tag", name: "Lead" }] },
      opportunityPipeline: { findMany: async () => [{ id: "pipeline-work", name: "Work", stages: [] }] },
      contactTag: {
        deleteMany: async () => {
          tagRemovals += 1
        },
      },
      automationExecution: {
        create: async () => {
          executions += 1
        },
      },
      automationRun: {
        create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "run-1", ...data }),
        update: async () => undefined,
      },
      automationNodeExecution: {
        createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
          nodeLogs = data
        },
      },
    }

    const result = await executeOpportunityAutomations(prismaTx, {
      tenantId: "tenant-1",
      actorUserId: "user-1",
      triggerType: "OPPORTUNITY_CREATED",
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-work",
      valueCents: 0,
      sourceStageId: null,
      targetStageId: "stage-new",
    })

    assert.deepEqual(result, {
      matchedCount: 1,
      executedCount: 1,
      notificationIds: [],
      fileCleanupCandidates: [],
      contactDeleted: false,
    })
    assert.equal(tagRemovals, 1)
    assert.equal(contactUpdates, 1)
    assert.equal(executions, 1)
    assert.deepEqual(nodeLogs.map((log) => log.status), ["EXECUTED", "EXECUTED", "EXECUTED"])
  })

  test("deletes the contact as a terminal action and skips later automations", async () => {
    let runCreates = 0
    let contactDeletes = 0
    let contactUpdates = 0
    let exitedRunWhere: Record<string, unknown> | null = null
    let deletedFileWhere: Record<string, unknown> | null = null
    let nodeLogs: Array<Record<string, unknown>> = []
    const prismaTx = {
      automation: {
        findMany: async () => [
          {
            id: "automation-delete",
            name: "Delete finished contact",
            triggerType: "OPPORTUNITY_CREATED",
            pipelineId: "pipeline-work",
            targetStageId: null,
            conditions: [],
            actions: [{
              nodeKey: "00000000-0000-4000-8000-000000000001",
              type: "DELETE_CONTACT",
            }],
          },
          {
            id: "automation-later",
            name: "Must not run",
            triggerType: "OPPORTUNITY_CREATED",
            pipelineId: "pipeline-work",
            targetStageId: null,
            conditions: [],
            actions: [{
              nodeKey: "00000000-0000-4000-8000-000000000002",
              type: "SET_CONTACT_STATUS",
              statusConfigId: "inactive",
            }],
          },
        ],
      },
      contact: {
        findFirst: async () => ({
          id: "contact-1",
          firstName: "Taylor",
          middleName: null,
          lastName: "Reed",
          statusConfigId: "active",
          assignedToUserId: null,
          tags: [],
          customFieldValues: [],
        }),
        update: async () => { contactUpdates += 1 },
        deleteMany: async () => {
          contactDeletes += 1
          return { count: 1 }
        },
      },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [
        { id: "active", name: "Active" },
        { id: "inactive", name: "Inactive" },
      ] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [] },
      opportunityPipeline: {
        findMany: async () => [{ id: "pipeline-work", name: "Work", stages: [] }],
      },
      automationRun: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          runCreates += 1
          return { id: `run-${runCreates}`, ...data }
        },
        update: async () => undefined,
        updateMany: async ({ where }: { where: Record<string, unknown> }) => {
          if (where.contactId) exitedRunWhere = where
          return { count: 1 }
        },
      },
      automationExecution: { create: async () => undefined },
      automationNodeExecution: {
        updateMany: async () => ({ count: 1 }),
        createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
          nodeLogs = data
        },
      },
      automationProcessContact: { updateMany: async () => ({ count: 0 }) },
      notification: { updateMany: async () => ({ count: 0 }) },
      contactNoteAttachment: {
        findMany: async () => [{
          file: { id: "file-1", tenantId: "tenant-1", key: "notes/file-1.pdf" },
        }],
      },
      contactServiceNoteAttachment: {
        findMany: async () => [
          { file: { id: "file-1", tenantId: "tenant-1", key: "notes/file-1.pdf" } },
          { file: { id: "file-2", tenantId: "tenant-1", key: "notes/file-2.pdf" } },
        ],
      },
      file: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          assert.deepEqual(where, {
            id: { in: ["file-1", "file-2"] },
            noteAttachments: { none: {} },
            serviceNoteAttachments: { none: {} },
          })
          return [{ id: "file-1", tenantId: "tenant-1", key: "notes/file-1.pdf" }]
        },
        deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
          deletedFileWhere = where
          return { count: 1 }
        },
      },
    }

    const result = await executeOpportunityAutomations(prismaTx, {
      tenantId: "tenant-1",
      actorUserId: "user-1",
      triggerType: "OPPORTUNITY_CREATED",
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-work",
      valueCents: 0,
      sourceStageId: null,
      targetStageId: "stage-new",
    })

    assert.deepEqual(result, {
      matchedCount: 2,
      executedCount: 1,
      notificationIds: [],
      fileCleanupCandidates: [
        { id: "file-1", tenantId: "tenant-1", key: "notes/file-1.pdf" },
      ],
      contactDeleted: true,
    })
    assert.equal(runCreates, 1)
    assert.equal(contactDeletes, 1)
    assert.equal(contactUpdates, 0)
    assert.deepEqual(deletedFileWhere, { id: { in: ["file-1"] } })
    assert.deepEqual(exitedRunWhere, {
      tenantId: "tenant-1",
      contactId: "contact-1",
      status: { in: ["QUEUED", "RUNNING", "WAITING"] },
      id: { not: "run-1" },
    })
    assert.deepEqual(nodeLogs.map((log) => log.status), [
      "EXECUTED",
      "EXECUTED",
      "EXECUTED",
      "SKIPPED",
    ])
    assert.ok(nodeLogs.every((log) => log.contactId === null))
    assert.equal(nodeLogs[3]?.reasonCode, "CONTACT_DELETED")
  })

  test("updates standard and custom fields in one logged action", async () => {
    const writes: Array<Record<string, unknown>> = []
    const clears: Array<Record<string, unknown>> = []
    const contactUpdates: Array<Record<string, unknown>> = []
    let nodeLogs: Array<Record<string, unknown>> = []
    const fields = [
      {
        id: "field-status",
        key: "review_status",
        label: "Review status",
        fieldType: "SELECT",
        isRequired: true,
        isActive: true,
        isEncrypted: false,
        isSensitive: false,
        options: ["Ready", "Pending"],
      },
      {
        id: "field-note",
        key: "old_note",
        label: "Old note",
        fieldType: "TEXT",
        isRequired: false,
        isActive: true,
        isEncrypted: false,
        isSensitive: false,
        options: [],
      },
    ]
    const prismaTx = {
      automation: {
        findMany: async () => [{
          id: "automation-1",
          name: "Prepare contact",
          triggerType: "OPPORTUNITY_CREATED",
          pipelineId: "pipeline-work",
          targetStageId: null,
          conditions: [],
          actions: [{
            nodeKey: "00000000-0000-4000-8000-000000000001",
            type: "UPDATE_CONTACT_CUSTOM_FIELDS",
            customFieldUpdates: [
              { contactFieldKey: "phone", operation: "SET", value: "+15551234567" },
              { customFieldId: "field-status", operation: "SET", value: "Ready" },
              { customFieldId: "field-note", operation: "CLEAR" },
            ],
          }],
        }],
      },
      contact: {
        findFirst: async () => ({
          id: "contact-1",
          firstName: "Taylor",
          middleName: null,
          lastName: "Reed",
          statusConfigId: "active",
          assignedToUserId: null,
          tags: [],
          customFieldValues: [],
        }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          contactUpdates.push(data)
        },
      },
      contactCustomField: { findMany: async () => fields },
      contactCustomFieldValue: {
        upsert: async ({ create }: { create: Record<string, unknown> }) => { writes.push(create) },
        deleteMany: async ({ where }: { where: Record<string, unknown> }) => { clears.push(where) },
      },
      contactStatusConfig: { findMany: async () => [{ id: "active", name: "Active" }] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [] },
      opportunityPipeline: { findMany: async () => [{ id: "pipeline-work", name: "Work", stages: [] }] },
      automationRun: {
        create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "run-1", ...data }),
        update: async () => undefined,
      },
      automationExecution: { create: async () => undefined },
      automationNodeExecution: {
        createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => { nodeLogs = data },
      },
    }

    await executeOpportunityAutomations(prismaTx, {
      tenantId: "tenant-1",
      actorUserId: "user-1",
      triggerType: "OPPORTUNITY_CREATED",
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-work",
      valueCents: 0,
      sourceStageId: null,
      targetStageId: "stage-new",
    })

    assert.equal(writes.length, 1)
    assert.equal(writes[0]?.fieldId, "field-status")
    assert.equal(writes[0]?.value, "Ready")
    assert.deepEqual(clears, [{ tenantId: "tenant-1", contactId: "contact-1", fieldId: "field-note" }])
    assert.deepEqual(contactUpdates, [{ phone: "+15551234567" }])
    assert.deepEqual(nodeLogs.map((log) => log.status), ["EXECUTED", "EXECUTED"])
    assert.equal(nodeLogs[1]?.details, "Updated 3 contact fields.")
  })

  test("validates every custom-field update before writing any of them", async () => {
    let writes = 0
    const prismaTx = {
      automation: {
        findMany: async () => [{
          id: "automation-1",
          name: "Invalid field update",
          triggerType: "OPPORTUNITY_CREATED",
          pipelineId: "pipeline-work",
          targetStageId: null,
          conditions: [],
          actions: [{
            nodeKey: "00000000-0000-4000-8000-000000000001",
            type: "UPDATE_CONTACT_CUSTOM_FIELDS",
            customFieldUpdates: [
              { customFieldId: "field-valid", operation: "SET", value: "Ready" },
              { customFieldId: "field-missing", operation: "SET", value: "Invalid" },
            ],
          }],
        }],
      },
      contact: {
        findFirst: async () => ({
          id: "contact-1",
          firstName: "Taylor",
          middleName: null,
          lastName: "Reed",
          statusConfigId: "active",
          assignedToUserId: null,
          tags: [],
          customFieldValues: [],
        }),
      },
      contactCustomField: { findMany: async () => [{
        id: "field-valid",
        key: "valid",
        label: "Valid field",
        fieldType: "TEXT",
        isRequired: false,
        isActive: true,
        isEncrypted: false,
        isSensitive: false,
        options: [],
      }] },
      contactCustomFieldValue: {
        upsert: async () => { writes += 1 },
        deleteMany: async () => { writes += 1 },
      },
      contactStatusConfig: { findMany: async () => [{ id: "active", name: "Active" }] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [] },
      opportunityPipeline: { findMany: async () => [{ id: "pipeline-work", name: "Work", stages: [] }] },
      automationRun: {
        create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "run-1", ...data }),
        update: async () => undefined,
      },
      automationExecution: { create: async () => undefined },
      automationNodeExecution: { createMany: async () => undefined },
    }

    await assert.rejects(
      executeOpportunityAutomations(prismaTx, {
        tenantId: "tenant-1",
        actorUserId: "user-1",
        triggerType: "OPPORTUNITY_CREATED",
        opportunityId: "opportunity-1",
        contactId: "contact-1",
        pipelineId: "pipeline-work",
        valueCents: 0,
        sourceStageId: null,
        targetStageId: "stage-new",
      }),
      (error: unknown) => {
        assert.ok(error instanceof AutomationExecutionError)
        assert.match(error.message, /configured custom field is unavailable/)
        assert.equal(error.nodeExecutions[1]?.status, "FAILED")
        return true
      },
    )
    assert.equal(writes, 0)
  })

  test("creates an automation-authored contact note and logs its title", async () => {
    const createdNotes: Array<Record<string, unknown>> = []
    let nodeLogs: Array<Record<string, unknown>> = []
    const prismaTx = {
      automation: {
        findMany: async () => [{
          id: "automation-1",
          name: "New opportunity notes",
          triggerType: "OPPORTUNITY_CREATED",
          pipelineId: "pipeline-work",
          targetStageId: null,
          conditions: [],
          actions: [{
            nodeKey: "00000000-0000-4000-8000-000000000001",
            type: "ADD_CONTACT_NOTE",
            noteTitle: "Opportunity for {contact.name}",
            noteBody: "Current balance: {contact.custom_field.balance|currency:USD}.",
          }],
        }],
      },
      contact: {
        findFirst: async (args: { select?: Record<string, unknown> }) => args.select?.email
          ? {
              firstName: "Taylor",
              middleName: null,
              lastName: "Reed",
              email: "taylor@example.com",
              statusConfig: { name: "Active" },
              customFieldValues: [{
                value: 2500,
                field: {
                  key: "balance",
                  fieldType: "CURRENCY",
                  isActive: true,
                  isEncrypted: false,
                  isSensitive: false,
                },
              }],
            }
          : {
              id: "contact-1",
              firstName: "Taylor",
              middleName: null,
              lastName: "Reed",
              statusConfigId: "active",
              assignedToUserId: null,
              tags: [],
              customFieldValues: [{ fieldId: "field-balance", value: 2500 }],
            },
      },
      contactCustomField: { findMany: async () => [{
        id: "field-balance",
        key: "balance",
        label: "Balance",
        fieldType: "CURRENCY",
        isRequired: false,
        isActive: true,
        isEncrypted: false,
        isSensitive: false,
        options: null,
      }] },
      contactStatusConfig: { findMany: async () => [{ id: "active", name: "Active" }] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [] },
      opportunityPipeline: { findMany: async () => [{ id: "pipeline-work", name: "Work", stages: [] }] },
      contactNote: {
        create: async ({ data }: { data: Record<string, unknown> }) => { createdNotes.push(data) },
      },
      automationRun: {
        create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "run-1", ...data }),
        update: async () => undefined,
      },
      automationExecution: { create: async () => undefined },
      automationNodeExecution: {
        createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => { nodeLogs = data },
      },
    }

    const event = {
      tenantId: "tenant-1",
      actorUserId: "user-1",
      triggerType: "OPPORTUNITY_CREATED" as const,
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-work",
      valueCents: 0,
      sourceStageId: null,
      targetStageId: "stage-new",
    }
    await executeOpportunityAutomations(prismaTx, event)
    await executeOpportunityAutomations(prismaTx, { ...event, opportunityId: "opportunity-2" })

    assert.equal(createdNotes.length, 2)
    assert.deepEqual(createdNotes[0], {
      tenantId: "tenant-1",
      contactId: "contact-1",
      automationId: "automation-1",
      automationName: "New opportunity notes",
      title: "Opportunity for Taylor Reed",
      body: "Current balance: $2,500.00.",
      createdById: null,
    })
    assert.deepEqual(nodeLogs.map((log) => log.status), ["EXECUTED", "EXECUTED"])
    assert.equal(nodeLogs[1]?.details, "Added contact note “Opportunity for Taylor Reed”.")
  })

  test("creates and interpolates a run-scoped formatter value", async () => {
    let createdNote: Record<string, unknown> | null = null
    let runUpdate: Record<string, unknown> | null = null
    let nodeLogs: Array<Record<string, unknown>> = []
    const prismaTx = {
      automation: {
        findMany: async () => [{
          id: "automation-1",
          name: "Format appointment",
          triggerType: "OPPORTUNITY_CREATED",
          pipelineId: "pipeline-work",
          targetStageId: null,
          conditions: [],
          actions: [
            {
              nodeKey: "00000000-0000-4000-8000-000000000001",
              type: "FORMAT_DATE_TIME",
              dateTimeFormatterConfig: {
                mode: "DATE",
                source: { type: "CURRENT_DATE" },
                format: "MMM D, YYYY",
                outputKey: "appointment_date",
              },
            },
            {
              nodeKey: "00000000-0000-4000-8000-000000000002",
              type: "ADD_CONTACT_NOTE",
              noteTitle: "Appointment",
              noteBody: "Scheduled {automation.appointment_date}.",
            },
          ],
        }],
      },
      contact: {
        findFirst: async (args: { select?: Record<string, unknown> }) => args.select?.email
          ? {
              firstName: "Taylor",
              middleName: null,
              lastName: "Reed",
              email: "taylor@example.com",
              customFieldValues: [],
            }
          : {
              id: "contact-1",
              firstName: "Taylor",
              middleName: null,
              lastName: "Reed",
              statusConfigId: "active",
              assignedToUserId: null,
              tags: [],
              customFieldValues: [],
            },
      },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [{ id: "active", name: "Active" }] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [] },
      opportunityPipeline: { findMany: async () => [{ id: "pipeline-work", name: "Work", stages: [] }] },
      contactNote: {
        create: async ({ data }: { data: Record<string, unknown> }) => { createdNote = data },
      },
      automationRun: {
        create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "run-1", ...data }),
        update: async ({ data }: { data: Record<string, unknown> }) => { runUpdate = data },
      },
      automationExecution: { create: async () => undefined },
      automationNodeExecution: {
        createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => { nodeLogs = data },
      },
    }

    await executeOpportunityAutomations(prismaTx, {
      tenantId: "tenant-1",
      actorUserId: "user-1",
      triggerType: "OPPORTUNITY_CREATED",
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-work",
      valueCents: 0,
      sourceStageId: null,
      targetStageId: "stage-new",
    })

    assert.match(
      String((createdNote as Record<string, unknown> | null)?.body),
      /^Scheduled [A-Z][a-z]{2} \d{1,2}, \d{4}\.$/,
    )
    assert.equal(nodeLogs[1]?.nodeLabel, "Date/Time formatter")
    assert.equal(nodeLogs[1]?.details, "Created automation value “appointment_date”.")
    assert.equal(
      typeof ((runUpdate as Record<string, unknown> | null)?.variables as Record<string, unknown>)?.appointment_date,
      "string",
    )
  })

  test("executes a Text formatter with its custom node label and exposes the value", async () => {
    let createdNote: Record<string, unknown> | null = null
    let runUpdate: Record<string, unknown> | null = null
    let nodeLogs: Array<Record<string, unknown>> = []
    const prismaTx = {
      automation: {
        findMany: async () => [{
          id: "automation-1",
          name: "Normalize lead name",
          triggerType: "OPPORTUNITY_CREATED",
          pipelineId: "pipeline-work",
          targetStageId: null,
          conditions: [],
          actions: [
            {
              nodeKey: "00000000-0000-4000-8000-000000000001",
              type: "FORMAT_TEXT",
              textFormatterConfig: {
                actionName: "Clean contact name",
                mode: "TITLE_CASE",
                source: { type: "CONTACT_FIELD", key: "name" },
                outputKey: "contact_name",
              },
            },
            {
              nodeKey: "00000000-0000-4000-8000-000000000002",
              type: "ADD_CONTACT_NOTE",
              noteTitle: "Formatted contact",
              noteBody: "Name: {automation.contact_name}.",
            },
          ],
        }],
      },
      contact: {
        findFirst: async (args: { select?: Record<string, unknown> }) => args.select?.email
          ? {
              firstName: "tAYLOR",
              middleName: null,
              lastName: "rEED",
              email: "taylor@example.com",
              customFieldValues: [],
            }
          : {
              id: "contact-1",
              firstName: "tAYLOR",
              middleName: null,
              lastName: "rEED",
              statusConfigId: "active",
              assignedToUserId: null,
              tags: [],
              customFieldValues: [],
            },
      },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [{ id: "active", name: "Active" }] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [] },
      opportunityPipeline: { findMany: async () => [{ id: "pipeline-work", name: "Work", stages: [] }] },
      contactNote: {
        create: async ({ data }: { data: Record<string, unknown> }) => { createdNote = data },
      },
      automationRun: {
        create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "run-1", ...data }),
        update: async ({ data }: { data: Record<string, unknown> }) => { runUpdate = data },
      },
      automationExecution: { create: async () => undefined },
      automationNodeExecution: {
        createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => { nodeLogs = data },
      },
    }

    await executeOpportunityAutomations(prismaTx, {
      tenantId: "tenant-1",
      actorUserId: "user-1",
      triggerType: "OPPORTUNITY_CREATED",
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-work",
      valueCents: 0,
      sourceStageId: null,
      targetStageId: "stage-new",
    })

    assert.equal((createdNote as Record<string, unknown> | null)?.body, "Name: Taylor Reed.")
    assert.equal(nodeLogs[1]?.nodeLabel, "Clean contact name")
    assert.equal(nodeLogs[1]?.details, "Created automation value “contact_name”.")
    assert.equal(
      ((runUpdate as Record<string, unknown> | null)?.variables as Record<string, unknown>)?.contact_name,
      "Taylor Reed",
    )
  })

  test("executes a number formatter and exposes its value to a later note", async () => {
    let createdNote: Record<string, unknown> | null = null
    let runUpdate: Record<string, unknown> | null = null
    let nodeLogs: Array<Record<string, unknown>> = []
    const prismaTx = {
      automation: {
        findMany: async () => [{
          id: "automation-1",
          name: "Draw a number",
          triggerType: "OPPORTUNITY_CREATED",
          pipelineId: "pipeline-work",
          targetStageId: null,
          conditions: [],
          actions: [
            {
              nodeKey: "00000000-0000-4000-8000-000000000001",
              type: "FORMAT_NUMBER",
              numberFormatterConfig: {
                mode: "RANDOM_NUMBER",
                min: 7,
                max: 7,
                outputKey: "draw_number",
              },
            },
            {
              nodeKey: "00000000-0000-4000-8000-000000000002",
              type: "ADD_CONTACT_NOTE",
              noteTitle: "Draw result",
              noteBody: "Number {automation.draw_number}.",
            },
          ],
        }],
      },
      contact: {
        findFirst: async (args: { select?: Record<string, unknown> }) => args.select?.email
          ? {
              firstName: "Taylor",
              middleName: null,
              lastName: "Reed",
              email: "taylor@example.com",
              customFieldValues: [],
            }
          : {
              id: "contact-1",
              firstName: "Taylor",
              middleName: null,
              lastName: "Reed",
              statusConfigId: "active",
              assignedToUserId: null,
              tags: [],
              customFieldValues: [],
            },
      },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [{ id: "active", name: "Active" }] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [] },
      opportunityPipeline: { findMany: async () => [{ id: "pipeline-work", name: "Work", stages: [] }] },
      contactNote: {
        create: async ({ data }: { data: Record<string, unknown> }) => { createdNote = data },
      },
      automationRun: {
        create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "run-1", ...data }),
        update: async ({ data }: { data: Record<string, unknown> }) => { runUpdate = data },
      },
      automationExecution: { create: async () => undefined },
      automationNodeExecution: {
        createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => { nodeLogs = data },
      },
    }

    await executeOpportunityAutomations(prismaTx, {
      tenantId: "tenant-1",
      actorUserId: "user-1",
      triggerType: "OPPORTUNITY_CREATED",
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-work",
      valueCents: 0,
      sourceStageId: null,
      targetStageId: "stage-new",
    })

    assert.equal((createdNote as Record<string, unknown> | null)?.body, "Number 7.")
    assert.equal(nodeLogs[1]?.nodeLabel, "Number formatter")
    assert.equal(nodeLogs[1]?.details, "Created automation value “draw_number”.")
    assert.equal(
      ((runUpdate as Record<string, unknown> | null)?.variables as Record<string, unknown>)?.draw_number,
      7,
    )
  })

  test("executes an empty-field number formatter as a no-op", async () => {
    let runUpdate: Record<string, unknown> | null = null
    let nodeLogs: Array<Record<string, unknown>> = []
    const prismaTx = {
      automation: {
        findMany: async () => [{
          id: "automation-1",
          name: "Format optional weight",
          triggerType: "OPPORTUNITY_CREATED",
          pipelineId: "pipeline-work",
          targetStageId: null,
          conditions: [],
          actions: [{
            nodeKey: "00000000-0000-4000-8000-000000000001",
            type: "FORMAT_NUMBER",
            numberFormatterConfig: {
              mode: "FORMAT_NUMBER",
              source: { type: "CONTACT_FIELD", key: "weight" },
              decimalMark: "PERIOD",
              groupingStyle: "COMMA_PERIOD",
              outputKey: "formatted_weight",
            },
          }],
        }],
      },
      contact: {
        findFirst: async (args: { select?: Record<string, unknown> }) => args.select?.email
          ? {
              firstName: "Taylor",
              middleName: null,
              lastName: "Reed",
              email: "taylor@example.com",
              weight: "",
              customFieldValues: [],
            }
          : {
              id: "contact-1",
              firstName: "Taylor",
              middleName: null,
              lastName: "Reed",
              statusConfigId: "active",
              assignedToUserId: null,
              tags: [],
              customFieldValues: [],
            },
      },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [{ id: "active", name: "Active" }] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [] },
      opportunityPipeline: { findMany: async () => [{ id: "pipeline-work", name: "Work", stages: [] }] },
      automationRun: {
        create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "run-1", ...data }),
        update: async ({ data }: { data: Record<string, unknown> }) => { runUpdate = data },
      },
      automationExecution: { create: async () => undefined },
      automationNodeExecution: {
        createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => { nodeLogs = data },
      },
    }

    await executeOpportunityAutomations(prismaTx, {
      tenantId: "tenant-1",
      actorUserId: "user-1",
      triggerType: "OPPORTUNITY_CREATED",
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-work",
      valueCents: 0,
      sourceStageId: null,
      targetStageId: "stage-new",
    })

    assert.deepEqual(
      (runUpdate as Record<string, unknown> | null)?.variables,
      {},
    )
    assert.equal(nodeLogs[1]?.status, "EXECUTED")
    assert.equal(
      nodeLogs[1]?.details,
      "Source field was empty. No automation value was created.",
    )
  })

  test("executes chained number and date Math operations", async () => {
    let createdNote: Record<string, unknown> | null = null
    let runUpdate: Record<string, unknown> | null = null
    let nodeLogs: Array<Record<string, unknown>> = []
    const customFieldValues = [
      {
        fieldId: "field-premium",
        value: 100,
        field: {
          key: "premium",
          fieldType: "CURRENCY",
          isActive: true,
          isEncrypted: false,
          isSensitive: false,
        },
      },
      {
        fieldId: "field-renewal",
        value: "2024-02-29",
        field: {
          key: "renewal_date",
          fieldType: "DATE",
          isActive: true,
          isEncrypted: false,
          isSensitive: false,
        },
      },
    ]
    const prismaTx = {
      automation: {
        findMany: async () => [{
          id: "automation-1",
          name: "Calculate values",
          triggerType: "OPPORTUNITY_CREATED",
          pipelineId: "pipeline-work",
          targetStageId: null,
          conditions: [],
          actions: [
            {
              nodeKey: "00000000-0000-4000-8000-000000000001",
              type: "MATH_OPERATION",
              mathOperationConfig: {
                mode: "NUMBER",
                source: { type: "CUSTOM_FIELD", key: "premium" },
                operation: "ADD",
                operand: 25,
                outputKey: "adjusted_premium",
              },
            },
            {
              nodeKey: "00000000-0000-4000-8000-000000000005",
              type: "FORMAT_NUMBER",
              numberFormatterConfig: {
                mode: "FORMAT_CURRENCY",
                source: { type: "AUTOMATION_VALUE", key: "adjusted_premium" },
                decimalMark: "PERIOD",
                currencyCode: "USD",
                outputKey: "adjusted_premium_label",
              },
            },
            {
              nodeKey: "00000000-0000-4000-8000-000000000002",
              type: "MATH_OPERATION",
              mathOperationConfig: {
                mode: "DATE",
                source: { type: "CUSTOM_FIELD", key: "renewal_date" },
                operation: "ADD",
                amount: 1,
                unit: "YEARS",
                outputKey: "next_renewal",
              },
            },
            {
              nodeKey: "00000000-0000-4000-8000-000000000003",
              type: "FORMAT_DATE_TIME",
              dateTimeFormatterConfig: {
                mode: "DATE",
                source: { type: "AUTOMATION_VALUE", key: "next_renewal" },
                format: "MMM D, YYYY",
                outputKey: "renewal_label",
              },
            },
            {
              nodeKey: "00000000-0000-4000-8000-000000000004",
              type: "ADD_CONTACT_NOTE",
              noteTitle: "Calculated values",
              noteBody: "Premium {automation.adjusted_premium} ({automation.adjusted_premium_label}); renewal {automation.renewal_label}.",
            },
          ],
        }],
      },
      contact: {
        findFirst: async (args: { select?: Record<string, unknown> }) => args.select?.email
          ? {
              firstName: "Taylor",
              middleName: null,
              lastName: "Reed",
              email: "taylor@example.com",
              customFieldValues,
            }
          : {
              id: "contact-1",
              firstName: "Taylor",
              middleName: null,
              lastName: "Reed",
              statusConfigId: "active",
              assignedToUserId: null,
              tags: [],
              customFieldValues,
            },
      },
      contactCustomField: { findMany: async () => [
        { id: "field-premium", key: "premium", label: "Premium", fieldType: "CURRENCY", isRequired: false, isActive: true, isEncrypted: false, isSensitive: false, options: [] },
        { id: "field-renewal", key: "renewal_date", label: "Renewal date", fieldType: "DATE", isRequired: false, isActive: true, isEncrypted: false, isSensitive: false, options: [] },
      ] },
      contactStatusConfig: { findMany: async () => [{ id: "active", name: "Active" }] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [] },
      opportunityPipeline: { findMany: async () => [{ id: "pipeline-work", name: "Work", stages: [] }] },
      contactNote: {
        create: async ({ data }: { data: Record<string, unknown> }) => { createdNote = data },
      },
      automationRun: {
        create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "run-1", ...data }),
        update: async ({ data }: { data: Record<string, unknown> }) => { runUpdate = data },
      },
      automationExecution: { create: async () => undefined },
      automationNodeExecution: {
        createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => { nodeLogs = data },
      },
    }

    await executeOpportunityAutomations(prismaTx, {
      tenantId: "tenant-1",
      actorUserId: "user-1",
      triggerType: "OPPORTUNITY_CREATED",
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-work",
      valueCents: 0,
      sourceStageId: null,
      targetStageId: "stage-new",
    })

    assert.equal((createdNote as Record<string, unknown> | null)?.body, "Premium 125 ($125.00); renewal Feb 28, 2025.")
    assert.deepEqual(nodeLogs.slice(1).map((log) => log.nodeLabel), [
      "Math operation",
      "Number formatter",
      "Math operation",
      "Date/Time formatter",
      "Add contact note",
    ])
    assert.equal(nodeLogs[1]?.details, "Created automation value “adjusted_premium”.")
    const variables = (runUpdate as Record<string, unknown> | null)?.variables as Record<string, unknown>
    assert.equal(variables.adjusted_premium, 125)
    assert.equal(variables.adjusted_premium_label, "$125.00")
    assert.equal(variables.next_renewal, "2025-02-28")
    assert.equal(variables.renewal_label, "Feb 28, 2025")
  })

  test("creates a contact-linked task with live templates, reminder, and notification", async () => {
    const created: {
      task?: Record<string, unknown>
      activity?: Record<string, unknown>
      reminder?: Record<string, unknown>
      notification?: Record<string, unknown>
    } = {}
    const prismaTx = {
      automation: {
        findMany: async () => [{
          id: "automation-1",
          name: "Appointment follow-up",
          triggerType: "OPPORTUNITY_CREATED",
          pipelineId: "pipeline-work",
          targetStageId: null,
          conditions: [],
          actions: [{
            nodeKey: "00000000-0000-4000-8000-000000000001",
            type: "CREATE_TASK",
            taskConfig: {
              nameTemplate: "Call {contact.name}",
              descriptionTemplate: "Email: {contact.email}",
              statusConfigId: "todo",
              assignee: { mode: "CONTACT_ASSIGNEE" },
              linkedService: { id: "service-1", nameSnapshot: "Annual review" },
              dueAt: {
                source: {
                  type: "SPECIFIC_DATE",
                  date: "2099-09-24",
                  timezone: "America/Chicago",
                },
                time: "17:00",
              },
              reminder: {
                at: {
                  source: {
                    type: "SPECIFIC_DATE",
                    date: "2099-09-24",
                    timezone: "America/Chicago",
                  },
                  time: "16:00",
                },
                messageTemplate: "Reminder for {contact.first_name}",
              },
            },
          }],
        }],
      },
      contact: {
        findFirst: async (args: { select?: Record<string, unknown> }) => {
          if (args.select?.email) {
            return {
              firstName: "Taylor",
              middleName: null,
              lastName: "Reed",
              email: "taylor@example.com",
              statusConfig: { name: "Active" },
              assignedToMembership: { user: { name: "John", email: "john@example.com" } },
              customFieldValues: [],
            }
          }
          if (args.select?.assignedToUserId && !args.select?.firstName) {
            return { assignedToUserId: "user-john" }
          }
          return {
            id: "contact-1",
            firstName: "Taylor",
            middleName: null,
            lastName: "Reed",
            statusConfigId: "active",
            assignedToUserId: "user-john",
            tags: [],
            customFieldValues: [],
          }
        },
      },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [{ id: "active", name: "Active" }] },
      taskStatusConfig: { findMany: async () => [{ id: "todo", name: "To Do" }] },
      membership: {
        findMany: async () => [{
          userId: "user-john",
          user: { name: "John", email: "john@example.com" },
        }],
        findUnique: async () => ({ id: "membership-john", status: "ACTIVE" }),
      },
      tenantTag: { findMany: async () => [] },
      opportunityPipeline: { findMany: async () => [{ id: "pipeline-work", name: "Work", stages: [] }] },
      tenant: { findUnique: async () => ({ timezone: "America/Chicago" }) },
      task: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.task = data
          return { id: "task-1" }
        },
      },
      taskActivity: {
        create: async ({ data }: { data: Record<string, unknown> }) => { created.activity = data },
      },
      taskReminder: {
        create: async ({ data }: { data: Record<string, unknown> }) => { created.reminder = data },
      },
      notification: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.notification = data
          return { id: "notification-1" }
        },
      },
      automationRun: {
        create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "run-1", ...data }),
        update: async () => undefined,
      },
      automationExecution: { create: async () => undefined },
      automationNodeExecution: { createMany: async () => undefined },
    }

    const result = await executeOpportunityAutomations(prismaTx, {
      tenantId: "tenant-1",
      actorUserId: "user-1",
      triggerType: "OPPORTUNITY_CREATED",
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-work",
      valueCents: 0,
      sourceStageId: null,
      targetStageId: "stage-new",
    })

    assert.deepEqual(result, {
      matchedCount: 1,
      executedCount: 1,
      notificationIds: ["notification-1"],
      fileCleanupCandidates: [],
      contactDeleted: false,
    })
    assert.equal(created.task?.name, "Call Taylor Reed")
    assert.equal(created.task?.description, "Email: taylor@example.com")
    assert.equal(created.task?.assignedToUserId, "user-john")
    assert.equal(created.task?.automationName, "Appointment follow-up")
    assert.equal(created.task?.linkedEntityName, "Annual review")
    assert.equal(created.activity?.details, "Created by Automation · Appointment follow-up.")
    assert.equal(created.reminder?.createdById, null)
    assert.equal(created.reminder?.message, "Reminder for Taylor")
    assert.equal(created.notification?.type, "TASK_ASSIGNED")
  })

  test("renders values changed by an earlier action in the same segment", async () => {
    let currentBalance = 100
    let currentStatus = "active"
    let currentAssignee: string | null = null
    let createdNote: Record<string, unknown> | null = null
    const field = {
      id: "field-balance",
      key: "balance",
      label: "Balance",
      fieldType: "CURRENCY",
      isRequired: false,
      isActive: true,
      isEncrypted: false,
      isSensitive: false,
      options: null,
    }
    const prismaTx = {
      automation: {
        findMany: async () => [{
          id: "automation-1",
          name: "Update and note",
          triggerType: "OPPORTUNITY_CREATED",
          pipelineId: "pipeline-work",
          targetStageId: null,
          conditions: [],
          actions: [
            {
              nodeKey: "00000000-0000-4000-8000-000000000001",
              type: "SET_CONTACT_CUSTOM_FIELD",
              customFieldId: field.id,
              value: 325,
            },
            {
              nodeKey: "00000000-0000-4000-8000-000000000002",
              type: "SET_CONTACT_STATUS",
              statusConfigId: "inactive",
            },
            {
              nodeKey: "00000000-0000-4000-8000-000000000003",
              type: "SET_CONTACT_ASSIGNEE",
              assignedUserId: "user-john",
            },
            {
              nodeKey: "00000000-0000-4000-8000-000000000004",
              type: "ADD_CONTACT_NOTE",
              noteTitle: "Balance updated",
              noteBody: "Balance is now {contact.custom_field.balance|currency:USD}; status {contact.status}; assigned to {contact.assigned_to}.",
            },
          ],
        }],
      },
      contact: {
        findFirst: async (args: { select?: Record<string, unknown> }) => args.select?.email
          ? {
              firstName: "Taylor",
              middleName: null,
              lastName: "Reed",
              statusConfig: { name: currentStatus === "inactive" ? "Inactive" : "Active" },
              assignedToMembership: currentAssignee
                ? { user: { name: "John", email: "john@example.com" } }
                : null,
              customFieldValues: [{
                value: currentBalance,
                field: {
                  key: field.key,
                  fieldType: field.fieldType,
                  isActive: true,
                  isEncrypted: false,
                  isSensitive: false,
                },
              }],
            }
          : {
              id: "contact-1",
              firstName: "Taylor",
              middleName: null,
              lastName: "Reed",
              statusConfigId: "active",
              assignedToUserId: null,
              tags: [],
              customFieldValues: [{ fieldId: field.id, value: currentBalance }],
            },
        update: async ({ data }: { data: { statusConfigId?: string; assignedToUserId?: string } }) => {
          if (data.statusConfigId) currentStatus = data.statusConfigId
          if (data.assignedToUserId) currentAssignee = data.assignedToUserId
        },
      },
      contactCustomField: { findMany: async () => [field] },
      contactCustomFieldValue: {
        upsert: async ({ update }: { update: { value: number } }) => { currentBalance = update.value },
      },
      contactStatusConfig: { findMany: async () => [
        { id: "active", name: "Active" },
        { id: "inactive", name: "Inactive" },
      ] },
      membership: { findMany: async () => [{
        userId: "user-john",
        user: { name: "John", email: "john@example.com" },
      }] },
      tenantTag: { findMany: async () => [] },
      opportunityPipeline: { findMany: async () => [{ id: "pipeline-work", name: "Work", stages: [] }] },
      contactNote: {
        create: async ({ data }: { data: Record<string, unknown> }) => { createdNote = data },
      },
      automationRun: {
        create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "run-1", ...data }),
        update: async () => undefined,
      },
      automationExecution: { create: async () => undefined },
      automationNodeExecution: { createMany: async () => undefined },
    }

    await executeOpportunityAutomations(prismaTx, {
      tenantId: "tenant-1",
      actorUserId: "user-1",
      triggerType: "OPPORTUNITY_CREATED",
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-work",
      valueCents: 0,
      sourceStageId: null,
      targetStageId: "stage-new",
    })

    assert.equal(currentBalance, 325)
    assert.equal(currentStatus, "inactive")
    assert.equal(currentAssignee, "user-john")
    assert.equal(
      (createdNote as Record<string, unknown> | null)?.body,
      "Balance is now $325.00; status Inactive; assigned to John.",
    )
  })

  test("pauses at a future wait without running later actions", async () => {
    let runUpdate: Record<string, unknown> | null = null
    let nodeLogs: Array<Record<string, unknown>> = []
    let contactUpdates = 0
    let contactNotes = 0
    let executionCount = 0
    const prismaTx = {
      automation: {
        findMany: async () => [{
          id: "automation-1",
          name: "Delayed status",
          triggerType: "OPPORTUNITY_CREATED",
          pipelineId: "pipeline-work",
          targetStageId: null,
          conditions: [],
          actions: [
            {
              nodeKey: "00000000-0000-4000-8000-000000000001",
              type: "ADD_CONTACT_NOTE",
              noteTitle: "Before wait",
              noteBody: "This note is committed before the automation pauses.",
            },
            {
              nodeKey: "00000000-0000-4000-8000-000000000002",
              type: "WAIT",
              waitConfig: { mode: "DURATION", amount: 30, unit: "MINUTES" },
            },
            {
              nodeKey: "00000000-0000-4000-8000-000000000003",
              type: "SET_CONTACT_STATUS",
              statusConfigId: "inactive",
            },
          ],
        }],
      },
      contact: {
        findFirst: async () => ({
          id: "contact-1",
          firstName: "Taylor",
          middleName: null,
          lastName: "Reed",
          statusConfigId: "active",
          assignedToUserId: null,
          tags: [],
          customFieldValues: [],
        }),
        update: async () => { contactUpdates += 1 },
      },
      contactNote: { create: async () => { contactNotes += 1 } },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [
        { id: "active", name: "Active" },
        { id: "inactive", name: "Inactive" },
      ] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [] },
      opportunityPipeline: { findMany: async () => [{ id: "pipeline-work", name: "Work", stages: [] }] },
      automationRun: {
        create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "run-1", ...data }),
        update: async ({ data }: { data: Record<string, unknown> }) => { runUpdate = data },
      },
      automationExecution: { create: async () => { executionCount += 1 } },
      automationNodeExecution: {
        createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => { nodeLogs = data },
      },
    }

    const result = await executeOpportunityAutomations(prismaTx, {
      tenantId: "tenant-1",
      actorUserId: "user-1",
      triggerType: "OPPORTUNITY_CREATED",
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-work",
      valueCents: 0,
      sourceStageId: null,
      targetStageId: "stage-new",
    })

    assert.deepEqual(result, {
      matchedCount: 1,
      executedCount: 1,
      notificationIds: [],
      fileCleanupCandidates: [],
      contactDeleted: false,
    })
    assert.equal(contactUpdates, 0)
    assert.equal(contactNotes, 1)
    assert.equal(executionCount, 0)
    assert.ok(runUpdate)
    assert.equal((runUpdate as Record<string, unknown>).status, "WAITING")
    assert.equal((runUpdate as Record<string, unknown>).cursorIndex, 2)
    assert.deepEqual(nodeLogs.map((log) => log.status), ["EXECUTED", "EXECUTED", "WAITING"])
  })

  test("applies the exit rule when a fixed wait time has passed", async () => {
    let runUpdate: Record<string, unknown> | null = null
    let summaryStatus: string | null = null
    let nodeLogs: Array<Record<string, unknown>> = []
    let contactUpdates = 0
    const prismaTx = {
      automation: {
        findMany: async () => [{
          id: "automation-1",
          name: "Expired campaign",
          triggerType: "OPPORTUNITY_CREATED",
          pipelineId: "pipeline-work",
          targetStageId: null,
          conditions: [],
          actions: [
            {
              nodeKey: "00000000-0000-4000-8000-000000000001",
              type: "WAIT",
              waitConfig: {
                mode: "FIXED_DATE",
                dateTime: "2020-01-01T00:00:00.000Z",
                timing: "ON",
                pastBehavior: "EXIT",
              },
            },
            {
              nodeKey: "00000000-0000-4000-8000-000000000002",
              type: "SET_CONTACT_STATUS",
              statusConfigId: "inactive",
            },
          ],
        }],
      },
      contact: {
        findFirst: async () => ({
          id: "contact-1",
          firstName: "Taylor",
          middleName: null,
          lastName: "Reed",
          statusConfigId: "active",
          assignedToUserId: null,
          tags: [],
          customFieldValues: [],
        }),
        update: async () => { contactUpdates += 1 },
      },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [{ id: "inactive", name: "Inactive" }] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [] },
      opportunityPipeline: { findMany: async () => [{ id: "pipeline-work", name: "Work", stages: [] }] },
      automationRun: {
        create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "run-1", ...data }),
        update: async ({ data }: { data: Record<string, unknown> }) => { runUpdate = data },
      },
      automationExecution: {
        create: async ({ data }: { data: { status: string } }) => { summaryStatus = data.status },
      },
      automationNodeExecution: {
        createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => { nodeLogs = data },
      },
    }

    await executeOpportunityAutomations(prismaTx, {
      tenantId: "tenant-1",
      actorUserId: "user-1",
      triggerType: "OPPORTUNITY_CREATED",
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-work",
      valueCents: 0,
      sourceStageId: null,
      targetStageId: "stage-new",
    })

    assert.equal(contactUpdates, 0)
    assert.equal(summaryStatus, "EXITED")
    assert.ok(runUpdate)
    assert.equal((runUpdate as Record<string, unknown>).status, "EXITED")
    assert.deepEqual(nodeLogs.map((log) => log.status), ["EXECUTED", "EXECUTED", "SKIPPED"])
  })

  test("jumps only to a configured later step when a fixed wait time has passed", async () => {
    let contactUpdates = 0
    let tagRemovals = 0
    let nodeLogs: Array<Record<string, unknown>> = []
    const targetNodeKey = "00000000-0000-4000-8000-000000000003"
    const prismaTx = {
      automation: {
        findMany: async () => [{
          id: "automation-1",
          name: "Expired route",
          triggerType: "OPPORTUNITY_CREATED",
          pipelineId: "pipeline-work",
          targetStageId: null,
          conditions: [],
          actions: [
            {
              nodeKey: "00000000-0000-4000-8000-000000000001",
              type: "WAIT",
              waitConfig: {
                mode: "FIXED_DATE",
                dateTime: "2020-01-01T00:00:00.000Z",
                timing: "ON",
                pastBehavior: "GO_TO_STEP",
                targetNodeKey,
              },
            },
            {
              nodeKey: "00000000-0000-4000-8000-000000000002",
              type: "REMOVE_CONTACT_TAG",
              tagId: "lead-tag",
            },
            { nodeKey: targetNodeKey, type: "SET_CONTACT_STATUS", statusConfigId: "inactive" },
          ],
        }],
      },
      contact: {
        findFirst: async () => ({
          id: "contact-1",
          firstName: "Taylor",
          middleName: null,
          lastName: "Reed",
          statusConfigId: "active",
          assignedToUserId: null,
          tags: [{ tagId: "lead-tag" }],
          customFieldValues: [],
        }),
        update: async () => { contactUpdates += 1 },
      },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [{ id: "inactive", name: "Inactive" }] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [{ id: "lead-tag", name: "Lead" }] },
      opportunityPipeline: { findMany: async () => [{ id: "pipeline-work", name: "Work", stages: [] }] },
      contactTag: { deleteMany: async () => { tagRemovals += 1 } },
      automationRun: {
        create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "run-1", ...data }),
        update: async () => undefined,
      },
      automationExecution: { create: async () => undefined },
      automationNodeExecution: {
        createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => { nodeLogs = data },
      },
    }

    await executeOpportunityAutomations(prismaTx, {
      tenantId: "tenant-1",
      actorUserId: "user-1",
      triggerType: "OPPORTUNITY_CREATED",
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-work",
      valueCents: 0,
      sourceStageId: null,
      targetStageId: "stage-new",
    })

    assert.equal(tagRemovals, 0)
    assert.equal(contactUpdates, 1)
    assert.deepEqual(nodeLogs.map((log) => log.status), ["EXECUTED", "EXECUTED", "SKIPPED", "EXECUTED"])
    assert.equal(nodeLogs[2]?.reasonCode, "WAIT_JUMPED")
  })

  test("does not log an unrelated opportunity event", async () => {
    let nodeLogs: Array<Record<string, unknown>> = []
    const forbiddenAction = () => {
      throw new Error("Actions must not run for an unrelated event.")
    }
    const prismaTx = {
      automation: {
        findMany: async () => [{
          id: "automation-1",
          name: "Entered proposal",
          triggerType: "OPPORTUNITY_STAGE_CHANGED",
          pipelineId: "pipeline-work",
          targetStageId: "stage-proposal",
          conditions: [],
          actions: [{ type: "SET_CONTACT_STATUS", statusConfigId: "inactive" }],
        }],
      },
      contact: {
        findFirst: async () => ({
          id: "contact-1",
          firstName: "Morgan",
          middleName: null,
          lastName: "Lee",
          statusConfigId: "active",
          assignedToUserId: null,
          tags: [],
          customFieldValues: [],
        }),
        update: forbiddenAction,
      },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [
        { id: "active", name: "Active" },
        { id: "inactive", name: "Inactive" },
      ] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [] },
      opportunityPipeline: { findMany: async () => [{
        id: "pipeline-work",
        name: "Work",
        stages: [{ id: "stage-proposal", name: "Proposal" }],
      }] },
      automationExecution: { create: forbiddenAction },
      automationNodeExecution: {
        createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
          nodeLogs = data
        },
      },
    }

    const result = await executeOpportunityAutomations(prismaTx, {
      tenantId: "tenant-1",
      actorUserId: "user-1",
      triggerType: "OPPORTUNITY_CREATED",
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-work",
      valueCents: 0,
      sourceStageId: null,
      targetStageId: "stage-new",
    })

    assert.deepEqual(result, {
      matchedCount: 0,
      executedCount: 0,
      notificationIds: [],
      fileCleanupCandidates: [],
      contactDeleted: false,
    })
    assert.deepEqual(nodeLogs, [])
  })

  test("persists rollback-aware node logs after an action failure", async () => {
    const prismaTx = {
      automation: {
        findMany: async () => [{
          id: "automation-1",
          name: "Failing flow",
          triggerType: "OPPORTUNITY_CREATED",
          pipelineId: "pipeline-work",
          targetStageId: null,
          conditions: [],
          actions: [
            {
              type: "ADD_CONTACT_NOTE",
              noteTitle: "Rolled-back note",
              noteBody: "This note should be rolled back with its segment.",
            },
            { type: "SET_CONTACT_STATUS", statusConfigId: "removed-status" },
            { type: "ADD_CONTACT_TAG", tagId: "customer-tag" },
          ],
        }],
      },
      contact: {
        findFirst: async () => ({
          id: "contact-1",
          firstName: "Jamie",
          middleName: null,
          lastName: "Rivers",
          statusConfigId: "active",
          assignedToUserId: null,
          tags: [{ tagId: "lead-tag" }],
          customFieldValues: [],
        }),
        update: async () => undefined,
      },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [{ id: "active", name: "Active" }] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [
        { id: "lead-tag", name: "Lead" },
        { id: "customer-tag", name: "Customer" },
      ] },
      opportunityPipeline: { findMany: async () => [{ id: "pipeline-work", name: "Work", stages: [] }] },
      contactTag: {
        deleteMany: async () => undefined,
        upsert: async () => undefined,
      },
      contactNote: { create: async () => undefined },
      automationExecution: { create: async () => undefined },
      automationRun: {
        create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "run-1", ...data }),
        update: async () => undefined,
      },
      automationNodeExecution: { createMany: async () => undefined },
    }
    const event = {
      tenantId: "tenant-1",
      actorUserId: "user-1",
      triggerType: "OPPORTUNITY_CREATED" as const,
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-work",
      valueCents: 0,
      sourceStageId: null,
      targetStageId: "stage-new",
    }

    let executionError: AutomationExecutionError | null = null
    try {
      await executeOpportunityAutomations(prismaTx, event)
    } catch (error) {
      if (error instanceof AutomationExecutionError) executionError = error
      else throw error
    }
    assert.ok(executionError)
    assert.deepEqual(executionError.nodeExecutions.map((log) => log.status), [
      "EXECUTED",
      "FAILED",
      "FAILED",
      "SKIPPED",
    ])
    assert.equal(executionError.nodeExecutions[1]?.reasonCode, "TRANSACTION_ROLLED_BACK")
    assert.equal(executionError.nodeExecutions[3]?.reasonCode, "PREVIOUS_ACTION_FAILED")

    let persistedLogs: Array<Record<string, unknown>> = []
    let summaryCount = 0
    const failureClient = {
      $transaction: async (callback: (transaction: unknown) => Promise<void>) => callback({
        automationRun: { create: async () => undefined },
        automationExecution: {
          create: async () => {
            summaryCount += 1
          },
        },
        automationNodeExecution: {
          createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
            persistedLogs = data
          },
        },
      }),
    }
    await recordAutomationFailure(failureClient, event, executionError)

    assert.equal(summaryCount, 1)
    assert.equal(persistedLogs.length, 4)
    assert.ok(persistedLogs.every((log) => log.opportunityId === null))
  })
})

describe("resumeDueAutomationRuns", () => {
  test("claims a due run and resumes its pinned snapshot after the automation was deleted", async () => {
    let leaseToken = ""
    let contactUpdates = 0
    let waitingLogUpdates = 0
    let runStatus: string | null = null
    let runVariables: Record<string, unknown> = {}
    let summaryCount = 0
    let createdNote: Record<string, unknown> | null = null
    const actions = [
      {
        nodeKey: "00000000-0000-4000-8000-000000000001",
        type: "WAIT",
        waitConfig: { mode: "DURATION", amount: 1, unit: "SECONDS" },
      },
      {
        nodeKey: "00000000-0000-4000-8000-000000000002",
        type: "MATH_OPERATION",
        mathOperationConfig: {
          mode: "NUMBER",
          source: { type: "AUTOMATION_VALUE", key: "raw_premium" },
          operation: "ADD",
          operand: 25,
          outputKey: "adjusted_premium",
        },
      },
      {
        nodeKey: "00000000-0000-4000-8000-000000000003",
        type: "ADD_CONTACT_NOTE",
        noteTitle: "Pinned note for {contact.name}",
        noteBody: "Current email: {contact.email}. Premium: {automation.adjusted_premium}. Resumed date: {date.current|date:iso}.",
      },
      {
        nodeKey: "00000000-0000-4000-8000-000000000004",
        type: "SET_CONTACT_STATUS",
        statusConfigId: "inactive",
      },
    ]
    const transaction = {
      automationRun: {
        findFirst: async () => ({
          id: "run-1",
          tenantId: "tenant-1",
          automationId: null,
          automationName: "Deleted automation",
          contactId: "contact-1",
          contactName: "Taylor Reed",
          actorUserId: "user-1",
          opportunityId: "opportunity-1",
          attemptId: "attempt-1",
          eventSource: "OPPORTUNITY_CREATED",
          triggerType: "OPPORTUNITY_CREATED",
          sourceStageId: null,
          targetStageId: "stage-new",
          actionSnapshot: actions,
          cursorIndex: 1,
          variables: { raw_premium: 100 },
          status: "RUNNING",
          resumeAt: new Date(Date.now() - 1_000),
          waitingNodeKey: actions[0]!.nodeKey,
          waitingNodeExecutionId: "wait-log-1",
          leaseToken,
        }),
        update: async ({ data }: { data: { status: string; variables?: Record<string, unknown> } }) => {
          runStatus = data.status
          runVariables = data.variables ?? runVariables
        },
      },
      contact: {
        findFirst: async (args: { select?: Record<string, unknown> }) => args.select?.email
          ? {
              firstName: "Taylor",
              middleName: null,
              lastName: "Reed",
              email: "current@example.com",
              customFieldValues: [],
            }
          : { id: "contact-1" },
        update: async () => { contactUpdates += 1 },
      },
      contactNote: {
        create: async ({ data }: { data: Record<string, unknown> }) => { createdNote = data },
      },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [{ id: "inactive", name: "Inactive" }] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [] },
      opportunityPipeline: { findMany: async () => [] },
      tenant: { findUnique: async () => ({ timezone: "America/Chicago" }) },
      automationNodeExecution: {
        updateMany: async () => { waitingLogUpdates += 1 },
        createMany: async () => undefined,
      },
      automationExecution: { create: async () => { summaryCount += 1 } },
    }
    const prismaClient = {
      automationRun: {
        findMany: async () => [{ id: "run-1" }],
        updateMany: async ({ data }: { data: { leaseToken: string } }) => {
          leaseToken = data.leaseToken
          return { count: 1 }
        },
      },
      $transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction),
    }

    const results = await resumeDueAutomationRuns(prismaClient)

    assert.deepEqual(results, [{ status: "SUCCEEDED" }])
    assert.equal(contactUpdates, 1)
    assert.ok(createdNote)
    assert.equal((createdNote as Record<string, unknown>).automationId, null)
    assert.equal((createdNote as Record<string, unknown>).automationName, "Deleted automation")
    assert.equal((createdNote as Record<string, unknown>).title, "Pinned note for Taylor Reed")
    assert.match(
      String((createdNote as Record<string, unknown>).body),
      /^Current email: current@example\.com\. Premium: 125\. Resumed date: \d{4}-\d{2}-\d{2}\.$/,
    )
    assert.deepEqual(runVariables, { raw_premium: 100, adjusted_premium: 125 })
    assert.equal(waitingLogUpdates, 1)
    assert.equal(runStatus, "SUCCEEDED")
    assert.equal(summaryCount, 1)
  })
})
