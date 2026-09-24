import {
  AutomationTaskConfigSchema,
  taskConfigCustomFieldKeys,
} from "./automation-task.js"

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
    reference.kind !== "taskStatus" &&
    reference.kind !== "user"
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
      actions: { some: { type: "CREATE_TASK" } },
    },
    select: {
      id: true,
      name: true,
      actions: {
        where: { type: "CREATE_TASK" },
        select: { taskConfig: true },
      },
    },
  })

  for (const automation of automations) {
    for (const action of automation.actions) {
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
