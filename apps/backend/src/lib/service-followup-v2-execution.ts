import { randomInt, randomUUID } from "node:crypto"

import { prisma } from "./prisma.js"
import { normalizeTenantTagName } from "./tag-utils.js"
import { emitNotificationCreated } from "./realtime.js"
import { serializeNotification } from "./task-notifications.js"
import {
  buildCustomFieldByKey,
  executeActionNode,
} from "./service-followup-execution.js"
import {
  WorkflowDefinitionV2Schema,
  getNodeBranches,
  type WorkflowConditionV2,
  type WorkflowDefinitionV2,
  type WorkflowEdgeV2,
  type WorkflowNodeV2,
} from "./service-followup-definition.js"
import {
  branchExclusiveStepNodeIds,
  selectFirstMatchingBranch,
} from "./service-followup-runtime.js"
import {
  WorkflowDefinitionV3Schema,
  getWorkflowWaitByActionId,
  getUserScheduledWaitByActionId,
  getUserScheduledWaitForStep,
  workflowDefinitionV3ToV2Graph,
} from "./service-followup-v3-definition.js"

type PrismaTx = any

type RunVariables = Record<string, unknown>
type BranchDecisions = Record<string, { branchId: string; branchName: string; decidedAt: string }>

const WAIT_UNIT_TO_MS = {
  days: 24 * 60 * 60 * 1000,
  hours: 60 * 60 * 1000,
  minutes: 60 * 1000,
} as const

function runtimeWorkflowDefinition(definitionValue: unknown) {
  const v3 = WorkflowDefinitionV3Schema.safeParse(definitionValue)
  return v3.success
    ? workflowDefinitionV3ToV2Graph(v3.data)
    : WorkflowDefinitionV2Schema.parse(definitionValue)
}

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

const ACTION_KINDS = new Set([
  "reminder",
  "assign",
  "removeUser",
  "tagAdd",
  "tagRemove",
  "statusUpdate",
  "contactFieldUpdate",
  "addNote",
  "addTask",
])

export class FollowUpExecutionError extends Error {
  code: string
  nodeId: string

  constructor(code: string, message: string, nodeId: string) {
    super(message)
    this.name = "FollowUpExecutionError"
    this.code = code
    this.nodeId = nodeId
  }
}

function recordValue(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function asVariables(value: unknown): RunVariables {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as RunVariables) }
    : {}
}

function asDecisions(value: unknown): BranchDecisions {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as BranchDecisions) }
    : {}
}

function outgoingEdges(definition: WorkflowDefinitionV2, nodeId: string) {
  return definition.edges.filter((edge) => edge.source === nodeId)
}

function onlyTarget(definition: WorkflowDefinitionV2, nodeId: string) {
  return outgoingEdges(definition, nodeId)[0]?.target ?? null
}

function comparableNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function comparableDate(value: unknown) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

export function userScheduledActivationDatesFromInput(value: unknown) {
  const input = recordValue(value)
  const scheduledAt = comparableDate(input.scheduledFor)
  if (!scheduledAt) return null
  const continuedEarlyAt = comparableDate(input.continuedEarlyAt)
  return {
    availableAt: continuedEarlyAt ?? scheduledAt,
    dueAt: scheduledAt,
  }
}

export function durationWaitActivationDates(
  resumeAtValue: unknown,
  inputValue: unknown,
) {
  const dueAt = comparableDate(resumeAtValue)
  if (!dueAt) return null
  const input = recordValue(inputValue)
  const continuedEarlyAt = comparableDate(input.continuedEarlyAt)
  return {
    availableAt: continuedEarlyAt ?? dueAt,
    dueAt,
  }
}

type RuntimeCustomField = {
  id: string
  key: string
  isEncrypted: boolean
  isSensitive: boolean
  value: unknown
  hasValue: boolean
}

function resolveConditionValue(params: {
  condition: WorkflowConditionV2
  contact: Record<string, unknown>
  customFields: RuntimeCustomField[]
  variables: RunVariables
  nodeId: string
}) {
  const { condition, contact, customFields, variables, nodeId } = params
  if (condition.source === "variable") return variables[condition.variableKey ?? ""]
  if (condition.source === "contactInfo") {
    if (condition.fieldKey === "currentDateTime") return new Date()
    if (condition.fieldKey === "ssn") {
      if (condition.operator !== "is_empty" && condition.operator !== "is_not_empty") {
        throw new FollowUpExecutionError(
          "SENSITIVE_FIELD_OPERATOR_NOT_ALLOWED",
          "Sensitive fields only support presence checks.",
          nodeId,
        )
      }
      return Boolean(contact.ssnCiphertext || contact.ssnLast4) ? "present" : null
    }
    const key = CONTACT_FIELD_MAP[condition.fieldKey ?? ""]
    return key ? contact[key] : null
  }
  const customField = customFields.find((field) =>
    condition.customFieldId
      ? field.id === condition.customFieldId
      : field.key === condition.fieldKey,
  )
  if (!customField) return null
  if (customField.isEncrypted || customField.isSensitive) {
    if (condition.operator !== "is_empty" && condition.operator !== "is_not_empty") {
      throw new FollowUpExecutionError(
        "SENSITIVE_FIELD_OPERATOR_NOT_ALLOWED",
        "Sensitive fields only support presence checks.",
        nodeId,
      )
    }
    return customField.hasValue ? "present" : null
  }
  return customField.value
}

function interpolateString(value: string, variables: RunVariables): unknown {
  const exact = value.match(/^\{\{\s*variables\.([A-Za-z][A-Za-z0-9_]*)\s*\}\}$/)
  if (exact) return variables[exact[1]] ?? ""
  return value.replace(
    /\{\{\s*variables\.([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g,
    (_match, key: string) => String(variables[key] ?? ""),
  )
}

function interpolateValue(value: unknown, variables: RunVariables): unknown {
  if (typeof value === "string") return interpolateString(value, variables)
  if (Array.isArray(value)) return value.map((item) => interpolateValue(item, variables))
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        interpolateValue(item, variables),
      ]),
    )
  }
  return value
}

function readField(params: {
  data: Record<string, unknown>
  contact: Record<string, unknown>
  customFields: RuntimeCustomField[]
  variables: RunVariables
  sourceKey: string
  fieldKey: string
}) {
  const { data, contact, customFields, variables, sourceKey, fieldKey } = params
  const variableKey = typeof data[`${sourceKey}VariableKey`] === "string" ? String(data[`${sourceKey}VariableKey`]) : null
  if (variableKey) return variables[variableKey]
  const source = data[`${sourceKey}FieldSource`] ?? data.fieldSource
  const key = data[`${sourceKey}FieldKey`] ?? data[fieldKey]
  if (typeof key !== "string") return null
  if (source === "custom") return customFields.find((field) => field.key === key)?.value ?? null
  const mapped = CONTACT_FIELD_MAP[key]
  return mapped ? contact[mapped] : null
}

function formatPhone(value: unknown, style: string, countryCode: string) {
  const digits = String(value ?? "").replace(/\D/g, "")
  const countryDigits = countryCode.replace(/\D/g, "")
  const national = digits.startsWith(countryDigits) ? digits.slice(countryDigits.length) : digits
  if (national.length !== 10) throw new Error("Phone input must contain a ten-digit national number.")
  const area = national.slice(0, 3)
  const prefix = national.slice(3, 6)
  const line = national.slice(6)
  if (style === "e164") return `+${countryDigits}${national}`
  if (style === "international") return `+${countryDigits} ${area}-${prefix}-${line}`
  if (style === "internationalNoCountryCode") return `${area}-${prefix}-${line}`
  if (style === "internationalNoHyphens") return `+${countryDigits} ${area} ${prefix} ${line}`
  if (style === "internationalNoSymbols") return `${countryDigits}${national}`
  if (style === "national") return `(${area}) ${prefix}-${line}`
  if (style === "nationalNoParenthesis") return `${area} ${prefix}-${line}`
  if (style === "nationalNoSymbols") return national
  if (style === "rfc3966") return `tel:+${countryDigits}-${area}-${prefix}-${line}`
  if (style === "rfc3966NoTel") return `+${countryDigits}-${area}-${prefix}-${line}`
  throw new Error("Unsupported phone format.")
}

function formatDatePattern(date: Date, pattern: string) {
  const parts: Record<string, string> = {
    YYYY: String(date.getUTCFullYear()).padStart(4, "0"),
    MM: String(date.getUTCMonth() + 1).padStart(2, "0"),
    DD: String(date.getUTCDate()).padStart(2, "0"),
    HH: String(date.getUTCHours()).padStart(2, "0"),
    mm: String(date.getUTCMinutes()).padStart(2, "0"),
    ss: String(date.getUTCSeconds()).padStart(2, "0"),
  }
  return pattern.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => parts[token])
}

function transformerOutput(params: {
  node: WorkflowNodeV2
  contact: Record<string, unknown>
  customFields: RuntimeCustomField[]
  variables: RunVariables
}) {
  const { node, contact, customFields, variables } = params
  const data = recordValue(interpolateValue(node.data, variables))
  if (node.kind === "mathOperation") {
    const source = readField({ data, contact, customFields, variables, sourceKey: "mathSource", fieldKey: "mathSourceFieldKey" })
    const amount = Number(data.mathOperationValue)
    if (!Number.isFinite(amount)) throw new Error("Math operation value is invalid.")
    const operation = String(data.mathOperationType ?? "add")
    if (data.mathValueType === "dateTime") {
      const sourceDate = comparableDate(source)
      if (!sourceDate) throw new Error("Math source is not a valid date.")
      const result = new Date(sourceDate)
      const signedAmount = operation === "subtract" ? -amount : amount
      const unit = String(data.mathDateUnit ?? "days")
      if (unit === "months") result.setUTCMonth(result.getUTCMonth() + signedAmount)
      else if (unit === "years") result.setUTCFullYear(result.getUTCFullYear() + signedAmount)
      else result.setUTCDate(result.getUTCDate() + signedAmount)
      return result.toISOString()
    }
    const sourceNumber = comparableNumber(source)
    if (sourceNumber === null) throw new Error("Math source is not a valid number.")
    if (operation === "divide" && amount === 0) throw new Error("Cannot divide by zero.")
    if (operation === "subtract") return sourceNumber - amount
    if (operation === "multiply") return sourceNumber * amount
    if (operation === "divide") return sourceNumber / amount
    return sourceNumber + amount
  }

  if (node.kind === "numberFormatter") {
    const mode = String(data.numberFormatterMode ?? "formatNumber")
    if (mode === "randomNumber") {
      const min = Math.ceil(Number(data.numberFormatterMin))
      const max = Math.floor(Number(data.numberFormatterMax))
      if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) throw new Error("Random number range is invalid.")
      return randomInt(min, max + 1)
    }
    const source = readField({
      data,
      contact,
      customFields,
      variables,
      sourceKey: mode === "formatPhoneNumber" ? "numberFormatter" : "numberFormatterInput",
      fieldKey: mode === "formatPhoneNumber" ? "numberFormatterFieldKey" : "numberFormatterInputFieldKey",
    })
    if (mode === "formatPhoneNumber") {
      return formatPhone(source, String(data.numberFormatterPhoneFormat ?? "e164"), String(data.numberFormatterCountryCode ?? "+1"))
    }
    const raw = String(source ?? "").trim()
    const decimalMark = String(data.numberFormatterInputDecimalMark ?? "period")
    const normalized = decimalMark === "comma"
      ? raw.replace(/[.\s]/g, "").replace(",", ".")
      : raw.replace(/[,\s]/g, "")
    const number = Number(normalized)
    if (!Number.isFinite(number)) throw new Error("Number formatter input is invalid.")
    if (mode === "textToNumber") return number
    if (mode === "formatCurrency") {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: String(data.numberFormatterCurrencyCode ?? "USD") }).format(number)
    }
    const grouping = String(data.numberFormatterGroupingStyle ?? "commaPeriod")
    const locale = grouping === "periodComma" ? "de-DE" : grouping === "spaceComma" ? "fr-FR" : grouping === "spacePeriod" ? "en-ZA" : "en-US"
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 20 }).format(number)
  }

  const source = readField({ data, contact, customFields, variables, sourceKey: "dateTimeFormatSource", fieldKey: "dateTimeFormatSourceFieldKey" })
  const sourceDate = comparableDate(source)
  if (!sourceDate) throw new Error("Date formatter source is invalid.")
  if (data.dateTimeFormatMode === "compareDates") {
    const compare = readField({ data, contact, customFields, variables, sourceKey: "dateTimeFormatCompare", fieldKey: "dateTimeFormatCompareFieldKey" })
    const compareDate = comparableDate(compare)
    if (!compareDate) throw new Error("Compare date is invalid.")
    const diffDays = (sourceDate.getTime() - compareDate.getTime()) / WAIT_UNIT_TO_MS.days
    const unit = String(data.dateTimeCompareUnit ?? "days")
    if (unit === "years") return diffDays / 365.2425
    if (unit === "months") return diffDays / 30.436875
    return diffDays
  }
  return formatDatePattern(sourceDate, String(data.dateTimeFormatPattern ?? "YYYY-MM-DD"))
}

async function logRunEvent(params: {
  prismaTx: PrismaTx
  run: any
  actorUserId?: string | null
  nodeId?: string | null
  stepId?: string | null
  eventType: string
  title: string
  details?: string | null
  payload?: Record<string, unknown> | null
}) {
  const { prismaTx, run, actorUserId, nodeId, stepId, eventType, title, details, payload } = params
  await prismaTx.serviceFollowUpExecutionLog.create({
    data: {
      tenantId: run.tenantId,
      templateId: run.templateVersion.templateId,
      templateVersionId: run.templateVersionId,
      runId: run.id,
      contactServiceId: run.contactServiceId,
      contactId: run.contactService.contactId,
      actorUserId: actorUserId ?? run.startedByUserId ?? null,
      flowNodeId: nodeId ?? null,
      stepId: stepId ?? null,
      eventType,
      title,
      details: details ?? null,
      payload: payload ?? null,
    },
  })
}

async function markExclusiveStepsSkipped(params: {
  prismaTx: PrismaTx
  run: any
  definition: WorkflowDefinitionV2
  conditionalNode: WorkflowNodeV2
  selectedEdge: WorkflowEdgeV2
}) {
  const { prismaTx, run, definition, conditionalNode, selectedEdge } = params
  const exclusiveStepIds = branchExclusiveStepNodeIds(
    definition,
    conditionalNode.id,
    selectedEdge.id,
  )
  if (!exclusiveStepIds.length) return
  const reason = "Automatically skipped by follow-up rule."
  const steps = await prismaTx.contactServiceFollowUpStep.findMany({
    where: {
      tenantId: run.tenantId,
      runId: run.id,
      templateNodeId: { in: exclusiveStepIds },
      status: "PENDING",
    },
    select: { id: true, templateNodeId: true, title: true },
  })
  for (const step of steps) {
    await prismaTx.contactServiceFollowUpStep.update({
      where: { id: step.id },
      data: {
        status: "SKIPPED",
        completedAt: new Date(),
        resolutionSource: "CONDITION_SKIPPED",
        resolutionReason: reason,
      },
    })
    await logRunEvent({
      prismaTx,
      run,
      nodeId: step.templateNodeId,
      stepId: step.id,
      eventType: "STEP_AUTO_SKIPPED",
      title: `Automatically skipped step: ${step.title}`,
      details: reason,
      payload: { conditionalNodeId: conditionalNode.id, branchId: selectedEdge.branchId },
    })
  }
}

async function markForwardGoToStepsSkipped(params: {
  prismaTx: PrismaTx
  run: any
  definition: WorkflowDefinitionV2
  goToNode: WorkflowNodeV2
  targetNodeId: string
}) {
  const { prismaTx, run, definition, goToNode, targetNodeId } = params
  const target = definition.nodes.find((node) => node.id === targetNodeId)
  if (!target || target.kind !== "step") return
  const stepNodeIds = definition.nodes
    .filter(
      (node) =>
        node.kind === "step" &&
        node.position.y > goToNode.position.y &&
        node.position.y < target.position.y,
    )
    .map((node) => node.id)
  if (!stepNodeIds.length) return
  const reason = "Automatically skipped by follow-up rule."
  const steps = await prismaTx.contactServiceFollowUpStep.findMany({
    where: {
      tenantId: run.tenantId,
      runId: run.id,
      templateNodeId: { in: stepNodeIds },
      status: "PENDING",
    },
    select: { id: true, templateNodeId: true, title: true },
  })
  for (const step of steps) {
    await prismaTx.contactServiceFollowUpStep.update({
      where: { id: step.id },
      data: {
        status: "SKIPPED",
        completedAt: new Date(),
        resolutionSource: "CONDITION_SKIPPED",
        resolutionReason: reason,
      },
    })
    await logRunEvent({
      prismaTx,
      run,
      nodeId: step.templateNodeId,
      stepId: step.id,
      eventType: "STEP_AUTO_SKIPPED",
      title: `Automatically skipped step: ${step.title}`,
      details: reason,
      payload: { routeNodeId: goToNode.id },
    })
  }
}

async function reconcileCompletion(prismaTx: PrismaTx, run: any) {
  const payments = await prismaTx.contactServicePayment.aggregate({
    where: { tenantId: run.tenantId, contactServiceId: run.contactServiceId },
    _sum: { amountCents: true },
  })
  const remaining = Math.max(0, run.contactService.totalPriceCents - (payments._sum.amountCents ?? 0))
  await prismaTx.contactService.update({
    where: { id: run.contactServiceId },
    data: {
      status: remaining === 0 ? "COMPLETED" : "PENDING_PAYMENT",
      completedAt: remaining === 0 ? new Date() : null,
    },
  })
}

async function loadRuntimeRun(prismaTx: PrismaTx, runId: string) {
  return prismaTx.contactServiceFollowUpRun.findUnique({
    where: { id: runId },
    include: {
      templateVersion: true,
      contactService: {
        select: {
          id: true,
          contactId: true,
          totalPriceCents: true,
          service: { select: { name: true } },
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
              ssnLast4: true,
              ssnCiphertext: true,
              customFieldValues: {
                select: {
                  value: true,
                  valueCiphertext: true,
                  field: {
                    select: {
                      id: true,
                      key: true,
                      fieldType: true,
                      options: true,
                      isEncrypted: true,
                      isSensitive: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
}

export async function stageUserScheduledWaitInputTx(params: {
  prismaTx: PrismaTx
  runId: string
  stepNodeId: string
  actorUserId: string
  scheduledFor?: Date | null
  bypassed: boolean
}) {
  const run = await params.prismaTx.contactServiceFollowUpRun.findUnique({
    where: { id: params.runId },
    include: { templateVersion: { select: { definition: true } } },
  })
  if (!run?.templateVersion) return null
  const requirement = getUserScheduledWaitForStep(
    run.templateVersion.definition,
    params.stepNodeId,
  )
  if (!requirement) return null
  await params.prismaTx.serviceFollowUpNodeExecution.upsert({
    where: { runId_nodeId: { runId: run.id, nodeId: requirement.actionId } },
    update: {
      status: "RUNNING",
      input: {
        scheduledFor: params.scheduledFor?.toISOString() ?? null,
        suppliedByUserId: params.actorUserId,
        bypassed: params.bypassed,
        sourceStepNodeId: params.stepNodeId,
      },
      output: undefined,
      errorCode: null,
      errorMessage: null,
      completedAt: null,
    },
    create: {
      tenantId: run.tenantId,
      runId: run.id,
      nodeId: requirement.actionId,
      status: "RUNNING",
      attemptCount: 0,
      input: {
        scheduledFor: params.scheduledFor?.toISOString() ?? null,
        suppliedByUserId: params.actorUserId,
        bypassed: params.bypassed,
        sourceStepNodeId: params.stepNodeId,
      },
    },
  })
  return requirement
}

export async function resetUserScheduledWaitForStepTx(params: {
  prismaTx: PrismaTx
  runId: string
  stepNodeId: string
}) {
  const run = await params.prismaTx.contactServiceFollowUpRun.findUnique({
    where: { id: params.runId },
    include: { templateVersion: { select: { definition: true } } },
  })
  if (!run?.templateVersion) return null
  const requirement = getUserScheduledWaitForStep(
    run.templateVersion.definition,
    params.stepNodeId,
  )
  if (!requirement) return null
  await params.prismaTx.serviceFollowUpNodeExecution.deleteMany({
    where: { runId: run.id, nodeId: requirement.actionId },
  })
  return requirement
}

async function scheduledActivationDatesForRun(params: {
  prismaTx: PrismaTx
  run: any
  targetStep: any
}) {
  const { prismaTx, run, targetStep } = params
  if (!run.waitingNodeId) return null
  const wait = getWorkflowWaitByActionId(
    run.templateVersion.definition,
    run.waitingNodeId,
  )
  if (!wait) return null
  const execution = await prismaTx.serviceFollowUpNodeExecution.findUnique({
    where: { runId_nodeId: { runId: run.id, nodeId: wait.actionId } },
    select: { input: true },
  })
  const activationDates = wait.waitMode === "USER_SCHEDULED"
    ? userScheduledActivationDatesFromInput(execution?.input)
    : durationWaitActivationDates(run.resumeAt, execution?.input)
  if (!activationDates) return null
  const scheduledAt = activationDates.dueAt

  const parsedV3 = WorkflowDefinitionV3Schema.safeParse(run.templateVersion.definition)
  const targetDefinition = parsedV3.success
    ? parsedV3.data.steps.find((step) => step.id === targetStep.templateNodeId)
    : null
  const dueDaysByStepId = new Map(
    parsedV3.success
      ? parsedV3.data.steps.map((step) => [step.id, step.dueDaysFromStart])
      : [],
  )
  const baseline = targetStep.dueAt ?? targetStep.availableAt
  const shiftMs = baseline ? scheduledAt.getTime() - baseline.getTime() : null
  const futureSteps = await prismaTx.contactServiceFollowUpStep.findMany({
    where: {
      tenantId: run.tenantId,
      runId: run.id,
      sortOrder: { gt: targetStep.sortOrder },
      status: "PENDING",
    },
    select: {
      id: true,
      templateNodeId: true,
      dueAt: true,
      availableAt: true,
    },
  })
  for (const futureStep of futureSteps) {
    const relativeDays = Math.max(
      0,
      (dueDaysByStepId.get(futureStep.templateNodeId ?? "") ?? targetDefinition?.dueDaysFromStart ?? 0) -
        (targetDefinition?.dueDaysFromStart ?? 0),
    )
    const fallback = new Date(scheduledAt.getTime() + relativeDays * WAIT_UNIT_TO_MS.days)
    await prismaTx.contactServiceFollowUpStep.update({
      where: { id: futureStep.id },
      data: {
        dueAt:
          shiftMs !== null && futureStep.dueAt
            ? new Date(futureStep.dueAt.getTime() + shiftMs)
            : fallback,
        availableAt:
          shiftMs !== null && futureStep.availableAt
            ? new Date(futureStep.availableAt.getTime() + shiftMs)
            : fallback,
        overdueNotifiedAt: null,
        overdueNotifiedDueAt: null,
      },
    })
  }
  return activationDates
}

export async function advanceFollowUpRunTx(params: {
  prismaTx: PrismaTx
  runId: string
  actorUserId?: string | null
  expectedLeaseToken?: string | null
}) {
  const { prismaTx, runId, actorUserId, expectedLeaseToken } = params
  const run = await loadRuntimeRun(prismaTx, runId)
  if (!run) return { status: "NOT_FOUND" as const }
  if (expectedLeaseToken && run.leaseToken !== expectedLeaseToken) return { status: "LEASE_LOST" as const }
  if (["COMPLETED", "CANCELED", "NEEDS_REVIEW"].includes(run.status)) return { status: run.status }

  const definition = runtimeWorkflowDefinition(run.templateVersion.definition)
  const nodeById = new Map(definition.nodes.map((node) => [node.id, node]))
  const contact = run.contactService.contact as Record<string, unknown>
  const customFields: RuntimeCustomField[] = run.contactService.contact.customFieldValues.map((item: any) => ({
    id: item.field.id,
    key: item.field.key,
    isEncrypted: Boolean(item.field.isEncrypted),
    isSensitive: Boolean(item.field.isSensitive),
    value: item.value,
    hasValue: item.value !== null && item.value !== undefined || Boolean(item.valueCiphertext),
  }))
  const customFieldByKey = await buildCustomFieldByKey(
    prismaTx,
    run.tenantId,
    run.contactService.contact.customFieldValues,
  )
  const variables = asVariables(run.variables)
  const branchDecisions = asDecisions(run.branchDecisions)
  let cursor = run.cursorNodeId ?? definition.nodes.find((node) => node.kind === "start")?.id ?? null

  for (let guard = 0; guard <= definition.nodes.length; guard += 1) {
    if (!cursor) throw new FollowUpExecutionError("MISSING_CURSOR", "The workflow cursor has no destination.", run.cursorNodeId ?? "unknown")
    const node = nodeById.get(cursor)
    if (!node) throw new FollowUpExecutionError("NODE_NOT_FOUND", "The next workflow node no longer exists.", cursor)

    const existingExecution = await prismaTx.serviceFollowUpNodeExecution.findUnique({
      where: { runId_nodeId: { runId: run.id, nodeId: node.id } },
    })
    if (existingExecution?.status === "SUCCEEDED" && node.kind !== "step") {
      if (node.kind === "ifElse") {
        const recordedBranchId = branchDecisions[node.id]?.branchId
        cursor = outgoingEdges(definition, node.id).find(
          (edge) => edge.branchId === recordedBranchId,
        )?.target ?? null
        if (!cursor) {
          throw new FollowUpExecutionError(
            "RECORDED_BRANCH_MISSING",
            "The recorded branch no longer has a destination in this pinned version.",
            node.id,
          )
        }
      } else {
        cursor = onlyTarget(definition, node.id)
      }
      continue
    }
    await prismaTx.serviceFollowUpNodeExecution.upsert({
      where: { runId_nodeId: { runId: run.id, nodeId: node.id } },
      update: {
        status: "RUNNING",
        attemptCount: { increment: 1 },
        errorCode: null,
        errorMessage: null,
        startedAt: new Date(),
        completedAt: null,
      },
      create: { tenantId: run.tenantId, runId: run.id, nodeId: node.id, status: "RUNNING" },
    })

    if (node.kind === "end") {
      const pendingSteps = await prismaTx.contactServiceFollowUpStep.findMany({
        where: { tenantId: run.tenantId, runId: run.id, status: { in: ["PENDING", "POSTPONED"] } },
        select: { id: true, title: true, templateNodeId: true },
      })
      for (const step of pendingSteps) {
        await prismaTx.contactServiceFollowUpStep.update({
          where: { id: step.id },
          data: {
            status: "SKIPPED",
            completedAt: new Date(),
            resolutionSource: "FLOW_SKIPPED",
            resolutionReason: "This step was not part of the selected workflow path.",
          },
        })
      }
      await prismaTx.serviceFollowUpNodeExecution.update({
        where: { runId_nodeId: { runId: run.id, nodeId: node.id } },
        data: { status: "SUCCEEDED", completedAt: new Date() },
      })
      await prismaTx.contactServiceFollowUpRun.update({
        where: { id: run.id },
        data: {
          status: "COMPLETED",
          cursorNodeId: node.id,
          activeStepId: null,
          resumeAt: null,
          waitingNodeId: null,
          completedAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
          variables,
          branchDecisions,
        },
      })
      await logRunEvent({ prismaTx, run, actorUserId, nodeId: node.id, eventType: "FLOW_COMPLETED", title: "Reached the shared end of the follow-up flow." })
      await reconcileCompletion(prismaTx, run)
      return { status: "COMPLETED" as const }
    }

    if (node.kind === "step") {
      const step = await prismaTx.contactServiceFollowUpStep.findFirst({
        where: { tenantId: run.tenantId, runId: run.id, templateNodeId: node.id },
      })
      if (!step) throw new FollowUpExecutionError("STEP_NOT_FOUND", "The workflow step record is missing.", node.id)
      if (step.status === "COMPLETED" || step.status === "SKIPPED") {
        cursor = onlyTarget(definition, node.id)
        continue
      }
      await prismaTx.contactServiceFollowUpStep.updateMany({
        where: { tenantId: run.tenantId, runId: run.id, id: { not: step.id }, status: "ACTIVE" },
        data: { status: "PENDING" },
      })
      const scheduledActivationDates = await scheduledActivationDatesForRun({
        prismaTx,
        run,
        targetStep: step,
      })
      await prismaTx.contactServiceFollowUpStep.update({
        where: { id: step.id },
        data: {
          status: "ACTIVE",
          availableAt: scheduledActivationDates?.availableAt ?? new Date(),
          dueAt: scheduledActivationDates?.dueAt ?? step.dueAt ?? new Date(),
          overdueNotifiedAt: null,
          overdueNotifiedDueAt: null,
        },
      })
      await prismaTx.serviceFollowUpNodeExecution.update({
        where: { runId_nodeId: { runId: run.id, nodeId: node.id } },
        data: { status: "SUCCEEDED", completedAt: new Date() },
      })
      await prismaTx.contactServiceFollowUpRun.update({
        where: { id: run.id },
        data: {
          status: "AWAITING_STEP",
          cursorNodeId: node.id,
          activeStepId: step.id,
          resumeAt: null,
          waitingNodeId: null,
          leaseToken: null,
          leaseExpiresAt: null,
          variables,
          branchDecisions,
        },
      })
      await logRunEvent({ prismaTx, run, actorUserId, nodeId: node.id, stepId: step.id, eventType: "STEP_ACTIVATED", title: `Activated step: ${step.title}` })
      return { status: "AWAITING_STEP" as const, activeStepId: step.id }
    }

    if (node.kind === "wait") {
      const data = recordValue(node.data)
      if (data.waitMode === "USER_SCHEDULED") {
        const input = recordValue(existingExecution?.input)
        const nextNodeId = onlyTarget(definition, node.id)
        if (input.bypassed === true) {
          await prismaTx.serviceFollowUpNodeExecution.update({
            where: { runId_nodeId: { runId: run.id, nodeId: node.id } },
            data: {
              status: "SUCCEEDED",
              completedAt: new Date(),
              output: { bypassed: true },
            },
          })
          await logRunEvent({
            prismaTx,
            run,
            actorUserId,
            nodeId: node.id,
            eventType: "MANUAL_WAIT_BYPASSED",
            title: "User-skipped step bypassed the scheduled follow-up wait.",
          })
          cursor = nextNodeId
          continue
        }
        const scheduledFor = comparableDate(input.scheduledFor)
        if (!scheduledFor) {
          throw new FollowUpExecutionError(
            "NEXT_FOLLOW_UP_AT_REQUIRED",
            "This Wait requires a user-supplied next follow-up date and time.",
            node.id,
          )
        }
        await prismaTx.serviceFollowUpNodeExecution.update({
          where: { runId_nodeId: { runId: run.id, nodeId: node.id } },
          data: {
            status: "SUCCEEDED",
            completedAt: new Date(),
            output: { scheduledFor: scheduledFor.toISOString() },
          },
        })
        if (scheduledFor.getTime() <= Date.now()) {
          run.waitingNodeId = node.id
          run.resumeAt = scheduledFor
          await prismaTx.contactServiceFollowUpRun.update({
            where: { id: run.id },
            data: {
              cursorNodeId: nextNodeId,
              resumeAt: scheduledFor,
              waitingNodeId: node.id,
              variables,
              branchDecisions,
            },
          })
          cursor = nextNodeId
          continue
        }
        await prismaTx.contactServiceFollowUpRun.update({
          where: { id: run.id },
          data: {
            status: "WAITING",
            cursorNodeId: nextNodeId,
            resumeAt: scheduledFor,
            waitingNodeId: node.id,
            activeStepId: null,
            leaseToken: null,
            leaseExpiresAt: null,
            variables,
            branchDecisions,
          },
        })
        await logRunEvent({
          prismaTx,
          run,
          actorUserId,
          nodeId: node.id,
          eventType: "MANUAL_WAIT_SCHEDULED",
          title: `Next follow-up scheduled for ${scheduledFor.toISOString()}`,
          payload: { scheduledFor },
        })
        return { status: "WAITING" as const, resumeAt: scheduledFor }
      }
      const amount = Math.max(0, Number(data.waitValue) || 0)
      const unit = data.waitUnit === "hours" || data.waitUnit === "minutes" ? data.waitUnit : "days"
      const delayMs = amount * WAIT_UNIT_TO_MS[unit]
      const nextNodeId = onlyTarget(definition, node.id)
      await prismaTx.serviceFollowUpNodeExecution.update({
        where: { runId_nodeId: { runId: run.id, nodeId: node.id } },
        data: { status: "SUCCEEDED", completedAt: new Date(), output: { delayMs } },
      })
      if (delayMs === 0) {
        cursor = nextNodeId
        continue
      }
      const resumeAt = new Date(Date.now() + delayMs)
      await prismaTx.contactServiceFollowUpRun.update({
        where: { id: run.id },
        data: {
          status: "WAITING",
          cursorNodeId: nextNodeId,
          resumeAt,
          waitingNodeId: node.id,
          activeStepId: null,
          leaseToken: null,
          leaseExpiresAt: null,
          variables,
          branchDecisions,
        },
      })
      await logRunEvent({ prismaTx, run, actorUserId, nodeId: node.id, eventType: "FLOW_WAITING", title: `Waiting until ${resumeAt.toISOString()}`, payload: { resumeAt, unit, amount } })
      return { status: "WAITING" as const, resumeAt }
    }

    if (node.kind === "ifElse") {
      const branches = getNodeBranches(node)
      const matching = selectFirstMatchingBranch(branches, (condition) =>
        resolveConditionValue({ condition, contact, customFields, variables, nodeId: node.id }),
      )
      if (!matching) throw new FollowUpExecutionError("NO_BRANCH_MATCH", "No conditional branch or Default branch is available.", node.id)
      const selectedEdge = outgoingEdges(definition, node.id).find((edge) => edge.branchId === matching.id)
      if (!selectedEdge) throw new FollowUpExecutionError("BRANCH_TARGET_MISSING", "The selected branch has no destination.", node.id)
      await markExclusiveStepsSkipped({ prismaTx, run, definition, conditionalNode: node, selectedEdge })
      branchDecisions[node.id] = { branchId: matching.id, branchName: matching.name, decidedAt: new Date().toISOString() }
      await prismaTx.serviceFollowUpNodeExecution.update({
        where: { runId_nodeId: { runId: run.id, nodeId: node.id } },
        data: { status: "SUCCEEDED", completedAt: new Date(), output: { branchId: matching.id } },
      })
      await logRunEvent({ prismaTx, run, actorUserId, nodeId: node.id, eventType: "BRANCH_SELECTED", title: `Selected branch: ${matching.name}`, payload: { branchId: matching.id, matchMode: matching.matchMode } })
      cursor = selectedEdge.target
      continue
    }

    if (node.kind === "goTo") {
      const targetNodeId = onlyTarget(definition, node.id)
      if (!targetNodeId) throw new FollowUpExecutionError("GO_TO_TARGET_MISSING", "Go To has no later manual-step destination.", node.id)
      await markForwardGoToStepsSkipped({ prismaTx, run, definition, goToNode: node, targetNodeId })
      await prismaTx.serviceFollowUpNodeExecution.update({
        where: { runId_nodeId: { runId: run.id, nodeId: node.id } },
        data: { status: "SUCCEEDED", completedAt: new Date(), output: { targetStepId: targetNodeId } },
      })
      await prismaTx.contactServiceFollowUpRun.update({
        where: { id: run.id },
        data: { cursorNodeId: targetNodeId, variables, branchDecisions },
      })
      await logRunEvent({ prismaTx, run, actorUserId, nodeId: node.id, eventType: "ROUTE_SELECTED", title: `Routed to: ${nodeById.get(targetNodeId)?.label || "later step"}`, payload: { targetStepId: targetNodeId } })
      cursor = targetNodeId
      continue
    }

    let output: unknown = null
    if (node.kind === "mathOperation" || node.kind === "numberFormatter" || node.kind === "dateTimeFormatter") {
      try {
        output = transformerOutput({ node, contact, customFields, variables })
      } catch (error) {
        throw new FollowUpExecutionError("TRANSFORM_FAILED", error instanceof Error ? error.message : "Transformation failed.", node.id)
      }
      const outputKey = recordValue(node.data).outputKey
      if (typeof outputKey !== "string" || !outputKey.trim()) {
        throw new FollowUpExecutionError("OUTPUT_KEY_REQUIRED", "The transformer has no output name.", node.id)
      }
      variables[outputKey] = output
      if (node.kind === "mathOperation") {
        const data = recordValue(node.data)
        if (typeof data.mathResultFieldKey === "string" && data.mathResultFieldKey) {
          await executeActionNode({
            prismaTx,
            tenantId: run.tenantId,
            templateId: run.templateVersion.templateId,
            templateVersionId: run.templateVersionId,
            runId: run.id,
            actorUserId: actorUserId ?? run.startedByUserId,
            contactService: {
              id: run.contactServiceId,
              contactId: run.contactService.contactId,
              serviceName: run.contactService.service.name,
              contactName: [contact.firstName, contact.middleName, contact.lastName].filter(Boolean).join(" "),
              activeStepId: run.activeStepId,
            },
            node: {
              id: node.id,
              data: {
                kind: "contactFieldUpdate",
                fieldSource: data.mathResultFieldSource === "custom" ? "custom" : "contact",
                fieldKey: data.mathResultFieldKey,
                fieldOperation: "update",
                fieldValue: output as string,
                label: node.label,
              },
            },
            customFieldByKey,
          })
        }
      }
    } else if (ACTION_KINDS.has(node.kind)) {
      const interpolatedData = recordValue(interpolateValue(node.data, variables))
      try {
        await executeActionNode({
          prismaTx,
          tenantId: run.tenantId,
          templateId: run.templateVersion.templateId,
          templateVersionId: run.templateVersionId,
          runId: run.id,
          actorUserId: actorUserId ?? run.startedByUserId,
          contactService: {
            id: run.contactServiceId,
            contactId: run.contactService.contactId,
            serviceName: run.contactService.service.name,
            contactName: [contact.firstName, contact.middleName, contact.lastName].filter(Boolean).join(" "),
            activeStepId: run.activeStepId,
          },
          node: { id: node.id, data: { ...interpolatedData, kind: node.kind, label: node.label } },
          customFieldByKey,
        })
      } catch (error) {
        throw new FollowUpExecutionError("ACTION_FAILED", error instanceof Error ? error.message : "Workflow action failed.", node.id)
      }
    }

    await prismaTx.serviceFollowUpNodeExecution.update({
      where: { runId_nodeId: { runId: run.id, nodeId: node.id } },
      data: { status: "SUCCEEDED", completedAt: new Date(), output: output === null ? undefined : { value: output } },
    })
    await prismaTx.contactServiceFollowUpRun.update({
      where: { id: run.id },
      data: { cursorNodeId: onlyTarget(definition, node.id), variables, branchDecisions },
    })
    await logRunEvent({ prismaTx, run, actorUserId, nodeId: node.id, eventType: "NODE_SUCCEEDED", title: node.label || `Completed ${node.kind}`, payload: output === null ? { kind: node.kind } : { kind: node.kind, outputKey: recordValue(node.data).outputKey ?? null } })
    cursor = onlyTarget(definition, node.id)
  }

  throw new FollowUpExecutionError("EXECUTION_GUARD", "Workflow execution exceeded its node limit.", cursor ?? "unknown")
}

async function recordRunFailure(runId: string, error: unknown, actorUserId?: string | null) {
  const nodeId = error instanceof FollowUpExecutionError ? error.nodeId : "unknown"
  const code = error instanceof FollowUpExecutionError ? error.code : "UNEXPECTED_EXECUTION_ERROR"
  const message = error instanceof Error ? error.message : "Unexpected workflow execution error."
  const notifications: any[] = []

  await prisma.$transaction(async (tx) => {
    const prismaTx = tx as any
    const run = await loadRuntimeRun(prismaTx, runId)
    if (!run) return
    await prismaTx.contactServiceFollowUpRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        failureNodeId: nodeId,
        failureCode: code,
        failureMessage: message.slice(0, 1000),
        failedAt: new Date(),
        leaseToken: null,
        leaseExpiresAt: null,
      },
    })
    await prismaTx.serviceFollowUpNodeExecution.upsert({
      where: { runId_nodeId: { runId, nodeId } },
      update: {
        status: "FAILED",
        attemptCount: { increment: 1 },
        errorCode: code,
        errorMessage: message.slice(0, 1000),
        completedAt: new Date(),
      },
      create: { tenantId: run.tenantId, runId, nodeId, status: "FAILED", errorCode: code, errorMessage: message.slice(0, 1000), completedAt: new Date() },
    })
    await logRunEvent({ prismaTx, run, actorUserId, nodeId, eventType: "FLOW_FAILED", title: "Follow-up workflow paused after an error.", details: message, payload: { code } })

    const admins = await prismaTx.membership.findMany({
      where: { tenantId: run.tenantId, status: "ACTIVE", role: "TENANT_ADMIN" },
      select: { userId: true },
    })
    for (const admin of admins) {
      const notification = await prismaTx.notification.upsert({
        where: { eventKey: `follow-up-failed:${run.id}:${nodeId}:${admin.userId}` },
        update: { body: message.slice(0, 500), readAt: null },
        create: {
          tenantId: run.tenantId,
          userId: admin.userId,
          contactId: run.contactService.contactId,
          eventKey: `follow-up-failed:${run.id}:${nodeId}:${admin.userId}`,
          type: "FOLLOW_UP_FAILED",
          title: `Follow-up paused: ${run.contactService.service.name}`,
          body: message.slice(0, 500),
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
      notifications.push(notification)
    }
  })

  for (const notification of notifications) {
    const serialized = serializeNotification(notification)
    emitNotificationCreated(serialized.userId, serialized)
  }
  return { status: "FAILED" as const, code, message, nodeId }
}

export async function executeFollowUpRun(params: {
  runId: string
  actorUserId?: string | null
  expectedLeaseToken?: string | null
}) {
  try {
    return await prisma.$transaction((tx) =>
      advanceFollowUpRunTx({ prismaTx: tx as any, ...params }),
    )
  } catch (error) {
    return recordRunFailure(params.runId, error, params.actorUserId)
  }
}

export async function resumeDueFollowUpRuns() {
  const now = new Date()
  const candidates = await (prisma as any).contactServiceFollowUpRun.findMany({
    where: {
      OR: [
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
    orderBy: { resumeAt: "asc" },
    take: 50,
    select: { id: true },
  })
  const results = []
  for (const candidate of candidates) {
    const leaseToken = randomUUID()
    const claimed = await (prisma as any).contactServiceFollowUpRun.updateMany({
      where: {
        id: candidate.id,
        OR: [
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
    results.push(await executeFollowUpRun({ runId: candidate.id, expectedLeaseToken: leaseToken }))
  }
  return results
}

export async function retryFailedFollowUpRun(params: { runId: string; actorUserId: string }) {
  const updated = await (prisma as any).contactServiceFollowUpRun.updateMany({
    where: { id: params.runId, status: "FAILED" },
    data: {
      status: "RUNNING",
      failureNodeId: null,
      failureCode: null,
      failureMessage: null,
      failedAt: null,
    },
  })
  if (!updated.count) return { status: "NOT_RETRYABLE" as const }
  return executeFollowUpRun(params)
}

export async function continueFollowUpRunFromStepTx(params: {
  prismaTx: PrismaTx
  runId: string
  stepNodeId: string
}) {
  const run = await params.prismaTx.contactServiceFollowUpRun.findUnique({
    where: { id: params.runId },
    include: { templateVersion: { select: { definition: true } } },
  })
  if (!run) return false
  const definition = runtimeWorkflowDefinition(run.templateVersion.definition)
  const nextNodeId = onlyTarget(definition, params.stepNodeId)
  if (!nextNodeId) throw new Error("Completed workflow step has no next node.")
  await params.prismaTx.contactServiceFollowUpRun.update({
    where: { id: run.id },
    data: {
      status: "RUNNING",
      cursorNodeId: nextNodeId,
      resumeAt: null,
      waitingNodeId: null,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  })
  return true
}

export async function postponeFollowUpRunStepTx(params: {
  prismaTx: PrismaTx
  runId: string
  stepNodeId: string
  resumeAt: Date
}) {
  const step = await params.prismaTx.contactServiceFollowUpStep.findFirst({
    where: { runId: params.runId, templateNodeId: params.stepNodeId },
    select: { id: true },
  })
  const updated = await params.prismaTx.contactServiceFollowUpRun.updateMany({
    where: { id: params.runId, status: { in: ["AWAITING_STEP", "RUNNING"] } },
    data: {
      status: "WAITING",
      cursorNodeId: params.stepNodeId,
      activeStepId: step?.id ?? null,
      resumeAt: params.resumeAt,
      waitingNodeId: null,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  })
  return updated.count > 0
}

export function workflowStepDefinitions(definitionValue: unknown) {
  const v3 = WorkflowDefinitionV3Schema.safeParse(definitionValue)
  if (v3.success) {
    return v3.data.steps.map((step, index) => ({
      templateNodeId: step.id,
      title: step.name.trim(),
      notesTemplate: step.notesTemplate ?? null,
      dueDaysFromStart: step.dueDaysFromStart,
      sortOrder: (index + 1) * 10,
    }))
  }
  const definition = WorkflowDefinitionV2Schema.parse(definitionValue)
  return definition.nodes
    .filter((node) => node.kind === "step")
    .sort((left, right) => left.position.y - right.position.y || left.position.x - right.position.x)
    .map((node, index) => ({
      templateNodeId: node.id,
      title: node.label.trim(),
      notesTemplate: typeof recordValue(node.data).notesTemplate === "string" ? String(recordValue(node.data).notesTemplate) : null,
      sortOrder: (index + 1) * 10,
    }))
}

export async function createFollowUpRunTx(params: {
  prismaTx: PrismaTx
  tenantId: string
  contactServiceId: string
  templateVersion: { id: string; definition: unknown }
  startedByUserId: string
  assignedToUserId?: string | null
}) {
  const { prismaTx, tenantId, contactServiceId, templateVersion, startedByUserId, assignedToUserId } = params
  const definition = runtimeWorkflowDefinition(templateVersion.definition)
  const startId = definition.nodes.find((node) => node.kind === "start")?.id
  if (!startId) throw new Error("Published workflow is missing Start.")
  const run = await prismaTx.contactServiceFollowUpRun.create({
    data: {
      tenantId,
      contactServiceId,
      templateVersionId: templateVersion.id,
      startedByUserId,
      status: "RUNNING",
      cursorNodeId: startId,
      variables: {},
      branchDecisions: {},
    },
  })
  const steps = workflowStepDefinitions(definition)
  if (steps.length) {
    await prismaTx.contactServiceFollowUpStep.createMany({
      data: steps.map((step) => ({
        tenantId,
        contactServiceId,
        runId: run.id,
        templateNodeId: step.templateNodeId,
        title: step.title,
        notesTemplate: step.notesTemplate,
        status: "PENDING",
        availableAt: null,
        dueAt: null,
        assignedToUserId: assignedToUserId ?? null,
        sortOrder: step.sortOrder,
      })),
    })
  }
  return run
}
