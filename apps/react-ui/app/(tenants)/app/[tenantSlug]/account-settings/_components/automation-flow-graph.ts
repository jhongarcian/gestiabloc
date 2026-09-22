import type { Edge, Node } from "@xyflow/react"

import type { AutomationAction, AutomationCatalog, AutomationCondition, AutomationTriggerType } from "./automation-types"

export type AutomationFlowNodeData = {
  kind: "trigger" | "action" | "add" | "complete"
  label: string
  subtitle?: string
  configured?: boolean
  index?: number
  insertionIndex?: number
}

export type AutomationFlowDraft = {
  triggerType: AutomationTriggerType | null
  pipelineId: string
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
  const triggerSubtitle =
    draft.triggerType === null
      ? "Click to choose what starts this automation"
      : draft.triggerType === "OPPORTUNITY_CREATED"
        ? `Created in ${pipeline?.name ?? "Select a pipeline"}`
        : `Enters ${target?.name ?? "Select a stage"} in ${pipeline?.name ?? "Select a pipeline"}`
  const nodes: Array<Node<AutomationFlowNodeData>> = [
    {
      id: "trigger",
      type: "automationNode",
      position: { x: 180, y: 30 },
      data: {
        kind: "trigger",
        label:
          draft.triggerType === null
            ? "Select a trigger"
            : draft.triggerType === "OPPORTUNITY_CREATED"
              ? "Opportunity created"
              : "Opportunity enters stage",
        subtitle: triggerSubtitle,
        configured: draft.triggerType !== null,
      },
    },
  ]
  const edges: Edge[] = []
  let previousId = "trigger"
  let y = 180

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
