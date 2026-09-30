import type { Edge, Node } from "@xyflow/react"

import { formatDateTimeForDisplay } from "@/lib/date-time"

import type { AutomationAction, AutomationCatalog, AutomationCondition, AutomationTriggerType } from "./automation-types"

export type AutomationFlowNodeData = {
  kind: "trigger" | "action" | "add" | "branch" | "complete"
  label: string
  subtitle?: string
  configured?: boolean
  actionType?: AutomationAction["type"]
  actionGroup?: "INTERNAL" | "CONTACT" | "COMMUNICATION"
  index?: number
  insertionIndex?: number
  actionNodeKey?: string
  actionPath?: AutomationGraphBranchPath
  insertionPath?: AutomationGraphBranchPath
  waitBadge?: {
    count: number
    state: "loading" | "ready" | "error" | "unsaved"
    onClick?: () => void
  }
}

export type AutomationGraphBranchPath = Array<{ routingNodeKey: string; branchKey: string }>

export type AutomationWaitNodeBadge = NonNullable<AutomationFlowNodeData["waitBadge"]>

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

const CONTACT_ACTION_TYPES = new Set<AutomationAction["type"]>([
  "UPDATE_CONTACT_CUSTOM_FIELDS",
  "SET_CONTACT_STATUS",
  "SET_CONTACT_ASSIGNEE",
  "CLEAR_CONTACT_ASSIGNEE",
  "ADD_CONTACT_TAG",
  "REMOVE_CONTACT_TAG",
  "DELETE_CONTACT",
])

function actionVisualGroup(type: AutomationAction["type"]): NonNullable<AutomationFlowNodeData["actionGroup"]> {
  return CONTACT_ACTION_TYPES.has(type) ? "CONTACT" : "INTERNAL"
}

function waitUnitLabel(amount: number, unit: string) {
  const label = unit.toLocaleLowerCase()
  return amount === 1 ? label.replace(/s$/, "") : label
}

const FORMATTER_PREVIEWS: Record<string, string> = {
  "YYYY-MM-DD": "2026-09-25",
  "MM/DD/YYYY": "09/25/2026",
  "DD/MM/YYYY": "25/09/2026",
  "MMMM DD YYYY": "September 25 2026",
  "dddd, MMMM D, YYYY": "Friday, September 25, 2026",
  "MMM D, YYYY": "Sep 25, 2026",
  "MMMM Do YYYY": "September 25th 2026",
  "MM-DD-YYYY": "09-25-2026",
  "DD-MMM-YYYY": "25-Sep-2026",
  "ddd MMM DD HH:mm:ss YYYY": "Fri Sep 25 13:30:59 2026",
  "MMMM DD YYYY HH:mm:ss": "September 25 2026 13:30:59",
  "YYYY-MM-DD HH:mm:ss": "2026-09-25 13:30:59",
  "YYYY-MM-DD hh:mm A": "2026-09-25 01:30 PM",
  "DD/MM/YYYY HH:mm:ss": "25/09/2026 13:30:59",
  "MM/DD/YYYY hh:mm A": "09/25/2026 01:30 PM",
  "dddd, MMMM D, YYYY hh:mm A": "Friday, September 25, 2026 01:30 PM",
  "MMM D, YYYY hh:mm:ss A": "Sep 25, 2026 01:30:59 PM",
  "YYYY-MM-DDTHH:mm:ss": "2026-09-25T13:30:59",
  "MMMM Do YYYY hh:mm A": "September 25th 2026 01:30 PM",
  "MM-DD-YYYY hh:mm A": "09-25-2026 01:30 PM",
  "DD-MMM-YYYY hh:mm A": "25-Sep-2026 01:30 PM",
  X: "Unix timestamp",
}

const TEXT_FORMATTER_MODE_LABELS: Record<string, string> = {
  UPPER_CASE: "Upper case",
  LOWER_CASE: "Lower case",
  TITLE_CASE: "Title case",
  CAPITALIZE: "Capitalize",
  DEFAULT_VALUE: "Default value",
  TRIM: "Trim to length",
  TRIM_WHITESPACE: "Trim whitespace",
  REPLACE_TEXT: "Replace text",
  FIND: "Find",
  WORD_COUNT: "Word count",
  LENGTH: "Length",
  SPLIT_TEXT: "Split text",
  EXTRACT_EMAIL: "Extract email",
  EXTRACT_URL: "Extract URL",
}

export function buildAutomationFlowGraph(
  draft: AutomationFlowDraft,
  catalog: AutomationCatalog | null,
  actionLabels: Record<AutomationAction["type"], string>,
  timezone?: string | null,
  waitNodeBadges: Record<string, AutomationWaitNodeBadge> = {},
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
  const endpoints: Array<{ id: string; x: number; y: number }> = []
  let maximumY = 30

  const actionPresentation = (action: AutomationAction, actionNumber: number) => {
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
        : action.type === "FORMAT_DATE_TIME"
          ? action.dateTimeFormatterConfig?.mode === "COMPARE_DATES"
            ? `Compare dates · ${action.dateTimeFormatterConfig.unit.charAt(0)}${action.dateTimeFormatterConfig.unit.slice(1).toLowerCase()} → ${action.dateTimeFormatterConfig.outputKey}`
            : `Save ${action.dateTimeFormatterConfig?.outputKey || "value"} · ${
                FORMATTER_PREVIEWS[action.dateTimeFormatterConfig?.format ?? ""] || "Select a format"
              }`
        : action.type === "FORMAT_NUMBER"
          ? action.numberFormatterConfig?.mode === "FORMAT_CURRENCY"
            ? `Currency · ${action.numberFormatterConfig.currencyCode} → ${action.numberFormatterConfig.outputKey}`
            : action.numberFormatterConfig?.mode === "RANDOM_NUMBER"
              ? `Random ${action.numberFormatterConfig.min}–${action.numberFormatterConfig.max} → ${action.numberFormatterConfig.outputKey}`
              : action.numberFormatterConfig?.mode === "FORMAT_PHONE_NUMBER"
                ? `Format phone → ${action.numberFormatterConfig.outputKey}`
                : action.numberFormatterConfig?.mode === "TEXT_TO_NUMBER"
                  ? `Text to number → ${action.numberFormatterConfig.outputKey}`
                  : `Format number → ${action.numberFormatterConfig?.outputKey || "value"}`
        : action.type === "FORMAT_TEXT"
          ? `${TEXT_FORMATTER_MODE_LABELS[action.textFormatterConfig?.mode ?? ""] ?? "Format text"} → ${action.textFormatterConfig?.outputKey || "value"}`
        : action.type === "MATH_OPERATION"
          ? action.mathOperationConfig?.mode === "DATE"
            ? `${action.mathOperationConfig.operation === "ADD" ? "Add" : "Subtract"} ${action.mathOperationConfig.amount} ${action.mathOperationConfig.unit.toLocaleLowerCase()} → ${action.mathOperationConfig.outputKey}`
            : `${action.mathOperationConfig?.operation === "SUBTRACT" ? "Subtract" : action.mathOperationConfig?.operation === "MULTIPLY" ? "Multiply" : action.mathOperationConfig?.operation === "DIVIDE" ? "Divide" : "Add"} ${action.mathOperationConfig?.operand ?? ""} → ${action.mathOperationConfig?.outputKey || "value"}`
        : action.type === "UPDATE_CONTACT_CUSTOM_FIELDS"
          ? `Update ${action.customFieldUpdates?.length ?? 0} field${action.customFieldUpdates?.length === 1 ? "" : "s"}`
          : action.type === "DELETE_CONTACT"
            ? "Remove from this account"
          : action.type === "IF_ELSE"
            ? `First match · ${Math.max(0, (action.ifElseConfig?.branches.length ?? 1) - 1)} branches`
          : action.type === "SPLIT"
            ? `Random · ${action.splitConfig?.routes.length ?? 0} routes`
            : waitSubtitle ?? `Action ${actionNumber}`
    return {
      label: action.type === "FORMAT_TEXT"
        ? action.textFormatterConfig?.actionName.trim() || actionLabels[action.type]
        : action.type === "IF_ELSE"
          ? action.ifElseConfig?.actionName.trim() || actionLabels[action.type]
        : action.type === "SPLIT"
          ? action.splitConfig?.actionName.trim() || actionLabels[action.type]
          : actionLabels[action.type],
      subtitle: actionSubtitle,
    }
  }

  const renderPath = (
    actions: AutomationAction[],
    sourceId: string,
    centerX: number,
    startY: number,
    path: AutomationGraphBranchPath,
  ) => {
    let previousId = sourceId
    let y = startY
    const endsWithTerminal = actions.at(-1)?.type === "DELETE_CONTACT" ||
      actions.at(-1)?.type === "IF_ELSE" ||
      actions.at(-1)?.type === "SPLIT"

    for (let index = 0; index <= actions.length; index += 1) {
      if (index === actions.length && endsWithTerminal) break
      const pathKey = path.map((part) => `${part.routingNodeKey}-${part.branchKey}`).join("-") || "root"
      const addId = path.length === 0 ? `add-${index}` : `add-${pathKey}-${index}`
      nodes.push({
        id: addId,
        type: "automationNode",
        position: { x: centerX - ADD_NODE_WIDTH / 2, y },
        data: { kind: "add", label: "Add action", insertionIndex: index, insertionPath: path },
      })
      edges.push({ id: `${previousId}-${addId}`, source: previousId, target: addId, type: "straight" })
      previousId = addId
      maximumY = Math.max(maximumY, y)
      y += 85

      const action = actions[index]
      if (!action) continue
      const actionId = `action-${action.nodeKey ?? (path.length === 0 ? index : `${pathKey}-${index}`)}`
      const presentation = actionPresentation(action, index + 1)
      nodes.push({
        id: actionId,
        type: "automationNode",
        position: { x: centerX - CARD_WIDTH / 2, y },
        data: {
          kind: "action",
          ...presentation,
          actionType: action.type,
          actionGroup: actionVisualGroup(action.type),
          index: path.length === 0 ? index : undefined,
          actionNodeKey: action.nodeKey,
          actionPath: path,
          ...(action.type === "WAIT" && action.nodeKey && waitNodeBadges[action.nodeKey]
            ? { waitBadge: waitNodeBadges[action.nodeKey] }
            : {}),
        },
      })
      edges.push({ id: `${previousId}-${actionId}`, source: previousId, target: actionId, type: "straight" })
      previousId = actionId
      maximumY = Math.max(maximumY, y)
      y += 145

      if (
        (action.type !== "IF_ELSE" || !action.ifElseConfig) &&
        (action.type !== "SPLIT" || !action.splitConfig)
      ) continue
      const branches = action.type === "IF_ELSE"
        ? action.ifElseConfig!.branches.map((branch) => ({
            branchKey: branch.branchKey,
            name: branch.name,
            actions: branch.actions,
            isTerminal: branch.isDefault,
            subtitle: branch.isDefault
              ? "Default · no actions"
              : branch.matchMode === "ALL" ? "All conditions" : "Any condition",
          }))
        : action.splitConfig!.routes.map((route) => ({
            branchKey: route.branchKey,
            name: route.name,
            actions: route.actions,
            isTerminal: false,
            subtitle: `${route.percentage}% of runs`,
          }))
      const gap = branches.length <= 2 ? 360 : 320
      const firstX = centerX - ((branches.length - 1) * gap) / 2
      branches.forEach((branch, branchIndex) => {
        const branchX = firstX + branchIndex * gap
        const branchId = `branch-${action.nodeKey}-${branch.branchKey ?? branchIndex}`
        const branchPath = [
          ...path,
          { routingNodeKey: action.nodeKey ?? actionId, branchKey: branch.branchKey ?? String(branchIndex) },
        ]
        nodes.push({
          id: branchId,
          type: "automationNode",
          position: { x: branchX - CARD_WIDTH / 2, y },
          data: {
            kind: "branch",
            label: branch.name,
            subtitle: branch.subtitle,
          },
        })
        edges.push({
          id: `${actionId}-${branchId}`,
          source: actionId,
          target: branchId,
          type: "step",
        })
        maximumY = Math.max(maximumY, y)
        if (branch.isTerminal) {
          endpoints.push({ id: branchId, x: branchX, y })
        } else {
          renderPath(branch.actions, branchId, branchX, y + 105, branchPath)
        }
      })
      return
    }

    endpoints.push({ id: previousId, x: centerX, y: Math.max(startY, y - 85) })
  }

  renderPath(draft.actions, "trigger", FLOW_CENTER_X, 180, [])
  const endsWithDelete = draft.actions.at(-1)?.type === "DELETE_CONTACT"
  const completeY = Math.max(maximumY + 165, ...endpoints.map((endpoint) => endpoint.y + 165))
  nodes.push({
    id: "complete",
    type: "automationNode",
    position: { x: CARD_X, y: completeY },
    data: {
      kind: "complete",
      label: "Complete",
      subtitle: endsWithDelete ? "Contact deleted" : "All actions completed",
    },
  })
  for (const endpoint of endpoints) {
    edges.push({
      id: `${endpoint.id}-complete`,
      source: endpoint.id,
      target: "complete",
      type: endpoints.length > 1 ? "step" : "straight",
    })
  }
  return { nodes, edges }
}
