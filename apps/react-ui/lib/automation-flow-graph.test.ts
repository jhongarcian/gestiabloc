import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { buildAutomationFlowGraph } from "../app/(tenants)/app/[tenantSlug]/account-settings/_components/automation-flow-graph.js"

const labels = {
  SET_CONTACT_CUSTOM_FIELD: "Set custom field",
  CLEAR_CONTACT_CUSTOM_FIELD: "Clear custom field",
  SET_CONTACT_STATUS: "Set contact status",
  SET_CONTACT_ASSIGNEE: "Assign contact",
  CLEAR_CONTACT_ASSIGNEE: "Clear contact assignee",
  ADD_CONTACT_TAG: "Add contact tag",
  REMOVE_CONTACT_TAG: "Remove contact tag",
  WAIT: "Wait",
} as const

describe("buildAutomationFlowGraph", () => {
  test("creates a trigger, insertion point, action, and completion path", () => {
    const graph = buildAutomationFlowGraph(
      {
        triggerType: "OPPORTUNITY_CREATED",
        pipelineId: "pipeline-1",
        targetStageId: "",
        conditions: [],
        actions: [{ type: "SET_CONTACT_STATUS", statusConfigId: "status-active" }],
      },
      null,
      labels,
    )
    assert.deepEqual(
      graph.nodes.map((node) => node.id),
      ["trigger", "add-0", "action-0", "add-1", "complete"],
    )
    assert.ok(graph.edges.every((edge) => edge.type === "straight"))

    const centerXs = graph.nodes.map((node) =>
      node.position.x + (node.data.kind === "add" ? 40 : 256) / 2,
    )
    assert.equal(new Set(centerXs).size, 1)
  })

  test("shows an unconfigured start node until a trigger is selected", () => {
    const graph = buildAutomationFlowGraph(
      {
        triggerType: null,
        pipelineId: "",
        targetStageId: "",
        conditions: [],
        actions: [],
      },
      null,
      labels,
    )

    const trigger = graph.nodes.find((node) => node.id === "trigger")
    assert.equal(trigger?.data.label, "Select a trigger")
    assert.equal(trigger?.data.configured, false)
    assert.match(trigger?.data.subtitle ?? "", /Click to choose/)
  })

  test("keeps contact filters out of the flow graph", () => {
    const graph = buildAutomationFlowGraph(
      {
        triggerType: "OPPORTUNITY_STAGE_CHANGED",
        pipelineId: "pipeline-1",
        targetStageId: "stage-2",
        conditions: [
          { source: "OPPORTUNITY_VALUE", operator: "GREATER_THAN", compareValue: 10_000 },
        ],
        actions: [{ type: "ADD_CONTACT_TAG", tagId: "tag-1" }],
      },
      null,
      labels,
    )
    assert.equal(graph.nodes.some((node) => node.id === "conditions"), false)
    assert.equal(graph.nodes.some((node) => node.id === "stop"), false)
    assert.ok(graph.edges.some((edge) => edge.source === "trigger" && edge.target === "add-0"))
    const trigger = graph.nodes.find((node) => node.id === "trigger")
    assert.equal(trigger?.data.label, "Opportunity enters stage")
    assert.match(trigger?.data.subtitle ?? "", /^Enters /)
  })

  test("summarizes wait actions without adding extra graph nodes", () => {
    const graph = buildAutomationFlowGraph(
      {
        triggerType: "OPPORTUNITY_CREATED",
        pipelineId: "pipeline-1",
        targetStageId: "",
        conditions: [],
        actions: [{
          nodeKey: "00000000-0000-4000-8000-000000000001",
          type: "WAIT",
          waitConfig: { mode: "DURATION", amount: 2, unit: "HOURS" },
        }],
      },
      null,
      labels,
      "America/Chicago",
    )

    const waitNode = graph.nodes.find((node) => node.id.includes("00000000"))
    assert.equal(waitNode?.data.label, "Wait")
    assert.equal(waitNode?.data.subtitle, "Wait 2 hours")
    assert.equal(graph.nodes.filter((node) => node.data.kind === "action").length, 1)
    assert.equal(graph.nodes.at(-1)?.data.subtitle, "All actions completed")
  })
})
