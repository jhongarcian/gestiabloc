import { randomUUID } from "node:crypto"

import { type Response, Router } from "express"
import { z } from "zod"

import { decryptCustomFieldValue } from "../lib/contact-custom-field-encryption.js"
import { prisma } from "../lib/prisma.js"
import { generateServiceFitExplanation } from "../lib/service-fit-explanations.js"
import { routeServiceQuestion } from "../lib/service-fit-question-router.js"
import {
  buildServiceFitFieldCatalog,
  evaluateServiceFitProfile,
  normalizeServiceFitProfile,
  sortServiceFitEvaluations,
  validateServiceFitProfile,
} from "../lib/service-fit.js"
import {
  executeFollowUpFromStart,
  executeFollowUpFromStep,
  syncContactServiceActiveStep,
} from "../lib/service-followup-execution.js"
import {
  canCompleteFollowUpStepNow,
  resolveEffectiveNextFollowUp,
  serializeEffectiveNextFollowUp,
} from "../lib/service-followup-next-follow-up.js"
import {
  continueFollowUpRunFromStepTx,
  createFollowUpRunTx,
  executeFollowUpRun,
  postponeFollowUpRunStepTx,
  resetUserScheduledWaitForStepTx,
  retryFailedFollowUpRun,
  stageUserScheduledWaitInputTx,
} from "../lib/service-followup-v2-execution.js"
import {
  getWorkflowWaitByActionId,
  getUserScheduledWaitByActionId,
  getUserScheduledWaitForStep,
} from "../lib/service-followup-v3-definition.js"
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js"

const router = Router()
const prismaWithServices = prisma as any

const stripHtmlTags = (value: string) => value.replace(/<[^>]*>/g, " ")
const removeUnsafeControls = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
const sanitizeSingleLineText = (value: string) =>
  removeUnsafeControls(stripHtmlTags(value)).replace(/\s+/g, " ").trim()
const sanitizeMultilineText = (value: string) =>
  removeUnsafeControls(stripHtmlTags(value))
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .trim()
const normalizeSearchValue = (value: string | null | undefined) =>
  value?.trim().toLowerCase().replace(/\s+/g, " ") ?? ""
const normalizePhoneSearchValue = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "")
const splitSearchTokens = (value: string | null | undefined) =>
  normalizeSearchValue(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
const getSearchTokens = (
  value: string | null | undefined,
  options?: { includeSingleCharacter?: boolean },
) => {
  const includeSingleCharacter = options?.includeSingleCharacter ?? false

  return splitSearchTokens(value).filter((token) => {
    if (includeSingleCharacter) return true
    return token.length > 1 || /\d/.test(token)
  })
}
const getNameSearchPrefix = (token: string, options?: { broad?: boolean }) => {
  const normalizedToken = normalizeSearchValue(token)
  if (!normalizedToken) return ""
  if (!options?.broad) return normalizedToken
  if (normalizedToken.length <= 2) return normalizedToken
  return normalizedToken.slice(0, 2)
}
const buildStartsWithClauses = (
  fields: string[],
  token: string,
  options?: { broad?: boolean },
) => {
  const normalizedToken = normalizeSearchValue(token)
  if (!normalizedToken) return []

  const values = [normalizedToken, getNameSearchPrefix(normalizedToken, options)].filter(Boolean)

  return fields.flatMap((field) =>
    [...new Set(values)].map((value) => ({
      [field]: { startsWith: value, mode: "insensitive" as const },
    })),
  )
}
const buildRelatedContactSearchWhere = (query: string) => {
  const normalizedQuery = normalizeSearchValue(query)
  const queryTokens = getSearchTokens(query, { includeSingleCharacter: true })
  const hasEmailLikeQuery = normalizedQuery.includes("@")
  const hasPhoneLikeQuery = normalizePhoneSearchValue(query).length >= 3
  const nameTokens = queryTokens.filter((token) => /[a-z]/i.test(token))

  const andClauses: Array<Record<string, unknown>> = []

  if (!hasEmailLikeQuery && !hasPhoneLikeQuery && nameTokens.length >= 2) {
    const firstToken = nameTokens[0]!
    const lastToken = nameTokens[nameTokens.length - 1]!
    const middleTokens = nameTokens.slice(1, -1)

    andClauses.push({
      OR: buildStartsWithClauses(["firstName", "middleName"], firstToken, {
        broad: true,
      }),
    })

    andClauses.push({
      OR:
        nameTokens.length === 2
          ? buildStartsWithClauses(["lastName", "middleName"], lastToken)
          : buildStartsWithClauses(["lastName"], lastToken),
    })

    for (const token of middleTokens) {
      andClauses.push({
        OR: buildStartsWithClauses(["middleName"], token),
      })
    }

    return { AND: andClauses }
  }

  const singleTokenTerms = [...new Set([normalizedQuery, ...getSearchTokens(query)].filter(Boolean))]

  andClauses.push({
    OR: singleTokenTerms.flatMap((term) => [
      ...buildStartsWithClauses(["firstName", "middleName", "lastName"], term, {
        broad: true,
      }),
      { email: { contains: term, mode: "insensitive" as const } },
      { phone: { contains: term, mode: "insensitive" as const } },
    ]),
  })

  return { AND: andClauses }
}
const fileNameFromKey = (key: string) => {
  const segments = key.split("/")
  return segments[segments.length - 1] ?? key
}
const hasServiceNoteAttachmentQueryError = (error: unknown) =>
  error instanceof Error &&
  (error.message.includes("ContactServiceNoteAttachment") ||
    error.message.includes("Unknown field `attachments`"))
const serializeRelatedServiceNote = (
  note: {
    id: string
    title: string
    body: string
    createdAt: Date
    createdBy?: {
      id: string
      name: string | null
      email?: string | null
      image?: string | null
    } | null
    followUpTemplate?: {
      id: string
      name: string
    } | null
    contactServiceFollowUpStep?: {
      id: string
      title: string
    } | null
    attachments?: Array<{
      id: string
      file: {
        id: string
        key: string
        contentType: string
        size: number | null
      }
    }>
  },
  kind: "SERVICE_NOTE" | "FOLLOW_UP_NOTE" | "LINKED_CONTACT_NOTE",
) => ({
  id: note.id,
  title: note.title,
  body: note.body,
  createdAt: note.createdAt,
  kind,
  followUpTemplateName: note.followUpTemplate?.name ?? null,
  followUpStepTitle: note.contactServiceFollowUpStep?.title ?? null,
  createdBy: note.createdBy
    ? {
        id: note.createdBy.id,
        name:
          note.createdBy.name?.trim() ||
          note.createdBy.email?.trim() ||
          "Unknown user",
        image: note.createdBy.image ?? null,
      }
    : null,
  attachments: (note.attachments ?? []).map((attachment) => ({
    id: attachment.id,
    fileId: attachment.file.id,
    key: attachment.file.key,
    fileName: fileNameFromKey(attachment.file.key),
    contentType: attachment.file.contentType,
    size: attachment.file.size ?? null,
  })),
})

const TenantPathSchema = z.object({
  tenantId: z.string().trim().min(1),
})

const TenantServicePathSchema = TenantPathSchema.extend({
  serviceId: z.string().trim().min(1),
})

const TenantContactServicePathSchema = TenantPathSchema.extend({
  contactServiceId: z.string().trim().min(1),
})

const TenantContactServicePaymentPathSchema = TenantContactServicePathSchema.extend({
  paymentId: z.string().trim().min(1),
})

const TenantFollowUpStepPathSchema = TenantContactServicePathSchema.extend({
  followUpStepId: z.string().trim().min(1),
})

const TenantContactServiceChecklistItemPathSchema = TenantContactServicePathSchema.extend({
  checklistItemId: z.string().trim().min(1),
})

const ContactServiceStatusSchema = z.enum([
  "IN_PROGRESS",
  "PENDING_PAYMENT",
  "COMPLETED",
  "CANCELED",
])

const ContactServicesListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((value) => value === 10 || value === 25, {
      message: "pageSize must be 10 or 25",
    })
    .default(10),
  contactId: z.string().trim().min(1).optional(),
  status: ContactServiceStatusSchema.optional(),
})

const FitScanQuerySchema = z.object({
  contactId: z.string().trim().min(1),
  serviceId: z.string().trim().min(1).optional(),
})

const FitScanAssistantBodySchema = z.object({
  contactId: z.string().trim().min(1),
  serviceId: z.string().trim().min(1).optional(),
  scope: z.enum(["all", "service"]).default("service"),
  question: z.string().trim().min(1).max(500).optional().nullable(),
})

const ServiceFitRuleSourceSchema = z.enum(["core", "status", "tags", "custom", "derived"])
const ServiceFitValueTypeSchema = z.enum(["string", "number", "date", "boolean", "stringArray"])
const ServiceFitOperatorSchema = z.enum([
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "between",
  "includes_any",
  "includes_all",
  "excludes_all",
  "is_true",
  "is_false",
  "is_empty",
  "is_not_empty",
])

const ServiceFitPreviewSchema = z.object({
  contactId: z.string().trim().min(1),
  fitProfile: z.object({
    enabled: z.boolean().default(false),
    summary: z.string().trim().max(2000).default(""),
    rules: z
      .array(
        z.object({
          id: z.string().trim().min(1).max(120),
          source: ServiceFitRuleSourceSchema,
          fieldKey: z.string().trim().min(1).max(120),
          valueType: ServiceFitValueTypeSchema,
          operator: ServiceFitOperatorSchema,
          compareValue: z.unknown().nullable().optional(),
          required: z.boolean().default(false),
          requiredGroup: z.string().trim().max(120).nullable().optional(),
          requiredBranch: z.string().trim().max(120).nullable().optional(),
          weight: z.coerce.number().int().min(1).max(10).default(1),
          label: z.string().trim().max(160).nullable().optional(),
          explanation: z.string().trim().max(300).nullable().optional(),
        }),
      )
      .max(100)
      .default([]),
    requirementMetadata: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(120),
          description: z.string().trim().max(500).default(""),
        }),
      )
      .max(30)
      .default([]),
    optionMetadata: z
      .array(
        z.object({
          requirementName: z.string().trim().min(1).max(120),
          optionName: z.string().trim().min(1).max(120),
          description: z.string().trim().max(500).default(""),
        }),
      )
      .max(100)
      .default([]),
    verificationProfile: z
      .object({
        mode: z
          .enum(["NONE", "WEB_SOURCES", "INTERNAL_KB", "EXTERNAL_API", "MANUAL_CONFIRMATION"])
          .default("NONE"),
        guidance: z.string().trim().max(2000).default(""),
        sourceUrls: z.array(z.string().trim().url().max(500)).max(8).default([]),
        triggerKeywords: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
      })
      .default({
        mode: "NONE",
        guidance: "",
        sourceUrls: [],
        triggerKeywords: [],
      }),
    knowledgeProfile: z
      .object({
        overview: z.string().trim().max(4000).default(""),
        pricingNotes: z.string().trim().max(4000).default(""),
        workflowNotes: z.string().trim().max(4000).default(""),
        faqNotes: z.string().trim().max(4000).default(""),
        adapter: z.enum(["NONE", "IMMIGRATION_USCIS"]).default("NONE"),
      })
      .default({
        overview: "",
        pricingNotes: "",
        workflowNotes: "",
        faqNotes: "",
        adapter: "NONE",
      }),
  }),
})

const ServicesCatalogSummaryPresetSchema = z.enum([
  "THIS_MONTH",
  "LAST_MONTH",
  "LAST_3_MONTHS",
  "CUSTOM",
])

const OptionalDateOnlySchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value
    const trimmed = value.trim()
    return trimmed.length ? trimmed : undefined
  },
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
)

const ServicesCatalogSummaryQuerySchema = z
  .object({
    preset: ServicesCatalogSummaryPresetSchema.default("THIS_MONTH"),
    from: OptionalDateOnlySchema,
    to: OptionalDateOnlySchema,
  })
  .superRefine((value, ctx) => {
    if (value.preset !== "CUSTOM") return

    if (!value.from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["from"],
        message: "from is required when preset is CUSTOM",
      })
    }

    if (!value.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "to is required when preset is CUSTOM",
      })
    }
  })

const FollowUpsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((value) => value === 10 || value === 25, {
      message: "pageSize must be 10 or 25",
    })
    .default(10),
  search: z.string().trim().max(200).optional(),
  status: z
    .enum(["PENDING", "ACTIVE", "COMPLETED", "SKIPPED", "POSTPONED"])
    .optional(),
  dueDatePreset: z
    .enum(["OVERDUE", "TODAY", "NEXT_7_DAYS", "NO_DUE_DATE"])
    .optional(),
  followUpTemplateId: z.string().trim().min(1).optional(),
  assignedToUserId: z.string().trim().min(1).optional(),
})

const CreateContactServiceSchema = z.object({
  contactId: z.string().trim().min(1),
  serviceId: z.string().trim().min(1),
  followUpTemplateId: z.string().trim().min(1).optional(),
  followUpAssignedToUserId: z.string().trim().min(1).optional(),
  assignedProfessionalId: z.string().trim().min(1).optional(),
  purchasedAt: z.string().datetime().nullable().optional(),
  startedAt: z.string().datetime().nullable().optional(),
  totalPriceCents: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  initialPaymentCents: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
})

const CreateContactServicePaymentSchema = z.object({
  amountCents: z.coerce.number().int().min(1).max(1_000_000_000),
  paidAt: z.string().datetime().optional(),
  paymentMethod: z
    .enum(["CASH", "CARD", "CHECK", "TRANSFER", "ACH"])
    .nullable()
    .optional(),
  note: z.string().trim().max(1000).nullable().optional(),
})

const UpdateContactServicePaymentSchema = z.object({
  amountCents: z.coerce.number().int().min(1).max(1_000_000_000).optional(),
  paidAt: z.string().datetime().optional(),
  paymentMethod: z
    .enum(["CASH", "CARD", "CHECK", "TRANSFER", "ACH"])
    .nullable()
    .optional(),
  note: z.string().trim().max(1000).nullable().optional(),
})

const UpdateContactServiceSchema = z.object({
  status: ContactServiceStatusSchema.optional(),
  startedAt: z.string().datetime().nullable().optional(),
  purchasedAt: z.string().datetime().nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
  canceledAt: z.string().datetime().nullable().optional(),
  totalPriceCents: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
})

const ContactServiceNoteAttachmentIdsSchema = z
  .array(z.string().trim().min(1))
  .max(10)
  .default([])

const CreateContactServiceNoteSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(8000),
  attachmentFileIds: ContactServiceNoteAttachmentIdsSchema,
})

async function getValidatedServiceNoteFiles(
  tenantId: string,
  attachmentFileIds: string[],
) {
  if (attachmentFileIds.length === 0) {
    return []
  }

  const uniqueFileIds = [...new Set(attachmentFileIds)]
  const files = await prisma.file.findMany({
    where: {
      tenantId,
      id: { in: uniqueFileIds },
      purpose: "GENERIC",
    },
    select: {
      id: true,
      key: true,
      contentType: true,
      size: true,
    },
  })

  if (files.length !== uniqueFileIds.length) {
    return null
  }

  return uniqueFileIds
    .map((fileId) => files.find((file) => file.id === fileId))
    .filter((file): file is NonNullable<typeof file> => Boolean(file))
}

const UpdateFollowUpStepSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  notesTemplate: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(["PENDING", "ACTIVE", "COMPLETED", "SKIPPED", "POSTPONED"]).optional(),
  action: z.enum(["REOPEN"]).optional(),
  availableAt: z.string().datetime().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  postponeTo: z.string().datetime().optional(),
  nextFollowUpAt: z.string().datetime({ offset: true }).optional(),
  cascadeFutureSteps: z.boolean().optional(),
  completedAt: z.string().datetime().nullable().optional(),
  assignedToUserId: z.string().trim().min(1).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
})

const RescheduleNextFollowUpSchema = z.object({
  nextFollowUpAt: z.string().datetime({ offset: true }),
})

const CreateFollowUpStepSchema = z.object({
  title: z.string().trim().min(1).max(200),
  notesTemplate: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(["PENDING", "ACTIVE", "COMPLETED", "SKIPPED", "POSTPONED"]).optional(),
  availableAt: z.string().datetime().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  assignedToUserId: z.string().trim().min(1).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
})

const UpdateContactServiceChecklistItemSchema = z.object({
  completed: z.boolean().optional(),
})

async function requireActiveMembership(
  req: AuthedRequest,
  res: Response,
  tenantId: string,
) {
  const membership = await prisma.membership.findUnique({
    where: {
      userId_tenantId: {
        userId: req.user.id,
        tenantId,
      },
    },
    select: {
      role: true,
      status: true,
      securityLevel: true,
    },
  })

  if (!membership || membership.status !== "ACTIVE") {
    res.status(403).json({ error: "TENANT_ACCESS_DENIED" })
    return null
  }

  return membership
}

function canManageContactServices(membership: {
  role: string
  securityLevel: "LOW" | "MEDIUM" | "MAX"
}) {
  return membership.role === "TENANT_ADMIN" || membership.securityLevel !== "LOW"
}

const DEFAULT_TIMEZONE = "America/Chicago"

function getSafeTimezone(timezone?: string | null) {
  return timezone?.trim() || DEFAULT_TIMEZONE
}

function serializeVersionedFollowUpMetadata(item: any, timezone: string) {
  const definition = item.followUpTemplateVersion?.definition
  const waitingAction = item.followUpRun?.waitingNodeId
    ? getWorkflowWaitByActionId(definition, item.followUpRun.waitingNodeId)
    : null
  const userScheduledWaitingAction = item.followUpRun?.waitingNodeId
    ? getUserScheduledWaitByActionId(definition, item.followUpRun.waitingNodeId)
    : null
  const effectiveNextFollowUp = resolveEffectiveNextFollowUp({
    steps: item.followUpSteps ?? [],
    run: item.followUpRun,
    isUserScheduledWait: Boolean(userScheduledWaitingAction),
    isWorkflowWait: Boolean(waitingAction),
  })
  const nextFollowUp = serializeEffectiveNextFollowUp(effectiveNextFollowUp)
  const firstUnresolvedStep = (item.followUpSteps ?? []).find(
    (step: any) => !["COMPLETED", "SKIPPED"].includes(step.status),
  )
  const canContinueWaitingRun = Boolean(
    item.followUpRun?.status === "WAITING" &&
      waitingAction &&
      !item.followUpRun.leaseToken,
  )
  const followUpSteps = (item.followUpSteps ?? []).map((step: any) => {
    const canCompleteNow = canCompleteFollowUpStepNow({
      step,
      firstUnresolvedStepId: firstUnresolvedStep?.id ?? null,
      run: item.followUpRun,
      effectiveNextFollowUp,
      canContinueWaitingRun,
    })
    const requirement =
      canCompleteNow && step.templateNodeId
        ? getUserScheduledWaitForStep(definition, step.templateNodeId)
        : null
    const projectedForStep =
      effectiveNextFollowUp?.stepId === step.id ? effectiveNextFollowUp : null
    return {
      ...step,
      effectiveDueAt: projectedForStep
        ? projectedForStep.at
        : step.dueAt ?? null,
      effectiveDueSource: projectedForStep
        ? projectedForStep.source
        : step.dueAt
          ? "STEP_DUE"
          : null,
      canCompleteNow,
      completionRequirement: requirement
        ? {
            type: "NEXT_FOLLOW_UP_AT" as const,
            actionId: requirement.actionId,
            prompt: requirement.prompt,
            timezone,
          }
        : null,
    }
  })
  return {
    timezone,
    nextFollowUp,
    followUpSteps,
    followUpTemplateVersion: item.followUpTemplateVersion
      ? {
          id: item.followUpTemplateVersion.id,
          versionNumber: item.followUpTemplateVersion.versionNumber,
        }
      : null,
    followUpRun: item.followUpRun
      ? {
          ...item.followUpRun,
          canContinueNow: canContinueWaitingRun,
          manualWait:
            userScheduledWaitingAction && item.followUpRun.status === "WAITING"
              ? {
                  actionId: userScheduledWaitingAction.actionId,
                  prompt: userScheduledWaitingAction.prompt,
                  scheduledFor: item.followUpRun.resumeAt,
                  canReschedule: !item.followUpRun.leaseToken,
                  canContinueNow: !item.followUpRun.leaseToken,
                }
              : null,
        }
      : null,
  }
}

function serializeContactServiceListFollowUpMetadata(item: any) {
  const definition = item.followUpTemplateVersion?.definition
  const waitingAction = item.followUpRun?.waitingNodeId
    ? getWorkflowWaitByActionId(definition, item.followUpRun.waitingNodeId)
    : null
  const userScheduledWaitingAction = item.followUpRun?.waitingNodeId
    ? getUserScheduledWaitByActionId(definition, item.followUpRun.waitingNodeId)
    : null
  const effectiveNextFollowUp = resolveEffectiveNextFollowUp({
    steps: item.followUpSteps ?? [],
    run: item.followUpRun,
    isUserScheduledWait: Boolean(userScheduledWaitingAction),
    isWorkflowWait: Boolean(waitingAction),
  })
  const nextFollowUp = serializeEffectiveNextFollowUp(effectiveNextFollowUp)
  const firstUnresolvedStep = (item.followUpSteps ?? []).find(
    (step: any) => !["COMPLETED", "SKIPPED"].includes(step.status),
  )
  const canContinueWaitingRun = Boolean(
    item.followUpRun?.status === "WAITING" &&
      waitingAction &&
      !item.followUpRun.leaseToken,
  )

  return {
    nextFollowUp,
    followUpRun: item.followUpRun
      ? {
          status: item.followUpRun.status,
          resumeAt: item.followUpRun.resumeAt,
          canContinueNow: canContinueWaitingRun,
        }
      : null,
    followUpSteps: (item.followUpSteps ?? []).map((step: any) => {
      const effectiveForStep =
        effectiveNextFollowUp?.stepId === step.id ? effectiveNextFollowUp : null
      const canCompleteNow = canCompleteFollowUpStepNow({
        step,
        firstUnresolvedStepId: firstUnresolvedStep?.id ?? null,
        run: item.followUpRun,
        effectiveNextFollowUp,
        canContinueWaitingRun,
      })
      const requirement =
        canCompleteNow && step.templateNodeId
          ? getUserScheduledWaitForStep(definition, step.templateNodeId)
          : null
      return {
        ...step,
        effectiveDueAt: effectiveForStep
          ? effectiveForStep.at
          : step.dueAt ?? null,
        effectiveDueSource: effectiveForStep
          ? effectiveForStep.source
          : step.dueAt
            ? "STEP_DUE"
            : null,
        canCompleteNow,
        completionRequirement: requirement
          ? {
              type: "NEXT_FOLLOW_UP_AT" as const,
              actionId: requirement.actionId,
              prompt: requirement.prompt,
            }
          : null,
      }
    }),
  }
}

function decodeCustomFieldValue(storedValue: {
  value: unknown
  valueCiphertext: string | null
  valueIv: string | null
  valueAuthTag: string | null
  valueKeyVersion: number | null
}) {
  if (storedValue.value !== null && storedValue.value !== undefined) {
    return storedValue.value
  }

  return decryptCustomFieldValue({
    valueCiphertext: storedValue.valueCiphertext,
    valueIv: storedValue.valueIv,
    valueAuthTag: storedValue.valueAuthTag,
    valueKeyVersion: storedValue.valueKeyVersion,
  })
}

function parseOffsetMinutes(label: string) {
  if (label === "GMT" || label === "UTC") return 0

  const normalized = label.replace("UTC", "GMT")
  const match = normalized.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/)
  if (!match) return 0

  const [, sign, hours, minutes] = match
  const total = Number(hours) * 60 + Number(minutes ?? "0")
  return sign === "-" ? -total : total
}

function getOffsetMinutes(timezone: string, date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: getSafeTimezone(timezone),
    timeZoneName: "shortOffset",
    hour: "2-digit",
  }).formatToParts(date)

  const label = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT"
  return parseOffsetMinutes(label)
}

function getTimezoneDayParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: getSafeTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)

  const getPart = (type: string, fallback = "") =>
    parts.find((part) => part.type === type)?.value ?? fallback

  return {
    year: Number(getPart("year", "0")),
    month: Number(getPart("month", "1")),
    day: Number(getPart("day", "1")),
  }
}

function zonedDateTimeToUtc(
  timezone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, 0)
  let utcMs = utcGuess

  for (let index = 0; index < 3; index += 1) {
    const offsetMinutes = getOffsetMinutes(timezone, new Date(utcMs))
    const adjusted = utcGuess - offsetMinutes * 60_000
    if (adjusted === utcMs) break
    utcMs = adjusted
  }

  return new Date(utcMs)
}

function getTodayRange(timezone: string) {
  const today = getTimezoneDayParts(new Date(), timezone)
  const start = zonedDateTimeToUtc(timezone, today.year, today.month, today.day, 0, 0, 0)
  const end = zonedDateTimeToUtc(timezone, today.year, today.month, today.day + 1, 0, 0, 0)
  return { start, end }
}

function parseDateOnlyParts(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  return { year, month, day }
}

function formatDateOnlyParts(value: { year: number; month: number; day: number }) {
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`
}

function getMonthRange(timezone: string, monthOffset: number) {
  const today = getTimezoneDayParts(new Date(), timezone)
  const monthStart = zonedDateTimeToUtc(
    timezone,
    today.year,
    today.month + monthOffset,
    1,
    0,
    0,
    0,
  )
  const monthStartParts = getTimezoneDayParts(monthStart, timezone)
  const nextMonthStart = zonedDateTimeToUtc(
    timezone,
    monthStartParts.year,
    monthStartParts.month + 1,
    1,
    0,
    0,
    0,
  )

  return {
    start: monthStart,
    end: nextMonthStart,
    from: formatDateOnlyParts(monthStartParts),
    to: formatDateOnlyParts(getTimezoneDayParts(new Date(nextMonthStart.getTime() - 1), timezone)),
  }
}

function getServicesCatalogSummaryRange(
  query: z.infer<typeof ServicesCatalogSummaryQuerySchema>,
  timezone: string,
) {
  if (query.preset === "THIS_MONTH") {
    return getMonthRange(timezone, 0)
  }

  if (query.preset === "LAST_MONTH") {
    return getMonthRange(timezone, -1)
  }

  if (query.preset === "LAST_3_MONTHS") {
    const today = getTimezoneDayParts(new Date(), timezone)
    const start = zonedDateTimeToUtc(timezone, today.year, today.month - 2, 1, 0, 0, 0)
    const startParts = getTimezoneDayParts(start, timezone)
    const end = zonedDateTimeToUtc(timezone, today.year, today.month + 1, 1, 0, 0, 0)

    return {
      start,
      end,
      from: formatDateOnlyParts(startParts),
      to: formatDateOnlyParts(getTimezoneDayParts(new Date(end.getTime() - 1), timezone)),
    }
  }

  const fromParts = parseDateOnlyParts(query.from!)
  const toParts = parseDateOnlyParts(query.to!)
  const start = zonedDateTimeToUtc(
    timezone,
    fromParts.year,
    fromParts.month,
    fromParts.day,
    0,
    0,
    0,
  )
  const end = zonedDateTimeToUtc(
    timezone,
    toParts.year,
    toParts.month,
    toParts.day + 1,
    0,
    0,
    0,
  )
  const maxRangeDays = 366
  const totalDays = Math.ceil((end.getTime() - start.getTime()) / 86_400_000)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        path: ["from"],
        message: "Invalid custom date range.",
      },
    ])
  }

  if (end <= start) {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "to must be the same day or after from",
      },
    ])
  }

  if (totalDays > maxRangeDays) {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "Custom date range cannot exceed 366 days.",
      },
    ])
  }

  return {
    start,
    end,
    from: query.from!,
    to: query.to!,
  }
}

async function summarizeContactServicePayments(
  prismaTx: any,
  tenantId: string,
  contactServiceId: string,
) {
  const [contactService, payments] = await Promise.all([
    prismaTx.contactService.findFirst({
      where: {
        id: contactServiceId,
        tenantId,
      },
      select: {
        id: true,
        totalPriceCents: true,
      },
    }),
    prismaTx.contactServicePayment.findMany({
      where: {
        tenantId,
        contactServiceId,
      },
      select: {
        amountCents: true,
      },
    }),
  ])

  if (!contactService) {
    return null
  }

  const paidCents = payments.reduce(
    (sum: number, payment: { amountCents: number }) => sum + payment.amountCents,
    0,
  )

  return {
    totalPriceCents: contactService.totalPriceCents,
    paidCents,
    remainingCents: Math.max(0, contactService.totalPriceCents - paidCents),
  }
}

function getServiceTotalWithTaxCents({
  basePriceCents,
  isTaxExempt,
  taxEnabled,
  defaultTaxRateBps,
}: {
  basePriceCents: number
  isTaxExempt: boolean
  taxEnabled: boolean
  defaultTaxRateBps: number | null
}) {
  if (!taxEnabled || isTaxExempt || defaultTaxRateBps === null) {
    return basePriceCents
  }

  return basePriceCents + Math.round((basePriceCents * defaultTaxRateBps) / 10_000)
}

async function loadServiceFitCatalog(tenantId: string) {
  const [statuses, tags, customFields] = await Promise.all([
    prisma.contactStatusConfig.findMany({
      where: {
        tenantId,
        isActive: true,
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
      },
    }),
    prisma.tenantTag.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
      },
    }),
    prisma.contactCustomField.findMany({
      where: {
        tenantId,
        isActive: true,
        isSensitive: false,
      },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: {
        id: true,
        key: true,
        label: true,
        description: true,
        fieldType: true,
        options: true,
      },
    }),
  ])

  return buildServiceFitFieldCatalog({
    statuses,
    tags,
    customFields: customFields.map((field: any) => ({
      id: field.id,
      key: field.key,
      label: field.label,
      description: field.description ?? null,
      fieldType: field.fieldType,
      options: Array.isArray(field.options) ? field.options : [],
    })),
  })
}

async function loadServiceFitContactSnapshot(tenantId: string, contactId: string) {
  const [contact, tags, customFields, customFieldValues] = await Promise.all([
    prisma.contact.findFirst({
      where: {
        tenantId,
        id: contactId,
      },
      select: {
        id: true,
        firstName: true,
        middleName: true,
        lastName: true,
        email: true,
        phone: true,
        secondaryPhone: true,
        dateOfBirth: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        country: true,
        statusConfigId: true,
      },
    }),
    prisma.contactTag.findMany({
      where: {
        tenantId,
        contactId,
      },
      select: {
        tagId: true,
      },
    }),
    prisma.contactCustomField.findMany({
      where: {
        tenantId,
        isActive: true,
        isSensitive: false,
      },
      select: {
        id: true,
        key: true,
      },
    }),
    prisma.contactCustomFieldValue.findMany({
      where: {
        tenantId,
        contactId,
      },
      select: {
        fieldId: true,
        value: true,
        valueCiphertext: true,
        valueIv: true,
        valueAuthTag: true,
        valueKeyVersion: true,
      },
    }),
  ])

  if (!contact) {
    return null
  }

  const fieldKeyById = new Map(
    customFields.map((field: any) => [field.id, field.key] as const),
  )

  const customFieldValuesByKey: Record<string, unknown> = {}
  for (const item of customFieldValues as Array<any>) {
    const key = fieldKeyById.get(item.fieldId)
    if (!key) continue
    customFieldValuesByKey[key] = decodeCustomFieldValue(item)
  }

  return {
    id: contact.id,
    firstName: contact.firstName ?? null,
    middleName: contact.middleName ?? null,
    lastName: contact.lastName ?? null,
    email: contact.email ?? null,
    phoneNumber: contact.phone ?? null,
    secondaryPhoneNumber: contact.secondaryPhone ?? null,
    dateOfBirth: contact.dateOfBirth ?? null,
    addressLine1: contact.addressLine1 ?? null,
    addressLine2: contact.addressLine2 ?? null,
    city: contact.city ?? null,
    state: contact.state ?? null,
    postalCode: contact.postalCode ?? null,
    country: contact.country ?? null,
    statusConfigId: contact.statusConfigId ?? null,
    tagIds: tags.map((item: any) => item.tagId),
    customFieldValues: customFieldValuesByKey,
  }
}

async function evaluateServiceFitScan(params: {
  tenantId: string
  contactId: string
  serviceId?: string
  fitProfileOverrideByServiceId?: Record<string, unknown>
}) {
  const { tenantId, contactId, serviceId, fitProfileOverrideByServiceId } = params

  const [tenant, catalog, contact, services] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    }),
    loadServiceFitCatalog(tenantId),
    loadServiceFitContactSnapshot(tenantId, contactId),
    prismaWithServices.service.findMany({
      where: {
        tenantId,
        isActive: true,
        ...(serviceId ? { id: serviceId } : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        description: true,
        fitProfile: true,
      },
    }),
  ])

  if (!contact) {
    return { error: "CONTACT_NOT_FOUND" as const }
  }

  const serviceIds = services.map((service: any) => service.id)
  const existingContactServices = serviceIds.length
    ? await prismaWithServices.contactService.findMany({
        where: {
          tenantId,
          contactId,
          serviceId: { in: serviceIds },
        },
        orderBy: [{ purchasedAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          serviceId: true,
          status: true,
          purchasedAt: true,
          createdAt: true,
        },
      })
    : []

  const contactServicesByServiceId = new Map<string, Array<any>>()
  for (const record of existingContactServices) {
    const records = contactServicesByServiceId.get(record.serviceId) ?? []
    records.push(record)
    contactServicesByServiceId.set(record.serviceId, records)
  }

  const timezone = getSafeTimezone(tenant?.timezone)

  type ContactServiceEnrollmentStatus =
    | "IN_PROGRESS"
    | "PENDING_PAYMENT"
    | "COMPLETED"
    | "CANCELED"

  function summarizeContactServiceEnrollment(records: Array<{
    id: string
    status: ContactServiceEnrollmentStatus
  }>) {
    const active = records.find(
      (record) => record.status === "IN_PROGRESS" || record.status === "PENDING_PAYMENT",
    )
    if (active) {
      return {
        hasPurchased: true,
        hasActiveEnrollment: true,
        currentContactServiceId: active.id,
        currentContactServiceStatus: active.status,
      } as const
    }

    const purchased = records.find((record) => record.status !== "CANCELED")
    if (purchased) {
      return {
        hasPurchased: true,
        hasActiveEnrollment: false,
        currentContactServiceId: purchased.id,
        currentContactServiceStatus: purchased.status,
      } as const
    }

    const canceled = records[0]
    return {
      hasPurchased: false,
      hasActiveEnrollment: false,
      currentContactServiceId: canceled?.id ?? null,
      currentContactServiceStatus: canceled?.status ?? null,
    } as const
  }

  type FitScanItem = {
    serviceId: string
    serviceName: string
    description: string | null
    fitProfile: ReturnType<typeof normalizeServiceFitProfile>
    eligibilityStatus: "ELIGIBLE" | "NEEDS_INFO" | "NOT_ELIGIBLE"
    fitScore: number
    matchedRules: Array<{ ruleId: string; label: string; reason: string }>
    blockingRules: Array<{ ruleId: string; label: string; reason: string }>
    missingRules: Array<{ ruleId: string; label: string; reason: string }>
    summary: string
    hasPurchased: boolean
    hasActiveEnrollment: boolean
    currentContactServiceId: string | null
    currentContactServiceStatus: ContactServiceEnrollmentStatus | null
  }

  const items: FitScanItem[] = services
    .map((service: any) => {
      const rawProfile =
        fitProfileOverrideByServiceId?.[service.id] ?? service.fitProfile
      const profile = normalizeServiceFitProfile(rawProfile)
      if (!profile.enabled || profile.rules.length === 0) {
        return null
      }

      const evaluation = evaluateServiceFitProfile({
        profile,
        catalog,
        contact,
        timezone,
      })
      const enrollmentSummary = summarizeContactServiceEnrollment(
        contactServicesByServiceId.get(service.id) ?? [],
      )

      return {
        serviceId: service.id,
        serviceName: service.name,
        description: service.description ?? null,
        fitProfile: profile,
        ...enrollmentSummary,
        ...evaluation,
      }
    })
    .filter(
      (
        item: unknown,
      ): item is FitScanItem => Boolean(item),
    )

  const sortedItems = sortServiceFitEvaluations(items)
  const itemsWithExplanations = await Promise.all(
    sortedItems.map(async (item) => {
      const explanationResult = await generateServiceFitExplanation({
        serviceName: item.serviceName,
        serviceDescription: item.description ?? null,
        fitSummary: item.fitProfile.summary || item.summary || null,
        eligibilityStatus: item.eligibilityStatus,
        fitScore: item.fitScore,
        matchedRules: item.matchedRules,
        blockingRules: item.blockingRules,
        missingRules: item.missingRules,
      })

      return {
        ...item,
        explanation: explanationResult.explanation,
        explanationSource: explanationResult.explanationSource,
        configurationGapNotes: explanationResult.configurationGapNotes,
        recommendedUpdates: explanationResult.recommendedUpdates,
      }
    }),
  )

  return {
    items: itemsWithExplanations,
  }
}

async function reconcileContactServiceCompletionFromFollowUps(
  prismaTx: any,
  tenantId: string,
  contactServiceId: string,
  actorUserId?: string | null,
) {
  const contactService = await prismaTx.contactService.findFirst({
    where: {
      id: contactServiceId,
      tenantId,
    },
    select: {
      id: true,
      status: true,
      completedAt: true,
      totalPriceCents: true,
      contactId: true,
      followUpTemplateId: true,
      service: {
        select: {
          name: true,
        },
      },
    },
  })

  if (!contactService || contactService.status === "CANCELED") {
    return contactService
  }

  const followUpSteps = await prismaTx.contactServiceFollowUpStep.findMany({
    where: {
      tenantId,
      contactServiceId,
    },
    select: {
      status: true,
      completedAt: true,
    },
  })

  const paymentSummary = await summarizeContactServicePayments(
    prismaTx,
    tenantId,
    contactServiceId,
  )

  if (!paymentSummary) {
    return contactService
  }

  const allStepsCompleted = followUpSteps.every(
    (step: { status: string | null; completedAt: Date | null }) =>
      step.status === "COMPLETED" ||
      step.status === "SKIPPED" ||
      Boolean(step.completedAt),
  )
  const isPaidInFull = paymentSummary.remainingCents <= 0
  const nextStatus = allStepsCompleted
    ? isPaidInFull
      ? "COMPLETED"
      : "PENDING_PAYMENT"
    : "IN_PROGRESS"

  if (
    contactService.status !== nextStatus ||
    (nextStatus === "COMPLETED" && !contactService.completedAt) ||
    (nextStatus !== "COMPLETED" && contactService.completedAt)
  ) {
    const updated = await prismaTx.contactService.update({
      where: { id: contactServiceId },
      data: {
        status: nextStatus,
        completedAt: nextStatus === "COMPLETED" ? contactService.completedAt ?? new Date() : null,
      },
      select: {
        id: true,
        status: true,
        completedAt: true,
      },
    })

    if (contactService.followUpTemplateId) {
      await prismaTx.serviceFollowUpExecutionLog.create({
        data: {
          tenantId,
          templateId: contactService.followUpTemplateId,
          contactServiceId,
          contactId: contactService.contactId,
          actorUserId: actorUserId ?? null,
          eventType: "SERVICE_STATUS_UPDATED",
          title: `Service status updated: ${contactService.service.name}`,
          details: `Service moved from ${contactService.status.toLowerCase().replace(/_/g, " ")} to ${nextStatus.toLowerCase().replace(/_/g, " ")}.`,
          payload: {
            previousStatus: contactService.status,
            status: nextStatus,
          },
        },
      })
    }

    return updated
  }

  return contactService
}

router.get("/:tenantId/catalog/:serviceId", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId, serviceId } = TenantServicePathSchema.parse(req.params)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const service = await prismaWithServices.service.findFirst({
      where: {
        id: serviceId,
        tenantId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        description: true,
        basePriceCents: true,
        currency: true,
        isTaxExempt: true,
        allowPartialPayments: true,
        minimumPartialPaymentCents: true,
        installmentCount: true,
        installmentFrequency: true,
        isActive: true,
        tenant: {
          select: {
            taxEnabled: true,
            taxLabel: true,
            defaultTaxRateBps: true,
          },
        },
        checklistItems: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            label: true,
            description: true,
            isRequired: true,
            sortOrder: true,
          },
        },
        followUpTemplates: {
          where: { isPublished: true },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            name: true,
            isPublished: true,
            sortOrder: true,
            flowNodes: true,
            flowEdges: true,
          },
        },
        professionals: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            kind: true,
            userId: true,
            externalProfessionalName: true,
            externalContact: true,
            sortOrder: true,
            user: {
              select: {
                name: true,
                email: true,
                image: true,
              },
            },
          },
        },
      },
    })

    if (!service) {
      return res.status(404).json({ error: "SERVICE_NOT_FOUND" })
    }

    return res.json({
      ok: true,
      service: {
        id: service.id,
        name: service.name,
        description: service.description,
        basePriceCents: service.basePriceCents,
        currency: service.currency,
        isTaxExempt: service.isTaxExempt,
        allowPartialPayments: service.allowPartialPayments,
        minimumPartialPaymentCents: service.minimumPartialPaymentCents,
        installmentCount: service.installmentCount,
        installmentFrequency: service.installmentFrequency,
        isActive: service.isActive,
        checklistItems: service.checklistItems,
        followUpTemplates: service.followUpTemplates.map((template: any) => ({
          id: template.id,
          name: template.name,
          isPublished: template.isPublished,
          sortOrder: template.sortOrder,
          flowNodeCount: Array.isArray(template.flowNodes) ? template.flowNodes.length : 0,
          flowEdgeCount: Array.isArray(template.flowEdges) ? template.flowEdges.length : 0,
        })),
        professionals: service.professionals.map((professional: any) => ({
          id: professional.id,
          kind: professional.kind,
          userId: professional.userId,
          externalProfessionalName: professional.externalProfessionalName,
          externalContact: professional.externalContact,
          sortOrder: professional.sortOrder,
          user: professional.user,
        })),
        tenantBilling: {
          taxEnabled: service.tenant.taxEnabled,
          taxLabel: service.tenant.taxLabel,
          defaultTaxRatePercent:
            service.tenant.defaultTaxRateBps !== null &&
            service.tenant.defaultTaxRateBps !== undefined
              ? service.tenant.defaultTaxRateBps / 100
              : null,
        },
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId/catalog-summary", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const query = ServicesCatalogSummaryQuerySchema.parse(req.query)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    })
    const timezone = getSafeTimezone(tenant?.timezone)
    const range = getServicesCatalogSummaryRange(query, timezone)
    const salesDateWhere = {
      OR: [
        {
          purchasedAt: {
            gte: range.start,
            lt: range.end,
          },
        },
        {
          purchasedAt: null,
          createdAt: {
            gte: range.start,
            lt: range.end,
          },
        },
      ],
    }

    const [grossSalesAggregate, servicesSold, activeFollowUpServices, openTotals, openPayments] =
      await Promise.all([
        prismaWithServices.contactService.aggregate({
          where: {
            tenantId,
            status: {
              not: "CANCELED",
            },
            ...salesDateWhere,
          },
          _sum: {
            totalPriceCents: true,
          },
        }),
        prismaWithServices.contactService.count({
          where: {
            tenantId,
            status: {
              not: "CANCELED",
            },
            ...salesDateWhere,
          },
        }),
        prismaWithServices.contactService.count({
          where: {
            tenantId,
            status: {
              not: "CANCELED",
            },
            followUpSteps: {
              some: {
                status: {
                  in: ["PENDING", "ACTIVE", "POSTPONED"] as const,
                },
              },
            },
          },
        }),
        prismaWithServices.contactService.aggregate({
          where: {
            tenantId,
            status: {
              not: "CANCELED",
            },
          },
          _sum: {
            totalPriceCents: true,
          },
        }),
        prismaWithServices.contactServicePayment.aggregate({
          where: {
            tenantId,
            contactService: {
              tenantId,
              status: {
                not: "CANCELED",
              },
            },
          },
          _sum: {
            amountCents: true,
          },
        }),
      ])

    const totalOpenPriceCents = openTotals._sum.totalPriceCents ?? 0
    const totalOpenPaidCents = openPayments._sum.amountCents ?? 0

    return res.json({
      ok: true,
      summary: {
        grossSalesCents: grossSalesAggregate._sum.totalPriceCents ?? 0,
        servicesSold,
        activeFollowUpServices,
        remainingBalanceCents: Math.max(0, totalOpenPriceCents - totalOpenPaidCents),
        range: {
          preset: query.preset,
          from: range.from,
          to: range.to,
        },
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId/catalog/:serviceId/summary", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId, serviceId } = TenantServicePathSchema.parse(req.params)
    const query = ServicesCatalogSummaryQuerySchema.parse(req.query)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    })
    const timezone = getSafeTimezone(tenant?.timezone)
    const range = getServicesCatalogSummaryRange(query, timezone)

    const service = await prismaWithServices.service.findFirst({
      where: {
        id: serviceId,
        tenantId,
        isActive: true,
      },
      select: { id: true },
    })

    if (!service) {
      return res.status(404).json({ error: "SERVICE_NOT_FOUND" })
    }

    const salesDateWhere = {
      OR: [
        {
          purchasedAt: {
            gte: range.start,
            lt: range.end,
          },
        },
        {
          purchasedAt: null,
          createdAt: {
            gte: range.start,
            lt: range.end,
          },
        },
      ],
    }

    const [grossSalesAggregate, servicesSold, activeFollowUpServices, openTotals, openPayments] =
      await Promise.all([
        prismaWithServices.contactService.aggregate({
          where: {
            tenantId,
            serviceId,
            status: {
              not: "CANCELED",
            },
            ...salesDateWhere,
          },
          _sum: {
            totalPriceCents: true,
          },
        }),
        prismaWithServices.contactService.count({
          where: {
            tenantId,
            serviceId,
            status: {
              not: "CANCELED",
            },
            ...salesDateWhere,
          },
        }),
        prismaWithServices.contactService.count({
          where: {
            tenantId,
            serviceId,
            status: {
              not: "CANCELED",
            },
            followUpSteps: {
              some: {
                status: {
                  in: ["PENDING", "ACTIVE", "POSTPONED"] as const,
                },
              },
            },
          },
        }),
        prismaWithServices.contactService.aggregate({
          where: {
            tenantId,
            serviceId,
            status: {
              not: "CANCELED",
            },
          },
          _sum: {
            totalPriceCents: true,
          },
        }),
        prismaWithServices.contactServicePayment.aggregate({
          where: {
            tenantId,
            contactService: {
              tenantId,
              serviceId,
              status: {
                not: "CANCELED",
              },
            },
          },
          _sum: {
            amountCents: true,
          },
        }),
      ])

    const totalOpenPriceCents = openTotals._sum.totalPriceCents ?? 0
    const totalOpenPaidCents = openPayments._sum.amountCents ?? 0

    return res.json({
      ok: true,
      summary: {
        grossSalesCents: grossSalesAggregate._sum.totalPriceCents ?? 0,
        servicesSold,
        activeFollowUpServices,
        remainingBalanceCents: Math.max(0, totalOpenPriceCents - totalOpenPaidCents),
        range: {
          preset: query.preset,
          from: range.from,
          to: range.to,
        },
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId/follow-ups", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const {
      page,
      pageSize,
      search,
      status,
      dueDatePreset,
      followUpTemplateId,
      assignedToUserId,
    } = FollowUpsListQuerySchema.parse(
      req.query,
    )

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    })

    const tenantTimezone = getSafeTimezone(tenant?.timezone)
    const now = new Date()
    const todayRange = getTodayRange(tenantTimezone)
    const nextSevenDaysEnd = new Date(todayRange.end.getTime() + 6 * 24 * 60 * 60 * 1000)
    const skip = (page - 1) * pageSize

    const preferredCurrentStepStatuses = status
      ? [status]
      : ["ACTIVE", "POSTPONED", "PENDING", "COMPLETED", "SKIPPED"]
    const searchableValue = search?.trim()
    const currentStepStatusClause = status
      ? { status }
      : { status: { in: preferredCurrentStepStatuses } }

    const currentStepWhere =
      dueDatePreset === "OVERDUE"
        ? {
            ...currentStepStatusClause,
            ...(assignedToUserId ? { assignedToUserId } : {}),
            dueAt: { lt: now },
          }
        : dueDatePreset === "TODAY"
          ? {
              ...currentStepStatusClause,
              ...(assignedToUserId ? { assignedToUserId } : {}),
              dueAt: { gte: todayRange.start, lt: todayRange.end },
            }
          : dueDatePreset === "NEXT_7_DAYS"
            ? {
                ...currentStepStatusClause,
                ...(assignedToUserId ? { assignedToUserId } : {}),
                dueAt: { gte: todayRange.start, lt: nextSevenDaysEnd },
              }
            : dueDatePreset === "NO_DUE_DATE"
              ? {
                  ...currentStepStatusClause,
                  ...(assignedToUserId ? { assignedToUserId } : {}),
                  dueAt: null,
                }
              : {
                  ...currentStepStatusClause,
                  ...(assignedToUserId ? { assignedToUserId } : {}),
                }

    const searchOrClauses = searchableValue
      ? [
          { service: { name: { contains: searchableValue, mode: "insensitive" as const } } },
          {
            contact: buildRelatedContactSearchWhere(searchableValue),
          },
          {
            followUpSteps: {
              some: {
                ...currentStepWhere,
                OR: [
                  { title: { contains: searchableValue, mode: "insensitive" as const } },
                  { note: { contains: searchableValue, mode: "insensitive" as const } },
                ],
              },
            },
          },
        ]
      : undefined

    const where = {
      tenantId,
      status: {
        in: ["IN_PROGRESS", "PENDING_PAYMENT"] as const,
      },
      followUpSteps: {
        some: {
          ...currentStepWhere,
        },
      },
      ...(searchOrClauses ? { OR: searchOrClauses } : {}),
      ...(followUpTemplateId
        ? {
            followUpTemplateId,
          }
        : {}),
    }

    const [total, services] = await prisma.$transaction([
      prismaWithServices.contactService.count({ where }),
      prismaWithServices.contactService.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }],
        skip,
        take: pageSize,
        select: {
          id: true,
          status: true,
          service: {
            select: {
              id: true,
              name: true,
            },
          },
          contact: {
            select: {
              id: true,
              firstName: true,
              middleName: true,
              lastName: true,
              phone: true,
            },
          },
          followUpTemplate: {
            select: {
              id: true,
              name: true,
            },
          },
          followUpTemplateVersion: {
            select: { id: true, versionNumber: true },
          },
          followUpRun: {
            select: {
              id: true,
              status: true,
              resumeAt: true,
              failureNodeId: true,
              failureCode: true,
              failureMessage: true,
              failedAt: true,
            },
          },
          followUpSteps: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              title: true,
              status: true,
              availableAt: true,
              dueAt: true,
              completedAt: true,
              resolutionSource: true,
              resolutionReason: true,
              assignedToUserId: true,
              note: true,
              sortOrder: true,
              assignedTo: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
      }),
    ])

    const summaryServices = await prismaWithServices.contactService.findMany({
      where: {
        tenantId,
        status: {
          in: ["IN_PROGRESS", "PENDING_PAYMENT"] as const,
        },
        followUpSteps: {
          some: {
            status: "ACTIVE",
          },
        },
      },
      select: {
        id: true,
        followUpSteps: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            status: true,
            dueAt: true,
            completedAt: true,
          },
        },
      },
    })

    const [servicesInProgress, overdueEnrollments, dueToday] = await Promise.all([
      prismaWithServices.contactService.findMany({
        where: {
          tenantId,
          status: {
            in: ["IN_PROGRESS", "PENDING_PAYMENT"] as const,
          },
          followUpSteps: {
            some: {
              status: "ACTIVE",
            },
          },
        },
        select: {
          id: true,
        },
      }),
      prismaWithServices.contactServiceFollowUpStep.count({
        where: {
          tenantId,
          dueAt: { lt: now },
          status: "ACTIVE",
          contactService: {
            tenantId,
            status: {
              in: ["IN_PROGRESS", "PENDING_PAYMENT"] as const,
            },
          },
        },
      }),
      prismaWithServices.contactServiceFollowUpStep.count({
        where: {
          tenantId,
          dueAt: { gte: todayRange.start, lt: todayRange.end },
          status: "ACTIVE",
          contactService: {
            tenantId,
            status: {
              in: ["IN_PROGRESS", "PENDING_PAYMENT"] as const,
            },
          },
        },
      }),
    ])

    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const averageProgress = summaryServices.length
      ? Math.round(
          summaryServices.reduce((sum: number, service: any) => {
            const totalSteps = service.followUpSteps.length
            if (!totalSteps) return sum

            const completedSteps = service.followUpSteps.filter(
              (step: any) => step.status === "COMPLETED" || step.status === "SKIPPED",
            ).length

            return sum + Math.round((completedSteps / totalSteps) * 100)
          }, 0) / summaryServices.length,
        )
      : 0

    return res.json({
      ok: true,
      items: services.map((service: any) => {
        const currentStep =
          preferredCurrentStepStatuses
            .map(
              (currentStatus) =>
                service.followUpSteps.find((step: any) => step.status === currentStatus) ?? null,
            )
            .find(Boolean) ?? null
        const currentStepIndex = currentStep
          ? service.followUpSteps.findIndex((step: any) => step.id === currentStep.id)
          : -1
        const totalSteps = service.followUpSteps.length
        const completedSteps = service.followUpSteps.filter(
          (step: any) => step.status === "COMPLETED" || step.status === "SKIPPED",
        ).length
        const remainingSteps = Math.max(0, totalSteps - completedSteps)

        return {
          id: service.id,
          status: service.status,
          contactId: service.contact.id,
          contactName: [service.contact.firstName, service.contact.middleName, service.contact.lastName]
            .filter(Boolean)
            .join(" "),
          phoneNumber: service.contact.phone ?? null,
          serviceId: service.service.id,
          serviceName: service.service.name,
          followUpTemplateId: service.followUpTemplate?.id ?? null,
          followUpTemplateName: service.followUpTemplate?.name ?? null,
          followUpTemplateVersion: service.followUpTemplateVersion ?? null,
          followUpRun: service.followUpRun ?? null,
          currentStep: currentStep
            ? {
                id: currentStep.id,
                title: currentStep.title,
                status: currentStep.status,
                availableAt: currentStep.availableAt,
                dueAt: currentStep.dueAt,
                completedAt: currentStep.completedAt,
                resolutionSource: currentStep.resolutionSource ?? null,
                resolutionReason: currentStep.resolutionReason ?? null,
                assignedToUserId: currentStep.assignedToUserId,
                assignedToName:
                  currentStep.assignedTo?.name?.trim() || currentStep.assignedTo?.email || null,
                note: currentStep.note,
                sortOrder: currentStep.sortOrder,
                stepNumber: currentStepIndex >= 0 ? currentStepIndex + 1 : null,
              }
            : null,
          progress: {
            completedCount: completedSteps,
            totalCount: totalSteps,
            remainingCount: remainingSteps,
            completionPercentage: totalSteps
              ? Math.round((completedSteps / totalSteps) * 100)
              : 0,
          },
          overdue:
            Boolean(currentStep?.dueAt) &&
            currentStep.status === "ACTIVE" &&
            new Date(currentStep.dueAt).getTime() < now.getTime(),
        }
      }),
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
      summary: {
        servicesInProgress: servicesInProgress.length,
        overdueEnrollments,
        dueToday,
        averageProgress,
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId/follow-up-template-options", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const templates = await prisma.serviceFollowUpTemplate.findMany({
      where: {
        tenantId,
        isPublished: true,
        contactServices: {
          some: {
            tenantId,
            status: {
              in: ["IN_PROGRESS", "PENDING_PAYMENT"] as const,
            },
          },
        },
      },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
      },
    })

    return res.json({
      ok: true,
      items: templates,
    })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId/fit-scan", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const query = FitScanQuerySchema.parse(req.query)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const result = await evaluateServiceFitScan({
      tenantId,
      contactId: query.contactId,
      serviceId: query.serviceId,
    })

    if ("error" in result) {
      return res.status(404).json({ error: result.error })
    }

    return res.json({
      ok: true,
      items: result.items,
    })
  } catch (error) {
    return next(error)
  }
})

router.post("/:tenantId/fit-scan/assistant", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const payload = FitScanAssistantBodySchema.parse(req.body)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const scope = payload.scope === "service" && payload.serviceId ? "service" : "all"
    const result = await evaluateServiceFitScan({
      tenantId,
      contactId: payload.contactId,
      serviceId: scope === "service" ? payload.serviceId : undefined,
    })

    if ("error" in result) {
      return res.status(404).json({ error: result.error })
    }

    if (scope === "service" && result.items.length === 0) {
      return res.status(404).json({ error: "SERVICE_NOT_FOUND" })
    }

    const serviceItem =
      scope === "service"
        ? result.items.find((item) => item.serviceId === payload.serviceId) ?? result.items[0] ?? null
        : null

    const answer = await routeServiceQuestion({
      items: result.items,
      scope,
      serviceId: payload.serviceId,
      question: payload.question ?? null,
    })

    return res.json({
      ok: true,
      scope: {
        mode: scope,
        serviceId: serviceItem?.serviceId ?? null,
        serviceName: serviceItem?.serviceName ?? null,
      },
      answer,
    })
  } catch (error) {
    return next(error)
  }
})

router.post("/:tenantId/fit-scan/preview", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const payload = ServiceFitPreviewSchema.parse(req.body)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const catalog = await loadServiceFitCatalog(tenantId)
    const fitProfileValidation = validateServiceFitProfile(
      normalizeServiceFitProfile(payload.fitProfile),
      catalog,
    )

    if (!fitProfileValidation.ok) {
      return res.status(400).json({
        error: "INVALID_SERVICE_FIT_PROFILE",
        details: fitProfileValidation.error,
      })
    }

    const [tenant, contact] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { timezone: true },
      }),
      loadServiceFitContactSnapshot(tenantId, payload.contactId),
    ])

    if (!contact) {
      return res.status(404).json({ error: "CONTACT_NOT_FOUND" })
    }

    const preview = evaluateServiceFitProfile({
      profile: fitProfileValidation.profile,
      catalog,
      contact,
      timezone: getSafeTimezone(tenant?.timezone),
    })

    return res.json({
      ok: true,
      result: preview,
    })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId/contact-services", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const { page, pageSize, contactId, status } = ContactServicesListQuerySchema.parse(req.query)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const skip = (page - 1) * pageSize

    const where = {
      tenantId,
      ...(contactId ? { contactId } : {}),
      ...(status ? { status } : {}),
    }

    let [total, items] = await prisma.$transaction([
      prismaWithServices.contactService.count({ where }),
      prismaWithServices.contactService.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip,
        take: pageSize,
        select: {
          id: true,
          status: true,
          purchasedAt: true,
          totalPriceCents: true,
          currency: true,
          service: {
            select: {
              id: true,
              name: true,
              checklistItems: {
                select: {
                  id: true,
                },
              },
            },
          },
          payments: {
            select: {
              amountCents: true,
            },
          },
          followUpTemplateVersion: {
            select: {
              definition: true,
            },
          },
          followUpRun: {
            select: {
              status: true,
              resumeAt: true,
              waitingNodeId: true,
              leaseToken: true,
            },
          },
          followUpSteps: {
            select: {
              id: true,
              templateNodeId: true,
              title: true,
              status: true,
              availableAt: true,
              dueAt: true,
              completedAt: true,
              sortOrder: true,
              assignedTo: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  image: true,
                },
              },
            },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
          checklistItems: {
            select: {
              id: true,
              checklistItemId: true,
              completedAt: true,
              checklistItem: {
                select: {
                  id: true,
                  label: true,
                  description: true,
                  isRequired: true,
                  sortOrder: true,
                },
              },
            },
            orderBy: [
              { checklistItem: { sortOrder: "asc" } },
              { createdAt: "asc" },
            ],
          },
        },
      }),
    ])

    const syncResults = await prisma.$transaction(async (tx) => {
      const prismaTx = tx as any
      const activatedIds: string[] = []
      let checklistBackfilled = false
      let statusReconciled = false
      for (const item of items) {
        const activatedId = await syncContactServiceActiveStep({
          prismaTx,
          tenantId,
          contactServiceId: item.id,
        })
        if (activatedId) activatedIds.push(activatedId)

        const serviceChecklistItemIds = (item.service?.checklistItems ?? []).map(
          (checklistItem: { id: string }) => checklistItem.id,
        )
        const existingChecklistItemIds = new Set(
          (item.checklistItems ?? []).map(
            (checklistItem: { checklistItemId: string }) => checklistItem.checklistItemId,
          ),
        )
        const missingChecklistItemIds = serviceChecklistItemIds.filter(
          (checklistItemId: string) => !existingChecklistItemIds.has(checklistItemId),
        )

        if (missingChecklistItemIds.length) {
          await prismaTx.contactServiceChecklistItem.createMany({
            data: missingChecklistItemIds.map((checklistItemId: string) => ({
              tenantId,
              contactServiceId: item.id,
              checklistItemId,
            })),
            skipDuplicates: true,
          })
          checklistBackfilled = true
        }

        const reconciled = await reconcileContactServiceCompletionFromFollowUps(
          prismaTx,
          tenantId,
          item.id,
          authed.user.id,
        )
        if (reconciled?.status && reconciled.status !== item.status) {
          statusReconciled = true
        }
      }
      return { activatedIds, checklistBackfilled, statusReconciled }
    })

    if (
      syncResults.activatedIds.length > 0 ||
      syncResults.checklistBackfilled ||
      syncResults.statusReconciled
    ) {
      items = await prismaWithServices.contactService.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip,
        take: pageSize,
        select: {
          id: true,
          status: true,
          purchasedAt: true,
          totalPriceCents: true,
          currency: true,
          service: {
            select: {
              id: true,
              name: true,
              checklistItems: {
                select: {
                  id: true,
                },
              },
            },
          },
          payments: {
            select: {
              amountCents: true,
            },
          },
          followUpTemplateVersion: {
            select: {
              definition: true,
            },
          },
          followUpRun: {
            select: {
              status: true,
              resumeAt: true,
              waitingNodeId: true,
              leaseToken: true,
            },
          },
          followUpSteps: {
            select: {
              id: true,
              templateNodeId: true,
              title: true,
              status: true,
              availableAt: true,
              dueAt: true,
              completedAt: true,
              sortOrder: true,
              assignedTo: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  image: true,
                },
              },
            },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
          checklistItems: {
            select: {
              id: true,
              checklistItemId: true,
              completedAt: true,
              checklistItem: {
                select: {
                  id: true,
                  label: true,
                  description: true,
                  isRequired: true,
                  sortOrder: true,
                },
              },
            },
            orderBy: [
              { checklistItem: { sortOrder: "asc" } },
              { createdAt: "asc" },
            ],
          },
        },
      })
    }

    const summaryWhere = {
      tenantId,
      ...(contactId ? { contactId } : {}),
    }
    const [enrolled, completed, priceAggregate, paymentAggregate] = await Promise.all([
      prismaWithServices.contactService.count({ where: summaryWhere }),
      prismaWithServices.contactService.count({
        where: { ...summaryWhere, status: "COMPLETED" },
      }),
      prismaWithServices.contactService.aggregate({
        where: summaryWhere,
        _sum: { totalPriceCents: true },
      }),
      prismaWithServices.contactServicePayment.aggregate({
        where: {
          tenantId,
          contactService: {
            is: summaryWhere,
          },
        },
        _sum: { amountCents: true },
      }),
    ])

    const totalPriceCents = priceAggregate._sum.totalPriceCents ?? 0
    const totalPaidCents = paymentAggregate._sum.amountCents ?? 0
    const totalPages = Math.max(1, Math.ceil(total / pageSize))

    return res.json({
      ok: true,
      items: items.map((item: any) => {
        const paidCents = item.payments.reduce(
          (sum: number, payment: { amountCents: number }) => sum + payment.amountCents,
          0,
        )

        const followUpMetadata = serializeContactServiceListFollowUpMetadata(item)

        return {
          id: item.id,
          status: item.status,
          purchasedAt: item.purchasedAt,
          totalPriceCents: item.totalPriceCents,
          paidCents,
          remainingCents: Math.max(0, item.totalPriceCents - paidCents),
          currency: item.currency,
          service: item.service,
          nextFollowUp: followUpMetadata.nextFollowUp,
          followUpRun: followUpMetadata.followUpRun,
          followUpSteps: followUpMetadata.followUpSteps,
        }
      }),
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
      summary: {
        enrolled,
        completed,
        totalPaidCents,
        totalRemainingCents: Math.max(0, totalPriceCents - totalPaidCents),
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.post("/:tenantId/contact-services", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const payload = CreateContactServiceSchema.parse(req.body)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const [contact, service] = await Promise.all([
      prisma.contact.findFirst({
        where: {
          id: payload.contactId,
          tenantId,
        },
        select: { id: true },
      }),
      prismaWithServices.service.findFirst({
        where: {
          id: payload.serviceId,
          tenantId,
        },
        select: {
          id: true,
          basePriceCents: true,
          currency: true,
          isTaxExempt: true,
          allowPartialPayments: true,
          minimumPartialPaymentCents: true,
          installmentCount: true,
          installmentFrequency: true,
          tenant: {
            select: {
              taxEnabled: true,
              taxLabel: true,
              defaultTaxRateBps: true,
            },
          },
          professionals: {
            select: {
              id: true,
            },
          },
          checklistItems: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: { id: true },
          },
          followUpTemplates: {
            where: { isPublished: true, activeVersionId: { not: null } },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              activeVersion: {
                select: {
                  id: true,
                  definition: true,
                },
              },
              steps: {
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
                select: {
                  templateNodeId: true,
                  title: true,
                  notesTemplate: true,
                  dueDaysFromStart: true,
                  sortOrder: true,
                },
              },
            },
          },
          followUpTemplateSteps: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: {
              templateNodeId: true,
              title: true,
              notesTemplate: true,
              dueDaysFromStart: true,
              sortOrder: true,
            },
          },
        },
      }),
    ])

    if (!contact) {
      return res.status(400).json({ error: "INVALID_CONTACT" })
    }

    if (!service) {
      return res.status(400).json({ error: "INVALID_SERVICE" })
    }

    const selectedPublishedTemplate = payload.followUpTemplateId
      ? service.followUpTemplates.find((item: any) => item.id === payload.followUpTemplateId) ?? null
      : service.followUpTemplates[0] ?? null
    if (payload.followUpTemplateId && !selectedPublishedTemplate) {
      return res.status(400).json({ error: "INVALID_FOLLOW_UP_TEMPLATE" })
    }
    const templateStepsForEnrollment =
      selectedPublishedTemplate?.steps?.length
        ? selectedPublishedTemplate.steps
        : service.followUpTemplateSteps
    if (
      payload.followUpTemplateId &&
      !selectedPublishedTemplate?.activeVersion &&
      !templateStepsForEnrollment.length
    ) {
      return res.status(400).json({ error: "FOLLOW_UP_TEMPLATE_HAS_NO_STEPS" })
    }

    const selectedAssignedProfessional = payload.assignedProfessionalId
      ? service.professionals.find(
          (item: { id: string }) => item.id === payload.assignedProfessionalId,
        ) ?? null
      : null

    if (payload.assignedProfessionalId && !selectedAssignedProfessional) {
      return res.status(400).json({ error: "INVALID_ASSIGNED_SERVICE_PROFESSIONAL" })
    }

    if (payload.followUpAssignedToUserId) {
      const assigneeMembership = await prisma.membership.findUnique({
        where: {
          userId_tenantId: {
            userId: payload.followUpAssignedToUserId,
            tenantId,
          },
        },
        select: {
          status: true,
        },
      })

      if (!assigneeMembership || assigneeMembership.status !== "ACTIVE") {
        return res.status(400).json({ error: "INVALID_FOLLOW_UP_ASSIGNEE" })
      }
    }

    const purchasedAt = payload.purchasedAt ? new Date(payload.purchasedAt) : new Date()
    const startedAt = payload.startedAt ? new Date(payload.startedAt) : new Date()
    const totalPriceCents = getServiceTotalWithTaxCents({
      basePriceCents: service.basePriceCents,
      isTaxExempt: service.isTaxExempt,
      taxEnabled: service.tenant.taxEnabled,
      defaultTaxRateBps: service.tenant.defaultTaxRateBps ?? null,
    })
    const initialPaymentCents = payload.initialPaymentCents ?? 0

    if (initialPaymentCents < 0 || initialPaymentCents > totalPriceCents) {
      return res.status(400).json({ error: "INVALID_INITIAL_PAYMENT" })
    }

    if (initialPaymentCents > 0 && initialPaymentCents < totalPriceCents && !service.allowPartialPayments) {
      return res.status(400).json({ error: "SERVICE_DOES_NOT_ALLOW_PARTIAL_PAYMENTS" })
    }
    const sanitizedServiceNotes =
      payload.notes && payload.notes.trim().length
        ? sanitizeMultilineText(payload.notes)
        : null

    const created = await prisma.$transaction(async (tx) => {
      const prismaTx = tx as any

      const contactService = await prismaTx.contactService.create({
        data: {
          tenantId,
          contactId: payload.contactId,
          serviceId: payload.serviceId,
          followUpTemplateId: selectedPublishedTemplate?.id ?? null,
          followUpTemplateVersionId: selectedPublishedTemplate?.activeVersion?.id ?? null,
          assignedProfessionalId: selectedAssignedProfessional?.id ?? null,
          status: "IN_PROGRESS",
          startedAt,
          purchasedAt,
          totalPriceCents,
          currency: service.currency,
          allowPartialPayments: service.allowPartialPayments,
          notes: sanitizedServiceNotes,
        },
        select: {
          id: true,
        },
      })

      if (initialPaymentCents > 0) {
        await prismaTx.contactServicePayment.create({
          data: {
            tenantId,
            contactServiceId: contactService.id,
            amountCents: initialPaymentCents,
            paidAt: purchasedAt,
            paymentMethod: null,
            note: "Initial payment",
            recordedById: authed.user.id,
          },
        })
      }

      if (service.checklistItems.length) {
        await prismaTx.contactServiceChecklistItem.createMany({
          data: service.checklistItems.map((item: { id: string }) => ({
            tenantId,
            contactServiceId: contactService.id,
            checklistItemId: item.id,
          })),
        })
      }

      let followUpRunId: string | null = null
      if (selectedPublishedTemplate?.activeVersion) {
        const run = await createFollowUpRunTx({
          prismaTx,
          tenantId,
          contactServiceId: contactService.id,
          templateVersion: selectedPublishedTemplate.activeVersion,
          startedByUserId: authed.user.id,
          assignedToUserId: payload.followUpAssignedToUserId ?? null,
        })
        followUpRunId = run.id
      } else if (templateStepsForEnrollment.length) {
        await prismaTx.contactServiceFollowUpStep.createMany({
          data: templateStepsForEnrollment.map((step: any, index: number) => {
            const dueAt = new Date(startedAt)
            dueAt.setDate(dueAt.getDate() + step.dueDaysFromStart)

            return {
              tenantId,
              contactServiceId: contactService.id,
              templateNodeId: step.templateNodeId ?? null,
              title: step.title,
              notesTemplate: step.notesTemplate,
              status: index === 0 ? "ACTIVE" : "PENDING",
              availableAt: index === 0 ? startedAt : dueAt,
              dueAt,
              assignedToUserId: payload.followUpAssignedToUserId ?? null,
              sortOrder: step.sortOrder,
            }
          }),
        })
      }

      if (selectedPublishedTemplate?.id && !selectedPublishedTemplate.activeVersion) {
        await executeFollowUpFromStart({
          prismaTx,
          tenantId,
          contactServiceId: contactService.id,
          actorUserId: authed.user.id,
          ignoreWaitNodes: true,
        })
      }

      await reconcileContactServiceCompletionFromFollowUps(
        prismaTx,
        tenantId,
        contactService.id,
        authed.user.id,
      )

      return { contactService, followUpRunId }
    })

    if (created.followUpRunId) {
      await executeFollowUpRun({
        runId: created.followUpRunId,
        actorUserId: authed.user.id,
      })
    }

    return res.status(201).json({
      ok: true,
      contactService: created.contactService,
    })
  } catch (error) {
    return next(error)
  }
})

router.get(
  "/:tenantId/contact-services/:contactServiceId/overview",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId } = TenantContactServicePathSchema.parse(req.params)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      const fetchItem = async () =>
        prismaWithServices.contactService.findFirst({
          where: {
            id: contactServiceId,
            tenantId,
          },
          select: {
            id: true,
            contactId: true,
            status: true,
            startedAt: true,
            purchasedAt: true,
            completedAt: true,
            canceledAt: true,
            totalPriceCents: true,
            currency: true,
            allowPartialPayments: true,
            notes: true,
            assignedProfessional: {
              select: {
                id: true,
                kind: true,
                userId: true,
                externalProfessionalName: true,
                externalContact: true,
                user: {
                  select: {
                    name: true,
                    email: true,
                    image: true,
                  },
                },
              },
            },
            contact: {
              select: {
                firstName: true,
                middleName: true,
                lastName: true,
              },
            },
            service: {
              select: {
                id: true,
                name: true,
                description: true,
                basePriceCents: true,
                isTaxExempt: true,
                minimumPartialPaymentCents: true,
                installmentCount: true,
                installmentFrequency: true,
                tenant: {
                  select: {
                    taxEnabled: true,
                    taxLabel: true,
                    defaultTaxRateBps: true,
                    timezone: true,
                  },
                },
                checklistItems: {
                  select: {
                    id: true,
                    label: true,
                    description: true,
                    isRequired: true,
                    sortOrder: true,
                  },
                  orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
                },
              },
            },
            followUpTemplate: {
              select: {
                id: true,
                name: true,
              },
            },
            followUpTemplateVersion: {
              select: { id: true, versionNumber: true, definition: true },
            },
            followUpRun: {
              select: {
                id: true,
                status: true,
                resumeAt: true,
                waitingNodeId: true,
                leaseToken: true,
                failureNodeId: true,
                failureCode: true,
                failureMessage: true,
                failedAt: true,
              },
            },
            payments: {
              select: {
                amountCents: true,
                paidAt: true,
                note: true,
              },
              orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
            },
            followUpSteps: {
              select: {
                id: true,
                templateNodeId: true,
                title: true,
                notesTemplate: true,
                status: true,
                availableAt: true,
                dueAt: true,
                completedAt: true,
                resolutionSource: true,
                resolutionReason: true,
                assignedToUserId: true,
                assignedTo: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    image: true,
                  },
                },
                note: true,
                sortOrder: true,
              },
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            },
            checklistItems: {
              select: {
                id: true,
                checklistItemId: true,
                completedAt: true,
                checklistItem: {
                  select: {
                    id: true,
                    label: true,
                    description: true,
                    isRequired: true,
                    sortOrder: true,
                  },
                },
              },
              orderBy: [
                { checklistItem: { sortOrder: "asc" } },
                { createdAt: "asc" },
              ],
            },
          },
        })

      let item = await fetchItem()

      if (!item) {
        return res.status(404).json({ error: "CONTACT_SERVICE_NOT_FOUND" })
      }

      const syncResult = await prisma.$transaction(async (tx) => {
        const prismaTx = tx as any
        const activatedId = await syncContactServiceActiveStep({
          prismaTx,
          tenantId,
          contactServiceId: item.id,
        })

        const serviceChecklistItemIds = (item.service?.checklistItems ?? []).map(
          (checklistItem: { id: string }) => checklistItem.id,
        )
        const existingChecklistItemIds = new Set(
          (item.checklistItems ?? []).map(
            (checklistItem: { checklistItemId: string }) => checklistItem.checklistItemId,
          ),
        )
        const missingChecklistItemIds = serviceChecklistItemIds.filter(
          (checklistItemId: string) => !existingChecklistItemIds.has(checklistItemId),
        )

        if (missingChecklistItemIds.length) {
          await prismaTx.contactServiceChecklistItem.createMany({
            data: missingChecklistItemIds.map((checklistItemId: string) => ({
              tenantId,
              contactServiceId: item.id,
              checklistItemId,
            })),
            skipDuplicates: true,
          })
        }

        const reconciled = await reconcileContactServiceCompletionFromFollowUps(
          prismaTx,
          tenantId,
          item.id,
          authed.user.id,
        )

        return {
          activatedId,
          checklistBackfilled: missingChecklistItemIds.length > 0,
          statusReconciled: reconciled?.status !== item.status,
        }
      })

      if (
        syncResult.activatedId ||
        syncResult.checklistBackfilled ||
        syncResult.statusReconciled
      ) {
        item = await fetchItem()
      }

      if (!item) {
        return res.status(404).json({ error: "CONTACT_SERVICE_NOT_FOUND" })
      }

      const paidCents = item.payments.reduce(
        (sum: number, payment: { amountCents: number }) => sum + payment.amountCents,
        0,
      )
      const latestPaidAt = item.payments[0]?.paidAt ?? null
      const scheduledPaymentsRecordedCount = item.payments.filter(
        (payment: { note: string | null }) =>
          payment.note?.trim().toLowerCase() !== "initial payment",
      ).length

      return res.json({
        ok: true,
        contactService: {
          id: item.id,
          contactId: item.contactId,
          status: item.status,
          startedAt: item.startedAt,
          purchasedAt: item.purchasedAt,
          completedAt: item.completedAt,
          canceledAt: item.canceledAt,
          totalPriceCents: item.totalPriceCents,
          paidCents,
          remainingCents: Math.max(0, item.totalPriceCents - paidCents),
          currency: item.currency,
          allowPartialPayments: item.allowPartialPayments,
          notes: item.notes,
          assignedProfessional: item.assignedProfessional,
          contactName: [item.contact?.firstName, item.contact?.middleName, item.contact?.lastName]
            .filter(Boolean)
            .join(" "),
          service: {
            id: item.service.id,
            name: item.service.name,
            description: item.service.description,
            basePriceCents: item.service.basePriceCents,
            isTaxExempt: item.service.isTaxExempt,
            minimumPartialPaymentCents: item.service.minimumPartialPaymentCents,
            installmentCount: item.service.installmentCount,
            installmentFrequency: item.service.installmentFrequency,
          },
          tenantBilling: {
            taxEnabled: item.service.tenant.taxEnabled,
            taxLabel: item.service.tenant.taxLabel,
            defaultTaxRatePercent:
              item.service.tenant.defaultTaxRateBps !== null &&
              item.service.tenant.defaultTaxRateBps !== undefined
                ? item.service.tenant.defaultTaxRateBps / 100
                : null,
          },
          followUpTemplate: item.followUpTemplate,
          ...serializeVersionedFollowUpMetadata(
            item,
            getSafeTimezone(item.service.tenant.timezone),
          ),
          checklistItems: item.checklistItems.map((checklistItem: any) => ({
            id: checklistItem.id,
            checklistItemId: checklistItem.checklistItemId,
            completedAt: checklistItem.completedAt,
            label: checklistItem.checklistItem?.label ?? "",
            description: checklistItem.checklistItem?.description ?? null,
            isRequired: Boolean(checklistItem.checklistItem?.isRequired),
            sortOrder: checklistItem.checklistItem?.sortOrder ?? 0,
          })),
          paymentSummary: {
            latestPaidAt,
            totalPaymentsCount: item.payments.length,
            scheduledPaymentsRecordedCount,
          },
        },
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.get(
  "/:tenantId/contact-services/:contactServiceId",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId } = TenantContactServicePathSchema.parse(req.params)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      const serviceNotesSelectWithAttachments = {
        select: {
          id: true,
          title: true,
          body: true,
          createdAt: true,
          createdBy: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
          attachments: {
            orderBy: { createdAt: "asc" as const },
            select: {
              id: true,
              file: {
                select: {
                  id: true,
                  key: true,
                  contentType: true,
                  size: true,
                },
              },
            },
          },
        },
        orderBy: [{ createdAt: "desc" as const }],
      }

      const serviceNotesSelectWithoutAttachments = {
        select: {
          id: true,
          title: true,
          body: true,
          createdAt: true,
          createdBy: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
        },
        orderBy: [{ createdAt: "desc" as const }],
      }

      const fetchItem = async (includeServiceNoteAttachments = true) =>
        prismaWithServices.contactService.findFirst({
          where: {
            id: contactServiceId,
            tenantId,
          },
          select: {
            id: true,
            contactId: true,
            status: true,
            startedAt: true,
            purchasedAt: true,
            completedAt: true,
            canceledAt: true,
            totalPriceCents: true,
            currency: true,
            allowPartialPayments: true,
            notes: true,
            assignedProfessional: {
              select: {
                id: true,
                kind: true,
                userId: true,
                externalProfessionalName: true,
                externalContact: true,
                user: {
                  select: {
                    name: true,
                    email: true,
                    image: true,
                  },
                },
              },
            },
            contact: {
              select: {
                firstName: true,
                middleName: true,
                lastName: true,
              },
            },
            service: {
              select: {
                id: true,
                name: true,
                description: true,
                basePriceCents: true,
                isTaxExempt: true,
                minimumPartialPaymentCents: true,
                installmentCount: true,
                installmentFrequency: true,
                tenant: {
                  select: {
                    taxEnabled: true,
                    taxLabel: true,
                    defaultTaxRateBps: true,
                    timezone: true,
                  },
                },
                checklistItems: {
                  select: {
                    id: true,
                    label: true,
                    description: true,
                    isRequired: true,
                    sortOrder: true,
                  },
                  orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
                },
              },
            },
            followUpTemplate: {
              select: {
                id: true,
                name: true,
              },
            },
            followUpTemplateVersion: {
              select: { id: true, versionNumber: true, definition: true },
            },
            followUpRun: {
              select: {
                id: true,
                status: true,
                resumeAt: true,
                waitingNodeId: true,
                leaseToken: true,
                failureNodeId: true,
                failureCode: true,
                failureMessage: true,
                failedAt: true,
              },
            },
            payments: {
              select: {
                id: true,
                amountCents: true,
                paidAt: true,
                paymentMethod: true,
                note: true,
                recordedBy: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
              orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
            },
            serviceNotes: includeServiceNoteAttachments
              ? serviceNotesSelectWithAttachments
              : serviceNotesSelectWithoutAttachments,
            contactNotes: {
              select: {
                id: true,
                title: true,
                body: true,
                createdAt: true,
                createdBy: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    image: true,
                  },
                },
                followUpTemplate: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
                contactServiceFollowUpStep: {
                  select: {
                    id: true,
                    title: true,
                  },
                },
                attachments: {
                  orderBy: { createdAt: "asc" },
                  select: {
                    id: true,
                    file: {
                      select: {
                        id: true,
                        key: true,
                        contentType: true,
                        size: true,
                      },
                    },
                  },
                },
              },
              orderBy: [{ createdAt: "desc" }],
            },
            executionLogs: {
              select: {
                id: true,
                eventType: true,
                title: true,
                details: true,
                createdAt: true,
                actor: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
              orderBy: [{ createdAt: "desc" }],
            },
            followUpSteps: {
              select: {
                id: true,
                templateNodeId: true,
                title: true,
                notesTemplate: true,
                status: true,
                availableAt: true,
                dueAt: true,
                completedAt: true,
                resolutionSource: true,
                resolutionReason: true,
                assignedToUserId: true,
                assignedTo: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    image: true,
                  },
                },
                note: true,
                sortOrder: true,
              },
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            },
            checklistItems: {
              select: {
                id: true,
                checklistItemId: true,
                completedAt: true,
                checklistItem: {
                  select: {
                    id: true,
                    label: true,
                    description: true,
                    isRequired: true,
                    sortOrder: true,
                  },
                },
              },
              orderBy: [
                { checklistItem: { sortOrder: "asc" } },
                { createdAt: "asc" },
              ],
            },
          },
        })

      let item: Awaited<ReturnType<typeof fetchItem>> | null
      try {
        item = await fetchItem(true)
      } catch (error) {
        if (!hasServiceNoteAttachmentQueryError(error)) {
          throw error
        }
        item = await fetchItem(false)
      }

      if (!item) {
        return res.status(404).json({ error: "CONTACT_SERVICE_NOT_FOUND" })
      }

      const syncResult = await prisma.$transaction(async (tx) => {
        const prismaTx = tx as any
        const activatedId = await syncContactServiceActiveStep({
          prismaTx,
          tenantId,
          contactServiceId: item.id,
        })

        const serviceChecklistItemIds = (item.service?.checklistItems ?? []).map(
          (checklistItem: { id: string }) => checklistItem.id,
        )
        const existingChecklistItemIds = new Set(
          (item.checklistItems ?? []).map(
            (checklistItem: { checklistItemId: string }) => checklistItem.checklistItemId,
          ),
        )
        const missingChecklistItemIds = serviceChecklistItemIds.filter(
          (checklistItemId: string) => !existingChecklistItemIds.has(checklistItemId),
        )

        if (missingChecklistItemIds.length) {
          await prismaTx.contactServiceChecklistItem.createMany({
            data: missingChecklistItemIds.map((checklistItemId: string) => ({
              tenantId,
              contactServiceId: item.id,
              checklistItemId,
            })),
            skipDuplicates: true,
          })
        }

        const reconciled = await reconcileContactServiceCompletionFromFollowUps(
          prismaTx,
          tenantId,
          item.id,
          authed.user.id,
        )

        return {
          activatedId,
          checklistBackfilled: missingChecklistItemIds.length > 0,
          statusReconciled: reconciled?.status !== item.status,
        }
      })

      if (
        syncResult.activatedId ||
        syncResult.checklistBackfilled ||
        syncResult.statusReconciled
      ) {
        try {
          item = await fetchItem(true)
        } catch (error) {
          if (!hasServiceNoteAttachmentQueryError(error)) {
            throw error
          }
          item = await fetchItem(false)
        }
      }

      if (!item) {
        return res.status(404).json({ error: "CONTACT_SERVICE_NOT_FOUND" })
      }

      const paidCents = item.payments.reduce(
        (sum: number, payment: { amountCents: number }) => sum + payment.amountCents,
        0,
      )
      const combinedNotes = [
        ...item.serviceNotes.map((note: any) =>
          serializeRelatedServiceNote(note, "SERVICE_NOTE"),
        ),
        ...item.contactNotes.map((note: any) =>
          serializeRelatedServiceNote(
            note,
            note.followUpTemplate || note.contactServiceFollowUpStep
              ? "FOLLOW_UP_NOTE"
              : "LINKED_CONTACT_NOTE",
          ),
        ),
      ].sort(
        (left, right) =>
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      )

      return res.json({
        ok: true,
        contactService: {
          id: item.id,
          contactId: item.contactId,
          status: item.status,
          startedAt: item.startedAt,
          purchasedAt: item.purchasedAt,
          completedAt: item.completedAt,
          canceledAt: item.canceledAt,
          totalPriceCents: item.totalPriceCents,
          paidCents,
          remainingCents: Math.max(0, item.totalPriceCents - paidCents),
          currency: item.currency,
          allowPartialPayments: item.allowPartialPayments,
          notes: item.notes,
          assignedProfessional: item.assignedProfessional,
          contactName: [item.contact?.firstName, item.contact?.middleName, item.contact?.lastName]
            .filter(Boolean)
            .join(" "),
          service: {
            id: item.service.id,
            name: item.service.name,
            description: item.service.description,
            basePriceCents: item.service.basePriceCents,
            isTaxExempt: item.service.isTaxExempt,
            minimumPartialPaymentCents: item.service.minimumPartialPaymentCents,
            installmentCount: item.service.installmentCount,
            installmentFrequency: item.service.installmentFrequency,
          },
          tenantBilling: {
            taxEnabled: item.service.tenant.taxEnabled,
            taxLabel: item.service.tenant.taxLabel,
            defaultTaxRatePercent:
              item.service.tenant.defaultTaxRateBps !== null &&
              item.service.tenant.defaultTaxRateBps !== undefined
                ? item.service.tenant.defaultTaxRateBps / 100
                : null,
          },
          followUpTemplate: item.followUpTemplate,
          ...serializeVersionedFollowUpMetadata(
            item,
            getSafeTimezone(item.service.tenant.timezone),
          ),
          payments: item.payments,
          serviceNotes: combinedNotes,
          checklistItems: item.checklistItems.map((checklistItem: any) => ({
            id: checklistItem.id,
            checklistItemId: checklistItem.checklistItemId,
            completedAt: checklistItem.completedAt,
            label: checklistItem.checklistItem?.label ?? "",
            description: checklistItem.checklistItem?.description ?? null,
            isRequired: Boolean(checklistItem.checklistItem?.isRequired),
            sortOrder: checklistItem.checklistItem?.sortOrder ?? 0,
          })),
        },
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.post(
  "/:tenantId/contact-services/:contactServiceId/notes",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId } = TenantContactServicePathSchema.parse(req.params)
      const payload = CreateContactServiceNoteSchema.parse(req.body)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      const existing = await prismaWithServices.contactService.findFirst({
        where: {
          id: contactServiceId,
          tenantId,
        },
        select: {
          id: true,
          status: true,
          contactId: true,
          followUpTemplateId: true,
          service: {
            select: {
              name: true,
            },
          },
        },
      })
      const files = await getValidatedServiceNoteFiles(tenantId, payload.attachmentFileIds)

      if (!existing) {
        return res.status(404).json({ error: "CONTACT_SERVICE_NOT_FOUND" })
      }
      if (!files) {
        return res.status(400).json({ error: "INVALID_NOTE_ATTACHMENTS" })
      }

      const note = await prismaWithServices.contactServiceNote.create({
        data: {
          tenantId,
          contactServiceId,
          createdById: authed.user.id,
          title: sanitizeSingleLineText(payload.title),
          body: sanitizeMultilineText(payload.body),
          attachments: {
            create: files.map((file: { id: string }) => ({
              tenantId,
              fileId: file.id,
            })),
          },
        },
        select: {
          id: true,
          title: true,
          body: true,
          createdAt: true,
          createdBy: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
          attachments: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              file: {
                select: {
                  id: true,
                  key: true,
                  contentType: true,
                  size: true,
                },
              },
            },
          },
        },
      })

      return res.status(201).json({
        ok: true,
        note: {
          ...note,
          attachments: note.attachments.map((attachment: any) => ({
            id: attachment.id,
            fileId: attachment.file.id,
            key: attachment.file.key,
            fileName: fileNameFromKey(attachment.file.key),
            contentType: attachment.file.contentType,
            size: attachment.file.size ?? null,
          })),
        },
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.post(
  "/:tenantId/contact-services/:contactServiceId/payments",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId } = TenantContactServicePathSchema.parse(req.params)
      const payload = CreateContactServicePaymentSchema.parse(req.body)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      if (!canManageContactServices(membership)) {
        return res.status(403).json({ error: "INSUFFICIENT_SECURITY_LEVEL" })
      }

      const contactService = await prismaWithServices.contactService.findFirst({
        where: {
          id: contactServiceId,
          tenantId,
        },
        select: {
          id: true,
          totalPriceCents: true,
        },
      })

      if (!contactService) {
        return res.status(404).json({ error: "CONTACT_SERVICE_NOT_FOUND" })
      }
      const existingPayments = await prismaWithServices.contactServicePayment.findMany({
        where: {
          tenantId,
          contactServiceId,
        },
        select: {
          amountCents: true,
        },
      })

      const currentPaidCents = existingPayments.reduce(
        (sum: number, payment: { amountCents: number }) => sum + payment.amountCents,
        0,
      )

      if (currentPaidCents + payload.amountCents > contactService.totalPriceCents) {
        return res.status(400).json({ error: "PAYMENT_EXCEEDS_SERVICE_TOTAL" })
      }

      const payment = await prismaWithServices.contactServicePayment.create({
        data: {
          tenantId,
          contactServiceId,
          amountCents: payload.amountCents,
          paidAt: payload.paidAt ? new Date(payload.paidAt) : new Date(),
          paymentMethod:
            payload.paymentMethod && payload.paymentMethod.trim().length
              ? sanitizeSingleLineText(payload.paymentMethod)
              : null,
          note:
            payload.note && payload.note.trim().length
              ? sanitizeMultilineText(payload.note)
              : null,
          recordedById: authed.user.id,
        },
        select: {
          id: true,
          amountCents: true,
          paidAt: true,
          paymentMethod: true,
          note: true,
          recordedById: true,
        },
      })

      const summary = await summarizeContactServicePayments(
        prismaWithServices,
        tenantId,
        contactServiceId,
      )
      await reconcileContactServiceCompletionFromFollowUps(
        prismaWithServices,
        tenantId,
        contactServiceId,
        authed.user.id,
      )

      return res.status(201).json({
        ok: true,
        payment,
        summary,
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.patch(
  "/:tenantId/contact-services/:contactServiceId/payments/:paymentId",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId, paymentId } =
        TenantContactServicePaymentPathSchema.parse(req.params)
      const payload = UpdateContactServicePaymentSchema.parse(req.body)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      if (!canManageContactServices(membership)) {
        return res.status(403).json({ error: "INSUFFICIENT_SECURITY_LEVEL" })
      }

      if (Object.keys(payload).length === 0) {
        return res.status(400).json({ error: "NO_CHANGES_PROVIDED" })
      }

      const existing = await prismaWithServices.contactServicePayment.findFirst({
        where: {
          id: paymentId,
          tenantId,
          contactServiceId,
        },
        select: {
          id: true,
          amountCents: true,
        },
      })

      if (!existing) {
        return res.status(404).json({ error: "CONTACT_SERVICE_PAYMENT_NOT_FOUND" })
      }

      const contactService = await prismaWithServices.contactService.findFirst({
        where: {
          id: contactServiceId,
          tenantId,
        },
        select: {
          totalPriceCents: true,
        },
      })

      if (!contactService) {
        return res.status(404).json({ error: "CONTACT_SERVICE_NOT_FOUND" })
      }

      const otherPayments = await prismaWithServices.contactServicePayment.findMany({
        where: {
          tenantId,
          contactServiceId,
          id: { not: paymentId },
        },
        select: {
          amountCents: true,
        },
      })

      const otherPaidCents = otherPayments.reduce(
        (sum: number, payment: { amountCents: number }) => sum + payment.amountCents,
        0,
      )
      const nextAmountCents = payload.amountCents ?? existing.amountCents

      if (otherPaidCents + nextAmountCents > contactService.totalPriceCents) {
        return res.status(400).json({ error: "PAYMENT_EXCEEDS_SERVICE_TOTAL" })
      }

      const payment = await prismaWithServices.contactServicePayment.update({
        where: { id: paymentId },
        data: {
          ...(payload.amountCents !== undefined ? { amountCents: payload.amountCents } : {}),
          ...(payload.paidAt !== undefined ? { paidAt: new Date(payload.paidAt) } : {}),
          ...(payload.paymentMethod !== undefined
            ? {
                paymentMethod:
                  payload.paymentMethod && payload.paymentMethod.trim().length
                    ? sanitizeSingleLineText(payload.paymentMethod)
                    : null,
              }
            : {}),
          ...(payload.note !== undefined
            ? {
                note:
                  payload.note && payload.note.trim().length
                    ? sanitizeMultilineText(payload.note)
                    : null,
              }
            : {}),
        },
        select: {
          id: true,
          amountCents: true,
          paidAt: true,
          paymentMethod: true,
          note: true,
          recordedById: true,
        },
      })

      const summary = await summarizeContactServicePayments(
        prismaWithServices,
        tenantId,
        contactServiceId,
      )
      await reconcileContactServiceCompletionFromFollowUps(
        prismaWithServices,
        tenantId,
        contactServiceId,
        authed.user.id,
      )

      return res.json({
        ok: true,
        payment,
        summary,
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.delete(
  "/:tenantId/contact-services/:contactServiceId/payments/:paymentId",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId, paymentId } =
        TenantContactServicePaymentPathSchema.parse(req.params)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      if (!canManageContactServices(membership)) {
        return res.status(403).json({ error: "INSUFFICIENT_SECURITY_LEVEL" })
      }

      const existing = await prismaWithServices.contactServicePayment.findFirst({
        where: {
          id: paymentId,
          tenantId,
          contactServiceId,
        },
        select: {
          id: true,
        },
      })

      if (!existing) {
        return res.status(404).json({ error: "CONTACT_SERVICE_PAYMENT_NOT_FOUND" })
      }

      await prismaWithServices.contactServicePayment.delete({
        where: { id: paymentId },
      })

      const summary = await summarizeContactServicePayments(
        prismaWithServices,
        tenantId,
        contactServiceId,
      )
      await reconcileContactServiceCompletionFromFollowUps(
        prismaWithServices,
        tenantId,
        contactServiceId,
        authed.user.id,
      )

      return res.json({
        ok: true,
        summary,
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.patch(
  "/:tenantId/contact-services/:contactServiceId",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId } = TenantContactServicePathSchema.parse(req.params)
      const payload = UpdateContactServiceSchema.parse(req.body)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      if (Object.keys(payload).length === 0) {
        return res.status(400).json({ error: "NO_CHANGES_PROVIDED" })
      }

      if (!canManageContactServices(membership)) {
        return res.status(403).json({ error: "INSUFFICIENT_SECURITY_LEVEL" })
      }

      const existing = await prismaWithServices.contactService.findFirst({
        where: {
          id: contactServiceId,
          tenantId,
        },
        select: {
          id: true,
        },
      })

      if (!existing) {
        return res.status(404).json({ error: "CONTACT_SERVICE_NOT_FOUND" })
      }

      const statusUpdate =
        payload.status === undefined
          ? {}
          : payload.status === "COMPLETED"
            ? {
                status: "COMPLETED" as const,
                completedAt: payload.completedAt ? new Date(payload.completedAt) : new Date(),
                canceledAt: null,
              }
            : payload.status === "CANCELED"
              ? {
                  status: "CANCELED" as const,
                  canceledAt: payload.canceledAt ? new Date(payload.canceledAt) : new Date(),
                  completedAt: null,
                }
              : {
                  status: payload.status,
                  completedAt: null,
                  canceledAt: null,
                }

      const updated = await prismaWithServices.contactService.update({
        where: { id: contactServiceId },
        data: {
          ...statusUpdate,
          ...(payload.startedAt !== undefined
            ? { startedAt: payload.startedAt ? new Date(payload.startedAt) : null }
            : {}),
          ...(payload.purchasedAt !== undefined
            ? { purchasedAt: payload.purchasedAt ? new Date(payload.purchasedAt) : null }
            : {}),
          ...(payload.notes !== undefined
            ? {
                notes:
                  payload.notes && payload.notes.trim().length
                    ? sanitizeMultilineText(payload.notes)
                    : null,
              }
            : {}),
        },
        select: {
          id: true,
          status: true,
          startedAt: true,
          purchasedAt: true,
          completedAt: true,
          canceledAt: true,
          totalPriceCents: true,
          notes: true,
        },
      })

      if (payload.status !== undefined && payload.status !== existing.status && existing.followUpTemplateId) {
        await prismaWithServices.serviceFollowUpExecutionLog.create({
          data: {
            tenantId,
            templateId: existing.followUpTemplateId,
            contactServiceId,
            contactId: existing.contactId,
            actorUserId: authed.user.id,
            eventType: "SERVICE_STATUS_UPDATED",
            title: `Service status updated: ${existing.service.name}`,
            details: `Service moved from ${existing.status.toLowerCase().replace(/_/g, " ")} to ${updated.status.toLowerCase().replace(/_/g, " ")}.`,
            payload: {
              previousStatus: existing.status,
              status: updated.status,
            },
          },
        })
      }

      return res.json({
        ok: true,
        contactService: updated,
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.delete(
  "/:tenantId/contact-services/:contactServiceId",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId } = TenantContactServicePathSchema.parse(req.params)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      if (!canManageContactServices(membership)) {
        return res.status(403).json({ error: "INSUFFICIENT_SECURITY_LEVEL" })
      }

      const existing = await prismaWithServices.contactService.findFirst({
        where: {
          id: contactServiceId,
          tenantId,
        },
        select: {
          id: true,
        },
      })

      if (!existing) {
        return res.status(404).json({ error: "CONTACT_SERVICE_NOT_FOUND" })
      }

      await prismaWithServices.contactService.delete({
        where: { id: contactServiceId },
      })

      return res.json({ ok: true })
    } catch (error) {
      return next(error)
    }
  },
)

router.patch(
  "/:tenantId/contact-services/:contactServiceId/checklist-items/:checklistItemId",
  requireAuth,
  async (req, res, next) => {
    try {
      const { tenantId, contactServiceId, checklistItemId } =
        TenantContactServiceChecklistItemPathSchema.parse(req.params)
      const payload = UpdateContactServiceChecklistItemSchema.parse(req.body)

      const membership = await requireActiveMembership(req as AuthedRequest, res, tenantId)
      if (!membership) return

      if (payload.completed === undefined) {
        return res.status(400).json({ error: "NO_CHANGES_PROVIDED" })
      }

      const existing = await prismaWithServices.contactServiceChecklistItem.findFirst({
        where: {
          id: checklistItemId,
          tenantId,
          contactServiceId,
        },
        select: {
          id: true,
          checklistItemId: true,
          completedAt: true,
          checklistItem: {
            select: {
              id: true,
              label: true,
              description: true,
              isRequired: true,
              sortOrder: true,
            },
          },
        },
      })

      if (!existing) {
        return res.status(404).json({ error: "CONTACT_SERVICE_CHECKLIST_ITEM_NOT_FOUND" })
      }

      const updated = await prismaWithServices.contactServiceChecklistItem.update({
        where: { id: checklistItemId },
        data: {
          completedAt: payload.completed ? new Date() : null,
        },
        select: {
          id: true,
          checklistItemId: true,
          completedAt: true,
          checklistItem: {
            select: {
              id: true,
              label: true,
              description: true,
              isRequired: true,
              sortOrder: true,
            },
          },
        },
      })

      return res.json({
        ok: true,
        checklistItem: {
          id: updated.id,
          checklistItemId: updated.checklistItemId,
          completedAt: updated.completedAt,
          label: updated.checklistItem?.label ?? "",
          description: updated.checklistItem?.description ?? null,
          isRequired: Boolean(updated.checklistItem?.isRequired),
          sortOrder: updated.checklistItem?.sortOrder ?? 0,
        },
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.patch(
  "/:tenantId/contact-services/:contactServiceId/follow-up-steps/:followUpStepId",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId, followUpStepId } = TenantFollowUpStepPathSchema.parse(
        req.params,
      )
      const payload = UpdateFollowUpStepSchema.parse(req.body)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      if (payload.assignedToUserId) {
        const assigneeMembership = await prisma.membership.findUnique({
          where: {
            userId_tenantId: {
              userId: payload.assignedToUserId,
              tenantId,
            },
          },
          select: {
            status: true,
          },
        })

        if (!assigneeMembership || assigneeMembership.status !== "ACTIVE") {
          return res.status(400).json({ error: "INVALID_ASSIGNEE" })
        }
      }

      const existing = await prismaWithServices.contactServiceFollowUpStep.findFirst({
        where: {
          id: followUpStepId,
          tenantId,
          contactServiceId,
        },
        select: {
          id: true,
          status: true,
          completedAt: true,
          dueAt: true,
          availableAt: true,
          sortOrder: true,
          templateNodeId: true,
          runId: true,
          resolutionSource: true,
        },
      })

      if (!existing) {
        return res.status(404).json({ error: "FOLLOW_UP_STEP_NOT_FOUND" })
      }
      const isReopenAction = payload.action === "REOPEN"
      const versionedRun = existing.runId
        ? await prismaWithServices.contactServiceFollowUpRun.findUnique({
            where: { id: existing.runId },
            include: { templateVersion: { select: { definition: true } } },
          })
        : null
      const userScheduledWait =
        versionedRun?.templateVersion && existing.templateNodeId
          ? getUserScheduledWaitForStep(
              versionedRun.templateVersion.definition,
              existing.templateNodeId,
            )
          : null
      const isCompleting = payload.status === "COMPLETED" || Boolean(payload.completedAt)
      const isUserSkipping = payload.status === "SKIPPED"
      const nextFollowUpDate = payload.nextFollowUpAt
        ? new Date(payload.nextFollowUpAt)
        : null

      if (existing.runId && !isReopenAction) {
        const isCurrentStep =
          versionedRun?.activeStepId === existing.id ||
          (versionedRun?.activeStepId === null &&
            versionedRun.cursorNodeId === existing.templateNodeId &&
            ["AWAITING_STEP", "WAITING"].includes(versionedRun.status))
        if (!isCurrentStep || existing.status !== "ACTIVE") {
          return res.status(409).json({ error: "FOLLOW_UP_STEP_NOT_CURRENT" })
        }
        if (payload.status === "PENDING" || payload.status === "ACTIVE") {
          return res.status(400).json({ error: "INVALID_FOLLOW_UP_STEP_TRANSITION" })
        }
      }

      if (payload.nextFollowUpAt && (!isCompleting || !userScheduledWait)) {
        return res.status(400).json({ error: "NEXT_FOLLOW_UP_AT_NOT_ALLOWED" })
      }
      if (userScheduledWait && isCompleting && !nextFollowUpDate) {
        return res.status(422).json({
          error: "NEXT_FOLLOW_UP_AT_REQUIRED",
          completionRequirement: {
            type: "NEXT_FOLLOW_UP_AT",
            actionId: userScheduledWait.actionId,
            prompt: userScheduledWait.prompt,
          },
        })
      }
      if (
        nextFollowUpDate &&
        (Number.isNaN(nextFollowUpDate.getTime()) || nextFollowUpDate.getTime() <= Date.now())
      ) {
        return res.status(422).json({ error: "INVALID_NEXT_FOLLOW_UP_AT" })
      }

      if (
        isReopenAction &&
        (existing.resolutionSource === "CONDITION_SKIPPED" ||
          existing.resolutionSource === "FLOW_SKIPPED")
      ) {
        return res.status(409).json({ error: "AUTO_SKIPPED_STEP_CANNOT_REOPEN" })
      }

      if (isReopenAction && !["COMPLETED", "SKIPPED", "POSTPONED"].includes(existing.status)) {
        return res.status(409).json({ error: "STEP_REOPEN_NOT_ALLOWED" })
      }

      if (isReopenAction) {
        const laterCompletedStep = await prismaWithServices.contactServiceFollowUpStep.findFirst({
          where: {
            tenantId,
            contactServiceId,
            sortOrder: { gt: existing.sortOrder },
            status: { in: ["COMPLETED", "SKIPPED"] },
          },
          select: { id: true },
        })

        if (laterCompletedStep) {
          return res.status(409).json({ error: "STEP_REOPEN_BLOCKED_BY_LATER_COMPLETED_STEPS" })
        }
      }

      if (
        ["COMPLETED", "SKIPPED"].includes(existing.status) &&
        !isReopenAction &&
        (payload.status !== undefined || payload.postponeTo !== undefined)
      ) {
        return res.status(409).json({ error: "STEP_REOPEN_REQUIRED" })
      }

      const statusUpdate =
        isReopenAction
          ? {
              status: "ACTIVE" as const,
              completedAt: null,
            }
          : payload.status === undefined
          ? payload.completedAt === undefined
            ? {}
            : payload.completedAt
              ? {
                  status: "COMPLETED" as const,
                  completedAt: new Date(payload.completedAt),
                }
              : {
                  status: existing.status === "SKIPPED" ? "SKIPPED" : "ACTIVE",
                  completedAt: null,
                }
          : payload.status === "COMPLETED"
            ? {
                status: "COMPLETED" as const,
                completedAt: payload.completedAt ? new Date(payload.completedAt) : new Date(),
              }
            : {
                status: payload.status,
                completedAt: null,
              }

      const postponeToDate = payload.postponeTo ? new Date(payload.postponeTo) : null
      if (payload.postponeTo && Number.isNaN(postponeToDate?.getTime() ?? NaN)) {
        return res.status(400).json({ error: "INVALID_POSTPONE_DATE" })
      }
      const requestedDueAt = postponeToDate ??
        (payload.dueAt !== undefined
          ? payload.dueAt
            ? new Date(payload.dueAt)
            : null
          : undefined)
      const dueAtChanged = requestedDueAt !== undefined &&
        (requestedDueAt?.getTime() ?? null) !== (existing.dueAt?.getTime() ?? null)

      let updated: any
      let v2RunToAdvanceId: string | null = null
      await prisma.$transaction(async (tx) => {
        const prismaTx = tx as any

        if (isReopenAction) {
          if (existing.runId && existing.templateNodeId) {
            const resetWait = await resetUserScheduledWaitForStepTx({
              prismaTx,
              runId: existing.runId,
              stepNodeId: existing.templateNodeId,
            })
            if (resetWait) {
              const contactServiceForLog = await prismaTx.contactService.findUnique({
                where: { id: contactServiceId },
                select: { contactId: true, followUpTemplateId: true },
              })
              if (contactServiceForLog?.followUpTemplateId) {
                await prismaTx.serviceFollowUpExecutionLog.create({
                  data: {
                    tenantId,
                    templateId: contactServiceForLog.followUpTemplateId,
                    templateVersionId: versionedRun?.templateVersionId ?? null,
                    contactServiceId,
                    contactId: contactServiceForLog.contactId,
                    actorUserId: authed.user.id,
                    flowNodeId: resetWait.actionId,
                    stepId: existing.id,
                    eventType: "MANUAL_WAIT_CANCELED",
                    title: "Canceled the scheduled next follow-up after reopening its source step.",
                  },
                })
              }
            }
          }
          await prismaTx.contactServiceFollowUpStep.updateMany({
            where: {
              tenantId,
              contactServiceId,
              id: { not: followUpStepId },
              status: "ACTIVE",
            },
            data: {
              status: "PENDING",
            },
          })

          await prismaTx.contactServiceFollowUpStep.updateMany({
            where: {
              tenantId,
              contactServiceId,
              sortOrder: { gt: existing.sortOrder },
              status: { in: ["PENDING", "ACTIVE", "POSTPONED"] },
            },
            data: {
              status: "PENDING",
            },
          })
        }

        if (!isReopenAction && statusUpdate.status === "ACTIVE") {
          await prismaTx.contactServiceFollowUpStep.updateMany({
            where: {
              tenantId,
              contactServiceId,
              id: { not: followUpStepId },
              status: "ACTIVE",
            },
            data: { status: "PENDING" },
          })
        }

        updated = await prismaTx.contactServiceFollowUpStep.update({
          where: {
            id: followUpStepId,
          },
          data: {
            ...(payload.title !== undefined ? { title: sanitizeSingleLineText(payload.title) } : {}),
            ...(payload.notesTemplate !== undefined
              ? {
                  notesTemplate:
                    payload.notesTemplate && payload.notesTemplate.trim().length
                      ? sanitizeMultilineText(payload.notesTemplate)
                      : null,
                }
              : {}),
            ...statusUpdate,
            ...(isReopenAction
              ? { resolutionSource: null, resolutionReason: null }
              : payload.status === "SKIPPED"
                ? { resolutionSource: "USER_SKIPPED" as const, resolutionReason: null }
                : payload.status === "COMPLETED" || Boolean(payload.completedAt)
                  ? { resolutionSource: "USER_COMPLETED" as const, resolutionReason: null }
                  : {}),
            ...(payload.availableAt !== undefined
              ? { availableAt: payload.availableAt ? new Date(payload.availableAt) : null }
              : {}),
            ...(requestedDueAt !== undefined ? { dueAt: requestedDueAt } : {}),
            ...(dueAtChanged
              ? { overdueNotifiedAt: null, overdueNotifiedDueAt: null }
              : {}),
            ...(payload.assignedToUserId !== undefined
              ? { assignedToUserId: payload.assignedToUserId || null }
              : {}),
            ...(payload.note !== undefined
              ? {
                  note:
                    payload.note && payload.note.trim().length
                      ? sanitizeMultilineText(payload.note)
                      : null,
                }
              : {}),
            ...(payload.sortOrder !== undefined ? { sortOrder: payload.sortOrder } : {}),
          },
          select: {
            id: true,
            title: true,
            notesTemplate: true,
            status: true,
            availableAt: true,
            dueAt: true,
            completedAt: true,
            assignedToUserId: true,
            note: true,
            sortOrder: true,
            templateNodeId: true,
            runId: true,
            resolutionSource: true,
            resolutionReason: true,
          },
        })

        const contactServiceRecord = await prismaTx.contactService.findUnique({
          where: { id: contactServiceId },
          select: {
            contactId: true,
            followUpTemplateId: true,
          },
        })

        if (
          contactServiceRecord?.followUpTemplateId &&
          (isReopenAction ||
            payload.status !== undefined ||
            payload.completedAt !== undefined ||
            payload.postponeTo !== undefined)
        ) {
          await prismaTx.serviceFollowUpExecutionLog.create({
            data: {
              tenantId,
              templateId: contactServiceRecord.followUpTemplateId,
              contactServiceId,
              contactId: contactServiceRecord.contactId,
              actorUserId: authed.user.id,
              flowNodeId: updated.templateNodeId ?? null,
              stepId: updated.id,
              eventType: "STEP_STATUS_UPDATED",
              title: isReopenAction ? `Reopened step: ${updated.title}` : `Updated step status: ${updated.title}`,
              details: isReopenAction
                ? "Step reopened and moved back to active."
                : `Step moved to ${updated.status.toLowerCase().replace(/_/g, " ")}.`,
              payload: {
                status: updated.status,
                dueAt: updated.dueAt,
                completedAt: updated.completedAt,
                postponeTo: payload.postponeTo ?? null,
                action: payload.action ?? null,
              },
            },
          })
        }

        if (updated.status === "ACTIVE") {
          await prismaTx.contactServiceFollowUpStep.updateMany({
            where: {
              tenantId,
              contactServiceId,
              id: { not: followUpStepId },
              status: "ACTIVE",
            },
            data: {
              status: "PENDING",
            },
          })
        }

        if (isReopenAction && existing.runId) {
          await prismaTx.contactServiceFollowUpRun.update({
            where: { id: existing.runId },
            data: {
              status: "AWAITING_STEP",
              cursorNodeId: existing.templateNodeId,
              activeStepId: followUpStepId,
              resumeAt: null,
              waitingNodeId: null,
              leaseToken: null,
              leaseExpiresAt: null,
              failureNodeId: null,
              failureCode: null,
              failureMessage: null,
              failedAt: null,
            },
          })
        }

        if (postponeToDate && existing.dueAt) {
          const shiftMs = postponeToDate.getTime() - existing.dueAt.getTime()
          const shouldCascade = payload.cascadeFutureSteps !== false

          if (shouldCascade && shiftMs !== 0) {
            const futureSteps = await prismaTx.contactServiceFollowUpStep.findMany({
              where: {
                tenantId,
                contactServiceId,
                sortOrder: { gt: existing.sortOrder },
                status: { in: ["PENDING", "ACTIVE"] },
              },
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              select: {
                id: true,
                dueAt: true,
                availableAt: true,
              },
            })

            for (const futureStep of futureSteps) {
              await prismaTx.contactServiceFollowUpStep.update({
                where: { id: futureStep.id },
                data: {
                  ...(futureStep.dueAt
                    ? { dueAt: new Date(futureStep.dueAt.getTime() + shiftMs) }
                    : {}),
                  ...(futureStep.availableAt
                    ? { availableAt: new Date(futureStep.availableAt.getTime() + shiftMs) }
                    : {}),
                  overdueNotifiedAt: null,
                  overdueNotifiedDueAt: null,
                },
              })
            }
          }
        }

        if (existing.runId && postponeToDate && existing.templateNodeId) {
          await postponeFollowUpRunStepTx({
            prismaTx,
            runId: existing.runId,
            stepNodeId: existing.templateNodeId,
            resumeAt: postponeToDate,
          })
        }

        if (
          existing.status === "ACTIVE" &&
          (updated.status === "COMPLETED" || updated.status === "SKIPPED")
        ) {
          if (existing.runId && existing.templateNodeId) {
            if (userScheduledWait) {
              await stageUserScheduledWaitInputTx({
                prismaTx,
                runId: existing.runId,
                stepNodeId: existing.templateNodeId,
                actorUserId: authed.user.id,
                scheduledFor: nextFollowUpDate,
                bypassed: isUserSkipping,
              })
            }
            await continueFollowUpRunFromStepTx({
              prismaTx,
              runId: existing.runId,
              stepNodeId: existing.templateNodeId,
            })
            v2RunToAdvanceId = existing.runId
          } else {
            await executeFollowUpFromStep({
              prismaTx,
              tenantId,
              contactServiceId,
              completedStepId: followUpStepId,
              completedStepSortOrder: existing.sortOrder,
              completedStepTemplateNodeId: existing.templateNodeId,
              actorUserId: authed.user.id,
              ignoreWaitNodes: false,
            })
            await syncContactServiceActiveStep({
              prismaTx,
              tenantId,
              contactServiceId,
            })
          }
        }

        if (
          isReopenAction ||
          payload.status !== undefined ||
          payload.completedAt !== undefined ||
          payload.postponeTo !== undefined
        ) {
          await reconcileContactServiceCompletionFromFollowUps(
            prismaTx,
            tenantId,
            contactServiceId,
            authed.user.id,
          )
        }
      })

      if (v2RunToAdvanceId) {
        await executeFollowUpRun({
          runId: v2RunToAdvanceId,
          actorUserId: authed.user.id,
        })
      }

      return res.json({
        ok: true,
        followUpStep: updated,
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.post(
  "/:tenantId/contact-services/:contactServiceId/follow-up-steps",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId } = TenantContactServicePathSchema.parse(req.params)
      const payload = CreateFollowUpStepSchema.parse(req.body)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      if (payload.assignedToUserId) {
        const assigneeMembership = await prisma.membership.findUnique({
          where: {
            userId_tenantId: {
              userId: payload.assignedToUserId,
              tenantId,
            },
          },
          select: {
            status: true,
          },
        })

        if (!assigneeMembership || assigneeMembership.status !== "ACTIVE") {
          return res.status(400).json({ error: "INVALID_ASSIGNEE" })
        }
      }

      const contactService = await prismaWithServices.contactService.findFirst({
        where: {
          id: contactServiceId,
          tenantId,
        },
        select: {
          id: true,
          followUpRun: { select: { id: true } },
        },
      })

      if (!contactService) {
        return res.status(404).json({ error: "CONTACT_SERVICE_NOT_FOUND" })
      }
      if (contactService.followUpRun) {
        return res.status(409).json({ error: "VERSIONED_FOLLOW_UP_STEPS_IMMUTABLE" })
      }

      const maxSortOrder = await prismaWithServices.contactServiceFollowUpStep.findFirst({
        where: {
          tenantId,
          contactServiceId,
        },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      })
      const hasActiveStep = await prismaWithServices.contactServiceFollowUpStep.findFirst({
        where: {
          tenantId,
          contactServiceId,
          status: "ACTIVE",
        },
        select: { id: true },
      })

      const nextStatus = payload.status ?? (hasActiveStep ? "PENDING" : "ACTIVE")
      if (nextStatus === "ACTIVE" && hasActiveStep) {
        return res.status(409).json({ error: "FOLLOW_UP_ALREADY_HAS_ACTIVE_STEP" })
      }
      const nextDueAt = payload.dueAt ? new Date(payload.dueAt) : null
      const nextAvailableAt =
        payload.availableAt !== undefined
          ? payload.availableAt
            ? new Date(payload.availableAt)
            : null
          : nextStatus === "ACTIVE"
            ? new Date()
            : nextDueAt

      const created = await prismaWithServices.contactServiceFollowUpStep.create({
        data: {
          tenantId,
          contactServiceId,
          title: sanitizeSingleLineText(payload.title),
          notesTemplate:
            payload.notesTemplate && payload.notesTemplate.trim().length
              ? sanitizeMultilineText(payload.notesTemplate)
              : null,
          status: nextStatus,
          availableAt: nextAvailableAt,
          dueAt: nextDueAt,
          completedAt: nextStatus === "COMPLETED" ? new Date() : null,
          assignedToUserId: payload.assignedToUserId || null,
          note:
            payload.note && payload.note.trim().length
              ? sanitizeMultilineText(payload.note)
              : null,
          sortOrder: payload.sortOrder ?? (maxSortOrder?.sortOrder ?? 0) + 10,
        },
        select: {
          id: true,
          title: true,
          notesTemplate: true,
          status: true,
          availableAt: true,
          dueAt: true,
          completedAt: true,
          assignedToUserId: true,
          note: true,
          sortOrder: true,
        },
      })

      return res.status(201).json({
        ok: true,
        followUpStep: created,
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.patch(
  "/:tenantId/contact-services/:contactServiceId/follow-up-run/next-follow-up",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId } = TenantContactServicePathSchema.parse(req.params)
      const payload = RescheduleNextFollowUpSchema.parse(req.body)
      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      const scheduledFor = new Date(payload.nextFollowUpAt)
      if (Number.isNaN(scheduledFor.getTime()) || scheduledFor.getTime() <= Date.now()) {
        return res.status(422).json({ error: "INVALID_NEXT_FOLLOW_UP_AT" })
      }

      const result = await prisma.$transaction(async (tx) => {
        const prismaTx = tx as any
        const run = await prismaTx.contactServiceFollowUpRun.findFirst({
          where: { tenantId, contactServiceId },
          include: {
            templateVersion: { select: { definition: true, templateId: true } },
            contactService: { select: { contactId: true, followUpTemplateId: true } },
          },
        })
        if (!run || run.status !== "WAITING" || !run.waitingNodeId) return null
        const wait = getUserScheduledWaitByActionId(
          run.templateVersion?.definition,
          run.waitingNodeId,
        )
        if (!wait) return null
        if (run.leaseToken) return { conflict: "FOLLOW_UP_WAIT_ALREADY_RESUMING" as const }

        const execution = await prismaTx.serviceFollowUpNodeExecution.findUnique({
          where: { runId_nodeId: { runId: run.id, nodeId: wait.actionId } },
          select: { input: true },
        })
        const previousInput =
          execution?.input && typeof execution.input === "object" && !Array.isArray(execution.input)
            ? execution.input
            : {}
        const previousScheduledFor = run.resumeAt
        const updated = await prismaTx.contactServiceFollowUpRun.updateMany({
          where: {
            id: run.id,
            status: "WAITING",
            waitingNodeId: wait.actionId,
            leaseToken: null,
          },
          data: { resumeAt: scheduledFor },
        })
        if (!updated.count) return { conflict: "FOLLOW_UP_WAIT_ALREADY_RESUMING" as const }
        await prismaTx.serviceFollowUpNodeExecution.update({
          where: { runId_nodeId: { runId: run.id, nodeId: wait.actionId } },
          data: {
            input: {
              ...previousInput,
              scheduledFor: scheduledFor.toISOString(),
              suppliedByUserId: authed.user.id,
              bypassed: false,
            },
            output: { scheduledFor: scheduledFor.toISOString() },
          },
        })
        const templateId = run.contactService.followUpTemplateId ?? run.templateVersion?.templateId
        if (templateId) {
          await prismaTx.serviceFollowUpExecutionLog.create({
            data: {
              tenantId,
              templateId,
              templateVersionId: run.templateVersionId,
              contactServiceId,
              contactId: run.contactService.contactId,
              actorUserId: authed.user.id,
              flowNodeId: wait.actionId,
              eventType: "MANUAL_WAIT_RESCHEDULED",
              title: `Next follow-up rescheduled for ${scheduledFor.toISOString()}`,
              payload: {
                previousScheduledFor,
                scheduledFor,
              },
            },
          })
        }
        return {
          manualWait: {
            actionId: wait.actionId,
            prompt: wait.prompt,
            scheduledFor,
            canReschedule: true,
            canContinueNow: true,
          },
        }
      })

      if (!result) {
        return res.status(409).json({ error: "FOLLOW_UP_RUN_NOT_MANUALLY_WAITING" })
      }
      if ("conflict" in result) {
        return res.status(409).json({ error: result.conflict })
      }
      return res.json({ ok: true, ...result })
    } catch (error) {
      return next(error)
    }
  },
)

router.post(
  "/:tenantId/contact-services/:contactServiceId/follow-up-run/continue-now",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId } = TenantContactServicePathSchema.parse(req.params)
      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      const claimed = await prisma.$transaction(async (tx) => {
        const prismaTx = tx as any
        const run = await prismaTx.contactServiceFollowUpRun.findFirst({
          where: { tenantId, contactServiceId },
          include: {
            templateVersion: { select: { definition: true, templateId: true } },
            contactService: { select: { contactId: true, followUpTemplateId: true } },
          },
        })
        if (!run || run.status !== "WAITING" || !run.waitingNodeId) return null
        const wait = getWorkflowWaitByActionId(
          run.templateVersion?.definition,
          run.waitingNodeId,
        )
        if (!wait) return null
        if (run.leaseToken) return { conflict: "FOLLOW_UP_WAIT_ALREADY_RESUMING" as const }

        const continuedEarlyAt = new Date()
        const leaseToken = randomUUID()
        const updated = await prismaTx.contactServiceFollowUpRun.updateMany({
          where: {
            id: run.id,
            status: "WAITING",
            waitingNodeId: wait.actionId,
            leaseToken: null,
          },
          data: {
            status: "RUNNING",
            leaseToken,
            leaseExpiresAt: new Date(continuedEarlyAt.getTime() + 60_000),
          },
        })
        if (!updated.count) return { conflict: "FOLLOW_UP_WAIT_ALREADY_RESUMING" as const }

        const execution = await prismaTx.serviceFollowUpNodeExecution.findUnique({
          where: { runId_nodeId: { runId: run.id, nodeId: wait.actionId } },
          select: { input: true },
        })
        const previousInput =
          execution?.input && typeof execution.input === "object" && !Array.isArray(execution.input)
            ? execution.input
            : {}
        await prismaTx.serviceFollowUpNodeExecution.update({
          where: { runId_nodeId: { runId: run.id, nodeId: wait.actionId } },
          data: {
            input: {
              ...previousInput,
              continuedEarlyAt: continuedEarlyAt.toISOString(),
              continuedEarlyByUserId: authed.user.id,
            },
          },
        })

        const templateId = run.contactService.followUpTemplateId ?? run.templateVersion?.templateId
        if (templateId) {
          await prismaTx.serviceFollowUpExecutionLog.create({
            data: {
              tenantId,
              templateId,
              templateVersionId: run.templateVersionId,
              contactServiceId,
              contactId: run.contactService.contactId,
              actorUserId: authed.user.id,
              flowNodeId: wait.actionId,
              eventType:
                wait.waitMode === "USER_SCHEDULED"
                  ? "MANUAL_WAIT_CONTINUED_EARLY"
                  : "DURATION_WAIT_CONTINUED_EARLY",
              title:
                wait.waitMode === "USER_SCHEDULED"
                  ? "Continued the user-scheduled follow-up early."
                  : "Continued the duration-based follow-up early.",
              payload: {
                scheduledFor: run.resumeAt,
                continuedEarlyAt,
              },
            },
          })
        }

        return { runId: run.id, leaseToken }
      })

      if (!claimed) {
        return res.status(409).json({ error: "FOLLOW_UP_RUN_NOT_MANUALLY_WAITING" })
      }
      if ("conflict" in claimed) {
        return res.status(409).json({ error: claimed.conflict })
      }

      const result = await executeFollowUpRun({
        runId: claimed.runId,
        actorUserId: authed.user.id,
        expectedLeaseToken: claimed.leaseToken,
      })
      if (result.status === "LEASE_LOST") {
        return res.status(409).json({ error: "FOLLOW_UP_WAIT_ALREADY_RESUMING" })
      }
      return res.json({ ok: true, result })
    } catch (error) {
      return next(error)
    }
  },
)

router.post(
  "/:tenantId/contact-services/:contactServiceId/follow-up-run/retry",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId } = TenantContactServicePathSchema.parse(req.params)
      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return
      if (membership.role !== "TENANT_ADMIN") {
        return res.status(403).json({ error: "TENANT_ADMIN_REQUIRED" })
      }
      const run = await prismaWithServices.contactServiceFollowUpRun.findFirst({
        where: { tenantId, contactServiceId },
        select: { id: true, status: true },
      })
      if (!run) return res.status(404).json({ error: "FOLLOW_UP_RUN_NOT_FOUND" })
      if (run.status !== "FAILED") {
        return res.status(409).json({ error: "FOLLOW_UP_RUN_NOT_RETRYABLE" })
      }
      const result = await retryFailedFollowUpRun({ runId: run.id, actorUserId: authed.user.id })
      if (result.status === "NOT_RETRYABLE") {
        return res.status(409).json({ error: "FOLLOW_UP_RUN_NOT_RETRYABLE" })
      }
      return res.json({ ok: result.status !== "FAILED", run: result })
    } catch (error) {
      return next(error)
    }
  },
)

router.delete(
  "/:tenantId/contact-services/:contactServiceId/follow-up-steps/:followUpStepId",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId, followUpStepId } = TenantFollowUpStepPathSchema.parse(
        req.params,
      )

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      const existing = await prismaWithServices.contactServiceFollowUpStep.findFirst({
        where: {
          id: followUpStepId,
          tenantId,
          contactServiceId,
        },
        select: {
          id: true,
        },
      })

      if (!existing) {
        return res.status(404).json({ error: "FOLLOW_UP_STEP_NOT_FOUND" })
      }

      await prismaWithServices.contactServiceFollowUpStep.delete({
        where: { id: followUpStepId },
      })

      return res.json({ ok: true })
    } catch (error) {
      return next(error)
    }
  },
)

export default router
