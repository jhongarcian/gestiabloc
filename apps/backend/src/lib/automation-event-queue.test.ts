import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { claimQueuedAutomationDispatch, queueContactChangedAutomationEvent, queueContactCreatedAutomationEvent, queueOpportunityAutomationEvent } from "./automation-event-queue.js"

const WAIT_ACTION = {
  id: "action-1",
  nodeKey: "00000000-0000-4000-8000-000000000001",
  type: "WAIT",
  waitConfig: { mode: "DURATION", amount: 1, unit: "SECONDS" },
}

describe("queueContactCreatedAutomationEvent", () => {
  test("matches the creation snapshot across standard fields, custom fields, and tags", async () => {
    const writes: Record<string, any> = {}
    const contact = {
      id: "contact-1",
      firstName: "Mary",
      middleName: null,
      lastName: "Reed",
      email: "mary@example.com",
      dateOfBirth: new Date("1990-05-03T12:00:00.000Z"),
      statusConfigId: "status-active",
      assignedToUserId: null,
      tags: [{ tagId: "tag-new" }],
      customFieldValues: [{ fieldId: "field-source", value: "Referral" }],
    }
    const base = {
      name: "Welcome",
      triggerType: "CONTACT_CREATED",
      pipelineId: null,
      conditions: [
        { source: "CONTACT_FIELD", fieldKey: "email", operator: "CONTAINS", compareValue: "@example.com" },
        { source: "CONTACT_FIELD", fieldKey: "date_of_birth", operator: "EQUALS", compareValue: "1990-05-03" },
        { source: "CONTACT_CUSTOM_FIELD", customFieldId: "field-source", operator: "EQUALS", compareValue: "Referral" },
        { source: "CONTACT_TAGS", tagId: "tag-new", operator: "EQUALS", compareValue: null },
      ],
      actions: [WAIT_ACTION],
    }
    const prismaTx = {
      automation: { findMany: async () => [
        { ...base, id: "automation-match" },
        { ...base, id: "automation-skip", conditions: [{ source: "CONTACT_FIELD", fieldKey: "first_name", operator: "EQUALS", compareValue: "John" }] },
      ] },
      contact: { findFirst: async () => contact },
      contactCustomField: { findMany: async () => [{ id: "field-source", key: "source", label: "Source", fieldType: "TEXT", isActive: true, isEncrypted: false, isSensitive: false, options: null }] },
      contactStatusConfig: { findMany: async () => [{ id: "status-active", name: "Active" }] },
      taskStatusConfig: { findMany: async () => [] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [{ id: "tag-new", name: "New" }] },
      opportunityPipeline: { findMany: async () => [] },
      tenant: { findUnique: async () => ({ timezone: "America/Chicago" }) },
      automationEvent: { create: async ({ data }: any) => { writes.event = data; return data } },
      automationDispatch: { createMany: async ({ data }: any) => { writes.dispatches = data } },
      automationNodeExecution: { createMany: async ({ data }: any) => { writes.logs = data } },
    }
    const result = await queueContactCreatedAutomationEvent(prismaTx, {
      tenantId: "tenant-1", contactId: "contact-1", actorUserId: "actor-1",
    })
    assert.equal(result.matchedCount, 1)
    assert.equal(writes.dispatches[0].automationId, "automation-match")
    assert.equal(writes.dispatches.length, 1)
    assert.equal(writes.event.triggerType, "CONTACT_CREATED")
    assert.equal(writes.event.pipelineId, null)
    assert.equal(writes.event.opportunitySnapshotId, null)
    assert.equal(writes.logs[0].eventSource, "CONTACT_CREATED")
  })
})

describe("queueContactChangedAutomationEvent", () => {
  test("does not queue a no-op and stops an over-deep automation chain", async () => {
    const before = { id: "contact-1", firstName: "Mary", statusConfigId: "active", assignedToUserId: null, tags: [], customFieldValues: [] }
    let after = before
    const prismaTx = { contact: { findFirst: async () => after } }
    const noOp = await queueContactChangedAutomationEvent(prismaTx, { tenantId: "tenant-1", contactId: "contact-1", actorUserId: null, before })
    assert.equal(noOp.automationEventId, null)
    after = { ...before, firstName: "Maria" }
    await assert.rejects(
      queueContactChangedAutomationEvent(prismaTx, { tenantId: "tenant-1", contactId: "contact-1", actorUserId: null, before, chainDepth: 21 }),
      /maximum automation chain depth/,
    )
  })
  test("queues one matching run after all change rules and resulting-state filters pass", async () => {
    const writes: Record<string, any> = {}
    const before = { id: "contact-1", firstName: "Mary", lastName: "Reed", statusConfigId: "active", assignedToUserId: null, tags: [], customFieldValues: [] }
    const after = { ...before, firstName: "Maria", tags: [{ tagId: "new" }] }
    const changes = [
      { source: "CONTACT_FIELD", operator: "HAS_CHANGED_TO", fieldKey: "firstName", compareValue: "Maria" },
      { source: "CONTACT_TAGS", operator: "ADDED", tagId: "new" },
    ]
    const base = { name: "Contact changed", triggerType: "CONTACT_CHANGED", changeRules: changes, conditions: [], actions: [WAIT_ACTION] }
    const prismaTx = {
      contact: { findFirst: async () => after },
      automation: { findMany: async () => [
        { ...base, id: "match", conditions: [{ source: "CONTACT_FIELD", operator: "EQUALS", fieldKey: "first_name", compareValue: "Maria" }] },
        { ...base, id: "filter-fail", conditions: [{ source: "CONTACT_FIELD", operator: "EQUALS", fieldKey: "first_name", compareValue: "Mary" }] },
        { ...base, id: "change-fail", changeRules: [...changes, { source: "CONTACT_ASSIGNEE", operator: "HAS_CHANGED" }] },
      ] },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [{ id: "active", name: "Active" }] },
      taskStatusConfig: { findMany: async () => [] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [{ id: "new", name: "New" }] },
      opportunityPipeline: { findMany: async () => [] },
      tenant: { findUnique: async () => ({ timezone: "America/Chicago" }) },
      automationEvent: { create: async ({ data }: any) => { writes.event = data; return data } },
      automationDispatch: { createMany: async ({ data }: any) => { writes.dispatches = data } },
      automationNodeExecution: { createMany: async ({ data }: any) => { writes.logs = data } },
    }
    const result = await queueContactChangedAutomationEvent(prismaTx, { tenantId: "tenant-1", contactId: "contact-1", actorUserId: null, before })
    assert.equal(result.matchedCount, 1)
    assert.equal(writes.dispatches[0].automationId, "match")
    assert.equal(writes.event.triggerType, "CONTACT_CHANGED")
    assert.equal(writes.logs[0].eventSource, "CONTACT_CHANGED")
  })
})

describe("queueOpportunityAutomationEvent", () => {
  test("claims only a dispatch that is still queued", async () => {
    let where: Record<string, unknown> | null = null
    const claimed = await claimQueuedAutomationDispatch({
      automationDispatch: {
        updateMany: async (args: { where: Record<string, unknown> }) => {
          where = args.where
          return { count: 0 }
        },
      },
    }, { id: "dispatch-1", startedAt: null }, new Date("2026-10-02T12:00:00.000Z"))

    assert.equal(claimed, false)
    assert.deepEqual(where, { id: "dispatch-1", status: "QUEUED" })
  })

  test("queues and logs only automations that match the trigger and contact filters", async () => {
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
      pipelineId: "pipeline-1",
      OR: [
        { triggerType: "OPPORTUNITY_STAGE_CHANGED", targetStageId: "stage-2" },
        { triggerType: "OPPORTUNITY_CHANGED", targetStageId: "stage-2", targetResult: null },
      ],
    })
    assert.deepEqual(captured.dispatches.map((item: any) => item.decision), ["RUN"])
    assert.equal(captured.dispatches[0].automationId, "automation-run")
    assert.equal(captured.event.dispatchCount, 1)
    assert.equal(captured.logs.length, 1)
    assert.ok(captured.logs.every((item: any) => item.status === "QUEUED"))
    assert.equal(result.automationStatus, "QUEUED")
    assert.equal(result.queuedAutomationCount, 1)
    assert.equal(result.matchedCount, 1)
    assert.equal(captured.event.chainDepth, 0)
    assert.equal(captured.event.chainId, captured.event.id)
    assert.deepEqual(captured.event.transitionHistory, [{
      kind: "STAGE_CHANGED",
      opportunityKey: "opportunity-1",
      pipelineId: "pipeline-1",
      sourceStageId: "stage-1",
      targetStageId: "stage-2",
      sourceResult: null,
      targetResult: null,
    }])
  })

  test("does not create queue records when every candidate fails contact filters", async () => {
    const writes = {
      events: 0,
      dispatches: 0,
      logs: 0,
    }
    const result = await queueOpportunityAutomationEvent({
      automation: {
        findMany: async () => [{
          id: "automation-filter",
          name: "John opportunities",
          triggerType: "OPPORTUNITY_CREATED",
          pipelineId: "pipeline-1",
          targetStageId: null,
          sourceStageId: null,
          conditions: [{
            source: "CONTACT_ASSIGNEE",
            operator: "EQUALS",
            assignedUserId: "user-john",
            compareValue: null,
          }],
          actions: [WAIT_ACTION],
        }],
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
          stages: [{ id: "stage-1", name: "New" }],
        }],
      },
      tenant: { findUnique: async () => ({ timezone: "America/Chicago" }) },
      automationEvent: { create: async () => { writes.events += 1 } },
      automationDispatch: { createMany: async () => { writes.dispatches += 1 } },
      automationNodeExecution: { createMany: async () => { writes.logs += 1 } },
    }, {
      tenantId: "tenant-1",
      actorUserId: "actor-1",
      triggerType: "OPPORTUNITY_CREATED",
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-1",
      valueCents: 25_000,
      sourceStageId: null,
      targetStageId: "stage-1",
    })

    assert.deepEqual(result, {
      automationEventId: null,
      automationStatus: "NOT_APPLICABLE",
      queuedAutomationCount: 0,
      matchedCount: 0,
      executedCount: 0,
      contactDeleted: false,
    })
    assert.deepEqual(writes, { events: 0, dispatches: 0, logs: 0 })
  })

  test("returns the existing child event for the same causation key", async () => {
    let automationQueries = 0
    const result = await queueOpportunityAutomationEvent({
      automationEvent: {
        findUnique: async () => ({
          id: "existing-event",
          completedCount: 1,
          dispatches: [{ decision: "RUN" }, { decision: "SKIP_FILTERS" }],
        }),
      },
      automation: { findMany: async () => { automationQueries += 1; return [] } },
    }, {
      tenantId: "tenant-1",
      actorUserId: null,
      triggerType: "OPPORTUNITY_CREATED",
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-1",
      valueCents: 0,
      sourceStageId: null,
      targetStageId: "stage-1",
      causationKey: "automation-run:run-1:node:node-1",
    })

    assert.equal(result.automationEventId, "existing-event")
    assert.equal(result.queuedAutomationCount, 2)
    assert.equal(result.matchedCount, 1)
    assert.equal(result.executedCount, 1)
    assert.equal(automationQueries, 0)
  })

  test("does not create a queue event when no trigger and pipeline candidate exists", async () => {
    let where: Record<string, unknown> | undefined
    const result = await queueOpportunityAutomationEvent({
      automation: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          where = args.where
          return []
        },
      },
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
    assert.deepEqual(where, {
      tenantId: "tenant-1",
      isEnabled: true,
      triggerType: "OPPORTUNITY_CREATED",
      pipelineId: "pipeline-1",
    })
  })
})
