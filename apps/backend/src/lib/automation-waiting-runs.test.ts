import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  AutomationWaitingRunError,
  exitAutomationWaitingRun,
  getAutomationWaitingRuns,
  getAutomationWaitNodeCounts,
} from "./automation-waiting-runs.js"
import { AutomationNodeKeySchema } from "./automation-node-key.js"

const tenantId = "tenant-1"
const automationId = "automation-1"
const waitNodeKey = "00000000-0000-4000-8000-000000000001"
const secondWaitNodeKey = "legacy-wait-node-2"

function savedIfElseWithBranchWaits() {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    nodeKey: "00000000-0000-4000-8000-000000000010",
    type: "IF_ELSE",
    ifElseConfig: {
      actionName: "Route by contact",
      branches: [
        {
          branchKey: "00000000-0000-4000-8000-000000000011",
          name: "Branch 1",
          isDefault: false,
          matchMode: "ALL",
          conditions: [{
            conditionKey: "00000000-0000-4000-8000-000000000012",
            source: "CONTACT_FIELD",
            fieldKey: "name",
            operator: "EQUALS",
            compareValue: "John",
          }],
          actions: [{
            nodeKey: waitNodeKey,
            type: "WAIT",
            waitConfig: { mode: "DURATION", amount: 1, unit: "DAYS" },
          }],
        },
        {
          branchKey: "00000000-0000-4000-8000-000000000013",
          name: "Branch 2",
          isDefault: false,
          matchMode: "ALL",
          conditions: [{
            conditionKey: "00000000-0000-4000-8000-000000000014",
            source: "CONTACT_FIELD",
            fieldKey: "name",
            operator: "EQUALS",
            compareValue: "Mary",
          }],
          actions: [{
            nodeKey: secondWaitNodeKey,
            type: "WAIT",
            waitConfig: { mode: "DURATION", amount: 2, unit: "DAYS" },
          }],
        },
        {
          branchKey: "00000000-0000-4000-8000-000000000015",
          name: "Default",
          isDefault: true,
          matchMode: "ALL",
          conditions: [],
          actions: [],
        },
      ],
    },
  }
}

function savedSplitWithRouteWaits() {
  return {
    id: "00000000-0000-4000-8000-000000000020",
    nodeKey: "00000000-0000-4000-8000-000000000020",
    type: "SPLIT",
    splitConfig: {
      actionName: "Random wait",
      routes: [
        {
          branchKey: "00000000-0000-4000-8000-000000000021",
          name: "Short wait",
          percentage: 50,
          actions: [{
            nodeKey: waitNodeKey,
            type: "WAIT",
            waitConfig: { mode: "DURATION", amount: 1, unit: "DAYS" },
          }],
        },
        {
          branchKey: "00000000-0000-4000-8000-000000000022",
          name: "Long wait",
          percentage: 50,
          actions: [{
            nodeKey: secondWaitNodeKey,
            type: "WAIT",
            waitConfig: { mode: "DURATION", amount: 2, unit: "DAYS" },
          }],
        },
      ],
    },
  }
}

function savedAutomationMocks() {
  return {
    automation: {
      findUnique: async () => ({ id: automationId }),
    },
    automationAction: {
      findFirst: async () => ({ nodeKey: waitNodeKey }),
    },
  }
}

describe("automation Wait monitoring", () => {
  test("accepts saved non-UUID Wait node keys", () => {
    assert.equal(
      AutomationNodeKeySchema.parse("legacy-wait-node-2"),
      "legacy-wait-node-2",
    )
    assert.throws(() => AutomationNodeKeySchema.parse("   "))
  })

  test("returns a zero-inclusive count for every saved Wait node", async () => {
    let countWhere: any = null
    const prismaClient = {
      ...savedAutomationMocks(),
      automationAction: {
        ...savedAutomationMocks().automationAction,
        findMany: async () => [
          { nodeKey: waitNodeKey },
          { nodeKey: "00000000-0000-4000-8000-000000000002" },
        ],
      },
      automationRun: {
        groupBy: async ({ where }: any) => {
          countWhere = where
          return [{ waitingNodeKey: waitNodeKey, _count: { _all: 2 } }]
        },
      },
    }

    assert.deepEqual(
      await getAutomationWaitNodeCounts(prismaClient, { tenantId, automationId }),
      [
        { nodeKey: waitNodeKey, count: 2 },
        { nodeKey: "00000000-0000-4000-8000-000000000002", count: 0 },
      ],
    )
    assert.equal(countWhere.tenantId, tenantId)
    assert.equal(countWhere.automationId, automationId)
    assert.equal(countWhere.status, "WAITING")
  })

  test("returns counts for Wait nodes in separate If/Else branches", async () => {
    const prismaClient = {
      automation: {
        findUnique: async () => ({
          id: automationId,
          actions: [savedIfElseWithBranchWaits()],
        }),
      },
      automationRun: {
        groupBy: async () => [{
          waitingNodeKey: secondWaitNodeKey,
          _count: { _all: 1 },
        }],
      },
    }

    assert.deepEqual(
      await getAutomationWaitNodeCounts(prismaClient, { tenantId, automationId }),
      [
        { nodeKey: waitNodeKey, count: 0 },
        { nodeKey: secondWaitNodeKey, count: 1 },
      ],
    )
  })

  test("returns counts for Wait nodes in separate Split routes", async () => {
    const prismaClient = {
      automation: {
        findUnique: async () => ({
          id: automationId,
          actions: [savedSplitWithRouteWaits()],
        }),
      },
      automationRun: {
        groupBy: async () => [{ waitingNodeKey: waitNodeKey, _count: { _all: 3 } }],
      },
    }

    assert.deepEqual(
      await getAutomationWaitNodeCounts(prismaClient, { tenantId, automationId }),
      [
        { nodeKey: waitNodeKey, count: 3 },
        { nodeKey: secondWaitNodeKey, count: 0 },
      ],
    )
  })

  test("returns ten waiting runs per page and uses the Wait log entry time", async () => {
    let findManyArgs: any = null
    let rawQuery: any = null
    const enteredAt = new Date("2026-09-27T14:00:00.000Z")
    const fallbackEnteredAt = new Date("2026-09-27T14:05:00.000Z")
    const prismaClient = {
      ...savedAutomationMocks(),
      $queryRaw: async (query: any) => {
        rawQuery = query
        return [{ id: "run-12" }]
      },
      automationRun: {
        count: async () => 12,
        findMany: async (args: any) => {
          findManyArgs = args
          return [{
            id: "run-12",
            contactId: "contact-1",
            contactName: "Old Name",
            waitingNodeExecutionId: "wait-log-1",
            resumeAt: new Date("2026-09-28T14:00:00.000Z"),
            updatedAt: fallbackEnteredAt,
            contact: {
              id: "contact-1",
              firstName: "Taylor",
              middleName: null,
              lastName: "Reed",
              phone: "+15551234567",
            },
          }]
        },
      },
      automationNodeExecution: {
        findMany: async () => [{ id: "wait-log-1", createdAt: enteredAt }],
      },
    }

    const result = await getAutomationWaitingRuns(prismaClient, {
      tenantId,
      automationId,
      nodeKey: waitNodeKey,
      page: 9,
    })

    assert.deepEqual(findManyArgs.where.id, { in: ["run-12"] })
    assert.equal(rawQuery.values.at(-2), 10)
    assert.equal(rawQuery.values.at(-1), 10)
    assert.equal(findManyArgs.where.tenantId, tenantId)
    assert.equal(findManyArgs.where.automationId, automationId)
    assert.equal(findManyArgs.where.waitingNodeKey, waitNodeKey)
    assert.equal(findManyArgs.where.status, "WAITING")
    assert.equal(result.pagination.page, 2)
    assert.equal(result.pagination.pageSize, 10)
    assert.equal(result.items[0]?.contact.name, "Taylor Reed")
    assert.equal(result.items[0]?.enteredAt, enteredAt)
  })

  test("loads the selected non-UUID Wait node when an automation has multiple Wait nodes", async () => {
    const selectedNodeKey = secondWaitNodeKey
    let selectedWhere: any = null
    const prismaClient = {
      automation: {
        findUnique: async () => ({
          id: automationId,
          actions: [savedIfElseWithBranchWaits()],
        }),
      },
      automationRun: {
        count: async ({ where }: any) => {
          selectedWhere = where
          return 0
        },
        findMany: async () => [],
      },
      automationNodeExecution: {
        findMany: async () => [],
      },
    }

    const result = await getAutomationWaitingRuns(prismaClient, {
      tenantId,
      automationId,
      nodeKey: selectedNodeKey,
      page: 1,
    })

    assert.equal(selectedWhere.waitingNodeKey, selectedNodeKey)
    assert.deepEqual(result.items, [])
    assert.equal(result.pagination.total, 0)
  })

  test("exits only the selected run and writes terminal node logs", async () => {
    let runUpdateWhere: any = null
    let waitLogUpdate: any = null
    let remainingLogs: any[] = []
    let executionSummary: any = null
    const actionSnapshot = [
      {
        nodeKey: waitNodeKey,
        type: "WAIT",
        waitConfig: { mode: "DURATION", amount: 2, unit: "DAYS" },
      },
      {
        nodeKey: "00000000-0000-4000-8000-000000000002",
        type: "SET_CONTACT_STATUS",
        statusConfigId: "status-inactive",
      },
      {
        nodeKey: "00000000-0000-4000-8000-000000000003",
        type: "ADD_CONTACT_TAG",
        tagId: "tag-1",
      },
    ]
    const transaction = {
      ...savedAutomationMocks(),
      automationRun: {
        findFirst: async () => ({
          id: "run-1",
          tenantId,
          automationId,
          automationName: "Follow up",
          contactId: "contact-1",
          contactName: "Taylor Reed",
          actorUserId: "trigger-user",
          opportunityId: "opportunity-1",
          attemptId: "attempt-1",
          eventSource: "OPPORTUNITY_CREATED",
          triggerType: "OPPORTUNITY_CREATED",
          sourceStageId: null,
          targetStageId: "stage-1",
          actionSnapshot,
          cursorIndex: 1,
          status: "WAITING",
        }),
        updateMany: async ({ where }: any) => {
          runUpdateWhere = where
          return { count: 1 }
        },
      },
      automationNodeExecution: {
        updateMany: async (args: any) => {
          waitLogUpdate = args
          return { count: 1 }
        },
        create: async () => undefined,
        createMany: async ({ data }: any) => { remainingLogs = data },
      },
      automationExecution: {
        create: async ({ data }: any) => { executionSummary = data },
      },
    }
    const prismaClient = {
      $transaction: async (callback: (tx: any) => Promise<unknown>) => callback(transaction),
    }
    const occurredAt = new Date("2026-09-27T15:00:00.000Z")

    const result = await exitAutomationWaitingRun(prismaClient, {
      tenantId,
      automationId,
      nodeKey: waitNodeKey,
      runId: "run-1",
      actorUserId: "admin-1",
      actorDisplayName: "Jordan Admin",
      occurredAt,
    })

    assert.equal(result.status, "EXITED")
    assert.equal(runUpdateWhere.id, "run-1")
    assert.equal(runUpdateWhere.tenantId, tenantId)
    assert.equal(runUpdateWhere.automationId, automationId)
    assert.equal(runUpdateWhere.waitingNodeKey, waitNodeKey)
    assert.equal(runUpdateWhere.status, "WAITING")
    assert.equal(waitLogUpdate.data.status, "EXECUTED")
    assert.equal(waitLogUpdate.data.reasonCode, "CONTACT_REMOVED_FROM_AUTOMATION")
    assert.match(waitLogUpdate.data.details, /Jordan Admin/)
    assert.deepEqual(remainingLogs.map((log) => [log.nodeOrder, log.status]), [
      [2, "SKIPPED"],
      [3, "SKIPPED"],
    ])
    assert.equal(executionSummary.status, "EXITED")
    assert.equal(executionSummary.actorUserId, "admin-1")
  })

  test("does not write audit logs when the Wait worker wins the claim race", async () => {
    let auditWrites = 0
    const transaction = {
      ...savedAutomationMocks(),
      automationRun: {
        findFirst: async () => ({
          id: "run-1",
          status: "WAITING",
          actionSnapshot: [],
        }),
        updateMany: async () => ({ count: 0 }),
      },
      automationNodeExecution: {
        updateMany: async () => { auditWrites += 1 },
        create: async () => { auditWrites += 1 },
        createMany: async () => { auditWrites += 1 },
      },
      automationExecution: { create: async () => { auditWrites += 1 } },
    }
    const prismaClient = {
      $transaction: async (callback: (tx: any) => Promise<unknown>) => callback(transaction),
    }

    await assert.rejects(
      exitAutomationWaitingRun(prismaClient, {
        tenantId,
        automationId,
        nodeKey: waitNodeKey,
        runId: "run-1",
        actorUserId: "admin-1",
        actorDisplayName: "Jordan Admin",
      }),
      (error) => error instanceof AutomationWaitingRunError &&
        error.code === "AUTOMATION_RUN_NOT_WAITING",
    )
    assert.equal(auditWrites, 0)
  })
})
