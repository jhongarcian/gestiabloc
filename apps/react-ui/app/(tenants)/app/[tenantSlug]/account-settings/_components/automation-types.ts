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

export type AutomationWaitUnit = "SECONDS" | "MINUTES" | "HOURS" | "DAYS"

export type ContactTemplateFieldType =
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

export type ContactTemplateField = {
  key: string
  label: string
  fieldType: ContactTemplateFieldType
}

export type ContactTemplateFormatOption = {
  value: string
  label: string
  preview: string
}

export type AutomationWaitConfig =
  | {
      mode: "DURATION"
      amount: number
      unit: AutomationWaitUnit
    }
  | {
      mode: "FIXED_DATE"
      dateTime: string
      timing: "ON" | "BEFORE" | "AFTER"
      offsetAmount?: number
      offsetUnit?: AutomationWaitUnit
      pastBehavior: "CONTINUE" | "EXIT" | "GO_TO_STEP"
      targetNodeKey?: string
    }

export type AutomationDateSource =
  | { type: "CURRENT_DATE" }
  | { type: "RELATIVE_DATE"; amount: number; unit: "DAYS" | "WEEKS" | "MONTHS" }
  | { type: "CONTACT_FIELD"; key: string }
  | { type: "CUSTOM_FIELD"; key: string }
  | { type: "SPECIFIC_DATE"; date: string; timezone: string }

export type AutomationFormatterDateSource =
  | AutomationDateSource
  | { type: "AUTOMATION_VALUE"; key: string }

export type AutomationTaskDateTime = {
  source: AutomationDateSource
  time: string
}

export type AutomationDateTimeFormatterConfig =
  | {
      mode: "DATE"
      source: AutomationFormatterDateSource
      format: string
      outputKey: string
    }
  | {
      mode: "DATE_TIME"
      source: AutomationFormatterDateSource
      format: string
      time?: string
      outputKey: string
    }
  | {
      mode: "COMPARE_DATES"
      from: AutomationFormatterDateSource
      to: AutomationFormatterDateSource
      unit: "DAYS" | "MONTHS" | "YEARS"
      outputKey: string
    }

export type AutomationNumberSource =
  | { type: "CONTACT_FIELD"; key: string }
  | { type: "CUSTOM_FIELD"; key: string }
  | { type: "AUTOMATION_VALUE"; key: string }

export type AutomationNumberFormatterConfig =
  | {
      mode: "TEXT_TO_NUMBER"
      source: AutomationNumberSource
      decimalMark: "PERIOD" | "COMMA"
      outputKey: string
    }

  | {
      mode: "FORMAT_NUMBER"
      source: AutomationNumberSource
      decimalMark: "PERIOD" | "COMMA"
      groupingStyle: "COMMA_PERIOD" | "PERIOD_COMMA" | "SPACE_COMMA" | "SPACE_PERIOD"
      outputKey: string
    }
  | {
      mode: "FORMAT_CURRENCY"
      source: AutomationNumberSource
      decimalMark: "PERIOD" | "COMMA"
      currencyCode: string
      outputKey: string
    }
  | {
      mode: "FORMAT_PHONE_NUMBER"
      source: AutomationNumberSource
      countryCode: string
      phoneFormat:
        | "E164"
        | "INTERNATIONAL"
        | "INTERNATIONAL_NO_COUNTRY_CODE"
        | "INTERNATIONAL_NO_HYPHENS"
        | "INTERNATIONAL_NO_SYMBOLS"
        | "NATIONAL"
        | "NATIONAL_NO_PARENTHESIS"
        | "NATIONAL_NO_SYMBOLS"
        | "RFC3966"
        | "RFC3966_NO_TEL"
      outputKey: string
    }
  | {
      mode: "RANDOM_NUMBER"
      min: number
      max: number
      outputKey: string
    }

export type AutomationTextSource =
  | { type: "CONTACT_FIELD"; key: string }
  | { type: "CUSTOM_FIELD"; key: string }
  | { type: "AUTOMATION_VALUE"; key: string }

type AutomationTextFormatterCommon = {
  actionName: string
  source: AutomationTextSource
  outputKey: string
}

export type AutomationTextFormatterConfig =
  | (AutomationTextFormatterCommon & {
      mode:
        | "UPPER_CASE"
        | "LOWER_CASE"
        | "TITLE_CASE"
        | "CAPITALIZE"
        | "TRIM_WHITESPACE"
        | "WORD_COUNT"
        | "LENGTH"
        | "EXTRACT_EMAIL"
        | "EXTRACT_URL"
    })
  | (AutomationTextFormatterCommon & { mode: "DEFAULT_VALUE"; defaultValue: string })
  | (AutomationTextFormatterCommon & { mode: "TRIM"; maxLength: number })
  | (AutomationTextFormatterCommon & {
      mode: "REPLACE_TEXT"
      searchText: string
      replacementText: string
    })
  | (AutomationTextFormatterCommon & { mode: "FIND"; searchText: string })
  | (AutomationTextFormatterCommon & {
      mode: "SPLIT_TEXT"
      separator: string
      segment: number
    })

export type AutomationMathDateSource =
  | { type: "CONTACT_FIELD"; key: string }
  | { type: "CUSTOM_FIELD"; key: string }
  | { type: "AUTOMATION_VALUE"; key: string }

export type AutomationMathOperationConfig =
  | {
      mode: "NUMBER"
      source: AutomationNumberSource
      operation: "ADD" | "SUBTRACT" | "MULTIPLY" | "DIVIDE"
      operand: number
      outputKey: string
    }
  | {
      mode: "DATE"
      source: AutomationMathDateSource
      operation: "ADD" | "SUBTRACT"
      amount: number
      unit: "DAYS" | "MONTHS" | "YEARS"
      outputKey: string
    }

export type AutomationValueDefinition = {
  key: string
  label: string
  valueKind: "NUMBER" | "DATE" | "NUMERIC_TEXT" | "PHONE" | "TEXT"
}

export type AutomationTaskConfig = {
  nameTemplate: string
  descriptionTemplate?: string | null
  statusConfigId: string
  assignee:
    | { mode: "UNASSIGNED" }
    | { mode: "CONTACT_ASSIGNEE" }
    | { mode: "SPECIFIC_USER"; userId: string }
  linkedService?: { id: string; nameSnapshot: string } | null
  dueAt?: AutomationTaskDateTime | null
  reminder?: {
    at: AutomationTaskDateTime
    messageTemplate?: string | null
  } | null
}

export type AutomationFieldUpdate =
  | { customFieldId: string; operation: "SET"; value: unknown }
  | { customFieldId: string; operation: "CLEAR" }
  | { contactFieldKey: string; operation: "SET"; value: unknown }
  | { contactFieldKey: string; operation: "CLEAR" }

export type AutomationBranchCondition = {
  conditionKey?: string
  source:
    | "CONTACT_FIELD"
    | "CONTACT_CUSTOM_FIELD"
    | "CONTACT_STATUS"
    | "CONTACT_ASSIGNEE"
    | "CONTACT_TAGS"
    | "AUTOMATION_VALUE"
    | "CURRENT_DATE_TIME"
    | "OPPORTUNITY_FIELD"
  operator: AutomationOperator
  fieldKey?: string
  customFieldId?: string
  statusConfigId?: string | null
  assignedUserId?: string | null
  tagId?: string | null
  key?: string
  field?: "VALUE" | "PIPELINE" | "PREVIOUS_STAGE" | "CURRENT_STAGE"
  compareValue?: unknown
}

export type AutomationIfElseBranch = {
  branchKey?: string
  name: string
  isDefault: boolean
  matchMode: "ALL" | "ANY"
  conditions: AutomationBranchCondition[]
  actions: AutomationAction[]
}

export type AutomationIfElseConfig = {
  actionName: string
  branches: AutomationIfElseBranch[]
}

export type AutomationSplitRoute = {
  branchKey: string
  name: string
  percentage: number
  actions: AutomationAction[]
}

export type AutomationSplitConfig = {
  actionName: string
  routes: AutomationSplitRoute[]
}

export type AutomationGoToConfig = {
  targetNodeKey: string
}

export type AutomationOpportunityConfig = {
  actionName: string
  pipelineId: string
  pipelineNameSnapshot: string
  stageId: string
  stageNameSnapshot: string
  resultMode: "KEEP_CURRENT" | "OPEN" | "WON" | "LOST"
  valueCents: number | null
}

export type AutomationAction = {
  id?: string
  nodeKey?: string
  type:
    | "UPDATE_CONTACT_CUSTOM_FIELDS"
    | "SET_CONTACT_STATUS"
    | "SET_CONTACT_ASSIGNEE"
    | "CLEAR_CONTACT_ASSIGNEE"
    | "ADD_CONTACT_TAG"
    | "REMOVE_CONTACT_TAG"
    | "ADD_CONTACT_NOTE"
    | "CREATE_TASK"
    | "FORMAT_DATE_TIME"
    | "FORMAT_NUMBER"
    | "FORMAT_TEXT"
    | "MATH_OPERATION"
    | "IF_ELSE"
    | "SPLIT"
    | "GO_TO"
    | "UPDATE_OPPORTUNITY"
    | "WAIT"
    | "DELETE_CONTACT"
  customFieldUpdates?: AutomationFieldUpdate[] | null
  statusConfigId?: string | null
  assignedUserId?: string | null
  tagId?: string | null
  waitConfig?: AutomationWaitConfig | null
  noteTitle?: string | null
  noteBody?: string | null
  taskConfig?: AutomationTaskConfig | null
  dateTimeFormatterConfig?: AutomationDateTimeFormatterConfig | null
  numberFormatterConfig?: AutomationNumberFormatterConfig | null
  textFormatterConfig?: AutomationTextFormatterConfig | null
  mathOperationConfig?: AutomationMathOperationConfig | null
  ifElseConfig?: AutomationIfElseConfig | null
  splitConfig?: AutomationSplitConfig | null
  goToConfig?: AutomationGoToConfig | null
  opportunityConfig?: AutomationOpportunityConfig | null
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
    status: "SUCCEEDED" | "FAILED" | "EXITED"
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
    key: string
    label: string
    fieldType: ContactTemplateFieldType
    isRequired: boolean
    options: string[]
    operators: AutomationOperator[]
  }>
  contactUpdateFields: Array<{
    key: string
    label: string
    fieldType: "TEXT" | "EMAIL" | "PHONE" | "DATE" | "SELECT" | "CHECKBOX"
    isRequired: boolean
    maxLength: number
    options: string[]
  }>
  templateFields: {
    contact: ContactTemplateField[]
    dateFormats: ContactTemplateFormatOption[]
    phoneFormats: ContactTemplateFormatOption[]
  }
  branchConditions: {
    sources: AutomationBranchCondition["source"][]
    operators: AutomationOperator[]
  }
  statuses: Array<{ id: string; name: string; bgColor: string; textColor: string }>
  taskStatuses: Array<{
    id: string
    name: string
    bgColor: string
    textColor: string
    isSystemDefault: boolean
  }>
  tags: Array<{ id: string; name: string; bgColor: string; textColor: string }>
  services: Array<{ id: string; name: string }>
  users: Array<{ id: string; name: string; email: string }>
}

export type AutomationExecution = {
  id: string
  automationId: string | null
  automationName: string
  processId: string | null
  processName: string | null
  triggerType: AutomationTriggerType
  status: "SUCCEEDED" | "FAILED" | "EXITED"
  actionCount: number
  errorMessage: string | null
  createdAt: string
}

export type AutomationNodeExecutionStatus = "QUEUED" | "EXECUTED" | "SKIPPED" | "FAILED" | "WAITING"

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
    branchPath: Array<{ nodeKey: string; branchKey: string; branchName: string }>
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
  lastStatus: "SUCCEEDED" | "FAILED" | "EXITED" | null
}

export type AutomationWaitNodeCount = {
  nodeKey: string
  count: number
}

export type AutomationWaitingRun = {
  runId: string
  contact: {
    id: string | null
    name: string
    phoneNumber: string | null
  }
  enteredAt: string
  nextActionAt: string | null
}
