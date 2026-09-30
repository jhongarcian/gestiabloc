import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { queueOpportunityAutomationEvent } from "./automation-event-queue.js"

const WAIT_ACTION = {
  id: "action-1",
  nodeKey: "00000000-0000-4000-8000-000000000001",
  type: "WAIT",
  waitConfig: { mode: "DURATION", amount: 1, unit: "SECONDS" },
}

describe("queueOpportunityAutomationEvent", () => {
  test("captures event-time decisions and writes queued trigger logs without running actions", async () => {
    const captured: Record<string, any> = {}
    const automations = [
      {
        id: "automation-run",
        name: "Run",
        sortOrder: 0,
        triggerType: "OPPORTUNITY_STAGE_CHANGED",
        pipelineId: "pipeline-1",
        targetStageId: "stage-2",
        sourceStageId: null,
        conditions: [],
        actions: [WAIT_ACTION],
      },
      {
        id: "automation-filter",
        name: "Filter mismatch",
        sortOrder: 1,
        triggerType: "OPPORTUNITY_STAGE_CHANGED",
        pipelineId: "pipeline-1",
        targetStageId: "stage-2",
        sourceStageId: null,
        conditions: [{
          source: "CONTACT_ASSIGNEE",
          operator: "EQUALS",
          assignedUserId: "user-john",
          compareValue: null,
        }],
        actions: [WAIT_ACTION],
      },
      {
        id: "automation-stage",
        name: "Stage mismatch",
        sortOrder: 2,
        triggerType: "OPPORTUNITY_STAGE_CHANGED",
        pipelineId: "pipeline-1",
        targetStageId: "stage-3",
        sourceStageId: null,
        conditions: [],
        actions: [WAIT_ACTION],
      },
    ]
    const prismaTx = {
      automation: {
        findMany: async ({ where }: any) => {
          captured.where = where
          return automations
        },
      },
      contact: {
        findFirst: async () => ({
          firstName: "Mary",
          middleName: null,
          lastName: "Reed",
          statusConfigId: "status-active",
          assignedToUserId: "user-mary",
          tags: [],
          customFieldValues: [],
        }),
      },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [{ id: "status-active", name: "Active" }] },
      taskStatusConfig: { findMany: async () => [] },
      membership: {
        findMany: async () => [
          { userId: "user-john", user: { name: "John", email: "john@example.com" } },
          { userId: "user-mary", user: { name: "Mary", email: "mary@example.com" } },
        ],
      },
      tenantTag: { findMany: async () => [] },
      opportunityPipeline: {
        findMany: async () => [{
          id: "pipeline-1",
          name: "Work",
          stages: [
            { id: "stage-1", name: "New" },
            { id: "stage-2", name: "Working" },
            { id: "stage-3", name: "Closed" },
          ],
        }],
      },
      tenant: { findUnique: async () => ({ timezone: "America/Chicago" }) },
      automationEvent: {
        create: async ({ data }: any) => {
          captured.event = data
          return data
        },
      },
      automationDispatch: {
        createMany: async ({ data }: any) => {
          captured.dispatches = data
          return { count: data.length }
        },
      },
      automationNodeExecution: {
        createMany: async ({ data }: any) => {
          captured.logs = data
          return { count: data.length }
        },
      },
    }

    const result = await queueOpportunityAutomationEvent(prismaTx, {
      tenantId: "tenant-1",
      actorUserId: "actor-1",
      triggerType: "OPPORTUNITY_STAGE_CHANGED",
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-1",
      valueCents: 25_000,
      sourceStageId: "stage-1",
      targetStageId: "stage-2",
    })

    assert.deepEqual(captured.where, {
      tenantId: "tenant-1",
      isEnabled: true,
      triggerType: "OPPORTUNITY_STAGE_CHANGED",
      pipelineId: "pipeline-1",
    })
    assert.deepEqual(captured.dispatches.map((item: any) => item.decision), [
      "RUN",
      "SKIP_FILTERS",
      "SKIP_TRIGGER",
    ])
    assert.ok(captured.dispatches[1].decisionDetails.includes("expected John, found Mary"))
    assert.equal(captured.logs.length, 3)
    assert.ok(captured.logs.every((item: any) => item.status === "QUEUED"))
    assert.equal(result.automationStatus, "QUEUED")
    assert.equal(result.queuedAutomationCount, 3)
    assert.equal(result.matchedCount, 1)
  })

  test("does not create a queue event when no trigger and pipeline candidate exists", async () => {
    const result = await queueOpportunityAutomationEvent({
      automation: { findMany: async () => [] },
    }, {
      tenantId: "tenant-1",
      actorUserId: "actor-1",
      triggerType: "OPPORTUNITY_CREATED",
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-1",
      valueCents: 0,
      sourceStageId: null,
      targetStageId: "stage-1",
    })

    assert.equal(result.automationStatus, "NOT_APPLICABLE")
    assert.equal(result.automationEventId, null)
    assert.equal(result.queuedAutomationCount, 0)
  })
})
