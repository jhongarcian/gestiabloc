import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  AutomationUpsertSchema,
  AutomationExecutionError,
  evaluateAutomationOperator,
  executeOpportunityAutomations,
  getAutomationOperatorsForFieldType,
  recordAutomationFailure,
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
      processes: {
        some: {
          contacts: {
            some: {
              tenantId: "tenant-1",
              contactId: "contact-1",
              status: "SUCCEEDED",
            },
          },
        },
      },
    })
  })

  test("does not run actions when the enrolled contact does not match the assignee filter", async () => {
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
      automationExecution: {
        create: async () => {
          executions += 1
        },
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
    assert.deepEqual(nodeLogs.map((log) => log.status), ["EXECUTED", "SKIPPED", "SKIPPED"])
    assert.match(String(nodeLogs[1]?.details), /Assigned to: expected John, found Mary\./)
    assert.match(String(nodeLogs[1]?.details), /Contact status: expected Inactive, found Active\./)
  })

  test("runs actions after an opportunity event when the enrolled contact matches the assignee filter", async () => {
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
            { type: "REMOVE_CONTACT_TAG", tagId: "lead-tag" },
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
      automationExecution: { create: async () => undefined },
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
