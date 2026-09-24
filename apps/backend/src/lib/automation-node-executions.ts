export type AutomationNodeLogStatus = "EXECUTED" | "SKIPPED" | "FAILED" | "WAITING"
export type AutomationNodeEventSource =
  | "MANUAL_ENROLLMENT"
  | "OPPORTUNITY_CREATED"
  | "OPPORTUNITY_STAGE_CHANGED"

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
  occurredAt: Date
}

const ACTION_LABELS: Record<string, string> = {
  SET_CONTACT_CUSTOM_FIELD: "Set contact custom field",
  CLEAR_CONTACT_CUSTOM_FIELD: "Clear contact custom field",
  SET_CONTACT_STATUS: "Set contact status",
  SET_CONTACT_ASSIGNEE: "Set contact assignee",
  CLEAR_CONTACT_ASSIGNEE: "Clear contact assignee",
  ADD_CONTACT_TAG: "Add contact tag",
  REMOVE_CONTACT_TAG: "Remove contact tag",
  ADD_CONTACT_NOTE: "Add contact note",
  WAIT: "Wait",
}

export function getAutomationActionLabel(actionType: string) {
  return ACTION_LABELS[actionType] ?? "Automation action"
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
