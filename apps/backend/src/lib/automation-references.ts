import {
  AutomationCreateContactConfigSchema,
  createContactConfigCustomFieldKeys,
} from "./automation-create-contact.js"
import {
  AutomationTaskConfigSchema,
  taskConfigCustomFieldKeys,
} from "./automation-task.js"
import {
  AutomationCustomFieldUpdatesSchema,
  AutomationDeleteOpportunityConfigSchema,
  AutomationOpportunityConfigSchema,
} from "./opportunity-automations.js"
import {
  AutomationDateTimeFormatterConfigSchema,
  dateTimeFormatterCustomFieldKeys,
} from "./automation-date-time-formatter.js"
import {
  AutomationNumberFormatterConfigSchema,
  numberFormatterCustomFieldKeys,
} from "./automation-number-formatter.js"
import {
  AutomationMathOperationConfigSchema,
  mathOperationCustomFieldKeys,
} from "./automation-math-operation.js"
import {
  AutomationTextFormatterConfigSchema,
  textFormatterCustomFieldKeys,
} from "./automation-text-formatter.js"

type AutomationReference =
  | { kind: "pipeline"; id: string }
  | { kind: "stage"; ids: string[] }
  | { kind: "customField"; id: string }
  | { kind: "status"; id: string }
  | { kind: "taskStatus"; id: string }
  | { kind: "tag"; id: string }
  | { kind: "user"; id: string }

export async function findEnabledAutomationReference(
  prismaClient: any,
  tenantId: string,
  reference: AutomationReference,
) {
  let referenceWhere: Record<string, unknown>
  if (reference.kind === "pipeline") {
    referenceWhere = { pipelineId: reference.id }
  } else if (reference.kind === "stage") {
    referenceWhere = {
      OR: [
        { sourceStageId: { in: reference.ids } },
        { targetStageId: { in: reference.ids } },
      ],
    }
  } else if (reference.kind === "customField") {
    const field = await prismaClient.contactCustomField.findFirst({
      where: { tenantId, id: reference.id },
      select: { key: true },
    })
    const tokenStart = field?.key ? `{contact.custom_field.${field.key}` : null
    const noteTemplateReference = tokenStart
      ? {
          actions: {
            some: {
              type: "ADD_CONTACT_NOTE",
              OR: [
                { noteTitle: { contains: `${tokenStart}}` } },
                { noteTitle: { contains: `${tokenStart}|` } },
                { noteBody: { contains: `${tokenStart}}` } },
                { noteBody: { contains: `${tokenStart}|` } },
              ],
            },
          },
        }
      : null
    referenceWhere = {
      OR: [
        { conditions: { some: { customFieldId: reference.id } } },
        { actions: { some: { customFieldId: reference.id } } },
        ...(noteTemplateReference ? [noteTemplateReference] : []),
      ],
    }
  } else if (reference.kind === "status") {
    referenceWhere = {
      OR: [
        { conditions: { some: { statusConfigId: reference.id } } },
        { actions: { some: { statusConfigId: reference.id } } },
      ],
    }
  } else if (reference.kind === "taskStatus") {
    referenceWhere = { id: "__task_status_checked_below__" }
  } else if (reference.kind === "tag") {
    referenceWhere = {
      OR: [
        { conditions: { some: { tagId: reference.id } } },
        { actions: { some: { tagId: reference.id } } },
      ],
    }
  } else {
    referenceWhere = {
      OR: [
        { conditions: { some: { assignedUserId: reference.id } } },
        { actions: { some: { assignedUserId: reference.id } } },
      ],
    }
  }

  const directReference = await prismaClient.automation.findFirst({
    where: { tenantId, isEnabled: true, ...referenceWhere },
    select: { id: true, name: true },
  })
  if (directReference) return directReference

  if (
    reference.kind !== "customField" &&
    reference.kind !== "status" &&
    reference.kind !== "taskStatus" &&
    reference.kind !== "tag" &&
    reference.kind !== "user" &&
    reference.kind !== "pipeline" &&
    reference.kind !== "stage"
  ) {
    return null
  }

  const customField = reference.kind === "customField"
    ? await prismaClient.contactCustomField.findFirst({
        where: { tenantId, id: reference.id },
        select: { key: true },
      })
    : null
  const automations = await prismaClient.automation.findMany({
    where: {
      tenantId,
      isEnabled: true,
      actions: {
        some: {
          type: { in: ["CREATE_CONTACT", "CREATE_TASK", "UPDATE_CONTACT_CUSTOM_FIELDS", "FORMAT_DATE_TIME", "FORMAT_NUMBER", "FORMAT_TEXT", "MATH_OPERATION", "UPDATE_OPPORTUNITY", "DELETE_OPPORTUNITY", "IF_ELSE", "SPLIT"] },
        },
      },
    },
    select: {
      id: true,
      name: true,
      actions: {
        select: {
          type: true,
          customFieldId: true,
          statusConfigId: true,
          assignedUserId: true,
          tagId: true,
          noteTitle: true,
          noteBody: true,
          createContactConfig: true,
          taskConfig: true,
          customFieldUpdates: true,
          dateTimeFormatterConfig: true,
          numberFormatterConfig: true,
          textFormatterConfig: true,
          mathOperationConfig: true,
          opportunityConfig: true,
          deleteOpportunityConfig: true,
          ifElseConfig: true,
          splitConfig: true,
        },
      },
    },
  })

  const nestedActions = (actions: any[]): any[] => actions.flatMap((action) => {
    if (action.type !== "IF_ELSE" && action.type !== "SPLIT") return [action]
    const paths: Array<{ actions?: any[] }> = action.type === "IF_ELSE"
      ? action.ifElseConfig && typeof action.ifElseConfig === "object"
        ? (action.ifElseConfig as { branches?: Array<{ actions?: any[] }> }).branches ?? []
        : []
      : action.splitConfig && typeof action.splitConfig === "object"
        ? (action.splitConfig as { routes?: Array<{ actions?: any[] }> }).routes ?? []
        : []
    return [
      action,
      ...paths.flatMap((branch) => nestedActions(Array.isArray(branch.actions) ? branch.actions : [])),
    ]
  })

  for (const automation of automations) {
    for (const action of nestedActions(automation.actions)) {
      if (action.type === "IF_ELSE") {
        const branches = action.ifElseConfig && typeof action.ifElseConfig === "object"
          ? (action.ifElseConfig as { branches?: Array<{ conditions?: any[] }> }).branches ?? []
          : []
        const conditions = branches.flatMap((branch) => Array.isArray(branch.conditions) ? branch.conditions : [])
        if (
          reference.kind === "customField" && conditions.some((condition) =>
            condition.source === "CONTACT_CUSTOM_FIELD" && condition.customFieldId === reference.id,
          ) ||
          reference.kind === "status" && conditions.some((condition) =>
            condition.source === "CONTACT_STATUS" && condition.statusConfigId === reference.id,
          ) ||
          reference.kind === "tag" && conditions.some((condition) =>
            condition.source === "CONTACT_TAGS" && condition.tagId === reference.id,
          ) ||
          reference.kind === "user" && conditions.some((condition) =>
            condition.source === "CONTACT_ASSIGNEE" && condition.assignedUserId === reference.id,
          )
        ) {
          return { id: automation.id, name: automation.name }
        }
        continue
      }
      if (reference.kind === "customField" && action.customFieldId === reference.id) {
        return { id: automation.id, name: automation.name }
      }
      if (reference.kind === "status" && action.statusConfigId === reference.id) {
        return { id: automation.id, name: automation.name }
      }
      if (reference.kind === "tag" && action.tagId === reference.id) {
        return { id: automation.id, name: automation.name }
      }
      if (reference.kind === "user" && action.assignedUserId === reference.id) {
        return { id: automation.id, name: automation.name }
      }
      if (action.type === "CREATE_CONTACT") {
        const createContact = AutomationCreateContactConfigSchema.safeParse(action.createContactConfig)
        if (!createContact.success) continue
        if (
          reference.kind === "status" &&
          createContact.data.statusConfigId === reference.id
        ) {
          return { id: automation.id, name: automation.name }
        }
        if (
          reference.kind === "customField" &&
          (createContact.data.customFieldValues.some(
            (assignment) => assignment.customFieldId === reference.id,
          ) || Boolean(
            customField?.key &&
            createContactConfigCustomFieldKeys(createContact.data).includes(customField.key),
          ))
        ) {
          return { id: automation.id, name: automation.name }
        }
        continue
      }
      if (action.type === "UPDATE_OPPORTUNITY") {
        const opportunity = AutomationOpportunityConfigSchema.safeParse(action.opportunityConfig)
        if (
          opportunity.success &&
          (reference.kind === "pipeline" && opportunity.data.pipelineId === reference.id ||
            reference.kind === "stage" && reference.ids.includes(opportunity.data.stageId))
        ) {
          return { id: automation.id, name: automation.name }
        }
        continue
      }
      if (action.type === "DELETE_OPPORTUNITY") {
        const opportunity = AutomationDeleteOpportunityConfigSchema.safeParse(action.deleteOpportunityConfig)
        if (
          opportunity.success &&
          reference.kind === "pipeline" &&
          opportunity.data.pipelineId === reference.id
        ) {
          return { id: automation.id, name: automation.name }
        }
        continue
      }
      if (
        reference.kind === "customField" &&
        customField?.key &&
        action.type === "ADD_CONTACT_NOTE"
      ) {
        const tokenStart = `{contact.custom_field.${customField.key}`
        const templates = [action.noteTitle, action.noteBody].filter((value): value is string => typeof value === "string")
        if (templates.some((template) => template.includes(`${tokenStart}}`) || template.includes(`${tokenStart}|`))) {
          return { id: automation.id, name: automation.name }
        }
      }
      if (action.type === "UPDATE_CONTACT_CUSTOM_FIELDS") {
        const updates = AutomationCustomFieldUpdatesSchema.safeParse(action.customFieldUpdates)
        if (
          updates.success &&
          reference.kind === "customField" &&
          updates.data.some(
            (update) => "customFieldId" in update && update.customFieldId === reference.id,
          )
        ) {
          return { id: automation.id, name: automation.name }
        }
        continue
      }
      if (action.type === "FORMAT_DATE_TIME") {
        const formatter = AutomationDateTimeFormatterConfigSchema.safeParse(action.dateTimeFormatterConfig)
        if (
          formatter.success &&
          reference.kind === "customField" &&
          customField?.key &&
          dateTimeFormatterCustomFieldKeys(formatter.data).includes(customField.key)
        ) {
          return { id: automation.id, name: automation.name }
        }
        continue
      }
      if (action.type === "FORMAT_NUMBER") {
        const formatter = AutomationNumberFormatterConfigSchema.safeParse(action.numberFormatterConfig)
        if (
          formatter.success &&
          reference.kind === "customField" &&
          customField?.key &&
          numberFormatterCustomFieldKeys(formatter.data).includes(customField.key)
        ) {
          return { id: automation.id, name: automation.name }
        }
        continue
      }
      if (action.type === "FORMAT_TEXT") {
        const formatter = AutomationTextFormatterConfigSchema.safeParse(action.textFormatterConfig)
        if (
          formatter.success &&
          reference.kind === "customField" &&
          customField?.key &&
          textFormatterCustomFieldKeys(formatter.data).includes(customField.key)
        ) {
          return { id: automation.id, name: automation.name }
        }
        continue
      }
      if (action.type === "MATH_OPERATION") {
        const math = AutomationMathOperationConfigSchema.safeParse(action.mathOperationConfig)
        if (
          math.success &&
          reference.kind === "customField" &&
          customField?.key &&
          mathOperationCustomFieldKeys(math.data).includes(customField.key)
        ) {
          return { id: automation.id, name: automation.name }
        }
        continue
      }
      const parsed = AutomationTaskConfigSchema.safeParse(action.taskConfig)
      if (!parsed.success) continue
      if (
        reference.kind === "customField" &&
        customField?.key &&
        taskConfigCustomFieldKeys(parsed.data).includes(customField.key)
      ) {
        return { id: automation.id, name: automation.name }
      }
      if (
        reference.kind === "taskStatus" &&
        parsed.data.statusConfigId === reference.id
      ) {
        return { id: automation.id, name: automation.name }
      }
      if (
        reference.kind === "user" &&
        parsed.data.assignee.mode === "SPECIFIC_USER" &&
        parsed.data.assignee.userId === reference.id
      ) {
        return { id: automation.id, name: automation.name }
      }
    }
  }
  return null
}
