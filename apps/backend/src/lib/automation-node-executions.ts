export type AutomationNodeLogStatus = "QUEUED" | "EXECUTED" | "SKIPPED" | "FAILED" | "WAITING"
export type AutomationNodeEventSource =
  | "MANUAL_ENROLLMENT"
  | "OPPORTUNITY_CREATED"
  | "OPPORTUNITY_STAGE_CHANGED"
  | "AUTOMATION_ACTION"

export type AutomationNodeLogData = {
  id?: string
  tenantId: string
  automationId: string | null
  automationName: string
  contactId: string | null
  contactName: string
  actorUserId: string | null
  processId: string | null
  opportunityId: string | null
  attemptId: string
  eventSource: AutomationNodeEventSource
  nodeKind: "TRIGGER" | "ACTION"
  nodeOrder: number
  nodeKey: string
  nodeLabel: string
  status: AutomationNodeLogStatus
  reasonCode: string | null
  details: string | null
  branchPath?: Array<{ nodeKey: string; branchKey: string; branchName: string }> | null
  occurredAt: Date
}

const ACTION_LABELS: Record<string, string> = {
  UPDATE_CONTACT_CUSTOM_FIELDS: "Update contact fields",
  SET_CONTACT_CUSTOM_FIELD: "Set contact custom field",
  CLEAR_CONTACT_CUSTOM_FIELD: "Clear contact custom field",
  SET_CONTACT_STATUS: "Set contact status",
  SET_CONTACT_ASSIGNEE: "Set contact assignee",
  CLEAR_CONTACT_ASSIGNEE: "Clear contact assignee",
  ADD_CONTACT_TAG: "Add contact tag",
  REMOVE_CONTACT_TAG: "Remove contact tag",
  ADD_CONTACT_NOTE: "Add contact note",
  CREATE_TASK: "Create task",
  FORMAT_DATE_TIME: "Date/Time formatter",
  FORMAT_NUMBER: "Number formatter",
  FORMAT_TEXT: "Text formatter",
  MATH_OPERATION: "Math operation",
  IF_ELSE: "If/Else",
  SPLIT: "Split",
  GO_TO: "Go to",
  UPDATE_OPPORTUNITY: "Update/create opportunity",
  DELETE_OPPORTUNITY: "Delete opportunity",
  ADD_TO_WORKFLOW: "Add to workflow",
  REMOVE_FROM_WORKFLOW: "Remove from workflow",
  WAIT: "Wait",
  DELETE_CONTACT: "Delete contact",
}

export function getAutomationActionLabel(actionType: string) {
  return ACTION_LABELS[actionType] ?? "Automation action"
}

export function getAutomationActionNodeLabel(action: {
  type?: string | null
  textFormatterConfig?: unknown
  ifElseConfig?: unknown
  splitConfig?: unknown
  opportunityConfig?: unknown
  deleteOpportunityConfig?: unknown
  addToWorkflowConfig?: unknown
  removeFromWorkflowConfig?: unknown
}) {
  if (action.type === "FORMAT_TEXT") {
    const config = action.textFormatterConfig && typeof action.textFormatterConfig === "object"
      ? action.textFormatterConfig as Record<string, unknown>
      : null
    const actionName = typeof config?.actionName === "string" ? config.actionName.trim() : ""
    if (actionName) return actionName.slice(0, 120)
  }
  if (action.type === "IF_ELSE") {
    const config = action.ifElseConfig && typeof action.ifElseConfig === "object"
      ? action.ifElseConfig as Record<string, unknown>
      : null
    const actionName = typeof config?.actionName === "string" ? config.actionName.trim() : ""
    if (actionName) return actionName.slice(0, 120)
  }
  if (action.type === "SPLIT") {
    const config = action.splitConfig && typeof action.splitConfig === "object"
      ? action.splitConfig as Record<string, unknown>
      : null
    const actionName = typeof config?.actionName === "string" ? config.actionName.trim() : ""
    if (actionName) return actionName.slice(0, 120)
  }
  if (action.type === "UPDATE_OPPORTUNITY") {
    const config = action.opportunityConfig && typeof action.opportunityConfig === "object"
      ? action.opportunityConfig as Record<string, unknown>
      : null
    const actionName = typeof config?.actionName === "string" ? config.actionName.trim() : ""
    if (actionName) return actionName.slice(0, 120)
  }
  if (action.type === "DELETE_OPPORTUNITY") {
    const config = action.deleteOpportunityConfig && typeof action.deleteOpportunityConfig === "object"
      ? action.deleteOpportunityConfig as Record<string, unknown>
      : null
    const actionName = typeof config?.actionName === "string" ? config.actionName.trim() : ""
    if (actionName) return actionName.slice(0, 120)
  }
  if (action.type === "ADD_TO_WORKFLOW") {
    const config = action.addToWorkflowConfig && typeof action.addToWorkflowConfig === "object"
      ? action.addToWorkflowConfig as Record<string, unknown>
      : null
    const actionName = typeof config?.actionName === "string" ? config.actionName.trim() : ""
    if (actionName) return actionName.slice(0, 120)
  }
  if (action.type === "REMOVE_FROM_WORKFLOW") {
    const config = action.removeFromWorkflowConfig && typeof action.removeFromWorkflowConfig === "object"
      ? action.removeFromWorkflowConfig as Record<string, unknown>
      : null
    const actionName = typeof config?.actionName === "string" ? config.actionName.trim() : ""
    if (actionName) return actionName.slice(0, 120)
  }
  return getAutomationActionLabel(action.type ?? "")
}

export function getAutomationTriggerLabel(triggerType: string) {
  return triggerType === "OPPORTUNITY_STAGE_CHANGED"
    ? "Opportunity enters stage"
    : "Opportunity created"
}

export function getContactDisplayName(contact: {
  firstName?: string | null
  middleName?: string | null
  lastName?: string | null
}) {
  return [contact.firstName, contact.middleName, contact.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ") || "Unnamed contact"
}
