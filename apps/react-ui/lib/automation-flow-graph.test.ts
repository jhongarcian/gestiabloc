import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { buildAutomationFlowGraph } from "../app/(tenants)/app/[tenantSlug]/account-settings/_components/automation-flow-graph.js"

const labels = {
  UPDATE_CONTACT_CUSTOM_FIELDS: "Update contact fields",
  SET_CONTACT_STATUS: "Set contact status",
  SET_CONTACT_ASSIGNEE: "Assign contact",
  CLEAR_CONTACT_ASSIGNEE: "Clear contact assignee",
  ADD_CONTACT_TAG: "Add contact tag",
  REMOVE_CONTACT_TAG: "Remove contact tag",
  ADD_CONTACT_NOTE: "Add contact note",
  CREATE_TASK: "Create task",
  FORMAT_DATE_TIME: "Date/Time formatter",
  FORMAT_NUMBER: "Number formatter",
  WAIT: "Wait",
  DELETE_CONTACT: "Delete contact",
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

  test("summarizes one multi-field update action as one graph node", () => {
    const graph = buildAutomationFlowGraph(
      {
        triggerType: "OPPORTUNITY_CREATED",
        pipelineId: "pipeline-1",
        targetStageId: "",
        conditions: [],
        actions: [{
          nodeKey: "00000000-0000-4000-8000-000000000001",
          type: "UPDATE_CONTACT_CUSTOM_FIELDS",
          customFieldUpdates: [
            { contactFieldKey: "phone", operation: "SET", value: "+15551234567" },
            { customFieldId: "field-2", operation: "CLEAR" },
          ],
        }],
      },
      null,
      labels,
    )

    const updateNode = graph.nodes.find((node) => node.id.includes("00000000"))
    assert.equal(updateNode?.data.label, "Update contact fields")
    assert.equal(updateNode?.data.subtitle, "Update 2 fields")
    assert.equal(graph.nodes.filter((node) => node.data.kind === "action").length, 1)
  })

  test("summarizes an add-note action by its title", () => {
    const graph = buildAutomationFlowGraph(
      {
        triggerType: "OPPORTUNITY_CREATED",
        pipelineId: "pipeline-1",
        targetStageId: "",
        conditions: [],
        actions: [{
          nodeKey: "00000000-0000-4000-8000-000000000001",
          type: "ADD_CONTACT_NOTE",
          noteTitle: "Opportunity created",
          noteBody: "Review the opportunity.",
        }],
      },
      null,
      labels,
    )

    const noteNode = graph.nodes.find((node) => node.id.includes("00000000"))
    assert.equal(noteNode?.data.label, "Add contact note")
    assert.equal(noteNode?.data.subtitle, "Note: Opportunity created")
  })

  test("summarizes a create-task action by its name template", () => {
    const graph = buildAutomationFlowGraph(
      {
        triggerType: "OPPORTUNITY_CREATED",
        pipelineId: "pipeline-1",
        targetStageId: "",
        conditions: [],
        actions: [{
          nodeKey: "00000000-0000-4000-8000-000000000001",
          type: "CREATE_TASK",
          taskConfig: {
            nameTemplate: "Call {contact.name}",
            statusConfigId: "todo",
            assignee: { mode: "CONTACT_ASSIGNEE" },
          },
        }],
      },
      null,
      labels,
    )

    const taskNode = graph.nodes.find((node) => node.id.includes("00000000"))
    assert.equal(taskNode?.data.label, "Create task")
    assert.equal(taskNode?.data.subtitle, "Task: Call {contact.name}")
  })

  test("summarizes formatter outputs and comparisons", () => {
    const graph = buildAutomationFlowGraph(
      {
        triggerType: "OPPORTUNITY_CREATED",
        pipelineId: "pipeline-1",
        targetStageId: "",
        conditions: [],
        actions: [{
          nodeKey: "00000000-0000-4000-8000-000000000001",
          type: "FORMAT_DATE_TIME",
          dateTimeFormatterConfig: {
            mode: "COMPARE_DATES",
            from: { type: "CONTACT_FIELD", key: "date_of_birth" },
            to: { type: "CURRENT_DATE" },
            unit: "YEARS",
            outputKey: "contact_age",
          },
        }],
      },
      null,
      labels,
    )

    const formatterNode = graph.nodes.find((node) => node.id.includes("00000000"))
    assert.equal(formatterNode?.data.label, "Date/Time formatter")
    assert.equal(formatterNode?.data.subtitle, "Compare dates · Years → contact_age")
  })

  test("summarizes number formatter output modes", () => {
    const graph = buildAutomationFlowGraph(
      {
        triggerType: "OPPORTUNITY_CREATED",
        pipelineId: "pipeline-1",
        targetStageId: "",
        conditions: [],
        actions: [{
          nodeKey: "00000000-0000-4000-8000-000000000001",
          type: "FORMAT_NUMBER",
          numberFormatterConfig: {
            mode: "FORMAT_CURRENCY",
            source: { type: "CUSTOM_FIELD", key: "premium" },
            decimalMark: "PERIOD",
            currencyCode: "USD",
            outputKey: "premium_label",
          },
        }],
      },
      null,
      labels,
    )

    const formatterNode = graph.nodes.find((node) => node.id.includes("00000000"))
    assert.equal(formatterNode?.data.label, "Number formatter")
    assert.equal(formatterNode?.data.subtitle, "Currency · USD → premium_label")
  })

  test("places delete contact directly before completion", () => {
    const graph = buildAutomationFlowGraph(
      {
        triggerType: "OPPORTUNITY_CREATED",
        pipelineId: "pipeline-1",
        targetStageId: "",
        conditions: [],
        actions: [{
          nodeKey: "00000000-0000-4000-8000-000000000001",
          type: "DELETE_CONTACT",
        }],
      },
      null,
      labels,
    )

    assert.deepEqual(
      graph.nodes.map((node) => node.id),
      ["trigger", "add-0", "action-00000000-0000-4000-8000-000000000001", "complete"],
    )
    assert.equal(graph.nodes.at(-2)?.data.subtitle, "Remove from this account")
    assert.equal(graph.nodes.at(-1)?.data.subtitle, "Contact deleted")
    assert.ok(graph.edges.some((edge) =>
      edge.source === "action-00000000-0000-4000-8000-000000000001" &&
      edge.target === "complete"
    ))
  })
})
