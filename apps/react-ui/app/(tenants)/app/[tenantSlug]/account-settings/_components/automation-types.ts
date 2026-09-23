export type AutomationTriggerType = "OPPORTUNITY_CREATED" | "OPPORTUNITY_STAGE_CHANGED"
export type AutomationOperator =
  | "EQUALS"
  | "NOT_EQUALS"
  | "CONTAINS"
  | "NOT_CONTAINS"
  | "GREATER_THAN"
  | "GREATER_THAN_OR_EQUAL"
  | "LESS_THAN"
  | "LESS_THAN_OR_EQUAL"
  | "BETWEEN"
  | "INCLUDES_ANY"
  | "INCLUDES_ALL"
  | "EXCLUDES_ALL"
  | "IS_TRUE"
  | "IS_FALSE"
  | "IS_EMPTY"
  | "IS_NOT_EMPTY"

export type AutomationCondition = {
  id?: string
  source:
    | "OPPORTUNITY_VALUE"
    | "CONTACT_STATUS"
    | "CONTACT_CUSTOM_FIELD"
    | "CONTACT_ASSIGNEE"
    | "CONTACT_TAGS"
  operator: AutomationOperator
  customFieldId?: string | null
  statusConfigId?: string | null
  assignedUserId?: string | null
  tagId?: string | null
  compareValue?: unknown
}

export type AutomationAction = {
  id?: string
  type:
    | "SET_CONTACT_CUSTOM_FIELD"
    | "CLEAR_CONTACT_CUSTOM_FIELD"
    | "SET_CONTACT_STATUS"
    | "SET_CONTACT_ASSIGNEE"
    | "CLEAR_CONTACT_ASSIGNEE"
    | "ADD_CONTACT_TAG"
    | "REMOVE_CONTACT_TAG"
  customFieldId?: string | null
  statusConfigId?: string | null
  assignedUserId?: string | null
  tagId?: string | null
  value?: unknown
}

export type AutomationRecord = {
  id: string
  name: string
  isEnabled: boolean
  sortOrder: number
  trigger:
    | { type: "OPPORTUNITY_CREATED"; pipelineId: string }
    | {
        type: "OPPORTUNITY_STAGE_CHANGED"
        pipelineId: string
        targetStageId: string
      }
  conditions: AutomationCondition[]
  actions: AutomationAction[]
  lastExecution: {
    id: string
    status: "SUCCEEDED" | "FAILED"
    createdAt: string
    errorMessage: string | null
  } | null
  createdAt: string
  updatedAt: string
}

export type AutomationCatalog = {
  pipelines: Array<{
    id: string
    name: string
    color: string
    stages: Array<{ id: string; name: string }>
  }>
  customFields: Array<{
    id: string
    label: string
    fieldType:
      | "TEXT"
      | "NUMBER"
      | "PHONE"
      | "CURRENCY"
      | "DATE"
      | "SELECT"
      | "MULTI_SELECT"
      | "RADIO"
      | "TEXTAREA"
      | "CHECKBOX"
    isRequired: boolean
    options: string[]
    operators: AutomationOperator[]
  }>
  statuses: Array<{ id: string; name: string; bgColor: string; textColor: string }>
  tags: Array<{ id: string; name: string; bgColor: string; textColor: string }>
  users: Array<{ id: string; name: string; email: string }>
}

export type AutomationExecution = {
  id: string
  automationId: string | null
  automationName: string
  processId: string | null
  processName: string | null
  triggerType: AutomationTriggerType
  status: "SUCCEEDED" | "FAILED"
  actionCount: number
  errorMessage: string | null
  createdAt: string
}

export type AutomationNodeExecutionStatus = "EXECUTED" | "SKIPPED" | "FAILED"

export type AutomationNodeExecution = {
  id: string
  attemptId: string
  eventSource: "MANUAL_ENROLLMENT" | "OPPORTUNITY_CREATED" | "OPPORTUNITY_STAGE_CHANGED"
  contact: {
    id: string | null
    name: string
  }
  node: {
    kind: "TRIGGER" | "ACTION"
    key: string
    label: string
    index: number | null
  }
  status: AutomationNodeExecutionStatus
  details: string | null
  occurredAt: string
}

export type AutomationContact = {
  contact: {
    id: string
    name: string
    email: string | null
    phoneNumber: string | null
  }
  firstEnteredAt: string
  lastExecutedAt: string | null
  executionCount: number
  lastStatus: "SUCCEEDED" | "FAILED" | null
}
