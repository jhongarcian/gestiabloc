import type { Edge, Node } from "@xyflow/react"

import type { AutomationAction, AutomationCatalog, AutomationCondition, AutomationTriggerType } from "./automation-types"

export type AutomationFlowNodeData = {
  kind: "trigger" | "conditions" | "action" | "add" | "stop" | "complete"
  label: string
  subtitle?: string
  index?: number
  insertionIndex?: number
}

export type AutomationFlowDraft = {
  triggerType: AutomationTriggerType
  pipelineId: string
  sourceStageId: string
  targetStageId: string
  conditions: AutomationCondition[]
  actions: AutomationAction[]
}

export function buildAutomationFlowGraph(
  draft: AutomationFlowDraft,
  catalog: AutomationCatalog | null,
  actionLabels: Record<AutomationAction["type"], string>,
) {
  const pipeline = catalog?.pipelines.find((item) => item.id === draft.pipelineId)
  const target = pipeline?.stages.find((item) => item.id === draft.targetStageId)
  const source = pipeline?.stages.find((item) => item.id === draft.sourceStageId)
  const triggerSubtitle =
    draft.triggerType === "OPPORTUNITY_CREATED"
      ? `Created in ${pipeline?.name ?? "Select a pipeline"}`
      : `${source?.name ?? "Any stage"} → ${target?.name ?? "Select a stage"}`
  const nodes: Array<Node<AutomationFlowNodeData>> = [
    {
      id: "trigger",
      type: "automationNode",
      position: { x: 180, y: 30 },
      data: {
        kind: "trigger",
        label:
          draft.triggerType === "OPPORTUNITY_CREATED"
            ? "Opportunity created"
            : "Stage changed",
        subtitle: triggerSubtitle,
      },
    },
  ]
  const edges: Edge[] = []
  let previousId = "trigger"
  let y = 180

  if (draft.conditions.length > 0) {
    nodes.push({
      id: "conditions",
      type: "automationNode",
      position: { x: 180, y },
      data: {
        kind: "conditions",
        label: "All conditions",
        subtitle: `${draft.conditions.length} required check${draft.conditions.length === 1 ? "" : "s"}`,
      },
    })
    nodes.push({
      id: "stop",
      type: "automationNode",
      position: { x: 520, y: y + 150 },
      data: { kind: "stop", label: "No match", subtitle: "Stop without actions" },
    })
    edges.push(
      { id: "trigger-conditions", source: "trigger", target: "conditions", type: "smoothstep" },
      {
        id: "conditions-stop",
        source: "conditions",
        sourceHandle: "unmatched",
        target: "stop",
        type: "smoothstep",
        label: "No",
      },
    )
    previousId = "conditions"
    y += 170
  }

  for (let index = 0; index <= draft.actions.length; index += 1) {
    const addId = `add-${index}`
    nodes.push({
      id: addId,
      type: "automationNode",
      position: { x: 292, y },
      data: { kind: "add", label: "Add action", insertionIndex: index },
    })
    edges.push({
      id: `${previousId}-${addId}`,
      source: previousId,
      ...(previousId === "conditions" ? { sourceHandle: "matched", label: "Yes" } : {}),
      target: addId,
      type: "smoothstep",
    })
    previousId = addId
    y += 85
    const action = draft.actions[index]
    if (!action) continue
    const actionId = `action-${index}`
    nodes.push({
      id: actionId,
      type: "automationNode",
      position: { x: 180, y },
      data: {
        kind: "action",
        label: actionLabels[action.type],
        subtitle: `Action ${index + 1}`,
        index,
      },
    })
    edges.push({
      id: `${previousId}-${actionId}`,
      source: previousId,
      target: actionId,
      type: "smoothstep",
    })
    previousId = actionId
    y += 145
  }

  nodes.push({
    id: "complete",
    type: "automationNode",
    position: { x: 180, y },
    data: { kind: "complete", label: "Complete", subtitle: "Changes committed atomically" },
  })
  edges.push({
    id: `${previousId}-complete`,
    source: previousId,
    target: "complete",
    type: "smoothstep",
  })
  return { nodes, edges }
}
