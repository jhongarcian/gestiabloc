import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  hydrateAutomationTrigger,
  isAutomationTriggerReady,
  serializeAutomationTrigger,
} from "./automation-trigger.js"

describe("automation trigger payloads", () => {
  test("contact creation needs no pipeline and round trips through the builder", () => {
    const draft = { triggerType: "CONTACT_CREATED" as const, pipelineId: "", changeType: "" as const, targetStageId: "", changes: [] }
    assert.equal(isAutomationTriggerReady(draft), true)
    assert.deepEqual(serializeAutomationTrigger(draft), { type: "CONTACT_CREATED" })
    assert.deepEqual(hydrateAutomationTrigger({ type: "CONTACT_CREATED" }), draft)
  })
  test("note added needs no pipeline and preserves optional contact filters separately", () => {
    const draft = { triggerType: "CONTACT_NOTE_ADDED" as const, pipelineId: "", changeType: "" as const, targetStageId: "", changes: [] }
    assert.equal(isAutomationTriggerReady(draft), true)
    assert.deepEqual(serializeAutomationTrigger(draft), { type: "CONTACT_NOTE_ADDED" })
    assert.deepEqual(hydrateAutomationTrigger({ type: "CONTACT_NOTE_ADDED" }), draft)
  })
  test("task added needs no pipeline and round trips through the builder", () => {
    const draft = { triggerType: "TASK_ADDED" as const, pipelineId: "", changeType: "" as const, targetStageId: "", changes: [] }
    assert.equal(isAutomationTriggerReady(draft), true)
    assert.deepEqual(serializeAutomationTrigger(draft), { type: "TASK_ADDED" })
    assert.deepEqual(hydrateAutomationTrigger({ type: "TASK_ADDED" }), draft)
  })
  test("task completed needs no pipeline and round trips through the builder", () => {
    const draft = { triggerType: "TASK_COMPLETED" as const, pipelineId: "", changeType: "" as const, targetStageId: "", changes: [] }
    assert.equal(isAutomationTriggerReady(draft), true)
    assert.deepEqual(serializeAutomationTrigger(draft), { type: "TASK_COMPLETED" })
    assert.deepEqual(hydrateAutomationTrigger({ type: "TASK_COMPLETED" }), draft)
  })
  test("appointment created needs no pipeline and round trips through the builder", () => {
    const draft = { triggerType: "APPOINTMENT_CREATED" as const, pipelineId: "", changeType: "" as const, targetStageId: "", changes: [] }
    assert.equal(isAutomationTriggerReady(draft), true)
    assert.deepEqual(serializeAutomationTrigger(draft), { type: "APPOINTMENT_CREATED" })
    assert.deepEqual(hydrateAutomationTrigger({ type: "APPOINTMENT_CREATED" }), draft)
  })
  test("appointment status changed requires one destination status and round trips", () => {
    const draft = { triggerType: "APPOINTMENT_STATUS_CHANGED" as const, pipelineId: "", changeType: "" as const, targetStageId: "", changes: [], appointmentTargetStatus: "COMPLETED" as const }
    assert.equal(isAutomationTriggerReady(draft), true)
    assert.deepEqual(serializeAutomationTrigger(draft), { type: "APPOINTMENT_STATUS_CHANGED", status: "COMPLETED" })
    assert.deepEqual(hydrateAutomationTrigger({ type: "APPOINTMENT_STATUS_CHANGED", status: "COMPLETED" }), draft)
    assert.equal(isAutomationTriggerReady({ ...draft, appointmentTargetStatus: "" }), false)
  })
  test("birthday reminder keeps its chosen local time", () => {
    const draft = { triggerType: "BIRTHDAY_REMINDER" as const, pipelineId: "", changeType: "" as const, targetStageId: "", changes: [], birthdayLocalTime: "14:30" }
    assert.equal(isAutomationTriggerReady(draft), true)
    assert.deepEqual(serializeAutomationTrigger(draft), { type: "BIRTHDAY_REMINDER", localTime: "14:30" })
    assert.deepEqual(hydrateAutomationTrigger({ type: "BIRTHDAY_REMINDER", localTime: "14:30" }), draft)
    assert.equal(isAutomationTriggerReady({ ...draft, birthdayLocalTime: "25:00" }), false)
  })
  test("contact changes require rules and preserve their target values", () => {
    const changes = [
      { source: "CONTACT_ASSIGNEE" as const, operator: "HAS_CHANGED_TO" as const, assignedUserId: null },
      { source: "CONTACT_TAGS" as const, operator: "ADDED" as const, tagId: null },
    ]
    const draft = { triggerType: "CONTACT_CHANGED" as const, pipelineId: "", changeType: "" as const, targetStageId: "", changes }
    assert.equal(isAutomationTriggerReady(draft), true)
    assert.deepEqual(serializeAutomationTrigger(draft), { type: "CONTACT_CHANGED", changes })
    assert.deepEqual(hydrateAutomationTrigger({ type: "CONTACT_CHANGED", changes }), draft)
    assert.equal(isAutomationTriggerReady({ ...draft, changes: [] }), false)
  })
  test("contact tag requires exactly one selected tag and round trips", () => {
    const changes = [{ source: "CONTACT_TAGS" as const, operator: "REMOVED" as const, tagId: "tag-1" }]
    const draft = { triggerType: "CONTACT_TAG" as const, pipelineId: "", changeType: "" as const, targetStageId: "", changes }
    assert.equal(isAutomationTriggerReady(draft), true)
    assert.deepEqual(serializeAutomationTrigger(draft), { type: "CONTACT_TAG", tagId: "tag-1", change: "REMOVED" })
    assert.deepEqual(hydrateAutomationTrigger({ type: "CONTACT_TAG", tagId: "tag-1", change: "REMOVED" }), draft)
    assert.equal(isAutomationTriggerReady({ ...draft, changes: [{ ...changes[0], tagId: "" }] }), false)
    assert.equal(isAutomationTriggerReady({ ...draft, changes: [...changes, ...changes] }), false)
  })
  test("serializes stage, Won, and Lost listeners", () => {
    assert.deepEqual(serializeAutomationTrigger({
      triggerType: "OPPORTUNITY_CHANGED",
      pipelineId: "pipeline-1",
      changeType: "STAGE_ENTERED",
      targetStageId: "stage-2",
    }), {
      type: "OPPORTUNITY_CHANGED",
      pipelineId: "pipeline-1",
      change: { type: "STAGE_ENTERED", stageId: "stage-2" },
    })
    assert.deepEqual(serializeAutomationTrigger({
      triggerType: "OPPORTUNITY_CHANGED",
      pipelineId: "pipeline-1",
      changeType: "RESULT_WON",
      targetStageId: "",
    }), {
      type: "OPPORTUNITY_CHANGED",
      pipelineId: "pipeline-1",
      change: { type: "RESULT_CHANGED", result: "WON" },
    })
    assert.deepEqual(serializeAutomationTrigger({
      triggerType: "OPPORTUNITY_CHANGED",
      pipelineId: "pipeline-1",
      changeType: "RESULT_LOST",
      targetStageId: "",
    }).change, { type: "RESULT_CHANGED", result: "LOST" })
  })

  test("hydrates the new contract and legacy stage records", () => {
    assert.deepEqual(hydrateAutomationTrigger({
      type: "OPPORTUNITY_CHANGED",
      pipelineId: "pipeline-1",
      change: { type: "RESULT_CHANGED", result: "LOST" },
    }), {
      triggerType: "OPPORTUNITY_CHANGED",
      pipelineId: "pipeline-1",
      changeType: "RESULT_LOST",
      targetStageId: "",
    })
    assert.deepEqual(hydrateAutomationTrigger({
      type: "OPPORTUNITY_STAGE_CHANGED",
      pipelineId: "pipeline-1",
      targetStageId: "stage-2",
    }), {
      triggerType: "OPPORTUNITY_CHANGED",
      pipelineId: "pipeline-1",
      changeType: "STAGE_ENTERED",
      targetStageId: "stage-2",
    })
  })

  test("requires a selected stage only for stage listeners", () => {
    assert.equal(isAutomationTriggerReady({
      triggerType: "OPPORTUNITY_CHANGED",
      pipelineId: "pipeline-1",
      changeType: "STAGE_ENTERED",
      targetStageId: "",
    }), false)
    assert.equal(isAutomationTriggerReady({
      triggerType: "OPPORTUNITY_CHANGED",
      pipelineId: "pipeline-1",
      changeType: "RESULT_WON",
      targetStageId: "",
    }), true)
    assert.throws(() => serializeAutomationTrigger({
      triggerType: "OPPORTUNITY_CHANGED",
      pipelineId: "pipeline-1",
      changeType: "",
      targetStageId: "",
    }), /change to listen for/)
  })
})


test("service step entry triggers retain their selected step and legacy shared scope", () => {
  const trigger = { type: "SERVICE_STEP_ENTERED" as const, serviceStepId: "step-1", serviceOfferingId: null }
  const draft = hydrateAutomationTrigger(trigger)
  assert.equal(isAutomationTriggerReady(draft), true)
  assert.deepEqual(serializeAutomationTrigger(draft), trigger)
  assert.equal(isAutomationTriggerReady({ ...draft, serviceStepId: undefined }), false)
  assert.throws(() => serializeAutomationTrigger({ ...draft, serviceStepId: undefined }), /Select a service/)
})

 test("completion trigger keeps its step binding through editing", () => {
  const trigger = { type: "SERVICE_STEP_COMPLETED" as const, serviceStepId: "completion-step", serviceOfferingId: null }
  const draft = hydrateAutomationTrigger(trigger)
  assert.equal(isAutomationTriggerReady(draft), true)
  assert.deepEqual(serializeAutomationTrigger(draft), trigger)
  assert.equal(isAutomationTriggerReady({ ...draft, serviceStepId: "" }), false)
})


test("new service-step triggers require a sub-service and preserve its scope", () => {
  const draft = { triggerType: "SERVICE_STEP_ENTERED" as const, serviceStepId: "step", pipelineId: "", changeType: "" as const, targetStageId: "" }
  assert.equal(isAutomationTriggerReady(draft), false)
  assert.throws(() => serializeAutomationTrigger(draft), /sub-service/)
  for (const type of ["SERVICE_STEP_ENTERED", "SERVICE_STEP_COMPLETED"] as const) {
    const trigger = { type, serviceStepId: "step", serviceOfferingId: "offering" }
    assert.deepEqual(serializeAutomationTrigger(hydrateAutomationTrigger(trigger)), trigger)
    assert.equal(isAutomationTriggerReady(hydrateAutomationTrigger(trigger)), true)
  }
})
