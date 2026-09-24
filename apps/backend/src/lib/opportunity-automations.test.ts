import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  AutomationUpsertSchema,
  AutomationExecutionError,
  evaluateAutomationOperator,
  executeOpportunityAutomations,
  getAutomationOperatorsForFieldType,
  recordAutomationFailure,
  resumeDueAutomationRuns,
  validateAutomationConfiguration,
} from "./opportunity-automations.js"

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

describe("AutomationUpsertSchema", () => {
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
    })
  })

  test("does not run actions when a contact does not match the assignee filter", async () => {
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

    assert.deepEqual(result, { matchedCount: 0, executedCount: 0 })
    assert.equal(tagRemovals, 0)
    assert.equal(contactUpdates, 0)
    assert.equal(executions, 0)
    assert.deepEqual(nodeLogs.map((log) => log.status), ["EXECUTED", "SKIPPED", "SKIPPED", "SKIPPED"])
    assert.match(String(nodeLogs[1]?.details), /Assigned to: expected John, found Mary\./)
    assert.match(String(nodeLogs[1]?.details), /Contact status: expected Inactive, found Active\./)
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

    assert.deepEqual(result, { matchedCount: 1, executedCount: 1 })
    assert.equal(tagRemovals, 1)
    assert.equal(contactUpdates, 1)
    assert.equal(executions, 1)
    assert.deepEqual(nodeLogs.map((log) => log.status), ["EXECUTED", "EXECUTED", "EXECUTED"])
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

    assert.deepEqual(result, { matchedCount: 1, executedCount: 1 })
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

  test("logs every node as skipped for an unrelated opportunity event", async () => {
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

    assert.deepEqual(result, { matchedCount: 0, executedCount: 0 })
    assert.deepEqual(nodeLogs.map((log) => log.status), ["SKIPPED", "SKIPPED"])
    assert.match(String(nodeLogs[0]?.details), /listens for Opportunity enters stage/)
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
        type: "ADD_CONTACT_NOTE",
        noteTitle: "Pinned note for {contact.name}",
        noteBody: "Current email: {contact.email}. Resumed date: {date.current|date:iso}.",
      },
      {
        nodeKey: "00000000-0000-4000-8000-000000000003",
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
          status: "RUNNING",
          resumeAt: new Date(Date.now() - 1_000),
          waitingNodeKey: actions[0]!.nodeKey,
          waitingNodeExecutionId: "wait-log-1",
          leaseToken,
        }),
        update: async ({ data }: { data: { status: string } }) => { runStatus = data.status },
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
      /^Current email: current@example\.com\. Resumed date: \d{4}-\d{2}-\d{2}\.$/,
    )
    assert.equal(waitingLogUpdates, 1)
    assert.equal(runStatus, "SUCCEEDED")
    assert.equal(summaryCount, 1)
  })
})
