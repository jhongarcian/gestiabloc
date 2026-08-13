import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { buildAutomationFlowGraph } from "../app/(tenants)/app/[tenantSlug]/account-settings/_components/automation-flow-graph.js"

const labels = {
  SET_CONTACT_CUSTOM_FIELD: "Set custom field",
  CLEAR_CONTACT_CUSTOM_FIELD: "Clear custom field",
  SET_CONTACT_STATUS: "Set contact status",
  CLEAR_CONTACT_STATUS: "Clear contact status",
  SET_CONTACT_ASSIGNEE: "Assign contact",
  CLEAR_CONTACT_ASSIGNEE: "Clear contact assignee",
  ADD_CONTACT_TAG: "Add contact tag",
  REMOVE_CONTACT_TAG: "Remove contact tag",
} as const

describe("buildAutomationFlowGraph", () => {
  test("creates a trigger, insertion point, action, and completion path", () => {
    const graph = buildAutomationFlowGraph(
      {
        triggerType: "OPPORTUNITY_CREATED",
        pipelineId: "pipeline-1",
        sourceStageId: "",
        targetStageId: "",
        conditions: [],
        actions: [{ type: "CLEAR_CONTACT_STATUS" }],
      },
      null,
      labels,
    )
    assert.deepEqual(
      graph.nodes.map((node) => node.id),
      ["trigger", "add-0", "action-0", "add-1", "complete"],
    )
  })

  test("adds matched and no-match branches when conditions exist", () => {
    const graph = buildAutomationFlowGraph(
      {
        triggerType: "OPPORTUNITY_STAGE_CHANGED",
        pipelineId: "pipeline-1",
        sourceStageId: "stage-1",
        targetStageId: "stage-2",
        conditions: [
          { source: "OPPORTUNITY_VALUE", operator: "GREATER_THAN", compareValue: 10_000 },
        ],
        actions: [{ type: "ADD_CONTACT_TAG", tagId: "tag-1" }],
      },
      null,
      labels,
    )
    assert.ok(graph.nodes.some((node) => node.id === "conditions"))
    assert.ok(graph.nodes.some((node) => node.id === "stop"))
    assert.ok(
      graph.edges.some(
        (edge) => edge.source === "conditions" && edge.sourceHandle === "unmatched",
      ),
    )
  })
})
