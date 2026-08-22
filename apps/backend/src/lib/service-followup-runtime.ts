import type {
  WorkflowBranchV2,
  WorkflowConditionV2,
  WorkflowDefinitionV2,
} from "./service-followup-definition.js"

function isEmpty(value: unknown) {
  if (value === null || value === undefined) return true
  if (typeof value === "string") return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

function comparableNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function comparableDate(value: unknown) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

export function evaluateWorkflowOperator(condition: WorkflowConditionV2, left: unknown) {
  if (condition.operator === "is_empty") return isEmpty(left)
  if (condition.operator === "is_not_empty") return !isEmpty(left)
  if (condition.valueType === "number") {
    const leftNumber = comparableNumber(left)
    const rightNumber = comparableNumber(condition.compareValue)
    if (leftNumber === null || rightNumber === null) return false
    if (condition.operator === "eq") return leftNumber === rightNumber
    if (condition.operator === "neq") return leftNumber !== rightNumber
    if (condition.operator === "gt") return leftNumber > rightNumber
    if (condition.operator === "gte") return leftNumber >= rightNumber
    if (condition.operator === "lt") return leftNumber < rightNumber
    if (condition.operator === "lte") return leftNumber <= rightNumber
    return false
  }
  if (condition.valueType === "dateTime") {
    const leftDate = comparableDate(left)
    const rightDate = comparableDate(condition.compareValue)
    if (!leftDate || !rightDate) return false
    if (condition.operator === "eq") return leftDate.getTime() === rightDate.getTime()
    if (condition.operator === "neq") return leftDate.getTime() !== rightDate.getTime()
    if (condition.operator === "gt") return leftDate > rightDate
    if (condition.operator === "gte") return leftDate >= rightDate
    if (condition.operator === "lt") return leftDate < rightDate
    if (condition.operator === "lte") return leftDate <= rightDate
    return false
  }
  if (condition.valueType === "boolean") {
    const right = condition.compareValue === true || condition.compareValue === "true"
    const leftBoolean = left === true || left === "true"
    return condition.operator === "neq" ? leftBoolean !== right : leftBoolean === right
  }
  const leftText = String(left ?? "").toLocaleLowerCase()
  const rightText = String(condition.compareValue ?? "").toLocaleLowerCase()
  if (condition.operator === "includes") return leftText.includes(rightText)
  if (condition.operator === "not_includes") return !leftText.includes(rightText)
  if (condition.operator === "eq") return leftText === rightText
  if (condition.operator === "neq") return leftText !== rightText
  return false
}

export function selectFirstMatchingBranch(
  branches: WorkflowBranchV2[],
  resolveValue: (condition: WorkflowConditionV2) => unknown,
) {
  return (
    branches.find((branch) => {
      if (branch.isDefault) return false
      const results = branch.conditions.map((condition) =>
        evaluateWorkflowOperator(condition, resolveValue(condition)),
      )
      return branch.matchMode === "ANY" ? results.some(Boolean) : results.every(Boolean)
    }) ?? branches.find((branch) => branch.isDefault)
  )
}

function reachableNodeIds(definition: WorkflowDefinitionV2, startId: string) {
  const found = new Set<string>()
  const stack = [startId]
  while (stack.length) {
    const nodeId = stack.pop() as string
    if (found.has(nodeId)) continue
    found.add(nodeId)
    for (const edge of definition.edges.filter((item) => item.source === nodeId)) {
      stack.push(edge.target)
    }
  }
  return found
}

export function branchExclusiveStepNodeIds(
  definition: WorkflowDefinitionV2,
  conditionalNodeId: string,
  selectedEdgeId: string,
) {
  const branchEdges = definition.edges.filter((edge) => edge.source === conditionalNodeId)
  const selectedEdge = branchEdges.find((edge) => edge.id === selectedEdgeId)
  if (!selectedEdge) return []
  const selectedReachable = reachableNodeIds(definition, selectedEdge.target)
  const unselectedReachable = new Set<string>()
  for (const edge of branchEdges) {
    if (edge.id === selectedEdge.id) continue
    for (const nodeId of reachableNodeIds(definition, edge.target)) unselectedReachable.add(nodeId)
  }
  return [...unselectedReachable].filter(
    (nodeId) =>
      !selectedReachable.has(nodeId) &&
      definition.nodes.find((node) => node.id === nodeId)?.kind === "step",
  )
}

