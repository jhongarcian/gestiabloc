import { createHash, randomUUID } from "node:crypto"

import { z } from "zod"

import {
  getAutomationActionNodeLabel,
  getAutomationTriggerLabel,
  getContactDisplayName,
  type AutomationNodeEventSource,
  type AutomationNodeLogData,
} from "./automation-node-executions.js"
import { AutomationNodeKeySchema } from "./automation-node-key.js"
import {
  AutomationCreateContactConfigSchema,
  createContactAutomationValueIsCompatible,
  createContactSourceFieldIsCompatible,
  createContactUsesTemplate,
  type AutomationCreateContactConfig,
  type AutomationCreateContactTypedSource,
  type AutomationCreateContactValueSource,
} from "./automation-create-contact.js"
import { normalizeCustomFieldValue } from "./contact-custom-field-values.js"
import {
  parseContactTemplate,
  renderContactNoteTemplates,
  renderContactTemplates,
  CONTACT_TEMPLATE_REGULAR_FIELDS,
  isValidTemplateDate,
  validateContactTemplate,
  createContactTemplateExecutionContext,
  resolveSafeContactTemplateFieldValue,
  type ContactTemplateExecutionContext,
} from "./contact-templates.js"
import {
  AutomationTaskConfigSchema,
  resolveAutomationTaskDateTime,
  sanitizeTaskMultiline,
  sanitizeTaskSingleLine,
  type AutomationTaskConfig,
} from "./automation-task.js"
import {
  AutomationDateTimeFormatterConfigSchema,
  resolveAutomationDateTimeFormatter,
  type AutomationFormatterDateSource,
} from "./automation-date-time-formatter.js"
import {
  AutomationMathOperationConfigSchema,
  mathOperationAcceptsFieldType,
  resolveAutomationMathOperation,
  type AutomationMathOperationConfig,
} from "./automation-math-operation.js"
import {
  AutomationNumberFormatterConfigSchema,
  numberFormatterAcceptsFieldType,
  numberFormatterAcceptsValueKind,
  numberFormatterOutputKind,
  resolveAutomationNumberFormatter,
  type AutomationNumberSource,
  type AutomationValueKind,
} from "./automation-number-formatter.js"
import {
  AutomationTextFormatterConfigSchema,
  resolveAutomationTextFormatter,
  textFormatterAcceptsFieldType,
  textFormatterAcceptsValueKind,
  textFormatterOutputKind,
  type AutomationTextSource,
} from "./automation-text-formatter.js"
import { NoteBodyInputSchema, NoteTitleInputSchema } from "./note-inputs.js"
import { deletePrivateObject } from "./private-storage.js"
import { emitNotificationCreated, type RealtimeNotificationPayload } from "./realtime.js"
import { getTaskPriorityFromDueDate, isCompletedStatusName } from "./task-priority-values.js"
import { evaluateWorkflowOperator } from "./service-followup-runtime.js"

export const AUTOMATION_TRIGGER_TYPES = [
  "OPPORTUNITY_CREATED",
  "OPPORTUNITY_STAGE_CHANGED",
] as const

export const AUTOMATION_OPERATORS = [
  "EQUALS",
  "NOT_EQUALS",
  "CONTAINS",
  "NOT_CONTAINS",
  "GREATER_THAN",
  "GREATER_THAN_OR_EQUAL",
  "LESS_THAN",
  "LESS_THAN_OR_EQUAL",
  "BETWEEN",
  "INCLUDES_ANY",
  "INCLUDES_ALL",
  "EXCLUDES_ALL",
  "IS_TRUE",
  "IS_FALSE",
  "IS_EMPTY",
  "IS_NOT_EMPTY",
] as const

export const AUTOMATION_ACTION_TYPES = [
  "UPDATE_CONTACT_CUSTOM_FIELDS",
  "SET_CONTACT_CUSTOM_FIELD",
  "CLEAR_CONTACT_CUSTOM_FIELD",
  "SET_CONTACT_STATUS",
  "SET_CONTACT_ASSIGNEE",
  "CLEAR_CONTACT_ASSIGNEE",
  "ADD_CONTACT_TAG",
  "REMOVE_CONTACT_TAG",
  "ADD_CONTACT_NOTE",
  "CREATE_CONTACT",
  "CREATE_TASK",
  "FORMAT_DATE_TIME",
  "FORMAT_NUMBER",
  "FORMAT_TEXT",
  "MATH_OPERATION",
  "IF_ELSE",
  "SPLIT",
  "GO_TO",
  "ADD_TO_WORKFLOW",
  "REMOVE_FROM_WORKFLOW",
  "UPDATE_OPPORTUNITY",
  "DELETE_OPPORTUNITY",
  "WAIT",
  "DELETE_CONTACT",
] as const

export const MAX_AUTOMATION_ACTION_NODES = 100

export const AUTOMATION_WAIT_UNITS = ["SECONDS", "MINUTES", "HOURS", "DAYS"] as const

export const AUTOMATION_CONTACT_UPDATE_FIELDS = [
  { key: "firstName", label: "First name", fieldType: "TEXT", isRequired: true, maxLength: 120, options: [] },
  { key: "middleName", label: "Middle name", fieldType: "TEXT", isRequired: false, maxLength: 120, options: [] },
  { key: "lastName", label: "Last name", fieldType: "TEXT", isRequired: true, maxLength: 120, options: [] },
  { key: "phone", label: "Phone", fieldType: "PHONE", isRequired: false, maxLength: 60, options: [] },
  { key: "secondaryPhone", label: "Secondary phone", fieldType: "PHONE", isRequired: false, maxLength: 60, options: [] },
  { key: "email", label: "Email", fieldType: "EMAIL", isRequired: false, maxLength: 320, options: [] },
  { key: "dateOfBirth", label: "Date of birth", fieldType: "DATE", isRequired: false, maxLength: 10, options: [] },
  { key: "gender", label: "Gender", fieldType: "SELECT", isRequired: false, maxLength: 20, options: ["FEMALE", "MALE", "NON_BINARY", "OTHER", "UNKNOWN"] },
  { key: "height", label: "Height", fieldType: "TEXT", isRequired: false, maxLength: 60, options: [] },
  { key: "weight", label: "Weight", fieldType: "TEXT", isRequired: false, maxLength: 60, options: [] },
  { key: "deceasedAt", label: "Deceased date", fieldType: "DATE", isRequired: false, maxLength: 10, options: [] },
  { key: "medicarePartA", label: "Medicare Part A", fieldType: "CHECKBOX", isRequired: false, maxLength: 0, options: [] },
  { key: "medicarePartB", label: "Medicare Part B", fieldType: "CHECKBOX", isRequired: false, maxLength: 0, options: [] },
  { key: "smokerStatus", label: "Smoker status", fieldType: "SELECT", isRequired: false, maxLength: 20, options: ["UNKNOWN", "NEVER", "CURRENT", "FORMER"] },
  { key: "addressLine1", label: "Address line 1", fieldType: "TEXT", isRequired: false, maxLength: 255, options: [] },
  { key: "addressLine2", label: "Address line 2", fieldType: "TEXT", isRequired: false, maxLength: 255, options: [] },
  { key: "city", label: "City", fieldType: "TEXT", isRequired: false, maxLength: 120, options: [] },
  { key: "state", label: "State", fieldType: "TEXT", isRequired: false, maxLength: 120, options: [] },
  { key: "postalCode", label: "Postal code", fieldType: "TEXT", isRequired: false, maxLength: 40, options: [] },
  { key: "country", label: "Country", fieldType: "TEXT", isRequired: false, maxLength: 120, options: [] },
  { key: "mailingAddressLine1", label: "Mailing address line 1", fieldType: "TEXT", isRequired: false, maxLength: 255, options: [] },
  { key: "mailingAddressLine2", label: "Mailing address line 2", fieldType: "TEXT", isRequired: false, maxLength: 255, options: [] },
  { key: "mailingCity", label: "Mailing city", fieldType: "TEXT", isRequired: false, maxLength: 120, options: [] },
  { key: "mailingState", label: "Mailing state", fieldType: "TEXT", isRequired: false, maxLength: 120, options: [] },
  { key: "mailingPostalCode", label: "Mailing postal code", fieldType: "TEXT", isRequired: false, maxLength: 40, options: [] },
  { key: "mailingCountry", label: "Mailing country", fieldType: "TEXT", isRequired: false, maxLength: 120, options: [] },
  { key: "emergencyContactName", label: "Emergency contact name", fieldType: "TEXT", isRequired: false, maxLength: 160, options: [] },
  { key: "emergencyContactPhone", label: "Emergency contact phone", fieldType: "PHONE", isRequired: false, maxLength: 60, options: [] },
  { key: "emergencyContactRelationship", label: "Emergency contact relationship", fieldType: "TEXT", isRequired: false, maxLength: 120, options: [] },
  { key: "leadDate", label: "Lead date", fieldType: "DATE", isRequired: false, maxLength: 10, options: [] },
  { key: "leadSource", label: "Lead source", fieldType: "TEXT", isRequired: false, maxLength: 160, options: [] },
  { key: "leadOtherSource", label: "Other lead source", fieldType: "TEXT", isRequired: false, maxLength: 160, options: [] },
] as const

const AUTOMATION_CONTACT_UPDATE_FIELD_KEYS = AUTOMATION_CONTACT_UPDATE_FIELDS.map(
  (field) => field.key,
) as [
  (typeof AUTOMATION_CONTACT_UPDATE_FIELDS)[number]["key"],
  ...(typeof AUTOMATION_CONTACT_UPDATE_FIELDS)[number]["key"][],
]
const AutomationContactUpdateFieldKeySchema = z.enum(AUTOMATION_CONTACT_UPDATE_FIELD_KEYS)
const AUTOMATION_CONTACT_UPDATE_FIELD_MAP = new Map(
  AUTOMATION_CONTACT_UPDATE_FIELDS.map((field) => [field.key, field]),
)

const waitDurationConfigSchema = z.object({
  mode: z.literal("DURATION"),
  amount: z.number().int().positive(),
  unit: z.enum(AUTOMATION_WAIT_UNITS),
})

const waitFixedDateConfigSchema = z.object({
  mode: z.literal("FIXED_DATE"),
  dateTime: z.string().datetime(),
  timing: z.enum(["ON", "BEFORE", "AFTER"]),
  offsetAmount: z.number().int().positive().optional(),
  offsetUnit: z.enum(AUTOMATION_WAIT_UNITS).optional(),
  pastBehavior: z.enum(["CONTINUE", "EXIT", "GO_TO_STEP"]),
  targetNodeKey: AutomationNodeKeySchema.optional(),
})

export const AutomationWaitConfigSchema = z
  .discriminatedUnion("mode", [waitDurationConfigSchema, waitFixedDateConfigSchema])
  .superRefine((config, context) => {
    if (config.mode !== "FIXED_DATE") return
    if (config.timing !== "ON" && (!config.offsetAmount || !config.offsetUnit)) {
      context.addIssue({
        code: "custom",
        message: "Before and after waits require an offset amount and unit.",
        path: ["offsetAmount"],
      })
    }
    if (config.pastBehavior === "GO_TO_STEP" && !config.targetNodeKey) {
      context.addIssue({
        code: "custom",
        message: "Select a later action for the go-to behavior.",
        path: ["targetNodeKey"],
      })
    }
  })

export type AutomationWaitConfig = z.infer<typeof AutomationWaitConfigSchema>

const idSchema = z.string().trim().min(1).max(100)
const actionNodeKeySchema = AutomationNodeKeySchema.optional()
const operatorSchema = z.enum(AUTOMATION_OPERATORS)

const AutomationNoteTitleSchema = NoteTitleInputSchema.superRefine((value, context) => {
  for (const issue of parseContactTemplate(value).issues) {
    context.addIssue({ code: "custom", message: issue.message })
  }
})

const AutomationNoteBodySchema = NoteBodyInputSchema.superRefine((value, context) => {
  for (const issue of parseContactTemplate(value).issues) {
    context.addIssue({ code: "custom", message: issue.message })
  }
})

const opportunityValueConditionSchema = z.object({
  source: z.literal("OPPORTUNITY_VALUE"),
  operator: operatorSchema,
  compareValue: z.unknown().nullable().optional(),
})

const contactStatusConditionSchema = z.object({
  source: z.literal("CONTACT_STATUS"),
  operator: operatorSchema,
  statusConfigId: idSchema.nullable().optional(),
  compareValue: z.unknown().nullable().optional(),
})

const customFieldConditionSchema = z.object({
  source: z.literal("CONTACT_CUSTOM_FIELD"),
  operator: operatorSchema,
  customFieldId: idSchema,
  compareValue: z.unknown().nullable().optional(),
})

const contactAssigneeConditionSchema = z.object({
  source: z.literal("CONTACT_ASSIGNEE"),
  operator: operatorSchema,
  assignedUserId: idSchema.nullable().optional(),
})

const contactTagsConditionSchema = z.object({
  source: z.literal("CONTACT_TAGS"),
  operator: operatorSchema,
  tagId: idSchema.nullable().optional(),
})

const setContactCustomFieldUpdateSchema = z.object({
  customFieldId: idSchema,
  operation: z.literal("SET"),
  value: z.unknown(),
}).strict()

const clearContactCustomFieldUpdateSchema = z.object({
  customFieldId: idSchema,
  operation: z.literal("CLEAR"),
}).strict()

const setContactFieldUpdateSchema = z.object({
  contactFieldKey: AutomationContactUpdateFieldKeySchema,
  operation: z.literal("SET"),
  value: z.unknown(),
}).strict()

const clearContactFieldUpdateSchema = z.object({
  contactFieldKey: AutomationContactUpdateFieldKeySchema,
  operation: z.literal("CLEAR"),
}).strict()

export const AutomationCustomFieldUpdatesSchema = z
  .array(z.union([
    setContactCustomFieldUpdateSchema,
    clearContactCustomFieldUpdateSchema,
    setContactFieldUpdateSchema,
    clearContactFieldUpdateSchema,
  ]))
  .min(1, "Add at least one contact field update.")
  .max(20, "A contact-field action can update at most 20 fields.")
  .superRefine((updates, context) => {
    const seen = new Set<string>()
    updates.forEach((update, index) => {
      const fieldIdentity = "contactFieldKey" in update
        ? `contact:${update.contactFieldKey}`
        : `custom:${update.customFieldId}`
      if (seen.has(fieldIdentity)) {
        context.addIssue({
          code: "custom",
          path: [index, "contactFieldKey" in update ? "contactFieldKey" : "customFieldId"],
          message: "Each contact field can only be updated once per action.",
        })
      }
      seen.add(fieldIdentity)
    })
  })

export const AutomationConditionInputSchema = z.discriminatedUnion("source", [
  opportunityValueConditionSchema,
  contactStatusConditionSchema,
  customFieldConditionSchema,
  contactAssigneeConditionSchema,
  contactTagsConditionSchema,
])

const automationOpportunityConfigBase = {
  actionName: z.string().trim().min(1).max(120),
  pipelineId: idSchema,
  pipelineNameSnapshot: z.string().trim().min(1).max(120),
  stageId: idSchema,
  stageNameSnapshot: z.string().trim().min(1).max(120),
  resultMode: z.enum(["KEEP_CURRENT", "OPEN", "WON", "LOST"]),
} as const

const automationOpportunityValueCentsSchema = z.number().int().min(0).max(2_147_483_647)

export const AutomationOpportunityConfigSchema = z.union([
  z.object({
    ...automationOpportunityConfigBase,
    valueCents: automationOpportunityValueCentsSchema,
  }).strict(),
  z.object({
    ...automationOpportunityConfigBase,
    createValueCents: automationOpportunityValueCentsSchema,
  }).strict().transform(({ createValueCents, ...config }) => ({
    ...config,
    valueCents: createValueCents,
  })),
])

export const AutomationDeleteOpportunityConfigSchema = z.object({
  actionName: z.string().trim().min(1).max(120),
  pipelineId: idSchema,
  pipelineNameSnapshot: z.string().trim().min(1).max(120),
}).strict()

export const AutomationAddToWorkflowConfigSchema = z.object({
  actionName: z.string().trim().min(1).max(120),
  targetAutomationId: idSchema,
  targetAutomationNameSnapshot: z.string().trim().min(1).max(120),
}).strict()

export const AutomationRemoveFromWorkflowConfigSchema = z.object({
  actionName: z.string().trim().min(1).max(120),
  targetAutomationId: idSchema,
  targetAutomationNameSnapshot: z.string().trim().min(1).max(120),
}).strict()

const NonBranchAutomationActionInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("UPDATE_CONTACT_CUSTOM_FIELDS"),
    nodeKey: actionNodeKeySchema,
    customFieldUpdates: AutomationCustomFieldUpdatesSchema,
  }),
  z.object({
    type: z.literal("SET_CONTACT_CUSTOM_FIELD"),
    nodeKey: actionNodeKeySchema,
    customFieldId: idSchema,
    value: z.unknown(),
  }),
  z.object({ type: z.literal("CLEAR_CONTACT_CUSTOM_FIELD"), nodeKey: actionNodeKeySchema, customFieldId: idSchema }),
  z.object({ type: z.literal("SET_CONTACT_STATUS"), nodeKey: actionNodeKeySchema, statusConfigId: idSchema }),
  z.object({ type: z.literal("SET_CONTACT_ASSIGNEE"), nodeKey: actionNodeKeySchema, assignedUserId: idSchema }),
  z.object({ type: z.literal("CLEAR_CONTACT_ASSIGNEE"), nodeKey: actionNodeKeySchema }),
  z.object({ type: z.literal("ADD_CONTACT_TAG"), nodeKey: actionNodeKeySchema, tagId: idSchema }),
  z.object({ type: z.literal("REMOVE_CONTACT_TAG"), nodeKey: actionNodeKeySchema, tagId: idSchema }),
  z.object({
    type: z.literal("ADD_CONTACT_NOTE"),
    nodeKey: actionNodeKeySchema,
    noteTitle: AutomationNoteTitleSchema,
    noteBody: AutomationNoteBodySchema,
  }),
  z.object({
    type: z.literal("CREATE_CONTACT"),
    nodeKey: actionNodeKeySchema,
    createContactConfig: AutomationCreateContactConfigSchema,
  }),
  z.object({
    type: z.literal("CREATE_TASK"),
    nodeKey: actionNodeKeySchema,
    taskConfig: AutomationTaskConfigSchema,
  }),
  z.object({
    type: z.literal("FORMAT_DATE_TIME"),
    nodeKey: actionNodeKeySchema,
    dateTimeFormatterConfig: AutomationDateTimeFormatterConfigSchema,
  }),
  z.object({
    type: z.literal("FORMAT_NUMBER"),
    nodeKey: actionNodeKeySchema,
    numberFormatterConfig: AutomationNumberFormatterConfigSchema,
  }),
  z.object({
    type: z.literal("FORMAT_TEXT"),
    nodeKey: actionNodeKeySchema,
    textFormatterConfig: AutomationTextFormatterConfigSchema,
  }),
  z.object({
    type: z.literal("MATH_OPERATION"),
    nodeKey: actionNodeKeySchema,
    mathOperationConfig: AutomationMathOperationConfigSchema,
  }),
  z.object({ type: z.literal("WAIT"), nodeKey: actionNodeKeySchema, waitConfig: AutomationWaitConfigSchema }),
  z.object({
    type: z.literal("GO_TO"),
    nodeKey: actionNodeKeySchema,
    goToConfig: z.object({ targetNodeKey: AutomationNodeKeySchema }).strict(),
  }),
  z.object({
    type: z.literal("UPDATE_OPPORTUNITY"),
    nodeKey: actionNodeKeySchema,
    opportunityConfig: AutomationOpportunityConfigSchema,
  }),
  z.object({
    type: z.literal("DELETE_OPPORTUNITY"),
    nodeKey: actionNodeKeySchema,
    deleteOpportunityConfig: AutomationDeleteOpportunityConfigSchema,
  }),
  z.object({
    type: z.literal("ADD_TO_WORKFLOW"),
    nodeKey: actionNodeKeySchema,
    addToWorkflowConfig: AutomationAddToWorkflowConfigSchema,
  }),
  z.object({
    type: z.literal("REMOVE_FROM_WORKFLOW"),
    nodeKey: actionNodeKeySchema,
    removeFromWorkflowConfig: AutomationRemoveFromWorkflowConfigSchema,
  }),
  z.object({ type: z.literal("DELETE_CONTACT"), nodeKey: actionNodeKeySchema }),
])

const automationBranchConditionBase = {
  conditionKey: z.string().uuid().optional(),
  operator: operatorSchema,
  compareValue: z.unknown().nullable().optional(),
}

export const AutomationBranchConditionSchema = z.discriminatedUnion("source", [
  z.object({
    ...automationBranchConditionBase,
    source: z.literal("CONTACT_FIELD"),
    fieldKey: z.string().trim().min(1).max(100),
  }).strict(),
  z.object({
    ...automationBranchConditionBase,
    source: z.literal("CONTACT_CUSTOM_FIELD"),
    customFieldId: idSchema,
  }).strict(),
  z.object({
    ...automationBranchConditionBase,
    source: z.literal("CONTACT_STATUS"),
    statusConfigId: idSchema.nullable().optional(),
  }).strict(),
  z.object({
    ...automationBranchConditionBase,
    source: z.literal("CONTACT_ASSIGNEE"),
    assignedUserId: idSchema.nullable().optional(),
  }).strict(),
  z.object({
    ...automationBranchConditionBase,
    source: z.literal("CONTACT_TAGS"),
    tagId: idSchema.nullable().optional(),
  }).strict(),
  z.object({
    ...automationBranchConditionBase,
    source: z.literal("AUTOMATION_VALUE"),
    key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,63}$/),
  }).strict(),
  z.object({
    ...automationBranchConditionBase,
    source: z.literal("CURRENT_DATE_TIME"),
  }).strict(),
  z.object({
    ...automationBranchConditionBase,
    source: z.literal("OPPORTUNITY_FIELD"),
    field: z.enum(["VALUE", "PIPELINE", "PREVIOUS_STAGE", "CURRENT_STAGE"]),
  }).strict(),
])

type NonBranchAutomationActionInput = z.infer<typeof NonBranchAutomationActionInputSchema>
export type AutomationBranchConditionInput = z.infer<typeof AutomationBranchConditionSchema>

export type AutomationIfElseBranchInput = {
  branchKey?: string
  name: string
  isDefault: boolean
  matchMode: "ALL" | "ANY"
  conditions: AutomationBranchConditionInput[]
  actions: AutomationActionInput[]
}

export type AutomationIfElseConfigInput = {
  actionName: string
  branches: AutomationIfElseBranchInput[]
}

export type AutomationIfElseActionInput = {
  type: "IF_ELSE"
  nodeKey?: string
  ifElseConfig: AutomationIfElseConfigInput
}

export type AutomationSplitRouteInput = {
  branchKey?: string
  name: string
  percentage: number
  actions: AutomationActionInput[]
}

export type AutomationSplitConfigInput = {
  actionName: string
  routes: AutomationSplitRouteInput[]
}

export type AutomationSplitActionInput = {
  type: "SPLIT"
  nodeKey?: string
  splitConfig: AutomationSplitConfigInput
}

export type AutomationActionInput =
  | NonBranchAutomationActionInput
  | AutomationIfElseActionInput
  | AutomationSplitActionInput

const legacyRoutingActionNullFields = {
  customFieldId: z.null().optional(),
  customFieldUpdates: z.null().optional(),
  statusConfigId: z.null().optional(),
  assignedUserId: z.null().optional(),
  tagId: z.null().optional(),
  value: z.null().optional(),
  waitConfig: z.null().optional(),
  noteTitle: z.null().optional(),
  noteBody: z.null().optional(),
  createContactConfig: z.null().optional(),
  taskConfig: z.null().optional(),
  dateTimeFormatterConfig: z.null().optional(),
  numberFormatterConfig: z.null().optional(),
  textFormatterConfig: z.null().optional(),
  mathOperationConfig: z.null().optional(),
  goToConfig: z.null().optional(),
  opportunityConfig: z.null().optional(),
  deleteOpportunityConfig: z.null().optional(),
  addToWorkflowConfig: z.null().optional(),
  removeFromWorkflowConfig: z.null().optional(),
}

const AutomationIfElseBranchSchema: z.ZodType<AutomationIfElseBranchInput> = z.lazy(() => z.object({
  branchKey: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  isDefault: z.boolean(),
  matchMode: z.enum(["ALL", "ANY"]),
  conditions: z.array(AutomationBranchConditionSchema).max(20),
  actions: z.array(AutomationActionInputSchema).max(MAX_AUTOMATION_ACTION_NODES),
}).strict())

const AutomationSplitRouteSchema: z.ZodType<AutomationSplitRouteInput> = z.lazy(() => z.object({
  branchKey: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  percentage: z.number().int().min(1).max(99),
  actions: z.array(AutomationActionInputSchema).max(MAX_AUTOMATION_ACTION_NODES),
}).strict())

export const AutomationActionInputSchema: z.ZodType<AutomationActionInput> = z.lazy(() => z.union([
  NonBranchAutomationActionInputSchema,
  z.object({
    ...legacyRoutingActionNullFields,
    type: z.literal("IF_ELSE"),
    nodeKey: actionNodeKeySchema,
    splitConfig: z.null().optional(),
    ifElseConfig: z.object({
      actionName: z.string().trim().min(1).max(120),
      branches: z.array(AutomationIfElseBranchSchema).min(2).max(20),
    }).strict(),
  }).strict(),
  z.object({
    ...legacyRoutingActionNullFields,
    type: z.literal("SPLIT"),
    nodeKey: actionNodeKeySchema,
    ifElseConfig: z.null().optional(),
    splitConfig: z.object({
      actionName: z.string().trim().min(1).max(120),
      routes: z.array(AutomationSplitRouteSchema).min(2).max(20),
    }).strict(),
  }).strict(),
]))

export const AutomationUpsertSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    isEnabled: z.boolean().default(false),
    trigger: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("OPPORTUNITY_CREATED"),
        pipelineId: idSchema,
      }),
      z.object({
        type: z.literal("OPPORTUNITY_STAGE_CHANGED"),
        pipelineId: idSchema,
        targetStageId: idSchema,
      }),
    ]),
    conditions: z.array(AutomationConditionInputSchema).max(20).default([]),
    actions: z.array(AutomationActionInputSchema).min(1).max(MAX_AUTOMATION_ACTION_NODES),
  })
  .strict()

export type AutomationInput = z.infer<typeof AutomationUpsertSchema>
export type AutomationOperator = (typeof AUTOMATION_OPERATORS)[number]
export type AutomationTriggerType = (typeof AUTOMATION_TRIGGER_TYPES)[number]

export function automationWorkflowTargetIds(actions: any[]): string[] {
  const targets = new Set<string>()
  const visit = (items: any[]) => {
    for (const action of items) {
      if (action?.type === "ADD_TO_WORKFLOW") {
        const parsed = AutomationAddToWorkflowConfigSchema.safeParse(action.addToWorkflowConfig)
        if (parsed.success) targets.add(parsed.data.targetAutomationId)
      }
      const paths = action?.type === "IF_ELSE"
        ? action.ifElseConfig?.branches
        : action?.type === "SPLIT"
          ? action.splitConfig?.routes
          : null
      if (Array.isArray(paths)) {
        for (const path of paths) visit(Array.isArray(path?.actions) ? path.actions : [])
      }
    }
  }
  visit(Array.isArray(actions) ? actions : [])
  return [...targets]
}

export function automationWorkflowReferenceIds(actions: any[]): string[] {
  const targets = new Set(automationWorkflowTargetIds(actions))
  const visit = (items: any[]) => {
    for (const action of items) {
      if (action?.type === "REMOVE_FROM_WORKFLOW") {
        const parsed = AutomationRemoveFromWorkflowConfigSchema.safeParse(action.removeFromWorkflowConfig)
        if (parsed.success) targets.add(parsed.data.targetAutomationId)
      }
      const paths = action?.type === "IF_ELSE"
        ? action.ifElseConfig?.branches
        : action?.type === "SPLIT"
          ? action.splitConfig?.routes
          : null
      if (Array.isArray(paths)) {
        for (const path of paths) visit(Array.isArray(path?.actions) ? path.actions : [])
      }
    }
  }
  visit(Array.isArray(actions) ? actions : [])
  return [...targets]
}

function validatePublishedAutomationWorkflowGraph(params: {
  sourceAutomationId: string
  sourceActions: any[]
  publishedAutomations: Array<{ id: string; actions: any[] }>
}) {
  const edges = new Map<string, string[]>()
  for (const automation of params.publishedAutomations) {
    if (automation.id === params.sourceAutomationId) continue
    edges.set(automation.id, automationWorkflowTargetIds(automation.actions))
  }
  edges.set(params.sourceAutomationId, automationWorkflowTargetIds(params.sourceActions))

  const states = new Map<string, 0 | 1 | 2>()
  const visit = (automationId: string): boolean => {
    const state = states.get(automationId) ?? 0
    if (state === 1) return true
    if (state === 2) return false
    states.set(automationId, 1)
    for (const targetId of edges.get(automationId) ?? []) {
      if (visit(targetId)) return true
    }
    states.set(automationId, 2)
    return false
  }
  if ([...edges.keys()].some(visit)) {
    throw new AutomationConfigurationError(
      "AUTOMATION_WORKFLOW_CYCLE",
      "This Add to workflow connection would create a workflow loop.",
    )
  }
}

type CustomFieldType =
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

type ValueType = "string" | "number" | "date" | "boolean" | "stringArray"

type CustomFieldRecord = {
  id: string
  key: string
  label: string
  fieldType: CustomFieldType
  isRequired: boolean
  isActive: boolean
  isEncrypted: boolean
  isSensitive: boolean
  options: unknown
}

const EMPTY_OPERATORS = new Set<AutomationOperator>(["IS_EMPTY", "IS_NOT_EMPTY"])
const NUMBER_OPERATORS = new Set<AutomationOperator>([
  "EQUALS",
  "NOT_EQUALS",
  "GREATER_THAN",
  "GREATER_THAN_OR_EQUAL",
  "LESS_THAN",
  "LESS_THAN_OR_EQUAL",
  "BETWEEN",
  "IS_EMPTY",
  "IS_NOT_EMPTY",
])
const STRING_OPERATORS = new Set<AutomationOperator>([
  "EQUALS",
  "NOT_EQUALS",
  "CONTAINS",
  "NOT_CONTAINS",
  "IS_EMPTY",
  "IS_NOT_EMPTY",
])
const ARRAY_OPERATORS = new Set<AutomationOperator>([
  "INCLUDES_ANY",
  "INCLUDES_ALL",
  "EXCLUDES_ALL",
  "IS_EMPTY",
  "IS_NOT_EMPTY",
])
const BOOLEAN_OPERATORS = new Set<AutomationOperator>([
  "IS_TRUE",
  "IS_FALSE",
  "IS_EMPTY",
  "IS_NOT_EMPTY",
])

export class AutomationConfigurationError extends Error {
  status = 400
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "AutomationConfigurationError"
    this.code = code
  }
}

type AutomationControlFlowAction = {
  nodeKey: string
  type: string
  goToConfig?: { targetNodeKey?: string | null } | null
  ifElseConfig?: { branches?: Array<{ isDefault?: boolean; actions?: AutomationControlFlowAction[] }> } | null
  splitConfig?: { routes?: Array<{ actions?: AutomationControlFlowAction[] }> } | null
}

type AutomationControlFlowLocation = {
  action: AutomationControlFlowAction
  pathActions: AutomationControlFlowAction[]
  index: number
}

function automationValueRequirements(action: AutomationControlFlowAction) {
  const record = action as any
  const required = new Set<string>()
  const addSource = (source: unknown) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) return
    const candidate = source as Record<string, unknown>
    if (candidate.type === "AUTOMATION_VALUE" && typeof candidate.key === "string") {
      required.add(candidate.key)
    }
  }
  const addTemplate = (template: unknown) => {
    if (typeof template !== "string") return
    for (const match of template.matchAll(/\{automation\.([a-z][a-z0-9_]{0,63})\}/g)) {
      if (match[1]) required.add(match[1])
    }
  }

  if (record.type === "FORMAT_DATE_TIME") {
    const config = record.dateTimeFormatterConfig
    if (config?.mode === "COMPARE_DATES") {
      addSource(config.from)
      addSource(config.to)
    } else addSource(config?.source)
  } else if (record.type === "FORMAT_NUMBER") {
    if (record.numberFormatterConfig?.mode !== "RANDOM_NUMBER") addSource(record.numberFormatterConfig?.source)
  } else if (record.type === "FORMAT_TEXT") {
    addSource(record.textFormatterConfig?.source)
  } else if (record.type === "MATH_OPERATION") {
    addSource(record.mathOperationConfig?.source)
  } else if (record.type === "ADD_CONTACT_NOTE") {
    addTemplate(record.noteTitle)
    addTemplate(record.noteBody)
  } else if (record.type === "CREATE_TASK") {
    addTemplate(record.taskConfig?.nameTemplate)
    addTemplate(record.taskConfig?.descriptionTemplate)
    addTemplate(record.taskConfig?.reminder?.messageTemplate)
  } else if (record.type === "CREATE_CONTACT") {
    const config = record.createContactConfig
    addTemplate(config?.firstNameTemplate)
    addTemplate(config?.middleNameTemplate)
    addTemplate(config?.lastNameTemplate)
    addTemplate(config?.emailTemplate)
    addTemplate(config?.phoneTemplate)
    addSource(config?.dateOfBirth)
    for (const assignment of config?.customFieldValues ?? []) {
      if (assignment?.source?.type === "TEMPLATE") addTemplate(assignment.source.template)
      else addSource(assignment?.source)
    }
  } else if (record.type === "IF_ELSE") {
    for (const branch of record.ifElseConfig?.branches ?? []) {
      for (const condition of branch.conditions ?? []) addSource(condition)
    }
  }
  return required
}

function automationValueProduced(action: AutomationControlFlowAction) {
  const record = action as any
  if (record.type === "FORMAT_DATE_TIME") return record.dateTimeFormatterConfig?.outputKey as string | undefined
  if (record.type === "FORMAT_NUMBER") return record.numberFormatterConfig?.outputKey as string | undefined
  if (record.type === "FORMAT_TEXT") return record.textFormatterConfig?.outputKey as string | undefined
  if (record.type === "MATH_OPERATION") return record.mathOperationConfig?.outputKey as string | undefined
  return undefined
}

function validateAutomationValueControlFlow(
  locations: Map<string, AutomationControlFlowLocation>,
  edges: Map<string, Set<string>>,
) {
  const predecessors = new Map<string, Set<string>>()
  for (const nodeKey of locations.keys()) predecessors.set(nodeKey, new Set())
  for (const [source, targets] of edges) {
    for (const target of targets) predecessors.get(target)?.add(source)
  }
  const inDegree = new Map([...predecessors].map(([nodeKey, sources]) => [nodeKey, sources.size]))
  const queue = [...inDegree].filter(([, degree]) => degree === 0).map(([nodeKey]) => nodeKey)
  const definitelyAvailable = new Map<string, Set<string>>()

  while (queue.length > 0) {
    const nodeKey = queue.shift()!
    const incoming = [...(predecessors.get(nodeKey) ?? [])]
    const available = incoming.length === 0
      ? new Set<string>()
      : incoming.slice(1).reduce(
          (intersection, predecessor) => new Set(
            [...intersection].filter((key) => definitelyAvailable.get(predecessor)?.has(key)),
          ),
          new Set(definitelyAvailable.get(incoming[0]!) ?? []),
        )
    const action = locations.get(nodeKey)!.action
    for (const requiredKey of automationValueRequirements(action)) {
      if (!available.has(requiredKey)) {
        throw new AutomationConfigurationError(
          "GO_TO_VALUE_UNAVAILABLE",
          `The automation value “${requiredKey}” is not guaranteed to exist on every route to this action.`,
        )
      }
    }
    const produced = automationValueProduced(action)
    if (produced) available.add(produced)
    definitelyAvailable.set(nodeKey, available)
    for (const target of edges.get(nodeKey) ?? []) {
      const remaining = (inDegree.get(target) ?? 1) - 1
      inDegree.set(target, remaining)
      if (remaining === 0) queue.push(target)
    }
  }
}

function collectAutomationControlFlowLocations(actions: AutomationControlFlowAction[]) {
  const locations = new Map<string, AutomationControlFlowLocation>()
  const visit = (pathActions: AutomationControlFlowAction[]) => {
    pathActions.forEach((action, index) => {
      locations.set(action.nodeKey, { action, pathActions, index })
      if (action.type === "IF_ELSE") {
        for (const branch of action.ifElseConfig?.branches ?? []) {
          if (!branch.isDefault) visit(branch.actions ?? [])
        }
      } else if (action.type === "SPLIT") {
        for (const route of action.splitConfig?.routes ?? []) visit(route.actions ?? [])
      }
    })
  }
  visit(actions)
  return locations
}

export function validateAutomationGoToControlFlow(actions: AutomationControlFlowAction[]) {
  const locations = collectAutomationControlFlowLocations(actions)
  const edges = new Map<string, Set<string>>()
  const addEdge = (source: string, target?: string | null) => {
    if (!target) return
    const targets = edges.get(source) ?? new Set<string>()
    targets.add(target)
    edges.set(source, targets)
  }

  for (const { action, pathActions, index } of locations.values()) {
    if (action.type === "GO_TO") {
      if (index !== pathActions.length - 1) {
        throw new AutomationConfigurationError(
          "GO_TO_MUST_BE_LAST",
          "Go To can only be the final action in its path.",
        )
      }
      const targetNodeKey = action.goToConfig?.targetNodeKey
      if (!targetNodeKey || !locations.has(targetNodeKey)) {
        throw new AutomationConfigurationError(
          "GO_TO_TARGET_NOT_FOUND",
          "Select an available Go To destination.",
        )
      }
      if (targetNodeKey === action.nodeKey) {
        throw new AutomationConfigurationError(
          "GO_TO_SELF_TARGET",
          "Go To cannot target itself.",
        )
      }
      addEdge(action.nodeKey, targetNodeKey)
      continue
    }
    if (action.type === "IF_ELSE") {
      for (const branch of action.ifElseConfig?.branches ?? []) {
        if (!branch.isDefault) addEdge(action.nodeKey, branch.actions?.[0]?.nodeKey)
      }
      continue
    }
    if (action.type === "SPLIT") {
      for (const route of action.splitConfig?.routes ?? []) {
        addEdge(action.nodeKey, route.actions?.[0]?.nodeKey)
      }
      continue
    }
    addEdge(action.nodeKey, pathActions[index + 1]?.nodeKey)
  }

  const states = new Map<string, 0 | 1 | 2>()
  const visit = (nodeKey: string): boolean => {
    const state = states.get(nodeKey) ?? 0
    if (state === 1) return true
    if (state === 2) return false
    states.set(nodeKey, 1)
    for (const target of edges.get(nodeKey) ?? []) {
      if (visit(target)) return true
    }
    states.set(nodeKey, 2)
    return false
  }
  if ([...locations.keys()].some((nodeKey) => visit(nodeKey))) {
    throw new AutomationConfigurationError(
      "AUTOMATION_FLOW_CYCLE",
      "Go To connections cannot create a workflow loop.",
    )
  }
  if ([...locations.values()].some(({ action }) => action.type === "GO_TO")) {
    validateAutomationValueControlFlow(locations, edges)
  }
}

export class AutomationExecutionError extends Error {
  status = 409
  code = "AUTOMATION_EXECUTION_FAILED"
  automationId: string | null
  automationName: string
  actionIndex: number
  contactId: string | null
  nodeExecutions: AutomationNodeLogData[]
  actionSnapshot: unknown[]
  attemptId: string | null
  eventSource: AutomationNodeEventSource | null
  contactName: string | null
  branchDecisions: AutomationBranchDecisions | null
  cursorPath: AutomationCursorPathState | null

  constructor(params: {
    automationId: string | null
    automationName: string
    actionIndex: number
    contactId?: string | null
    message: string
  }) {
    super(params.message)
    this.name = "AutomationExecutionError"
    this.automationId = params.automationId
    this.automationName = params.automationName
    this.actionIndex = params.actionIndex
    this.contactId = params.contactId ?? null
    this.nodeExecutions = []
    this.actionSnapshot = []
    this.attemptId = null
    this.eventSource = null
    this.contactName = null
    this.branchDecisions = null
    this.cursorPath = null
  }
}

export type AutomationGoToHistoryEntry = {
  sourceNodeKey: string
  targetNodeKey: string
}

export type AutomationCursorPathState = {
  nextNodeKey: string | null
  visitedNodeKeys?: string[]
  goToHistory?: AutomationGoToHistoryEntry[]
}

function valueTypeForCustomField(fieldType: CustomFieldType): ValueType {
  if (fieldType === "NUMBER" || fieldType === "CURRENCY") return "number"
  if (fieldType === "DATE") return "date"
  if (fieldType === "CHECKBOX") return "boolean"
  if (fieldType === "MULTI_SELECT") return "stringArray"
  return "string"
}

export function getAutomationOperatorsForFieldType(fieldType: CustomFieldType) {
  const valueType = valueTypeForCustomField(fieldType)
  if (valueType === "number" || valueType === "date") return [...NUMBER_OPERATORS]
  if (valueType === "boolean") return [...BOOLEAN_OPERATORS]
  if (valueType === "stringArray") return [...ARRAY_OPERATORS]
  return [...STRING_OPERATORS]
}

function isEmptyValue(value: unknown, valueType: ValueType) {
  if (valueType === "stringArray") return !Array.isArray(value) || value.length === 0
  if (valueType === "number") return value === null || value === undefined || !Number.isFinite(Number(value))
  if (valueType === "date") return !value || Number.isNaN(new Date(String(value)).getTime())
  if (valueType === "boolean") return value === null || value === undefined
  return typeof value !== "string" || value.trim().length === 0
}

export function evaluateAutomationOperator(
  operator: AutomationOperator,
  currentValue: unknown,
  compareValue: unknown,
  valueType: ValueType,
) {
  if (operator === "IS_EMPTY") return isEmptyValue(currentValue, valueType)
  if (operator === "IS_NOT_EMPTY") return !isEmptyValue(currentValue, valueType)
  if (operator === "IS_TRUE") return currentValue === true
  if (operator === "IS_FALSE") return currentValue === false

  if (valueType === "stringArray") {
    const current = Array.isArray(currentValue) ? currentValue.map(String) : []
    const expected = Array.isArray(compareValue) ? compareValue.map(String) : []
    if (operator === "INCLUDES_ANY") return expected.some((item) => current.includes(item))
    if (operator === "INCLUDES_ALL") return expected.every((item) => current.includes(item))
    if (operator === "EXCLUDES_ALL") return expected.every((item) => !current.includes(item))
    return false
  }

  if (valueType === "number") {
    const current = Number(currentValue)
    if (!Number.isFinite(current)) return false
    if (operator === "BETWEEN") {
      const range = compareValue as { min?: unknown; max?: unknown } | null
      const min = Number(range?.min)
      const max = Number(range?.max)
      return Number.isFinite(min) && Number.isFinite(max) && current >= min && current <= max
    }
    const expected = Number(compareValue)
    if (!Number.isFinite(expected)) return false
    if (operator === "EQUALS") return current === expected
    if (operator === "NOT_EQUALS") return current !== expected
    if (operator === "GREATER_THAN") return current > expected
    if (operator === "GREATER_THAN_OR_EQUAL") return current >= expected
    if (operator === "LESS_THAN") return current < expected
    if (operator === "LESS_THAN_OR_EQUAL") return current <= expected
    return false
  }

  if (valueType === "date") {
    const current = new Date(String(currentValue)).getTime()
    if (Number.isNaN(current)) return false
    if (operator === "BETWEEN") {
      const range = compareValue as { min?: unknown; max?: unknown } | null
      const min = new Date(String(range?.min ?? "")).getTime()
      const max = new Date(String(range?.max ?? "")).getTime()
      return !Number.isNaN(min) && !Number.isNaN(max) && current >= min && current <= max
    }
    const expected = new Date(String(compareValue)).getTime()
    if (Number.isNaN(expected)) return false
    if (operator === "EQUALS") return current === expected
    if (operator === "NOT_EQUALS") return current !== expected
    if (operator === "GREATER_THAN") return current > expected
    if (operator === "GREATER_THAN_OR_EQUAL") return current >= expected
    if (operator === "LESS_THAN") return current < expected
    if (operator === "LESS_THAN_OR_EQUAL") return current <= expected
    return false
  }

  const current = String(currentValue ?? "")
  const expected = String(compareValue ?? "")
  if (operator === "EQUALS") return current === expected
  if (operator === "NOT_EQUALS") return current !== expected
  if (operator === "CONTAINS") return current.toLocaleLowerCase().includes(expected.toLocaleLowerCase())
  if (operator === "NOT_CONTAINS") return !current.toLocaleLowerCase().includes(expected.toLocaleLowerCase())
  return false
}

function normalizeCompareValue(
  operator: AutomationOperator,
  rawValue: unknown,
  valueType: ValueType,
) {
  if (EMPTY_OPERATORS.has(operator) || valueType === "boolean") return null
  if (valueType === "stringArray") {
    const value = Array.isArray(rawValue)
      ? [...new Set(rawValue.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
      : []
    if (value.length === 0) throw new AutomationConfigurationError("INVALID_CONDITION_VALUE", "Select at least one comparison value.")
    return value
  }
  if (valueType === "number") {
    if (operator === "BETWEEN") {
      const range = rawValue as { min?: unknown; max?: unknown } | null
      const min = Number(range?.min)
      const max = Number(range?.max)
      if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
        throw new AutomationConfigurationError("INVALID_CONDITION_VALUE", "Enter a valid minimum and maximum.")
      }
      return { min, max }
    }
    const value = Number(rawValue)
    if (!Number.isFinite(value)) throw new AutomationConfigurationError("INVALID_CONDITION_VALUE", "Enter a valid number.")
    return value
  }
  if (valueType === "date") {
    if (operator === "BETWEEN") {
      const range = rawValue as { min?: unknown; max?: unknown } | null
      const min = String(range?.min ?? "")
      const max = String(range?.max ?? "")
      if (Number.isNaN(new Date(min).getTime()) || Number.isNaN(new Date(max).getTime())) {
        throw new AutomationConfigurationError("INVALID_CONDITION_VALUE", "Enter a valid date range.")
      }
      return { min, max }
    }
    const value = String(rawValue ?? "")
    if (Number.isNaN(new Date(value).getTime())) throw new AutomationConfigurationError("INVALID_CONDITION_VALUE", "Enter a valid date.")
    return value
  }
  const value = typeof rawValue === "string" ? rawValue.trim() : ""
  if (!value) throw new AutomationConfigurationError("INVALID_CONDITION_VALUE", "Enter a comparison value.")
  return value
}

function fieldOptions(field: CustomFieldRecord) {
  return Array.isArray(field.options)
    ? field.options.filter((item): item is string => typeof item === "string")
    : []
}

type AutomationContactUpdateField = (typeof AUTOMATION_CONTACT_UPDATE_FIELDS)[number]

function normalizeAutomationContactFieldValue(
  field: AutomationContactUpdateField,
  rawValue: unknown,
) {
  if (field.fieldType === "CHECKBOX") {
    return typeof rawValue === "boolean"
      ? { ok: true as const, value: rawValue }
      : { ok: false as const, message: `${field.label} must be checked or unchecked.` }
  }
  if (field.fieldType === "DATE") {
    const value = typeof rawValue === "string" ? rawValue.trim() : ""
    return isValidTemplateDate(value)
      ? { ok: true as const, value }
      : { ok: false as const, message: `${field.label} must use a valid date.` }
  }
  const value = typeof rawValue === "string" ? rawValue.trim() : ""
  if (!value) return { ok: false as const, message: `${field.label} requires a value.` }
  if (value.length > field.maxLength) {
    return {
      ok: false as const,
      message: `${field.label} cannot exceed ${field.maxLength} characters.`,
    }
  }
  if (field.fieldType === "PHONE" && !/^\+[1-9]\d{7,14}$/.test(value)) {
    return { ok: false as const, message: `${field.label} must be a valid phone number.` }
  }
  if (field.fieldType === "EMAIL" && !z.email().safeParse(value).success) {
    return { ok: false as const, message: `${field.label} must be a valid email address.` }
  }
  if (field.fieldType === "SELECT" && !(field.options as readonly string[]).includes(value)) {
    return { ok: false as const, message: `${field.label} has an invalid option.` }
  }
  return { ok: true as const, value }
}

function contactFieldPersistenceValue(field: AutomationContactUpdateField, value: unknown) {
  return field.fieldType === "DATE"
    ? new Date(`${String(value)}T00:00:00.000Z`)
    : value
}

export async function validateAutomationConfiguration(
  prismaClient: any,
  tenantId: string,
  input: AutomationInput,
  options: { sourceAutomationId?: string | null } = {},
) {
  const [pipelines, fields, statuses, taskStatuses, memberships, tags, services, publishedAutomations] = await Promise.all([
    prismaClient.opportunityPipeline.findMany
      ? prismaClient.opportunityPipeline.findMany({
          where: { tenantId },
          select: {
            id: true,
            name: true,
            stages: { select: { id: true, name: true } },
          },
        })
      : prismaClient.opportunityPipeline.findUnique({
          where: { tenantId_id: { tenantId, id: input.trigger.pipelineId } },
          select: {
            id: true,
            name: true,
            stages: { select: { id: true, name: true } },
          },
        }).then((pipeline: any) => pipeline ? [pipeline] : []),
    prismaClient.contactCustomField.findMany({
      where: { tenantId },
      select: {
        id: true,
        key: true,
        label: true,
        fieldType: true,
        isRequired: true,
        isActive: true,
        isEncrypted: true,
        isSensitive: true,
        options: true,
      },
    }),
    prismaClient.contactStatusConfig.findMany({
      where: { tenantId },
      select: { id: true, isActive: true },
    }),
    prismaClient.taskStatusConfig?.findMany
      ? prismaClient.taskStatusConfig.findMany({
          where: { tenantId },
          select: { id: true, name: true, isActive: true },
        })
      : Promise.resolve([]),
    prismaClient.membership.findMany({
      where: { tenantId },
      select: { userId: true, status: true },
    }),
    prismaClient.tenantTag.findMany({ where: { tenantId }, select: { id: true } }),
    prismaClient.service?.findMany
      ? prismaClient.service.findMany({
          where: { tenantId, isActive: true },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    prismaClient.automation?.findMany
      ? prismaClient.automation.findMany({
          where: { tenantId, isEnabled: true },
          select: {
            id: true,
            name: true,
            actions: {
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              select: {
                type: true,
                addToWorkflowConfig: true,
                ifElseConfig: true,
                splitConfig: true,
              },
            },
          },
        })
      : Promise.resolve([]),
  ])

  const pipeline = pipelines.find((item: any) => item.id === input.trigger.pipelineId)
  if (!pipeline) throw new AutomationConfigurationError("PIPELINE_NOT_FOUND", "The selected pipeline no longer exists.")
  const stageIds = new Set(pipeline.stages.map((stage: { id: string }) => stage.id))
  if (input.trigger.type === "OPPORTUNITY_STAGE_CHANGED") {
    if (!stageIds.has(input.trigger.targetStageId)) {
      throw new AutomationConfigurationError("PIPELINE_STAGE_NOT_FOUND", "The selected stage does not belong to the selected pipeline.")
    }
  }

  const fieldMap = new Map<string, CustomFieldRecord>(fields.map((field: CustomFieldRecord) => [field.id, field]))
  const fieldKeyMap = new Map<string, CustomFieldRecord>(fields.map((field: CustomFieldRecord) => [field.key, field]))
  const activeStatusIds = new Set(statuses.filter((item: any) => item.isActive).map((item: any) => item.id))
  const activeTaskStatusIds = new Set(taskStatuses.filter((item: any) => item.isActive).map((item: any) => item.id))
  const activeUserIds = new Set(memberships.filter((item: any) => item.status === "ACTIVE").map((item: any) => item.userId))
  const tagIds = new Set(tags.map((item: any) => item.id))
  const serviceMap = new Map<string, string>(services.map((item: any) => [item.id, item.name]))
  const opportunityPipelineMap = new Map<string, any>(pipelines.map((item: any) => [item.id, item]))
  const publishedAutomationMap = new Map<string, { id: string; name: string; actions: any[] }>(
    publishedAutomations.map((automation: any) => [automation.id, automation]),
  )

  const conditions = input.conditions.map((condition, index) => {
    if (condition.source === "OPPORTUNITY_VALUE") {
      if (!NUMBER_OPERATORS.has(condition.operator) || EMPTY_OPERATORS.has(condition.operator)) {
        throw new AutomationConfigurationError("INVALID_CONDITION_OPERATOR", "The selected operator is not available for opportunity value.")
      }
      return {
        tenantId,
        source: condition.source,
        operator: condition.operator,
        compareValue: normalizeCompareValue(condition.operator, condition.compareValue, "number"),
        sortOrder: (index + 1) * 10,
      }
    }
    if (condition.source === "CONTACT_STATUS") {
      const allowed = new Set<AutomationOperator>(["EQUALS", "NOT_EQUALS", "IS_EMPTY", "IS_NOT_EMPTY"])
      if (!allowed.has(condition.operator)) {
        throw new AutomationConfigurationError("INVALID_CONDITION_OPERATOR", "The selected operator is not available for contact status.")
      }
      const needsStatus = condition.operator === "EQUALS" || condition.operator === "NOT_EQUALS"
      if (needsStatus && (!condition.statusConfigId || !activeStatusIds.has(condition.statusConfigId))) {
        throw new AutomationConfigurationError("INVALID_STATUS_CONFIG", "Select an active contact status.")
      }
      return {
        tenantId,
        source: condition.source,
        operator: condition.operator,
        statusConfigId: needsStatus ? condition.statusConfigId : null,
        compareValue: null,
        sortOrder: (index + 1) * 10,
      }
    }
    if (condition.source === "CONTACT_ASSIGNEE") {
      const allowed = new Set<AutomationOperator>(["EQUALS", "NOT_EQUALS", "IS_EMPTY", "IS_NOT_EMPTY"])
      if (!allowed.has(condition.operator)) {
        throw new AutomationConfigurationError("INVALID_CONDITION_OPERATOR", "The selected operator is not available for contact assignee.")
      }
      const needsAssignee = condition.operator === "EQUALS" || condition.operator === "NOT_EQUALS"
      if (needsAssignee && (!condition.assignedUserId || !activeUserIds.has(condition.assignedUserId))) {
        throw new AutomationConfigurationError("INVALID_ASSIGNEE", "Select an active tenant member.")
      }
      return {
        tenantId,
        source: condition.source,
        operator: condition.operator,
        assignedUserId: needsAssignee ? condition.assignedUserId : null,
        compareValue: null,
        sortOrder: (index + 1) * 10,
      }
    }
    if (condition.source === "CONTACT_TAGS") {
      const allowed = new Set<AutomationOperator>(["EQUALS", "NOT_EQUALS", "IS_EMPTY", "IS_NOT_EMPTY"])
      if (!allowed.has(condition.operator)) {
        throw new AutomationConfigurationError("INVALID_CONDITION_OPERATOR", "The selected operator is not available for contact tags.")
      }
      const needsTag = condition.operator === "EQUALS" || condition.operator === "NOT_EQUALS"
      if (needsTag && (!condition.tagId || !tagIds.has(condition.tagId))) {
        throw new AutomationConfigurationError("INVALID_TAG", "Select a tenant tag.")
      }
      return {
        tenantId,
        source: condition.source,
        operator: condition.operator,
        tagId: needsTag ? condition.tagId : null,
        compareValue: null,
        sortOrder: (index + 1) * 10,
      }
    }

    const field = fieldMap.get(condition.customFieldId)
    if (!field || !field.isActive || field.isEncrypted || field.isSensitive) {
      throw new AutomationConfigurationError("INVALID_CUSTOM_FIELD", "Select an active, non-sensitive custom field.")
    }
    const allowed = new Set(getAutomationOperatorsForFieldType(field.fieldType))
    if (!allowed.has(condition.operator)) {
      throw new AutomationConfigurationError("INVALID_CONDITION_OPERATOR", `The selected operator is not available for ${field.label}.`)
    }
    const compareValue = normalizeCompareValue(
      condition.operator,
      condition.compareValue,
      valueTypeForCustomField(field.fieldType),
    )
    const options = fieldOptions(field)
    const comparisonValues = Array.isArray(compareValue) ? compareValue : [compareValue]
    if (
      options.length > 0 &&
      !EMPTY_OPERATORS.has(condition.operator) &&
      comparisonValues.some((value) => typeof value === "string" && !options.includes(value))
    ) {
      throw new AutomationConfigurationError("INVALID_CONDITION_VALUE", `${field.label} has an invalid option.`)
    }
    return {
      tenantId,
      source: condition.source,
      operator: condition.operator,
      customFieldId: field.id,
      compareValue,
      sortOrder: (index + 1) * 10,
    }
  })

  const actionNodeKeys = new Set<string>()
  let totalActionCount = 0
  let automationOutputs = new Map<string, AutomationValueKind>()
  const validateFormatterSource = (source: AutomationFormatterDateSource, label: string) => {
    if (source.type === "CONTACT_FIELD") {
      const regularField = CONTACT_TEMPLATE_REGULAR_FIELDS.find((field) => field.key === source.key)
      if (!regularField || regularField.fieldType !== "DATE") {
        throw new AutomationConfigurationError("INVALID_FORMATTER_DATE_FIELD", `${label} must use a date field.`)
      }
    } else if (source.type === "CUSTOM_FIELD") {
      const field = fieldKeyMap.get(source.key)
      if (!field || field.fieldType !== "DATE" || !field.isActive || field.isEncrypted || field.isSensitive) {
        throw new AutomationConfigurationError(
          "INVALID_FORMATTER_DATE_FIELD",
          `${label} must use an active, non-sensitive date field.`,
        )
      }
    } else if (source.type === "SPECIFIC_DATE") {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: source.timezone }).format(new Date())
      } catch {
        throw new AutomationConfigurationError("INVALID_FORMATTER_TIMEZONE", `${label} uses an invalid timezone.`)
      }
    } else if (source.type === "AUTOMATION_VALUE") {
      const outputKind = automationOutputs.get(source.key)
      if (!outputKind) {
        throw new AutomationConfigurationError(
          "UNKNOWN_AUTOMATION_VALUE",
          `The automation value “${source.key}” is not available before this action.`,
        )
      }
      if (outputKind !== "DATE") {
        throw new AutomationConfigurationError(
          "INCOMPATIBLE_AUTOMATION_VALUE",
          `The automation value “${source.key}” is not a date.`,
        )
      }
    }
  }
  const validateNumberFormatterSource = (
    source: AutomationNumberSource,
    mode: "TEXT_TO_NUMBER" | "FORMAT_NUMBER" | "FORMAT_CURRENCY" | "FORMAT_PHONE_NUMBER",
  ) => {
    if (source.type === "CONTACT_FIELD") {
      const regularField = CONTACT_TEMPLATE_REGULAR_FIELDS.find((field) => field.key === source.key)
      if (!regularField || !numberFormatterAcceptsFieldType(mode, regularField.fieldType)) {
        throw new AutomationConfigurationError(
          "INVALID_NUMBER_FORMATTER_FIELD",
          "Select a compatible contact field for this number formatter.",
        )
      }
      return
    }
    if (source.type === "CUSTOM_FIELD") {
      const field = fieldKeyMap.get(source.key)
      if (
        !field ||
        !field.isActive ||
        field.isEncrypted ||
        field.isSensitive ||
        !numberFormatterAcceptsFieldType(mode, field.fieldType)
      ) {
        throw new AutomationConfigurationError(
          "INVALID_NUMBER_FORMATTER_FIELD",
          "Select an active, non-sensitive field compatible with this number formatter.",
        )
      }
      return
    }
    const outputKind = automationOutputs.get(source.key)
    if (!outputKind) {
      throw new AutomationConfigurationError(
        "UNKNOWN_AUTOMATION_VALUE",
        `The automation value “${source.key}” is not available before this action.`,
      )
    }
    if (!numberFormatterAcceptsValueKind(mode, outputKind)) {
      throw new AutomationConfigurationError(
        "INCOMPATIBLE_AUTOMATION_VALUE",
        `The automation value “${source.key}” is not compatible with this number formatter.`,
      )
    }
  }
  const validateTextFormatterSource = (source: AutomationTextSource) => {
    if (source.type === "CONTACT_FIELD") {
      const regularField = CONTACT_TEMPLATE_REGULAR_FIELDS.find((field) => field.key === source.key)
      if (!regularField || !textFormatterAcceptsFieldType(regularField.fieldType)) {
        throw new AutomationConfigurationError(
          "INVALID_TEXT_FORMATTER_FIELD",
          "Select a compatible contact field for this text formatter.",
        )
      }
      return
    }
    if (source.type === "CUSTOM_FIELD") {
      const field = fieldKeyMap.get(source.key)
      if (
        !field ||
        !field.isActive ||
        field.isEncrypted ||
        field.isSensitive ||
        !textFormatterAcceptsFieldType(field.fieldType)
      ) {
        throw new AutomationConfigurationError(
          "INVALID_TEXT_FORMATTER_FIELD",
          "Select an active, non-sensitive field compatible with this text formatter.",
        )
      }
      return
    }
    const outputKind = automationOutputs.get(source.key)
    if (!outputKind) {
      throw new AutomationConfigurationError(
        "UNKNOWN_AUTOMATION_VALUE",
        `The automation value “${source.key}” is not available before this action.`,
      )
    }
    if (!textFormatterAcceptsValueKind(outputKind)) {
      throw new AutomationConfigurationError(
        "INCOMPATIBLE_AUTOMATION_VALUE",
        `The automation value “${source.key}” is not compatible with this text formatter.`,
      )
    }
  }
  const validateCreateContactTypedSource = (
    source: AutomationCreateContactTypedSource,
    destinationType: string,
    label: string,
  ) => {
    if (source.type === "FIXED") return
    if (source.type === "CONTACT_FIELD") {
      const field = CONTACT_TEMPLATE_REGULAR_FIELDS.find((candidate) => candidate.key === source.key)
      if (!field || !createContactSourceFieldIsCompatible(destinationType, field.fieldType)) {
        throw new AutomationConfigurationError(
          "INVALID_CREATE_CONTACT_SOURCE",
          `${label} must use a compatible contact field.`,
        )
      }
      return
    }
    if (source.type === "CUSTOM_FIELD") {
      const field = fieldKeyMap.get(source.key)
      if (
        !field ||
        !field.isActive ||
        field.isEncrypted ||
        field.isSensitive ||
        !createContactSourceFieldIsCompatible(destinationType, field.fieldType)
      ) {
        throw new AutomationConfigurationError(
          "INVALID_CREATE_CONTACT_SOURCE",
          `${label} must use an active, non-sensitive compatible custom field.`,
        )
      }
      return
    }
    const outputKind = automationOutputs.get(source.key)
    if (!outputKind) {
      throw new AutomationConfigurationError(
        "UNKNOWN_AUTOMATION_VALUE",
        `The automation value “${source.key}” is not available before this action.`,
      )
    }
    if (!createContactAutomationValueIsCompatible(destinationType, outputKind)) {
      throw new AutomationConfigurationError(
        "INCOMPATIBLE_AUTOMATION_VALUE",
        `The automation value “${source.key}” is not compatible with ${label}.`,
      )
    }
  }
  const validateMathSource = (
    config: AutomationMathOperationConfig,
  ) => {
    const { source } = config
    if (source.type === "CONTACT_FIELD") {
      const field = CONTACT_TEMPLATE_REGULAR_FIELDS.find((candidate) => candidate.key === source.key)
      if (!field || !mathOperationAcceptsFieldType(config.mode, field.fieldType)) {
        throw new AutomationConfigurationError(
          "INVALID_MATH_FIELD",
          `Select a compatible contact ${config.mode === "DATE" ? "date" : "number"} field.`,
        )
      }
      return
    }
    if (source.type === "CUSTOM_FIELD") {
      const field = fieldKeyMap.get(source.key)
      if (
        !field ||
        !field.isActive ||
        field.isEncrypted ||
        field.isSensitive ||
        !mathOperationAcceptsFieldType(config.mode, field.fieldType)
      ) {
        throw new AutomationConfigurationError(
          "INVALID_MATH_FIELD",
          `Select an active, non-sensitive ${config.mode === "DATE" ? "date" : "number"} field.`,
        )
      }
      return
    }
    const outputKind = automationOutputs.get(source.key)
    if (!outputKind) {
      throw new AutomationConfigurationError(
        "UNKNOWN_AUTOMATION_VALUE",
        `The automation value “${source.key}” is not available before this action.`,
      )
    }
    const expectedKind: AutomationValueKind = config.mode === "DATE" ? "DATE" : "NUMBER"
    if (outputKind !== expectedKind) {
      throw new AutomationConfigurationError(
        "INCOMPATIBLE_AUTOMATION_VALUE",
        `The automation value “${source.key}” is not a ${config.mode === "DATE" ? "date" : "number"}.`,
      )
    }
  }

  const normalizeBranchCondition = (
    condition: AutomationBranchConditionInput,
    branchOutputs: Map<string, AutomationValueKind>,
  ) => {
    const conditionKey = condition.conditionKey ?? randomUUID()
    let valueType: ValueType
    let compareValue = condition.compareValue
    let allowedOptions: string[] | null = null

    if (condition.source === "CONTACT_FIELD") {
      const field = CONTACT_TEMPLATE_REGULAR_FIELDS.find((candidate) => candidate.key === condition.fieldKey)
      if (!field) {
        throw new AutomationConfigurationError("INVALID_BRANCH_FIELD", "Select an available contact field.")
      }
      valueType = valueTypeForCustomField(field.fieldType as CustomFieldType)
      if (!new Set(getAutomationOperatorsForFieldType(field.fieldType as CustomFieldType)).has(condition.operator)) {
        throw new AutomationConfigurationError("INVALID_BRANCH_OPERATOR", `The selected operator is not available for ${field.label}.`)
      }
    } else if (condition.source === "CONTACT_CUSTOM_FIELD") {
      const field = fieldMap.get(condition.customFieldId)
      if (!field || !field.isActive || field.isEncrypted || field.isSensitive) {
        throw new AutomationConfigurationError("INVALID_BRANCH_FIELD", "Select an active, non-sensitive custom field.")
      }
      valueType = valueTypeForCustomField(field.fieldType)
      if (["SELECT", "RADIO", "MULTI_SELECT"].includes(field.fieldType)) {
        allowedOptions = fieldOptions(field)
      }
      if (!new Set(getAutomationOperatorsForFieldType(field.fieldType)).has(condition.operator)) {
        throw new AutomationConfigurationError("INVALID_BRANCH_OPERATOR", `The selected operator is not available for ${field.label}.`)
      }
    } else if (condition.source === "AUTOMATION_VALUE") {
      const kind = branchOutputs.get(condition.key)
      if (!kind) {
        throw new AutomationConfigurationError(
          "UNKNOWN_AUTOMATION_VALUE",
          `The automation value “${condition.key}” is not available before this branch.`,
        )
      }
      valueType = kind === "NUMBER" ? "number" : kind === "DATE" ? "date" : "string"
      const allowed = valueType === "number" || valueType === "date" ? NUMBER_OPERATORS : STRING_OPERATORS
      if (!allowed.has(condition.operator)) {
        throw new AutomationConfigurationError("INVALID_BRANCH_OPERATOR", "The selected operator is not compatible with this automation value.")
      }
    } else if (condition.source === "CURRENT_DATE_TIME") {
      valueType = "date"
      if (!NUMBER_OPERATORS.has(condition.operator)) {
        throw new AutomationConfigurationError("INVALID_BRANCH_OPERATOR", "The selected operator is not available for the current date and time.")
      }
    } else if (condition.source === "OPPORTUNITY_FIELD") {
      valueType = condition.field === "VALUE" ? "number" : "string"
      const allowed = valueType === "number" ? NUMBER_OPERATORS : STRING_OPERATORS
      if (!allowed.has(condition.operator)) {
        throw new AutomationConfigurationError("INVALID_BRANCH_OPERATOR", "The selected operator is not available for this opportunity field.")
      }
    } else if (condition.source === "CONTACT_TAGS") {
      valueType = "stringArray"
      const allowed = new Set<AutomationOperator>(["INCLUDES_ANY", "INCLUDES_ALL", "EXCLUDES_ALL", "IS_EMPTY", "IS_NOT_EMPTY"])
      if (!allowed.has(condition.operator)) {
        throw new AutomationConfigurationError("INVALID_BRANCH_OPERATOR", "The selected operator is not available for contact tags.")
      }
      if (!EMPTY_OPERATORS.has(condition.operator)) {
        if (!condition.tagId || !tagIds.has(condition.tagId)) {
          throw new AutomationConfigurationError("INVALID_TAG", "Select a tenant tag.")
        }
        compareValue = [condition.tagId]
      }
    } else {
      valueType = "string"
      const allowed = new Set<AutomationOperator>(["EQUALS", "NOT_EQUALS", "IS_EMPTY", "IS_NOT_EMPTY"])
      if (!allowed.has(condition.operator)) {
        throw new AutomationConfigurationError("INVALID_BRANCH_OPERATOR", "The selected operator is not available for this condition.")
      }
      if (!EMPTY_OPERATORS.has(condition.operator)) {
        const referenceId = condition.source === "CONTACT_STATUS"
          ? condition.statusConfigId
          : condition.assignedUserId
        const exists = condition.source === "CONTACT_STATUS"
          ? Boolean(referenceId && activeStatusIds.has(referenceId))
          : Boolean(referenceId && activeUserIds.has(referenceId))
        if (!exists) {
          throw new AutomationConfigurationError(
            condition.source === "CONTACT_STATUS" ? "INVALID_STATUS_CONFIG" : "INVALID_ASSIGNEE",
            condition.source === "CONTACT_STATUS" ? "Select an active contact status." : "Select an active tenant member.",
          )
        }
        compareValue = referenceId
      }
    }

    if (condition.source !== "CONTACT_TAGS" || EMPTY_OPERATORS.has(condition.operator)) {
      compareValue = normalizeCompareValue(condition.operator, compareValue, valueType)
    }
    if (allowedOptions && !EMPTY_OPERATORS.has(condition.operator)) {
      const selectedValues = Array.isArray(compareValue) ? compareValue.map(String) : [String(compareValue)]
      if (selectedValues.some((value) => !allowedOptions!.includes(value))) {
        throw new AutomationConfigurationError("INVALID_BRANCH_VALUE", "Select an available custom-field option.")
      }
    }
    return { ...condition, conditionKey, compareValue }
  }

  const normalizeActionPath = (
    actionInputs: AutomationActionInput[],
    inheritedOutputs: Map<string, AutomationValueKind>,
    depth: number,
  ): any[] => {
    const previousOutputs = automationOutputs
    automationOutputs = new Map(inheritedOutputs)
    const pathNodeKeys = actionInputs.map((action) => action.nodeKey ?? randomUUID())

    for (const nodeKey of pathNodeKeys) {
      if (actionNodeKeys.has(nodeKey)) {
        throw new AutomationConfigurationError("DUPLICATE_ACTION_NODE_KEY", "Every automation action must have a unique node key.")
      }
      actionNodeKeys.add(nodeKey)
      totalActionCount += 1
      if (totalActionCount > MAX_AUTOMATION_ACTION_NODES) {
        throw new AutomationConfigurationError(
          "TOO_MANY_ACTIONS",
          `An automation can contain at most ${MAX_AUTOMATION_ACTION_NODES} action nodes across all branches.`,
        )
      }
    }

    const normalizedActions = actionInputs.map((action, index) => {
    const nodeKey = pathNodeKeys[index]!
    const base = depth === 0
      ? { tenantId, nodeKey, type: action.type, sortOrder: (index + 1) * 10 }
      : { nodeKey, type: action.type }
    if (action.type === "IF_ELSE") {
      if (index !== actionInputs.length - 1) {
        throw new AutomationConfigurationError("IF_ELSE_MUST_BE_LAST", "If/Else can only be the final action in its path.")
      }
      if (depth >= 3) {
        throw new AutomationConfigurationError("IF_ELSE_MAX_DEPTH", "If/Else can be nested up to three levels.")
      }
      const branchNames = new Set<string>()
      const branchKeys = new Set<string>()
      const defaultIndexes = action.ifElseConfig.branches
        .map((branch, branchIndex) => branch.isDefault ? branchIndex : -1)
        .filter((branchIndex) => branchIndex >= 0)
      if (defaultIndexes.length !== 1 || defaultIndexes[0] !== action.ifElseConfig.branches.length - 1) {
        throw new AutomationConfigurationError("INVALID_DEFAULT_BRANCH", "If/Else requires one Default branch in the last position.")
      }
      const branches = action.ifElseConfig.branches.map((branch) => {
        const branchKey = branch.branchKey ?? randomUUID()
        const normalizedName = branch.name.trim().toLocaleLowerCase()
        if (branchKeys.has(branchKey)) {
          throw new AutomationConfigurationError("DUPLICATE_BRANCH_KEY", "Every branch in an If/Else action must have a unique key.")
        }
        if (branchNames.has(normalizedName)) {
          throw new AutomationConfigurationError("DUPLICATE_BRANCH_NAME", "Branch names must be unique within an If/Else action.")
        }
        branchKeys.add(branchKey)
        branchNames.add(normalizedName)
        if (branch.isDefault) {
          if (branch.conditions.length > 0 || branch.actions.length > 0) {
            throw new AutomationConfigurationError("INVALID_DEFAULT_BRANCH", "The Default branch cannot contain conditions or actions.")
          }
          return { ...branch, branchKey, matchMode: "ALL" as const, conditions: [], actions: [] }
        }
        if (branch.conditions.length === 0) {
          throw new AutomationConfigurationError("EMPTY_IF_ELSE_BRANCH", `Add at least one condition to “${branch.name}”.`)
        }
        if (branch.actions.length === 0) {
          throw new AutomationConfigurationError("EMPTY_IF_ELSE_BRANCH", `Add at least one action to “${branch.name}”.`)
        }
        const branchOutputs = new Map(automationOutputs)
        const normalizedConditions = branch.conditions.map((condition) => normalizeBranchCondition(condition, branchOutputs))
        const branchActions = normalizeActionPath(branch.actions, branchOutputs, depth + 1)
        return { ...branch, branchKey, conditions: normalizedConditions, actions: branchActions }
      })
      return {
        ...base,
        ifElseConfig: {
          actionName: action.ifElseConfig.actionName.trim(),
          branches,
        },
      }
    }
    if (action.type === "SPLIT") {
      if (index !== actionInputs.length - 1) {
        throw new AutomationConfigurationError("SPLIT_MUST_BE_LAST", "Split can only be the final action in its path.")
      }
      if (depth >= 3) {
        throw new AutomationConfigurationError(
          "SPLIT_MAX_DEPTH",
          "Split and If/Else can be nested up to three levels.",
        )
      }
      const routeNames = new Set<string>()
      const routeKeys = new Set<string>()
      const routes = action.splitConfig.routes.map((route) => {
        const branchKey = route.branchKey ?? randomUUID()
        const normalizedName = route.name.trim().toLocaleLowerCase()
        if (routeKeys.has(branchKey)) {
          throw new AutomationConfigurationError("DUPLICATE_SPLIT_ROUTE_KEY", "Every Split route must have a unique key.")
        }
        if (routeNames.has(normalizedName)) {
          throw new AutomationConfigurationError("DUPLICATE_SPLIT_ROUTE_NAME", "Split route names must be unique.")
        }
        routeKeys.add(branchKey)
        routeNames.add(normalizedName)
        return {
          ...route,
          branchKey,
          name: route.name.trim(),
          actions: normalizeActionPath(route.actions, new Map(automationOutputs), depth + 1),
        }
      })
      if (routes.reduce((total, route) => total + route.percentage, 0) !== 100) {
        throw new AutomationConfigurationError("INVALID_SPLIT_PERCENTAGE", "Split route percentages must total 100%.")
      }
      return {
        ...base,
        splitConfig: {
          actionName: action.splitConfig.actionName.trim(),
          routes,
        },
      }
    }
    if (action.type === "GO_TO") {
      if (index !== actionInputs.length - 1) {
        throw new AutomationConfigurationError(
          "GO_TO_MUST_BE_LAST",
          "Go To can only be the final action in its path.",
        )
      }
      return {
        ...base,
        goToConfig: { targetNodeKey: action.goToConfig.targetNodeKey },
      }
    }
    if (action.type === "UPDATE_OPPORTUNITY") {
      const selectedPipeline = opportunityPipelineMap.get(action.opportunityConfig.pipelineId)
      const selectedStage = selectedPipeline?.stages.find(
        (stage: { id: string }) => stage.id === action.opportunityConfig.stageId,
      )
      if (!selectedPipeline) {
        throw new AutomationConfigurationError(
          "OPPORTUNITY_PIPELINE_NOT_FOUND",
          "Select an available opportunity pipeline.",
        )
      }
      if (!selectedStage) {
        throw new AutomationConfigurationError(
          "OPPORTUNITY_STAGE_NOT_FOUND",
          "Select a stage that belongs to the selected opportunity pipeline.",
        )
      }
      return {
        ...base,
        opportunityConfig: {
          ...action.opportunityConfig,
          actionName: action.opportunityConfig.actionName.trim(),
          pipelineNameSnapshot: selectedPipeline.name,
          stageNameSnapshot: selectedStage.name,
        },
      }
    }
    if (action.type === "DELETE_OPPORTUNITY") {
      const selectedPipeline = opportunityPipelineMap.get(action.deleteOpportunityConfig.pipelineId)
      if (!selectedPipeline) {
        throw new AutomationConfigurationError(
          "OPPORTUNITY_PIPELINE_NOT_FOUND",
          "Select an available opportunity pipeline.",
        )
      }
      return {
        ...base,
        deleteOpportunityConfig: {
          ...action.deleteOpportunityConfig,
          actionName: action.deleteOpportunityConfig.actionName.trim(),
          pipelineNameSnapshot: selectedPipeline.name,
        },
      }
    }
    if (action.type === "ADD_TO_WORKFLOW") {
      const target = publishedAutomationMap.get(action.addToWorkflowConfig.targetAutomationId)
      if (!target) {
        throw new AutomationConfigurationError(
          "TARGET_AUTOMATION_NOT_PUBLISHED",
          "Select another published automation.",
        )
      }
      if (options.sourceAutomationId && target.id === options.sourceAutomationId) {
        throw new AutomationConfigurationError(
          "AUTOMATION_WORKFLOW_SELF_REFERENCE",
          "An automation cannot add a contact to itself.",
        )
      }
      return {
        ...base,
        addToWorkflowConfig: {
          ...action.addToWorkflowConfig,
          actionName: action.addToWorkflowConfig.actionName.trim(),
          targetAutomationNameSnapshot: target.name,
        },
      }
    }
    if (action.type === "REMOVE_FROM_WORKFLOW") {
      const publishedTarget = publishedAutomationMap.get(action.removeFromWorkflowConfig.targetAutomationId)
      const target = publishedTarget && publishedTarget.id === options.sourceAutomationId
        ? { id: publishedTarget.id, name: input.name.trim() }
        : publishedTarget
      if (!target) {
        throw new AutomationConfigurationError(
          "TARGET_AUTOMATION_NOT_PUBLISHED",
          "Select a published automation.",
        )
      }
      return {
        ...base,
        removeFromWorkflowConfig: {
          ...action.removeFromWorkflowConfig,
          actionName: action.removeFromWorkflowConfig.actionName.trim(),
          targetAutomationNameSnapshot: target.name,
        },
      }
    }
    if (action.type === "CREATE_CONTACT") {
      const config = action.createContactConfig
      if (!activeStatusIds.has(config.statusConfigId)) {
        throw new AutomationConfigurationError(
          "INVALID_STATUS_CONFIG",
          "Select an active contact status for the new contact.",
        )
      }

      const availableOutputs = [...automationOutputs.keys()]
      const templates = [
        ["First name", config.firstNameTemplate, true],
        ["Middle name", config.middleNameTemplate ?? "", false],
        ["Last name", config.lastNameTemplate, true],
        ["Email", config.emailTemplate ?? "", false],
        ["Phone", config.phoneTemplate ?? "", false],
      ] as const
      for (const [label, template, required] of templates) {
        if (required && !template.trim()) {
          throw new AutomationConfigurationError(
            "INVALID_CREATE_CONTACT_TEMPLATE",
            `${label} is required.`,
          )
        }
        if (!template) continue
        const issue = validateContactTemplate(template, fields, availableOutputs).issues[0]
        if (issue) {
          throw new AutomationConfigurationError("INVALID_CREATE_CONTACT_TEMPLATE", issue.message)
        }
      }

      if (config.dateOfBirth) {
        validateCreateContactTypedSource(config.dateOfBirth, "DATE", "Date of birth")
        if (
          config.dateOfBirth.type === "FIXED" &&
          !isValidTemplateDate(String(config.dateOfBirth.value ?? ""))
        ) {
          throw new AutomationConfigurationError(
            "INVALID_CREATE_CONTACT_VALUE",
            "Date of birth must use a valid date.",
          )
        }
      }

      const customFieldValues = config.customFieldValues.map((assignment) => {
        const field = fieldMap.get(assignment.customFieldId)
        if (!field || !field.isActive || field.isEncrypted || field.isSensitive) {
          throw new AutomationConfigurationError(
            "INVALID_CUSTOM_FIELD",
            "Select an active, non-sensitive custom field for the new contact.",
          )
        }
        if (createContactUsesTemplate(field.fieldType)) {
          if (assignment.source.type !== "TEMPLATE" || !assignment.source.template.trim()) {
            throw new AutomationConfigurationError(
              "INVALID_CREATE_CONTACT_SOURCE",
              `${field.label} must use a template with a value.`,
            )
          }
          const issue = validateContactTemplate(
            assignment.source.template,
            fields,
            availableOutputs,
          ).issues[0]
          if (issue) {
            throw new AutomationConfigurationError("INVALID_CREATE_CONTACT_TEMPLATE", issue.message)
          }
          return assignment
        }
        if (assignment.source.type === "TEMPLATE") {
          throw new AutomationConfigurationError(
            "INVALID_CREATE_CONTACT_SOURCE",
            `${field.label} must use a typed value source.`,
          )
        }
        validateCreateContactTypedSource(assignment.source, field.fieldType, field.label)
        if (assignment.source.type === "FIXED") {
          const normalized = normalizeCustomFieldValue(
            { ...field, options: fieldOptions(field) },
            assignment.source.value,
          )
          if (!normalized.ok || normalized.value === null) {
            throw new AutomationConfigurationError(
              "INVALID_CREATE_CONTACT_VALUE",
              normalized.ok ? `${field.label} requires a value.` : normalized.message,
            )
          }
          return {
            ...assignment,
            source: { type: "FIXED" as const, value: normalized.value },
          }
        }
        return assignment
      })

      return {
        ...base,
        createContactConfig: {
          ...config,
          actionName: config.actionName.trim(),
          middleNameTemplate: config.middleNameTemplate?.trim() ? config.middleNameTemplate : null,
          emailTemplate: config.emailTemplate?.trim() ? config.emailTemplate : null,
          phoneTemplate: config.phoneTemplate?.trim() ? config.phoneTemplate : null,
          dateOfBirth: config.dateOfBirth ?? null,
          customFieldValues,
        },
      }
    }
    if (action.type === "DELETE_CONTACT") {
      if (index !== actionInputs.length - 1) {
        throw new AutomationConfigurationError(
          "DELETE_CONTACT_MUST_BE_LAST",
          "Delete contact can only be the last action in an automation.",
        )
      }
      return base
    }
    if (action.type === "WAIT") {
      const waitConfig = action.waitConfig.mode === "FIXED_DATE"
        ? (() => {
            const dateTime = new Date(action.waitConfig.dateTime)
            dateTime.setUTCSeconds(0, 0)
            return { ...action.waitConfig, dateTime: dateTime.toISOString() }
          })()
        : action.waitConfig
      if (waitConfig.mode === "FIXED_DATE" && waitConfig.pastBehavior === "GO_TO_STEP") {
        const targetIndex = pathNodeKeys.indexOf(waitConfig.targetNodeKey ?? "")
        if (targetIndex <= index) {
          throw new AutomationConfigurationError(
            "INVALID_WAIT_TARGET",
            "The wait action can only go to an action that appears later in the automation.",
          )
        }
      }
      return { ...base, waitConfig }
    }
    if (action.type === "MATH_OPERATION") {
      const config = action.mathOperationConfig
      if (automationOutputs.has(config.outputKey)) {
        throw new AutomationConfigurationError(
          "DUPLICATE_AUTOMATION_VALUE",
          `The automation value “${config.outputKey}” is already created by an earlier action.`,
        )
      }
      validateMathSource(config)
      automationOutputs.set(config.outputKey, config.mode === "DATE" ? "DATE" : "NUMBER")
      return { ...base, mathOperationConfig: config }
    }
    if (action.type === "FORMAT_DATE_TIME") {
      const config = action.dateTimeFormatterConfig
      if (automationOutputs.has(config.outputKey)) {
        throw new AutomationConfigurationError(
          "DUPLICATE_AUTOMATION_VALUE",
          `The automation value “${config.outputKey}” is already created by an earlier formatter.`,
        )
      }
      if (config.mode === "COMPARE_DATES") {
        validateFormatterSource(config.from, "From date")
        validateFormatterSource(config.to, "To date")
      } else {
        validateFormatterSource(config.source, "Formatter source")
      }
      automationOutputs.set(
        config.outputKey,
        config.mode === "COMPARE_DATES"
          ? "NUMBER"
          : config.format === "X"
            ? "NUMERIC_TEXT"
            : "TEXT",
      )
      return { ...base, dateTimeFormatterConfig: config }
    }
    if (action.type === "FORMAT_NUMBER") {
      const config = action.numberFormatterConfig
      if (automationOutputs.has(config.outputKey)) {
        throw new AutomationConfigurationError(
          "DUPLICATE_AUTOMATION_VALUE",
          `The automation value “${config.outputKey}” is already created by an earlier formatter.`,
        )
      }
      if (config.mode !== "RANDOM_NUMBER") {
        validateNumberFormatterSource(config.source, config.mode)
      }
      automationOutputs.set(config.outputKey, numberFormatterOutputKind(config))
      return { ...base, numberFormatterConfig: config }
    }
    if (action.type === "FORMAT_TEXT") {
      const config = action.textFormatterConfig
      if (automationOutputs.has(config.outputKey)) {
        throw new AutomationConfigurationError(
          "DUPLICATE_AUTOMATION_VALUE",
          `The automation value “${config.outputKey}” is already created by an earlier formatter.`,
        )
      }
      validateTextFormatterSource(config.source)
      automationOutputs.set(config.outputKey, textFormatterOutputKind(config))
      return { ...base, textFormatterConfig: config }
    }
    if (action.type === "ADD_CONTACT_NOTE") {
      const availableOutputs = [...automationOutputs.keys()]
      const titleValidation = validateContactTemplate(action.noteTitle, fields, availableOutputs)
      const bodyValidation = validateContactTemplate(action.noteBody, fields, availableOutputs)
      const issue = titleValidation.issues[0] ?? bodyValidation.issues[0]
      if (issue) {
        throw new AutomationConfigurationError("INVALID_NOTE_TEMPLATE", issue.message)
      }
      return {
        ...base,
        noteTitle: action.noteTitle,
        noteBody: action.noteBody,
      }
    }
    if (action.type === "CREATE_TASK") {
      const config = action.taskConfig
      const templates = [
        config.nameTemplate,
        config.descriptionTemplate ?? "",
        config.reminder?.messageTemplate ?? "",
      ]
      for (const template of templates) {
        const issue = validateContactTemplate(template, fields, [...automationOutputs.keys()]).issues[0]
        if (issue) {
          throw new AutomationConfigurationError("INVALID_TASK_TEMPLATE", issue.message)
        }
      }
      if (!activeTaskStatusIds.has(config.statusConfigId)) {
        throw new AutomationConfigurationError("INVALID_TASK_STATUS", "Select an active task status.")
      }
      if (
        config.assignee.mode === "SPECIFIC_USER" &&
        !activeUserIds.has(config.assignee.userId)
      ) {
        throw new AutomationConfigurationError("INVALID_TASK_ASSIGNEE", "Select an active task assignee.")
      }
      for (const [label, dateTime] of [
        ["Due date", config.dueAt],
        ["Reminder date", config.reminder?.at],
      ] as const) {
        if (!dateTime) continue
        const source = dateTime.source
        if (source.type === "CONTACT_FIELD") {
          const regularField = CONTACT_TEMPLATE_REGULAR_FIELDS.find((field) => field.key === source.key)
          if (!regularField || regularField.fieldType !== "DATE") {
            throw new AutomationConfigurationError("INVALID_TASK_DATE_FIELD", `${label} must use a date field.`)
          }
        } else if (source.type === "CUSTOM_FIELD") {
          const field = fieldKeyMap.get(source.key)
          if (!field || field.fieldType !== "DATE" || !field.isActive || field.isEncrypted || field.isSensitive) {
            throw new AutomationConfigurationError("INVALID_TASK_DATE_FIELD", `${label} must use an active, non-sensitive date field.`)
          }
        } else if (source.type === "SPECIFIC_DATE") {
          try {
            new Intl.DateTimeFormat("en-US", { timeZone: source.timezone }).format(new Date())
          } catch {
            throw new AutomationConfigurationError("INVALID_TASK_TIMEZONE", `${label} uses an invalid timezone.`)
          }
        }
      }
      if (config.linkedService && !serviceMap.has(config.linkedService.id)) {
        throw new AutomationConfigurationError(
          "INVALID_TASK_SERVICE",
          "Select an active linked service.",
        )
      }
      const linkedService = config.linkedService
        ? {
            id: config.linkedService.id,
            nameSnapshot: serviceMap.get(config.linkedService.id)!,
          }
        : null
      return {
        ...base,
        taskConfig: {
          ...config,
          linkedService,
        },
      }
    }
    if (action.type === "UPDATE_CONTACT_CUSTOM_FIELDS") {
      const customFieldUpdates = action.customFieldUpdates.map((update) => {
        if ("contactFieldKey" in update) {
          const field = AUTOMATION_CONTACT_UPDATE_FIELD_MAP.get(update.contactFieldKey)
          if (!field) {
            throw new AutomationConfigurationError(
              "INVALID_CONTACT_FIELD",
              "Select an available contact field.",
            )
          }
          if (update.operation === "CLEAR") {
            if (field.isRequired) {
              throw new AutomationConfigurationError(
                "REQUIRED_CONTACT_FIELD",
                `${field.label} cannot be cleared.`,
              )
            }
            return { contactFieldKey: field.key, operation: update.operation }
          }
          const normalized = normalizeAutomationContactFieldValue(field, update.value)
          if (!normalized.ok) {
            throw new AutomationConfigurationError(
              "INVALID_CONTACT_FIELD_VALUE",
              normalized.message,
            )
          }
          return {
            contactFieldKey: field.key,
            operation: update.operation,
            value: normalized.value,
          }
        }
        const field = fieldMap.get(update.customFieldId)
        if (!field || !field.isActive || field.isEncrypted || field.isSensitive) {
          throw new AutomationConfigurationError(
            "INVALID_CUSTOM_FIELD",
            "Select an active, non-sensitive custom field.",
          )
        }
        if (update.operation === "CLEAR") {
          if (field.isRequired) {
            throw new AutomationConfigurationError(
              "REQUIRED_CUSTOM_FIELD",
              `${field.label} cannot be cleared.`,
            )
          }
          return { customFieldId: field.id, operation: update.operation }
        }
        const normalized = normalizeCustomFieldValue(
          { ...field, options: fieldOptions(field) },
          update.value,
        )
        if (!normalized.ok || normalized.value === null) {
          throw new AutomationConfigurationError(
            "INVALID_CUSTOM_FIELD_VALUE",
            normalized.ok ? `${field.label} requires a value.` : normalized.message,
          )
        }
        return {
          customFieldId: field.id,
          operation: update.operation,
          value: normalized.value,
        }
      })
      return { ...base, customFieldUpdates }
    }
    if (action.type === "SET_CONTACT_CUSTOM_FIELD" || action.type === "CLEAR_CONTACT_CUSTOM_FIELD") {
      const field = fieldMap.get(action.customFieldId)
      if (!field || !field.isActive || field.isEncrypted || field.isSensitive) {
        throw new AutomationConfigurationError("INVALID_CUSTOM_FIELD", "Select an active, non-sensitive custom field.")
      }
      if (action.type === "CLEAR_CONTACT_CUSTOM_FIELD") {
        if (field.isRequired) throw new AutomationConfigurationError("REQUIRED_CUSTOM_FIELD", `${field.label} cannot be cleared.`)
        return { ...base, customFieldId: field.id }
      }
      const normalized = normalizeCustomFieldValue(
        { ...field, options: fieldOptions(field) },
        action.value,
      )
      if (!normalized.ok || normalized.value === null) {
        throw new AutomationConfigurationError("INVALID_CUSTOM_FIELD_VALUE", normalized.ok ? `${field.label} requires a value.` : normalized.message)
      }
      return { ...base, customFieldId: field.id, value: normalized.value }
    }
    if (action.type === "SET_CONTACT_STATUS") {
      if (!activeStatusIds.has(action.statusConfigId)) throw new AutomationConfigurationError("INVALID_STATUS_CONFIG", "Select an active contact status.")
      return { ...base, statusConfigId: action.statusConfigId }
    }
    if (action.type === "SET_CONTACT_ASSIGNEE") {
      if (!activeUserIds.has(action.assignedUserId)) throw new AutomationConfigurationError("INVALID_ASSIGNEE", "Select an active tenant member.")
      return { ...base, assignedUserId: action.assignedUserId }
    }
    if (action.type === "ADD_CONTACT_TAG" || action.type === "REMOVE_CONTACT_TAG") {
      if (!tagIds.has(action.tagId)) throw new AutomationConfigurationError("INVALID_TAG", "Select a tenant tag.")
      return { ...base, tagId: action.tagId }
    }
    return base
    })
    automationOutputs = previousOutputs
    return normalizedActions
  }

  const actions = normalizeActionPath(input.actions, new Map(), 0)
  validateAutomationGoToControlFlow(actions)
  if (input.isEnabled && options.sourceAutomationId) {
    validatePublishedAutomationWorkflowGraph({
      sourceAutomationId: options.sourceAutomationId,
      sourceActions: actions,
      publishedAutomations,
    })
  }

  return {
    name: input.name,
    isEnabled: input.isEnabled,
    triggerType: input.trigger.type,
    pipelineId: input.trigger.pipelineId,
    sourceStageId: null,
    targetStageId:
      input.trigger.type === "OPPORTUNITY_STAGE_CHANGED"
        ? input.trigger.targetStageId
        : null,
    conditions,
    actions,
  }
}

export type OpportunityAutomationEvent = {
  tenantId: string
  actorUserId: string | null
  triggerType: AutomationTriggerType
  opportunityId: string
  contactId: string
  pipelineId: string
  valueCents: number
  sourceStageId: string | null
  targetStageId: string | null
  chainId?: string | null
  parentEventId?: string | null
  chainDepth?: number
  transitionHistory?: OpportunityAutomationTransition[]
  sourceAutomationId?: string | null
  sourceAutomationName?: string | null
  sourceNodeKey?: string | null
  causationKey?: string | null
}

export type OpportunityAutomationTransition = {
  kind: "CREATED" | "STAGE_CHANGED"
  opportunityKey: string
  pipelineId: string
  sourceStageId: string | null
  targetStageId: string
}

export type QueueOpportunityAutomationEvent = (
  prismaTx: any,
  event: OpportunityAutomationEvent,
) => Promise<unknown>

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "empty"
  if (Array.isArray(value)) return value.length > 0 ? value.map(String).join(", ") : "empty"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function operatorExpectation(operator: AutomationOperator, expected: unknown, found: unknown) {
  const expectedLabel = displayValue(expected)
  const foundLabel = displayValue(found)
  if (operator === "EQUALS") return `expected ${expectedLabel}, found ${foundLabel}`
  if (operator === "NOT_EQUALS") return `expected anything except ${expectedLabel}, found ${foundLabel}`
  if (operator === "IS_EMPTY") return `expected empty, found ${foundLabel}`
  if (operator === "IS_NOT_EMPTY") return "expected a value, found empty"
  const descriptions: Partial<Record<AutomationOperator, string>> = {
    CONTAINS: "to contain",
    NOT_CONTAINS: "not to contain",
    GREATER_THAN: "to be greater than",
    GREATER_THAN_OR_EQUAL: "to be at least",
    LESS_THAN: "to be less than",
    LESS_THAN_OR_EQUAL: "to be at most",
    BETWEEN: "to be between",
    INCLUDES_ANY: "to include any of",
    INCLUDES_ALL: "to include all of",
    EXCLUDES_ALL: "to exclude all of",
    IS_TRUE: "to be Yes",
    IS_FALSE: "to be No",
  }
  return `expected ${descriptions[operator] ?? operator.toLocaleLowerCase()} ${expectedLabel}, found ${foundLabel}`
}

export function evaluateAutomationConditions(
  automation: any,
  event: OpportunityAutomationEvent,
  contact: {
    statusConfigId: string | null
    assignedToUserId: string | null
    tags: Array<{ tagId: string }>
    customFieldValues: Array<{ fieldId: string; value: unknown }>
  },
  catalog: AutomationRuntimeCatalog,
) {
  const values = new Map(contact.customFieldValues.map((item) => [item.fieldId, item.value]))
  const contactTagIds = contact.tags.map((item) => item.tagId)
  const failures: string[] = []

  for (const condition of automation.conditions) {
    let matches = false
    let label = "Automation filter"
    let currentValue: unknown = null
    let expectedValue: unknown = condition.compareValue

    if (condition.source === "OPPORTUNITY_VALUE") {
      label = "Opportunity value"
      currentValue = event.valueCents
      matches = evaluateAutomationOperator(condition.operator, currentValue, condition.compareValue, "number")
    } else if (condition.source === "CONTACT_STATUS") {
      label = "Contact status"
      currentValue = contact.statusConfigId
        ? catalog.statusMap.get(contact.statusConfigId) ?? contact.statusConfigId
        : null
      expectedValue = condition.statusConfigId
        ? catalog.statusMap.get(condition.statusConfigId) ?? condition.statusConfigId
        : null
      matches = evaluateAutomationOperator(
        condition.operator,
        contact.statusConfigId,
        condition.statusConfigId,
        "string",
      )
    } else if (condition.source === "CONTACT_ASSIGNEE") {
      label = "Assigned to"
      currentValue = contact.assignedToUserId
        ? catalog.userMap.get(contact.assignedToUserId) ?? contact.assignedToUserId
        : null
      expectedValue = condition.assignedUserId
        ? catalog.userMap.get(condition.assignedUserId) ?? condition.assignedUserId
        : null
      matches = evaluateAutomationOperator(
        condition.operator,
        contact.assignedToUserId,
        condition.assignedUserId,
        "string",
      )
    } else if (condition.source === "CONTACT_TAGS") {
      label = "Contact tag"
      currentValue = contactTagIds.map((tagId) => catalog.tagMap.get(tagId) ?? tagId)
      expectedValue = condition.tagId
        ? catalog.tagMap.get(condition.tagId) ?? condition.tagId
        : null
      if (condition.operator === "IS_EMPTY") matches = contactTagIds.length === 0
      else if (condition.operator === "IS_NOT_EMPTY") matches = contactTagIds.length > 0
      else if (condition.operator === "EQUALS") matches = contactTagIds.includes(condition.tagId)
      else if (condition.operator === "NOT_EQUALS") matches = !contactTagIds.includes(condition.tagId)
    } else {
      const field = condition.customFieldId ? catalog.fieldMap.get(condition.customFieldId) : null
      label = field?.label ?? "Custom field"
      currentValue = field ? values.get(field.id) ?? null : null
      matches = Boolean(field) && evaluateAutomationOperator(
        condition.operator,
        currentValue,
        condition.compareValue,
        valueTypeForCustomField(field!.fieldType),
      )
    }

    if (!matches) {
      failures.push(`${label}: ${operatorExpectation(condition.operator, expectedValue, currentValue)}.`)
    }
  }

  return { matches: failures.length === 0, failures }
}

export type AutomationRuntimeCatalog = {
  fieldMap: Map<string, CustomFieldRecord>
  fieldKeyMap: Map<string, CustomFieldRecord>
  activeStatusIds: Set<string>
  activeTaskStatusIds: Set<string>
  taskStatusMap: Map<string, string>
  activeUserIds: Set<string>
  tagIds: Set<string>
  statusMap: Map<string, string>
  userMap: Map<string, string>
  tagMap: Map<string, string>
  pipelineMap: Map<string, string>
  stageMap: Map<string, string>
  stagePipelineMap: Map<string, string>
  timezone: string
}

export async function getAutomationRuntimeCatalog(
  prismaTx: any,
  tenantId: string,
): Promise<AutomationRuntimeCatalog> {
  const [fields, statuses, taskStatuses, memberships, tags, pipelines, tenant] = await Promise.all([
    prismaTx.contactCustomField.findMany({
      where: { tenantId, isActive: true, isEncrypted: false, isSensitive: false },
      select: {
        id: true,
        key: true,
        label: true,
        fieldType: true,
        isRequired: true,
        isActive: true,
        isEncrypted: true,
        isSensitive: true,
        options: true,
      },
    }),
    prismaTx.contactStatusConfig.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true },
    }),
    prismaTx.taskStatusConfig?.findMany
      ? prismaTx.taskStatusConfig.findMany({
          where: { tenantId, isActive: true },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    prismaTx.membership.findMany({
      where: { tenantId, status: "ACTIVE" },
      select: { userId: true, user: { select: { name: true, email: true } } },
    }),
    prismaTx.tenantTag.findMany({
      where: { tenantId },
      select: { id: true, name: true },
    }),
    prismaTx.opportunityPipeline.findMany({
      where: { tenantId },
      select: { id: true, name: true, stages: { select: { id: true, name: true } } },
    }),
    prismaTx.tenant?.findUnique
      ? prismaTx.tenant.findUnique({
          where: { id: tenantId },
          select: { timezone: true },
        })
      : Promise.resolve(null),
  ])

  return {
    fieldMap: new Map<string, CustomFieldRecord>(
      fields.map((field: CustomFieldRecord) => [field.id, field]),
    ),
    fieldKeyMap: new Map<string, CustomFieldRecord>(
      fields.map((field: CustomFieldRecord) => [field.key, field]),
    ),
    activeStatusIds: new Set(statuses.map((item: any) => item.id)),
    activeTaskStatusIds: new Set(taskStatuses.map((item: any) => item.id)),
    taskStatusMap: new Map(taskStatuses.map((item: any) => [item.id, item.name])),
    activeUserIds: new Set(memberships.map((item: any) => item.userId)),
    tagIds: new Set(tags.map((item: any) => item.id)),
    statusMap: new Map(statuses.map((item: any) => [item.id, item.name])),
    userMap: new Map(memberships.map((item: any) => [
      item.userId,
      item.user?.name?.trim() || item.user?.email || item.userId,
    ])),
    tagMap: new Map(tags.map((item: any) => [item.id, item.name])),
    pipelineMap: new Map(pipelines.map((item: any) => [item.id, item.name])),
    stageMap: new Map(pipelines.flatMap((pipeline: any) =>
      pipeline.stages.map((stage: any) => [stage.id, stage.name] as const),
    )),
    stagePipelineMap: new Map(pipelines.flatMap((pipeline: any) =>
      pipeline.stages.map((stage: any) => [stage.id, pipeline.id] as const),
    )),
    timezone: tenant?.timezone?.trim() || "America/Chicago",
  }
}

type WithRequiredNodeKey<T> = T extends { nodeKey?: string }
  ? Omit<T, "nodeKey"> & { nodeKey: string }
  : T

export type RuntimeAutomationIfElseBranch = Omit<AutomationIfElseBranchInput, "branchKey" | "actions"> & {
  branchKey: string
  actions: RuntimeAutomationAction[]
}

export type RuntimeAutomationSplitRoute = Omit<AutomationSplitRouteInput, "branchKey" | "actions"> & {
  branchKey: string
  actions: RuntimeAutomationAction[]
}

export type RuntimeAutomationAction =
  | WithRequiredNodeKey<NonBranchAutomationActionInput>
  | {
      type: "IF_ELSE"
      nodeKey: string
      ifElseConfig: {
        actionName: string
        branches: RuntimeAutomationIfElseBranch[]
      }
    }
  | {
      type: "SPLIT"
      nodeKey: string
      splitConfig: {
        actionName: string
        routes: RuntimeAutomationSplitRoute[]
      }
    }

export type AutomationBranchPathEntry = {
  nodeKey: string
  branchKey: string
  branchName: string
}

export type FlattenedAutomationAction = {
  action: RuntimeAutomationAction
  nodeOrder: number
  branchPath: AutomationBranchPathEntry[]
}

export function flattenAutomationActionTree(actions: RuntimeAutomationAction[]) {
  const flattened: FlattenedAutomationAction[] = []
  const visit = (pathActions: RuntimeAutomationAction[], branchPath: AutomationBranchPathEntry[]) => {
    for (const action of pathActions) {
      flattened.push({ action, nodeOrder: flattened.length + 1, branchPath })
      if (action.type === "IF_ELSE") {
        for (const branch of action.ifElseConfig.branches) {
          if (branch.isDefault) continue
          visit(branch.actions, [
            ...branchPath,
            { nodeKey: action.nodeKey, branchKey: branch.branchKey, branchName: branch.name },
          ])
        }
      } else if (action.type === "SPLIT") {
        for (const route of action.splitConfig.routes) {
          visit(route.actions, [
            ...branchPath,
            { nodeKey: action.nodeKey, branchKey: route.branchKey, branchName: route.name },
          ])
        }
      }
    }
  }
  visit(actions, [])
  return flattened
}

function ensureRuntimeAutomationAction(action: AutomationActionInput): RuntimeAutomationAction {
  const nodeKey = action.nodeKey ?? randomUUID()
  if (action.type !== "IF_ELSE" && action.type !== "SPLIT") {
    return { ...action, nodeKey } as RuntimeAutomationAction
  }
  if (action.type === "SPLIT") {
    return {
      ...action,
      nodeKey,
      splitConfig: {
        ...action.splitConfig,
        routes: action.splitConfig.routes.map((route) => ({
          ...route,
          branchKey: route.branchKey ?? randomUUID(),
          actions: route.actions.map(ensureRuntimeAutomationAction),
        })),
      },
    }
  }
  return {
    ...action,
    nodeKey,
    ifElseConfig: {
      ...action.ifElseConfig,
      branches: action.ifElseConfig.branches.map((branch) => {
        return {
          ...branch,
          branchKey: branch.branchKey ?? randomUUID(),
          actions: branch.actions.map(ensureRuntimeAutomationAction),
        }
      }),
    },
  }
}

const CONTACT_CONTEXT_MUTATING_ACTIONS = new Set<RuntimeAutomationAction["type"]>([
  "UPDATE_CONTACT_CUSTOM_FIELDS",
  "SET_CONTACT_CUSTOM_FIELD",
  "CLEAR_CONTACT_CUSTOM_FIELD",
  "SET_CONTACT_STATUS",
  "SET_CONTACT_ASSIGNEE",
  "CLEAR_CONTACT_ASSIGNEE",
  "ADD_CONTACT_TAG",
  "REMOVE_CONTACT_TAG",
])

export type AutomationFileCleanupCandidate = {
  id: string
  tenantId: string
  key: string
}

export async function deleteAutomationContactFileObjects(
  candidates: AutomationFileCleanupCandidate[],
  deleteObject: (params: { path: string }) => Promise<void> = deletePrivateObject,
) {
  const uniqueCandidates = [...new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  ).values()]
  if (uniqueCandidates.length === 0) return

  await Promise.all(uniqueCandidates.map(async (file) => {
    let lastError: unknown = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await deleteObject({ path: file.key })
        return
      } catch (error) {
        lastError = error
      }
    }
    console.error(`Could not delete automation contact file ${file.id}`, lastError)
  }))
}

export function automationActionSnapshot(action: any): RuntimeAutomationAction {
  const nodeKey = action.nodeKey ?? action.id ?? randomUUID()
  const snapshot = action.type === "IF_ELSE"
    ? {
        nodeKey,
        type: action.type,
        ifElseConfig: action.ifElseConfig,
      }
    : action.type === "SPLIT"
      ? {
          nodeKey,
          type: action.type,
          splitConfig: action.splitConfig,
        }
    : {
        nodeKey,
        type: action.type,
        customFieldId: action.customFieldId,
        statusConfigId: action.statusConfigId,
        assignedUserId: action.assignedUserId,
        tagId: action.tagId,
        value: action.value,
        customFieldUpdates: action.customFieldUpdates,
        waitConfig: action.waitConfig,
        noteTitle: action.noteTitle,
        noteBody: action.noteBody,
        createContactConfig: action.createContactConfig,
        taskConfig: action.taskConfig,
        dateTimeFormatterConfig: action.dateTimeFormatterConfig,
        numberFormatterConfig: action.numberFormatterConfig,
        textFormatterConfig: action.textFormatterConfig,
        mathOperationConfig: action.mathOperationConfig,
        goToConfig: action.goToConfig,
        opportunityConfig: action.opportunityConfig,
        deleteOpportunityConfig: action.deleteOpportunityConfig,
        addToWorkflowConfig: action.addToWorkflowConfig,
        removeFromWorkflowConfig: action.removeFromWorkflowConfig,
      }
  const parsed = AutomationActionInputSchema.parse(snapshot)
  return ensureRuntimeAutomationAction(parsed)
}

export function parseActionSnapshot(value: unknown): RuntimeAutomationAction[] {
  const parsed = AutomationActionInputSchema.array().max(MAX_AUTOMATION_ACTION_NODES).parse(value)
  const runtimeActions = parsed.map(ensureRuntimeAutomationAction)
  const flattened = flattenAutomationActionTree(runtimeActions)
  if (flattened.length > MAX_AUTOMATION_ACTION_NODES) {
    throw new Error(`Automation run contains more than ${MAX_AUTOMATION_ACTION_NODES} action nodes.`)
  }
  if (new Set(flattened.map((item) => item.action.nodeKey)).size !== flattened.length) {
    throw new Error("Automation run contains duplicate action node keys.")
  }
  const validatePaths = (pathActions: RuntimeAutomationAction[], depth: number) => {
    for (const [index, action] of pathActions.entries()) {
      if ((action.type === "IF_ELSE" || action.type === "SPLIT" || action.type === "GO_TO") && index !== pathActions.length - 1) {
        throw new Error(`${action.type === "SPLIT" ? "Split" : action.type === "IF_ELSE" ? "If/Else" : "Go To"} must be the final action in its saved path.`)
      }
      if (action.type !== "IF_ELSE" && action.type !== "SPLIT") continue
      if (depth >= 3) throw new Error("Split and If/Else can be nested up to three levels.")
      const paths = action.type === "IF_ELSE" ? action.ifElseConfig.branches : action.splitConfig.routes
      const routeKeys = paths.map((path) => path.branchKey)
      const routeNames = paths.map((path) => path.name.trim().toLocaleLowerCase())
      if (new Set(routeKeys).size !== routeKeys.length || new Set(routeNames).size !== routeNames.length) {
        throw new Error("Saved automation routes must have unique keys and names.")
      }
      if (action.type === "SPLIT") {
        const total = action.splitConfig.routes.reduce((sum, route) => sum + route.percentage, 0)
        if (total !== 100) throw new Error("Saved Split route percentages must total 100%.")
      }
      for (const path of paths) validatePaths(path.actions, depth + 1)
    }
  }
  validatePaths(runtimeActions, 0)
  validateAutomationGoToControlFlow(runtimeActions)
  return runtimeActions
}

const WORKFLOW_REMOVAL_REASON_CODE = "CONTACT_REMOVED_FROM_WORKFLOW"
const CREATE_CONTACT_LOCK_NAMESPACE = "automation-create-contact"

function createContactDateOnly(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  const candidate = typeof value === "string" ? value.trim().slice(0, 10) : ""
  return isValidTemplateDate(candidate) ? candidate : null
}

async function resolveCreateContactTypedSource(
  prismaTx: any,
  params: {
    source: AutomationCreateContactTypedSource
    destinationType: string
    tenantId: string
    contactId: string
    automationValues: Record<string, unknown>
    templateContext?: ContactTemplateExecutionContext
    label: string
  },
) {
  if (params.source.type === "FIXED") return params.source.value
  if (params.source.type === "AUTOMATION_VALUE") {
    if (!Object.prototype.hasOwnProperty.call(params.automationValues, params.source.key)) {
      throw new Error(`The automation value “${params.source.key}” was not created for this run.`)
    }
    return params.automationValues[params.source.key]
  }
  const resolved = await resolveSafeContactTemplateFieldValue(prismaTx, {
    tenantId: params.tenantId,
    contactId: params.contactId,
    source: params.source.type,
    key: params.source.key,
    executionContext: params.templateContext,
  })
  if (!resolved || !createContactSourceFieldIsCompatible(params.destinationType, resolved.fieldType)) {
    throw new Error(`${params.label} uses a field that is no longer available or compatible.`)
  }
  return resolved.value
}

async function acquireCreateContactLocks(
  prismaTx: any,
  params: { tenantId: string; email: string | null; phone: string | null },
) {
  if (!prismaTx.$queryRaw) return
  const resourceKeys = [
    params.email ? `email:${params.email}` : null,
    params.phone ? `phone:${params.phone}` : null,
  ].filter((value): value is string => Boolean(value)).sort((left, right) => left.localeCompare(right))

  for (const resourceKey of resourceKeys) {
    const lockKey = `${params.tenantId}:${resourceKey}`
    await prismaTx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${CREATE_CONTACT_LOCK_NAMESPACE}),
        hashtext(${lockKey})
      )
    `
  }
}

export async function executeCreateContactAction(
  prismaTx: any,
  params: {
    config: AutomationCreateContactConfig
    tenantId: string
    sourceContactId: string
    catalog: AutomationRuntimeCatalog
    occurredAt: Date
    automationValues: Record<string, unknown>
    templateContext?: ContactTemplateExecutionContext
  },
) {
  const { config } = params
  if (!params.catalog.activeStatusIds.has(config.statusConfigId)) {
    throw new Error("The configured contact status is no longer available.")
  }

  const customTemplateEntries = config.customFieldValues.flatMap((assignment, index) =>
    assignment.source.type === "TEMPLATE"
      ? [[`custom_${index}`, assignment.source.template] as const]
      : [],
  )
  const rendered = await renderContactTemplates(prismaTx, {
    tenantId: params.tenantId,
    contactId: params.sourceContactId,
    templates: {
      firstName: config.firstNameTemplate,
      middleName: config.middleNameTemplate ?? "",
      lastName: config.lastNameTemplate,
      email: config.emailTemplate ?? "",
      phone: config.phoneTemplate ?? "",
      ...Object.fromEntries(customTemplateEntries),
    },
    timezone: params.catalog.timezone,
    occurredAt: params.occurredAt,
    automationValues: params.automationValues,
    executionContext: params.templateContext,
  })

  const firstName = (rendered.firstName ?? "").trim()
  const middleName = (rendered.middleName ?? "").trim() || null
  const lastName = (rendered.lastName ?? "").trim()
  const email = (rendered.email ?? "").trim().toLowerCase() || null
  const phone = (rendered.phone ?? "").trim() || null
  if (!firstName || firstName.length > 120) {
    throw new Error("The rendered first name must contain 1 to 120 characters.")
  }
  if (middleName && middleName.length > 120) {
    throw new Error("The rendered middle name must contain 120 characters or fewer.")
  }
  if (!lastName || lastName.length > 120) {
    throw new Error("The rendered last name must contain 1 to 120 characters.")
  }
  if (email && (email.length > 255 || !z.email().safeParse(email).success)) {
    throw new Error("The rendered email address is invalid.")
  }
  if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw new Error("The rendered phone number must use E.164 format.")
  }

  let dateOfBirth: string | null = null
  if (config.dateOfBirth) {
    const rawDate = await resolveCreateContactTypedSource(prismaTx, {
      source: config.dateOfBirth,
      destinationType: "DATE",
      tenantId: params.tenantId,
      contactId: params.sourceContactId,
      automationValues: params.automationValues,
      templateContext: params.templateContext,
      label: "Date of birth",
    })
    if (rawDate !== null && rawDate !== undefined && String(rawDate).trim() !== "") {
      dateOfBirth = createContactDateOnly(rawDate)
      if (!dateOfBirth) throw new Error("The resolved date of birth is invalid.")
    }
  }

  const customFieldValues: Array<{ fieldId: string; value: unknown }> = []
  for (const [index, assignment] of config.customFieldValues.entries()) {
    const field = params.catalog.fieldMap.get(assignment.customFieldId)
    if (!field) throw new Error("A configured custom field is no longer available.")
    let rawValue: unknown
    if (assignment.source.type === "TEMPLATE") {
      if (!createContactUsesTemplate(field.fieldType)) {
        throw new Error(`${field.label} no longer supports a template value.`)
      }
      rawValue = rendered[`custom_${index}`] ?? ""
    } else {
      rawValue = await resolveCreateContactTypedSource(prismaTx, {
        source: assignment.source,
        destinationType: field.fieldType,
        tenantId: params.tenantId,
        contactId: params.sourceContactId,
        automationValues: params.automationValues,
        templateContext: params.templateContext,
        label: field.label,
      })
      if (field.fieldType === "DATE") rawValue = createContactDateOnly(rawValue)
    }
    const normalized = normalizeCustomFieldValue(
      { ...field, options: fieldOptions(field) },
      rawValue,
    )
    if (!normalized.ok || normalized.value === null) {
      throw new Error(normalized.ok ? `${field.label} requires a value.` : normalized.message)
    }
    customFieldValues.push({ fieldId: field.id, value: normalized.value })
  }

  await acquireCreateContactLocks(prismaTx, { tenantId: params.tenantId, email, phone })
  const duplicateFilters = [
    email ? { email: { equals: email, mode: "insensitive" as const } } : null,
    phone ? { phone } : null,
  ].filter((value): value is NonNullable<typeof value> => Boolean(value))
  if (duplicateFilters.length > 0) {
    const existing = await prismaTx.contact.findFirst({
      where: { tenantId: params.tenantId, OR: duplicateFilters },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { email: true, phone: true },
    })
    if (existing) {
      const matchedEmail = Boolean(email && existing.email?.toLowerCase() === email)
      const matchedPhone = Boolean(phone && existing.phone === phone)
      const identifier = matchedEmail && matchedPhone
        ? "email and phone"
        : matchedEmail
          ? "email"
          : matchedPhone
            ? "phone"
            : "email or phone"
      return `Skipped creating contact because the ${identifier} already belongs to a contact.`
    }
  }

  const created = await prismaTx.contact.create({
    data: {
      tenantId: params.tenantId,
      firstName,
      middleName,
      lastName,
      email,
      phone,
      dateOfBirth: dateOfBirth ? new Date(`${dateOfBirth}T12:00:00.000Z`) : null,
      statusConfigId: config.statusConfigId,
    },
    select: { id: true },
  })
  if (customFieldValues.length > 0) {
    await prismaTx.contactCustomFieldValue.createMany({
      data: customFieldValues.map((item) => ({
        tenantId: params.tenantId,
        contactId: created.id,
        fieldId: item.fieldId,
        value: item.value,
      })),
    })
  }

  const name = [firstName, middleName, lastName].filter(Boolean).join(" ")
  return `Created contact “${name}”.`
}

async function removeContactFromWorkflowRuns(
  prismaTx: any,
  params: {
    tenantId: string
    contactId: string
    actorUserId?: string | null
    sourceAutomationId: string | null
    sourceAutomationName: string
    sourceActionName: string
    targetAutomationId: string
    targetAutomationNameSnapshot: string
    currentRunId?: string | null
    occurredAt: Date
  },
) {
  const target = await prismaTx.automation.findFirst({
    where: { tenantId: params.tenantId, id: params.targetAutomationId },
    select: { id: true, name: true },
  })
  if (!target) {
    throw new Error(`The target workflow “${params.targetAutomationNameSnapshot}” is no longer available.`)
  }

  const details = `Removed by “${params.sourceAutomationName}” from “${params.sourceActionName}”.`
  let removedCount = 0

  const queuedDispatches = prismaTx.automationDispatch?.findMany
    ? await prismaTx.automationDispatch.findMany({
        where: {
          tenantId: params.tenantId,
          automationId: target.id,
          status: "QUEUED",
          event: { contactId: params.contactId },
        },
        include: { event: true },
      })
    : []
  for (const dispatch of queuedDispatches) {
    const canceled = await prismaTx.automationDispatch.updateMany({
      where: { id: dispatch.id, status: "QUEUED" },
      data: {
        status: "CANCELED",
        completedAt: params.occurredAt,
        errorCode: WORKFLOW_REMOVAL_REASON_CODE,
        errorMessage: details,
      },
    })
    if (canceled.count !== 1) continue
    removedCount += 1
    await prismaTx.automationNodeExecution.updateMany({
      where: { id: dispatch.triggerExecutionId, status: "QUEUED" },
      data: {
        status: "SKIPPED",
        reasonCode: WORKFLOW_REMOVAL_REASON_CODE,
        details,
        actorUserId: params.actorUserId ?? null,
        occurredAt: params.occurredAt,
      },
    })
    let actions: RuntimeAutomationAction[] = []
    try {
      actions = parseActionSnapshot(dispatch.actionSnapshot)
    } catch {
      // The queued dispatch is still canceled even when its pinned snapshot cannot be read.
    }
    const logs = flattenAutomationActionTree(actions).map(({ action, nodeOrder, branchPath }) => ({
      tenantId: params.tenantId,
      automationId: dispatch.automationId,
      automationName: dispatch.automationName,
      contactId: params.contactId,
      contactName: dispatch.event.contactName,
      actorUserId: params.actorUserId ?? dispatch.event.actorUserId,
      processId: null,
      opportunityId: dispatch.event.opportunityId,
      attemptId: dispatch.attemptId,
      eventSource: dispatch.event.triggerType,
      nodeKind: "ACTION" as const,
      nodeOrder,
      nodeKey: action.nodeKey,
      nodeLabel: getAutomationActionNodeLabel(action),
      status: "SKIPPED" as const,
      reasonCode: WORKFLOW_REMOVAL_REASON_CODE,
      details,
      branchPath,
      occurredAt: params.occurredAt,
    }))
    if (logs.length > 0) await prismaTx.automationNodeExecution.createMany({ data: logs })
  }

  const activeRuns = prismaTx.automationRun?.findMany
    ? await prismaTx.automationRun.findMany({
        where: {
          tenantId: params.tenantId,
          automationId: target.id,
          contactId: params.contactId,
          status: { in: ["QUEUED", "RUNNING", "WAITING"] },
          ...(params.currentRunId ? { id: { not: params.currentRunId } } : {}),
        },
      })
    : []

  for (const run of activeRuns) {
    if (run.status === "RUNNING") {
      const requested = await prismaTx.automationRun.updateMany({
        where: { id: run.id, status: "RUNNING" },
        data: {
          exitRequestedAt: params.occurredAt,
          exitReasonCode: WORKFLOW_REMOVAL_REASON_CODE,
          exitReasonDetails: details,
        },
      })
      if (requested.count === 1) {
        removedCount += 1
        continue
      }
    }

    const exited = await prismaTx.automationRun.updateMany({
      where: { id: run.id, status: { in: ["QUEUED", "WAITING"] } },
      data: {
        status: "EXITED",
        resumeAt: null,
        waitingNodeKey: null,
        waitingNodeExecutionId: null,
        leaseToken: null,
        leaseExpiresAt: null,
        exitedAt: params.occurredAt,
        exitRequestedAt: params.occurredAt,
        exitReasonCode: WORKFLOW_REMOVAL_REASON_CODE,
        exitReasonDetails: details,
      },
    })
    if (exited.count !== 1) {
      const requested = await prismaTx.automationRun.updateMany({
        where: { id: run.id, status: "RUNNING" },
        data: {
          exitRequestedAt: params.occurredAt,
          exitReasonCode: WORKFLOW_REMOVAL_REASON_CODE,
          exitReasonDetails: details,
        },
      })
      removedCount += requested.count
      continue
    }
    removedCount += 1

    await prismaTx.automationNodeExecution.updateMany({
      where: {
        tenantId: params.tenantId,
        attemptId: run.attemptId,
        status: "WAITING",
      },
      data: {
        status: "EXECUTED",
        reasonCode: WORKFLOW_REMOVAL_REASON_CODE,
        details,
        actorUserId: params.actorUserId ?? null,
        occurredAt: params.occurredAt,
      },
    })
    await prismaTx.automationNodeExecution.updateMany({
      where: {
        tenantId: params.tenantId,
        attemptId: run.attemptId,
        status: "QUEUED",
      },
      data: {
        status: "SKIPPED",
        reasonCode: WORKFLOW_REMOVAL_REASON_CODE,
        details,
        actorUserId: params.actorUserId ?? null,
        occurredAt: params.occurredAt,
      },
    })

    let actions: RuntimeAutomationAction[] = []
    try {
      actions = parseActionSnapshot(run.actionSnapshot)
    } catch {
      // Preserve the terminal run even when its pinned snapshot cannot be read.
    }
    const priorLogs = prismaTx.automationNodeExecution?.findMany
      ? await prismaTx.automationNodeExecution.findMany({
          where: { tenantId: params.tenantId, attemptId: run.attemptId },
          select: { nodeKey: true },
        })
      : []
    const loggedNodeKeys = new Set(
      priorLogs.map((log: { nodeKey: string | null }) => log.nodeKey).filter(Boolean),
    )
    const visitedNodeKeys = new Set(normalizeAutomationCursorState(run.cursorPath).visitedNodeKeys)
    const remainingLogs = flattenAutomationActionTree(actions)
      .filter((step) => !visitedNodeKeys.has(step.action.nodeKey) && !loggedNodeKeys.has(step.action.nodeKey))
      .map(({ action, nodeOrder, branchPath }) => ({
        tenantId: params.tenantId,
        automationId: run.automationId,
        automationName: run.automationName,
        contactId: params.contactId,
        contactName: run.contactName,
        actorUserId: params.actorUserId ?? run.actorUserId,
        processId: null,
        opportunityId: run.opportunityId,
        attemptId: run.attemptId,
        eventSource: run.eventSource,
        nodeKind: "ACTION" as const,
        nodeOrder,
        nodeKey: action.nodeKey,
        nodeLabel: getAutomationActionNodeLabel(action),
        status: "SKIPPED" as const,
        reasonCode: WORKFLOW_REMOVAL_REASON_CODE,
        details,
        branchPath,
        occurredAt: params.occurredAt,
      }))
    if (remainingLogs.length > 0) {
      await prismaTx.automationNodeExecution.createMany({ data: remainingLogs })
    }
    await prismaTx.automationExecution.create({
      data: {
        tenantId: params.tenantId,
        automationId: run.automationId,
        automationName: run.automationName,
        triggerType: run.triggerType,
        status: "EXITED",
        opportunityId: run.opportunityId,
        contactId: params.contactId,
        sourceStageId: run.sourceStageId,
        targetStageId: run.targetStageId,
        actorUserId: params.actorUserId ?? run.actorUserId,
        actionCount: Math.max(run.cursorIndex, visitedNodeKeys.size),
        errorCode: WORKFLOW_REMOVAL_REASON_CODE,
        errorMessage: details,
      },
    })
  }

  const exitCurrentRun = params.sourceAutomationId === target.id
  if (exitCurrentRun) removedCount += 1
  return { targetName: target.name, removedCount, exitCurrentRun, details }
}

async function applyAutomationAction(
  prismaTx: any,
  params: {
    action: RuntimeAutomationAction
    actionIndex: number
    automationId: string | null
    automationName: string
    tenantId: string
    contactId: string
    contactName: string
    opportunityId?: string | null
    actorUserId?: string | null
    catalog: AutomationRuntimeCatalog
    occurredAt: Date
    runId?: string | null
    eventContext?: AutomationOpportunityEventContext
    queueOpportunityEvent?: QueueOpportunityAutomationEvent
    automationValues: Record<string, unknown>
    templateContext?: ContactTemplateExecutionContext
  },
) {
  const {
    action,
    actionIndex,
    automationId,
    automationName,
    tenantId,
    contactId,
    contactName,
    opportunityId,
    actorUserId,
    catalog,
    occurredAt,
    runId,
    eventContext = {},
    queueOpportunityEvent,
    automationValues,
    templateContext,
  } = params
  try {
    if (action.type === "UPDATE_CONTACT_CUSTOM_FIELDS") {
      const preparedUpdates = action.customFieldUpdates.map((update) => {
        if ("contactFieldKey" in update) {
          const field = AUTOMATION_CONTACT_UPDATE_FIELD_MAP.get(update.contactFieldKey)
          if (!field) {
            throw new Error("A configured contact field is unavailable.")
          }
          if (update.operation === "CLEAR") {
            if (field.isRequired) {
              throw new Error(`${field.label} cannot be cleared.`)
            }
            return { source: "CONTACT" as const, field, operation: update.operation }
          }
          const normalized = normalizeAutomationContactFieldValue(field, update.value)
          if (!normalized.ok) throw new Error(normalized.message)
          return {
            source: "CONTACT" as const,
            field,
            operation: update.operation,
            value: normalized.value,
          }
        }
        const field = catalog.fieldMap.get(update.customFieldId)
        if (!field) {
          throw new Error("A configured custom field is unavailable.")
        }
        if (update.operation === "CLEAR") {
          if (field.isRequired) {
            throw new Error(`${field.label} cannot be cleared.`)
          }
          return { source: "CUSTOM_FIELD" as const, field, operation: update.operation }
        }
        const normalized = normalizeCustomFieldValue(
          { ...field, options: fieldOptions(field) },
          update.value,
        )
        if (!normalized.ok || normalized.value === null) {
          throw new Error(normalized.ok ? `${field.label} requires a value.` : normalized.message)
        }
        return {
          source: "CUSTOM_FIELD" as const,
          field,
          operation: update.operation,
          value: normalized.value,
        }
      })

      const contactData: Record<string, unknown> = {}
      for (const update of preparedUpdates) {
        if (update.source === "CONTACT") {
          contactData[update.field.key] = update.operation === "CLEAR"
            ? null
            : contactFieldPersistenceValue(update.field, update.value)
          continue
        }
        if (update.operation === "CLEAR") {
          await prismaTx.contactCustomFieldValue.deleteMany({
            where: { tenantId, contactId, fieldId: update.field.id },
          })
          continue
        }
        await prismaTx.contactCustomFieldValue.upsert({
          where: { tenantId_contactId_fieldId: { tenantId, contactId, fieldId: update.field.id } },
          create: { tenantId, contactId, fieldId: update.field.id, value: update.value },
          update: {
            value: update.value,
            valueCiphertext: null,
            valueIv: null,
            valueAuthTag: null,
            valueKeyVersion: null,
          },
        })
      }
      if (Object.keys(contactData).length > 0) {
        await prismaTx.contact.update({ where: { id: contactId }, data: contactData })
      }
      const count = action.customFieldUpdates.length
      return `Updated ${count} contact field${count === 1 ? "" : "s"}.`
    } else if (action.type === "SET_CONTACT_CUSTOM_FIELD") {
      const field = catalog.fieldMap.get(action.customFieldId)
      if (!field) throw new Error("The configured custom field is unavailable.")
      const normalized = normalizeCustomFieldValue(
        { ...field, options: fieldOptions(field) },
        action.value,
      )
      if (!normalized.ok || normalized.value === null) {
        throw new Error(normalized.ok ? `${field.label} requires a value.` : normalized.message)
      }
      await prismaTx.contactCustomFieldValue.upsert({
        where: { tenantId_contactId_fieldId: { tenantId, contactId, fieldId: field.id } },
        create: { tenantId, contactId, fieldId: field.id, value: normalized.value },
        update: {
          value: normalized.value,
          valueCiphertext: null,
          valueIv: null,
          valueAuthTag: null,
          valueKeyVersion: null,
        },
      })
    } else if (action.type === "CLEAR_CONTACT_CUSTOM_FIELD") {
      const field = catalog.fieldMap.get(action.customFieldId)
      if (!field || field.isRequired) throw new Error("The configured custom field cannot be cleared.")
      await prismaTx.contactCustomFieldValue.deleteMany({ where: { tenantId, contactId, fieldId: field.id } })
    } else if (action.type === "SET_CONTACT_STATUS") {
      if (!catalog.activeStatusIds.has(action.statusConfigId)) {
        throw new Error("The configured contact status is unavailable.")
      }
      await prismaTx.contact.update({ where: { id: contactId }, data: { statusConfigId: action.statusConfigId } })
    } else if (action.type === "SET_CONTACT_ASSIGNEE") {
      if (!catalog.activeUserIds.has(action.assignedUserId)) {
        throw new Error("The configured assignee is unavailable.")
      }
      await prismaTx.contact.update({ where: { id: contactId }, data: { assignedToUserId: action.assignedUserId } })
    } else if (action.type === "CLEAR_CONTACT_ASSIGNEE") {
      await prismaTx.contact.update({ where: { id: contactId }, data: { assignedToUserId: null } })
    } else if (action.type === "ADD_CONTACT_TAG") {
      if (!catalog.tagIds.has(action.tagId)) throw new Error("The configured tag is unavailable.")
      await prismaTx.contactTag.upsert({
        where: { tenantId_contactId_tagId: { tenantId, contactId, tagId: action.tagId } },
        create: { tenantId, contactId, tagId: action.tagId },
        update: {},
      })
    } else if (action.type === "REMOVE_CONTACT_TAG") {
      if (!catalog.tagIds.has(action.tagId)) throw new Error("The configured tag is unavailable.")
      await prismaTx.contactTag.deleteMany({ where: { tenantId, contactId, tagId: action.tagId } })
    } else if (action.type === "ADD_CONTACT_NOTE") {
      const rendered = await renderContactNoteTemplates(prismaTx, {
        tenantId,
        contactId,
        titleTemplate: action.noteTitle,
        bodyTemplate: action.noteBody,
        timezone: catalog.timezone,
        occurredAt,
        automationValues,
        executionContext: templateContext,
      })
      const title = NoteTitleInputSchema.safeParse(rendered.title)
      if (!title.success) {
        throw new Error("The rendered contact note title must contain 1 to 160 characters.")
      }
      const body = NoteBodyInputSchema.safeParse(rendered.body)
      if (!body.success) {
        throw new Error("The rendered contact note body must contain 1 to 5,000 characters.")
      }
      await prismaTx.contactNote.create({
        data: {
          tenantId,
          contactId,
          automationId,
          automationName,
          title: title.data,
          body: body.data,
          createdById: null,
        },
      })
      return `Added contact note “${title.data}”.`
    } else if (action.type === "CREATE_CONTACT") {
      return executeCreateContactAction(prismaTx, {
        config: action.createContactConfig,
        tenantId,
        sourceContactId: contactId,
        catalog,
        occurredAt,
        automationValues,
        templateContext,
      })
    } else if (action.type === "CREATE_TASK") {
      const config: AutomationTaskConfig = action.taskConfig
      if (!catalog.activeTaskStatusIds.has(config.statusConfigId)) {
        throw new Error("The configured task status is unavailable.")
      }

      const rendered = await renderContactTemplates(prismaTx, {
        tenantId,
        contactId,
        templates: {
          name: config.nameTemplate,
          description: config.descriptionTemplate ?? "",
          reminderMessage: config.reminder?.messageTemplate ?? "",
        },
        timezone: catalog.timezone,
        occurredAt,
        automationValues,
        executionContext: templateContext,
      })
      const name = sanitizeTaskSingleLine(rendered.name ?? "")
      if (!name || name.length > 160) {
        throw new Error("The rendered task name must contain 1 to 160 characters.")
      }
      const description = sanitizeTaskMultiline(rendered.description ?? "") || null
      if (description && description.length > 4_000) {
        throw new Error("The rendered task description must contain 4,000 characters or fewer.")
      }
      const reminderMessage = sanitizeTaskMultiline(rendered.reminderMessage ?? "") || null
      if (reminderMessage && reminderMessage.length > 500) {
        throw new Error("The rendered reminder message must contain 500 characters or fewer.")
      }

      let assignedToUserId: string | null = null
      if (config.assignee.mode === "SPECIFIC_USER") {
        if (!catalog.activeUserIds.has(config.assignee.userId)) {
          throw new Error("The configured task assignee is unavailable.")
        }
        assignedToUserId = config.assignee.userId
      } else if (config.assignee.mode === "CONTACT_ASSIGNEE") {
        const contact = await prismaTx.contact.findFirst({
          where: { tenantId, id: contactId },
          select: { assignedToUserId: true },
        })
        assignedToUserId = contact?.assignedToUserId && catalog.activeUserIds.has(contact.assignedToUserId)
          ? contact.assignedToUserId
          : null
      }
      if (config.reminder && !assignedToUserId) {
        throw new Error("The task reminder requires an active assignee.")
      }

      const dueDate = config.dueAt
        ? await resolveAutomationTaskDateTime(prismaTx, {
            tenantId,
            contactId,
            config: config.dueAt,
            tenantTimezone: catalog.timezone,
            occurredAt,
            label: "The task due date",
            executionContext: templateContext,
          })
        : null
      if (dueDate && dueDate.getTime() < occurredAt.getTime()) {
        throw new Error("The task due date cannot be before the task start time.")
      }
      const reminderAt = config.reminder
        ? await resolveAutomationTaskDateTime(prismaTx, {
            tenantId,
            contactId,
            config: config.reminder.at,
            tenantTimezone: catalog.timezone,
            occurredAt,
            label: "The task reminder date",
            executionContext: templateContext,
          })
        : null
      if (
        reminderAt &&
        (!dueDate || reminderAt.getTime() < occurredAt.getTime() || reminderAt.getTime() > dueDate.getTime())
      ) {
        throw new Error("The task reminder must be between the task start and due times.")
      }

      const statusName = catalog.taskStatusMap.get(config.statusConfigId) ?? ""
      const task = await prismaTx.task.create({
        data: {
          tenantId,
          contactId,
          automationId,
          automationName,
          statusConfigId: config.statusConfigId,
          assignedToUserId,
          priority: getTaskPriorityFromDueDate(
            dueDate,
            catalog.timezone,
            isCompletedStatusName(statusName),
          ),
          name,
          description,
          dueDate,
          startedAt: occurredAt,
          linkedEntityName: config.linkedService?.nameSnapshot ?? null,
          linkedEntityType: config.linkedService ? "SERVICE" : null,
        },
        select: { id: true },
      })
      await prismaTx.taskActivity.create({
        data: {
          tenantId,
          taskId: task.id,
          actorUserId: null,
          type: "CREATED",
          title: "Task created",
          details: `Created by Automation · ${automationName}.`,
        },
      })

      if (reminderAt && assignedToUserId) {
        const membership = await prismaTx.membership.findUnique({
          where: { userId_tenantId: { userId: assignedToUserId, tenantId } },
          select: { id: true, status: true },
        })
        if (!membership || membership.status !== "ACTIVE") {
          throw new Error("The task reminder recipient is no longer active.")
        }
        await prismaTx.taskReminder.create({
          data: {
            tenantId,
            taskId: task.id,
            recipientUserId: assignedToUserId,
            membershipId: membership.id,
            createdById: null,
            remindAt: reminderAt,
            message: reminderMessage,
          },
        })
      }

      const notificationIds: string[] = []
      if (assignedToUserId) {
        const notification = await prismaTx.notification.create({
          data: {
            tenantId,
            userId: assignedToUserId,
            contactId,
            taskId: task.id,
            eventKey: `task-assigned:${task.id}:${assignedToUserId}`,
            type: "TASK_ASSIGNED",
            title: `Task assigned: ${name}`,
            body: `Automation · ${automationName} assigned this task to you.`,
          },
          select: { id: true },
        })
        notificationIds.push(notification.id)
      }

      const assignee = assignedToUserId
        ? catalog.userMap.get(assignedToUserId) ?? "an active teammate"
        : "Unassigned"
      const dueLabel = dueDate
        ? new Intl.DateTimeFormat("en-US", {
            timeZone: catalog.timezone,
            dateStyle: "medium",
            timeStyle: "short",
          }).format(dueDate)
        : null
      return {
        details: `Created task “${name}” · ${assignee}${dueLabel ? ` · Due ${dueLabel}` : ""}.`,
        notificationIds,
      }
    } else if (action.type === "FORMAT_DATE_TIME") {
      const value = await resolveAutomationDateTimeFormatter(prismaTx, {
        tenantId,
        contactId,
        config: action.dateTimeFormatterConfig,
        tenantTimezone: catalog.timezone,
        occurredAt,
        automationValues,
        executionContext: templateContext,
      })
      automationValues[action.dateTimeFormatterConfig.outputKey] = value
      return `Created automation value “${action.dateTimeFormatterConfig.outputKey}”.`
    } else if (action.type === "FORMAT_NUMBER") {
      const result = await resolveAutomationNumberFormatter(prismaTx, {
        tenantId,
        contactId,
        config: action.numberFormatterConfig,
        automationValues,
        executionContext: templateContext,
      })
      if (result.status === "EMPTY_SOURCE") {
        return "Source field was empty. No automation value was created."
      }
      automationValues[action.numberFormatterConfig.outputKey] = result.value
      return `Created automation value “${action.numberFormatterConfig.outputKey}”.`
    } else if (action.type === "FORMAT_TEXT") {
      const value = await resolveAutomationTextFormatter(prismaTx, {
        tenantId,
        contactId,
        config: action.textFormatterConfig,
        automationValues,
        executionContext: templateContext,
      })
      automationValues[action.textFormatterConfig.outputKey] = value
      return `Created automation value “${action.textFormatterConfig.outputKey}”.`
    } else if (action.type === "MATH_OPERATION") {
      const value = await resolveAutomationMathOperation(prismaTx, {
        tenantId,
        contactId,
        config: action.mathOperationConfig,
        tenantTimezone: catalog.timezone,
        occurredAt,
        automationValues,
        executionContext: templateContext,
      })
      automationValues[action.mathOperationConfig.outputKey] = value
      return `Created automation value “${action.mathOperationConfig.outputKey}”.`
    } else if (action.type === "UPDATE_OPPORTUNITY") {
      const config = action.opportunityConfig
      const pipelineName = catalog.pipelineMap.get(config.pipelineId)
      const stageName = catalog.stageMap.get(config.stageId)
      if (!pipelineName || !stageName || catalog.stagePipelineMap.get(config.stageId) !== config.pipelineId) {
        throw new Error("The configured opportunity pipeline or stage is no longer available.")
      }
      const pipelineLabel = config.pipelineNameSnapshot || pipelineName
      const stageLabel = config.stageNameSnapshot || stageName
      if (!queueOpportunityEvent) {
        throw new Error("Opportunity event processing is unavailable for this automation run.")
      }

      const existing = await prismaTx.contactOpportunity.findUnique({
        where: {
          tenantId_contactId_pipelineId: {
            tenantId,
            contactId,
            pipelineId: config.pipelineId,
          },
        },
        select: {
          id: true,
          stageId: true,
          valueCents: true,
          result: true,
          closedAt: true,
          updatedAt: true,
        },
      })
      const desiredResult = config.resultMode === "KEEP_CURRENT"
        ? existing?.result ?? "OPEN"
        : config.resultMode
      const resultLabel = desiredResult === "OPEN" ? "Open" : desiredResult === "WON" ? "Won" : "Lost"
      const stageChanged = Boolean(existing && existing.stageId !== config.stageId)
      const resultChanged = Boolean(existing && existing.result !== desiredResult)
      const valueChanged = Boolean(existing && existing.valueCents !== config.valueCents)
      const closedAt = desiredResult === "OPEN"
        ? null
        : resultChanged || !existing?.closedAt
          ? occurredAt
          : existing.closedAt
      const closedAtChanged = Boolean(
        existing && (existing.closedAt?.getTime?.() ?? null) !== (closedAt?.getTime?.() ?? null),
      )

      if (existing && !stageChanged && !resultChanged && !closedAtChanged && !valueChanged) {
        const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
          .format(config.valueCents / 100)
        return `Opportunity already matched ${pipelineLabel} → ${stageLabel} · ${amount} · ${resultLabel}. No changes were needed.`
      }

      const transitionKind = existing ? "STAGE_CHANGED" as const : "CREATED" as const
      const shouldQueueEvent = !existing || stageChanged
      const transition: OpportunityAutomationTransition = {
        kind: transitionKind,
        opportunityKey: existing?.id ?? `${contactId}:${config.pipelineId}`,
        pipelineId: config.pipelineId,
        sourceStageId: existing?.stageId ?? null,
        targetStageId: config.stageId,
      }
      const history = eventContext.transitionHistory ?? []
      const nextDepth = (eventContext.chainDepth ?? 0) + 1
      const repeatedTransition = history.some((candidate) =>
        candidate.kind === transition.kind &&
        candidate.pipelineId === transition.pipelineId &&
        candidate.sourceStageId === transition.sourceStageId &&
        candidate.targetStageId === transition.targetStageId
      )
      if (shouldQueueEvent && (nextDepth > 20 || repeatedTransition)) {
        const loopError = new AutomationExecutionError({
          automationId,
          automationName,
          actionIndex,
          contactId,
          message: repeatedTransition
            ? "This opportunity transition already occurred in the current automation chain, so the update was stopped to prevent a loop."
            : "This opportunity update exceeded the maximum automation chain depth and was stopped to prevent a loop.",
        })
        loopError.code = "OPPORTUNITY_AUTOMATION_LOOP"
        throw loopError
      }

      let opportunityId: string
      let valueCents: number
      if (!existing) {
        const created = await prismaTx.contactOpportunity.create({
          data: {
            tenantId,
            contactId,
            pipelineId: config.pipelineId,
            stageId: config.stageId,
            valueCents: config.valueCents,
            result: desiredResult,
            closedAt,
          },
          select: { id: true, valueCents: true },
        })
        opportunityId = created.id
        valueCents = created.valueCents
        transition.opportunityKey = created.id
      } else {
        const updated = await prismaTx.contactOpportunity.updateMany({
          where: {
            tenantId,
            id: existing.id,
            updatedAt: existing.updatedAt,
          },
          data: {
            stageId: config.stageId,
            valueCents: config.valueCents,
            result: desiredResult,
            closedAt,
          },
        })
        if (updated.count !== 1) {
          const concurrencyError = new AutomationExecutionError({
            automationId,
            automationName,
            actionIndex,
            contactId,
            message: "The opportunity changed while this automation was updating it. The action will be retried safely.",
          })
          concurrencyError.code = "OPPORTUNITY_CHANGED_CONCURRENTLY"
          throw concurrencyError
        }
        opportunityId = existing.id
        valueCents = config.valueCents
      }

      if (shouldQueueEvent) {
        await queueOpportunityEvent(prismaTx, {
          tenantId,
          actorUserId: actorUserId ?? null,
          triggerType: existing ? "OPPORTUNITY_STAGE_CHANGED" : "OPPORTUNITY_CREATED",
          opportunityId,
          contactId,
          pipelineId: config.pipelineId,
          valueCents,
          sourceStageId: existing?.stageId ?? null,
          targetStageId: config.stageId,
          chainId: eventContext.chainId ?? runId ?? randomUUID(),
          parentEventId: eventContext.eventId ?? null,
          chainDepth: nextDepth,
          transitionHistory: [...history, transition],
          sourceAutomationId: automationId,
          sourceAutomationName: automationName,
          sourceNodeKey: action.nodeKey,
          causationKey: runId ? `automation-run:${runId}:node:${action.nodeKey}` : null,
        })
      }

      if (!existing) {
        const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
          .format(config.valueCents / 100)
        return `Created opportunity in ${pipelineLabel} → ${stageLabel} · ${amount} · ${resultLabel}.`
      }
      const previousStage = catalog.stageMap.get(existing.stageId) ?? "Previous stage"
      const previousResult = existing.result === "OPEN" ? "Open" : existing.result === "WON" ? "Won" : "Lost"
      const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
      const previousAmount = currencyFormatter.format(existing.valueCents / 100)
      const nextAmount = currencyFormatter.format(config.valueCents / 100)
      return `Updated opportunity from ${previousStage} · ${previousAmount} · ${previousResult} to ${stageLabel} · ${nextAmount} · ${resultLabel}.`
    } else if (action.type === "DELETE_OPPORTUNITY") {
      const config = action.deleteOpportunityConfig
      const pipelineLabel = config.pipelineNameSnapshot || catalog.pipelineMap.get(config.pipelineId) || "Selected pipeline"
      const existing = await prismaTx.contactOpportunity.findUnique({
        where: {
          tenantId_contactId_pipelineId: {
            tenantId,
            contactId,
            pipelineId: config.pipelineId,
          },
        },
        select: {
          id: true,
          stageId: true,
          valueCents: true,
          result: true,
          updatedAt: true,
        },
      })
      if (!existing) {
        return `No opportunity existed in ${pipelineLabel}. No changes were needed.`
      }

      const deleted = await prismaTx.contactOpportunity.deleteMany({
        where: {
          tenantId,
          id: existing.id,
          pipelineId: config.pipelineId,
          updatedAt: existing.updatedAt,
        },
      })
      if (deleted.count !== 1) {
        const concurrencyError = new AutomationExecutionError({
          automationId,
          automationName,
          actionIndex,
          contactId,
          message: "The opportunity changed while this automation was deleting it. The action will be retried safely.",
        })
        concurrencyError.code = "OPPORTUNITY_CHANGED_CONCURRENTLY"
        throw concurrencyError
      }

      const stageLabel = catalog.stageMap.get(existing.stageId) ?? "Unknown stage"
      const resultLabel = existing.result === "OPEN" ? "Open" : existing.result === "WON" ? "Won" : "Lost"
      const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
        .format(existing.valueCents / 100)
      return `Deleted opportunity from ${pipelineLabel} · ${stageLabel} · ${amount} · ${resultLabel}.`
    } else if (action.type === "ADD_TO_WORKFLOW") {
      const config = action.addToWorkflowConfig
      const target = await prismaTx.automation.findFirst({
        where: {
          tenantId,
          id: config.targetAutomationId,
          isEnabled: true,
        },
        select: {
          id: true,
          name: true,
          triggerType: true,
          targetStageId: true,
          actions: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
        },
      })
      if (!target) {
        throw new Error(`The target workflow “${config.targetAutomationNameSnapshot}” is no longer published or available.`)
      }
      const actions = target.actions.map(automationActionSnapshot)
      if (actions.length === 0) throw new Error(`The target workflow “${target.name}” has no actions to run.`)

      const workflowAutomationIds = [...(eventContext.workflowAutomationIds ?? [])]
      if (automationId && !workflowAutomationIds.includes(automationId)) workflowAutomationIds.push(automationId)
      const nextDepth = (eventContext.workflowStartDepth ?? 0) + 1
      if (workflowAutomationIds.includes(target.id) || nextDepth > 20) {
        const loopError = new AutomationExecutionError({
          automationId,
          automationName,
          actionIndex,
          contactId,
          message: workflowAutomationIds.includes(target.id)
            ? `The workflow “${target.name}” already ran in this workflow chain.`
            : "This workflow chain reached the maximum of 20 workflow starts.",
        })
        loopError.code = "AUTOMATION_WORKFLOW_LOOP"
        throw loopError
      }

      const causationKey = runId ? `automation-run:${runId}:workflow-node:${action.nodeKey}` : null
      const existingRun = causationKey
        ? await prismaTx.automationRun.findUnique({ where: { causationKey }, select: { id: true } })
        : null
      if (!existingRun) {
        const attemptId = randomUUID()
        const queuedAt = new Date()
        await prismaTx.automationRun.create({
          data: {
            tenantId,
            automationId: target.id,
            automationName: target.name,
            contactId,
            contactName,
            actorUserId: actorUserId ?? null,
            opportunityId: opportunityId ?? null,
            attemptId,
            causationKey,
            eventSource: "AUTOMATION_ACTION",
            triggerType: target.triggerType,
            sourceStageId: eventContext.sourceStageId ?? null,
            targetStageId: eventContext.targetStageId ?? target.targetStageId ?? null,
            actionSnapshot: actions,
            variables: {},
            cursorIndex: 0,
            branchDecisions: {},
            eventContext: {
              ...eventContext,
              workflowAutomationIds: [...workflowAutomationIds, target.id],
              workflowStartDepth: nextDepth,
              sourceWorkflowAutomationId: automationId,
              sourceWorkflowAutomationName: automationName,
              sourceWorkflowNodeKey: action.nodeKey,
              sourceWorkflowActionName: config.actionName,
            },
            status: "QUEUED",
          },
        })
        await prismaTx.automationNodeExecution.create({
          data: {
            tenantId,
            automationId: target.id,
            automationName: target.name,
            contactId,
            contactName,
            actorUserId: actorUserId ?? null,
            processId: null,
            opportunityId: opportunityId ?? null,
            attemptId,
            eventSource: "AUTOMATION_ACTION",
            nodeKind: "TRIGGER",
            nodeOrder: 0,
            nodeKey: "AUTOMATION_ACTION",
            nodeLabel: "Started by workflow",
            status: "QUEUED",
            reasonCode: "WORKFLOW_START_QUEUED",
            details: `Queued by “${automationName}” from “${config.actionName}”.`,
            occurredAt: queuedAt,
          },
        })
      }
      return {
        details: `Queued “${target.name}” to start.`,
        queuedRunCount: existingRun ? 0 : 1,
      }
    } else if (action.type === "REMOVE_FROM_WORKFLOW") {
      const config = action.removeFromWorkflowConfig
      const result = await removeContactFromWorkflowRuns(prismaTx, {
        tenantId,
        contactId,
        actorUserId,
        sourceAutomationId: automationId,
        sourceAutomationName: automationName,
        sourceActionName: config.actionName,
        targetAutomationId: config.targetAutomationId,
        targetAutomationNameSnapshot: config.targetAutomationNameSnapshot,
        currentRunId: runId,
        occurredAt,
      })
      return {
        details: result.removedCount > 0
          ? `Removed the contact from ${result.removedCount} active ${result.removedCount === 1 ? "instance" : "instances"} of “${result.targetName}”.`
          : `The contact was not active in “${result.targetName}”. No changes were needed.`,
        exitCurrentRun: result.exitCurrentRun,
        exitReasonCode: WORKFLOW_REMOVAL_REASON_CODE,
        exitReasonDetails: result.details,
      }
    } else if (action.type === "DELETE_CONTACT") {
      const currentRun = runId && prismaTx.automationRun?.findUnique
        ? await prismaTx.automationRun.findUnique({
            where: { id: runId },
            select: { dispatchId: true, dispatch: { select: { eventId: true } } },
          })
        : null
      const queuedDispatches = prismaTx.automationDispatch?.findMany
        ? await prismaTx.automationDispatch.findMany({
            where: {
              tenantId,
              status: "QUEUED",
              event: { contactId },
              ...(currentRun?.dispatchId ? { id: { not: currentRun.dispatchId } } : {}),
            },
            include: { event: true },
          })
        : []
      if (queuedDispatches.length > 0) {
        const canceledAt = new Date()
        await prismaTx.automationNodeExecution.updateMany({
          where: { id: { in: queuedDispatches.map((dispatch: any) => dispatch.triggerExecutionId) } },
          data: {
            status: "SKIPPED",
            reasonCode: "CONTACT_DELETED",
            details: "Skipped because an automation deleted the contact.",
            occurredAt: canceledAt,
          },
        })
        const canceledActionLogs = queuedDispatches.flatMap((dispatch: any) =>
          parseActionSnapshot(dispatch.actionSnapshot).map((queuedAction, queuedIndex) => ({
            tenantId,
            automationId: dispatch.automationId,
            automationName: dispatch.automationName,
            contactId,
            contactName: dispatch.event.contactName,
            actorUserId: dispatch.event.actorUserId,
            processId: null,
            opportunityId: dispatch.event.opportunityId,
            attemptId: dispatch.attemptId,
            eventSource: dispatch.event.triggerType,
            nodeKind: "ACTION" as const,
            nodeOrder: queuedIndex + 1,
            nodeKey: queuedAction.nodeKey,
            nodeLabel: getAutomationActionNodeLabel(queuedAction),
            status: "SKIPPED" as const,
            reasonCode: "CONTACT_DELETED",
            details: "Skipped because an automation deleted the contact.",
            occurredAt: canceledAt,
          })),
        )
        if (canceledActionLogs.length > 0) {
          await prismaTx.automationNodeExecution.createMany({ data: canceledActionLogs })
        }
        await prismaTx.automationDispatch.updateMany({
          where: { id: { in: queuedDispatches.map((dispatch: any) => dispatch.id) } },
          data: { status: "CANCELED", completedAt: canceledAt },
        })
        const otherEventIds = [...new Set(
          queuedDispatches
            .map((dispatch: any) => dispatch.eventId)
            .filter((eventId: string) => eventId !== currentRun?.dispatch?.eventId),
        )]
        if (otherEventIds.length > 0) {
          for (const eventId of otherEventIds) {
            const skippedCount = queuedDispatches.filter(
              (dispatch: any) => dispatch.eventId === eventId,
            ).length
            await prismaTx.automationEvent.update({
              where: { id: eventId },
              data: {
                status: "CANCELED",
                skippedCount,
                cursor: skippedCount,
                leaseToken: null,
                leaseExpiresAt: null,
                completedAt: canceledAt,
                lastError: "Canceled because an automation deleted the contact.",
              },
            })
          }
        }
      }
      const queuedOrWaitingRuns = prismaTx.automationRun?.findMany
        ? await prismaTx.automationRun.findMany({
            where: {
              tenantId,
              contactId,
              status: { in: ["QUEUED", "WAITING"] },
              ...(runId ? { id: { not: runId } } : {}),
            },
          })
        : []
      if (queuedOrWaitingRuns.length > 0) {
        const canceledAt = new Date()
        await prismaTx.automationNodeExecution.updateMany({
          where: {
            tenantId,
            attemptId: { in: queuedOrWaitingRuns.map((run: any) => run.attemptId) },
            status: { in: ["QUEUED", "WAITING"] },
          },
          data: {
            status: "SKIPPED",
            reasonCode: "CONTACT_DELETED",
            details: "The contact was deleted by an automation and removed from this workflow run.",
            occurredAt: canceledAt,
          },
        })
        const remainingLogs = queuedOrWaitingRuns.flatMap((queuedRun: any) => {
          const visited = new Set(normalizeAutomationCursorState(queuedRun.cursorPath).visitedNodeKeys ?? [])
          let steps: FlattenedAutomationAction[] = []
          try {
            steps = flattenAutomationActionTree(parseActionSnapshot(queuedRun.actionSnapshot))
          } catch {
            return []
          }
          return steps
            .filter((step) => !visited.has(step.action.nodeKey))
            .map((step) => ({
              tenantId,
              automationId: queuedRun.automationId,
              automationName: queuedRun.automationName,
              contactId,
              contactName: queuedRun.contactName,
              actorUserId: queuedRun.actorUserId,
              processId: null,
              opportunityId: queuedRun.opportunityId,
              attemptId: queuedRun.attemptId,
              eventSource: queuedRun.eventSource,
              nodeKind: "ACTION" as const,
              nodeOrder: step.nodeOrder,
              nodeKey: step.action.nodeKey,
              nodeLabel: getAutomationActionNodeLabel(step.action),
              status: "SKIPPED" as const,
              reasonCode: "CONTACT_DELETED",
              details: "Skipped because an automation deleted the contact.",
              branchPath: step.branchPath,
              occurredAt: canceledAt,
            }))
        })
        if (remainingLogs.length > 0) {
          await prismaTx.automationNodeExecution.createMany({ data: remainingLogs })
        }
        await prismaTx.automationExecution.createMany({
          data: queuedOrWaitingRuns.map((queuedRun: any) => ({
            tenantId,
            automationId: queuedRun.automationId,
            automationName: queuedRun.automationName,
            triggerType: queuedRun.triggerType,
            status: "EXITED" as const,
            opportunityId: queuedRun.opportunityId,
            contactId,
            sourceStageId: queuedRun.sourceStageId,
            targetStageId: queuedRun.targetStageId,
            actorUserId: queuedRun.actorUserId,
            actionCount: queuedRun.cursorIndex,
            errorCode: "CONTACT_DELETED",
            errorMessage: "The contact was deleted by another automation run.",
          })),
        })
      }
      const [contactNoteAttachments, serviceNoteAttachments] = await Promise.all([
        prismaTx.contactNoteAttachment.findMany({
          where: { tenantId, note: { contactId } },
          select: {
            file: { select: { id: true, tenantId: true, key: true } },
          },
        }),
        prismaTx.contactServiceNoteAttachment.findMany({
          where: { tenantId, note: { contactService: { contactId } } },
          select: {
            file: { select: { id: true, tenantId: true, key: true } },
          },
        }),
      ])
      const possibleFileCleanupCandidates = [...new Map(
        [...contactNoteAttachments, ...serviceNoteAttachments]
          .map((attachment: { file: AutomationFileCleanupCandidate }) => [
            attachment.file.id,
            attachment.file,
          ]),
      ).values()]
      await prismaTx.automationRun.updateMany({
        where: {
          tenantId,
          contactId,
          status: { in: ["QUEUED", "RUNNING", "WAITING"] },
          ...(runId ? { id: { not: runId } } : {}),
        },
        data: {
          status: "EXITED",
          resumeAt: null,
          waitingNodeKey: null,
          waitingNodeExecutionId: null,
          leaseToken: null,
          leaseExpiresAt: null,
          exitedAt: occurredAt,
        },
      })
      await prismaTx.automationNodeExecution.updateMany({
        where: { tenantId, contactId, status: "WAITING" },
        data: {
          status: "SKIPPED",
          reasonCode: "CONTACT_DELETED",
          details: "The contact was deleted by an automation and removed from all workflows.",
          occurredAt,
        },
      })
      await prismaTx.automationProcessContact.updateMany({
        where: { tenantId, contactId, status: "PENDING" },
        data: {
          status: "FAILED",
          errorCode: "CONTACT_DELETED",
          errorMessage: "The contact was deleted by an automation.",
          completedAt: occurredAt,
        },
      })
      await prismaTx.notification.updateMany({
        where: { tenantId, contactId },
        data: { contactId: null },
      })
      const deleted = await prismaTx.contact.deleteMany({ where: { tenantId, id: contactId } })
      if (deleted.count !== 1) throw new Error("The contact is no longer available.")
      const fileCleanupCandidates: AutomationFileCleanupCandidate[] =
        possibleFileCleanupCandidates.length > 0
          ? await prismaTx.file.findMany({
              where: {
                id: { in: possibleFileCleanupCandidates.map((file) => file.id) },
                noteAttachments: { none: {} },
                serviceNoteAttachments: { none: {} },
              },
              select: { id: true, tenantId: true, key: true },
            })
          : []
      if (fileCleanupCandidates.length > 0) {
        await prismaTx.file.deleteMany({
          where: { id: { in: fileCleanupCandidates.map((file) => file.id) } },
        })
      }
      return {
        details: "Deleted the contact and removed it from all workflows in this account.",
        contactDeleted: true,
        fileCleanupCandidates,
      }
    }
  } catch (error) {
    if (error instanceof AutomationExecutionError) throw error
    throw new AutomationExecutionError({
      automationId,
      automationName,
      actionIndex,
      contactId,
      message: error instanceof Error ? error.message : "The automation action could not be completed.",
    })
  }
}

export async function applyAutomationActions(
  prismaTx: any,
  params: { automation: any; tenantId: string; contactId: string; catalog: AutomationRuntimeCatalog },
) {
  const actions = params.automation.actions.map(automationActionSnapshot)
  const occurredAt = new Date()
  const automationValues: Record<string, unknown> = {}
  const templateContext = createContactTemplateExecutionContext()
  const contact = await prismaTx.contact.findFirst({
    where: { tenantId: params.tenantId, id: params.contactId },
    select: { firstName: true, middleName: true, lastName: true },
  })
  const contactName = contact ? getContactDisplayName(contact) : "Unnamed contact"
  for (let index = 0; index < actions.length; index += 1) {
    if (actions[index]!.type === "WAIT") continue
    if (actions[index]!.type === "DELETE_CONTACT" && index !== actions.length - 1) {
      throw new AutomationExecutionError({
        automationId: params.automation.id,
        automationName: params.automation.name,
        actionIndex: index,
        contactId: params.contactId,
        message: "Delete contact can only be the last action in an automation.",
      })
    }
    await applyAutomationAction(prismaTx, {
      action: actions[index]!,
      actionIndex: index,
      automationId: params.automation.id,
      automationName: params.automation.name,
      tenantId: params.tenantId,
      contactId: params.contactId,
      contactName,
      catalog: params.catalog,
      occurredAt,
      runId: null,
      automationValues,
      templateContext,
    })
    if (CONTACT_CONTEXT_MUTATING_ACTIONS.has(actions[index]!.type)) templateContext.invalidate()
  }
}

const WAIT_UNIT_MS: Record<(typeof AUTOMATION_WAIT_UNITS)[number], number> = {
  SECONDS: 1_000,
  MINUTES: 60_000,
  HOURS: 3_600_000,
  DAYS: 86_400_000,
}

function calculateWaitAt(config: AutomationWaitConfig, now: Date) {
  if (config.mode === "DURATION") {
    return new Date(now.getTime() + config.amount * WAIT_UNIT_MS[config.unit])
  }
  const anchor = new Date(config.dateTime).getTime()
  const offset = config.timing === "ON"
    ? 0
    : (config.offsetAmount ?? 0) * WAIT_UNIT_MS[config.offsetUnit ?? "MINUTES"]
  return new Date(anchor + (config.timing === "BEFORE" ? -offset : offset))
}

function formatWaitInstant(value: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(value)
}

function actionLog(
  base: Omit<AutomationNodeLogData, "id" | "nodeKind" | "nodeOrder" | "nodeKey" | "nodeLabel" | "status" | "reasonCode" | "details">,
  action: RuntimeAutomationAction,
  index: number,
  status: AutomationNodeLogData["status"],
  reasonCode: string | null,
  details: string,
  id?: string,
  metadata?: { nodeOrder: number; branchPath: AutomationBranchPathEntry[] },
): AutomationNodeLogData {
  return {
    ...(id ? { id } : {}),
    ...base,
    nodeKind: "ACTION",
    nodeOrder: metadata?.nodeOrder ?? index + 1,
    nodeKey: action.nodeKey,
    nodeLabel: getAutomationActionNodeLabel(action),
    status,
    reasonCode,
    details,
    branchPath: metadata?.branchPath ?? null,
  }
}

type AutomationBranchDecision = {
  branchKey: string
  branchName: string
  decidedAt: string
}

type AutomationBranchDecisions = Record<string, AutomationBranchDecision>

function normalizeBranchDecisions(value: unknown): AutomationBranchDecisions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const decisions: AutomationBranchDecisions = {}
  for (const [nodeKey, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue
    const record = raw as Record<string, unknown>
    if (typeof record.branchKey !== "string" || typeof record.branchName !== "string") continue
    decisions[nodeKey] = {
      branchKey: record.branchKey,
      branchName: record.branchName,
      decidedAt: typeof record.decidedAt === "string" ? record.decidedAt : new Date(0).toISOString(),
    }
  }
  return decisions
}

export function selectedAutomationActionSteps(
  actions: RuntimeAutomationAction[],
  decisions: AutomationBranchDecisions,
) {
  return automationActionContinuation(actions, decisions)
}

export function automationActionContinuation(
  actions: RuntimeAutomationAction[],
  decisions: AutomationBranchDecisions,
  startNodeKey?: string | null,
) {
  const flatByKey = new Map(flattenAutomationActionTree(actions).map((item) => [item.action.nodeKey, item]))
  const selected: FlattenedAutomationAction[] = []
  const visit = (pathActions: RuntimeAutomationAction[], startIndex = 0) => {
    for (let index = startIndex; index < pathActions.length; index += 1) {
      const action = pathActions[index]!
      const step = flatByKey.get(action.nodeKey)
      if (!step) continue
      selected.push(step)
      if (action.type !== "IF_ELSE" && action.type !== "SPLIT") continue
      const decision = decisions[action.nodeKey]
      if (!decision) return
      if (action.type === "IF_ELSE") {
        const branch = action.ifElseConfig.branches.find((candidate) => candidate.branchKey === decision.branchKey)
        if (!branch || branch.isDefault) return
        visit(branch.actions)
      } else {
        const route = action.splitConfig.routes.find((candidate) => candidate.branchKey === decision.branchKey)
        if (!route) return
        visit(route.actions)
      }
      return
    }
  }
  if (startNodeKey) {
    const location = collectAutomationControlFlowLocations(actions).get(startNodeKey)
    if (!location) return []
    visit(location.pathActions as RuntimeAutomationAction[], location.index)
  } else {
    visit(actions)
  }
  return selected
}

export function automationSplitBucket(runId: string, nodeKey: string) {
  const digest = createHash("sha256").update(`${runId}:${nodeKey}`).digest()
  return digest.readUInt32BE(0) % 100 + 1
}

export function selectAutomationSplitRoute(
  action: Extract<RuntimeAutomationAction, { type: "SPLIT" }>,
  runId: string,
) {
  const total = action.splitConfig.routes.reduce((sum, route) => sum + route.percentage, 0)
  if (total !== 100 || action.splitConfig.routes.length < 2) {
    throw new Error("The saved Split routes are invalid and must total 100%.")
  }
  const bucket = automationSplitBucket(runId, action.nodeKey)
  let boundary = 0
  for (const route of action.splitConfig.routes) {
    if (!Number.isInteger(route.percentage) || route.percentage < 1 || route.percentage > 99) {
      throw new Error("The saved Split route percentages are invalid.")
    }
    boundary += route.percentage
    if (bucket <= boundary) return route
  }
  throw new Error("The saved Split routes could not select a destination.")
}

type AutomationOpportunityEventContext = {
  pipelineId?: string | null
  valueCents?: number | null
  sourceStageId?: string | null
  targetStageId?: string | null
  occurredAt?: string | null
  eventId?: string | null
  chainId?: string | null
  chainDepth?: number
  transitionHistory?: OpportunityAutomationTransition[]
  workflowAutomationIds?: string[]
  workflowStartDepth?: number
  sourceWorkflowAutomationId?: string | null
  sourceWorkflowAutomationName?: string | null
  sourceWorkflowNodeKey?: string | null
  sourceWorkflowActionName?: string | null
}

function normalizeOpportunityEventContext(value: unknown): AutomationOpportunityEventContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  const transitionHistory = Array.isArray(record.transitionHistory)
    ? record.transitionHistory.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return []
        const transition = item as Record<string, unknown>
        if (
          (transition.kind !== "CREATED" && transition.kind !== "STAGE_CHANGED") ||
          typeof transition.opportunityKey !== "string" ||
          typeof transition.pipelineId !== "string" ||
          typeof transition.targetStageId !== "string"
        ) return []
        return [{
          kind: transition.kind,
          opportunityKey: transition.opportunityKey,
          pipelineId: transition.pipelineId,
          sourceStageId: typeof transition.sourceStageId === "string" ? transition.sourceStageId : null,
          targetStageId: transition.targetStageId,
        } satisfies OpportunityAutomationTransition]
      })
    : []
  return {
    pipelineId: typeof record.pipelineId === "string" ? record.pipelineId : null,
    valueCents: typeof record.valueCents === "number" && Number.isFinite(record.valueCents) ? record.valueCents : null,
    sourceStageId: typeof record.sourceStageId === "string" ? record.sourceStageId : null,
    targetStageId: typeof record.targetStageId === "string" ? record.targetStageId : null,
    occurredAt: typeof record.occurredAt === "string" ? record.occurredAt : null,
    eventId: typeof record.eventId === "string" ? record.eventId : null,
    chainId: typeof record.chainId === "string" ? record.chainId : null,
    chainDepth: typeof record.chainDepth === "number" && Number.isInteger(record.chainDepth)
      ? record.chainDepth
      : 0,
    transitionHistory,
    workflowAutomationIds: Array.isArray(record.workflowAutomationIds)
      ? [...new Set(record.workflowAutomationIds.filter((item): item is string => typeof item === "string"))]
      : [],
    workflowStartDepth: typeof record.workflowStartDepth === "number" && Number.isInteger(record.workflowStartDepth)
      ? record.workflowStartDepth
      : 0,
    sourceWorkflowAutomationId: typeof record.sourceWorkflowAutomationId === "string" ? record.sourceWorkflowAutomationId : null,
    sourceWorkflowAutomationName: typeof record.sourceWorkflowAutomationName === "string" ? record.sourceWorkflowAutomationName : null,
    sourceWorkflowNodeKey: typeof record.sourceWorkflowNodeKey === "string" ? record.sourceWorkflowNodeKey : null,
    sourceWorkflowActionName: typeof record.sourceWorkflowActionName === "string" ? record.sourceWorkflowActionName : null,
  }
}

async function evaluateIfElseCondition(
  prismaTx: any,
  params: {
    condition: AutomationBranchConditionInput
    run: SegmentRun
    catalog: AutomationRuntimeCatalog
    automationValues: Record<string, unknown>
    occurredAt: Date
    eventContext: AutomationOpportunityEventContext
    templateContext: ContactTemplateExecutionContext
    directContactContext: () => Promise<{
      statusConfigId: string | null
      assignedToUserId: string | null
      tagIds: string[]
    }>
  },
) {
  const { condition } = params
  let currentValue: unknown = null
  let valueType: ValueType = "string"

  if (condition.source === "CONTACT_FIELD") {
    const resolved = await resolveSafeContactTemplateFieldValue(prismaTx, {
      tenantId: params.run.tenantId,
      contactId: params.run.contactId!,
      source: "CONTACT_FIELD",
      key: condition.fieldKey,
      executionContext: params.templateContext,
    })
    currentValue = resolved?.value ?? null
    valueType = resolved ? valueTypeForCustomField(resolved.fieldType as CustomFieldType) : "string"
  } else if (condition.source === "CONTACT_CUSTOM_FIELD") {
    const field = params.catalog.fieldMap.get(condition.customFieldId)
    if (!field) throw new Error("The configured branch custom field is unavailable.")
    const resolved = await resolveSafeContactTemplateFieldValue(prismaTx, {
      tenantId: params.run.tenantId,
      contactId: params.run.contactId!,
      source: "CUSTOM_FIELD",
      key: field.key,
      executionContext: params.templateContext,
    })
    currentValue = resolved?.value ?? null
    valueType = valueTypeForCustomField(field.fieldType)
  } else if (condition.source === "CONTACT_STATUS") {
    currentValue = (await params.directContactContext()).statusConfigId
  } else if (condition.source === "CONTACT_ASSIGNEE") {
    currentValue = (await params.directContactContext()).assignedToUserId
  } else if (condition.source === "CONTACT_TAGS") {
    currentValue = (await params.directContactContext()).tagIds
    valueType = "stringArray"
  } else if (condition.source === "AUTOMATION_VALUE") {
    currentValue = params.automationValues[condition.key]
    if (typeof currentValue === "number") valueType = "number"
    else if (typeof currentValue === "boolean") valueType = "boolean"
    else if (Array.isArray(currentValue)) valueType = "stringArray"
    else if (/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(String(currentValue ?? ""))) valueType = "date"
  } else if (condition.source === "CURRENT_DATE_TIME") {
    currentValue = params.occurredAt.toISOString()
    valueType = "date"
  } else if (condition.field === "VALUE") {
    currentValue = params.eventContext.valueCents === null || params.eventContext.valueCents === undefined
      ? null
      : params.eventContext.valueCents / 100
    valueType = "number"
  } else if (condition.field === "PIPELINE") {
    currentValue = params.eventContext.pipelineId ?? null
  } else if (condition.field === "PREVIOUS_STAGE") {
    currentValue = params.eventContext.sourceStageId ?? null
  } else {
    currentValue = params.eventContext.targetStageId ?? null
  }

  if (!EMPTY_OPERATORS.has(condition.operator) && isEmptyValue(currentValue, valueType)) return false
  if (valueType === "stringArray" || condition.operator === "BETWEEN") {
    return evaluateAutomationOperator(condition.operator, currentValue, condition.compareValue, valueType)
  }
  const workflowOperators: Partial<Record<AutomationOperator, "eq" | "neq" | "includes" | "not_includes" | "gt" | "gte" | "lt" | "lte" | "is_empty" | "is_not_empty">> = {
    EQUALS: "eq",
    NOT_EQUALS: "neq",
    CONTAINS: "includes",
    NOT_CONTAINS: "not_includes",
    GREATER_THAN: "gt",
    GREATER_THAN_OR_EQUAL: "gte",
    LESS_THAN: "lt",
    LESS_THAN_OR_EQUAL: "lte",
    IS_EMPTY: "is_empty",
    IS_NOT_EMPTY: "is_not_empty",
    IS_TRUE: "eq",
    IS_FALSE: "eq",
  }
  const operator = workflowOperators[condition.operator]
  if (!operator) return false
  return evaluateWorkflowOperator({
    id: condition.conditionKey ?? "automation-condition",
    source: "variable",
    variableKey: "automation-condition",
    valueType: valueType === "date" ? "dateTime" : valueType,
    operator,
    compareValue: condition.operator === "IS_TRUE"
      ? true
      : condition.operator === "IS_FALSE"
        ? false
        : condition.compareValue,
  }, currentValue)
}

async function selectIfElseBranch(
  prismaTx: any,
  params: Omit<Parameters<typeof evaluateIfElseCondition>[1], "condition"> & {
    action: Extract<RuntimeAutomationAction, { type: "IF_ELSE" }>
  },
) {
  const defaultBranch = params.action.ifElseConfig.branches.find((branch) => branch.isDefault)
  for (const branch of params.action.ifElseConfig.branches) {
    if (branch.isDefault) continue
    const results = await Promise.all(branch.conditions.map((condition) =>
      evaluateIfElseCondition(prismaTx, { ...params, condition }),
    ))
    const matches = branch.matchMode === "ALL" ? results.every(Boolean) : results.some(Boolean)
    if (matches) return branch
  }
  if (!defaultBranch) throw new Error("The If/Else action does not contain a Default branch.")
  return defaultBranch
}

function failureLogsForSegment(
  base: Omit<AutomationNodeLogData, "id" | "nodeKind" | "nodeOrder" | "nodeKey" | "nodeLabel" | "status" | "reasonCode" | "details">,
  actions: RuntimeAutomationAction[],
  startIndex: number,
  failedIndex: number,
  completedLogs: AutomationNodeLogData[],
  message: string,
  reasonCode = "AUTOMATION_EXECUTION_FAILED",
) {
  const existing = new Map(completedLogs.map((log) => [log.nodeOrder - 1, log]))
  const logs: AutomationNodeLogData[] = []
  for (let index = startIndex; index < actions.length; index += 1) {
    const prior = existing.get(index)
    if (prior?.status === "SKIPPED") {
      logs.push(prior)
    } else if (index < failedIndex && prior) {
      logs.push({
        ...prior,
        status: "FAILED",
        reasonCode: "TRANSACTION_ROLLED_BACK",
        details: "This action ran, but its changes were rolled back because a later action failed.",
      })
    } else if (index === failedIndex) {
      logs.push(actionLog(base, actions[index]!, index, "FAILED", reasonCode, message.slice(0, 500)))
    } else if (!prior) {
      logs.push(actionLog(base, actions[index]!, index, "SKIPPED", "PREVIOUS_ACTION_FAILED", "Skipped because an earlier action failed."))
    }
  }
  return logs
}

export type SegmentRun = {
  id: string
  tenantId: string
  automationId: string | null
  automationName: string
  contactId: string | null
  contactName: string
  actorUserId: string | null
  opportunityId: string | null
  attemptId: string
  eventSource: AutomationNodeEventSource
  triggerType: AutomationTriggerType
  sourceStageId: string | null
  targetStageId: string | null
  cursorIndex: number
  cursorPath?: unknown
  branchDecisions?: unknown
  eventContext?: unknown
  variables: unknown
  exitRequestedAt?: Date | null
  exitReasonCode?: string | null
  exitReasonDetails?: string | null
}

type AutomationRunExitRequest = {
  requestedAt: Date
  reasonCode: string
  details: string
}

function exitRequestFromRun(run: Pick<SegmentRun, "exitRequestedAt" | "exitReasonCode" | "exitReasonDetails">) {
  if (!run.exitRequestedAt) return null
  return {
    requestedAt: run.exitRequestedAt,
    reasonCode: run.exitReasonCode ?? WORKFLOW_REMOVAL_REASON_CODE,
    details: run.exitReasonDetails ?? "The contact was removed from this workflow.",
  } satisfies AutomationRunExitRequest
}

async function readAutomationRunExitRequest(prismaTx: any, run: SegmentRun) {
  const pinnedRequest = exitRequestFromRun(run)
  if (pinnedRequest) return pinnedRequest
  if (!prismaTx.automationRun?.findUnique) return null
  const current = await prismaTx.automationRun.findUnique({
    where: { id: run.id },
    select: {
      status: true,
      exitRequestedAt: true,
      exitReasonCode: true,
      exitReasonDetails: true,
    },
  })
  if (!current || current.status !== "RUNNING") return null
  return exitRequestFromRun(current)
}

async function guardedAutomationRunUpdate(prismaTx: any, args: any) {
  if (prismaTx.automationRun?.updateMany) return prismaTx.automationRun.updateMany(args)
  if (!prismaTx.automationRun?.update) return { count: 0 }
  await prismaTx.automationRun.update({ where: { id: args.where.id }, data: args.data })
  return { count: 1 }
}

async function finishAutomationRunAsExited(
  prismaTx: any,
  params: {
    run: SegmentRun
    request: AutomationRunExitRequest
    occurredAt: Date
    actionCount: number
    cursorIndex: number
    cursorPath?: AutomationCursorPathState | null
    branchDecisions?: AutomationBranchDecisions
    variables: Record<string, unknown>
  },
) {
  const exited = await guardedAutomationRunUpdate(prismaTx, {
    where: { id: params.run.id, status: "RUNNING" },
    data: {
      status: "EXITED",
      cursorIndex: params.cursorIndex,
      ...(params.cursorPath !== undefined ? { cursorPath: params.cursorPath } : {}),
      ...(params.branchDecisions ? { branchDecisions: params.branchDecisions } : {}),
      resumeAt: null,
      waitingNodeKey: null,
      waitingNodeExecutionId: null,
      leaseToken: null,
      leaseExpiresAt: null,
      exitedAt: params.occurredAt,
      exitRequestedAt: params.request.requestedAt,
      exitReasonCode: params.request.reasonCode,
      exitReasonDetails: params.request.details,
      variables: params.variables,
    },
  })
  if (exited.count === 1) {
    await prismaTx.automationExecution.create({
      data: {
        tenantId: params.run.tenantId,
        automationId: params.run.automationId,
        automationName: params.run.automationName,
        triggerType: params.run.triggerType,
        status: "EXITED",
        opportunityId: params.run.opportunityId,
        contactId: params.run.contactId,
        sourceStageId: params.run.sourceStageId,
        targetStageId: params.run.targetStageId,
        actorUserId: params.run.actorUserId,
        actionCount: params.actionCount,
        errorCode: params.request.reasonCode,
        errorMessage: params.request.details,
      },
    })
  }
}

function normalizeAutomationVariables(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>
  }
  return { ...(value as Record<string, unknown>) }
}

function normalizeAutomationCursorState(value: unknown): AutomationCursorPathState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { nextNodeKey: null, visitedNodeKeys: [], goToHistory: [] }
  }
  const record = value as Record<string, unknown>
  const visitedNodeKeys = Array.isArray(record.visitedNodeKeys)
    ? record.visitedNodeKeys.filter((item): item is string => typeof item === "string")
    : []
  const goToHistory = Array.isArray(record.goToHistory)
    ? record.goToHistory.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return []
        const entry = item as Record<string, unknown>
        return typeof entry.sourceNodeKey === "string" && typeof entry.targetNodeKey === "string"
          ? [{ sourceNodeKey: entry.sourceNodeKey, targetNodeKey: entry.targetNodeKey }]
          : []
      })
    : []
  return {
    nextNodeKey: typeof record.nextNodeKey === "string" ? record.nextNodeKey : null,
    visitedNodeKeys: [...new Set(visitedNodeKeys)],
    goToHistory,
  }
}

function automationCursorState(
  nextNodeKey: string | null,
  visitedNodeKeys: Set<string>,
  goToHistory: AutomationGoToHistoryEntry[],
): AutomationCursorPathState {
  return {
    nextNodeKey,
    visitedNodeKeys: [...visitedNodeKeys],
    goToHistory,
  }
}

function appendUnvisitedAutomationLogs(params: {
  base: Omit<AutomationNodeLogData, "id" | "nodeKind" | "nodeOrder" | "nodeKey" | "nodeLabel" | "status" | "reasonCode" | "details">
  actions: RuntimeAutomationAction[]
  logs: AutomationNodeLogData[]
  visitedNodeKeys: Set<string>
  branchDecisions: AutomationBranchDecisions
  goToHistory: AutomationGoToHistoryEntry[]
  fallbackReasonCode?: string
  fallbackDetails?: string
}) {
  const flattened = flattenAutomationActionTree(params.actions)
  const loggedKeys = new Set(params.logs.map((log) => log.nodeKey))
  const locations = collectAutomationControlFlowLocations(params.actions)
  const bypassedKeys = new Set<string>()
  for (const jump of params.goToHistory) {
    const target = locations.get(jump.targetNodeKey)
    if (!target) continue
    for (let index = 0; index < target.index; index += 1) {
      bypassedKeys.add(target.pathActions[index]!.nodeKey)
    }
  }

  for (const step of flattened) {
    const nodeKey = step.action.nodeKey
    if (params.visitedNodeKeys.has(nodeKey) || loggedKeys.has(nodeKey)) continue
    let reasonCode = params.fallbackReasonCode ?? "GO_TO_BYPASSED"
    let details = params.fallbackDetails ?? "Skipped because execution continued through another automation path."
    if (bypassedKeys.has(nodeKey)) {
      reasonCode = "GO_TO_BYPASSED"
      details = "Skipped because Go To entered this path at a later action."
    } else {
      const unselectedEntry = [...step.branchPath].reverse().find((entry) => {
        const decision = params.branchDecisions[entry.nodeKey]
        return decision && decision.branchKey !== entry.branchKey
      })
      if (unselectedEntry) {
        const routingAction = locations.get(unselectedEntry.nodeKey)?.action
        reasonCode = routingAction?.type === "SPLIT" ? "ROUTE_NOT_SELECTED" : "BRANCH_NOT_SELECTED"
        details = routingAction?.type === "SPLIT"
          ? `Skipped because route “${unselectedEntry.branchName}” was not selected.`
          : `Skipped because branch “${unselectedEntry.branchName}” was not selected.`
      }
    }
    params.logs.push(actionLog(
      params.base,
      step.action,
      step.nodeOrder - 1,
      "SKIPPED",
      reasonCode,
      details,
      undefined,
      step,
    ))
    loggedKeys.add(nodeKey)
  }
  params.logs.sort((left, right) => left.nodeOrder - right.nodeOrder)
}

function branchFailureLogs(
  base: Omit<AutomationNodeLogData, "id" | "nodeKind" | "nodeOrder" | "nodeKey" | "nodeLabel" | "status" | "reasonCode" | "details">,
  steps: FlattenedAutomationAction[],
  startIndex: number,
  failedIndex: number,
  completedLogs: AutomationNodeLogData[],
  message: string,
  reasonCode = "AUTOMATION_EXECUTION_FAILED",
) {
  const priorByKey = new Map(completedLogs.map((log) => [log.nodeKey, log]))
  const selectedPathKeys = new Set(steps.map((step) => step.action.nodeKey))
  const logs = steps.slice(startIndex).map((step, relativeIndex) => {
    const index = startIndex + relativeIndex
    const prior = priorByKey.get(step.action.nodeKey)
    if (prior?.status === "SKIPPED") return prior
    if (index < failedIndex && prior) {
      return {
        ...prior,
        status: "FAILED" as const,
        reasonCode: "TRANSACTION_ROLLED_BACK",
        details: "This action ran, but its changes were rolled back because a later action failed.",
      }
    }
    if (index === failedIndex) {
      return actionLog(
        base,
        step.action,
        step.nodeOrder - 1,
        "FAILED",
        reasonCode,
        message.slice(0, 500),
        undefined,
        step,
      )
    }
    if (!prior) {
      return actionLog(
        base,
        step.action,
        step.nodeOrder - 1,
        "SKIPPED",
        "PREVIOUS_ACTION_FAILED",
        "Skipped because an earlier action failed.",
        undefined,
        step,
      )
    }
    return prior
  })
  for (const prior of completedLogs) {
    if (selectedPathKeys.has(prior.nodeKey)) continue
    if (prior.status === "SKIPPED") {
      logs.push(prior)
    } else if (prior.status === "EXECUTED") {
      logs.push({
        ...prior,
        status: "FAILED",
        reasonCode: "TRANSACTION_ROLLED_BACK",
        details: "This action ran, but its changes were rolled back because a later action failed.",
      })
    }
  }
  return logs.sort((left, right) => left.nodeOrder - right.nodeOrder)
}

async function executeBranchedAutomationSegmentTx(
  prismaTx: any,
  params: {
    run: SegmentRun
    actions: RuntimeAutomationAction[]
    catalog: AutomationRuntimeCatalog
    occurredAt?: Date
    queueOpportunityEvent?: QueueOpportunityAutomationEvent
  },
) {
  const { run, actions, catalog } = params
  if (!run.contactId) throw new Error("The contact for this automation run is no longer available.")
  const now = params.occurredAt ?? new Date()
  const base = {
    tenantId: run.tenantId,
    automationId: run.automationId,
    automationName: run.automationName,
    contactId: run.contactId,
    contactName: run.contactName,
    actorUserId: run.actorUserId,
    processId: null,
    opportunityId: run.opportunityId,
    attemptId: run.attemptId,
    eventSource: run.eventSource,
    occurredAt: now,
  } satisfies Omit<AutomationNodeLogData, "id" | "nodeKind" | "nodeOrder" | "nodeKey" | "nodeLabel" | "status" | "reasonCode" | "details">
  const logs: AutomationNodeLogData[] = []
  const notificationIds: string[] = []
  const fileCleanupCandidates: AutomationFileCleanupCandidate[] = []
  let queuedRunCount = 0
  const automationValues = normalizeAutomationVariables(run.variables)
  const branchDecisions = normalizeBranchDecisions(run.branchDecisions)
  const eventContext = normalizeOpportunityEventContext(run.eventContext)
  const templateContext = createContactTemplateExecutionContext()
  let directContactPromise: Promise<{ statusConfigId: string | null; assignedToUserId: string | null; tagIds: string[] }> | null = null
  const directContactContext = () => {
    if (!directContactPromise) {
      directContactPromise = prismaTx.contact.findFirst({
        where: { tenantId: run.tenantId, id: run.contactId },
        select: {
          statusConfigId: true,
          assignedToUserId: true,
          tags: { select: { tagId: true } },
        },
      }).then((contact: any) => {
        if (!contact) throw new Error("The contact for this If/Else action is no longer available.")
        return {
          statusConfigId: contact.statusConfigId ?? null,
          assignedToUserId: contact.assignedToUserId ?? null,
          tagIds: (contact.tags ?? []).map((item: any) => item.tagId),
        }
      })
    }
    return directContactPromise!
  }
  const invalidateContactContext = () => {
    templateContext.invalidate()
    directContactPromise = null
  }

  const cursorState = normalizeAutomationCursorState(run.cursorPath)
  const visitedNodeKeys = new Set(cursorState.visitedNodeKeys ?? [])
  const goToHistory = [...(cursorState.goToHistory ?? [])]
  const flattenedByKey = new Map(
    flattenAutomationActionTree(actions).map((candidate) => [candidate.action.nodeKey, candidate]),
  )
  const nextNodeKey = cursorState.nextNodeKey
  // Waiting runs created before graph-aware cursors only persisted the next
  // node. Preserve their completed prefix so the final audit pass cannot add
  // contradictory Skipped rows for actions that ran before the Wait.
  const rawCursorPath = run.cursorPath && typeof run.cursorPath === "object" && !Array.isArray(run.cursorPath)
    ? run.cursorPath as Record<string, unknown>
    : null
  if (nextNodeKey && !Array.isArray(rawCursorPath?.visitedNodeKeys)) {
    const legacySelectedSteps = selectedAutomationActionSteps(actions, branchDecisions)
    const legacyNextIndex = legacySelectedSteps.findIndex((step) => step.action.nodeKey === nextNodeKey)
    if (legacyNextIndex > 0) {
      for (const step of legacySelectedSteps.slice(0, legacyNextIndex)) {
        visitedNodeKeys.add(step.action.nodeKey)
      }
    }
  }
  let steps = nextNodeKey
    ? automationActionContinuation(actions, branchDecisions, nextNodeKey)
    : selectedAutomationActionSteps(actions, branchDecisions)
  let index = 0
  if (nextNodeKey && steps[0]?.action.nodeKey !== nextNodeKey) {
    throw new AutomationExecutionError({
      automationId: run.automationId,
      automationName: run.automationName,
      actionIndex: 0,
      contactId: run.contactId,
      message: "The saved branch continuation is no longer available in this pinned run.",
    })
  }
  const segmentStartIndex = Math.max(0, index)
  let contactDeleted = false
  let transitionCount = 0

  const exitRun = async (request: AutomationRunExitRequest) => {
    appendUnvisitedAutomationLogs({
      base,
      actions,
      logs,
      visitedNodeKeys,
      branchDecisions,
      goToHistory,
      fallbackReasonCode: request.reasonCode,
      fallbackDetails: request.details,
    })
    await finishAutomationRunAsExited(prismaTx, {
      run,
      request,
      occurredAt: now,
      actionCount: visitedNodeKeys.size,
      cursorIndex: visitedNodeKeys.size,
      cursorPath: automationCursorState(null, visitedNodeKeys, goToHistory),
      branchDecisions,
      variables: automationValues,
    })
    return {
      logs,
      notificationIds,
      fileCleanupCandidates,
      queuedRunCount,
      status: "EXITED" as const,
      contactDeleted: false,
    }
  }

  while (index < steps.length) {
    const pendingExit = await readAutomationRunExitRequest(prismaTx, run)
    if (pendingExit) return exitRun(pendingExit)
    const step = steps[index]!
    const action = step.action
    transitionCount += 1
    if (transitionCount > MAX_AUTOMATION_ACTION_NODES || visitedNodeKeys.has(action.nodeKey)) {
      const executionError = new AutomationExecutionError({
        automationId: run.automationId,
        automationName: run.automationName,
        actionIndex: step.nodeOrder - 1,
        contactId: run.contactId,
        message: "Go To encountered a workflow loop and stopped this run safely.",
      })
      executionError.code = "GO_TO_CYCLE_DETECTED"
      executionError.nodeExecutions = [actionLog(
        base,
        action,
        step.nodeOrder - 1,
        "FAILED",
        "GO_TO_CYCLE_DETECTED",
        executionError.message,
        undefined,
        step,
      )]
      executionError.branchDecisions = { ...branchDecisions }
      executionError.cursorPath = automationCursorState(action.nodeKey, visitedNodeKeys, goToHistory)
      throw executionError
    }

    if (action.type === "IF_ELSE") {
      try {
        const selectedBranch = await selectIfElseBranch(prismaTx, {
          action,
          run,
          catalog,
          automationValues,
          occurredAt: now,
          eventContext,
          templateContext,
          directContactContext,
        })
        branchDecisions[action.nodeKey] = {
          branchKey: selectedBranch.branchKey,
          branchName: selectedBranch.name,
          decidedAt: now.toISOString(),
        }
        logs.push(actionLog(
          base,
          action,
          step.nodeOrder - 1,
          "EXECUTED",
          selectedBranch.isDefault ? "DEFAULT_BRANCH_SELECTED" : "BRANCH_SELECTED",
          selectedBranch.isDefault
            ? `No conditions matched; selected ${selectedBranch.name}.`
            : `Selected branch “${selectedBranch.name}”.`,
          undefined,
          step,
        ))
        visitedNodeKeys.add(action.nodeKey)
        const continuation = selectedBranch.isDefault
          ? []
          : automationActionContinuation(actions, branchDecisions, selectedBranch.actions[0]?.nodeKey)
        steps = continuation
        index = 0
        continue
      } catch (error) {
        const executionError = error instanceof AutomationExecutionError
          ? error
          : new AutomationExecutionError({
              automationId: run.automationId,
              automationName: run.automationName,
              actionIndex: step.nodeOrder - 1,
              contactId: run.contactId,
              message: error instanceof Error ? error.message : "The If/Else conditions could not be evaluated.",
            })
        const failureLogs = branchFailureLogs(base, steps, segmentStartIndex, index, logs, executionError.message)
        const loggedKeys = new Set(failureLogs.map((log) => log.nodeKey))
        for (const descendant of flattenAutomationActionTree(actions)) {
          if (
            loggedKeys.has(descendant.action.nodeKey) ||
            !descendant.branchPath.some((entry) => entry.nodeKey === action.nodeKey)
          ) continue
          failureLogs.push(actionLog(
            base,
            descendant.action,
            descendant.nodeOrder - 1,
            "SKIPPED",
            "PREVIOUS_ACTION_FAILED",
            "Skipped because the If/Else conditions could not be evaluated.",
            undefined,
            descendant,
          ))
        }
        executionError.nodeExecutions = failureLogs.sort((left, right) => left.nodeOrder - right.nodeOrder)
        executionError.branchDecisions = { ...branchDecisions }
        executionError.cursorPath = automationCursorState(action.nodeKey, visitedNodeKeys, goToHistory)
        throw executionError
      }
    }

    if (action.type === "SPLIT") {
      try {
        const savedDecision = branchDecisions[action.nodeKey]
        const selectedRoute = savedDecision
          ? action.splitConfig.routes.find((route) => route.branchKey === savedDecision.branchKey)
          : selectAutomationSplitRoute(action, run.id)
        if (!selectedRoute) {
          throw new Error("The saved Split route decision is no longer available in this pinned run.")
        }
        branchDecisions[action.nodeKey] = {
          branchKey: selectedRoute.branchKey,
          branchName: selectedRoute.name,
          decidedAt: now.toISOString(),
        }
        logs.push(actionLog(
          base,
          action,
          step.nodeOrder - 1,
          "EXECUTED",
          "ROUTE_SELECTED",
          `Selected route “${selectedRoute.name}” (${selectedRoute.percentage}%).`,
          undefined,
          step,
        ))
        visitedNodeKeys.add(action.nodeKey)
        steps = selectedRoute.actions[0]
          ? automationActionContinuation(actions, branchDecisions, selectedRoute.actions[0].nodeKey)
          : []
        index = 0
        continue
      } catch (error) {
        const executionError = error instanceof AutomationExecutionError
          ? error
          : new AutomationExecutionError({
              automationId: run.automationId,
              automationName: run.automationName,
              actionIndex: step.nodeOrder - 1,
              contactId: run.contactId,
              message: error instanceof Error ? error.message : "The Split route could not be selected.",
            })
        const failureLogs = branchFailureLogs(base, steps, segmentStartIndex, index, logs, executionError.message)
        const loggedKeys = new Set(failureLogs.map((log) => log.nodeKey))
        for (const descendant of flattenAutomationActionTree(actions)) {
          if (
            loggedKeys.has(descendant.action.nodeKey) ||
            !descendant.branchPath.some((entry) => entry.nodeKey === action.nodeKey)
          ) continue
          failureLogs.push(actionLog(
            base,
            descendant.action,
            descendant.nodeOrder - 1,
            "SKIPPED",
            "PREVIOUS_ACTION_FAILED",
            "Skipped because the Split route could not be selected.",
            undefined,
            descendant,
          ))
        }
        executionError.nodeExecutions = failureLogs.sort((left, right) => left.nodeOrder - right.nodeOrder)
        executionError.branchDecisions = { ...branchDecisions }
        executionError.cursorPath = automationCursorState(action.nodeKey, visitedNodeKeys, goToHistory)
        throw executionError
      }
    }

    if (action.type === "GO_TO") {
      const targetNodeKey = action.goToConfig.targetNodeKey
      const targetStep = flattenedByKey.get(targetNodeKey)
      if (!targetStep) {
        const executionError = new AutomationExecutionError({
          automationId: run.automationId,
          automationName: run.automationName,
          actionIndex: step.nodeOrder - 1,
          contactId: run.contactId,
          message: "The configured Go To destination is no longer available in this pinned run.",
        })
        executionError.code = "GO_TO_TARGET_NOT_FOUND"
        executionError.nodeExecutions = [actionLog(
          base,
          action,
          step.nodeOrder - 1,
          "FAILED",
          "GO_TO_TARGET_NOT_FOUND",
          executionError.message,
          undefined,
          step,
        )]
        executionError.branchDecisions = { ...branchDecisions }
        executionError.cursorPath = automationCursorState(action.nodeKey, visitedNodeKeys, goToHistory)
        throw executionError
      }
      const breadcrumb = targetStep.branchPath.map((entry) => entry.branchName).join(" › ")
      logs.push(actionLog(
        base,
        action,
        step.nodeOrder - 1,
        "EXECUTED",
        "GO_TO_ROUTED",
        `Routed to “${getAutomationActionNodeLabel(targetStep.action)}”${breadcrumb ? ` in ${breadcrumb}` : ""}.`,
        undefined,
        step,
      ))
      visitedNodeKeys.add(action.nodeKey)
      goToHistory.push({ sourceNodeKey: action.nodeKey, targetNodeKey })
      for (const branchEntry of targetStep.branchPath) {
        branchDecisions[branchEntry.nodeKey] = {
          branchKey: branchEntry.branchKey,
          branchName: branchEntry.branchName,
          decidedAt: now.toISOString(),
        }
      }
      steps = automationActionContinuation(actions, branchDecisions, targetNodeKey)
      index = 0
      continue
    }

    if (action.type === "WAIT") {
      const resumeAt = calculateWaitAt(action.waitConfig, now)
      if (resumeAt.getTime() > now.getTime()) {
        const logId = randomUUID()
        logs.push(actionLog(
          base,
          action,
          step.nodeOrder - 1,
          "WAITING",
          "WAIT_SCHEDULED",
          `Waiting until ${formatWaitInstant(resumeAt, catalog.timezone)}.`,
          logId,
          step,
        ))
        visitedNodeKeys.add(action.nodeKey)
        const nextStep = steps[index + 1]
        const waiting = await guardedAutomationRunUpdate(prismaTx, {
          where: { id: run.id, status: "RUNNING", exitRequestedAt: null },
          data: {
            status: "WAITING",
            cursorIndex: index + 1,
            cursorPath: automationCursorState(nextStep?.action.nodeKey ?? null, visitedNodeKeys, goToHistory),
            branchDecisions,
            resumeAt,
            waitingNodeKey: action.nodeKey,
            waitingNodeExecutionId: logId,
            leaseToken: null,
            leaseExpiresAt: null,
            variables: automationValues,
          },
        })
        if (waiting.count !== 1) {
          logs.pop()
          visitedNodeKeys.delete(action.nodeKey)
          const exitRequest = await readAutomationRunExitRequest(prismaTx, run)
          if (exitRequest) return exitRun(exitRequest)
          throw new Error("The automation run could not be scheduled to resume.")
        }
        return { logs, notificationIds, fileCleanupCandidates, queuedRunCount, status: "WAITING" as const, contactDeleted: false }
      }

      logs.push(actionLog(
        base,
        action,
        step.nodeOrder - 1,
        "EXECUTED",
        "WAIT_TIME_PASSED",
        `The calculated wait time (${formatWaitInstant(resumeAt, catalog.timezone)}) had already passed.`,
        undefined,
        step,
      ))
      visitedNodeKeys.add(action.nodeKey)
      if (action.waitConfig.mode === "FIXED_DATE" && action.waitConfig.pastBehavior === "EXIT") {
        appendUnvisitedAutomationLogs({
          base,
          actions,
          logs,
          visitedNodeKeys,
          branchDecisions,
          goToHistory,
          fallbackReasonCode: "WAIT_EXITED",
          fallbackDetails: "Skipped because the wait action exited this run.",
        })
        const exitedForWait = await guardedAutomationRunUpdate(prismaTx, {
          where: { id: run.id, status: "RUNNING", exitRequestedAt: null },
          data: {
            status: "EXITED",
            cursorIndex: index + 1,
            cursorPath: automationCursorState(null, visitedNodeKeys, goToHistory),
            branchDecisions,
            resumeAt: null,
            waitingNodeKey: null,
            waitingNodeExecutionId: null,
            leaseToken: null,
            leaseExpiresAt: null,
            exitedAt: now,
            variables: automationValues,
          },
        })
        if (exitedForWait.count !== 1) {
          const exitRequest = await readAutomationRunExitRequest(prismaTx, run)
          if (exitRequest) return exitRun(exitRequest)
          throw new Error("The automation run could not be exited by the wait action.")
        }
        await prismaTx.automationExecution.create({
          data: {
            tenantId: run.tenantId,
            automationId: run.automationId,
            automationName: run.automationName,
            triggerType: run.triggerType,
            status: "EXITED",
            opportunityId: run.opportunityId,
            contactId: run.contactId,
            sourceStageId: run.sourceStageId,
            targetStageId: run.targetStageId,
            actorUserId: run.actorUserId,
            actionCount: index + 1,
          },
        })
        return { logs, notificationIds, fileCleanupCandidates, queuedRunCount, status: "EXITED" as const, contactDeleted: false }
      }
      if (action.waitConfig.mode === "FIXED_DATE" && action.waitConfig.pastBehavior === "GO_TO_STEP") {
        const targetNodeKey = action.waitConfig.targetNodeKey
        const targetIndex = steps.findIndex((candidate) => candidate.action.nodeKey === targetNodeKey)
        if (targetIndex <= index) {
          throw new AutomationExecutionError({
            automationId: run.automationId,
            automationName: run.automationName,
            actionIndex: step.nodeOrder - 1,
            contactId: run.contactId,
            message: "The configured wait destination is no longer available in this branch.",
          })
        }
        for (const skipped of steps.slice(index + 1, targetIndex)) {
          logs.push(actionLog(base, skipped.action, skipped.nodeOrder - 1, "SKIPPED", "WAIT_JUMPED", "Skipped because the wait action continued at a later step.", undefined, skipped))
          visitedNodeKeys.add(skipped.action.nodeKey)
        }
        index = targetIndex
        continue
      }
      index += 1
      continue
    }

    try {
      const successDetails = await applyAutomationAction(prismaTx, {
        action,
        actionIndex: step.nodeOrder - 1,
        automationId: run.automationId,
        automationName: run.automationName,
        tenantId: run.tenantId,
        contactId: run.contactId,
        contactName: run.contactName,
        opportunityId: run.opportunityId,
        actorUserId: run.actorUserId,
        catalog,
        occurredAt: now,
        runId: run.id,
        eventContext,
        queueOpportunityEvent: params.queueOpportunityEvent,
        automationValues,
        templateContext,
      })
      if (CONTACT_CONTEXT_MUTATING_ACTIONS.has(action.type)) invalidateContactContext()
      const details = typeof successDetails === "string" ? successDetails : successDetails?.details
      if (typeof successDetails === "object" && successDetails?.notificationIds) notificationIds.push(...successDetails.notificationIds)
      if (typeof successDetails === "object" && successDetails && "queuedRunCount" in successDetails && typeof successDetails.queuedRunCount === "number") {
        queuedRunCount += successDetails.queuedRunCount
      }
      if (typeof successDetails === "object" && successDetails && "contactDeleted" in successDetails && successDetails.contactDeleted === true) contactDeleted = true
      if (typeof successDetails === "object" && successDetails && "fileCleanupCandidates" in successDetails && Array.isArray(successDetails.fileCleanupCandidates)) {
        fileCleanupCandidates.push(...successDetails.fileCleanupCandidates)
      }
      logs.push(actionLog(base, action, step.nodeOrder - 1, "EXECUTED", null, details ?? "Action completed successfully.", undefined, step))
      visitedNodeKeys.add(action.nodeKey)
      const successRecord = typeof successDetails === "object" && successDetails !== null
        ? successDetails as Record<string, unknown>
        : null
      const actionExitRequest = successRecord?.exitCurrentRun === true
        ? {
            requestedAt: now,
            reasonCode: typeof successRecord.exitReasonCode === "string"
              ? successRecord.exitReasonCode
              : WORKFLOW_REMOVAL_REASON_CODE,
            details: typeof successRecord.exitReasonDetails === "string"
              ? successRecord.exitReasonDetails
              : "The contact was removed from this workflow.",
          }
        : await readAutomationRunExitRequest(prismaTx, run)
      if (actionExitRequest) return exitRun(actionExitRequest)
    } catch (error) {
      const executionError = error instanceof AutomationExecutionError
        ? error
        : new AutomationExecutionError({
            automationId: run.automationId,
            automationName: run.automationName,
            actionIndex: step.nodeOrder - 1,
            contactId: run.contactId,
            message: error instanceof Error ? error.message : "The automation action failed.",
          })
      const failureLogs = branchFailureLogs(
        base,
        steps,
        segmentStartIndex,
        index,
        logs,
        executionError.message,
        executionError.code,
      )
      appendUnvisitedAutomationLogs({
        base,
        actions,
        logs: failureLogs,
        visitedNodeKeys,
        branchDecisions,
        goToHistory,
        fallbackReasonCode: "PREVIOUS_ACTION_FAILED",
        fallbackDetails: "Skipped because an earlier action failed.",
      })
      executionError.nodeExecutions = failureLogs
      executionError.branchDecisions = { ...branchDecisions }
      executionError.cursorPath = automationCursorState(action.nodeKey, visitedNodeKeys, goToHistory)
      throw executionError
    }
    index += 1
  }

  appendUnvisitedAutomationLogs({
    base,
    actions,
    logs,
    visitedNodeKeys,
    branchDecisions,
    goToHistory,
  })

  const pendingExit = await readAutomationRunExitRequest(prismaTx, run)
  if (pendingExit) return exitRun(pendingExit)
  const succeeded = await guardedAutomationRunUpdate(prismaTx, {
    where: { id: run.id, status: "RUNNING", exitRequestedAt: null },
    data: {
      status: "SUCCEEDED",
      cursorIndex: visitedNodeKeys.size,
      cursorPath: automationCursorState(null, visitedNodeKeys, goToHistory),
      branchDecisions,
      resumeAt: null,
      waitingNodeKey: null,
      waitingNodeExecutionId: null,
      leaseToken: null,
      leaseExpiresAt: null,
      completedAt: now,
      variables: automationValues,
    },
  })
  if (succeeded.count !== 1) {
    const racedExit = await readAutomationRunExitRequest(prismaTx, run)
    if (racedExit) return exitRun(racedExit)
    throw new Error("The automation run could not be completed.")
  }
  await prismaTx.automationExecution.create({
    data: {
      tenantId: run.tenantId,
      automationId: run.automationId,
      automationName: run.automationName,
      triggerType: run.triggerType,
      status: "SUCCEEDED",
      opportunityId: run.opportunityId,
      contactId: run.contactId,
      sourceStageId: run.sourceStageId,
      targetStageId: run.targetStageId,
      actorUserId: run.actorUserId,
      actionCount: visitedNodeKeys.size,
    },
  })
  return {
    logs: contactDeleted ? logs.map((log) => ({ ...log, contactId: null })) : logs,
    notificationIds,
    fileCleanupCandidates,
    queuedRunCount,
    status: "SUCCEEDED" as const,
    contactDeleted,
  }
}

export async function executeAutomationSegmentTx(
  prismaTx: any,
  params: {
    run: SegmentRun
    actions: RuntimeAutomationAction[]
    catalog: AutomationRuntimeCatalog
    startIndex: number
    occurredAt?: Date
    queueOpportunityEvent?: QueueOpportunityAutomationEvent
  },
) {
  if (
    flattenAutomationActionTree(params.actions).some((step) =>
      step.action.type === "IF_ELSE" || step.action.type === "SPLIT" || step.action.type === "GO_TO"
    ) || params.run.cursorPath
  ) {
    return executeBranchedAutomationSegmentTx(prismaTx, params)
  }
  const { run, actions, catalog, startIndex } = params
  if (!run.contactId) throw new Error("The contact for this automation run is no longer available.")
  const now = params.occurredAt ?? new Date()
  const base = {
    tenantId: run.tenantId,
    automationId: run.automationId,
    automationName: run.automationName,
    contactId: run.contactId,
    contactName: run.contactName,
    actorUserId: run.actorUserId,
    processId: null,
    opportunityId: run.opportunityId,
    attemptId: run.attemptId,
    eventSource: run.eventSource,
    occurredAt: now,
  } satisfies Omit<AutomationNodeLogData, "id" | "nodeKind" | "nodeOrder" | "nodeKey" | "nodeLabel" | "status" | "reasonCode" | "details">
  const logs: AutomationNodeLogData[] = []
  const notificationIds: string[] = []
  const fileCleanupCandidates: AutomationFileCleanupCandidate[] = []
  let queuedRunCount = 0
  const automationValues = normalizeAutomationVariables(run.variables)
  const eventContext = normalizeOpportunityEventContext(run.eventContext)
  const templateContext = createContactTemplateExecutionContext()
  let contactDeleted = false

  const exitRun = async (request: AutomationRunExitRequest, nextIndex: number) => {
    const loggedNodeKeys = new Set(logs.map((log) => log.nodeKey))
    for (let index = nextIndex; index < actions.length; index += 1) {
      const action = actions[index]!
      if (loggedNodeKeys.has(action.nodeKey)) continue
      logs.push(actionLog(base, action, index, "SKIPPED", request.reasonCode, request.details))
    }
    await finishAutomationRunAsExited(prismaTx, {
      run,
      request,
      occurredAt: now,
      actionCount: nextIndex,
      cursorIndex: nextIndex,
      variables: automationValues,
    })
    return {
      logs,
      notificationIds,
      fileCleanupCandidates,
      queuedRunCount,
      status: "EXITED" as const,
      contactDeleted: false,
    }
  }

  for (let index = startIndex; index < actions.length; index += 1) {
    const pendingExit = await readAutomationRunExitRequest(prismaTx, run)
    if (pendingExit) return exitRun(pendingExit, index)
    const action = actions[index]!
    if (action.type === "WAIT") {
      const resumeAt = calculateWaitAt(action.waitConfig, now)
      if (resumeAt.getTime() > now.getTime()) {
        const logId = randomUUID()
        logs.push(actionLog(
          base,
          action,
          index,
          "WAITING",
          "WAIT_SCHEDULED",
          `Waiting until ${formatWaitInstant(resumeAt, catalog.timezone)}.`,
          logId,
        ))
        const waiting = await guardedAutomationRunUpdate(prismaTx, {
          where: { id: run.id, status: "RUNNING", exitRequestedAt: null },
          data: {
            status: "WAITING",
            cursorIndex: index + 1,
            resumeAt,
            waitingNodeKey: action.nodeKey,
            waitingNodeExecutionId: logId,
            leaseToken: null,
            leaseExpiresAt: null,
            variables: automationValues,
          },
        })
        if (waiting.count !== 1) {
          logs.pop()
          const exitRequest = await readAutomationRunExitRequest(prismaTx, run)
          if (exitRequest) return exitRun(exitRequest, index)
          throw new Error("The automation run could not be scheduled to resume.")
        }
        return {
          logs,
          notificationIds,
          fileCleanupCandidates,
          queuedRunCount,
          status: "WAITING" as const,
          contactDeleted: false,
        }
      }

      logs.push(actionLog(
        base,
        action,
        index,
        "EXECUTED",
        "WAIT_TIME_PASSED",
        `The calculated wait time (${formatWaitInstant(resumeAt, catalog.timezone)}) had already passed.`,
      ))

      if (action.waitConfig.mode === "FIXED_DATE" && action.waitConfig.pastBehavior === "EXIT") {
        for (let skippedIndex = index + 1; skippedIndex < actions.length; skippedIndex += 1) {
          logs.push(actionLog(base, actions[skippedIndex]!, skippedIndex, "SKIPPED", "WAIT_EXITED", "Skipped because the wait action exited this run."))
        }
        const exitedForWait = await guardedAutomationRunUpdate(prismaTx, {
          where: { id: run.id, status: "RUNNING", exitRequestedAt: null },
          data: {
            status: "EXITED",
            cursorIndex: index + 1,
            resumeAt: null,
            waitingNodeKey: null,
            waitingNodeExecutionId: null,
            leaseToken: null,
            leaseExpiresAt: null,
            exitedAt: now,
            variables: automationValues,
          },
        })
        if (exitedForWait.count !== 1) {
          const exitRequest = await readAutomationRunExitRequest(prismaTx, run)
          if (exitRequest) return exitRun(exitRequest, index + 1)
          throw new Error("The automation run could not be exited by the wait action.")
        }
        await prismaTx.automationExecution.create({
          data: {
            tenantId: run.tenantId,
            automationId: run.automationId,
            automationName: run.automationName,
            triggerType: run.triggerType,
            status: "EXITED",
            opportunityId: run.opportunityId,
            contactId: run.contactId,
            sourceStageId: run.sourceStageId,
            targetStageId: run.targetStageId,
            actorUserId: run.actorUserId,
            actionCount: index + 1,
          },
        })
        return {
          logs,
          notificationIds,
          fileCleanupCandidates,
          queuedRunCount,
          status: "EXITED" as const,
          contactDeleted: false,
        }
      }

      if (action.waitConfig.mode === "FIXED_DATE" && action.waitConfig.pastBehavior === "GO_TO_STEP") {
        const targetNodeKey = action.waitConfig.targetNodeKey
        const targetIndex = actions.findIndex((candidate) => candidate.nodeKey === targetNodeKey)
        if (targetIndex <= index) {
          throw new AutomationExecutionError({
            automationId: run.automationId,
            automationName: run.automationName,
            actionIndex: index,
            contactId: run.contactId,
            message: "The configured wait destination is no longer available.",
          })
        }
        for (let skippedIndex = index + 1; skippedIndex < targetIndex; skippedIndex += 1) {
          logs.push(actionLog(base, actions[skippedIndex]!, skippedIndex, "SKIPPED", "WAIT_JUMPED", "Skipped because the wait action continued at a later step."))
        }
        index = targetIndex - 1
      }
      continue
    }

    try {
      if (action.type === "DELETE_CONTACT" && index !== actions.length - 1) {
        throw new AutomationExecutionError({
          automationId: run.automationId,
          automationName: run.automationName,
          actionIndex: index,
          contactId: run.contactId,
          message: "Delete contact can only be the last action in an automation.",
        })
      }
      const successDetails = await applyAutomationAction(prismaTx, {
        action,
        actionIndex: index,
        automationId: run.automationId,
        automationName: run.automationName,
        tenantId: run.tenantId,
        contactId: run.contactId,
        contactName: run.contactName,
        opportunityId: run.opportunityId,
        actorUserId: run.actorUserId,
        catalog,
        occurredAt: now,
        runId: run.id,
        eventContext,
        queueOpportunityEvent: params.queueOpportunityEvent,
        automationValues,
        templateContext,
      })
      if (CONTACT_CONTEXT_MUTATING_ACTIONS.has(action.type)) templateContext.invalidate()
      const details = typeof successDetails === "string"
        ? successDetails
        : successDetails?.details
      if (typeof successDetails === "object" && successDetails?.notificationIds) {
        notificationIds.push(...successDetails.notificationIds)
      }
      if (
        typeof successDetails === "object" &&
        successDetails !== null &&
        "queuedRunCount" in successDetails &&
        typeof successDetails.queuedRunCount === "number"
      ) {
        queuedRunCount += successDetails.queuedRunCount
      }
      if (
        typeof successDetails === "object" &&
        successDetails !== null &&
        "contactDeleted" in successDetails &&
        successDetails.contactDeleted === true
      ) {
        contactDeleted = true
      }
      if (
        typeof successDetails === "object" &&
        successDetails !== null &&
        "fileCleanupCandidates" in successDetails &&
        Array.isArray(successDetails.fileCleanupCandidates)
      ) {
        fileCleanupCandidates.push(...successDetails.fileCleanupCandidates)
      }
      logs.push(actionLog(base, action, index, "EXECUTED", null, details ?? "Action completed successfully."))
      const successRecord = typeof successDetails === "object" && successDetails !== null
        ? successDetails as Record<string, unknown>
        : null
      const actionExitRequest = successRecord?.exitCurrentRun === true
        ? {
            requestedAt: now,
            reasonCode: typeof successRecord.exitReasonCode === "string"
              ? successRecord.exitReasonCode
              : WORKFLOW_REMOVAL_REASON_CODE,
            details: typeof successRecord.exitReasonDetails === "string"
              ? successRecord.exitReasonDetails
              : "The contact was removed from this workflow.",
          }
        : await readAutomationRunExitRequest(prismaTx, run)
      if (actionExitRequest) return exitRun(actionExitRequest, index + 1)
    } catch (error) {
      if (error instanceof AutomationExecutionError) {
        error.nodeExecutions = failureLogsForSegment(
          base,
          actions,
          startIndex,
          index,
          logs,
          error.message,
          error.code,
        )
      }
      throw error
    }
  }

  const pendingExit = await readAutomationRunExitRequest(prismaTx, run)
  if (pendingExit) return exitRun(pendingExit, actions.length)
  const succeeded = await guardedAutomationRunUpdate(prismaTx, {
    where: { id: run.id, status: "RUNNING", exitRequestedAt: null },
    data: {
      status: "SUCCEEDED",
      cursorIndex: actions.length,
      resumeAt: null,
      waitingNodeKey: null,
      waitingNodeExecutionId: null,
      leaseToken: null,
      leaseExpiresAt: null,
      completedAt: now,
      variables: automationValues,
    },
  })
  if (succeeded.count !== 1) {
    const racedExit = await readAutomationRunExitRequest(prismaTx, run)
    if (racedExit) return exitRun(racedExit, actions.length)
    throw new Error("The automation run could not be completed.")
  }
  await prismaTx.automationExecution.create({
    data: {
      tenantId: run.tenantId,
      automationId: run.automationId,
      automationName: run.automationName,
      triggerType: run.triggerType,
      status: "SUCCEEDED",
      opportunityId: run.opportunityId,
      contactId: run.contactId,
      sourceStageId: run.sourceStageId,
      targetStageId: run.targetStageId,
      actorUserId: run.actorUserId,
      actionCount: actions.length,
    },
  })
  return {
    logs: contactDeleted ? logs.map((log) => ({ ...log, contactId: null })) : logs,
    notificationIds,
    fileCleanupCandidates,
    queuedRunCount,
    status: "SUCCEEDED" as const,
    contactDeleted,
  }
}

export function evaluateAutomationTrigger(
  automation: any,
  event: OpportunityAutomationEvent,
  catalog: AutomationRuntimeCatalog,
) {
  if (automation.triggerType !== event.triggerType) {
    return {
      matches: false,
      details: `Skipped because this automation listens for ${getAutomationTriggerLabel(automation.triggerType)}, not ${getAutomationTriggerLabel(event.triggerType)}.`,
    }
  }
  if (automation.pipelineId !== event.pipelineId) {
    const expected = catalog.pipelineMap.get(automation.pipelineId) ?? automation.pipelineId
    const found = catalog.pipelineMap.get(event.pipelineId) ?? event.pipelineId
    return {
      matches: false,
      details: `Pipeline: expected ${expected}, found ${found}.`,
    }
  }
  if (
    automation.triggerType === "OPPORTUNITY_STAGE_CHANGED" &&
    automation.targetStageId !== event.targetStageId
  ) {
    const expected = automation.targetStageId
      ? catalog.stageMap.get(automation.targetStageId) ?? automation.targetStageId
      : "empty"
    const found = event.targetStageId
      ? catalog.stageMap.get(event.targetStageId) ?? event.targetStageId
      : "empty"
    return {
      matches: false,
      details: `Stage: expected ${expected}, found ${found}.`,
    }
  }
  return { matches: true, details: "The opportunity event matched this trigger." }
}

export async function executeOpportunityAutomations(
  prismaTx: any,
  event: OpportunityAutomationEvent,
  options: { queueOpportunityEvent?: QueueOpportunityAutomationEvent } = {},
) {
  const automations = await prismaTx.automation.findMany({
    where: {
      tenantId: event.tenantId,
      isEnabled: true,
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      conditions: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      actions: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
  })
  if (automations.length === 0) {
    return {
      matchedCount: 0,
      executedCount: 0,
      notificationIds: [] as string[],
      fileCleanupCandidates: [] as AutomationFileCleanupCandidate[],
      contactDeleted: false,
    }
  }

  const [contact, catalog] = await Promise.all([
    prismaTx.contact.findFirst({
      where: { tenantId: event.tenantId, id: event.contactId },
      select: {
        id: true,
        firstName: true,
        middleName: true,
        lastName: true,
        statusConfigId: true,
        assignedToUserId: true,
        tags: { select: { tagId: true } },
        customFieldValues: { select: { fieldId: true, value: true } },
      },
    }),
    getAutomationRuntimeCatalog(prismaTx, event.tenantId),
  ])
  if (!contact) throw new Error("Contact not found while executing automation.")

  const contactName = getContactDisplayName(contact)
  const rootChainId = event.chainId ?? randomUUID()
  const rootTransitionHistory = event.transitionHistory ?? [{
    kind: event.triggerType === "OPPORTUNITY_CREATED" ? "CREATED" as const : "STAGE_CHANGED" as const,
    opportunityKey: event.opportunityId,
    pipelineId: event.pipelineId,
    sourceStageId: event.sourceStageId,
    targetStageId: event.targetStageId!,
  }]
  type AutomationPlan = {
    automation: any
    actions: RuntimeAutomationAction[]
    logs: AutomationNodeLogData[]
    shouldRun: boolean
  }
  const plans: AutomationPlan[] = automations.map((automation: any) => {
    const actions: RuntimeAutomationAction[] = automation.actions.map((action: any) => automationActionSnapshot(action))
    const attemptId = randomUUID()
    const occurredAt = new Date()
    const base = {
      tenantId: event.tenantId,
      automationId: automation.id,
      automationName: automation.name,
      contactId: event.contactId,
      contactName,
      actorUserId: event.actorUserId,
      processId: null,
      opportunityId: event.opportunityId,
      attemptId,
      eventSource: event.triggerType,
      occurredAt,
    } satisfies Omit<AutomationNodeLogData, "nodeKind" | "nodeOrder" | "nodeKey" | "nodeLabel" | "status" | "reasonCode" | "details">
    const trigger = evaluateAutomationTrigger(automation, event, catalog)
    const logs: AutomationNodeLogData[] = [{
      ...base,
      nodeKind: "TRIGGER",
      nodeOrder: 0,
      nodeKey: automation.triggerType,
      nodeLabel: getAutomationTriggerLabel(automation.triggerType),
      status: trigger.matches ? "EXECUTED" : "SKIPPED",
      reasonCode: trigger.matches ? null : "TRIGGER_NOT_MATCHED",
      details: trigger.details,
    }]

    if (!trigger.matches) {
      logs.push(...flattenAutomationActionTree(actions).map(({ action, nodeOrder, branchPath }) => ({
        ...base,
        nodeKind: "ACTION" as const,
        nodeOrder,
        nodeKey: action.nodeKey,
        nodeLabel: getAutomationActionNodeLabel(action),
        status: "SKIPPED" as const,
        reasonCode: "TRIGGER_NOT_MET",
        details: `Skipped because the automation trigger did not match. ${trigger.details}`,
        branchPath,
      })))
      return { automation, actions, logs, shouldRun: false }
    }

    const conditionResult = evaluateAutomationConditions(automation, event, contact, catalog)
    if (!conditionResult.matches) {
      const details = conditionResult.failures.join(" ")
      logs.push(...flattenAutomationActionTree(actions).map(({ action, nodeOrder, branchPath }) => ({
        ...base,
        nodeKind: "ACTION" as const,
        nodeOrder,
        nodeKey: action.nodeKey,
        nodeLabel: getAutomationActionNodeLabel(action),
        status: "SKIPPED" as const,
        reasonCode: "FILTERS_NOT_MET",
        details,
        branchPath,
      })))
      return { automation, actions, logs, shouldRun: false }
    }

    return { automation, actions, logs, shouldRun: true }
  })

  const notificationIds: string[] = []
  const fileCleanupCandidates: AutomationFileCleanupCandidate[] = []
  let executedCount = 0
  let contactDeleted = false
  let queuedRunCount = 0
  for (let planIndex = 0; planIndex < plans.length; planIndex += 1) {
    const plan = plans[planIndex]
    if (!plan.shouldRun) continue

    if (contactDeleted) {
      const triggerLog = plan.logs[0]!
      plan.logs.push(...flattenAutomationActionTree(plan.actions).map(({ action, nodeOrder, branchPath }) => actionLog(
        triggerLog,
        action,
        nodeOrder - 1,
        "SKIPPED",
        "CONTACT_DELETED",
        "Skipped because an earlier automation deleted the contact.",
        undefined,
        { nodeOrder, branchPath },
      )))
      continue
    }

    try {
      const triggerLog = plan.logs[0]!
      const run = await prismaTx.automationRun.create({
        data: {
          tenantId: event.tenantId,
          automationId: plan.automation.id,
          automationName: plan.automation.name,
          contactId: event.contactId,
          contactName,
          actorUserId: event.actorUserId,
          opportunityId: event.opportunityId,
          attemptId: triggerLog.attemptId,
          eventSource: event.triggerType,
          triggerType: event.triggerType,
          sourceStageId: event.sourceStageId,
          targetStageId: event.targetStageId,
          actionSnapshot: plan.actions,
          cursorIndex: 0,
          eventContext: {
            pipelineId: event.pipelineId,
            valueCents: event.valueCents,
            sourceStageId: event.sourceStageId,
            targetStageId: event.targetStageId,
            occurredAt: triggerLog.occurredAt.toISOString(),
            eventId: event.parentEventId ?? null,
            chainId: rootChainId,
            chainDepth: event.chainDepth ?? 0,
            transitionHistory: rootTransitionHistory,
          },
          status: "RUNNING",
        },
      })
      const result = await executeAutomationSegmentTx(prismaTx, {
        run,
        actions: plan.actions,
        catalog,
        startIndex: 0,
        queueOpportunityEvent: options.queueOpportunityEvent,
      })
      executedCount += 1
      plan.logs.push(...result.logs)
      notificationIds.push(...result.notificationIds)
      fileCleanupCandidates.push(...result.fileCleanupCandidates)
      queuedRunCount += result.queuedRunCount
      if (result.contactDeleted) contactDeleted = true
    } catch (error) {
      if (error instanceof AutomationExecutionError) {
        for (let index = 0; index < plans.length; index += 1) {
          const tracePlan = plans[index]
          if (!tracePlan.shouldRun) continue
          const triggerLog = tracePlan.logs.find((log) => log.nodeKind === "TRIGGER")!
          if (index === planIndex) {
            tracePlan.logs = [triggerLog, ...error.nodeExecutions]
            continue
          }
          if (index < planIndex) {
            tracePlan.logs = tracePlan.logs.map((log) =>
              log.nodeKind === "ACTION" && (log.status === "EXECUTED" || log.status === "WAITING")
                ? {
                    ...log,
                    status: "FAILED",
                    reasonCode: "TRANSACTION_ROLLED_BACK",
                    details: "This action ran, but its changes were rolled back because a later automation failed.",
                  }
                : log,
            )
            continue
          }
          tracePlan.logs = [
            triggerLog,
            ...flattenAutomationActionTree(tracePlan.actions).map(({ action, nodeOrder, branchPath }) => actionLog(
              triggerLog,
              action,
              nodeOrder - 1,
              "SKIPPED",
              "PREVIOUS_AUTOMATION_FAILED",
              "Skipped because an earlier automation failed.",
              undefined,
              { nodeOrder, branchPath },
            )),
          ]
        }
        error.nodeExecutions = plans.flatMap((item) => item.logs)
        error.actionSnapshot = plan.actions
        error.attemptId = plan.logs[0]?.attemptId ?? null
        error.eventSource = event.triggerType
        error.contactName = contactName
      }
      throw error
    }
  }

  const nodeExecutions = plans
    .flatMap((plan: { logs: AutomationNodeLogData[] }) => plan.logs)
    .map((log) => contactDeleted ? { ...log, contactId: null } : log)
  if (nodeExecutions.length > 0) {
    await prismaTx.automationNodeExecution.createMany({ data: nodeExecutions })
  }

  const matchedCount = plans.filter((plan: { shouldRun: boolean }) => plan.shouldRun).length
  return {
    matchedCount,
    executedCount,
    notificationIds,
    fileCleanupCandidates,
    ...(queuedRunCount > 0 ? { queuedRunCount } : {}),
    contactDeleted,
  }
}

export async function recordAutomationFailure(prismaClient: any, event: OpportunityAutomationEvent, error: AutomationExecutionError) {
  await prismaClient.$transaction(async (transaction: any) => {
    const opportunityId = event.triggerType === "OPPORTUNITY_CREATED" ? null : event.opportunityId
    if (error.attemptId && error.contactName && error.actionSnapshot.length > 0) {
      const failedStep = flattenAutomationActionTree(error.actionSnapshot as RuntimeAutomationAction[])
        .find((step) => step.nodeOrder - 1 === error.actionIndex)
      await transaction.automationRun.create({
        data: {
          tenantId: event.tenantId,
          automationId: error.automationId || null,
          automationName: error.automationName,
          contactId: event.contactId,
          contactName: error.contactName,
          actorUserId: event.actorUserId,
          opportunityId,
          attemptId: error.attemptId,
          eventSource: error.eventSource ?? event.triggerType,
          triggerType: event.triggerType,
          sourceStageId: event.sourceStageId,
          targetStageId: event.targetStageId,
          actionSnapshot: error.actionSnapshot,
          cursorIndex: error.actionIndex,
          cursorPath: error.cursorPath,
          branchDecisions: error.branchDecisions ?? {},
          eventContext: {
            pipelineId: event.pipelineId,
            valueCents: event.valueCents,
            sourceStageId: event.sourceStageId,
            targetStageId: event.targetStageId,
            occurredAt: new Date().toISOString(),
            eventId: event.parentEventId ?? null,
            chainId: event.chainId ?? null,
            chainDepth: event.chainDepth ?? 0,
            transitionHistory: event.transitionHistory ?? [],
          },
          status: "FAILED",
          failureNodeKey: failedStep?.action.nodeKey ?? (error.actionSnapshot[error.actionIndex] as { nodeKey?: string } | undefined)?.nodeKey,
          failureCode: error.code,
          failureMessage: error.message.slice(0, 500),
          failedAt: new Date(),
        },
      })
    }
    await transaction.automationExecution.create({
      data: {
        tenantId: event.tenantId,
        automationId: error.automationId,
        automationName: error.automationName,
        triggerType: event.triggerType,
        status: "FAILED",
        opportunityId,
        contactId: event.contactId,
        sourceStageId: event.sourceStageId,
        targetStageId: event.targetStageId,
        actorUserId: event.actorUserId,
        actionCount: error.actionIndex,
        errorCode: error.code,
        errorMessage: error.message.slice(0, 500),
      },
    })
    if (error.nodeExecutions.length > 0) {
      await transaction.automationNodeExecution.createMany({
        data: error.nodeExecutions.map((item) => ({
          ...item,
          opportunityId,
        })),
      })
    }
  })
}

async function recordAutomationRunFailure(prismaClient: any, runId: string, leaseToken: string, cause: unknown) {
  const run = await prismaClient.automationRun.findFirst({
    where: { id: runId, status: "RUNNING", leaseToken },
  })
  if (!run) return
  const tenant = await prismaClient.tenant.findUnique({
    where: { id: run.tenantId },
    select: { timezone: true },
  })
  const timezone = tenant?.timezone?.trim() || "America/Chicago"

  let actions: RuntimeAutomationAction[] = []
  try {
    actions = parseActionSnapshot(run.actionSnapshot)
  } catch {
    actions = []
  }
  const error = cause instanceof AutomationExecutionError
    ? cause
    : new AutomationExecutionError({
        automationId: run.automationId,
        automationName: run.automationName,
        actionIndex: Math.min(run.cursorIndex, Math.max(0, actions.length - 1)),
        contactId: run.contactId,
        message: cause instanceof Error ? cause.message : "The automation run could not be resumed.",
      })
  const now = new Date()
  const base = {
    tenantId: run.tenantId,
    automationId: run.automationId,
    automationName: run.automationName,
    contactId: run.contactId,
    contactName: run.contactName,
    actorUserId: run.actorUserId,
    processId: null,
    opportunityId: run.opportunityId,
    attemptId: run.attemptId,
    eventSource: run.eventSource,
    occurredAt: now,
  } satisfies Omit<AutomationNodeLogData, "id" | "nodeKind" | "nodeOrder" | "nodeKey" | "nodeLabel" | "status" | "reasonCode" | "details">
  const branchedSteps = flattenAutomationActionTree(actions).some((step) =>
    step.action.type === "IF_ELSE" || step.action.type === "SPLIT" || step.action.type === "GO_TO"
  )
    ? (() => {
        const cursor = normalizeAutomationCursorState(run.cursorPath)
        return cursor.nextNodeKey
          ? automationActionContinuation(actions, normalizeBranchDecisions(run.branchDecisions), cursor.nextNodeKey)
          : selectedAutomationActionSteps(actions, normalizeBranchDecisions(run.branchDecisions))
      })()
    : []
  const cursorRecord = run.cursorPath && typeof run.cursorPath === "object" && !Array.isArray(run.cursorPath)
    ? run.cursorPath as Record<string, unknown>
    : null
  const nextNodeKey = typeof cursorRecord?.nextNodeKey === "string" ? cursorRecord.nextNodeKey : null
  const branchStartIndex = nextNodeKey
    ? Math.max(0, branchedSteps.findIndex((step) => step.action.nodeKey === nextNodeKey))
    : Math.min(run.cursorIndex, Math.max(0, branchedSteps.length - 1))
  const branchFailedIndex = Math.max(
    branchStartIndex,
    branchedSteps.findIndex((step) => step.nodeOrder - 1 === error.actionIndex),
  )
  const logs = error.nodeExecutions.length > 0
    ? error.nodeExecutions
    : branchedSteps.length > 0
      ? branchFailureLogs(base, branchedSteps, branchStartIndex, branchFailedIndex, [], error.message, error.code)
      : actions.length > 0
      ? failureLogsForSegment(base, actions, run.cursorIndex, error.actionIndex, [], error.message, error.code)
      : []
  const requestedExit = exitRequestFromRun(run)

  await prismaClient.$transaction(async (transaction: any) => {
    if (run.eventSource === "AUTOMATION_ACTION") {
      const workflowContext = normalizeOpportunityEventContext(run.eventContext)
      await transaction.automationNodeExecution.updateMany({
        where: {
          tenantId: run.tenantId,
          attemptId: run.attemptId,
          eventSource: "AUTOMATION_ACTION",
          nodeKind: "TRIGGER",
          status: "QUEUED",
        },
        data: {
          status: "EXECUTED",
          reasonCode: null,
          details: workflowContext.sourceWorkflowAutomationName
            ? `Started by “${workflowContext.sourceWorkflowAutomationName}”${workflowContext.sourceWorkflowActionName ? ` from “${workflowContext.sourceWorkflowActionName}”` : ""}.`
            : "Started by another workflow.",
          occurredAt: now,
        },
      })
    }
    if (run.waitingNodeExecutionId) {
      await transaction.automationNodeExecution.updateMany({
        where: { tenantId: run.tenantId, id: run.waitingNodeExecutionId },
        data: {
          status: "EXECUTED",
          reasonCode: requestedExit?.reasonCode ?? null,
          details: requestedExit?.details ?? (run.resumeAt
            ? `Scheduled for ${formatWaitInstant(run.resumeAt, timezone)} and resumed at ${formatWaitInstant(now, timezone)} before the following action failed.`
            : `The wait resumed at ${formatWaitInstant(now, timezone)} before the following action failed.`),
          occurredAt: now,
        },
      })
    }
    if (requestedExit) {
      const cursor = normalizeAutomationCursorState(run.cursorPath)
      const visitedNodeKeys = new Set(cursor.visitedNodeKeys ?? [])
      if (visitedNodeKeys.size === 0) {
        for (const action of actions.slice(0, run.cursorIndex)) visitedNodeKeys.add(action.nodeKey)
      }
      const exitLogs: AutomationNodeLogData[] = []
      appendUnvisitedAutomationLogs({
        base,
        actions,
        logs: exitLogs,
        visitedNodeKeys,
        branchDecisions: normalizeBranchDecisions(run.branchDecisions),
        goToHistory: cursor.goToHistory ?? [],
        fallbackReasonCode: requestedExit.reasonCode,
        fallbackDetails: requestedExit.details,
      })
      await finishAutomationRunAsExited(transaction, {
        run,
        request: requestedExit,
        occurredAt: now,
        actionCount: Math.max(run.cursorIndex, visitedNodeKeys.size),
        cursorIndex: Math.max(run.cursorIndex, visitedNodeKeys.size),
        cursorPath: automationCursorState(null, visitedNodeKeys, cursor.goToHistory ?? []),
        branchDecisions: normalizeBranchDecisions(run.branchDecisions),
        variables: normalizeAutomationVariables(run.variables),
      })
      if (exitLogs.length > 0) await transaction.automationNodeExecution.createMany({ data: exitLogs })
      return
    }
    const updated = await transaction.automationRun.updateMany({
      where: { id: run.id, status: "RUNNING", leaseToken, exitRequestedAt: null },
      data: {
        status: "FAILED",
        cursorPath: error.cursorPath ?? run.cursorPath,
        branchDecisions: error.branchDecisions ?? run.branchDecisions ?? {},
        failureNodeKey: flattenAutomationActionTree(actions).find((step) => step.nodeOrder - 1 === error.actionIndex)?.action.nodeKey ?? run.waitingNodeKey,
        failureCode: error.code,
        failureMessage: error.message.slice(0, 500),
        failedAt: now,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    })
    if (!updated.count) {
      const currentRun = await transaction.automationRun.findUnique({
        where: { id: run.id },
        select: {
          status: true,
          exitRequestedAt: true,
          exitReasonCode: true,
          exitReasonDetails: true,
        },
      })
      const racedExit = currentRun?.status === "RUNNING" ? exitRequestFromRun(currentRun) : null
      if (!racedExit) return
      if (run.waitingNodeExecutionId) {
        await transaction.automationNodeExecution.updateMany({
          where: { tenantId: run.tenantId, id: run.waitingNodeExecutionId },
          data: {
            status: "EXECUTED",
            reasonCode: racedExit.reasonCode,
            details: racedExit.details,
            occurredAt: now,
          },
        })
      }
      const cursor = normalizeAutomationCursorState(run.cursorPath)
      const visitedNodeKeys = new Set(cursor.visitedNodeKeys ?? [])
      if (visitedNodeKeys.size === 0) {
        for (const action of actions.slice(0, run.cursorIndex)) visitedNodeKeys.add(action.nodeKey)
      }
      const exitLogs: AutomationNodeLogData[] = []
      appendUnvisitedAutomationLogs({
        base,
        actions,
        logs: exitLogs,
        visitedNodeKeys,
        branchDecisions: normalizeBranchDecisions(run.branchDecisions),
        goToHistory: cursor.goToHistory ?? [],
        fallbackReasonCode: racedExit.reasonCode,
        fallbackDetails: racedExit.details,
      })
      await finishAutomationRunAsExited(transaction, {
        run,
        request: racedExit,
        occurredAt: now,
        actionCount: Math.max(run.cursorIndex, visitedNodeKeys.size),
        cursorIndex: Math.max(run.cursorIndex, visitedNodeKeys.size),
        cursorPath: automationCursorState(null, visitedNodeKeys, cursor.goToHistory ?? []),
        branchDecisions: normalizeBranchDecisions(run.branchDecisions),
        variables: normalizeAutomationVariables(run.variables),
      })
      if (exitLogs.length > 0) await transaction.automationNodeExecution.createMany({ data: exitLogs })
      return
    }
    await transaction.automationExecution.create({
      data: {
        tenantId: run.tenantId,
        automationId: run.automationId,
        automationName: run.automationName,
        triggerType: run.triggerType,
        status: "FAILED",
        opportunityId: run.opportunityId,
        contactId: run.contactId,
        sourceStageId: run.sourceStageId,
        targetStageId: run.targetStageId,
        actorUserId: run.actorUserId,
        actionCount: run.cursorIndex,
        errorCode: error.code,
        errorMessage: error.message.slice(0, 500),
      },
    })
    if (logs.length > 0) await transaction.automationNodeExecution.createMany({ data: logs })
  })
}

async function resumeAutomationRun(
  prismaClient: any,
  runId: string,
  leaseToken: string,
  queueOpportunityEvent?: QueueOpportunityAutomationEvent,
) {
  try {
    const result = await prismaClient.$transaction(async (transaction: any) => {
      const run = await transaction.automationRun.findFirst({
        where: { id: runId, status: "RUNNING", leaseToken },
      })
      if (!run) {
        return {
          status: "NOT_CLAIMED" as const,
          notificationIds: [] as string[],
          fileCleanupCandidates: [] as AutomationFileCleanupCandidate[],
          queuedRunCount: 0,
        }
      }
      const actions = parseActionSnapshot(run.actionSnapshot)
      const contact = run.contactId
        ? await transaction.contact.findFirst({ where: { tenantId: run.tenantId, id: run.contactId }, select: { id: true } })
        : null
      if (!contact) throw new Error("The contact for this automation run is no longer available.")
      const resumedAt = new Date()
      const catalog = await getAutomationRuntimeCatalog(transaction, run.tenantId)
      if (run.eventSource === "AUTOMATION_ACTION") {
        const workflowContext = normalizeOpportunityEventContext(run.eventContext)
        await transaction.automationNodeExecution.updateMany({
          where: {
            tenantId: run.tenantId,
            attemptId: run.attemptId,
            eventSource: "AUTOMATION_ACTION",
            nodeKind: "TRIGGER",
            status: "QUEUED",
          },
          data: {
            status: "EXECUTED",
            reasonCode: null,
            details: workflowContext.sourceWorkflowAutomationName
              ? `Started by “${workflowContext.sourceWorkflowAutomationName}”${workflowContext.sourceWorkflowActionName ? ` from “${workflowContext.sourceWorkflowActionName}”` : ""}.`
              : "Started by another workflow.",
            occurredAt: resumedAt,
          },
        })
      }
      if (run.waitingNodeExecutionId) {
        await transaction.automationNodeExecution.updateMany({
          where: { tenantId: run.tenantId, id: run.waitingNodeExecutionId },
          data: {
            status: "EXECUTED",
            reasonCode: null,
            details: run.resumeAt
              ? `Scheduled for ${formatWaitInstant(run.resumeAt, catalog.timezone)} and resumed at ${formatWaitInstant(resumedAt, catalog.timezone)}.`
              : `Wait completed at ${formatWaitInstant(resumedAt, catalog.timezone)}.`,
            occurredAt: resumedAt,
          },
        })
      }
      const result = await executeAutomationSegmentTx(transaction, {
        run,
        actions,
        catalog,
        startIndex: run.cursorIndex,
        occurredAt: resumedAt,
        queueOpportunityEvent,
      })
      if (result.logs.length > 0) {
        await transaction.automationNodeExecution.createMany({ data: result.logs })
      }
      if (run.dispatchId && (result.notificationIds.length > 0 || result.fileCleanupCandidates.length > 0)) {
        await transaction.automationSideEffect.createMany({
          data: [
            ...result.notificationIds.map((notificationId: string) => ({
              tenantId: run.tenantId,
              type: "NOTIFICATION_DELIVERY" as const,
              idempotencyKey: `automation-run:${run.id}:notification:${notificationId}`,
              payload: { notificationId },
            })),
            ...result.fileCleanupCandidates.map((file: AutomationFileCleanupCandidate) => ({
              tenantId: run.tenantId,
              type: "FILE_DELETE" as const,
              idempotencyKey: `automation-run:${run.id}:file:${file.id}`,
              payload: { fileId: file.id, key: file.key },
            })),
          ],
          skipDuplicates: true,
        })
      }
      return {
        status: result.status,
        notificationIds: run.dispatchId ? [] : result.notificationIds,
        fileCleanupCandidates: run.dispatchId ? [] : result.fileCleanupCandidates,
        queuedRunCount: result.queuedRunCount,
      }
    })
    await emitAutomationTaskNotifications(prismaClient, result.notificationIds).catch((error) => {
      console.error("Could not emit automation task notification", error)
    })
    await deleteAutomationContactFileObjects(result.fileCleanupCandidates)
    if (result.queuedRunCount > 0) kickAutomationRunWorker({ queueOpportunityEvent })
    return { status: result.status }
  } catch (error) {
    await recordAutomationRunFailure(prismaClient, runId, leaseToken, error)
    return { status: "FAILED" as const }
  }
}

async function emitAutomationTaskNotifications(prismaClient: any, notificationIds: string[]) {
  if (notificationIds.length === 0) return
  const notifications = await prismaClient.notification.findMany({
    where: { id: { in: notificationIds } },
    select: {
      id: true,
      tenantId: true,
      userId: true,
      contactId: true,
      type: true,
      title: true,
      body: true,
      readAt: true,
      createdAt: true,
      taskId: true,
      taskReminderId: true,
    },
  })

  for (const notification of notifications) {
    const serialized: RealtimeNotificationPayload = {
      id: notification.id,
      tenantId: notification.tenantId,
      userId: notification.userId,
      contactId: notification.contactId ?? null,
      type: notification.type,
      title: notification.title,
      body: notification.body ?? null,
      readAt: notification.readAt?.toISOString?.() ?? null,
      createdAt:
        typeof notification.createdAt === "string"
          ? notification.createdAt
          : notification.createdAt.toISOString(),
      taskId: notification.taskId ?? null,
      taskReminderId: notification.taskReminderId ?? null,
    }
    emitNotificationCreated(serialized.userId, serialized)
  }
}

export async function resumeDueAutomationRuns(
  prismaOverride?: any,
  options: { queueOpportunityEvent?: QueueOpportunityAutomationEvent } = {},
) {
  const prismaClient = prismaOverride ?? (await import("./prisma.js")).prisma
  const now = new Date()
  const candidates = await (prismaClient as any).automationRun.findMany({
    where: {
      OR: [
        {
          status: "QUEUED",
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
        },
        {
          status: "WAITING",
          resumeAt: { lte: now },
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
        },
        {
          status: "RUNNING",
          leaseToken: { not: null },
          leaseExpiresAt: { lt: now },
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: { id: true },
  })
  const results = []
  for (const candidate of candidates) {
    const leaseToken = randomUUID()
    const claimed = await (prismaClient as any).automationRun.updateMany({
      where: {
        id: candidate.id,
        OR: [
          {
            status: "QUEUED",
            OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
          },
          {
            status: "WAITING",
            resumeAt: { lte: now },
            OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
          },
          {
            status: "RUNNING",
            leaseToken: { not: null },
            leaseExpiresAt: { lt: now },
          },
        ],
      },
      data: {
        status: "RUNNING",
        leaseToken,
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    })
    if (!claimed.count) continue
    results.push(await resumeAutomationRun(
      prismaClient as any,
      candidate.id,
      leaseToken,
      options.queueOpportunityEvent,
    ))
  }
  return results
}

let automationRunKickScheduled = false

export function kickAutomationRunWorker(
  options: { queueOpportunityEvent?: QueueOpportunityAutomationEvent } = {},
) {
  if (automationRunKickScheduled) return
  automationRunKickScheduled = true
  queueMicrotask(() => {
    automationRunKickScheduled = false
    void resumeDueAutomationRuns(undefined, options).catch((error) => {
      console.error("Failed to process queued automation runs:", error)
    })
  })
}
