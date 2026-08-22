import assert from "node:assert/strict"
import test from "node:test"

import {
  convertLegacyWorkflowDefinition,
  validateSensitiveCustomFieldConditions,
  validateWorkflowDefinition,
  workflowDefinitionToLegacyCanvas,
  type WorkflowDefinitionV2,
} from "./service-followup-definition.js"

function validDefinition(): WorkflowDefinitionV2 {
  return {
    schemaVersion: 2,
    nodes: [
      { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 }, data: {} },
      { id: "first", kind: "step", label: "Collect information", position: { x: 0, y: 100 }, data: {} },
      {
        id: "condition",
        kind: "ifElse",
        label: "Required data present?",
        position: { x: 0, y: 200 },
        data: {
          branches: [
            {
              id: "complete-data",
              name: "Complete data",
              matchMode: "ALL",
              conditions: [
                { id: "has-a", source: "contactInfo", fieldKey: "email", valueType: "string", operator: "is_not_empty" },
                { id: "has-b", source: "contactInfo", fieldKey: "dateOfBirth", valueType: "dateTime", operator: "is_not_empty" },
              ],
            },
            { id: "default", name: "Default", isDefault: true, matchMode: "ALL", conditions: [] },
          ],
        },
      },
      { id: "extra", kind: "step", label: "Collect missing data", position: { x: 200, y: 300 }, data: {} },
      { id: "shared", kind: "step", label: "Submit", position: { x: 0, y: 400 }, data: {} },
      { id: "end", kind: "end", label: "End", position: { x: 0, y: 500 }, data: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "first" },
      { id: "e2", source: "first", target: "condition" },
      { id: "e3", source: "condition", target: "shared", branchId: "complete-data" },
      { id: "e4", source: "condition", target: "extra", branchId: "default" },
      { id: "e5", source: "extra", target: "shared" },
      { id: "e6", source: "shared", target: "end" },
    ],
  }
}

test("accepts a connected branching workflow with one shared End", () => {
  const result = validateWorkflowDefinition(validDefinition())
  assert.equal(result.ok, true)
})

test("rejects a missing conditional destination", () => {
  const definition = validDefinition()
  definition.edges = definition.edges.filter((edge) => edge.branchId !== "default")
  const result = validateWorkflowDefinition(definition)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((issue) => issue.code === "BRANCH_CONNECTION_REQUIRED"))
})

test("rejects cycles and paths that cannot reach End", () => {
  const definition = validDefinition()
  definition.edges = definition.edges.map((edge) =>
    edge.source === "shared" ? { ...edge, target: "first" } : edge,
  )
  const result = validateWorkflowDefinition(definition)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((issue) => issue.code === "CYCLE"))
})

test("requires workflow outputs to dominate consumers", () => {
  const definition = validDefinition()
  definition.nodes.splice(4, 0, {
    id: "formatter",
    kind: "numberFormatter",
    label: "Format value",
    position: { x: 200, y: 350 },
    data: { outputKey: "formattedValue" },
  })
  definition.edges = definition.edges
    .map((edge) => (edge.source === "extra" ? { ...edge, target: "formatter" } : edge))
    .concat({ id: "formatter-shared", source: "formatter", target: "shared" })
  const shared = definition.nodes.find((node) => node.id === "shared")
  if (shared) shared.data = { notesTemplate: "{{variables.formattedValue}}" }

  const result = validateWorkflowDefinition(definition)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((issue) => issue.code === "VARIABLE_NOT_GUARANTEED"))
})

test("converts legacy branch targets into canonical branch edges", () => {
  const definition = convertLegacyWorkflowDefinition(
    [
      { id: "start", position: { x: 0, y: 0 }, data: { kind: "start", label: "Start" } },
      {
        id: "if",
        position: { x: 0, y: 100 },
        data: {
          kind: "ifElse",
          label: "Check",
          ifElseBranches: [
            { id: "yes", name: "Yes", source: "contactInfo", fieldKey: "email", valueType: "string", operator: "is_not_empty", compareValue: "", targetNodeId: "step" },
            { id: "default", name: "Default", isDefault: true, targetNodeId: "step" },
          ],
        },
      },
      { id: "step", position: { x: 0, y: 200 }, data: { kind: "step", label: "Continue" } },
    ],
    [{ id: "start-if", source: "start", target: "if" }],
  )

  assert.ok(definition.nodes.some((node) => node.kind === "end"))
  assert.ok(definition.edges.some((edge) => edge.source === "if" && edge.branchId === "yes"))
  assert.ok(definition.edges.some((edge) => edge.source === "if" && edge.branchId === "default"))
  assert.equal(validateWorkflowDefinition(definition).ok, true)
})

test("protected fields only allow presence checks", () => {
  const definition = validDefinition()
  const conditional = definition.nodes.find((node) => node.id === "condition")
  const branches = (conditional?.data.branches ?? []) as Array<{ conditions: Array<Record<string, unknown>> }>
  branches[0].conditions[0] = {
    id: "ssn-equality",
    source: "contactInfo",
    fieldKey: "ssn",
    valueType: "string",
    operator: "eq",
    compareValue: "secret",
  }
  const ssnResult = validateWorkflowDefinition(definition)
  assert.equal(ssnResult.ok, false)
  assert.ok(ssnResult.issues.some((issue) => issue.code === "SENSITIVE_FIELD_OPERATOR"))

  branches[0].conditions[0] = {
    id: "encrypted-equality",
    source: "customField",
    fieldKey: "protected_id",
    valueType: "string",
    operator: "eq",
    compareValue: "secret",
  }
  const graphResult = validateWorkflowDefinition(definition)
  assert.equal(graphResult.definition !== null, true)
  const fieldIssues = validateSensitiveCustomFieldConditions(graphResult.definition!, [
    { id: "field-1", key: "protected_id", isEncrypted: true, isSensitive: false },
  ])
  assert.equal(fieldIssues.length, 1)
  assert.equal(fieldIssues[0].code, "SENSITIVE_FIELD_OPERATOR")
})

test("reconstructs the editable canvas from canonical edges", () => {
  const definition = validDefinition()
  const canvas = workflowDefinitionToLegacyCanvas(definition)
  const conditional = canvas.nodes.find((node) => node.id === "condition")
  const branches = (conditional?.data as Record<string, unknown>)?.ifElseBranches as Array<{
    id: string
    targetNodeId: string | null
  }>
  assert.equal(branches.find((branch) => branch.id === "complete-data")?.targetNodeId, "shared")
  assert.equal(branches.find((branch) => branch.id === "default")?.targetNodeId, "extra")
  assert.equal(canvas.nodes.some((node) => node.data.kind === "end"), false)
  assert.equal(canvas.edges.some((edge) => edge.target === "end"), false)
})

test("rejects a Go To action positioned behind its target", () => {
  const definition = validDefinition()
  definition.nodes.splice(4, 0, {
    id: "go",
    kind: "goTo",
    label: "Go back",
    position: { x: 200, y: 350 },
    data: {},
  })
  definition.edges = definition.edges
    .map((edge) => (edge.source === "extra" ? { ...edge, target: "go" } : edge))
    .concat({ id: "go-shared", source: "go", target: "condition" })
  const result = validateWorkflowDefinition(definition)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((issue) => issue.code === "GO_TO_NOT_FORWARD"))
})
