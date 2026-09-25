import type { Edge, Node } from "@xyflow/react"

import { formatDateTimeForDisplay } from "@/lib/date-time"

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

const FLOW_CENTER_X = 308
const CARD_WIDTH = 256
const ADD_NODE_WIDTH = 40
const CARD_X = FLOW_CENTER_X - CARD_WIDTH / 2
const ADD_NODE_X = FLOW_CENTER_X - ADD_NODE_WIDTH / 2

function waitUnitLabel(amount: number, unit: string) {
  const label = unit.toLocaleLowerCase()
  return amount === 1 ? label.replace(/s$/, "") : label
}

export function buildAutomationFlowGraph(
  draft: AutomationFlowDraft,
  catalog: AutomationCatalog | null,
  actionLabels: Record<AutomationAction["type"], string>,
  timezone?: string | null,
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
      position: { x: CARD_X, y: 30 },
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
      position: { x: ADD_NODE_X, y },
      data: { kind: "add", label: "Add action", insertionIndex: index },
    })
    edges.push({
      id: `${previousId}-${addId}`,
      source: previousId,
      target: addId,
      type: "straight",
    })
    previousId = addId
    y += 85
    const action = draft.actions[index]
    if (!action) continue
    const actionId = `action-${action.nodeKey ?? index}`
    const waitConfig = action.type === "WAIT" ? action.waitConfig : null
    const waitSubtitle = waitConfig?.mode === "DURATION"
      ? `Wait ${waitConfig.amount} ${waitUnitLabel(waitConfig.amount, waitConfig.unit)}`
      : waitConfig?.mode === "FIXED_DATE"
        ? waitConfig.timing === "ON"
          ? `Until ${formatDateTimeForDisplay(waitConfig.dateTime, timezone)}`
          : `${waitConfig.offsetAmount} ${waitUnitLabel(waitConfig.offsetAmount ?? 0, waitConfig.offsetUnit ?? "MINUTES")} ${waitConfig.timing.toLocaleLowerCase()} ${formatDateTimeForDisplay(waitConfig.dateTime, timezone)}`
        : null
    const actionSubtitle = action.type === "ADD_CONTACT_NOTE"
      ? `Note: ${action.noteTitle?.trim() || "Add a title"}`
      : action.type === "CREATE_TASK"
        ? `Task: ${action.taskConfig?.nameTemplate.trim() || "Add a task name"}`
        : action.type === "UPDATE_CONTACT_CUSTOM_FIELDS"
          ? `Update ${action.customFieldUpdates?.length ?? 0} field${action.customFieldUpdates?.length === 1 ? "" : "s"}`
          : waitSubtitle ?? `Action ${index + 1}`
    nodes.push({
      id: actionId,
      type: "automationNode",
      position: { x: CARD_X, y },
      data: {
        kind: "action",
        label: actionLabels[action.type],
        subtitle: actionSubtitle,
        index,
      },
    })
    edges.push({
      id: `${previousId}-${actionId}`,
      source: previousId,
      target: actionId,
      type: "straight",
    })
    previousId = actionId
    y += 145
  }

  nodes.push({
    id: "complete",
    type: "automationNode",
    position: { x: CARD_X, y },
    data: { kind: "complete", label: "Complete", subtitle: "All actions completed" },
  })
  edges.push({
    id: `${previousId}-complete`,
    source: previousId,
    target: "complete",
    type: "straight",
  })
  return { nodes, edges }
}
