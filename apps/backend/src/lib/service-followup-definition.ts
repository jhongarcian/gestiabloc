import { createHash } from "node:crypto"
import { z } from "zod"

export const FOLLOW_UP_DEFINITION_SCHEMA_VERSION = 2 as const

export const FOLLOW_UP_NODE_KINDS = [
  "start",
  "end",
  "step",
  "wait",
  "ifElse",
  "mathOperation",
  "numberFormatter",
  "dateTimeFormatter",
  "goTo",
  "reminder",
  "assign",
  "removeUser",
  "tagAdd",
  "tagRemove",
  "contactFieldUpdate",
  "statusUpdate",
  "addNote",
  "addTask",
] as const

export type FollowUpNodeKind = (typeof FOLLOW_UP_NODE_KINDS)[number]

const PositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
})

const ConditionSchema = z.object({
  id: z.string().trim().min(1).max(120),
  source: z.enum(["contactInfo", "customField", "variable"]),
  fieldKey: z.string().trim().max(160).optional(),
  customFieldId: z.string().trim().max(160).optional(),
  variableKey: z.string().trim().max(120).optional(),
  valueType: z.enum(["string", "number", "dateTime", "boolean"]),
  operator: z.enum([
    "includes",
    "not_includes",
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "is_empty",
    "is_not_empty",
  ]),
  compareValue: z.unknown().optional(),
})

const BranchSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(160),
  isDefault: z.boolean().optional().default(false),
  matchMode: z.enum(["ALL", "ANY"]).optional().default("ALL"),
  conditions: z.array(ConditionSchema).max(20).optional().default([]),
})

export const WorkflowNodeV2Schema = z.object({
  id: z.string().trim().min(1).max(160),
  kind: z.enum(FOLLOW_UP_NODE_KINDS),
  label: z.string().max(200).optional().default(""),
  position: PositionSchema.optional().default({ x: 0, y: 0 }),
  data: z.record(z.string(), z.unknown()).optional().default({}),
})

export const WorkflowEdgeV2Schema = z.object({
  id: z.string().trim().min(1).max(240),
  source: z.string().trim().min(1).max(160),
  target: z.string().trim().min(1).max(160),
  branchId: z.string().trim().min(1).max(120).optional(),
})

export const WorkflowDefinitionV2Schema = z.object({
  schemaVersion: z.literal(FOLLOW_UP_DEFINITION_SCHEMA_VERSION),
  nodes: z.array(WorkflowNodeV2Schema).max(250),
  edges: z.array(WorkflowEdgeV2Schema).max(500),
})

export type WorkflowConditionV2 = z.infer<typeof ConditionSchema>
export type WorkflowBranchV2 = z.infer<typeof BranchSchema>
export type WorkflowNodeV2 = z.infer<typeof WorkflowNodeV2Schema>
export type WorkflowEdgeV2 = z.infer<typeof WorkflowEdgeV2Schema>
export type WorkflowDefinitionV2 = z.infer<typeof WorkflowDefinitionV2Schema>

export type WorkflowValidationIssue = {
  code: string
  message: string
  nodeId?: string
  branchId?: string
  edgeId?: string
}

export type WorkflowValidationResult =
  | { ok: true; definition: WorkflowDefinitionV2; issues: [] }
  | { ok: false; definition: WorkflowDefinitionV2 | null; issues: WorkflowValidationIssue[] }

function recordValue(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

export function getNodeBranches(node: WorkflowNodeV2): WorkflowBranchV2[] {
  if (node.kind !== "ifElse") return []
  const parsed = z.array(BranchSchema).safeParse(recordValue(node.data).branches)
  return parsed.success ? parsed.data : []
}

function getNodeOutputKey(node: WorkflowNodeV2) {
  if (
    node.kind !== "mathOperation" &&
    node.kind !== "numberFormatter" &&
    node.kind !== "dateTimeFormatter"
  ) {
    return null
  }
  const value = recordValue(node.data).outputKey
  return typeof value === "string" && value.trim() ? value.trim() : null
}

const VARIABLE_TOKEN = /\{\{\s*variables\.([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g

function collectVariableReferences(value: unknown, found = new Set<string>()) {
  if (typeof value === "string") {
    VARIABLE_TOKEN.lastIndex = 0
    for (let match = VARIABLE_TOKEN.exec(value); match; match = VARIABLE_TOKEN.exec(value)) {
      found.add(match[1])
    }
    return found
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectVariableReferences(item, found))
    return found
  }
  if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) =>
      collectVariableReferences(item, found),
    )
  }
  return found
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]),
  )
}

export function checksumWorkflowDefinition(definition: WorkflowDefinitionV2) {
  return createHash("sha256").update(JSON.stringify(stableValue(definition))).digest("hex")
}

export function validateWorkflowDefinition(value: unknown): WorkflowValidationResult {
  const parsed = WorkflowDefinitionV2Schema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      definition: null,
      issues: parsed.error.issues.map((issue) => ({
        code: "INVALID_DEFINITION",
        message: `${issue.path.join(".") || "definition"}: ${issue.message}`,
      })),
    }
  }

  const definition = parsed.data
  const issues: WorkflowValidationIssue[] = []
  const nodeById = new Map<string, WorkflowNodeV2>()
  for (const node of definition.nodes) {
    if (nodeById.has(node.id)) {
      issues.push({ code: "DUPLICATE_NODE_ID", nodeId: node.id, message: "Node IDs must be unique." })
    } else {
      nodeById.set(node.id, node)
    }
  }

  const edgeIds = new Set<string>()
  const outgoing = new Map<string, WorkflowEdgeV2[]>()
  const incoming = new Map<string, WorkflowEdgeV2[]>()
  for (const edge of definition.edges) {
    if (edgeIds.has(edge.id)) {
      issues.push({ code: "DUPLICATE_EDGE_ID", edgeId: edge.id, message: "Edge IDs must be unique." })
    }
    edgeIds.add(edge.id)
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      issues.push({
        code: "INVALID_EDGE_TARGET",
        edgeId: edge.id,
        message: "Every edge must connect two existing nodes.",
      })
      continue
    }
    if (edge.source === edge.target) {
      issues.push({ code: "SELF_EDGE", edgeId: edge.id, nodeId: edge.source, message: "A node cannot connect to itself." })
    }
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge])
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge])
  }

  const startNodes = definition.nodes.filter((node) => node.kind === "start")
  const endNodes = definition.nodes.filter((node) => node.kind === "end")
  if (startNodes.length !== 1) {
    issues.push({ code: "START_COUNT", message: "A workflow must contain exactly one Start node." })
  }
  if (endNodes.length !== 1) {
    issues.push({ code: "END_COUNT", message: "A workflow must contain exactly one shared End node." })
  }
  if (!definition.nodes.some((node) => node.kind === "step")) {
    issues.push({ code: "NO_MANUAL_STEP", message: "A workflow must contain at least one named user step." })
  }

  for (const node of definition.nodes) {
    const nodeOutgoing = outgoing.get(node.id) ?? []
    const nodeIncoming = incoming.get(node.id) ?? []
    if (node.kind === "start" && nodeIncoming.length) {
      issues.push({ code: "START_HAS_INCOMING", nodeId: node.id, message: "Start cannot have incoming connections." })
    }
    if (node.kind === "end") {
      if (nodeOutgoing.length) {
        issues.push({ code: "END_HAS_OUTGOING", nodeId: node.id, message: "End cannot have outgoing connections." })
      }
      continue
    }
    if (node.kind === "step" && !node.label.trim()) {
      issues.push({ code: "STEP_NAME_REQUIRED", nodeId: node.id, message: "Every user step needs a name." })
    }

    const data = recordValue(node.data)
    const configIssue = (message: string) =>
      issues.push({ code: "ACTION_CONFIG_INVALID", nodeId: node.id, message })
    const nonEmptyString = (value: unknown) =>
      typeof value === "string" && value.trim().length > 0
    if (node.kind === "wait") {
      const amount = Number(data.waitValue)
      if (!Number.isFinite(amount) || amount < 0) configIssue("Wait requires a non-negative duration.")
      if (!["days", "hours", "minutes"].includes(String(data.waitUnit))) {
        configIssue("Wait requires days, hours, or minutes.")
      }
    }
    if (node.kind === "assign" && !nonEmptyString(data.assigneeUserId)) {
      configIssue("Assign user requires a tenant user.")
    }
    if (
      node.kind === "removeUser" &&
      data.removeTarget === "specific_user" &&
      !nonEmptyString(data.assigneeUserId)
    ) {
      configIssue("Remove user requires a user when the target is specific user.")
    }
    if (node.kind === "tagAdd" || node.kind === "tagRemove") {
      const names = Array.isArray(data.tagNames) ? data.tagNames.filter(nonEmptyString) : []
      if (!names.length && !nonEmptyString(data.tagName)) {
        configIssue("Tag actions require at least one tag.")
      }
    }
    if (node.kind === "contactFieldUpdate" && !nonEmptyString(data.fieldKey)) {
      configIssue("Update contact field requires a field.")
    }
    if (node.kind === "statusUpdate" && !nonEmptyString(data.statusValue)) {
      configIssue("Update status requires a contact status.")
    }
    if (node.kind === "reminder") {
      const target = String(data.reminderTarget ?? "assigned_contact_owner")
      if (!["assigned_contact_owner", "specific_user", "all_users"].includes(target)) {
        configIssue("Reminder has an invalid recipient target.")
      }
      if (target === "specific_user" && !nonEmptyString(data.reminderUserId)) {
        configIssue("Reminder requires a user when the target is specific user.")
      }
    }
    if (node.kind === "mathOperation") {
      if (!nonEmptyString(data.mathSourceFieldKey) && !nonEmptyString(data.mathSourceVariableKey)) {
        configIssue("Math operation requires an input field or workflow variable.")
      }
      if (!Number.isFinite(Number(data.mathOperationValue))) {
        configIssue("Math operation requires a valid numeric operand.")
      }
      if (data.mathOperationType === "divide" && Number(data.mathOperationValue) === 0) {
        configIssue("Math operation cannot divide by zero.")
      }
    }
    if (node.kind === "numberFormatter") {
      const mode = String(data.numberFormatterMode ?? "")
      if (!["textToNumber", "formatNumber", "formatCurrency", "formatPhoneNumber", "randomNumber"].includes(mode)) {
        configIssue("Number formatter requires a supported mode.")
      } else if (mode === "randomNumber") {
        const min = Number(data.numberFormatterMin)
        const max = Number(data.numberFormatterMax)
        if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
          configIssue("Random number requires a valid minimum no greater than its maximum.")
        }
      } else {
        const key =
          mode === "formatPhoneNumber"
            ? data.numberFormatterFieldKey
            : data.numberFormatterInputFieldKey
        if (!nonEmptyString(key) && !nonEmptyString(data.numberFormatterInputVariableKey)) {
          configIssue("Number formatter requires an input field or workflow variable.")
        }
      }
    }
    if (node.kind === "dateTimeFormatter") {
      if (!nonEmptyString(data.dateTimeFormatSourceFieldKey) && !nonEmptyString(data.dateTimeFormatSourceVariableKey)) {
        configIssue("Date formatter requires an input date or workflow variable.")
      }
      if (
        data.dateTimeFormatMode === "compareDates" &&
        !nonEmptyString(data.dateTimeFormatCompareFieldKey) &&
        !nonEmptyString(data.dateTimeFormatCompareVariableKey)
      ) {
        configIssue("Date comparison requires a second date.")
      }
      if (
        data.dateTimeFormatMode === "compareDates" &&
        !["days", "months", "years"].includes(String(data.dateTimeCompareUnit ?? "days"))
      ) {
        configIssue("Date comparison requires a days, months, or years unit.")
      }
    }

    if (node.kind === "ifElse") {
      const branchesValue = recordValue(node.data).branches
      const branchParse = z.array(BranchSchema).safeParse(branchesValue)
      if (!branchParse.success || !branchParse.data.length) {
        issues.push({ code: "BRANCHES_REQUIRED", nodeId: node.id, message: "If / Else requires configured branches." })
        continue
      }
      const branches = branchParse.data
      const defaults = branches.filter((branch) => branch.isDefault)
      if (defaults.length !== 1 || !branches.at(-1)?.isDefault) {
        issues.push({ code: "DEFAULT_BRANCH", nodeId: node.id, message: "If / Else needs one final Default branch." })
      }
      const branchIds = new Set<string>()
      for (const branch of branches) {
        if (branchIds.has(branch.id)) {
          issues.push({ code: "DUPLICATE_BRANCH_ID", nodeId: node.id, branchId: branch.id, message: "Branch IDs must be unique." })
        }
        branchIds.add(branch.id)
        const branchEdges = nodeOutgoing.filter((edge) => edge.branchId === branch.id)
        if (branchEdges.length !== 1) {
          issues.push({
            code: "BRANCH_CONNECTION_REQUIRED",
            nodeId: node.id,
            branchId: branch.id,
            message: "Every branch must have exactly one destination.",
          })
        }
        if (!branch.isDefault && !branch.conditions.length) {
          issues.push({ code: "BRANCH_CONDITION_REQUIRED", nodeId: node.id, branchId: branch.id, message: "A non-default branch needs at least one condition." })
        }
        if (branch.isDefault && branch.conditions.length) {
          issues.push({ code: "DEFAULT_HAS_CONDITIONS", nodeId: node.id, branchId: branch.id, message: "The Default branch cannot contain conditions." })
        }
        for (const condition of branch.conditions) {
          const emptyOperator = condition.operator === "is_empty" || condition.operator === "is_not_empty"
          if (condition.source === "contactInfo" && !condition.fieldKey) {
            issues.push({ code: "CONDITION_SOURCE_REQUIRED", nodeId: node.id, branchId: branch.id, message: "Select a contact field." })
          }
          if (condition.source === "customField" && !condition.customFieldId && !condition.fieldKey) {
            issues.push({ code: "CONDITION_SOURCE_REQUIRED", nodeId: node.id, branchId: branch.id, message: "Select a custom field." })
          }
          if (condition.source === "variable" && !condition.variableKey) {
            issues.push({ code: "CONDITION_SOURCE_REQUIRED", nodeId: node.id, branchId: branch.id, message: "Select a workflow variable." })
          }
          if (condition.source === "contactInfo" && condition.fieldKey === "ssn" && !emptyOperator) {
            issues.push({
              code: "SENSITIVE_FIELD_OPERATOR",
              nodeId: node.id,
              branchId: branch.id,
              message: "Protected SSN data may only be checked with Is empty or Is not empty.",
            })
          }
          if (!emptyOperator && (condition.compareValue === undefined || condition.compareValue === "")) {
            issues.push({ code: "CONDITION_VALUE_REQUIRED", nodeId: node.id, branchId: branch.id, message: "Enter a comparison value." })
          }
        }
      }
      const unknownBranchEdge = nodeOutgoing.find(
        (edge) => !edge.branchId || !branchIds.has(edge.branchId),
      )
      if (unknownBranchEdge) {
        issues.push({ code: "INVALID_BRANCH_EDGE", nodeId: node.id, edgeId: unknownBranchEdge.id, message: "Conditional edges must identify a configured branch." })
      }
    } else if (nodeOutgoing.length !== 1) {
      issues.push({
        code: "OUTGOING_CONNECTION_COUNT",
        nodeId: node.id,
        message: "Every non-conditional node except End must have exactly one outgoing connection.",
      })
    } else if (nodeOutgoing[0]?.branchId) {
      issues.push({ code: "UNEXPECTED_BRANCH_EDGE", nodeId: node.id, edgeId: nodeOutgoing[0].id, message: "Only If / Else may use branch connections." })
    } else if (
      node.kind === "goTo" &&
      (nodeById.get(nodeOutgoing[0].target)?.position.y ?? Number.NEGATIVE_INFINITY) <=
        node.position.y
    ) {
      issues.push({
        code: "GO_TO_NOT_FORWARD",
        nodeId: node.id,
        edgeId: nodeOutgoing[0].id,
        message: "Go To must connect to an action positioned later in the workflow.",
      })
    }
  }

  const startId = startNodes[0]?.id
  const endId = endNodes[0]?.id
  const reachable = new Set<string>()
  if (startId) {
    const stack = [startId]
    while (stack.length) {
      const nodeId = stack.pop() as string
      if (reachable.has(nodeId)) continue
      reachable.add(nodeId)
      for (const edge of outgoing.get(nodeId) ?? []) stack.push(edge.target)
    }
  }
  for (const node of definition.nodes) {
    if (!reachable.has(node.id)) {
      issues.push({ code: "UNREACHABLE_NODE", nodeId: node.id, message: "This node is not reachable from Start." })
    }
  }

  const reachesEnd = new Set<string>()
  if (endId) {
    const stack = [endId]
    while (stack.length) {
      const nodeId = stack.pop() as string
      if (reachesEnd.has(nodeId)) continue
      reachesEnd.add(nodeId)
      for (const edge of incoming.get(nodeId) ?? []) stack.push(edge.source)
    }
  }
  for (const node of definition.nodes) {
    if (!reachesEnd.has(node.id)) {
      issues.push({ code: "DEAD_END", nodeId: node.id, message: "Every path must reach the shared End." })
    }
  }

  const colors = new Map<string, 0 | 1 | 2>()
  const visit = (nodeId: string): boolean => {
    const color = colors.get(nodeId) ?? 0
    if (color === 1) return true
    if (color === 2) return false
    colors.set(nodeId, 1)
    for (const edge of outgoing.get(nodeId) ?? []) {
      if (visit(edge.target)) return true
    }
    colors.set(nodeId, 2)
    return false
  }
  if (definition.nodes.some((node) => visit(node.id))) {
    issues.push({ code: "CYCLE", message: "Workflow loops are not allowed; Go To must move forward." })
  }

  const producerByKey = new Map<string, string>()
  for (const node of definition.nodes) {
    const outputKey = getNodeOutputKey(node)
    if (!outputKey) {
      if (["mathOperation", "numberFormatter", "dateTimeFormatter"].includes(node.kind)) {
        issues.push({ code: "OUTPUT_KEY_REQUIRED", nodeId: node.id, message: "Transformer actions need a workflow output name." })
      }
      continue
    }
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(outputKey)) {
      issues.push({ code: "INVALID_OUTPUT_KEY", nodeId: node.id, message: "Workflow output names must start with a letter and contain only letters, numbers, and underscores." })
    } else if (producerByKey.has(outputKey)) {
      issues.push({ code: "DUPLICATE_OUTPUT_KEY", nodeId: node.id, message: `Workflow output '${outputKey}' is already defined.` })
    } else {
      producerByKey.set(outputKey, node.id)
    }
  }

  if (!issues.some((issue) => issue.code === "CYCLE") && startId) {
    const allIds = new Set(definition.nodes.map((node) => node.id))
    const dominators = new Map<string, Set<string>>()
    for (const node of definition.nodes) {
      dominators.set(node.id, node.id === startId ? new Set([startId]) : new Set(allIds))
    }
    let changed = true
    while (changed) {
      changed = false
      for (const node of definition.nodes) {
        if (node.id === startId) continue
        const predecessors = (incoming.get(node.id) ?? []).map((edge) => edge.source)
        let next = predecessors.length ? new Set(dominators.get(predecessors[0]) ?? []) : new Set<string>()
        for (const predecessor of predecessors.slice(1)) {
          const predecessorDominators = dominators.get(predecessor) ?? new Set<string>()
          next = new Set([...next].filter((id) => predecessorDominators.has(id)))
        }
        next.add(node.id)
        const current = dominators.get(node.id) ?? new Set<string>()
        if (current.size !== next.size || [...current].some((id) => !next.has(id))) {
          dominators.set(node.id, next)
          changed = true
        }
      }
    }

    for (const node of definition.nodes) {
      const references = collectVariableReferences(node.data)
      for (const branch of getNodeBranches(node)) {
        for (const condition of branch.conditions) {
          if (condition.source === "variable" && condition.variableKey) references.add(condition.variableKey)
        }
      }
      for (const reference of references) {
        const producerId = producerByKey.get(reference)
        if (!producerId) {
          issues.push({ code: "UNKNOWN_VARIABLE", nodeId: node.id, message: `Workflow output '${reference}' does not exist.` })
        } else if (producerId === node.id || !dominators.get(node.id)?.has(producerId)) {
          issues.push({ code: "VARIABLE_NOT_GUARANTEED", nodeId: node.id, message: `Workflow output '${reference}' is not available on every path to this node.` })
        }
      }
    }
  }

  return issues.length
    ? { ok: false, definition, issues }
    : { ok: true, definition, issues: [] }
}

export function validateSensitiveCustomFieldConditions(
  definition: WorkflowDefinitionV2,
  fields: Array<{ id: string; key: string; isEncrypted: boolean; isSensitive: boolean }>,
) {
  const protectedIds = new Set(
    fields.filter((field) => field.isEncrypted || field.isSensitive).map((field) => field.id),
  )
  const protectedKeys = new Set(
    fields.filter((field) => field.isEncrypted || field.isSensitive).map((field) => field.key),
  )
  const issues: WorkflowValidationIssue[] = []
  for (const node of definition.nodes) {
    for (const branch of getNodeBranches(node)) {
      for (const condition of branch.conditions) {
        if (condition.source !== "customField") continue
        const isProtected =
          (condition.customFieldId ? protectedIds.has(condition.customFieldId) : false) ||
          (condition.fieldKey ? protectedKeys.has(condition.fieldKey) : false)
        const isPresenceCheck =
          condition.operator === "is_empty" || condition.operator === "is_not_empty"
        if (isProtected && !isPresenceCheck) {
          issues.push({
            code: "SENSITIVE_FIELD_OPERATOR",
            nodeId: node.id,
            branchId: branch.id,
            message: "Protected custom fields may only be checked with Is empty or Is not empty.",
          })
        }
      }
    }
  }
  return issues
}

type LegacyNode = {
  id?: unknown
  position?: unknown
  data?: unknown
}

type LegacyEdge = {
  id?: unknown
  source?: unknown
  target?: unknown
}

function legacyCondition(branch: Record<string, unknown>, index: number): WorkflowConditionV2 {
  const operator = typeof branch.operator === "string" ? branch.operator : "is_not_empty"
  return {
    id: typeof branch.id === "string" ? `${branch.id}-condition` : `condition-${index + 1}`,
    source:
      branch.source === "customField"
        ? "customField"
        : branch.source === "variable"
          ? "variable"
          : "contactInfo",
    fieldKey: typeof branch.fieldKey === "string" ? branch.fieldKey : undefined,
    variableKey: typeof branch.variableKey === "string" ? branch.variableKey : undefined,
    valueType:
      branch.valueType === "number" || branch.valueType === "dateTime" || branch.valueType === "boolean"
        ? branch.valueType
        : "string",
    operator: ["includes", "not_includes", "eq", "neq", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"].includes(operator)
      ? (operator as WorkflowConditionV2["operator"])
      : "is_not_empty",
    compareValue: branch.compareValue,
  }
}

export function convertLegacyWorkflowDefinition(
  rawNodes: unknown,
  rawEdges: unknown,
): WorkflowDefinitionV2 {
  const nodes: WorkflowNodeV2[] = (Array.isArray(rawNodes) ? rawNodes : []).flatMap<WorkflowNodeV2>(
    (item, index) => {
      const legacy = recordValue(item) as LegacyNode
      const id = typeof legacy.id === "string" && legacy.id.trim() ? legacy.id : `legacy-node-${index + 1}`
      const data = recordValue(legacy.data)
      const kind = FOLLOW_UP_NODE_KINDS.includes(data.kind as FollowUpNodeKind)
        ? (data.kind as FollowUpNodeKind)
        : null
      if (!kind || kind === "end") return kind === "end" ? [{ id, kind, label: "End", position: PositionSchema.catch({ x: 0, y: 0 }).parse(legacy.position), data: {} }] : []

      const nextData = { ...data }
      delete nextData.kind
      if (kind === "wait") {
        nextData.waitValue =
          typeof data.waitValue === "number" ? data.waitValue : Number(data.waitDays) || 0
        nextData.waitUnit =
          data.waitUnit === "hours" || data.waitUnit === "minutes" ? data.waitUnit : "days"
      }
      if (
        kind === "mathOperation" ||
        kind === "numberFormatter" ||
        kind === "dateTimeFormatter"
      ) {
        const configured = typeof data.outputKey === "string" ? data.outputKey.trim() : ""
        const generated = `${kind}_${id}`
          .replace(/[^A-Za-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")
        nextData.outputKey =
          configured || (/^[A-Za-z]/.test(generated) ? generated : `output_${generated}`)
      }
      if (kind === "ifElse") {
        const legacyBranches = Array.isArray(data.ifElseBranches) ? data.ifElseBranches : []
        nextData.branches = legacyBranches.map((branchValue, branchIndex) => {
          const branch = recordValue(branchValue)
          const isDefault = Boolean(branch.isDefault)
          return {
            id: typeof branch.id === "string" ? branch.id : `branch-${branchIndex + 1}`,
            name: typeof branch.name === "string" && branch.name.trim() ? branch.name.trim() : isDefault ? "Default" : `Branch ${branchIndex + 1}`,
            isDefault,
            matchMode: "ALL",
            conditions: isDefault ? [] : [legacyCondition(branch, branchIndex)],
          }
        })
        delete nextData.ifElseBranches
      }
      delete nextData.goToNodeId
      return [{
        id,
        kind,
        label: typeof data.label === "string" ? data.label : kind === "start" ? "Start" : "",
        position: PositionSchema.catch({ x: 0, y: index * 130 }).parse(legacy.position),
        data: nextData,
      }]
    },
  )

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  let edges: WorkflowEdgeV2[] = (Array.isArray(rawEdges) ? rawEdges : []).flatMap(
    (item, index) => {
      const edge = recordValue(item) as LegacyEdge
      if (typeof edge.source !== "string" || typeof edge.target !== "string") return []
      if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) return []
      if (nodeById.get(edge.source)?.kind === "ifElse") return []
      return [{
        id: typeof edge.id === "string" ? edge.id : `legacy-edge-${index + 1}`,
        source: edge.source,
        target: edge.target,
      }]
    },
  )

  for (const item of Array.isArray(rawNodes) ? rawNodes : []) {
    const legacy = recordValue(item)
    const id = typeof legacy.id === "string" ? legacy.id : null
    const data = recordValue(legacy.data)
    if (!id || !nodeById.has(id)) continue
    if (data.kind === "ifElse") {
      for (const branchValue of Array.isArray(data.ifElseBranches) ? data.ifElseBranches : []) {
        const branch = recordValue(branchValue)
        if (typeof branch.id !== "string" || typeof branch.targetNodeId !== "string") continue
        if (!nodeById.has(branch.targetNodeId)) continue
        edges.push({ id: `edge-${id}-${branch.id}-${branch.targetNodeId}`, source: id, target: branch.targetNodeId, branchId: branch.id })
      }
    }
    if (data.kind === "goTo" && typeof data.goToNodeId === "string" && nodeById.has(data.goToNodeId)) {
      edges = edges.filter((edge) => edge.source !== id)
      edges.push({ id: `edge-${id}-${data.goToNodeId}`, source: id, target: data.goToNodeId })
    }
  }

  if (!nodes.some((node) => node.kind === "end")) {
    const maxY = nodes.reduce((max, node) => Math.max(max, node.position.y), 0)
    nodes.push({ id: "end-v2", kind: "end", label: "End", position: { x: 440, y: maxY + 180 }, data: {} })
  }
  const endId = nodes.find((node) => node.kind === "end")?.id
  if (endId) {
    const outgoingIds = new Set(edges.map((edge) => edge.source))
    for (const node of nodes) {
      if (node.kind === "end" || node.kind === "ifElse" || outgoingIds.has(node.id)) continue
      edges.push({ id: `edge-${node.id}-${endId}`, source: node.id, target: endId })
    }
  }

  return { schemaVersion: FOLLOW_UP_DEFINITION_SCHEMA_VERSION, nodes, edges }
}

export function getDraftWorkflowDefinition(template: {
  draftDefinition?: unknown
  flowNodes?: unknown
  flowEdges?: unknown
}) {
  const parsed = WorkflowDefinitionV2Schema.safeParse(template.draftDefinition)
  return parsed.success
    ? parsed.data
    : convertLegacyWorkflowDefinition(template.flowNodes, template.flowEdges)
}

export function workflowDefinitionToLegacyCanvas(definitionValue: unknown) {
  const definition = WorkflowDefinitionV2Schema.parse(definitionValue)
  const nodeById = new Map(definition.nodes.map((node) => [node.id, node]))
  const nodes = definition.nodes
    .filter((node) => node.kind !== "end")
    .map((node) => {
      const data = { ...recordValue(node.data) }
      if (node.kind === "ifElse") {
        const branches = getNodeBranches(node)
        data.ifElseBranches = branches.map((branch) => {
          const firstCondition = branch.conditions[0]
          const targetNodeId = definition.edges.find(
            (edge) => edge.source === node.id && edge.branchId === branch.id,
          )?.target
          return {
            id: branch.id,
            name: branch.name,
            isDefault: branch.isDefault,
            matchMode: branch.matchMode,
            conditions: branch.conditions.slice(1),
            source:
              firstCondition?.source === "variable"
                ? "variable"
                : firstCondition?.source === "customField"
                  ? "customField"
                  : firstCondition?.fieldKey === "currentDateTime"
                    ? "dateTime"
                    : "contactInfo",
            fieldKey:
              firstCondition?.source === "variable"
                ? firstCondition.variableKey ?? ""
                : firstCondition?.fieldKey ?? "",
            valueType: firstCondition?.valueType ?? "string",
            operator: firstCondition?.operator ?? "is_not_empty",
            compareValue:
              typeof firstCondition?.compareValue === "string" ||
              typeof firstCondition?.compareValue === "number"
                ? String(firstCondition.compareValue)
                : "",
            targetNodeId: targetNodeId && nodeById.get(targetNodeId)?.kind !== "end" ? targetNodeId : null,
          }
        })
        delete data.branches
      }
      if (node.kind === "goTo") {
        const target = definition.edges.find((edge) => edge.source === node.id)?.target
        data.goToNodeId = target && nodeById.get(target)?.kind !== "end" ? target : ""
      }
      return {
        id: node.id,
        type: "stepNode",
        position: node.position,
        data: { ...data, kind: node.kind, label: node.label },
      }
    })
  const visibleNodeIds = new Set(nodes.map((node) => node.id))
  const edges = definition.edges
    .filter((edge) => !edge.branchId)
    .filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
    .filter((edge) => nodeById.get(edge.source)?.kind !== "goTo")
    .map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, type: "smoothstep" }))
  return { nodes, edges }
}
