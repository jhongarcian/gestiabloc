import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  AutomationExecutionError,
  executeAutomationSegmentTx,
  flattenAutomationActionTree,
  parseActionSnapshot,
  selectedAutomationActionSteps,
  type AutomationRuntimeCatalog,
} from "./opportunity-automations.js"

const IDS = {
  ifElse: "00000000-0000-4000-8000-000000000001",
  branchOne: "00000000-0000-4000-8000-000000000002",
  branchTwo: "00000000-0000-4000-8000-000000000003",
  defaultBranch: "00000000-0000-4000-8000-000000000004",
  conditionOne: "00000000-0000-4000-8000-000000000005",
  conditionTwo: "00000000-0000-4000-8000-000000000006",
  actionOne: "00000000-0000-4000-8000-000000000007",
  actionTwo: "00000000-0000-4000-8000-000000000008",
} as const

function snapshot() {
  return [{
    type: "IF_ELSE",
    nodeKey: IDS.ifElse,
    ifElseConfig: {
      actionName: "Choose premium path",
      branches: [
        {
          branchKey: IDS.branchOne,
          name: "High value",
          isDefault: false,
          matchMode: "ALL",
          conditions: [{
            conditionKey: IDS.conditionOne,
            source: "OPPORTUNITY_FIELD",
            field: "VALUE",
            operator: "GREATER_THAN",
            compareValue: 100,
          }],
          actions: [{
            type: "FORMAT_NUMBER",
            nodeKey: IDS.actionOne,
            numberFormatterConfig: {
              mode: "RANDOM_NUMBER",
              min: 1,
              max: 1,
              outputKey: "high_value",
            },
          }],
        },
        {
          branchKey: IDS.branchTwo,
          name: "Also matches",
          isDefault: false,
          matchMode: "ANY",
          conditions: [{
            conditionKey: IDS.conditionTwo,
            source: "OPPORTUNITY_FIELD",
            field: "VALUE",
            operator: "GREATER_THAN",
            compareValue: 50,
          }],
          actions: [{
            type: "FORMAT_NUMBER",
            nodeKey: IDS.actionTwo,
            numberFormatterConfig: {
              mode: "RANDOM_NUMBER",
              min: 2,
              max: 2,
              outputKey: "other_value",
            },
          }],
        },
        {
          branchKey: IDS.defaultBranch,
          name: "Default",
          isDefault: true,
          matchMode: "ALL",
          conditions: [],
          actions: [],
        },
      ],
    },
  }]
}

const catalog: AutomationRuntimeCatalog = {
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
}

function run(valueCents: number) {
  return {
    id: "run-1",
    tenantId: "tenant-1",
    automationId: "automation-1",
    automationName: "Premium routing",
    contactId: "contact-1",
    contactName: "John Contact",
    actorUserId: "user-1",
    opportunityId: "opportunity-1",
    attemptId: "attempt-1",
    eventSource: "OPPORTUNITY_CREATED" as const,
    triggerType: "OPPORTUNITY_CREATED" as const,
    sourceStageId: null,
    targetStageId: "stage-1",
    cursorIndex: 0,
    cursorPath: null,
    branchDecisions: {},
    eventContext: {
      pipelineId: "pipeline-1",
      valueCents,
      sourceStageId: null,
      targetStageId: "stage-1",
      occurredAt: "2026-09-29T12:00:00.000Z",
    },
    variables: {},
  }
}

describe("If/Else automation actions", () => {
  test("flattens branch nodes in deterministic depth-first order with breadcrumbs", () => {
    const actions = parseActionSnapshot(snapshot())
    const flattened = flattenAutomationActionTree(actions)

    assert.deepEqual(flattened.map((item) => item.action.nodeKey), [
      IDS.ifElse,
      IDS.actionOne,
      IDS.actionTwo,
    ])
    assert.deepEqual(flattened[1]?.branchPath.map((item) => item.branchName), ["High value"])
    assert.deepEqual(flattened[2]?.branchPath.map((item) => item.branchName), ["Also matches"])
  })

  test("keeps only the recorded branch in the resumable execution path", () => {
    const actions = parseActionSnapshot(snapshot())
    const selected = selectedAutomationActionSteps(actions, {
      [IDS.ifElse]: {
        branchKey: IDS.branchTwo,
        branchName: "Also matches",
        decidedAt: "2026-09-29T12:00:00.000Z",
      },
    })

    assert.deepEqual(selected.map((item) => item.action.nodeKey), [IDS.ifElse, IDS.actionTwo])
  })

  test("selects the first matching branch and logs unselected branch actions", async () => {
    const updates: any[] = []
    const executions: any[] = []
    const prismaTx = {
      automationRun: { update: async (args: any) => { updates.push(args); return args } },
      automationExecution: { create: async (args: any) => { executions.push(args); return args } },
    }
    const result = await executeAutomationSegmentTx(prismaTx, {
      run: run(20_000),
      actions: parseActionSnapshot(snapshot()),
      catalog,
      startIndex: 0,
      occurredAt: new Date("2026-09-29T12:00:00.000Z"),
    })

    assert.equal(result.status, "SUCCEEDED")
    assert.equal(result.logs.find((log) => log.nodeKey === IDS.ifElse)?.details, "Selected branch “High value”.")
    assert.equal(result.logs.find((log) => log.nodeKey === IDS.actionOne)?.status, "EXECUTED")
    assert.equal(result.logs.find((log) => log.nodeKey === IDS.actionTwo)?.reasonCode, "BRANCH_NOT_SELECTED")
    assert.equal((updates[0]?.data.branchDecisions as any)[IDS.ifElse].branchKey, IDS.branchOne)
    assert.equal(executions.length, 1)
  })

  test("uses Default when no condition matches and executes no branch actions", async () => {
    const prismaTx = {
      automationRun: { update: async (args: any) => args },
      automationExecution: { create: async (args: any) => args },
    }
    const result = await executeAutomationSegmentTx(prismaTx, {
      run: run(1_000),
      actions: parseActionSnapshot(snapshot()),
      catalog,
      startIndex: 0,
      occurredAt: new Date("2026-09-29T12:00:00.000Z"),
    })

    assert.equal(result.status, "SUCCEEDED")
    assert.match(result.logs.find((log) => log.nodeKey === IDS.ifElse)?.details ?? "", /selected Default/)
    assert.equal(result.logs.find((log) => log.nodeKey === IDS.actionOne)?.status, "SKIPPED")
    assert.equal(result.logs.find((log) => log.nodeKey === IDS.actionTwo)?.status, "SKIPPED")
  })

  test("preserves unselected-branch audit rows when the selected branch rolls back", async () => {
    const failedSnapshot = structuredClone(snapshot())
    failedSnapshot[0]!.ifElseConfig.branches[0]!.actions = [{
      type: "SET_CONTACT_STATUS",
      nodeKey: IDS.actionOne,
      statusConfigId: "missing-status",
    }] as any
    await assert.rejects(
      executeAutomationSegmentTx({}, {
        run: run(20_000),
        actions: parseActionSnapshot(failedSnapshot),
        catalog,
        startIndex: 0,
        occurredAt: new Date("2026-09-29T12:00:00.000Z"),
      }),
      (error) => {
        assert.ok(error instanceof AutomationExecutionError)
        assert.equal(error.nodeExecutions.find((log) => log.nodeKey === IDS.actionOne)?.status, "FAILED")
        assert.equal(error.nodeExecutions.find((log) => log.nodeKey === IDS.actionTwo)?.reasonCode, "BRANCH_NOT_SELECTED")
        return true
      },
    )
  })
})
