import assert from "node:assert/strict"
import test from "node:test"

import {
  WorkflowDefinitionAnySchema,
  convertWorkflowDefinitionV2ToV3,
  validateWorkflowDefinitionV3,
  workflowDefinitionV3ToV2Graph,
  type WorkflowDefinitionV3,
} from "./service-followup-v3-definition.js"
import { branchExclusiveStepNodeIds } from "./service-followup-runtime.js"

function linearDefinition(): WorkflowDefinitionV3 {
  return {
    schemaVersion: 3,
    start: { id: "start", label: "Start" },
    end: { id: "end", label: "End" },
    steps: [
      { id: "paid", name: "Paid", dueDaysFromStart: 0 },
      { id: "sign", name: "Sign documents", dueDaysFromStart: 0 },
      { id: "submitted", name: "Submitted", dueDaysFromStart: 0 },
      { id: "completed", name: "Completed", dueDaysFromStart: 0 },
    ],
    transitions: [
      { id: "transition-start", fromId: "start", actions: [], route: { kind: "NEXT" } },
      {
        id: "transition-paid",
        fromId: "paid",
        actions: [],
        route: {
          id: "signed-check",
          kind: "CONDITIONAL",
          label: "Signed documents?",
          branches: [
            {
              id: "signed",
              name: "Signed",
              isDefault: false,
              matchMode: "ALL",
              conditions: [{
                id: "signed-condition",
                source: "customField",
                fieldKey: "signedDocuments",
                valueType: "boolean",
                operator: "eq",
                compareValue: true,
              }],
              targetStepId: "submitted",
            },
            {
              id: "default",
              name: "Default",
              isDefault: true,
              matchMode: "ALL",
              conditions: [],
              targetStepId: "sign",
            },
          ],
        },
      },
      { id: "transition-sign", fromId: "sign", actions: [], route: { kind: "NEXT" } },
      { id: "transition-submitted", fromId: "submitted", actions: [], route: { kind: "NEXT" } },
      { id: "transition-completed", fromId: "completed", actions: [], route: { kind: "NEXT" } },
    ],
  }
}

test("V3 accepts a single ordered step spine with a forward conditional skip", () => {
  assert.equal(validateWorkflowDefinitionV3(linearDefinition()).ok, true)
})

test("the template request schema accepts a V3 draft definition", () => {
  const parsed = WorkflowDefinitionAnySchema.safeParse(linearDefinition())
  assert.equal(parsed.success, true)
  if (!parsed.success) return
  assert.equal(parsed.data.schemaVersion, 3)
})

test("a V3 forward route skips only intermediate spine steps", () => {
  const projected = workflowDefinitionV3ToV2Graph(linearDefinition())
  const selectedEdge = projected.edges.find(
    (edge) => edge.source === "signed-check" && edge.branchId === "signed",
  )
  assert.ok(selectedEdge)
  assert.deepEqual(
    branchExclusiveStepNodeIds(projected, "signed-check", selectedEdge.id),
    ["sign"],
  )
})

test("V3 rejects backward and missing conditional destinations", () => {
  const definition = linearDefinition()
  const route = definition.transitions[1].route
  assert.equal(route.kind, "CONDITIONAL")
  if (route.kind !== "CONDITIONAL") return
  route.branches[0].targetStepId = "paid"
  route.branches[1].targetStepId = null
  const result = validateWorkflowDefinitionV3(definition)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((issue) => issue.code === "BRANCH_TARGET_NOT_FORWARD"))
  assert.ok(result.issues.some((issue) => issue.code === "BRANCH_TARGET_REQUIRED"))
})

test("V3 rejects a conditional containing only Default", () => {
  const definition = linearDefinition()
  const route = definition.transitions[1].route
  assert.equal(route.kind, "CONDITIONAL")
  if (route.kind !== "CONDITIONAL") return
  route.branches = route.branches.filter((branch) => branch.isDefault)
  const result = validateWorkflowDefinitionV3(definition)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((issue) => issue.code === "BRANCHES_REQUIRED"))
})

test("V3 permits an unconditional forward skip while retaining every step on the spine", () => {
  const definition = linearDefinition()
  definition.transitions[0].route = {
    id: "skip-to-submitted",
    kind: "GO_TO",
    label: "Skip",
    targetStepId: "submitted",
  }
  const result = validateWorkflowDefinitionV3(definition)
  assert.equal(result.ok, true)
})

test("converts a legacy branch between ordered steps into route-only V3", () => {
  const result = convertWorkflowDefinitionV2ToV3({
    schemaVersion: 2,
    nodes: [
      { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 }, data: {} },
      { id: "bring", kind: "step", label: "Bring data", position: { x: 0, y: 100 }, data: {} },
      {
        id: "if",
        kind: "ifElse",
        label: "If / Else",
        position: { x: 0, y: 200 },
        data: {
          branches: [
            {
              id: "matched",
              name: "Matched",
              isDefault: false,
              matchMode: "ALL",
              conditions: [{ id: "c", source: "contactInfo", fieldKey: "email", valueType: "string", operator: "is_not_empty" }],
            },
            { id: "default", name: "Default", isDefault: true, matchMode: "ALL", conditions: [] },
          ],
        },
      },
      { id: "submit", kind: "step", label: "Submit application", position: { x: 0, y: 300 }, data: {} },
      { id: "complete", kind: "step", label: "Completed", position: { x: 200, y: 300 }, data: {} },
      { id: "end", kind: "end", label: "End", position: { x: 0, y: 400 }, data: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "bring" },
      { id: "e2", source: "bring", target: "if" },
      { id: "e3", source: "if", target: "submit", branchId: "matched" },
      { id: "e4", source: "if", target: "complete", branchId: "default" },
      { id: "e5", source: "submit", target: "end" },
      { id: "e6", source: "complete", target: "end" },
    ],
  }, ["bring", "submit", "complete"])

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.definition.steps.map((step) => step.id), ["bring", "submit", "complete"])
  const route = result.definition.transitions.find((transition) => transition.fromId === "bring")?.route
  assert.equal(route?.kind, "CONDITIONAL")
  if (route?.kind !== "CONDITIONAL") return
  assert.deepEqual(route.branches.map((branch) => branch.targetStepId), ["submit", "complete"])
  assert.equal(
    result.definition.transitions.find((transition) => transition.fromId === "submit")?.route.kind,
    "NEXT",
  )
})

test("rejects conversion when a branch contains its own automation path", () => {
  const result = convertWorkflowDefinitionV2ToV3({
    schemaVersion: 2,
    nodes: [
      { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 }, data: {} },
      { id: "one", kind: "step", label: "One", position: { x: 0, y: 100 }, data: {} },
      { id: "if", kind: "ifElse", label: "If", position: { x: 0, y: 200 }, data: { branches: [
        { id: "yes", name: "Yes", isDefault: false, matchMode: "ALL", conditions: [{ id: "c", source: "contactInfo", fieldKey: "email", valueType: "string", operator: "is_not_empty" }] },
        { id: "default", name: "Default", isDefault: true, matchMode: "ALL", conditions: [] },
      ] } },
      { id: "tag", kind: "tagAdd", label: "Add tag", position: { x: 0, y: 300 }, data: { tagNames: ["Ready"] } },
      { id: "two", kind: "step", label: "Two", position: { x: 0, y: 400 }, data: {} },
      { id: "end", kind: "end", label: "End", position: { x: 0, y: 500 }, data: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "one" },
      { id: "e2", source: "one", target: "if" },
      { id: "e3", source: "if", target: "tag", branchId: "yes" },
      { id: "e4", source: "if", target: "two", branchId: "default" },
      { id: "e5", source: "tag", target: "two" },
      { id: "e6", source: "two", target: "end" },
    ],
  })
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((issue) => issue.code === "V2_BRANCH_ACTION_PATH"))
})
