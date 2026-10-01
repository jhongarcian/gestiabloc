import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  AutomationExecutionError,
  automationSplitBucket,
  executeAutomationSegmentTx,
  flattenAutomationActionTree,
  parseActionSnapshot,
  selectAutomationSplitRoute,
  type AutomationRuntimeCatalog,
} from "./opportunity-automations.js"

const IDS = {
  split: "10000000-0000-4000-8000-000000000001",
  routeOne: "10000000-0000-4000-8000-000000000002",
  routeTwo: "10000000-0000-4000-8000-000000000003",
  actionOne: "10000000-0000-4000-8000-000000000004",
  actionTwo: "10000000-0000-4000-8000-000000000005",
  wait: "10000000-0000-4000-8000-000000000006",
} as const

function snapshot(percentages: [number, number] = [25, 75]) {
  return [{
    type: "SPLIT",
    nodeKey: IDS.split,
    splitConfig: {
      actionName: "Experiment route",
      routes: [
        {
          branchKey: IDS.routeOne,
          name: "Treatment",
          percentage: percentages[0],
          actions: [{
            type: "FORMAT_NUMBER",
            nodeKey: IDS.actionOne,
            numberFormatterConfig: {
              mode: "RANDOM_NUMBER",
              min: 1,
              max: 1,
              outputKey: "treatment_value",
            },
          }],
        },
        {
          branchKey: IDS.routeTwo,
          name: "Control",
          percentage: percentages[1],
          actions: [{
            type: "FORMAT_NUMBER",
            nodeKey: IDS.actionTwo,
            numberFormatterConfig: {
              mode: "RANDOM_NUMBER",
              min: 2,
              max: 2,
              outputKey: "control_value",
            },
          }],
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
  timezone: "America/Chicago",
}

function run(id: string, branchDecisions: Record<string, unknown> = {}) {
  return {
    id,
    tenantId: "tenant-1",
    automationId: "automation-1",
    automationName: "Route experiment",
    contactId: "contact-1",
    contactName: "John Contact",
    actorUserId: "user-1",
    opportunityId: "opportunity-1",
    attemptId: `attempt-${id}`,
    eventSource: "OPPORTUNITY_CREATED" as const,
    triggerType: "OPPORTUNITY_CREATED" as const,
    sourceStageId: null,
    targetStageId: "stage-1",
    cursorIndex: 0,
    cursorPath: null,
    branchDecisions,
    eventContext: {},
    variables: {},
  }
}

function prismaTx() {
  const updates: any[] = []
  return {
    updates,
    client: {
      automationRun: { update: async (args: any) => { updates.push(args); return args } },
      automationExecution: { create: async (args: any) => args },
    },
  }
}

describe("Split automation actions", () => {
  test("uses a stable 1-100 bucket and produces a representative distribution", () => {
    const first = automationSplitBucket("run-1", IDS.split)
    assert.equal(first, automationSplitBucket("run-1", IDS.split))
    assert.ok(first >= 1 && first <= 100)

    const treatmentCount = Array.from({ length: 10_000 }, (_, index) =>
      automationSplitBucket(`run-${index}`, IDS.split),
    ).filter((bucket) => bucket <= 25).length
    assert.ok(treatmentCount > 2_300 && treatmentCount < 2_700)
  })

  test("selects routes by their cumulative percentages", () => {
    const action = parseActionSnapshot(snapshot())[0]!
    assert.equal(action.type, "SPLIT")
    if (action.type !== "SPLIT") return
    for (let index = 0; index < 1_000; index += 1) {
      const runId = `route-run-${index}`
      const bucket = automationSplitBucket(runId, action.nodeKey)
      const route = selectAutomationSplitRoute(action, runId)
      assert.equal(route.branchKey, bucket <= 25 ? IDS.routeOne : IDS.routeTwo)
    }
  })

  test("executes only the selected route and logs the other route as skipped", async () => {
    const actions = parseActionSnapshot(snapshot())
    const split = actions[0]!
    assert.equal(split.type, "SPLIT")
    if (split.type !== "SPLIT") return
    const selected = selectAutomationSplitRoute(split, "run-selected")
    const selectedActionKey = selected.branchKey === IDS.routeOne ? IDS.actionOne : IDS.actionTwo
    const skippedActionKey = selected.branchKey === IDS.routeOne ? IDS.actionTwo : IDS.actionOne
    const tx = prismaTx()

    const result = await executeAutomationSegmentTx(tx.client, {
      run: run("run-selected"),
      actions,
      catalog,
      startIndex: 0,
      occurredAt: new Date("2026-09-30T12:00:00.000Z"),
    })

    assert.equal(result.status, "SUCCEEDED")
    assert.match(result.logs.find((log) => log.nodeKey === IDS.split)?.details ?? "", /Selected route/)
    assert.equal(result.logs.find((log) => log.nodeKey === selectedActionKey)?.status, "EXECUTED")
    assert.equal(result.logs.find((log) => log.nodeKey === skippedActionKey)?.reasonCode, "ROUTE_NOT_SELECTED")
    assert.equal((tx.updates[0]?.data.branchDecisions as any)[IDS.split].branchKey, selected.branchKey)
  })

  test("honors a persisted route decision instead of selecting again", async () => {
    const actions = parseActionSnapshot(snapshot())
    const tx = prismaTx()
    const result = await executeAutomationSegmentTx(tx.client, {
      run: run("run-with-decision", {
        [IDS.split]: {
          branchKey: IDS.routeTwo,
          branchName: "Control",
          decidedAt: "2026-09-30T11:00:00.000Z",
        },
      }),
      actions,
      catalog,
      startIndex: 0,
      occurredAt: new Date("2026-09-30T12:00:00.000Z"),
    })

    assert.equal(result.logs.find((log) => log.nodeKey === IDS.actionTwo)?.status, "EXECUTED")
    assert.equal(result.logs.find((log) => log.nodeKey === IDS.actionOne)?.reasonCode, "ROUTE_NOT_SELECTED")
  })

  test("persists the route decision through a Wait and resumes the same route", async () => {
    const waitingSnapshot = snapshot([99, 1])
    waitingSnapshot[0]!.splitConfig.routes[0]!.actions = [
      {
        type: "WAIT",
        nodeKey: IDS.wait,
        waitConfig: { mode: "DURATION", amount: 1, unit: "DAYS" },
      } as any,
      waitingSnapshot[0]!.splitConfig.routes[0]!.actions[0]!,
    ]
    waitingSnapshot[0]!.splitConfig.routes[1]!.actions = []
    const actions = parseActionSnapshot(waitingSnapshot)
    const split = actions[0]!
    assert.equal(split.type, "SPLIT")
    if (split.type !== "SPLIT") return
    const waitingRunId = Array.from({ length: 1_000 }, (_, index) => `waiting-${index}`)
      .find((runId) => selectAutomationSplitRoute(split, runId).branchKey === IDS.routeOne)
    assert.ok(waitingRunId)
    const firstTx = prismaTx()

    const waitingResult = await executeAutomationSegmentTx(firstTx.client, {
      run: run(waitingRunId),
      actions,
      catalog,
      startIndex: 0,
      occurredAt: new Date("2026-09-30T12:00:00.000Z"),
    })
    assert.equal(waitingResult.status, "WAITING")
    const persisted = firstTx.updates[0]!.data
    assert.equal(persisted.branchDecisions[IDS.split].branchKey, IDS.routeOne)
    assert.equal(persisted.cursorPath.nextNodeKey, IDS.actionOne)
    assert.deepEqual(persisted.cursorPath.goToHistory, [])
    assert.ok(persisted.cursorPath.visitedNodeKeys.includes(IDS.split))
    assert.ok(persisted.cursorPath.visitedNodeKeys.includes(IDS.wait))

    const secondTx = prismaTx()
    const resumedResult = await executeAutomationSegmentTx(secondTx.client, {
      run: {
        ...run(waitingRunId, persisted.branchDecisions),
        cursorIndex: persisted.cursorIndex,
        cursorPath: persisted.cursorPath,
        variables: persisted.variables,
      },
      actions,
      catalog,
      startIndex: persisted.cursorIndex,
      occurredAt: new Date("2026-10-02T12:00:00.000Z"),
    })

    assert.equal(resumedResult.status, "SUCCEEDED")
    assert.equal(resumedResult.logs.find((log) => log.nodeKey === IDS.actionOne)?.status, "EXECUTED")
    assert.equal(resumedResult.logs.some((log) => log.nodeKey === IDS.split), false)
  })

  test("completes successfully when the selected route is an empty control", async () => {
    const emptyControlSnapshot = snapshot()
    emptyControlSnapshot[0]!.splitConfig.routes[1]!.actions = []
    const actions = parseActionSnapshot(emptyControlSnapshot)
    const split = actions[0]!
    assert.equal(split.type, "SPLIT")
    if (split.type !== "SPLIT") return
    const controlRunId = Array.from({ length: 1_000 }, (_, index) => `control-${index}`)
      .find((runId) => selectAutomationSplitRoute(split, runId).branchKey === IDS.routeTwo)
    assert.ok(controlRunId)
    const tx = prismaTx()

    const result = await executeAutomationSegmentTx(tx.client, {
      run: run(controlRunId),
      actions,
      catalog,
      startIndex: 0,
    })

    assert.equal(result.status, "SUCCEEDED")
    assert.equal(result.logs.find((log) => log.nodeKey === IDS.split)?.status, "EXECUTED")
    assert.equal(result.logs.find((log) => log.nodeKey === IDS.actionOne)?.reasonCode, "ROUTE_NOT_SELECTED")
    assert.equal(result.logs.some((log) => log.status === "FAILED"), false)
  })

  test("fails safely when a persisted route decision is unavailable", async () => {
    const tx = prismaTx()
    await assert.rejects(
      executeAutomationSegmentTx(tx.client, {
        run: run("run-corrupt", {
          [IDS.split]: {
            branchKey: "10000000-0000-4000-8000-000000000099",
            branchName: "Missing",
            decidedAt: "2026-09-30T11:00:00.000Z",
          },
        }),
        actions: parseActionSnapshot(snapshot()),
        catalog,
        startIndex: 0,
      }),
      (error) => {
        assert.ok(error instanceof AutomationExecutionError)
        assert.match(error.message, /no longer available/)
        return true
      },
    )
  })

  test("preserves unselected-route logs when the selected route rolls back", async () => {
    const failedSnapshot = snapshot()
    failedSnapshot[0]!.splitConfig.routes[0]!.actions = [{
      type: "SET_CONTACT_STATUS",
      nodeKey: IDS.actionOne,
      statusConfigId: "missing-status",
    }] as any
    failedSnapshot[0]!.splitConfig.routes[1]!.actions = [{
      type: "SET_CONTACT_STATUS",
      nodeKey: IDS.actionTwo,
      statusConfigId: "missing-status",
    }] as any
    const actions = parseActionSnapshot(failedSnapshot)
    const split = actions[0]!
    assert.equal(split.type, "SPLIT")
    if (split.type !== "SPLIT") return
    const selected = selectAutomationSplitRoute(split, "run-failed")
    const selectedActionKey = selected.branchKey === IDS.routeOne ? IDS.actionOne : IDS.actionTwo
    const skippedActionKey = selected.branchKey === IDS.routeOne ? IDS.actionTwo : IDS.actionOne

    await assert.rejects(
      executeAutomationSegmentTx({}, {
        run: run("run-failed"),
        actions,
        catalog,
        startIndex: 0,
      }),
      (error) => {
        assert.ok(error instanceof AutomationExecutionError)
        assert.equal(error.nodeExecutions.find((log) => log.nodeKey === selectedActionKey)?.status, "FAILED")
        assert.equal(error.nodeExecutions.find((log) => log.nodeKey === skippedActionKey)?.reasonCode, "ROUTE_NOT_SELECTED")
        return true
      },
    )
  })

  test("flattens route actions with their route breadcrumb", () => {
    const flattened = flattenAutomationActionTree(parseActionSnapshot(snapshot()))
    assert.deepEqual(flattened.map((item) => item.action.nodeKey), [
      IDS.split,
      IDS.actionOne,
      IDS.actionTwo,
    ])
    assert.deepEqual(flattened[1]?.branchPath.map((item) => item.branchName), ["Treatment"])
    assert.deepEqual(flattened[2]?.branchPath.map((item) => item.branchName), ["Control"])
  })

  test("rejects corrupt percentages in pinned snapshots", () => {
    assert.throws(() => parseActionSnapshot(snapshot([25, 25])), /total 100%/)
  })
})
