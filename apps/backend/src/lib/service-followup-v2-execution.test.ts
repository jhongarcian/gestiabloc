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
