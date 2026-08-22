import { createHash } from "node:crypto"
import { z } from "zod"

import {
  FOLLOW_UP_NODE_KINDS,
  WorkflowDefinitionV2Schema,
  convertLegacyWorkflowDefinition,
  getNodeBranches,
  validateSensitiveCustomFieldConditions,
  validateWorkflowDefinition,
  type FollowUpNodeKind,
  type WorkflowDefinitionV2,
  type WorkflowNodeV2,
  type WorkflowValidationIssue,
} from "./service-followup-definition.js"

export const FOLLOW_UP_DEFINITION_SCHEMA_VERSION_V3 = 3 as const

const ConditionV3Schema = z.object({
  id: z.string().trim().min(1).max(120),
  source: z.enum(["contactInfo", "customField", "variable"]),
  fieldKey: z.string().trim().max(160).optional(),
  customFieldId: z.string().trim().max(160).optional(),
  variableKey: z.string().trim().max(120).optional(),
  valueType: z.enum(["string", "number", "dateTime", "boolean"]),
  operator: z.enum([
    "includes", "not_includes", "eq", "neq", "gt", "gte", "lt", "lte",
    "is_empty", "is_not_empty",
  ]),
  compareValue: z.unknown().optional(),
})

const ConditionalBranchV3Schema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().max(160).default(""),
  isDefault: z.boolean().default(false),
  matchMode: z.enum(["ALL", "ANY"]).default("ALL"),
  conditions: z.array(ConditionV3Schema).max(20).default([]),
  targetStepId: z.string().trim().max(160).nullable().optional(),
})

const ManualStepV3Schema = z.object({
  id: z.string().trim().min(1).max(160),
  name: z.string().max(200).default(""),
  notesTemplate: z.string().max(4000).nullable().optional(),
  dueDaysFromStart: z.number().int().min(0).max(3650).default(0),
})

export const AUTOMATION_ACTION_KINDS_V3 = FOLLOW_UP_NODE_KINDS.filter(
  (kind): kind is Exclude<FollowUpNodeKind, "start" | "end" | "step" | "ifElse" | "goTo"> =>
    !["start", "end", "step", "ifElse", "goTo"].includes(kind),
)

export const USER_SCHEDULED_WAIT_DEFAULT_PROMPT = "Select the next follow-up date and time."

const DurationWaitDataV3Schema = z.object({
  waitMode: z.literal("DURATION"),
  waitValue: z.coerce.number().min(0).max(525_600),
  waitUnit: z.enum(["days", "hours", "minutes"]),
}).passthrough()

const UserScheduledWaitDataV3Schema = z.object({
  waitMode: z.literal("USER_SCHEDULED"),
  prompt: z.string().trim().min(1).max(300),
}).passthrough()

export const WaitActionDataV3Schema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const data = value as Record<string, unknown>
  return data.waitMode === undefined ? { ...data, waitMode: "DURATION" } : data
}, z.discriminatedUnion("waitMode", [DurationWaitDataV3Schema, UserScheduledWaitDataV3Schema]))

const WaitAutomationActionV3Schema = z.object({
  id: z.string().trim().min(1).max(160),
  kind: z.literal("wait"),
  label: z.string().max(200).default(""),
  data: WaitActionDataV3Schema,
})

const NonWaitAutomationActionKindsV3 = AUTOMATION_ACTION_KINDS_V3.filter(
  (kind): kind is Exclude<(typeof AUTOMATION_ACTION_KINDS_V3)[number], "wait"> => kind !== "wait",
)

const NonWaitAutomationActionV3Schema = z.object({
  id: z.string().trim().min(1).max(160),
  kind: z.enum(NonWaitAutomationActionKindsV3),
  label: z.string().max(200).default(""),
  data: z.record(z.string(), z.unknown()).default({}),
})

const AutomationActionV3Schema = z.discriminatedUnion("kind", [
  WaitAutomationActionV3Schema,
  NonWaitAutomationActionV3Schema,
])

const NextRouteV3Schema = z.object({ kind: z.literal("NEXT") })
const GoToRouteV3Schema = z.object({
  id: z.string().trim().min(1).max(160),
  kind: z.literal("GO_TO"),
  label: z.string().max(200).default("Go to step"),
  targetStepId: z.string().trim().max(160).nullable().optional(),
})
const ConditionalRouteV3Schema = z.object({
  id: z.string().trim().min(1).max(160),
  kind: z.literal("CONDITIONAL"),
  label: z.string().max(200).default("If / Else"),
  branches: z.array(ConditionalBranchV3Schema).max(20).default([]),
})

export const WorkflowRouteV3Schema = z.discriminatedUnion("kind", [
  NextRouteV3Schema, GoToRouteV3Schema, ConditionalRouteV3Schema,
])

const WorkflowTransitionV3Schema = z.object({
  id: z.string().trim().min(1).max(200),
  fromId: z.string().trim().min(1).max(160),
  actions: z.array(AutomationActionV3Schema).max(100).default([]),
  route: WorkflowRouteV3Schema.default({ kind: "NEXT" }),
})

export const WorkflowDefinitionV3Schema = z.object({
  schemaVersion: z.literal(FOLLOW_UP_DEFINITION_SCHEMA_VERSION_V3),
  start: z.object({
    id: z.string().trim().min(1).max(160),
    label: z.string().max(200).default("Start"),
  }),
  end: z.object({
    id: z.string().trim().min(1).max(160),
    label: z.string().max(200).default("End"),
  }),
  steps: z.array(ManualStepV3Schema).max(100),
  transitions: z.array(WorkflowTransitionV3Schema).max(101),
})

export const WorkflowDefinitionAnySchema = z.discriminatedUnion("schemaVersion", [
  WorkflowDefinitionV3Schema,
  WorkflowDefinitionV2Schema,
])

export type WorkflowConditionV3 = z.infer<typeof ConditionV3Schema>
export type WorkflowConditionalBranchV3 = z.infer<typeof ConditionalBranchV3Schema>
export type WorkflowManualStepV3 = z.infer<typeof ManualStepV3Schema>
export type WorkflowAutomationActionV3 = z.infer<typeof AutomationActionV3Schema>
export type WorkflowRouteV3 = z.infer<typeof WorkflowRouteV3Schema>
export type WorkflowTransitionV3 = z.infer<typeof WorkflowTransitionV3Schema>
export type WorkflowDefinitionV3 = z.infer<typeof WorkflowDefinitionV3Schema>
export type WorkflowDefinitionAny = z.infer<typeof WorkflowDefinitionAnySchema>

export type WorkflowValidationIssueV3 = WorkflowValidationIssue & {
  stepId?: string
  transitionId?: string
}
export type WorkflowValidationResultV3 =
  | { ok: true; definition: WorkflowDefinitionV3; issues: [] }
  | { ok: false; definition: WorkflowDefinitionV3 | null; issues: WorkflowValidationIssueV3[] }

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]),
  )
}

export function checksumWorkflowDefinitionAny(definition: WorkflowDefinitionAny) {
  return createHash("sha256").update(JSON.stringify(stableValue(definition))).digest("hex")
}

function idIssue(
  seen: Set<string>, id: string, issues: WorkflowValidationIssueV3[],
  context: Pick<WorkflowValidationIssueV3, "nodeId" | "stepId" | "transitionId" | "branchId">,
) {
  if (seen.has(id)) {
    issues.push({ code: "DUPLICATE_DEFINITION_ID", message: "Start, End, steps, actions, routes, and branches must use unique IDs.", ...context })
  }
  seen.add(id)
}

function nextStepId(definition: WorkflowDefinitionV3, fromId: string) {
  if (fromId === definition.start.id) return definition.steps[0]?.id ?? definition.end.id
  const index = definition.steps.findIndex((step) => step.id === fromId)
  return index === -1 ? null : definition.steps[index + 1]?.id ?? definition.end.id
}

export function routeTargetStepIds(route: WorkflowRouteV3) {
  if (route.kind === "GO_TO") return route.targetStepId ? [route.targetStepId] : []
  if (route.kind === "CONDITIONAL") {
    return route.branches.flatMap((branch) => branch.targetStepId ? [branch.targetStepId] : [])
  }
  return []
}

/** Project V3 into V2 so action config, sensitive-field, and dominance checks remain shared. */
export function workflowDefinitionV3ToV2Graph(definition: WorkflowDefinitionV3): WorkflowDefinitionV2 {
  const stepIndex = new Map(definition.steps.map((step, index) => [step.id, index]))
  const nodes: WorkflowNodeV2[] = [
    { id: definition.start.id, kind: "start", label: definition.start.label, position: { x: 440, y: 0 }, data: {} },
    ...definition.steps.map((step, index) => ({
      id: step.id, kind: "step" as const, label: step.name,
      position: { x: 440, y: (index + 1) * 1000 },
      data: { notesTemplate: step.notesTemplate ?? "", dueDaysFromStart: step.dueDaysFromStart },
    })),
    { id: definition.end.id, kind: "end", label: definition.end.label, position: { x: 440, y: (definition.steps.length + 1) * 1000 }, data: {} },
  ]
  const edges: WorkflowDefinitionV2["edges"] = []
  const nodeIds = new Set(nodes.map((node) => node.id))

  for (const transition of definition.transitions) {
    const fromIndex = transition.fromId === definition.start.id ? -1 : stepIndex.get(transition.fromId) ?? -1
    let previousId = transition.fromId
    transition.actions.forEach((action, actionIndex) => {
      nodes.push({
        id: action.id, kind: action.kind, label: action.label,
        position: { x: 440, y: (fromIndex + 1) * 1000 + (actionIndex + 1) * 10 }, data: action.data,
      })
      nodeIds.add(action.id)
      edges.push({ id: `v3-${transition.id}-${previousId}-${action.id}`, source: previousId, target: action.id })
      previousId = action.id
    })

    if (transition.route.kind === "CONDITIONAL") {
      const route = transition.route
      nodes.push({
        id: route.id, kind: "ifElse", label: route.label,
        position: { x: 440, y: (fromIndex + 1) * 1000 + (transition.actions.length + 1) * 10 },
        data: { branches: route.branches.map(({ targetStepId: _targetStepId, ...branch }) => branch) },
      })
      nodeIds.add(route.id)
      edges.push({ id: `v3-${transition.id}-${previousId}-${route.id}`, source: previousId, target: route.id })
      route.branches.forEach((branch) => {
        if (!branch.targetStepId || !stepIndex.has(branch.targetStepId)) return
        edges.push({ id: `v3-${route.id}-${branch.id}-${branch.targetStepId}`, source: route.id, target: branch.targetStepId, branchId: branch.id })
      })
      continue
    }
    if (transition.route.kind === "GO_TO") {
      nodes.push({
        id: transition.route.id, kind: "goTo", label: transition.route.label,
        position: { x: 440, y: (fromIndex + 1) * 1000 + (transition.actions.length + 1) * 10 }, data: {},
      })
      nodeIds.add(transition.route.id)
      edges.push({ id: `v3-${transition.id}-${previousId}-${transition.route.id}`, source: previousId, target: transition.route.id })
      if (transition.route.targetStepId && stepIndex.has(transition.route.targetStepId)) {
        edges.push({ id: `v3-${transition.route.id}-${transition.route.targetStepId}`, source: transition.route.id, target: transition.route.targetStepId })
      }
      continue
    }
    const target = nextStepId(definition, transition.fromId)
    if (target && nodeIds.has(target)) edges.push({ id: `v3-${transition.id}-${previousId}-${target}`, source: previousId, target })
  }
  return { schemaVersion: 2, nodes, edges }
}

export function validateWorkflowDefinitionV3(value: unknown): WorkflowValidationResultV3 {
  const parsed = WorkflowDefinitionV3Schema.safeParse(value)
  if (!parsed.success) {
    return { ok: false, definition: null, issues: parsed.error.issues.map((issue) => ({ code: "INVALID_DEFINITION", message: `${issue.path.join(".") || "definition"}: ${issue.message}` })) }
  }
  const definition = parsed.data
  const issues: WorkflowValidationIssueV3[] = []
  const seenIds = new Set<string>()
  idIssue(seenIds, definition.start.id, issues, { nodeId: definition.start.id })
  idIssue(seenIds, definition.end.id, issues, { nodeId: definition.end.id })
  if (!definition.steps.length) issues.push({ code: "NO_MANUAL_STEP", message: "A workflow must contain at least one named manual step." })

  const stepIndex = new Map<string, number>()
  definition.steps.forEach((step, index) => {
    idIssue(seenIds, step.id, issues, { nodeId: step.id, stepId: step.id })
    if (stepIndex.has(step.id)) issues.push({ code: "DUPLICATE_STEP_ID", nodeId: step.id, stepId: step.id, message: "Manual step IDs must be unique." })
    stepIndex.set(step.id, index)
    if (!step.name.trim()) issues.push({ code: "STEP_NAME_REQUIRED", nodeId: step.id, stepId: step.id, message: "Every manual step needs a name." })
  })

  const validFromIds = new Set([definition.start.id, ...definition.steps.map((step) => step.id)])
  const transitionByFrom = new Map<string, WorkflowTransitionV3>()
  for (const transition of definition.transitions) {
    idIssue(seenIds, transition.id, issues, { transitionId: transition.id })
    if (!validFromIds.has(transition.fromId)) issues.push({ code: "INVALID_TRANSITION_SOURCE", transitionId: transition.id, message: "A transition must follow Start or a named manual step." })
    if (transitionByFrom.has(transition.fromId)) issues.push({ code: "DUPLICATE_TRANSITION", transitionId: transition.id, nodeId: transition.fromId, message: "Start and each manual step may have only one transition." })
    transitionByFrom.set(transition.fromId, transition)
    transition.actions.forEach((action) => idIssue(seenIds, action.id, issues, { nodeId: action.id, transitionId: transition.id }))

    const userScheduledWaits = transition.actions.filter(
      (action) => action.kind === "wait" && action.data.waitMode === "USER_SCHEDULED",
    )
    if (userScheduledWaits.length > 1) {
      userScheduledWaits.forEach((action) => issues.push({
        code: "USER_SCHEDULED_WAIT_DUPLICATE",
        nodeId: action.id,
        transitionId: transition.id,
        message: "A transition may contain only one user-scheduled Wait.",
      }))
    }
    if (userScheduledWaits.length && transition.fromId === definition.start.id) {
      userScheduledWaits.forEach((action) => issues.push({
        code: "USER_SCHEDULED_WAIT_AFTER_START",
        nodeId: action.id,
        transitionId: transition.id,
        message: "A user-scheduled Wait must follow a manual step so the user can provide its date.",
      }))
    }
    if (userScheduledWaits.length && transition.fromId === definition.steps.at(-1)?.id) {
      userScheduledWaits.forEach((action) => issues.push({
        code: "USER_SCHEDULED_WAIT_AFTER_FINAL_STEP",
        nodeId: action.id,
        stepId: transition.fromId,
        transitionId: transition.id,
        message: "The final manual step cannot schedule another follow-up.",
      }))
    }

    const sourceIndex = transition.fromId === definition.start.id ? -1 : stepIndex.get(transition.fromId)
    if (transition.route.kind === "GO_TO") {
      idIssue(seenIds, transition.route.id, issues, { nodeId: transition.route.id, transitionId: transition.id })
      const targetIndex = transition.route.targetStepId ? stepIndex.get(transition.route.targetStepId) : undefined
      if (targetIndex === undefined) issues.push({ code: "ROUTE_TARGET_REQUIRED", nodeId: transition.route.id, transitionId: transition.id, message: "Go To must select a named manual step." })
      else if (sourceIndex !== undefined && targetIndex <= sourceIndex) issues.push({ code: "ROUTE_NOT_FORWARD", nodeId: transition.route.id, stepId: transition.route.targetStepId ?? undefined, transitionId: transition.id, message: "Go To may only select a later manual step." })
    }
    if (transition.route.kind === "CONDITIONAL") {
      const route = transition.route
      idIssue(seenIds, route.id, issues, { nodeId: route.id, transitionId: transition.id })
      const defaults = route.branches.filter((branch) => branch.isDefault)
      if (!route.branches.some((branch) => !branch.isDefault)) issues.push({ code: "BRANCHES_REQUIRED", nodeId: route.id, transitionId: transition.id, message: "If / Else requires at least one condition branch and Default." })
      if (defaults.length !== 1 || !route.branches.at(-1)?.isDefault) issues.push({ code: "DEFAULT_BRANCH", nodeId: route.id, transitionId: transition.id, message: "If / Else needs exactly one final Default branch." })
      route.branches.forEach((branch) => {
        idIssue(seenIds, branch.id, issues, { nodeId: route.id, transitionId: transition.id, branchId: branch.id })
        if (!branch.name.trim()) issues.push({ code: "BRANCH_NAME_REQUIRED", nodeId: route.id, transitionId: transition.id, branchId: branch.id, message: "Every conditional outcome needs a name." })
        const targetIndex = branch.targetStepId ? stepIndex.get(branch.targetStepId) : undefined
        if (targetIndex === undefined) issues.push({ code: "BRANCH_TARGET_REQUIRED", nodeId: route.id, transitionId: transition.id, branchId: branch.id, message: "Every conditional outcome must select a named manual step." })
        else if (sourceIndex !== undefined && targetIndex <= sourceIndex) issues.push({ code: "BRANCH_TARGET_NOT_FORWARD", nodeId: route.id, stepId: branch.targetStepId ?? undefined, transitionId: transition.id, branchId: branch.id, message: "Conditional outcomes may only select a later manual step." })
      })
    }
  }
  for (const fromId of validFromIds) {
    if (!transitionByFrom.has(fromId)) issues.push({ code: "TRANSITION_REQUIRED", nodeId: fromId, stepId: stepIndex.has(fromId) ? fromId : undefined, message: "Start and every manual step require one transition." })
  }

  const structurallyReachable = new Set<string>()
  const expandedTransitions = new Set<string>()
  const frontier = [definition.start.id]
  while (frontier.length) {
    const fromId = frontier.shift() as string
    if (expandedTransitions.has(fromId)) continue
    expandedTransitions.add(fromId)
    const transition = transitionByFrom.get(fromId)
    if (!transition) continue
    const targets = transition.route.kind === "NEXT" ? [nextStepId(definition, fromId)] : routeTargetStepIds(transition.route)
    for (const target of targets) {
      if (!target || target === definition.end.id) continue
      const sourceIndex = fromId === definition.start.id ? -1 : stepIndex.get(fromId) ?? -1
      const targetIndex = stepIndex.get(target)
      if (targetIndex === undefined) continue
      for (let index = sourceIndex + 1; index <= targetIndex; index += 1) {
        const coveredStep = definition.steps[index]
        if (coveredStep) structurallyReachable.add(coveredStep.id)
      }
      if (!frontier.includes(target)) frontier.push(target)
    }
  }
  definition.steps.forEach((step) => {
    if (!structurallyReachable.has(step.id)) issues.push({ code: "UNREACHABLE_STEP", nodeId: step.id, stepId: step.id, message: "This manual step can never become current. Remove it or route to it." })
  })

  if (!issues.some((issue) => ["TRANSITION_REQUIRED", "INVALID_TRANSITION_SOURCE", "ROUTE_TARGET_REQUIRED", "BRANCH_TARGET_REQUIRED"].includes(issue.code))) {
    issues.push(
      ...validateWorkflowDefinition(workflowDefinitionV3ToV2Graph(definition)).issues.filter(
        (issue) => issue.code !== "UNREACHABLE_NODE",
      ),
    )
  }
  return issues.length ? { ok: false, definition, issues } : { ok: true, definition, issues: [] }
}

export function getUserScheduledWaitForStep(
  definitionValue: unknown,
  stepNodeId: string,
) {
  const parsed = WorkflowDefinitionV3Schema.safeParse(definitionValue)
  if (!parsed.success) return null
  const transition = parsed.data.transitions.find((item) => item.fromId === stepNodeId)
  if (!transition) return null
  const action = transition.actions.find(
    (item) => item.kind === "wait" && item.data.waitMode === "USER_SCHEDULED",
  )
  if (!action || action.kind !== "wait" || action.data.waitMode !== "USER_SCHEDULED") return null
  return {
    actionId: action.id,
    prompt: action.data.prompt,
    transitionId: transition.id,
  }
}

export function getUserScheduledWaitByActionId(
  definitionValue: unknown,
  actionId: string,
) {
  const wait = getWorkflowWaitByActionId(definitionValue, actionId)
  return wait?.waitMode === "USER_SCHEDULED" ? wait : null
}

export function getWorkflowWaitByActionId(
  definitionValue: unknown,
  actionId: string,
) {
  const parsed = WorkflowDefinitionV3Schema.safeParse(definitionValue)
  if (parsed.success) {
    for (const transition of parsed.data.transitions) {
      const action = transition.actions.find((item) => item.id === actionId)
      if (action?.kind === "wait") {
        return {
          actionId: action.id,
          waitMode: action.data.waitMode,
          prompt:
            action.data.waitMode === "USER_SCHEDULED"
              ? action.data.prompt
              : "Continue this follow-up before its scheduled time.",
          transitionId: transition.id,
          fromStepId: transition.fromId,
        }
      }
    }
    return null
  }

  const legacy = WorkflowDefinitionV2Schema.safeParse(definitionValue)
  if (!legacy.success) return null
  const node = legacy.data.nodes.find((item) => item.id === actionId && item.kind === "wait")
  if (!node) return null
  const data = node.data && typeof node.data === "object" && !Array.isArray(node.data)
    ? node.data as Record<string, unknown>
    : {}
  const waitMode = data.waitMode === "USER_SCHEDULED" ? "USER_SCHEDULED" : "DURATION"
  return {
    actionId: node.id,
    waitMode,
    prompt:
      waitMode === "USER_SCHEDULED" && typeof data.prompt === "string" && data.prompt.trim()
        ? data.prompt.trim()
        : "Continue this follow-up before its scheduled time.",
    transitionId: null,
    fromStepId: null,
  }
}

export function validateSensitiveCustomFieldConditionsV3(
  definition: WorkflowDefinitionV3,
  fields: Array<{ id: string; key: string; isEncrypted: boolean; isSensitive: boolean }>,
) {
  return validateSensitiveCustomFieldConditions(workflowDefinitionV3ToV2Graph(definition), fields)
}

function conversionIssue(code: string, message: string, nodeId?: string): WorkflowValidationIssueV3 {
  return { code, message, ...(nodeId ? { nodeId } : {}) }
}

export function convertWorkflowDefinitionV2ToV3(
  definitionValue: unknown,
  preferredStepOrder: string[] = [],
): { ok: true; definition: WorkflowDefinitionV3; issues: [] } | { ok: false; definition: null; issues: WorkflowValidationIssueV3[] } {
  const parsed = WorkflowDefinitionV2Schema.safeParse(definitionValue)
  if (!parsed.success) return { ok: false, definition: null, issues: [conversionIssue("INVALID_V2_DEFINITION", "The legacy workflow definition is invalid.")] }
  const definition = parsed.data
  const start = definition.nodes.find((node) => node.kind === "start")
  const end = definition.nodes.find((node) => node.kind === "end")
  if (!start || !end) return { ok: false, definition: null, issues: [conversionIssue("V2_START_END_REQUIRED", "The legacy workflow needs one Start and End before it can be converted.")] }

  const stepNodes = definition.nodes.filter((node) => node.kind === "step")
  const stepById = new Map(stepNodes.map((step) => [step.id, step]))
  const orderedIds = [
    ...preferredStepOrder.filter((id, index) => stepById.has(id) && preferredStepOrder.indexOf(id) === index),
    ...stepNodes.filter((step) => !preferredStepOrder.includes(step.id))
      .sort((left, right) => left.position.y - right.position.y || left.position.x - right.position.x)
      .map((step) => step.id),
  ]
  const steps: WorkflowManualStepV3[] = orderedIds.map((id) => {
    const node = stepById.get(id) as WorkflowNodeV2
    const data = node.data as Record<string, unknown>
    return { id, name: node.label, notesTemplate: typeof data.notesTemplate === "string" ? data.notesTemplate : null, dueDaysFromStart: typeof data.dueDaysFromStart === "number" ? Math.max(0, Math.floor(data.dueDaysFromStart)) : 0 }
  })
  const stepIndex = new Map(steps.map((step, index) => [step.id, index]))
  const nodeById = new Map(definition.nodes.map((node) => [node.id, node]))
  const outgoing = new Map<string, WorkflowDefinitionV2["edges"]>()
  definition.edges.forEach((edge) => outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]))
  const claimedActionIds = new Set<string>()
  const issues: WorkflowValidationIssueV3[] = []

  const makeTransition = (fromNode: WorkflowNodeV2, anchorIndex: number): WorkflowTransitionV3 | null => {
    const transitionId = `transition-${fromNode.id}`
    const actions: WorkflowAutomationActionV3[] = []
    let currentId = fromNode.id
    const localSeen = new Set<string>([currentId])
    for (let guard = 0; guard <= definition.nodes.length; guard += 1) {
      const edges = outgoing.get(currentId) ?? []
      if (!edges.length) return { id: transitionId, fromId: fromNode.id, actions, route: { kind: "NEXT" } }
      if (edges.length !== 1) {
        issues.push(conversionIssue("AMBIGUOUS_V2_ACTION_PATH", "A legacy shared action path has multiple destinations.", currentId))
        return null
      }
      const next = nodeById.get(edges[0].target)
      if (!next) {
        issues.push(conversionIssue("MISSING_V2_TARGET", "A legacy action destination is missing.", currentId))
        return null
      }
      if (localSeen.has(next.id)) {
        issues.push(conversionIssue("V2_CYCLE", "Legacy workflow loops cannot be converted.", next.id))
        return null
      }
      localSeen.add(next.id)
      if (next.kind === "end") return { id: transitionId, fromId: fromNode.id, actions, route: { kind: "NEXT" } }
      if (next.kind === "step") {
        const targetIndex = stepIndex.get(next.id)
        if (targetIndex === undefined || targetIndex <= anchorIndex) {
          issues.push(conversionIssue("V2_ROUTE_NOT_FORWARD", "A legacy route points to the current or an earlier manual step.", next.id))
          return null
        }
        return { id: transitionId, fromId: fromNode.id, actions, route: targetIndex === anchorIndex + 1 ? { kind: "NEXT" } : { id: `route-${fromNode.id}`, kind: "GO_TO", label: "Go to step", targetStepId: next.id } }
      }
      if (next.kind === "ifElse") {
        const branches = getNodeBranches(next)
        const branchEdges = outgoing.get(next.id) ?? []
        const convertedBranches: WorkflowConditionalBranchV3[] = []
        for (const branch of branches) {
          const branchEdge = branchEdges.find((edge) => edge.branchId === branch.id)
          const target = branchEdge ? nodeById.get(branchEdge.target) : null
          if (!target || target.kind !== "step") {
            issues.push(conversionIssue("V2_BRANCH_ACTION_PATH", "Legacy conditional outcomes must point directly to named manual steps before conversion.", next.id))
            return null
          }
          const targetIndex = stepIndex.get(target.id)
          if (targetIndex === undefined || targetIndex <= anchorIndex) {
            issues.push(conversionIssue("V2_BRANCH_NOT_FORWARD", "A legacy conditional outcome points backward.", next.id))
            return null
          }
          convertedBranches.push({ ...branch, targetStepId: target.id })
        }
        return { id: transitionId, fromId: fromNode.id, actions, route: { id: next.id, kind: "CONDITIONAL", label: next.label || "If / Else", branches: convertedBranches } }
      }
      if (next.kind === "goTo") {
        const targetEdge = (outgoing.get(next.id) ?? [])[0]
        const target = targetEdge ? nodeById.get(targetEdge.target) : null
        const targetIndex = target?.kind === "step" ? stepIndex.get(target.id) : undefined
        if (!target || target.kind !== "step" || targetIndex === undefined || targetIndex <= anchorIndex) {
          issues.push(conversionIssue("V2_GO_TO_TARGET", "Legacy Go To must point directly to a later named manual step.", next.id))
          return null
        }
        return { id: transitionId, fromId: fromNode.id, actions, route: { id: next.id, kind: "GO_TO", label: next.label || "Go to step", targetStepId: target.id } }
      }
      if (next.kind === "start") {
        issues.push(conversionIssue("V2_START_IN_PATH", "A transition cannot route back to Start.", next.id))
        return null
      }
      if (claimedActionIds.has(next.id)) {
        issues.push(conversionIssue("V2_SHARED_ACTION_AMBIGUOUS", "A legacy automation action belongs to more than one transition.", next.id))
        return null
      }
      claimedActionIds.add(next.id)
      if (next.kind === "wait") {
        const waitData = WaitActionDataV3Schema.safeParse(next.data)
        if (!waitData.success) {
          issues.push(conversionIssue("V2_WAIT_CONFIG_INVALID", "The legacy Wait configuration is invalid.", next.id))
          return null
        }
        actions.push({ id: next.id, kind: "wait", label: next.label, data: waitData.data })
      } else {
        actions.push({ id: next.id, kind: next.kind, label: next.label, data: next.data })
      }
      currentId = next.id
    }
    issues.push(conversionIssue("V2_TRAVERSAL_LIMIT", "The legacy workflow could not be converted safely.", fromNode.id))
    return null
  }

  const anchors = [start, ...steps.map((step) => stepById.get(step.id) as WorkflowNodeV2)]
  const transitions = anchors.flatMap((anchor, index) => {
    const converted = makeTransition(anchor, index - 1)
    return converted ? [converted] : []
  })
  if (issues.length || transitions.length !== anchors.length) return { ok: false, definition: null, issues }
  const converted: WorkflowDefinitionV3 = {
    schemaVersion: 3,
    start: { id: start.id, label: start.label || "Start" },
    end: { id: end.id, label: end.label || "End" },
    steps,
    transitions,
  }
  const validation = validateWorkflowDefinitionV3(converted)
  return validation.ok ? { ok: true, definition: validation.definition, issues: [] } : { ok: false, definition: null, issues: validation.issues }
}

export function getDraftWorkflowDefinitionAny(template: {
  draftDefinition?: unknown
  flowNodes?: unknown
  flowEdges?: unknown
  steps?: Array<{ templateNodeId?: string | null; sortOrder?: number }> | null
}): WorkflowDefinitionAny {
  const v3 = WorkflowDefinitionV3Schema.safeParse(template.draftDefinition)
  if (v3.success) return v3.data
  const v2 = WorkflowDefinitionV2Schema.safeParse(template.draftDefinition)
  const legacyV2 = v2.success ? v2.data : convertLegacyWorkflowDefinition(template.flowNodes, template.flowEdges)
  const preferredStepOrder = [...(template.steps ?? [])]
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
    .flatMap((step) => step.templateNodeId ? [step.templateNodeId] : [])
  const converted = convertWorkflowDefinitionV2ToV3(legacyV2, preferredStepOrder)
  return converted.ok ? converted.definition : legacyV2
}

export function workflowDefinitionV3ToLegacyCanvas(definition: WorkflowDefinitionV3) {
  const nodes: Array<Record<string, unknown>> = []
  const edges: Array<{ id: string; source: string; target: string; type: string }> = []
  let y = 80
  nodes.push({ id: definition.start.id, type: "stepNode", position: { x: 440, y }, data: { kind: "start", label: definition.start.label } })
  let previousVisibleId = definition.start.id
  const transitionByFrom = new Map(definition.transitions.map((transition) => [transition.fromId, transition]))

  const addTransition = (fromId: string) => {
    const transition = transitionByFrom.get(fromId)
    if (!transition) return
    for (const action of transition.actions) {
      y += 130
      nodes.push({ id: action.id, type: "stepNode", position: { x: 440, y }, data: { ...action.data, kind: action.kind, label: action.label } })
      edges.push({ id: `canvas-${previousVisibleId}-${action.id}`, source: previousVisibleId, target: action.id, type: "smoothstep" })
      previousVisibleId = action.id
    }
    if (transition.route.kind === "CONDITIONAL") {
      y += 130
      nodes.push({
        id: transition.route.id, type: "stepNode", position: { x: 440, y },
        data: { kind: "ifElse", label: transition.route.label, ifElseBranches: transition.route.branches.map((branch) => ({ ...branch, targetNodeId: branch.targetStepId ?? null })) },
      })
      edges.push({ id: `canvas-${previousVisibleId}-${transition.route.id}`, source: previousVisibleId, target: transition.route.id, type: "smoothstep" })
      previousVisibleId = transition.route.id
    } else if (transition.route.kind === "GO_TO") {
      y += 130
      nodes.push({ id: transition.route.id, type: "stepNode", position: { x: 440, y }, data: { kind: "goTo", label: transition.route.label, goToNodeId: transition.route.targetStepId ?? "" } })
      edges.push({ id: `canvas-${previousVisibleId}-${transition.route.id}`, source: previousVisibleId, target: transition.route.id, type: "smoothstep" })
      previousVisibleId = transition.route.id
    }
  }

  addTransition(definition.start.id)
  for (const step of definition.steps) {
    y += 130
    nodes.push({ id: step.id, type: "stepNode", position: { x: 440, y }, data: { kind: "step", label: step.name, notesTemplate: step.notesTemplate ?? "", dueDaysFromStart: step.dueDaysFromStart } })
    edges.push({ id: `canvas-${previousVisibleId}-${step.id}`, source: previousVisibleId, target: step.id, type: "smoothstep" })
    previousVisibleId = step.id
    addTransition(step.id)
  }
  return { nodes, edges }
}
