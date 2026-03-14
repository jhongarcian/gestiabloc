import { encryptCustomFieldValue } from "./contact-custom-field-encryption.js"
import { normalizeTenantTagName } from "./tag-utils.js"
import { createTaskActivity } from "./task-activity.js"
import { emitNotificationCreated } from "./realtime.js"
import { serializeNotification } from "./task-notifications.js"

type PrismaTx = any

type FlowNode = {
  id: string
  data?: {
    kind?: string
    label?: string
    waitValue?: number
    waitUnit?: "days" | "hours" | "minutes"
    reminderTarget?: "assigned_contact_owner" | "specific_user" | null
    reminderUserId?: string | null
    ifElseBranches?: Array<{
      id: string
      name?: string
      source?: "dateTime" | "contactInfo" | "customField"
      fieldKey?: string
      valueType?: "string" | "number" | "dateTime"
      operator?: string
      compareValue?: string
      isDefault?: boolean
      targetNodeId?: string | null
    }>
    assigneeUserId?: string | null
    removeTarget?: "specific_user" | "all_assigned_users" | null
    tagName?: string | null
    tagNames?: string[] | null
    statusValue?: string | null
    fieldKey?: string | null
    fieldValue?: string | null
    fieldSource?: "contact" | "custom" | null
    fieldOperation?: "update" | "clear" | null
    noteTitle?: string | null
    notesTemplate?: string | null
    noteAttachments?: Array<{ fileId?: string | null }>
    taskTitle?: string | null
    goToNodeId?: string | null
  }
}

type FlowEdge = {
  source?: string
  target?: string
}

type ContactCustomFieldType =
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

type CustomFieldMetadata = {
  id: string
  key: string
  fieldType: ContactCustomFieldType
  options: string[]
  isEncrypted: boolean
  value?: unknown
}

const WAIT_UNIT_TO_MS = {
  days: 24 * 60 * 60 * 1000,
  hours: 60 * 60 * 1000,
  minutes: 60 * 1000,
} as const

const CONTACT_FIELD_MAP: Record<string, string> = {
  firstName: "firstName",
  middleName: "middleName",
  lastName: "lastName",
  email: "email",
  phoneNumber: "phone",
  secondaryPhoneNumber: "secondaryPhone",
  dateOfBirth: "dateOfBirth",
  gender: "gender",
  smokerStatus: "smokerStatus",
  statusConfigId: "statusConfigId",
  addressLine1: "addressLine1",
  addressLine2: "addressLine2",
  city: "city",
  state: "state",
  postalCode: "postalCode",
  country: "country",
}

const DEFAULT_TAG_COLORS = {
  bgColor: "#DBEAFE",
  textColor: "#1D4ED8",
}

function asNodes(value: unknown): FlowNode[] {
  return Array.isArray(value)
    ? value.filter((item): item is FlowNode =>
        Boolean(
          item &&
          typeof item === "object" &&
          "id" in (item as Record<string, unknown>),
        ),
      )
    : []
}

function asEdges(value: unknown): FlowEdge[] {
  return Array.isArray(value)
    ? value.filter((item): item is FlowEdge =>
        Boolean(item && typeof item === "object"),
      )
    : []
}

function getOutgoingTargets(edges: FlowEdge[], sourceId: string) {
  return edges
    .filter(
      (edge) =>
        edge.source === sourceId &&
        typeof edge.target === "string" &&
        edge.target.length > 0,
    )
    .map((edge) => edge.target as string)
}

async function createExecutionLog(params: {
  prismaTx: PrismaTx
  tenantId: string
  templateId: string
  contactServiceId: string
  contactId: string
  actorUserId?: string | null
  flowNodeId?: string | null
  stepId?: string | null
  eventType: string
  title: string
  details?: string | null
  payload?: Record<string, unknown> | null
}) {
  const {
    prismaTx,
    tenantId,
    templateId,
    contactServiceId,
    contactId,
    actorUserId,
    flowNodeId,
    stepId,
    eventType,
    title,
    details,
    payload,
  } = params

  await prismaTx.serviceFollowUpExecutionLog.create({
    data: {
      tenantId,
      templateId,
      contactServiceId,
      contactId,
      actorUserId: actorUserId ?? null,
      flowNodeId: flowNodeId ?? null,
      stepId: stepId ?? null,
      eventType,
      title,
      details: details ?? null,
      payload: payload ?? null,
    },
  })
}

function toComparableNumber(value: unknown) {
  if (typeof value === "number") return value
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function toComparableDate(value: unknown) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

function toComparableString(value: unknown) {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean")
    return String(value)
  if (value instanceof Date) return value.toISOString()
  return ""
}

function normalizeCustomFieldOptions(value: unknown) {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ]
    : []
}

function normalizeContactFieldUpdateValue(fieldKey: string, rawValue: unknown) {
  const textValue =
    typeof rawValue === "string" && rawValue.trim().length > 0
      ? rawValue.trim()
      : null

  if (fieldKey === "dateOfBirth") {
    if (!textValue) return { ok: true as const, value: null }
    const parsedDate = new Date(textValue)
    if (Number.isNaN(parsedDate.getTime())) return { ok: false as const }
    return { ok: true as const, value: parsedDate }
  }

  if (fieldKey === "gender") {
    if (!textValue) return { ok: true as const, value: null }
    const allowedValues = new Set(["FEMALE", "MALE", "NON_BINARY", "OTHER", "UNKNOWN"])
    return allowedValues.has(textValue)
      ? { ok: true as const, value: textValue }
      : { ok: false as const }
  }

  if (fieldKey === "smokerStatus") {
    if (!textValue) return { ok: true as const, value: null }
    const allowedValues = new Set(["UNKNOWN", "NEVER", "CURRENT", "FORMER"])
    return allowedValues.has(textValue)
      ? { ok: true as const, value: textValue }
      : { ok: false as const }
  }

  return { ok: true as const, value: textValue }
}

function normalizeCustomFieldUpdateValue(field: CustomFieldMetadata, rawValue: unknown) {
  if (field.fieldType === "CHECKBOX") {
    if (typeof rawValue === "boolean") return { ok: true as const, value: rawValue }
    if (typeof rawValue === "string") {
      const normalized = rawValue.trim().toLowerCase()
      if (normalized === "true") return { ok: true as const, value: true }
      if (normalized === "false") return { ok: true as const, value: false }
    }
    return { ok: false as const }
  }

  if (field.fieldType === "MULTI_SELECT") {
    const values = Array.isArray(rawValue)
      ? rawValue.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
      : typeof rawValue === "string"
        ? rawValue.split(",").map((item) => item.trim()).filter(Boolean)
        : []

    if (values.some((item) => !field.options.includes(item))) {
      return { ok: false as const }
    }

    return { ok: true as const, value: values.length ? [...new Set(values)] : null }
  }

  if (field.fieldType === "NUMBER" || field.fieldType === "CURRENCY") {
    if (rawValue === null || rawValue === undefined || rawValue === "") {
      return { ok: true as const, value: null }
    }

    const numericValue =
      typeof rawValue === "number"
        ? rawValue
        : typeof rawValue === "string"
          ? Number(rawValue.trim())
          : Number.NaN

    return Number.isFinite(numericValue)
      ? { ok: true as const, value: numericValue }
      : { ok: false as const }
  }

  if (field.fieldType === "DATE") {
    const textValue =
      typeof rawValue === "string" && rawValue.trim().length > 0 ? rawValue.trim() : null
    if (!textValue) return { ok: true as const, value: null }
    const parsedDate = new Date(textValue)
    return Number.isNaN(parsedDate.getTime())
      ? { ok: false as const }
      : { ok: true as const, value: parsedDate.toISOString() }
  }

  if (field.fieldType === "PHONE") {
    const textValue =
      typeof rawValue === "string" && rawValue.trim().length > 0 ? rawValue.trim() : null
    if (!textValue) return { ok: true as const, value: null }
    return /^\+[1-9]\d{7,14}$/.test(textValue)
      ? { ok: true as const, value: textValue }
      : { ok: false as const }
  }

  const textValue =
    typeof rawValue === "string" && rawValue.trim().length > 0 ? rawValue.trim() : null

  if ((field.fieldType === "SELECT" || field.fieldType === "RADIO") && textValue) {
    if (!field.options.includes(textValue)) {
      return { ok: false as const }
    }
  }

  return { ok: true as const, value: textValue }
}

async function buildCustomFieldByKey(
  prismaTx: PrismaTx,
  tenantId: string,
  storedValues: Array<{ field: { id: string; key: string }; value: unknown }>,
) {
  const customFields = await prismaTx.contactCustomField.findMany({
    where: { tenantId },
    select: {
      id: true,
      key: true,
      fieldType: true,
      options: true,
      isEncrypted: true,
    },
  })

  const storedValueByKey = new Map(
    storedValues.map((item) => [item.field.key, item.value] as const),
  )

  return new Map<string, CustomFieldMetadata>(
    customFields.map((field: any) => [
      field.key,
      {
        id: field.id,
        key: field.key,
        fieldType: field.fieldType as ContactCustomFieldType,
        options: normalizeCustomFieldOptions(field.options),
        isEncrypted: Boolean(field.isEncrypted),
        value: storedValueByKey.get(field.key),
      },
    ]),
  )
}

function evaluateOperator(
  left: unknown,
  operator: string | undefined,
  right: string | undefined,
  valueType: string | undefined,
) {
  if (operator === "is_empty") {
    return toComparableString(left).trim().length === 0
  }
  if (operator === "is_not_empty") {
    return toComparableString(left).trim().length > 0
  }

  if (valueType === "number") {
    const leftNumber = toComparableNumber(left)
    const rightNumber = toComparableNumber(right ?? "")
    if (leftNumber === null || rightNumber === null) return false
    if (operator === "eq") return leftNumber === rightNumber
    if (operator === "neq") return leftNumber !== rightNumber
    if (operator === "gt") return leftNumber > rightNumber
    if (operator === "gte") return leftNumber >= rightNumber
    if (operator === "lt") return leftNumber < rightNumber
    if (operator === "lte") return leftNumber <= rightNumber
    return false
  }

  if (valueType === "dateTime") {
    const leftDate = toComparableDate(left)
    const rightDate = toComparableDate(right ?? "")
    if (!leftDate || !rightDate) return false
    if (operator === "eq") return leftDate.getTime() === rightDate.getTime()
    if (operator === "neq") return leftDate.getTime() !== rightDate.getTime()
    if (operator === "gt") return leftDate.getTime() > rightDate.getTime()
    if (operator === "gte") return leftDate.getTime() >= rightDate.getTime()
    if (operator === "lt") return leftDate.getTime() < rightDate.getTime()
    if (operator === "lte") return leftDate.getTime() <= rightDate.getTime()
    return false
  }

  const leftString = toComparableString(left).toLowerCase()
  const rightString = toComparableString(right ?? "").toLowerCase()
  if (operator === "includes") return leftString.includes(rightString)
  if (operator === "not_includes") return !leftString.includes(rightString)
  if (operator === "eq") return leftString === rightString
  if (operator === "neq") return leftString !== rightString
  return false
}

async function ensureTenantTag(
  prismaTx: PrismaTx,
  tenantId: string,
  rawName: string,
) {
  const normalizedName = normalizeTenantTagName(rawName)
  if (!normalizedName) return null

  const existing = await prismaTx.tenantTag.findFirst({
    where: { tenantId, name: normalizedName },
    select: { id: true },
  })
  if (existing) return existing

  const maxSortOrder = await prismaTx.tenantTag.findFirst({
    where: { tenantId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  })

  return prismaTx.tenantTag.create({
    data: {
      tenantId,
      name: normalizedName,
      bgColor: DEFAULT_TAG_COLORS.bgColor,
      textColor: DEFAULT_TAG_COLORS.textColor,
      sortOrder: (maxSortOrder?.sortOrder ?? 0) + 10,
    },
    select: { id: true },
  })
}

function getNodeTagNames(node: FlowNode) {
  const namesFromArray = Array.isArray(node.data?.tagNames)
    ? node.data?.tagNames.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      )
    : []
  const names =
    namesFromArray.length > 0
      ? namesFromArray
      : typeof node.data?.tagName === "string" && node.data.tagName.trim().length > 0
        ? [node.data.tagName]
        : []

  return [...new Set(names.map((name) => normalizeTenantTagName(name)).filter(Boolean))]
}

async function applyContactFieldUpdate(
  prismaTx: PrismaTx,
  tenantId: string,
  contactId: string,
  node: FlowNode,
  customFieldByKey: Map<string, CustomFieldMetadata>,
) {
  const fieldSource = node.data?.fieldSource
  const fieldKey = node.data?.fieldKey?.trim()
  const fieldOperation = node.data?.fieldOperation
  const fieldValue = node.data?.fieldValue ?? ""

  if (!fieldSource || !fieldKey) return

  if (fieldSource === "contact") {
    const contactField = CONTACT_FIELD_MAP[fieldKey]
    if (!contactField) return
    const normalizedValue =
      fieldOperation === "clear"
        ? { ok: true as const, value: null }
        : normalizeContactFieldUpdateValue(fieldKey, fieldValue)
    if (!normalizedValue.ok) return

    await prismaTx.contact.update({
      where: { id: contactId },
      data: {
        [contactField]: normalizedValue.value,
      },
    })
    return
  }

  const customField = customFieldByKey.get(fieldKey)
  if (!customField) return

  if (fieldOperation === "clear") {
    await prismaTx.contactCustomFieldValue.deleteMany({
      where: {
        tenantId,
        contactId,
        fieldId: customField.id,
      },
    })
    return
  }

  const normalizedValue = normalizeCustomFieldUpdateValue(customField, fieldValue)
  if (!normalizedValue.ok) return

  if (normalizedValue.value === null) {
    await prismaTx.contactCustomFieldValue.deleteMany({
      where: {
        tenantId,
        contactId,
        fieldId: customField.id,
      },
    })
    return
  }

  const persistenceData = customField.isEncrypted
    ? {
        value: null,
        ...encryptCustomFieldValue(normalizedValue.value),
      }
    : {
        value: normalizedValue.value,
        valueCiphertext: null,
        valueIv: null,
        valueAuthTag: null,
        valueKeyVersion: null,
      }

  await prismaTx.contactCustomFieldValue.upsert({
    where: {
      tenantId_contactId_fieldId: {
        tenantId,
        contactId,
        fieldId: customField.id,
      },
    },
    update: persistenceData,
    create: {
      tenantId,
      contactId,
      fieldId: customField.id,
      ...persistenceData,
    },
  })
}

async function executeActionNode(params: {
  prismaTx: PrismaTx
  tenantId: string
  templateId: string
  actorUserId: string
  contactService: {
    id: string
    contactId: string
    serviceName: string
    contactName: string
  }
  node: FlowNode
  customFieldByKey: Map<string, CustomFieldMetadata>
}) {
  const {
    prismaTx,
    tenantId,
    templateId,
    actorUserId,
    contactService,
    node,
    customFieldByKey,
  } = params
  const kind = node.data?.kind

  if (kind === "assign" && node.data?.assigneeUserId) {
    await prismaTx.contact.update({
      where: { id: contactService.contactId },
      data: { assignedToUserId: node.data.assigneeUserId },
    })
    await createExecutionLog({
      prismaTx,
      tenantId,
      templateId,
      contactServiceId: contactService.id,
      contactId: contactService.contactId,
      actorUserId,
      flowNodeId: node.id,
      eventType: "ACTION_EXECUTED",
      title: node.data?.label?.trim() || "Assigned contact owner",
      details: "Assigned the contact to a user from the follow-up workflow.",
      payload: { kind, assigneeUserId: node.data.assigneeUserId },
    })
    return
  }

  if (kind === "removeUser") {
    const removeTarget =
      node.data?.removeTarget === "all_assigned_users" ||
      node.data?.removeTarget === "specific_user"
        ? node.data.removeTarget
        : node.data?.assigneeUserId
          ? "specific_user"
          : "all_assigned_users"

    if (removeTarget === "all_assigned_users") {
      await prismaTx.contact.update({
        where: { id: contactService.contactId },
        data: {
          assignedToUserId: null,
          servicingAgentUserId: null,
          additionalAgentUserId: null,
        },
      })
      await createExecutionLog({
        prismaTx,
        tenantId,
        templateId,
        contactServiceId: contactService.id,
        contactId: contactService.contactId,
        actorUserId,
        flowNodeId: node.id,
        eventType: "ACTION_EXECUTED",
        title: node.data?.label?.trim() || "Removed assigned users",
        details: "Cleared all assigned users from the contact.",
        payload: { kind, removeTarget },
      })
      return
    }

    if (!node.data?.assigneeUserId) return
    const contact = await prismaTx.contact.findUnique({
      where: { id: contactService.contactId },
      select: {
        assignedToUserId: true,
        servicingAgentUserId: true,
        additionalAgentUserId: true,
      },
    })

    if (!contact) return

    await prismaTx.contact.update({
      where: { id: contactService.contactId },
      data: {
        assignedToUserId:
          contact.assignedToUserId === node.data.assigneeUserId
            ? null
            : undefined,
        servicingAgentUserId:
          contact.servicingAgentUserId === node.data.assigneeUserId
            ? null
            : undefined,
        additionalAgentUserId:
          contact.additionalAgentUserId === node.data.assigneeUserId
            ? null
            : undefined,
      },
    })
    await createExecutionLog({
      prismaTx,
      tenantId,
      templateId,
      contactServiceId: contactService.id,
      contactId: contactService.contactId,
      actorUserId,
      flowNodeId: node.id,
      eventType: "ACTION_EXECUTED",
      title: node.data?.label?.trim() || "Removed assigned user",
      details: "Removed a specific assigned user from the contact.",
      payload: { kind, removeTarget, assigneeUserId: node.data.assigneeUserId },
    })
    return
  }

  if (kind === "tagAdd") {
    const tagNames = getNodeTagNames(node)
    if (!tagNames.length) return

    for (const tagName of tagNames) {
      const tag = await ensureTenantTag(prismaTx, tenantId, tagName)
      if (!tag) continue

      await prismaTx.contactTag.upsert({
        where: {
          tenantId_contactId_tagId: {
            tenantId,
            contactId: contactService.contactId,
            tagId: tag.id,
          },
        },
        update: {},
        create: {
          tenantId,
          contactId: contactService.contactId,
          tagId: tag.id,
        },
      })
    }
    await createExecutionLog({
      prismaTx,
      tenantId,
      templateId,
      contactServiceId: contactService.id,
      contactId: contactService.contactId,
      actorUserId,
      flowNodeId: node.id,
      eventType: "ACTION_EXECUTED",
      title: node.data?.label?.trim() || "Added contact tags",
      details: `Added ${tagNames.length} tag${tagNames.length === 1 ? "" : "s"} to the contact.`,
      payload: { kind, tagNames },
    })
    return
  }

  if (kind === "tagRemove") {
    const tagNames = getNodeTagNames(node)
    if (!tagNames.length) return

    const tags = await prismaTx.tenantTag.findMany({
      where: {
        tenantId,
        name: { in: tagNames },
      },
      select: { id: true },
    })
    if (!tags.length) return

    await prismaTx.contactTag.deleteMany({
      where: {
        tenantId,
        contactId: contactService.contactId,
        tagId: { in: tags.map((tag: { id: string }) => tag.id) },
      },
    })
    await createExecutionLog({
      prismaTx,
      tenantId,
      templateId,
      contactServiceId: contactService.id,
      contactId: contactService.contactId,
      actorUserId,
      flowNodeId: node.id,
      eventType: "ACTION_EXECUTED",
      title: node.data?.label?.trim() || "Removed contact tags",
      details: `Removed ${tagNames.length} tag${tagNames.length === 1 ? "" : "s"} from the contact.`,
      payload: { kind, tagNames },
    })
    return
  }

  if (kind === "statusUpdate" && node.data?.statusValue) {
    await prismaTx.contact.update({
      where: { id: contactService.contactId },
      data: { statusConfigId: node.data.statusValue },
    })
    await createExecutionLog({
      prismaTx,
      tenantId,
      templateId,
      contactServiceId: contactService.id,
      contactId: contactService.contactId,
      actorUserId,
      flowNodeId: node.id,
      eventType: "ACTION_EXECUTED",
      title: node.data?.label?.trim() || "Updated contact status",
      details: "Updated the contact status from the follow-up workflow.",
      payload: { kind, statusValue: node.data.statusValue },
    })
    return
  }

  if (kind === "contactFieldUpdate") {
    await applyContactFieldUpdate(
      prismaTx,
      tenantId,
      contactService.contactId,
      node,
      customFieldByKey,
    )
    await createExecutionLog({
      prismaTx,
      tenantId,
      templateId,
      contactServiceId: contactService.id,
      contactId: contactService.contactId,
      actorUserId,
      flowNodeId: node.id,
      eventType: "ACTION_EXECUTED",
      title: node.data?.label?.trim() || "Updated contact field",
      details: "Updated a contact field from the follow-up workflow.",
      payload: {
        kind,
        fieldKey: node.data?.fieldKey ?? null,
        fieldSource: node.data?.fieldSource ?? null,
        fieldOperation: node.data?.fieldOperation ?? null,
      },
    })
    return
  }

  if (kind === "addNote") {
    const title =
      node.data?.noteTitle?.trim() ||
      node.data?.label?.trim() ||
      "Follow-up note"
    const body = node.data?.notesTemplate?.trim() || ""

    const validAttachments = (node.data?.noteAttachments ?? []).filter(
      (item): item is { fileId: string } =>
        typeof item.fileId === "string" && item.fileId.length > 0,
    )

    await prismaTx.contactNote.create({
      data: {
        tenantId,
        contactId: contactService.contactId,
        title,
        body,
        createdById: actorUserId,
        attachments: validAttachments.length
          ? {
              create: validAttachments.map((attachment) => ({
                tenantId,
                fileId: attachment.fileId,
              })),
            }
          : undefined,
      },
    })
    await createExecutionLog({
      prismaTx,
      tenantId,
      templateId,
      contactServiceId: contactService.id,
      contactId: contactService.contactId,
      actorUserId,
      flowNodeId: node.id,
      eventType: "ACTION_EXECUTED",
      title,
      details: "Created a contact note from the follow-up workflow.",
      payload: { kind, attachmentCount: validAttachments.length },
    })
    return
  }

  if (kind === "addTask") {
    const defaultStatus = await prismaTx.taskStatusConfig.findFirst({
      where: { tenantId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    })

    const task = await prismaTx.task.create({
      data: {
        tenantId,
        contactId: contactService.contactId,
        statusConfigId: defaultStatus?.id ?? null,
        assignedToUserId: null,
        name:
          node.data?.taskTitle?.trim() ||
          node.data?.label?.trim() ||
          "Follow-up task",
        description: node.data?.notesTemplate?.trim() || null,
        startedAt: new Date(),
        linkedEntityName: contactService.serviceName,
        linkedEntityType: "SERVICE",
      },
      select: { id: true },
    })

    await createTaskActivity({
      prismaClient: prismaTx,
      tenantId,
      taskId: task.id,
      actorUserId,
      type: "CREATED",
      title: "Task created by follow-up workflow",
    })
    await createExecutionLog({
      prismaTx,
      tenantId,
      templateId,
      contactServiceId: contactService.id,
      contactId: contactService.contactId,
      actorUserId,
      flowNodeId: node.id,
      eventType: "ACTION_EXECUTED",
      title: node.data?.taskTitle?.trim() || node.data?.label?.trim() || "Created follow-up task",
      details: "Created a task from the follow-up workflow.",
      payload: { kind, taskId: task.id },
    })
    return
  }

  if (kind === "reminder") {
    const reminderTarget =
      node.data?.reminderTarget === "specific_user"
        ? node.data.reminderUserId || null
        : null

    let recipientUserId = reminderTarget

    if (!recipientUserId) {
      const contactOwner = await prismaTx.contact.findUnique({
        where: { id: contactService.contactId },
        select: { assignedToUserId: true },
      })
      recipientUserId = contactOwner?.assignedToUserId ?? null
    }

    if (!recipientUserId) return

    const contactName = contactService.contactName.trim() || "Contact"
    const reminderLabel = node.data?.label?.trim()
    const reminderTitle = reminderLabel
      ? `${reminderLabel}: ${contactName}`
      : `Follow-up reminder: ${contactName}`

    const notification = await prismaTx.notification.create({
      data: {
        tenantId,
        userId: recipientUserId,
        contactId: contactService.contactId,
        type: "TASK_REMINDER",
        title: reminderTitle,
        body:
          node.data?.notesTemplate?.trim() ||
          `${contactName} has a follow-up action in ${contactService.serviceName}.`,
      },
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

    const serialized = serializeNotification(notification)
    emitNotificationCreated(serialized.userId, serialized)
    await createExecutionLog({
      prismaTx,
      tenantId,
      templateId,
      contactServiceId: contactService.id,
      contactId: contactService.contactId,
      actorUserId,
      flowNodeId: node.id,
      eventType: "ACTION_EXECUTED",
      title: reminderTitle,
      details: "Sent a reminder notification from the follow-up workflow.",
      payload: { kind, notificationId: notification.id, recipientUserId },
    })
  }
}

export async function syncContactServiceActiveStep(params: {
  prismaTx: PrismaTx
  tenantId: string
  contactServiceId: string
  now?: Date
}) {
  const { prismaTx, tenantId, contactServiceId } = params
  const now = params.now ?? new Date()

  const activeStep = await prismaTx.contactServiceFollowUpStep.findFirst({
    where: {
      tenantId,
      contactServiceId,
      status: "ACTIVE",
    },
    select: { id: true },
  })

  if (activeStep) return activeStep.id

  const nextDueStep = await prismaTx.contactServiceFollowUpStep.findFirst({
    where: {
      tenantId,
      contactServiceId,
      status: { in: ["PENDING", "POSTPONED"] },
      OR: [{ availableAt: null }, { availableAt: { lte: now } }],
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  })

  if (!nextDueStep) return null

  await prismaTx.contactServiceFollowUpStep.update({
    where: { id: nextDueStep.id },
    data: { status: "ACTIVE" },
  })

  return nextDueStep.id
}

export async function executeFollowUpFromStep(params: {
  prismaTx: PrismaTx
  tenantId: string
  contactServiceId: string
  completedStepId: string
  completedStepSortOrder: number
  completedStepTemplateNodeId?: string | null
  actorUserId: string
  ignoreWaitNodes?: boolean
}) {
  const {
    prismaTx,
    tenantId,
    contactServiceId,
    completedStepId,
    completedStepSortOrder,
    completedStepTemplateNodeId,
    actorUserId,
    ignoreWaitNodes = false,
  } = params

  const contactService = await prismaTx.contactService.findFirst({
    where: {
      id: contactServiceId,
      tenantId,
    },
    select: {
      id: true,
      contactId: true,
      service: { select: { name: true } },
      followUpTemplate: {
        select: {
          id: true,
          flowNodes: true,
          flowEdges: true,
          steps: {
            select: {
              sortOrder: true,
              templateNodeId: true,
            },
          },
        },
      },
      followUpSteps: {
        where: { id: { not: completedStepId } },
        select: {
          id: true,
          templateNodeId: true,
          sortOrder: true,
          status: true,
        },
      },
      contact: {
        select: {
          firstName: true,
          middleName: true,
          lastName: true,
          email: true,
          phone: true,
          secondaryPhone: true,
          dateOfBirth: true,
          gender: true,
          smokerStatus: true,
          statusConfigId: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          postalCode: true,
          country: true,
          customFieldValues: {
            select: {
              value: true,
              field: {
                select: {
                  id: true,
                  key: true,
                },
              },
            },
          },
        },
      },
    },
  })

  if (!contactService) {
    return { activatedStepId: null, usedFlowExecution: false }
  }

  const fallbackNextStep = async () => {
    const nextUpcoming = await prismaTx.contactServiceFollowUpStep.findFirst({
      where: {
        tenantId,
        contactServiceId,
        sortOrder: { gt: completedStepSortOrder },
        status: { in: ["PENDING", "POSTPONED"] },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, availableAt: true },
    })

    if (!nextUpcoming)
      return { activatedStepId: null, usedFlowExecution: false }

    const shouldActivateNow =
      !nextUpcoming.availableAt ||
      nextUpcoming.availableAt.getTime() <= Date.now()
    await prismaTx.contactServiceFollowUpStep.update({
      where: { id: nextUpcoming.id },
      data: {
        status: shouldActivateNow ? "ACTIVE" : "PENDING",
      },
    })

    return { activatedStepId: nextUpcoming.id, usedFlowExecution: false }
  }

  const resolvedCompletedStepTemplateNodeId =
    completedStepTemplateNodeId ||
    contactService.followUpTemplate?.steps.find(
      (step: { sortOrder: number; templateNodeId: string | null }) =>
        step.sortOrder === completedStepSortOrder &&
        Boolean(step.templateNodeId),
    )?.templateNodeId ||
    null

  if (
    !resolvedCompletedStepTemplateNodeId ||
    !contactService.followUpTemplate
  ) {
    return fallbackNextStep()
  }

  const nodes = asNodes(contactService.followUpTemplate.flowNodes)
  const edges = asEdges(contactService.followUpTemplate.flowEdges)
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const currentNode = nodeById.get(resolvedCompletedStepTemplateNodeId)
  if (!currentNode) {
    return fallbackNextStep()
  }

  const customFieldByKey = await buildCustomFieldByKey(
    prismaTx,
    tenantId,
    contactService.contact.customFieldValues,
  )

  const enrolledStepByTemplateNodeId = new Map(
    contactService.followUpSteps
      .filter((item: { templateNodeId: string | null }) =>
        Boolean(item.templateNodeId),
      )
      .map(
        (item: {
          id: string
          templateNodeId: string
          sortOrder: number
          status: string
        }) => [item.templateNodeId, item],
      ),
  )

  const visitedNodeIds = new Set<string>()
  let pendingTargets = getOutgoingTargets(
    edges,
    resolvedCompletedStepTemplateNodeId,
  )
  let delayMs = 0

  await createExecutionLog({
    prismaTx,
    tenantId,
    templateId: contactService.followUpTemplate.id,
    contactServiceId: contactService.id,
    contactId: contactService.contactId,
    actorUserId,
    flowNodeId: resolvedCompletedStepTemplateNodeId,
    stepId: completedStepId,
    eventType: "FLOW_CONTINUED",
    title: "Continued follow-up flow from completed step",
    details: "Resumed execution from the current step to evaluate the next actions.",
    payload: { ignoreWaitNodes },
  })

  while (pendingTargets.length) {
    const currentTargetId = pendingTargets.shift()
    if (!currentTargetId || visitedNodeIds.has(currentTargetId)) continue
    visitedNodeIds.add(currentTargetId)

    const node = nodeById.get(currentTargetId)
    if (!node?.data?.kind) continue

    if (node.data.kind === "wait") {
      if (!ignoreWaitNodes) {
        const waitValue = Math.max(0, Number(node.data.waitValue) || 0)
        const waitUnit =
          node.data.waitUnit && node.data.waitUnit in WAIT_UNIT_TO_MS
            ? node.data.waitUnit
            : "days"
        delayMs += waitValue * WAIT_UNIT_TO_MS[waitUnit]
      }
      pendingTargets = [
        ...getOutgoingTargets(edges, node.id),
        ...pendingTargets,
      ]
      continue
    }

    if (node.data.kind === "goTo" && node.data.goToNodeId) {
      pendingTargets = [node.data.goToNodeId, ...pendingTargets]
      continue
    }

    if (node.data.kind === "ifElse") {
      const matchingBranch =
        (node.data.ifElseBranches ?? []).find((branch) => {
          if (branch.isDefault) return false

          let leftValue: unknown = null
          if (branch.source === "contactInfo") {
            const mappedKey = CONTACT_FIELD_MAP[branch.fieldKey ?? ""]
            leftValue = mappedKey
              ? (contactService.contact as Record<string, unknown>)[mappedKey]
              : null
          } else if (branch.source === "customField" && branch.fieldKey) {
            leftValue = customFieldByKey.get(branch.fieldKey)?.value ?? null
          }

          return evaluateOperator(
            leftValue,
            branch.operator,
            branch.compareValue,
            branch.valueType,
          )
        }) ??
        (node.data.ifElseBranches ?? []).find((branch) => branch.isDefault)

      if (matchingBranch?.targetNodeId) {
        pendingTargets = [matchingBranch.targetNodeId, ...pendingTargets]
      }
      continue
    }

    if (node.data.kind === "step") {
      const enrolledStep =
        enrolledStepByTemplateNodeId.get(node.id) ??
        contactService.followUpSteps.find(
          (step: { sortOrder: number; status: string }) =>
            step.sortOrder > completedStepSortOrder &&
            (step.status === "PENDING" || step.status === "POSTPONED"),
        )

      if (!enrolledStep) {
        return { activatedStepId: null, usedFlowExecution: true }
      }

      const activationTime = new Date(Date.now() + delayMs)
      const nextStatus = delayMs > 0 ? "PENDING" : "ACTIVE"

      await prismaTx.contactServiceFollowUpStep.update({
        where: { id: enrolledStep.id },
        data: {
          status: nextStatus,
          availableAt: activationTime,
          dueAt: activationTime,
          completedAt: null,
        },
      })

      await createExecutionLog({
        prismaTx,
        tenantId,
        templateId: contactService.followUpTemplate.id,
        contactServiceId: contactService.id,
        contactId: contactService.contactId,
        actorUserId,
        flowNodeId: node.id,
        stepId: enrolledStep.id,
        eventType: "STEP_ACTIVATED",
        title: `Activated step: ${node.data?.label?.trim() || "Next step"}`,
        details:
          nextStatus === "ACTIVE"
            ? "The next follow-up step became active immediately."
            : "The next follow-up step is scheduled and pending.",
        payload: { nextStatus, delayMs },
      })

      if (nextStatus === "ACTIVE") {
        await prismaTx.contactServiceFollowUpStep.updateMany({
          where: {
            tenantId,
            contactServiceId,
            id: { not: enrolledStep.id },
            status: "ACTIVE",
          },
          data: { status: "PENDING" },
        })
      }

      return { activatedStepId: enrolledStep.id, usedFlowExecution: true }
    }

    if (
      node.data.kind === "reminder" ||
      node.data.kind === "assign" ||
      node.data.kind === "removeUser" ||
      node.data.kind === "tagAdd" ||
      node.data.kind === "tagRemove" ||
      node.data.kind === "statusUpdate" ||
      node.data.kind === "contactFieldUpdate" ||
      node.data.kind === "addNote" ||
      node.data.kind === "addTask"
    ) {
      await executeActionNode({
        prismaTx,
        tenantId,
        templateId: contactService.followUpTemplate.id,
        actorUserId,
        contactService: {
          id: contactService.id,
          contactId: contactService.contactId,
          serviceName: contactService.service.name,
          contactName: [
            contactService.contact.firstName,
            contactService.contact.middleName,
            contactService.contact.lastName,
          ]
            .filter(Boolean)
            .join(" "),
        },
        node,
        customFieldByKey,
      })
    }

    pendingTargets = [...getOutgoingTargets(edges, node.id), ...pendingTargets]
  }

  await createExecutionLog({
    prismaTx,
    tenantId,
    templateId: contactService.followUpTemplate.id,
    contactServiceId: contactService.id,
    contactId: contactService.contactId,
    actorUserId,
    flowNodeId: resolvedCompletedStepTemplateNodeId,
    stepId: completedStepId,
    eventType: "FLOW_COMPLETED",
    title: "Reached end of follow-up flow",
    details: "No additional follow-up steps were activated after this execution.",
    payload: null,
  })

  return { activatedStepId: null, usedFlowExecution: true }
}

export async function executeFollowUpFromStart(params: {
  prismaTx: PrismaTx
  tenantId: string
  contactServiceId: string
  actorUserId: string
  ignoreWaitNodes?: boolean
}) {
  const {
    prismaTx,
    tenantId,
    contactServiceId,
    actorUserId,
    ignoreWaitNodes = true,
  } = params

  const contactService = await prismaTx.contactService.findFirst({
    where: {
      id: contactServiceId,
      tenantId,
    },
    select: {
      id: true,
      contactId: true,
      service: { select: { name: true } },
      followUpTemplate: {
        select: {
          id: true,
          flowNodes: true,
          flowEdges: true,
        },
      },
      followUpSteps: {
        select: {
          id: true,
          templateNodeId: true,
          sortOrder: true,
          status: true,
          availableAt: true,
          dueAt: true,
        },
      },
      contact: {
        select: {
          firstName: true,
          middleName: true,
          lastName: true,
          email: true,
          phone: true,
          secondaryPhone: true,
          dateOfBirth: true,
          gender: true,
          smokerStatus: true,
          statusConfigId: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          postalCode: true,
          country: true,
          customFieldValues: {
            select: {
              value: true,
              field: {
                select: {
                  id: true,
                  key: true,
                },
              },
            },
          },
        },
      },
    },
  })

  if (!contactService?.followUpTemplate) {
    return { activatedStepId: null, usedFlowExecution: false }
  }

  const nodes = asNodes(contactService.followUpTemplate.flowNodes)
  const edges = asEdges(contactService.followUpTemplate.flowEdges)
  const startNode = nodes.find((node) => node.data?.kind === "start")
  if (!startNode) {
    return { activatedStepId: null, usedFlowExecution: false }
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const customFieldByKey = await buildCustomFieldByKey(
    prismaTx,
    tenantId,
    contactService.contact.customFieldValues,
  )
  const enrolledStepByTemplateNodeId = new Map(
    contactService.followUpSteps
      .filter((item: { templateNodeId: string | null }) => Boolean(item.templateNodeId))
      .map(
        (item: {
          id: string
          templateNodeId: string
          sortOrder: number
          status: string
          availableAt: Date | null
          dueAt: Date | null
        }) => [item.templateNodeId, item],
      ),
  )

  const visitedNodeIds = new Set<string>()
  let pendingTargets = getOutgoingTargets(edges, startNode.id)
  let delayMs = 0

  await createExecutionLog({
    prismaTx,
    tenantId,
    templateId: contactService.followUpTemplate.id,
    contactServiceId: contactService.id,
    contactId: contactService.contactId,
    actorUserId,
    flowNodeId: startNode.id,
    eventType: "FLOW_STARTED",
    title: "Started follow-up flow from template",
    details: "Executed the template start path for this service enrollment.",
    payload: { ignoreWaitNodes },
  })

  while (pendingTargets.length) {
    const currentTargetId = pendingTargets.shift()
    if (!currentTargetId || visitedNodeIds.has(currentTargetId)) continue
    visitedNodeIds.add(currentTargetId)

    const node = nodeById.get(currentTargetId)
    if (!node?.data?.kind) continue

    if (node.data.kind === "wait") {
      if (!ignoreWaitNodes) {
        const waitValue = Math.max(0, Number(node.data.waitValue) || 0)
        const waitUnit =
          node.data.waitUnit && node.data.waitUnit in WAIT_UNIT_TO_MS
            ? node.data.waitUnit
            : "days"
        delayMs += waitValue * WAIT_UNIT_TO_MS[waitUnit]
      }
      pendingTargets = [...getOutgoingTargets(edges, node.id), ...pendingTargets]
      continue
    }

    if (node.data.kind === "goTo" && node.data.goToNodeId) {
      pendingTargets = [node.data.goToNodeId, ...pendingTargets]
      continue
    }

    if (node.data.kind === "ifElse") {
      const matchingBranch =
        (node.data.ifElseBranches ?? []).find((branch) => {
          if (branch.isDefault) return false

          let leftValue: unknown = null
          if (branch.source === "contactInfo") {
            const mappedKey = CONTACT_FIELD_MAP[branch.fieldKey ?? ""]
            leftValue = mappedKey
              ? (contactService.contact as Record<string, unknown>)[mappedKey]
              : null
          } else if (branch.source === "customField" && branch.fieldKey) {
            leftValue = customFieldByKey.get(branch.fieldKey)?.value ?? null
          }

          return evaluateOperator(
            leftValue,
            branch.operator,
            branch.compareValue,
            branch.valueType,
          )
        }) ??
        (node.data.ifElseBranches ?? []).find((branch) => branch.isDefault)

      if (matchingBranch?.targetNodeId) {
        pendingTargets = [matchingBranch.targetNodeId, ...pendingTargets]
      }
      continue
    }

    if (node.data.kind === "step") {
      const enrolledStep =
        enrolledStepByTemplateNodeId.get(node.id) ??
        [...contactService.followUpSteps]
          .sort((a: { sortOrder: number }, b: { sortOrder: number }) => a.sortOrder - b.sortOrder)[0]

      if (!enrolledStep) {
        return { activatedStepId: null, usedFlowExecution: true }
      }

      const activationTime =
        delayMs > 0 ? new Date(Date.now() + delayMs) : enrolledStep.availableAt ?? new Date()
      const nextStatus = delayMs > 0 ? "PENDING" : "ACTIVE"

      await prismaTx.contactServiceFollowUpStep.update({
        where: { id: enrolledStep.id },
        data: {
          status: nextStatus,
          availableAt: activationTime,
          dueAt: delayMs > 0 ? activationTime : enrolledStep.dueAt ?? activationTime,
          completedAt: null,
        },
      })

      await createExecutionLog({
        prismaTx,
        tenantId,
        templateId: contactService.followUpTemplate.id,
        contactServiceId: contactService.id,
        contactId: contactService.contactId,
        actorUserId,
        flowNodeId: node.id,
        stepId: enrolledStep.id,
        eventType: "STEP_ACTIVATED",
        title: `Activated step: ${node.data?.label?.trim() || "First step"}`,
        details:
          nextStatus === "ACTIVE"
            ? "The first follow-up step became active."
            : "The first follow-up step is scheduled and pending.",
        payload: { nextStatus, delayMs },
      })

      if (nextStatus === "ACTIVE") {
        await prismaTx.contactServiceFollowUpStep.updateMany({
          where: {
            tenantId,
            contactServiceId,
            id: { not: enrolledStep.id },
            status: "ACTIVE",
          },
          data: { status: "PENDING" },
        })
      }

      return { activatedStepId: enrolledStep.id, usedFlowExecution: true }
    }

    if (
      node.data.kind === "reminder" ||
      node.data.kind === "assign" ||
      node.data.kind === "removeUser" ||
      node.data.kind === "tagAdd" ||
      node.data.kind === "tagRemove" ||
      node.data.kind === "statusUpdate" ||
      node.data.kind === "contactFieldUpdate" ||
      node.data.kind === "addNote" ||
      node.data.kind === "addTask"
    ) {
      await executeActionNode({
        prismaTx,
        tenantId,
        templateId: contactService.followUpTemplate.id,
        actorUserId,
        contactService: {
          id: contactService.id,
          contactId: contactService.contactId,
          serviceName: contactService.service.name,
          contactName: [
            contactService.contact.firstName,
            contactService.contact.middleName,
            contactService.contact.lastName,
          ]
            .filter(Boolean)
            .join(" "),
        },
        node,
        customFieldByKey,
      })
    }

    pendingTargets = [...getOutgoingTargets(edges, node.id), ...pendingTargets]
  }

  await createExecutionLog({
    prismaTx,
    tenantId,
    templateId: contactService.followUpTemplate.id,
    contactServiceId: contactService.id,
    contactId: contactService.contactId,
    actorUserId,
    flowNodeId: startNode.id,
    eventType: "FLOW_COMPLETED",
    title: "Reached end of follow-up flow",
    details: "The flow finished without activating another step.",
    payload: null,
  })

  return { activatedStepId: null, usedFlowExecution: true }
}
