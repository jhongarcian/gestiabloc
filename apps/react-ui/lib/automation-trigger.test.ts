import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  hydrateAutomationTrigger,
  isAutomationTriggerReady,
  serializeAutomationTrigger,
} from "./automation-trigger.js"

describe("automation trigger payloads", () => {
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
