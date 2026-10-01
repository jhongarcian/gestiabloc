import type { Edge, Node } from "@xyflow/react"

import { formatDateTimeForDisplay } from "@/lib/date-time"

import type { AutomationAction, AutomationCatalog, AutomationCondition, AutomationTriggerType } from "./automation-types"

export type AutomationFlowNodeData = {
  kind: "trigger" | "action" | "add" | "branch" | "complete" | "route-bound"
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
  goToSelection?: "source" | "eligible" | "hovered" | "invalid"
  goToIssue?: string | null
  onGoToUnlink?: () => void
}

export type AutomationGoToEdgeData = {
  kind: "go-to"
  laneX: number
  highlighted?: boolean
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
const FLOW_SIDE_PADDING = 80
const CARD_WIDTH = 256
const ADD_NODE_WIDTH = 40
const BRANCH_HORIZONTAL_GAP = 80
const BRANCH_TO_PATH_STEP = 105
const COMPLETE_AFTER_ADD_STEP = 105
const COMPLETE_AFTER_CARD_STEP = 125

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

type AutomationGraphRoutingBranch = {
  branchKey: string
  name: string
  actions: AutomationAction[]
  isTerminal: boolean
  subtitle: string
}

function routingBranchesForAction(action: AutomationAction): AutomationGraphRoutingBranch[] | null {
  if (action.type === "IF_ELSE" && action.ifElseConfig) {
    return action.ifElseConfig.branches.map((branch, index) => ({
      branchKey: branch.branchKey ?? `branch-${index}`,
      name: branch.name,
      actions: branch.actions,
      isTerminal: branch.isDefault,
      subtitle: branch.isDefault
        ? "Default · no actions"
        : branch.matchMode === "ALL" ? "All conditions" : "Any condition",
    }))
  }
  if (action.type === "SPLIT" && action.splitConfig) {
    return action.splitConfig.routes.map((route, index) => ({
      branchKey: route.branchKey ?? `route-${index}`,
      name: route.name,
      actions: route.actions,
      isTerminal: false,
      subtitle: `${route.percentage}% of runs`,
    }))
  }
  return null
}

function automationPathWidth(actions: AutomationAction[]): number {
  for (const action of actions) {
    const branches = routingBranchesForAction(action)
    if (!branches || branches.length === 0) continue
    const branchWidths = branches.map((branch) =>
      Math.max(CARD_WIDTH, branch.isTerminal ? CARD_WIDTH : automationPathWidth(branch.actions))
    )
    return branchWidths.reduce((total, width) => total + width, 0) +
      BRANCH_HORIZONTAL_GAP * Math.max(0, branchWidths.length - 1)
  }
  return CARD_WIDTH
}

function graphPathKey(path: AutomationGraphBranchPath) {
  return path.map((part) => `${part.routingNodeKey}-${part.branchKey}`).join("-") || "root"
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
  const rootWidth = automationPathWidth(draft.actions)
  const rootCenterX = Math.max(FLOW_CENTER_X, FLOW_SIDE_PADDING + rootWidth / 2)
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
      position: { x: rootCenterX - CARD_WIDTH / 2, y: 30 },
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
          : action.type === "GO_TO"
            ? action.goToConfig?.targetNodeKey
              ? "Route to selected action"
              : "Choose a destination"
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
    let previousNodeY = startY
    let previousNodeKind: "add" | "action" = "add"
    let y = startY
    const endsWithTerminal = actions.at(-1)?.type === "DELETE_CONTACT" ||
      actions.at(-1)?.type === "IF_ELSE" ||
      actions.at(-1)?.type === "SPLIT" ||
      actions.at(-1)?.type === "GO_TO"

    for (let index = 0; index <= actions.length; index += 1) {
      if (index === actions.length && endsWithTerminal) break
      const pathKey = graphPathKey(path)
      const addId = path.length === 0 ? `add-${index}` : `add-${pathKey}-${index}`
      nodes.push({
        id: addId,
        type: "automationNode",
        position: { x: centerX - ADD_NODE_WIDTH / 2, y },
        data: { kind: "add", label: "Add action", insertionIndex: index, insertionPath: path },
      })
      edges.push({ id: `${previousId}-${addId}`, source: previousId, target: addId, sourceHandle: "flow-source", targetHandle: "flow-target", type: "straight" })
      previousId = addId
      previousNodeY = y
      previousNodeKind = "add"
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
      edges.push({ id: `${previousId}-${actionId}`, source: previousId, target: actionId, sourceHandle: "flow-source", targetHandle: "flow-target", type: "straight" })
      previousId = actionId
      previousNodeY = y
      previousNodeKind = "action"
      y += 145

      const branches = routingBranchesForAction(action)
      if (!branches || branches.length === 0) continue
      const branchWidths = branches.map((branch) =>
        Math.max(CARD_WIDTH, branch.isTerminal ? CARD_WIDTH : automationPathWidth(branch.actions))
      )
      const combinedWidth = branchWidths.reduce((total, width) => total + width, 0) +
        BRANCH_HORIZONTAL_GAP * Math.max(0, branchWidths.length - 1)
      let branchLeft = centerX - combinedWidth / 2
      branches.forEach((branch, branchIndex) => {
        const branchWidth = branchWidths[branchIndex] ?? CARD_WIDTH
        const branchX = branchLeft + branchWidth / 2
        branchLeft += branchWidth + BRANCH_HORIZONTAL_GAP
        const routingNodeKey = action.nodeKey ?? actionId
        const branchId = `branch-${routingNodeKey}-${branch.branchKey}`
        const branchPath = [
          ...path,
          { routingNodeKey, branchKey: branch.branchKey },
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
          sourceHandle: "flow-source",
          targetHandle: "flow-target",
          type: "step",
        })
        if (branch.isTerminal) {
          const completeId = `complete-${graphPathKey(branchPath)}`
          const completeY = y + COMPLETE_AFTER_CARD_STEP
          nodes.push({
            id: completeId,
            type: "automationNode",
            position: { x: branchX - CARD_WIDTH / 2, y: completeY },
            data: {
              kind: "complete",
              label: "Complete",
              subtitle: "All actions completed",
            },
          })
          edges.push({
            id: `${branchId}-${completeId}`,
            source: branchId,
            target: completeId,
            sourceHandle: "flow-source",
            targetHandle: "flow-target",
            type: "straight",
          })
        } else {
          renderPath(branch.actions, branchId, branchX, y + BRANCH_TO_PATH_STEP, branchPath)
        }
      })
      return
    }

    if (actions.at(-1)?.type === "GO_TO") return
    const completeId = path.length === 0 ? "complete" : `complete-${graphPathKey(path)}`
    const completeY = previousNodeY + (
      previousNodeKind === "action" ? COMPLETE_AFTER_CARD_STEP : COMPLETE_AFTER_ADD_STEP
    )
    nodes.push({
      id: completeId,
      type: "automationNode",
      position: { x: centerX - CARD_WIDTH / 2, y: completeY },
      data: {
        kind: "complete",
        label: "Complete",
        subtitle: actions.at(-1)?.type === "DELETE_CONTACT"
          ? "Contact deleted"
          : "All actions completed",
      },
    })
    edges.push({
      id: `${previousId}-${completeId}`,
      source: previousId,
      target: completeId,
      sourceHandle: "flow-source",
      targetHandle: "flow-target",
      type: "straight",
    })
  }

  renderPath(draft.actions, "trigger", rootCenterX, 180, [])
  const nodeByActionKey = new Map(
    nodes.flatMap((node) => node.data.actionNodeKey ? [[node.data.actionNodeKey, node] as const] : []),
  )
  const minX = Math.min(...nodes.map((node) => node.position.x))
  const maxX = Math.max(...nodes.map((node) => node.position.x + (node.data.kind === "add" ? ADD_NODE_WIDTH : CARD_WIDTH)))
  let leftLane = minX - 90
  let rightLane = maxX + 90
  for (const action of draft.actions.flatMap(function flatten(action: AutomationAction): AutomationAction[] {
    if (action.type === "IF_ELSE") {
      return [action, ...(action.ifElseConfig?.branches.flatMap((branch) => branch.actions.flatMap(flatten)) ?? [])]
    }
    if (action.type === "SPLIT") {
      return [action, ...(action.splitConfig?.routes.flatMap((route) => route.actions.flatMap(flatten)) ?? [])]
    }
    return [action]
  })) {
    if (action.type !== "GO_TO" || !action.nodeKey || !action.goToConfig?.targetNodeKey) continue
    const sourceNode = nodeByActionKey.get(action.nodeKey)
    const targetNode = nodeByActionKey.get(action.goToConfig.targetNodeKey)
    if (!sourceNode || !targetNode) continue
    const sourceCenterX = sourceNode.position.x + CARD_WIDTH / 2
    const useLeftLane = sourceCenterX - minX <= maxX - sourceCenterX
    const laneX = useLeftLane ? leftLane : rightLane
    if (useLeftLane) leftLane -= 32
    else rightLane += 32
    edges.push({
      id: `go-to-${action.nodeKey}-${action.goToConfig.targetNodeKey}`,
      source: sourceNode.id,
      target: targetNode.id,
      sourceHandle: "go-to-source-bottom",
      targetHandle: "go-to-target-top",
      type: "goTo",
      data: { kind: "go-to", laneX } satisfies AutomationGoToEdgeData,
    })
    nodes.push({
      id: `go-to-bound-${action.nodeKey}`,
      type: "automationNode",
      position: { x: laneX, y: Math.min(sourceNode.position.y, targetNode.position.y) },
      selectable: false,
      focusable: false,
      data: { kind: "route-bound", label: "" },
      style: { width: 1, height: 1, opacity: 0, pointerEvents: "none" },
    })
  }
  return { nodes, edges }
}
