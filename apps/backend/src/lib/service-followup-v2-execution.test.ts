import assert from "node:assert/strict"
import test from "node:test"

import {
  branchExclusiveStepNodeIds,
  selectFirstMatchingBranch,
} from "./service-followup-runtime.js"
import type {
  WorkflowBranchV2,
  WorkflowDefinitionV2,
} from "./service-followup-definition.js"

const branches: WorkflowBranchV2[] = [
  {
    id: "all",
    name: "All",
    isDefault: false,
    matchMode: "ALL",
    conditions: [
      { id: "a", source: "contactInfo", fieldKey: "state", valueType: "string", operator: "eq", compareValue: "TX" },
      { id: "b", source: "variable", variableKey: "age", valueType: "number", operator: "gte", compareValue: 65 },
    ],
  },
  {
    id: "any",
    name: "Any",
    isDefault: false,
    matchMode: "ANY",
    conditions: [
      { id: "c", source: "contactInfo", fieldKey: "state", valueType: "string", operator: "eq", compareValue: "OK" },
      { id: "d", source: "variable", variableKey: "age", valueType: "number", operator: "gte", compareValue: 65 },
    ],
  },
  { id: "default", name: "Default", isDefault: true, matchMode: "ALL", conditions: [] },
]

test("conditions use ordered first-match semantics with ALL and ANY", () => {
  const selected = selectFirstMatchingBranch(branches, (condition) => {
    if (condition.fieldKey === "state") return "TX"
    if (condition.variableKey === "age") return 70
    return null
  })
  assert.equal(selected?.id, "all")

  const anySelected = selectFirstMatchingBranch(branches, (condition) => {
    if (condition.fieldKey === "state") return "NM"
    if (condition.variableKey === "age") return 70
    return null
  })
  assert.equal(anySelected?.id, "any")

  const fallback = selectFirstMatchingBranch(branches, () => null)
  assert.equal(fallback?.id, "default")
})

test("branch-exclusive steps exclude the shared join", () => {
  const definition: WorkflowDefinitionV2 = {
    schemaVersion: 2,
    nodes: [
      { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 }, data: {} },
      { id: "if", kind: "ifElse", label: "Route", position: { x: 0, y: 1 }, data: {} },
      { id: "left", kind: "step", label: "Left", position: { x: -1, y: 2 }, data: {} },
      { id: "right", kind: "step", label: "Right", position: { x: 1, y: 2 }, data: {} },
      { id: "join", kind: "step", label: "Shared", position: { x: 0, y: 3 }, data: {} },
      { id: "end", kind: "end", label: "End", position: { x: 0, y: 4 }, data: {} },
    ],
    edges: [
      { id: "s-i", source: "start", target: "if" },
      { id: "if-left", source: "if", target: "left", branchId: "left-branch" },
      { id: "if-right", source: "if", target: "right", branchId: "right-branch" },
      { id: "left-join", source: "left", target: "join" },
      { id: "right-join", source: "right", target: "join" },
      { id: "join-end", source: "join", target: "end" },
    ],
  }

  assert.deepEqual(branchExclusiveStepNodeIds(definition, "if", "if-left"), ["right"])
})

test("creating a versioned run records one fully linked flow-start event", async () => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test"
  const { createFollowUpRunTx } = await import("./service-followup-v2-execution.js")
  const logWrites: Array<Record<string, any>> = []
  const stepWrites: Array<Record<string, any>> = []
  const prismaTx = {
    contactServiceFollowUpRun: {
      create: async () => ({ id: "run-1" }),
    },
    serviceFollowUpExecutionLog: {
      create: async (value: Record<string, any>) => {
        logWrites.push(value)
        return value
      },
    },
    contactServiceFollowUpStep: {
      createMany: async (value: Record<string, any>) => {
        stepWrites.push(value)
        return { count: value.data.length }
      },
    },
  }

  await createFollowUpRunTx({
    prismaTx,
    tenantId: "tenant-1",
    templateId: "template-1",
    contactId: "contact-1",
    contactServiceId: "enrollment-1",
    templateVersion: {
      id: "version-1",
      definition: {
        schemaVersion: 3,
        start: { id: "start", label: "Start" },
        end: { id: "end", label: "End" },
        steps: [{ id: "review", name: "Review", dueDaysFromStart: 0 }],
        transitions: [
          { id: "start-transition", fromId: "start", actions: [], route: { kind: "NEXT" } },
          { id: "review-transition", fromId: "review", actions: [], route: { kind: "NEXT" } },
        ],
      },
    },
    startedByUserId: "user-1",
  })

  assert.equal(logWrites.length, 1)
  assert.equal(logWrites[0]?.data.eventType, "FLOW_STARTED")
  assert.equal(logWrites[0]?.data.templateId, "template-1")
  assert.equal(logWrites[0]?.data.templateVersionId, "version-1")
  assert.equal(logWrites[0]?.data.runId, "run-1")
  assert.equal(logWrites[0]?.data.contactServiceId, "enrollment-1")
  assert.equal(logWrites[0]?.data.contactId, "contact-1")
  assert.equal(logWrites[0]?.data.actorUserId, "user-1")
  assert.equal(stepWrites.length, 1)
})

test("an executed action returns its logged outcome with run and version linkage", async () => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test"
  const { executeActionNode } = await import("./service-followup-execution.js")
  const logWrites: Array<Record<string, any>> = []
  const prismaTx = {
    membership: {
      findUnique: async () => ({ status: "ACTIVE" }),
    },
    contact: {
      update: async () => ({ id: "contact-1" }),
    },
    serviceFollowUpExecutionLog: {
      create: async (value: Record<string, any>) => {
        logWrites.push(value)
        return value
      },
    },
  }

  const actionWasLogged = await executeActionNode({
    prismaTx,
    tenantId: "tenant-1",
    templateId: "template-1",
    templateVersionId: "version-1",
    runId: "run-1",
    actorUserId: "user-1",
    contactService: {
      id: "enrollment-1",
      contactId: "contact-1",
      serviceName: "Service",
      contactName: "Ada Lovelace",
    },
    node: {
      id: "assign-owner",
      data: {
        kind: "assign",
        label: "Assign owner",
        assigneeUserId: "owner-1",
      },
    },
    customFieldByKey: new Map(),
  })

  assert.equal(actionWasLogged, true)
  assert.equal(logWrites.length, 1)
  assert.equal(logWrites[0]?.data.eventType, "ACTION_EXECUTED")
  assert.equal(logWrites[0]?.data.templateVersionId, "version-1")
  assert.equal(logWrites[0]?.data.runId, "run-1")
})

test("stages a user-scheduled Wait input before workflow traversal", async () => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test"
  const { stageUserScheduledWaitInputTx } = await import("./service-followup-v2-execution.js")
  const scheduledFor = new Date("2030-05-01T15:30:00.000Z")
  let staged: Record<string, any> | null = null
  const definition = {
    schemaVersion: 3,
    start: { id: "start", label: "Start" },
    end: { id: "end", label: "End" },
    steps: [
      { id: "collect", name: "Collect", dueDaysFromStart: 0 },
      { id: "submit", name: "Submit", dueDaysFromStart: 1 },
    ],
    transitions: [
      { id: "start-transition", fromId: "start", actions: [], route: { kind: "NEXT" } },
      {
        id: "collect-transition",
        fromId: "collect",
        actions: [{
          id: "appointment-wait",
          kind: "wait",
          label: "Schedule appointment",
          data: { waitMode: "USER_SCHEDULED", prompt: "Select the appointment date." },
        }],
        route: { kind: "NEXT" },
      },
      { id: "submit-transition", fromId: "submit", actions: [], route: { kind: "NEXT" } },
    ],
  }
  const prismaTx = {
    contactServiceFollowUpRun: {
      findUnique: async () => ({
        id: "run-1",
        tenantId: "tenant-1",
        templateVersion: { definition },
      }),
    },
    serviceFollowUpNodeExecution: {
      upsert: async (value: Record<string, any>) => {
        staged = value
        return value
      },
    },
  }

  const requirement = await stageUserScheduledWaitInputTx({
    prismaTx,
    runId: "run-1",
    stepNodeId: "collect",
    actorUserId: "user-1",
    scheduledFor,
    bypassed: false,
  })

  assert.equal(requirement?.actionId, "appointment-wait")
  const stagedValue = staged as Record<string, any> | null
  assert.equal(stagedValue?.create.input.scheduledFor, scheduledFor.toISOString())
  assert.equal(stagedValue?.create.input.suppliedByUserId, "user-1")
  assert.equal(stagedValue?.create.input.bypassed, false)
  assert.equal(stagedValue?.create.attemptCount, 0)
})

test("stages a bypass marker without requiring a date when the user skips", async () => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test"
  const { stageUserScheduledWaitInputTx } = await import("./service-followup-v2-execution.js")
  let staged: Record<string, any> | null = null
  const prismaTx = {
    contactServiceFollowUpRun: {
      findUnique: async () => ({
        id: "run-2",
        tenantId: "tenant-1",
        templateVersion: {
          definition: {
            schemaVersion: 3,
            start: { id: "start", label: "Start" },
            end: { id: "end", label: "End" },
            steps: [
              { id: "collect", name: "Collect", dueDaysFromStart: 0 },
              { id: "submit", name: "Submit", dueDaysFromStart: 1 },
            ],
            transitions: [
              { id: "start-transition", fromId: "start", actions: [], route: { kind: "NEXT" } },
              {
                id: "collect-transition",
                fromId: "collect",
                actions: [{
                  id: "manual-wait",
                  kind: "wait",
                  label: "Wait",
                  data: { waitMode: "USER_SCHEDULED", prompt: "Choose a date." },
                }],
                route: { kind: "NEXT" },
              },
              { id: "submit-transition", fromId: "submit", actions: [], route: { kind: "NEXT" } },
            ],
          },
        },
      }),
    },
    serviceFollowUpNodeExecution: {
      upsert: async (value: Record<string, any>) => {
        staged = value
        return value
      },
    },
  }

  await stageUserScheduledWaitInputTx({
    prismaTx,
    runId: "run-2",
    stepNodeId: "collect",
    actorUserId: "user-2",
    bypassed: true,
  })

  const stagedValue = staged as Record<string, any> | null
  assert.equal(stagedValue?.create.input.scheduledFor, null)
  assert.equal(stagedValue?.create.input.bypassed, true)
})

test("legacy active-step synchronization repairs stale active steps on waiting versioned runs", async () => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test"
  const { syncContactServiceActiveStep } = await import("./service-followup-execution.js")
  let repairedStatus: string | null = null
  const prismaTx = {
    contactServiceFollowUpRun: {
      findUnique: async () => ({ id: "run-1", status: "WAITING", activeStepId: null }),
    },
    contactServiceFollowUpStep: {
      findFirst: async () => ({ id: "stale-step" }),
      updateMany: async (value: Record<string, any>) => {
        repairedStatus = value.data.status
        return { count: 1 }
      },
    },
  }

  const result = await syncContactServiceActiveStep({
    prismaTx,
    tenantId: "tenant-1",
    contactServiceId: "service-1",
  })

  assert.equal(result, "stale-step")
  assert.equal(repairedStatus, "PENDING")
})

test("legacy active-step synchronization does not touch the engine-owned active step", async () => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test"
  const { syncContactServiceActiveStep } = await import("./service-followup-execution.js")
  let queriedSteps = false
  const prismaTx = {
    contactServiceFollowUpRun: {
      findUnique: async () => ({
        id: "run-2",
        status: "AWAITING_STEP",
        activeStepId: "active-step",
      }),
    },
    contactServiceFollowUpStep: {
      findFirst: async () => {
        queriedSteps = true
        return null
      },
    },
  }

  const result = await syncContactServiceActiveStep({
    prismaTx,
    tenantId: "tenant-1",
    contactServiceId: "service-1",
  })

  assert.equal(result, null)
  assert.equal(queriedSteps, false)
})

test("continuing early activates now while preserving the selected due date", async () => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test"
  const { userScheduledActivationDatesFromInput } = await import(
    "./service-followup-v2-execution.js"
  )
  const result = userScheduledActivationDatesFromInput({
    scheduledFor: "2030-05-10T15:00:00.000Z",
    continuedEarlyAt: "2030-05-01T12:00:00.000Z",
    continuedEarlyByUserId: "user-1",
  })

  assert.equal(result?.availableAt.toISOString(), "2030-05-01T12:00:00.000Z")
  assert.equal(result?.dueAt.toISOString(), "2030-05-10T15:00:00.000Z")
})

test("scheduled resume uses the selected timestamp for availability and due date", async () => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test"
  const { userScheduledActivationDatesFromInput } = await import(
    "./service-followup-v2-execution.js"
  )
  const result = userScheduledActivationDatesFromInput({
    scheduledFor: "2030-05-10T15:00:00.000Z",
  })

  assert.equal(result?.availableAt.toISOString(), "2030-05-10T15:00:00.000Z")
  assert.equal(result?.dueAt.toISOString(), "2030-05-10T15:00:00.000Z")
})

test("continuing a duration Wait early preserves its original due date", async () => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test"
  const { durationWaitActivationDates } = await import(
    "./service-followup-v2-execution.js"
  )
  const result = durationWaitActivationDates(
    "2030-05-10T15:00:00.000Z",
    {
      continuedEarlyAt: "2030-05-01T12:00:00.000Z",
      continuedEarlyByUserId: "user-1",
    },
  )

  assert.equal(result?.availableAt.toISOString(), "2030-05-01T12:00:00.000Z")
  assert.equal(result?.dueAt.toISOString(), "2030-05-10T15:00:00.000Z")
})
