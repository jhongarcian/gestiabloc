import { createServiceBillingRouter } from "./service-billing.routes.js"
import { FinancialWriteSchema, FinancialReasonSchema, ServicePaymentTermsSchema, resolvePaymentSettings, summarizeServiceBilling, tenantDateOnly } from "../lib/service-billing.js"
import { billingAccountSelect, getBillingSummaryTx, replacePaymentPlanTx, replayFinancialWriteTx, saveFinancialChangeTx } from "../lib/service-billing-account.js"
import { previewServiceBilling } from "../lib/service-billing-preview.js"
import { lockSavedFollowUpEnrollment, patchSavedFollowUpTx, syncContactServiceActiveStep } from "../lib/service-saved-followups.js"
import { retiredTemplate, retiredTemplateVersion, retiredWorkflowSummary } from "../lib/service-retired-workflows.js"
import { serviceScopeWhere, offeringSteps, enrolledStepProgress, unfinishedServiceWorkWhere } from "../lib/service-presentation.js"
import { mutateServicePaymentTx } from "../lib/service-payment-mutations.js"
import { captureServiceAutomationsTx } from "../lib/service-automation-snapshots.js"
import { previewServiceConfigurationTx, applyServiceConfigurationTx } from "../lib/service-configuration-review.js"
import { emitServiceAutomationEventTx } from "../lib/service-automation-events.js"
import { mutateEnrolledServiceTx, lockServiceActionEnrollment } from "../lib/service-automation-actions.js"
import { getServiceFollowUpQueue } from "../lib/service-followup-queue.js"
import { changeServiceStepDeadlineTx, ChangeServiceStepDeadlineSchema } from "../lib/service-step-deadlines.js"
import { enforceSameOrigin } from "../lib/security.js"
import { moveServiceStepTx, MoveServiceStepSchema } from "../lib/service-step-movement.js"
import { kickAutomationRunWorker } from "../lib/opportunity-automations.js"
import { queueOpportunityAutomationEvent } from "../lib/automation-event-queue.js"
import { getServiceStepCompletionWaits, changeServiceStepCompletionWaitTx, ContinueServiceStepWaitSchema, RescheduleServiceStepWaitSchema } from "../lib/service-step-waits.js"
import { completeServiceStepOccurrenceTx, reconcileServiceStepEnrollmentTx } from "../lib/service-step-progression.js"
import { createServiceStepOccurrenceTx, enrolledServiceStepsSelect } from "../lib/service-steps.js"
import { captureEnrollmentConfiguration, readEnrollmentConfiguration, readProfessionalSnapshot,
  professionalSnapshot, enrollmentProfessionalOptions, enrolledChecklistSnapshotSelect,
  serializeEnrolledChecklistItem } from "../lib/service-enrollment-snapshots.js"
import {
  serviceConfigurationSelect,
  resolveServiceConfiguration,
  loadEffectiveServiceConfiguration,
  lockServiceHierarchyTx,
  pickBilling,
  readBillingSnapshot,
} from "../lib/service-configuration-inheritance.js"
import { assertServiceEnrollableTx, enrollableServiceWhere } from "../lib/service-hierarchy.js"
import { ServiceCollectionError } from "../lib/service-configuration-collections.js"
import { randomUUID } from "node:crypto"

import { type Response, Router } from "express"
import { z } from "zod"

import { Prisma } from "../generated/prisma/index.js"

import { decryptCustomFieldValue } from "../lib/contact-custom-field-encryption.js"
import {
  ContactServiceNotesQuerySchema,
  canManageContactServiceNote,
  compareContactServiceNotes,
  getContactServiceNotesPage,
  resolveContactServiceNoteAttachmentChanges,
  resolveContactServiceNoteKind,
  type ContactServiceNoteSort,
} from "../lib/contact-service-notes.js"
import { canManageContactServices } from "../lib/contact-service-permissions.js"
import { resolveServiceProfessionalChange } from "../lib/contact-service-professional.js"
import {
  buildContactServiceChecklistActivityData,
  CONTACT_SERVICE_CHECKLIST_STATUSES,
  hasExactlyOneChecklistStatusInput,
  resolveContactServiceChecklistStatus,
  resolveContactServiceChecklistTransition,
} from "../lib/contact-service-checklist-status.js"
import {
  sanitizeNoteTitle,
  sanitizeNoteBody,
  NoteBodyInputSchema,
  NoteTitleInputSchema,
} from "../lib/note-inputs.js"
import { prisma } from "../lib/prisma.js"
import { deletePrivateObject } from "../lib/private-storage.js"
import { generateServiceFitExplanation } from "../lib/service-fit-explanations.js"
import { createContactAssistantRouter } from "./contact-assistant.routes.js"
import { buildContactAssistantContext } from "../lib/contact-assistant-context.js"
import {
  buildServiceFitFieldCatalog,
  evaluateServiceFitProfile,
  normalizeServiceFitProfile,
  sortServiceFitEvaluations,
  validateServiceFitProfile,
} from "../lib/service-fit.js"
import {
  canCompleteFollowUpStepNow,
  resolveEffectiveNextFollowUp,
  serializeEffectiveNextFollowUp,
} from "../lib/service-followup-next-follow-up.js"
import {
  SERVICE_FOLLOW_UP_SEARCH_MAX_LENGTH,
  ServiceFollowUpSortSchema,
  sanitizeServiceFollowUpSearch,
} from "../lib/service-followup-register.js"
import {
  SERVICE_TRANSACTION_SEARCH_MAX_LENGTH,
  ServiceTransactionAmountCentsSchema,
  ServiceTransactionDateOnlySchema,
  ServiceTransactionIdSchema,
  ServiceTransactionNotesSchema,
  ServiceTransactionPaymentNoteSchema,
  ServiceTransactionPositiveAmountCentsSchema,
  ServiceTransactionSortSchema,
  getServiceTransactionContactName,
  getServiceTransactionFinancials,
  sanitizeServiceTransactionSearch,
} from "../lib/service-transactions.js"
import {
  ServiceEnrollmentsListQuerySchema,
  getLatestServiceEnrollmentActivityAt,
  getServiceEnrollmentContactName,
} from "../lib/service-enrollments.js"
import {
  buildFollowUpStepResolutionUpdate,
} from "../lib/service-followup-ownership.js"
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js"

const router = Router()
router.use(createServiceBillingRouter(requireActiveMembership))
router.use(createContactAssistantRouter({ requireMembership: requireActiveMembership, evaluate: evaluateServiceFitScan }))
const prismaWithServices = prisma as any

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
const getServiceNoteOrderBy = (sort: ContactServiceNoteSort) => {
  if (sort === "created_desc") {
    return [{ createdAt: "desc" as const }, { id: "asc" as const }]
  }
  if (sort === "updated_asc") {
    return [
      { updatedAt: "asc" as const },
      { createdAt: "desc" as const },
      { id: "asc" as const },
    ]
  }
  return [
    { updatedAt: "desc" as const },
    { createdAt: "desc" as const },
    { id: "asc" as const },
  ]
}

const serializePaginatedServiceNote = (
  note: {
    id: string
    title: string
    body: string
    createdById: string
    createdAt: Date
    updatedAt: Date
    createdBy?: {
      id: string
      name: string | null
      email: string | null
      image?: string | null
    } | null
    retiredWorkflowSnapshot?: unknown
    contactServiceFollowUpStep?: { title: string } | null
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
  viewer: { membership: { role: string }; userId: string },
) => ({
  id: note.id,
  kind,
  title: note.title,
  body: note.body,
  createdAt: note.createdAt,
  updatedAt: note.updatedAt,
  author: note.createdBy
    ? {
      id: note.createdBy.id,
      name:
        note.createdBy.name?.trim() ||
        note.createdBy.email?.trim() ||
        "Unknown user",
      email: note.createdBy.email,
      image: note.createdBy.image ?? null,
    }
    : null,
  followUpTemplateName: retiredTemplate(note.retiredWorkflowSnapshot)?.name ?? null,
  followUpStepTitle: note.contactServiceFollowUpStep?.title ?? null,
  permissions: {
    canEdit: canManageContactServiceNote(
      viewer.membership,
      note.createdById,
      viewer.userId,
    ),
    canDelete: canManageContactServiceNote(
      viewer.membership,
      note.createdById,
      viewer.userId,
    ),
  },
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

const TenantContactServiceNotePathSchema = TenantContactServicePathSchema.extend({
  noteId: z.string().trim().min(1),
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
  readOnly: z.enum(["true", "false"]).default("false"),
})

const FitScanQuerySchema = z.object({
  contactId: z.string().trim().min(1),
  serviceId: z.string().trim().min(1).optional(),
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

const ServiceTransactionsRangePresetSchema = z.enum([
  "ALL_TIME",
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
  ServiceTransactionDateOnlySchema.optional(),
)

const ServicesCatalogSummaryQuerySchema = z
  .object({
    serviceGroupId: ServiceTransactionIdSchema.optional(),
    serviceId: ServiceTransactionIdSchema.optional(),
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

const ServiceTransactionsListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .refine((value) => value === 10 || value === 25, {
        message: "pageSize must be 10 or 25",
      })
      .default(10),
    search: z.preprocess(
      (value) =>
        typeof value === "string" ? sanitizeServiceTransactionSearch(value) : value,
      z.string().max(SERVICE_TRANSACTION_SEARCH_MAX_LENGTH).optional(),
    ),
    paymentFilter: z.enum(["ALL", "BALANCE_DUE", "DUE_TODAY", "OVERDUE", "PAID", "NEEDS_REVIEW"]).default("ALL"),
    sort: ServiceTransactionSortSchema.default("PURCHASED_DESC"),
    serviceGroupId: ServiceTransactionIdSchema.optional(),
    serviceId: ServiceTransactionIdSchema.optional(),
    status: ContactServiceStatusSchema.optional(),
    rangePreset: ServiceTransactionsRangePresetSchema.default("ALL_TIME"),
    from: OptionalDateOnlySchema,
    to: OptionalDateOnlySchema,
  })
  .superRefine((value, ctx) => {
    if (value.rangePreset !== "CUSTOM") return

    if (!value.from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["from"],
        message: "from is required when rangePreset is CUSTOM",
      })
    }

    if (!value.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "to is required when rangePreset is CUSTOM",
      })
    }
  })

const FollowUpsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((value) => value === 10 || value === 25, {
      message: "pageSize must be 10 or 25",
    })
    .default(10),
  search: z.preprocess(
    (value) =>
      typeof value === "string" ? sanitizeServiceFollowUpSearch(value) : value,
    z.string().max(SERVICE_FOLLOW_UP_SEARCH_MAX_LENGTH).optional(),
  ),
  sort: ServiceFollowUpSortSchema.or(z.literal("URGENCY")).default("URGENCY"),
  queueState: z.enum(["ACTIONABLE", "SCHEDULED", "NEEDS_ATTENTION", "FINISHED"]).optional(),
  status: z
    .enum(["PENDING", "ACTIVE", "COMPLETED", "SKIPPED", "POSTPONED"])
    .optional(),
  dueDatePreset: z
    .enum(["OVERDUE", "DUE_SOON", "TODAY", "NEXT_7_DAYS", "NO_DUE_DATE"])
    .optional(),
  serviceGroupId: ServiceTransactionIdSchema.optional(),
  serviceId: ServiceTransactionIdSchema.optional(),
  assignedToUserId: ServiceTransactionIdSchema.optional(),
})

const CreateContactServiceSchema = z
  .object({
    contactId: ServiceTransactionIdSchema,
    serviceId: ServiceTransactionIdSchema,
    workflowKind: z.literal("SERVICE_STEPS").default("SERVICE_STEPS"),
    followUpAssignedToUserId: ServiceTransactionIdSchema.optional(),
    assignedProfessionalId: ServiceTransactionIdSchema.optional(),
    purchasedAt: z.string().datetime().nullable().optional(),
    startedAt: z.string().datetime().nullable().optional(),
    notes: ServiceTransactionNotesSchema,
    initialPaymentCents: ServiceTransactionAmountCentsSchema.optional(),
    paymentTerms: ServicePaymentTermsSchema.optional(),
    initialPaymentMethod: z.enum(["CASH", "CARD", "CHECK", "TRANSFER", "ACH"]).nullable().optional(),
    initialPaymentNote: ServiceTransactionPaymentNoteSchema,
    configurationVersion: z.string().length(64),
    requestKey: z.uuid(),
  })
  .strict()

const ServiceTransactionPaymentMethodSchema = z.enum([
  "CASH",
  "CARD",
  "CHECK",
  "TRANSFER",
  "ACH",
])

const CreateContactServicePaymentSchema = z
  .object({
    ...FinancialWriteSchema.shape,
    amountCents: ServiceTransactionPositiveAmountCentsSchema,
    paidAt: z.string().datetime().optional(),
    paymentMethod: ServiceTransactionPaymentMethodSchema.nullable().optional(),
    note: ServiceTransactionPaymentNoteSchema,
  })
  .strict()

const UpdateContactServicePaymentSchema = z
  .object({
    ...FinancialWriteSchema.shape,
    reason: FinancialReasonSchema,
    amountCents: ServiceTransactionPositiveAmountCentsSchema.optional(),
    paidAt: z.string().datetime().optional(),
    paymentMethod: ServiceTransactionPaymentMethodSchema.nullable().optional(),
    note: ServiceTransactionPaymentNoteSchema,
  })
  .strict()

const UpdateContactServiceSchema = z
  .object({
    status: ContactServiceStatusSchema.optional(),
    startedAt: z.string().datetime().nullable().optional(),
    purchasedAt: z.string().datetime().nullable().optional(),
    completedAt: z.string().datetime().nullable().optional(),
    canceledAt: z.string().datetime().nullable().optional(),
    notes: ServiceTransactionNotesSchema,
    assignedProfessionalId: ServiceTransactionIdSchema.nullable().optional(),
  })
  .strict()

const UpdateFollowUpCoordinatorSchema = z.object({
  assignedToUserId: z.string().trim().min(1).nullable(),
})

const ContactServiceNoteAttachmentIdsSchema = z
  .array(z.string().trim().min(1))
  .max(10)
  .default([])

const CreateContactServiceNoteSchema = z.object({
  title: NoteTitleInputSchema,
  body: NoteBodyInputSchema,
  attachmentFileIds: ContactServiceNoteAttachmentIdsSchema,
})

const UpdateContactServiceNoteSchema = CreateContactServiceNoteSchema

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

async function deleteServiceNoteFilesIfUnreferenced(fileIds: string[]) {
  const uniqueFileIds = [...new Set(fileIds)]
  if (uniqueFileIds.length === 0) return

  const [serviceAttachments, contactAttachments] = await Promise.all([
    prismaWithServices.contactServiceNoteAttachment.findMany({
      where: { fileId: { in: uniqueFileIds } },
      select: { fileId: true },
    }),
    prismaWithServices.contactNoteAttachment.findMany({
      where: { fileId: { in: uniqueFileIds } },
      select: { fileId: true },
    }),
  ])
  const referencedFileIds = new Set<string>([
    ...serviceAttachments.map((attachment: { fileId: string }) => attachment.fileId),
    ...contactAttachments.map((attachment: { fileId: string }) => attachment.fileId),
  ])
  const orphanFileIds = uniqueFileIds.filter((fileId) => !referencedFileIds.has(fileId))
  if (orphanFileIds.length === 0) return

  const orphanFiles = await prisma.file.findMany({
    where: { id: { in: orphanFileIds } },
    select: { id: true, key: true },
  })
  if (orphanFiles.length === 0) return

  await prisma.file.deleteMany({
    where: { id: { in: orphanFiles.map((file) => file.id) } },
  })
  await Promise.all(
    orphanFiles.map((file) =>
      deletePrivateObject({ path: file.key }).catch(() => undefined),
    ),
  )
}

const UpdateFollowUpStepSchema = z.object({
  title: z.string().trim().min(1).max(200).transform(sanitizeNoteTitle).pipe(z.string().min(1).max(200)).optional(),
  notesTemplate: z.string().trim().max(1000).transform(value => sanitizeNoteBody(value) || null).nullable().optional(),
  status: z.enum(["PENDING", "ACTIVE", "COMPLETED", "SKIPPED", "POSTPONED"]).optional(),
  action: z.enum(["REOPEN"]).optional(),
  availableAt: z.string().datetime().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  postponeTo: z.string().datetime().optional(),
  cascadeFutureSteps: z.boolean().optional(),
  completedAt: z.string().datetime().nullable().optional(),
  assignedToUserId: z.string().trim().min(1).nullable().optional(),
  note: z.string().trim().max(2000).transform(value => sanitizeNoteBody(value) || null).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
}).strict()


const CreateFollowUpStepSchema = z.object({
  title: z.string().trim().min(1).max(200).transform(sanitizeNoteTitle).pipe(z.string().min(1).max(200)),
  notesTemplate: z.string().trim().max(1000).transform(value => sanitizeNoteBody(value) || null).nullable().optional(),
  status: z.enum(["PENDING", "ACTIVE", "COMPLETED", "SKIPPED", "POSTPONED"]).optional(),
  availableAt: z.string().datetime().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  assignedToUserId: z.string().trim().min(1).nullable().optional(),
  note: z.string().trim().max(2000).transform(value => sanitizeNoteBody(value) || null).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
}).strict()

const UpdateContactServiceChecklistItemSchema = z
  .object({
    status: z.enum(CONTACT_SERVICE_CHECKLIST_STATUSES).optional(),
    completed: z.boolean().optional(),
  })
  .superRefine((payload, context) => {
    if (!hasExactlyOneChecklistStatusInput(payload)) {
      context.addIssue({
        code: "custom",
        path: [payload.status !== undefined ? "completed" : "status"],
        message: "Provide exactly one of status or completed.",
      })
    }
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

const DEFAULT_TIMEZONE = "America/Chicago"

function getSafeTimezone(timezone?: string | null) {
  return timezone?.trim() || DEFAULT_TIMEZONE
}

function resolveSavedFollowUpState(item: any) {
  return { effectiveNextFollowUp: resolveEffectiveNextFollowUp({ steps: item.followUpSteps ?? [] }) }
}

function serializeSavedFollowUpMetadata(item: any, _timezone: string) {
  const effective = resolveSavedFollowUpState(item).effectiveNextFollowUp
  const first = (item.followUpSteps ?? []).find((step: any) => !["COMPLETED", "SKIPPED"].includes(step.status))
  return {
    nextFollowUp: serializeEffectiveNextFollowUp(effective),
    followUpTemplate: retiredTemplate(item.retiredWorkflowSnapshot),
    followUpTemplateVersion: retiredTemplateVersion(item.retiredWorkflowSnapshot),
    retiredWorkflow: retiredWorkflowSummary(item.retiredWorkflowSnapshot),
    followUpSteps: (item.followUpSteps ?? []).map((step: any) => ({
      ...step,
      effectiveDueAt: effective && effective.stepId === step.id ? effective.at : step.dueAt ?? null,
      effectiveDueSource: effective && effective.stepId === step.id ? effective.source : step.dueAt ? "STEP_DUE" : null,
      canCompleteNow: canCompleteFollowUpStepNow({ step, firstUnresolvedStepId: first?.id ?? null }),
    })),
  }
}

const contactServiceWorkspaceBaseSelect = {
  ...billingAccountSelect,
  id: true,
  tenantId: true,
  workflowKind: true,
  configurationSnapshot: true,
  assignedProfessionalSnapshot: true,
  serviceSteps: enrolledServiceStepsSelect,
  stepMovements: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  contactId: true,
  status: true,
  startedAt: true,
  purchasedAt: true,
  completedAt: true,
  canceledAt: true,
  totalPriceCents: true,
  billingSnapshot: true,
  currency: true,
  allowPartialPayments: true,
  notes: true,
  followUpCoordinatorUserId: true,
  followUpCoordinator: {
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
    },
  },
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
      ...serviceConfigurationSelect,
      id: true,
      name: true,
      description: true,
      basePriceCents: true,
      isTaxExempt: true,
      minimumPartialPaymentCents: true,
      installmentCount: true,
      installmentFrequency: true,
      professionals: {
        where: { archivedAt: null },
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
      tenant: {
        select: {
          taxEnabled: true,
          taxLabel: true,
          defaultTaxRateBps: true,
          timezone: true,
        },
      },
    },
  },
  retiredWorkflowSnapshot: true
} as const

async function resolveEnrollmentConfiguration(item: any) {
  const effective = resolveServiceConfiguration(item.service)
  const billing = readBillingSnapshot(item.billingSnapshot)
  const configuration = readEnrollmentConfiguration(item.configurationSnapshot)
  const attribution = readProfessionalSnapshot(item.assignedProfessionalSnapshot)
  const professionals = await enrollmentProfessionalOptions(prisma, item.tenantId, item.configurationSnapshot, effective.professionals)
  return {
    ...item,
    assignedProfessional: attribution?.id === item.assignedProfessional?.id ? attribution : item.assignedProfessional,
    service: {
      ...effective,
      ...(configuration ? { name: configuration.service.name, description: configuration.service.description } : {}),
      professionals,
      ...(billing ? pickBilling(billing) : {}),
      tenant: {
        ...item.service.tenant,
        ...(billing
          ? {
            taxEnabled: billing.taxEnabled,
            taxLabel: billing.taxLabel,
            defaultTaxRateBps: billing.defaultTaxRateBps,
          }
          : {}),
      },
    },
  }
}

async function serializeContactServiceWorkspaceBase(item: any, paidCents: number) {
  item = await resolveEnrollmentConfiguration(item)
  return {
    id: item.id,
    workflowKind: item.workflowKind,
    retiredWorkflow: retiredWorkflowSummary(item.retiredWorkflowSnapshot),
    followUpTemplate: retiredTemplate(item.retiredWorkflowSnapshot),
    serviceSteps: item.serviceSteps ?? [],
    stepMovements: item.stepMovements ?? [],
    configurationSnapshot: item.configurationSnapshot,
    contactId: item.contactId,
    status: item.status,
    startedAt: item.startedAt,
    purchasedAt: item.purchasedAt,
    completedAt: item.completedAt,
    canceledAt: item.canceledAt,
    billing: summarizeServiceBilling({ ...item, dues: item.paymentDues ?? [], paidCents, timezone: getSafeTimezone(item.service.tenant.timezone), today: tenantDateOnly(getSafeTimezone(item.service.tenant.timezone)) }),
    totalPriceCents: item.totalPriceCents,
    paidCents,
    remainingCents: Math.max(0, item.totalPriceCents - paidCents),
    currency: item.currency,
    allowPartialPayments: item.allowPartialPayments,
    notes: item.notes,
    timezone: getSafeTimezone(item.service.tenant.timezone),
    followUpCoordinatorUserId: item.followUpCoordinatorUserId,
    followUpCoordinator: item.followUpCoordinator,
    assignedProfessional: item.assignedProfessional,
    contactName: [item.contact?.firstName, item.contact?.middleName, item.contact?.lastName]
      .filter(Boolean)
      .join(" "),
    service: {
      id: item.service.id,
      name: item.service.name,
      parentService: item.service.parentService,
      description: item.service.description,
      basePriceCents: item.service.basePriceCents,
      isTaxExempt: item.service.isTaxExempt,
      minimumPartialPaymentCents: item.service.minimumPartialPaymentCents,
      installmentCount: item.service.installmentCount,
      installmentFrequency: item.service.installmentFrequency,
      paymentSettings: resolvePaymentSettings(item.service),
      professionals: item.service.professionals,
    },
    tenantBilling: {
      taxEnabled: item.service.tenant.taxEnabled,
      taxLabel: item.service.tenant.taxLabel,
      defaultTaxRatePercent:
        item.service.tenant.defaultTaxRateBps !== null &&
          item.service.tenant.defaultTaxRateBps !== undefined
          ? item.service.tenant.defaultTaxRateBps / 100
          : null,
    }
  }
}

function serializeContactServiceListFollowUpMetadata(item: any) {
  if (item.workflowKind === "SERVICE_STEPS") {
    const current = (item.serviceSteps ?? []).flatMap((step: any) => step.occurrences.filter((entry: any) => !entry.supersededAt && entry.status === "ACTIVE").map((entry: any) => ({ step, entry })))[0]
    return { nextFollowUp: current ? { at: current.entry.dueAt, stepId: current.step.id, source: "STEP_DUE", projected: false } : null, followUpSteps: [] }
  }
  return serializeSavedFollowUpMetadata(item, "UTC")
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

function getServiceTransactionsRange(
  query: z.infer<typeof ServiceTransactionsListQuerySchema>,
  timezone: string,
) {
  if (query.rangePreset === "ALL_TIME") return null

  return getServicesCatalogSummaryRange(
    {
      preset: query.rangePreset,
      from: query.from,
      to: query.to,
    },
    timezone,
  )
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
        isEncrypted: true,
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
  const assistantValuesByKey: Record<string, unknown> = {}
  const restrictedCustomKeys = new Set<string>(customFields.filter((field: any) => field.isEncrypted).map((field: any) => field.key))
  for (const item of customFieldValues as Array<any>) {
    const key = fieldKeyById.get(item.fieldId)
    if (!key) continue
    customFieldValuesByKey[key] = decodeCustomFieldValue(item)
    if (restrictedCustomKeys.has(key) || item.valueCiphertext || item.valueIv || item.valueAuthTag) {
      restrictedCustomKeys.add(key)
      delete assistantValuesByKey[key]
    }
    else assistantValuesByKey[key] = item.value
  }

  const snapshot = {
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
  return { ...snapshot, assistantSnapshot: { ...snapshot, customFieldValues: assistantValuesByKey }, restrictedCustomKeys: [...restrictedCustomKeys] }
}

export async function evaluateServiceFitScan(params: {
  tenantId: string
  contactId: string
  serviceId?: string
  fitProfileOverrideByServiceId?: Record<string, unknown>
  explainWithAi?: boolean
  includeContactContext?: boolean
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
        ...enrollableServiceWhere,
        tenantId,
        isActive: true,
        ...(serviceId ? { id: serviceId } : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        parentService: { select: { id: true, name: true } },
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
        serviceGroupId: service.parentService?.id ?? null,
        serviceGroupName: service.parentService?.name ?? null,
        description: service.description ?? null,
        fitProfile: profile,
        ...enrollmentSummary,
        purchaseCount: (contactServicesByServiceId.get(service.id) ?? []).length,
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
      }, params.explainWithAi === false ? null : undefined)

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
    ...(params.includeContactContext ? { contactContext: buildContactAssistantContext({
      contact: contact.assistantSnapshot, restrictedCustomKeys: contact.restrictedCustomKeys,
      catalog, items: itemsWithExplanations, timezone,
      skills: services.map((service: any) => ({ serviceId: service.id, serviceName: service.name })),
    }) } : {}),
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
      workflowKind: true,
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

  if (contactService?.workflowKind === "SERVICE_STEPS") return reconcileServiceStepEnrollmentTx(prismaTx, tenantId, contactServiceId)

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

  const paymentSummary = await getBillingSummaryTx(
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

router.get("/:tenantId/configuration-updates/:serviceId/enrollments", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId, serviceId } = z.object({ tenantId: z.uuid(), serviceId: z.uuid() }).parse(req.params)
    const { cursor } = z.object({ cursor: z.uuid().optional() }).parse(req.query)
    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return
    if (membership.role !== "TENANT_ADMIN") return res.status(403).json({ error: "TENANT_ADMIN_REQUIRED" })
    const service = await prisma.service.findFirst({ where: { tenantId, id: serviceId }, select: { kind: true } })
    if (!service) return res.status(404).json({ error: "SERVICE_NOT_FOUND" })
    const items = await prisma.contactService.findMany({
      where: { tenantId, workflowKind: "SERVICE_STEPS", status: { in: ["IN_PROGRESS", "PENDING_PAYMENT"] }, ...(cursor ? { id: { gt: cursor } } : {}),
        ...(service.kind === "GROUP" ? { service: { parentServiceId: serviceId } } : { serviceId }) },
      orderBy: { id: "asc" }, take: 21,
      select: { id: true, serviceId: true, service: { select: { name: true } }, contact: { select: { firstName: true, lastName: true } },
        configurationChanges: { where: { appliedAt: { not: null } }, orderBy: { appliedAt: "desc" }, take: 1, select: { appliedAt: true, appliedByName: true } } },
    })
    return res.json({ ok: true, items: items.slice(0, 20).map(item => ({ id: item.id, serviceId: item.serviceId, serviceName: item.service.name,
        contactName: [item.contact.firstName, item.contact.lastName].filter(Boolean).join(" ") || "Contact", lastApplied: item.configurationChanges[0] ?? null })), nextCursor: items.length > 20 ? items[19]!.id : null })
  } catch (error) { return next(error) }
})

router.post("/:tenantId/contact-services/:contactServiceId/configuration-preview", requireAuth, async (req, res, next) => {
  try {
    enforceSameOrigin(req)
    const authed = req as AuthedRequest
    const path = TenantContactServicePathSchema.parse(req.params)
    const membership = await requireActiveMembership(authed, res, path.tenantId)
    if (!membership) return
    if (membership.role !== "TENANT_ADMIN") return res.status(403).json({ error: "TENANT_ADMIN_REQUIRED" })
    const preview = await prisma.$transaction(tx => previewServiceConfigurationTx(tx, path), { timeout: 15000 })
    return res.json({ ok: true, preview })
  } catch (error) {
    if (error instanceof ServiceCollectionError) return res.status(error.status).json({ error: error.code })
    return next(error)
  }
})

router.post("/:tenantId/contact-services/:contactServiceId/configuration-apply", requireAuth, async (req, res, next) => {
  try {
    enforceSameOrigin(req)
    const authed = req as AuthedRequest
    const path = TenantContactServicePathSchema.parse(req.params)
    const payload = z.object({ previewId: z.uuid() }).strict().parse(req.body)
    const membership = await requireActiveMembership(authed, res, path.tenantId)
    if (!membership) return
    if (membership.role !== "TENANT_ADMIN") return res.status(403).json({ error: "TENANT_ADMIN_REQUIRED" })
    const result = await prisma.$transaction(tx => applyServiceConfigurationTx(tx, { ...path, ...payload, actorUserId: authed.user.id, actorName: authed.user.name ?? authed.user.email }), { timeout: 15000 })
    return res.json({ ok: true, ...result })
  } catch (error) {
    if (error instanceof ServiceCollectionError) return res.status(error.status).json({ error: error.code })
    return next(error)
  }
})

router.get("/:tenantId/contact-services/:contactServiceId/configuration-history", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const path = TenantContactServicePathSchema.parse(req.params)
    const membership = await requireActiveMembership(authed, res, path.tenantId)
    if (!membership) return
    if (membership.role !== "TENANT_ADMIN") return res.status(403).json({ error: "TENANT_ADMIN_REQUIRED" })
    const items = await prisma.contactServiceConfigurationChange.findMany({ where: { ...path, appliedAt: { not: null } }, orderBy: { appliedAt: "desc" }, take: 20,
      select: { id: true, appliedAt: true, appliedByName: true, preview: true } })
    return res.json({ ok: true, items })
  } catch (error) { return next(error) }
})

router.get("/:tenantId/options", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const { includeInactive } = z.object({ includeInactive: z.enum(["true", "false"]).optional() }).parse(req.query)
    const items = await prismaWithServices.service.findMany({
      where: {
        tenantId,
        ...(includeInactive === "true" ? { kind: "OFFERING" as const } : enrollableServiceWhere),
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        kind: true,
        isActive: true,
        parentServiceId: true,
        parentService: { select: { id: true, name: true, isActive: true } },
      },
    })

    return res.json({ ok: true, items })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId/catalog", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const query = z.object({ page: z.coerce.number().int().min(1).max(1000000).default(1), pageSize: z.coerce.number().refine(value => value === 10 || value === 25).default(10), search: z.string().trim().max(200).optional(), serviceGroupId: z.uuid().optional(), serviceId: z.uuid().optional() }).parse(req.query)
    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return
    const where: Prisma.ServiceWhereInput = { tenantId, ...enrollableServiceWhere, ...(query.serviceId ? { id: query.serviceId } : {}), ...(query.serviceGroupId ? { parentServiceId: query.serviceGroupId } : {}),
      ...(query.search ? { OR: [{ name: { contains: query.search, mode: "insensitive" } }, { description: { contains: query.search, mode: "insensitive" } }, { parentService: { name: { contains: query.search, mode: "insensitive" } } }] } : {}) }
    const [total, rows] = await prisma.$transaction([prisma.service.count({ where }), prisma.service.findMany({ where, orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize, select: { ...serviceConfigurationSelect, isActive: true, sortOrder: true } })])
    return res.json({ ok: true, items: rows.map(row => { const service = resolveServiceConfiguration(row); return {
          ...service,
          steps: offeringSteps(service.steps, service.id)
        } }), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) } })
  } catch (error) { return next(error) }
})

router.get("/:tenantId/catalog/:serviceId", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId, serviceId } = TenantServicePathSchema.parse(req.params)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    let service = await prismaWithServices.service.findFirst({
      where: {
        ...enrollableServiceWhere,
        id: serviceId,
        tenantId,
        isActive: true,
      },
      select: {
        ...serviceConfigurationSelect,
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
          where: { archivedAt: null },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            label: true,
            description: true,
            isRequired: true,
            sortOrder: true,
          },
        },
        professionals: {
          where: { archivedAt: null },
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
        }
      },
    })

    if (!service) {
      return res.status(404).json({ error: "SERVICE_NOT_FOUND" })
    }

    service = resolveServiceConfiguration(service)
    return res.json({
      ok: true,
      service: {
        id: service.id,
        name: service.name,
        parentServiceId: service.parentServiceId,
        parentService: service.parentService,
        description: service.description,
        basePriceCents: service.basePriceCents,
        currency: service.currency,
        isTaxExempt: service.isTaxExempt,
        allowPartialPayments: service.allowPartialPayments,
        minimumPartialPaymentCents: service.minimumPartialPaymentCents,
        installmentCount: service.installmentCount,
        installmentFrequency: service.installmentFrequency,
        paymentSettings: resolvePaymentSettings(service),
        isActive: service.isActive,
        checklistItems: service.checklistItems,
        steps: offeringSteps(service.steps, service.id),
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
        }
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
    const scope = serviceScopeWhere(query)
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
            tenantId, ...scope,
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
            tenantId, ...scope,
            status: {
              not: "CANCELED",
            },
            ...salesDateWhere,
          },
        }),
        prismaWithServices.contactService.count({
          where: {
            tenantId, ...scope,
            status: {
              not: "CANCELED",
            },
            ...unfinishedServiceWorkWhere,
          },
        }),
        prismaWithServices.contactService.aggregate({
          where: {
            tenantId, ...scope,
            status: {
              not: "CANCELED",
            },
          },
          _sum: {
            totalPriceCents: true,
          },
        }),
        prismaWithServices.contactServicePayment.aggregate({
          where: { voidedAt: null,
            tenantId,
            contactService: {
              tenantId, ...scope,
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
        ...enrollableServiceWhere,
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
            ...unfinishedServiceWorkWhere,
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
          where: { voidedAt: null,
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

router.get("/:tenantId/transactions", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const query = ServiceTransactionsListQuerySchema.parse(req.query)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    })
    const timezone = getSafeTimezone(tenant?.timezone)
    const range = getServiceTransactionsRange(query, timezone)
    const skip = (query.page - 1) * query.pageSize
    const searchableValue = query.search
    const andClauses: Array<Record<string, unknown>> = []

    if (range) {
      andClauses.push({
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
      })
    }

    if (searchableValue) {
      andClauses.push({
        OR: [
          {
            service: { OR: [{ name: { contains: searchableValue, mode: "insensitive" as const } }, { parentService: { name: { contains: searchableValue, mode: "insensitive" as const } } }] },
          },
          {
            contact: buildRelatedContactSearchWhere(searchableValue),
          },
        ],
      })
    }

    const where = {
      tenantId,
      ...serviceScopeWhere(query),
      ...(query.status ? { status: query.status } : {}),
      ...(andClauses.length ? { AND: andClauses } : {}),
    }
    const today = tenantDateOnly(timezone)
    const dueDate = new Date(`${today}T00:00:00Z`)
    const paymentFilter: Prisma.ContactServiceWhereInput = query.paymentFilter === "PAID"
      ? { totalPriceCents: { lte: prisma.contactService.fields.paidCents } }
      : query.paymentFilter === "BALANCE_DUE" || query.paymentFilter === "NEEDS_REVIEW"
        ? { totalPriceCents: { gt: prisma.contactService.fields.paidCents }, status: { not: "CANCELED" }, ...(query.paymentFilter === "NEEDS_REVIEW" ? { paymentType: null } : {}) }
        : query.paymentFilter === "DUE_TODAY" || query.paymentFilter === "OVERDUE"
          ? { status: { not: "CANCELED" }, paymentDues: { some: { remainingCents: { gt: 0 }, dueDate: query.paymentFilter === "DUE_TODAY" ? dueDate : { lt: dueDate } } } }
          : {}
    if (query.paymentFilter !== "ALL") Object.assign(where, { AND: [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), paymentFilter] })
    const financialWhere = {
      AND: [where, { status: { not: "CANCELED" as const } }],
    }
    const transactionOrderBy: Prisma.ContactServiceOrderByWithRelationInput[] =
      query.sort === "PURCHASED_ASC"
        ? [
          { purchasedAt: { sort: "asc", nulls: "last" } },
          { createdAt: "asc" },
          { id: "asc" },
        ]
        : query.sort === "CONTACT_ASC"
          ? [
            { contact: { firstName: "asc" } },
            { contact: { middleName: "asc" } },
            { contact: { lastName: "asc" } },
            { id: "asc" },
          ]
          : query.sort === "SERVICE_ASC"
            ? [{ service: { name: "asc" } }, { id: "asc" }]
            : query.sort === "TOTAL_DESC"
              ? [{ totalPriceCents: "desc" }, { id: "desc" }]
              : [
                { purchasedAt: { sort: "desc", nulls: "last" } },
                { createdAt: "desc" },
                { id: "desc" },
              ]

    const [total, transactions, currencies] = await prisma.$transaction([
      prismaWithServices.contactService.count({ where }),
      prismaWithServices.contactService.findMany({
        where,
        orderBy: transactionOrderBy,
        skip,
        take: query.pageSize,
        select: {
          id: true,
          status: true,
          purchasedAt: true,
          createdAt: true,
          ...billingAccountSelect,
          totalPriceCents: true,
          currency: true,
          contact: {
            select: {
              id: true,
              firstName: true,
              middleName: true,
              lastName: true,
              phone: true,
              email: true,
            },
          },
          service: {
            select: {
              id: true,
              name: true,
              parentService: { select: { id: true, name: true } },
            },
          },
          payments: {
            where: { voidedAt: null },
            select: {
              amountCents: true,
            },
          },
        },
      }),
      prismaWithServices.contactService.findMany({
        where,
        distinct: ["currency"],
        select: { currency: true },
        orderBy: { currency: "asc" },
      }),
    ])

    const totalsByCurrency = await Promise.all(
      currencies.map(async ({ currency }: { currency: string }) => {
        const currencyWhere = {
          AND: [financialWhere, { currency }],
        }
        const [sales, payments] = await Promise.all([
          prismaWithServices.contactService.aggregate({
            where: currencyWhere,
            _sum: { totalPriceCents: true },
          }),
          prismaWithServices.contactServicePayment.aggregate({
            where: { voidedAt: null,
              tenantId,
              contactService: {
                is: currencyWhere,
              },
            },
            _sum: { amountCents: true },
          }),
        ])
        const grossSalesCents = sales._sum.totalPriceCents ?? 0
        const collectedCents = payments._sum.amountCents ?? 0

        return {
          currency,
          grossSalesCents,
          collectedCents,
          outstandingCents: Math.max(0, grossSalesCents - collectedCents),
        }
      }),
    )

    const totalPages = Math.max(1, Math.ceil(total / query.pageSize))

    return res.json({
      ok: true,
      permissions: { canRecord: canManageContactServices(membership) },
      items: transactions.map((transaction: any) => {
        const financials = getServiceTransactionFinancials(
          transaction.totalPriceCents,
          transaction.payments,
        )

        return {
          id: transaction.id,
          purchasedAt: transaction.purchasedAt ?? transaction.createdAt,
          status: transaction.status,
          contact: {
            id: transaction.contact.id,
            displayName: getServiceTransactionContactName(transaction.contact),
            phone: transaction.contact.phone,
            email: transaction.contact.email,
          },
          service: transaction.service,
          currency: transaction.currency,
          totalPriceCents: transaction.totalPriceCents,
          ...financials,
          billing: summarizeServiceBilling({ ...transaction, dues: transaction.paymentDues, paidCents: financials.paidCents, today, timezone }),
        }
      }),
      summary: {
        transactionCount: total,
        totalsByCurrency,
        excludesCanceledTransactions: true,
      },
      range: {
        preset: query.rangePreset,
        from: range?.from ?? null,
        to: range?.to ?? null,
      },
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages,
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId/enrollments", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const parsedQuery = ServiceEnrollmentsListQuerySchema.safeParse(req.query)

    if (!parsedQuery.success) {
      throw parsedQuery.error
    }

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const query = parsedQuery.data
    const skip = (query.page - 1) * query.pageSize
    const conditions: Prisma.Sql[] = [Prisma.sql`cs."tenantId" = ${tenantId}`]

    if (query.statuses?.length) {
      conditions.push(
        Prisma.sql`cs."status"::text IN (${Prisma.join(query.statuses)})`,
      )
    }
    if (query.serviceGroupId) conditions.push(Prisma.sql`s."parentServiceId" = ${query.serviceGroupId}`)
    if (query.serviceId) {
      conditions.push(Prisma.sql`cs."serviceId" = ${query.serviceId}`)
    }
    if (query.assignedToUserId) {
      conditions.push(
        Prisma.sql`cs."followUpCoordinatorUserId" = ${query.assignedToUserId}`,
      )
    } else if (query.unassigned) {
      conditions.push(Prisma.sql`cs."followUpCoordinatorUserId" IS NULL`)
    }
    if (query.search) {
      const searchPattern = `%${query.search}%`
      conditions.push(Prisma.sql`(
        CONCAT_WS(' ', c."firstName", c."middleName", c."lastName") ILIKE ${searchPattern}
        OR COALESCE(c."phone", '') ILIKE ${searchPattern}
        OR COALESCE(c."email", '') ILIKE ${searchPattern}
        OR s."name" ILIKE ${searchPattern}
        OR EXISTS (SELECT 1 FROM "Service" service_group WHERE service_group."tenantId"=cs."tenantId" AND service_group.id=s."parentServiceId" AND service_group.name ILIKE ${searchPattern})
        OR COALESCE(cs."retiredWorkflowSnapshot"->'template'->>'name', '') ILIKE ${searchPattern}
        OR COALESCE(coordinator."name", '') ILIKE ${searchPattern}
        OR COALESCE(coordinator."email", '') ILIKE ${searchPattern}
      )`)
    }

    const whereClause = Prisma.sql`${Prisma.join(conditions, " AND ")}`
    const joins = Prisma.sql`
      FROM "ContactService" cs
      INNER JOIN "Contact" c
        ON c."id" = cs."contactId" AND c."tenantId" = cs."tenantId"
      INNER JOIN "Service" s
        ON s."id" = cs."serviceId" AND s."tenantId" = cs."tenantId"
      LEFT JOIN "User" coordinator
        ON coordinator."id" = cs."followUpCoordinatorUserId"
    `
    const orderByClause =
      query.sort === "LAST_ACTIVITY_ASC"
        ? Prisma.sql`"lastActivityAt" ASC, cs."id" ASC`
        : query.sort === "STARTED_DESC"
          ? Prisma.sql`cs."startedAt" DESC NULLS LAST, cs."createdAt" DESC, cs."id" DESC`
          : query.sort === "CONTACT_ASC"
            ? Prisma.sql`NULLIF(LOWER(BTRIM(CONCAT_WS(' ', c."firstName", c."middleName", c."lastName"))), '') ASC NULLS LAST, cs."id" ASC`
            : query.sort === "SERVICE_ASC"
              ? Prisma.sql`LOWER(s."name") ASC, cs."id" ASC`
              : Prisma.sql`"lastActivityAt" DESC, cs."id" DESC`

    type EnrollmentCountRow = { total: bigint }
    type EnrollmentPageRow = {
      id: string
      lastActivityAt: Date
    }

    const [countRows, pageRows] = await prisma.$transaction([
      prisma.$queryRaw<EnrollmentCountRow[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS total
        ${joins}
        WHERE ${whereClause}
      `),
      prisma.$queryRaw<EnrollmentPageRow[]>(Prisma.sql`
        SELECT
          cs."id" AS id,
          GREATEST(
            cs."updatedAt",
            COALESCE((
              SELECT MAX(payment."updatedAt")
              FROM "ContactServicePayment" payment
              WHERE payment."tenantId" = ${tenantId}
                AND payment."contactServiceId" = cs."id"
            ), cs."updatedAt"),
            COALESCE((
              SELECT MAX(service_note."updatedAt")
              FROM "ContactServiceNote" service_note
              WHERE service_note."tenantId" = ${tenantId}
                AND service_note."contactServiceId" = cs."id"
            ), cs."updatedAt"),
            COALESCE((
              SELECT MAX(contact_note."updatedAt")
              FROM "ContactNote" contact_note
              WHERE contact_note."tenantId" = ${tenantId}
                AND contact_note."contactServiceId" = cs."id"
            ), cs."updatedAt"),
            COALESCE((
              SELECT MAX(checklist_item."updatedAt")
              FROM "ContactServiceChecklistItem" checklist_item
              WHERE checklist_item."tenantId" = ${tenantId}
                AND checklist_item."contactServiceId" = cs."id"
            ), cs."updatedAt"),
            COALESCE((
              SELECT MAX(checklist_activity."createdAt")
              FROM "ContactServiceChecklistActivity" checklist_activity
              WHERE checklist_activity."tenantId" = ${tenantId}
                AND checklist_activity."contactServiceId" = cs."id"
            ), cs."updatedAt"),
            COALESCE((
              SELECT MAX(follow_up_step."updatedAt")
              FROM "ContactServiceFollowUpStep" follow_up_step
              WHERE follow_up_step."tenantId" = ${tenantId}
                AND follow_up_step."contactServiceId" = cs."id"
            ), cs."updatedAt"),
            COALESCE((
              SELECT MAX(saved_step."createdAt") FROM "ContactServiceStep" saved_step
              WHERE saved_step."tenantId" = ${tenantId} AND saved_step."contactServiceId" = cs."id"
            ), cs."updatedAt"),
            COALESCE((
              SELECT MAX(GREATEST(step_entry."createdAt", step_entry."enteredAt", step_entry."resolvedAt", step_entry."supersededAt", step_entry."advancedAt")) FROM "ServiceStepOccurrence" step_entry
              WHERE step_entry."tenantId" = ${tenantId} AND step_entry."contactServiceId" = cs."id"
            ), cs."updatedAt"),
            COALESCE((
              SELECT MAX(deadline_change."createdAt") FROM "ServiceStepDeadlineChange" deadline_change
              WHERE deadline_change."tenantId" = ${tenantId} AND deadline_change."contactServiceId" = cs."id"
            ), cs."updatedAt"),
            COALESCE((
              SELECT MAX(step_move."createdAt") FROM "ServiceStepMovement" step_move
              WHERE step_move."tenantId" = ${tenantId} AND step_move."contactServiceId" = cs."id"
            ), cs."updatedAt"),
            COALESCE((cs."retiredWorkflowSnapshot"->'run'->>'updatedAt')::timestamp, cs."updatedAt"),
            COALESCE((
              SELECT MAX(execution_log."createdAt")
              FROM "ServiceFollowUpExecutionLog" execution_log
              WHERE execution_log."tenantId" = ${tenantId}
                AND execution_log."contactServiceId" = cs."id"
            ), cs."updatedAt"),
            COALESCE((
              SELECT MAX(linked_task."updatedAt")
              FROM "Task" linked_task
              WHERE linked_task."tenantId" = ${tenantId}
                AND linked_task."contactServiceId" = cs."id"
            ), cs."updatedAt")
          ) AS "lastActivityAt"
        ${joins}
        WHERE ${whereClause}
        ORDER BY ${orderByClause}
        LIMIT ${query.pageSize}
        OFFSET ${skip}
      `),
    ])

    const selectedIds = pageRows.map((row) => row.id)
    const enrollments = selectedIds.length
      ? await prisma.contactService.findMany({
        where: {
          tenantId,
          id: { in: selectedIds },
        },
        select: {
          id: true,
          workflowKind: true,
          status: true,
          startedAt: true,
          updatedAt: true,
          contact: {
            select: {
              id: true,
              firstName: true,
              middleName: true,
              lastName: true,
              phone: true,
              email: true,
            },
          },
          service: {
            select: {
              id: true,
              name: true,
              parentService: { select: { id: true, name: true } },
            },
          },
          followUpCoordinator: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
          retiredWorkflowSnapshot: true
        },
      })
      : []

    const enrollmentById = new Map(
      enrollments.map((enrollment) => [enrollment.id, enrollment]),
    )
    const activityById = new Map(pageRows.map((row) => [row.id, row.lastActivityAt]))
    const total = Number(countRows[0]?.total ?? 0)

    return res.json({
      ok: true,
      items: selectedIds.flatMap((id) => {
        const enrollment = enrollmentById.get(id)
        if (!enrollment) return []

        const coordinator = enrollment.followUpCoordinator
        const lastActivityAt = getLatestServiceEnrollmentActivityAt([
          enrollment.updatedAt,
          activityById.get(id),
        ])

        return [{
          id: enrollment.id,
          contact: {
            id: enrollment.contact.id,
            displayName: getServiceEnrollmentContactName(enrollment.contact),
            phone: enrollment.contact.phone,
            email: enrollment.contact.email,
          },
          service: enrollment.service,
          workflowKind: enrollment.workflowKind,
          template: retiredTemplate(enrollment.retiredWorkflowSnapshot),
          status: enrollment.status,
          coordinator: coordinator
            ? {
              id: coordinator.id,
              name: coordinator.name?.trim() || coordinator.email,
              email: coordinator.email,
              image: coordinator.image,
            }
            : null,
          startedAt: enrollment.startedAt,
          lastActivityAt,
        }]
      }),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
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
    const query = FollowUpsListQuerySchema.parse(req.query)
    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } })
    const result = await prisma.$transaction(tx => getServiceFollowUpQueue(tx, tenantId, getSafeTimezone(tenant?.timezone), query), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
    return res.json(result)
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
    const { page, pageSize, contactId, status, readOnly } = ContactServicesListQuerySchema.parse(req.query)

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
          tenantId: true,
          workflowKind: true,
          configurationSnapshot: true,
          assignedProfessionalSnapshot: true,
          serviceSteps: enrolledServiceStepsSelect,
          stepMovements: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
          ...billingAccountSelect,
          totalPriceCents: true,
          currency: true,
          followUpCoordinatorUserId: true,
          followUpCoordinator: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
          service: {
            select: {
              id: true,
              name: true,
              parentService: { select: { id: true, name: true } },
              checklistItems: {
                where: { archivedAt: null },
                select: {
                  id: true,
                },
              },
            },
          },
          payments: {
            where: { voidedAt: null },
            select: {
              amountCents: true,
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
              assignedToUserId: true,
              resolvedByUserId: true,
              resolvedAt: true,
              sortOrder: true,
              assignedTo: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  image: true,
                },
              },
              resolvedBy: {
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
              ...enrolledChecklistSnapshotSelect,
              status: true,
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
              { sortOrderSnapshot: "asc" },
              { checklistItem: { sortOrder: "asc" } },
              { createdAt: "asc" },
            ],
          },
          retiredWorkflowSnapshot: true
        },
      }),
    ])

    const syncResults = readOnly === "true" ? { activatedIds: [], checklistBackfilled: false, statusReconciled: false } : await prisma.$transaction(async (tx) => {
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

        const serviceChecklistItemIds = (item.configurationSnapshot ? [] : item.service?.checklistItems ?? []).map(
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
          tenantId: true,
          workflowKind: true,
          configurationSnapshot: true,
          assignedProfessionalSnapshot: true,
          serviceSteps: enrolledServiceStepsSelect,
          stepMovements: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
          ...billingAccountSelect,
          totalPriceCents: true,
          currency: true,
          followUpCoordinatorUserId: true,
          followUpCoordinator: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
          service: {
            select: {
              id: true,
              name: true,
              parentService: { select: { id: true, name: true } },
              checklistItems: {
                where: { archivedAt: null },
                select: {
                  id: true,
                },
              },
            },
          },
          payments: {
            where: { voidedAt: null },
            select: {
              amountCents: true,
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
              assignedToUserId: true,
              resolvedByUserId: true,
              resolvedAt: true,
              sortOrder: true,
              assignedTo: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  image: true,
                },
              },
              resolvedBy: {
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
              ...enrolledChecklistSnapshotSelect,
              status: true,
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
              { sortOrderSnapshot: "asc" },
              { checklistItem: { sortOrder: "asc" } },
              { createdAt: "asc" },
            ],
          },
          retiredWorkflowSnapshot: true
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
        where: { voidedAt: null,
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
          billing: summarizeServiceBilling({ ...item, dues: item.paymentDues ?? [], paidCents, timezone: getSafeTimezone(item.service.tenant?.timezone), today: tenantDateOnly(getSafeTimezone(item.service.tenant?.timezone)) }),
          totalPriceCents: item.totalPriceCents,
          paidCents,
          remainingCents: Math.max(0, item.totalPriceCents - paidCents),
          currency: item.currency,
          followUpCoordinatorUserId: item.followUpCoordinatorUserId,
          followUpCoordinator: item.followUpCoordinator,
          workflowKind: item.workflowKind,
          retiredWorkflow: retiredWorkflowSummary(item.retiredWorkflowSnapshot),
          followUpTemplate: retiredTemplate(item.retiredWorkflowSnapshot),
          serviceSteps: item.serviceSteps ?? [],
          stepMovements: item.stepMovements ?? [],
          stepProgress: item.workflowKind === "SERVICE_STEPS" ? enrolledStepProgress(item.serviceSteps ?? [], item.stepMovements ?? []) : null,
          service: item.service,
          nextFollowUp: followUpMetadata.nextFollowUp,
          followUpSteps: followUpMetadata.followUpSteps
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
          kind: true,
        },
      }),
    ])

    if (!contact) {
      return res.status(400).json({ error: "INVALID_CONTACT" })
    }

    if (!service) {
      return res.status(400).json({ error: "INVALID_SERVICE" })
    }

    if (service.kind !== "OFFERING") {
      return res.status(400).json({ error: "SUB_SERVICE_REQUIRED" })
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

    if ((payload.initialPaymentCents ?? 0) > 0 && !canManageContactServices(membership)) return res.status(403).json({ error: "INSUFFICIENT_SECURITY_LEVEL" })

    const purchasedAt = payload.purchasedAt ? new Date(payload.purchasedAt) : new Date()
    const startedAt = payload.startedAt ? new Date(payload.startedAt) : new Date()
    const initialPaymentCents = payload.initialPaymentCents ?? 0
    const enrollmentCommand = { tenantId, actorUserId: authed.user.id, payload }
    const created = await prisma.$transaction(async (tx) => {
      const replay = await replayFinancialWriteTx(tx, tenantId, payload.requestKey, enrollmentCommand)
      if (replay) return replay as unknown as { contactService: { id: string } }
      const prismaTx = tx as any
      await assertServiceEnrollableTx(tx, tenantId, payload.serviceId)
      const effective = await loadEffectiveServiceConfiguration(tx, tenantId, payload.serviceId)
      const tenantBilling = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId },
        select: { timezone: true, taxEnabled: true, taxLabel: true, defaultTaxRateBps: true } })
      const billingPreview = previewServiceBilling(effective, tenantBilling, { terms: payload.paymentTerms, initialPaymentCents, purchasedAt: payload.purchasedAt })
      const totalPriceCents = billingPreview.totalPriceCents
      if (billingPreview.configurationVersion !== payload.configurationVersion) throw new ServiceCollectionError("BILLING_CONFIGURATION_CHANGED", 409)
      if (payload.assignedProfessionalId && !effective.professionals.some(p => p.id === payload.assignedProfessionalId)) {
        throw new ServiceCollectionError("INVALID_ASSIGNED_SERVICE_PROFESSIONAL")
      }
      const activeChecklist = effective.checklistItems
      if (!effective.steps.length) throw new ServiceCollectionError("SERVICE_STEPS_REQUIRED")
      const workflowKind = "SERVICE_STEPS"
      const serviceAutomations = await captureServiceAutomationsTx(tx, {
        tenantId, serviceId: effective.id, groupId: effective.parentService?.id ?? null,
        sourceStepIds: effective.steps.map(step => step.id),
      })
      const billingSnapshot = { schemaVersion: 1, sourceServiceId: effective.inheritance.billing.sourceServiceId ?? payload.serviceId,
        ...pickBilling(effective), ...tenantBilling, totalPriceCents }
      const selectedProfessional = effective.professionals.find(p => p.id === payload.assignedProfessionalId) ?? null
      const contactService = await prismaTx.contactService.create({
        data: {
          tenantId,
          contactId: payload.contactId,
          serviceId: payload.serviceId,
          workflowKind,
          configurationSnapshot: captureEnrollmentConfiguration({ service: effective, billing: billingSnapshot, workflowKind, serviceAutomations,
            followUpTemplateVersionId: null }),
          assignedProfessionalSnapshot: selectedProfessional ? professionalSnapshot(selectedProfessional) : Prisma.DbNull,
          followUpCoordinatorUserId: payload.followUpAssignedToUserId ?? null,
          assignedProfessionalId: payload.assignedProfessionalId ?? null,
          status: "IN_PROGRESS",
          startedAt,
          purchasedAt,
          totalPriceCents,
          billingSnapshot,
          currency: effective.currency,
          allowPartialPayments: effective.allowPartialPayments,
          notes: payload.notes ?? null,
        },
        select: {
          id: true,
        },
      })

      let initialPayment: any = null
      if (initialPaymentCents > 0) {
        initialPayment = await prismaTx.contactServicePayment.create({
          data: {
            tenantId,
            contactServiceId: contactService.id,
            amountCents: initialPaymentCents,
            paidAt: purchasedAt,
            paymentMethod: payload.initialPaymentMethod ?? null,
            note: payload.initialPaymentNote ?? null,
            recordedById: authed.user.id,
          },
        })
      }

      await replacePaymentPlanTx(tx, { tenantId, contactServiceId: contactService.id, plan: billingPreview.plan, dues: billingPreview.dues, paidCents: initialPaymentCents })

      if (activeChecklist.length) {
        await prismaTx.contactServiceChecklistItem.createMany({
          data: activeChecklist.map(item => ({
            tenantId,
            contactServiceId: contactService.id,
            checklistItemId: item.id,
            labelSnapshot: item.label, descriptionSnapshot: item.description,
            isRequiredSnapshot: item.isRequired, sortOrderSnapshot: item.sortOrder,
          })),
        })
      }

      const definitions = await tx.contactServiceStep.createManyAndReturn({
        data: effective.steps.map(({ id, automations: _automations, ...step }) => ({ ...step, sourceStepId: id, tenantId, contactServiceId: contactService.id })),
      })
      const first = definitions.sort((a, b) => a.sortOrder - b.sortOrder)[0]
      await createServiceStepOccurrenceTx(tx, { tenantId, contactServiceId: contactService.id,
        stepId: first.id, entryKey: "enrollment", enteredAt: new Date(), enteredByUserId: authed.user.id })
      // The first occurrence is active; a new enrollment cannot be finished yet.

      {
        await emitServiceAutomationEventTx(tx, { tenantId, contactServiceId: contactService.id, triggerType: "SERVICE_ENROLLED", next: { status: "IN_PROGRESS" }, actor: { actorUserId: authed.user.id } })
        if (initialPayment) await emitServiceAutomationEventTx(tx, { tenantId, contactServiceId: contactService.id, triggerType: "SERVICE_PAYMENT_CHANGED", recordId: initialPayment.id, change: "ADDED", isInitialPayment: true, next: initialPayment, actor: { actorUserId: authed.user.id } })
      }
      const result = { contactService }
      await saveFinancialChangeTx(tx, { tenantId, contactServiceId: contactService.id, requestKey: payload.requestKey, command: enrollmentCommand, kind: "ACCOUNT_CREATED", revision: 1, actorUserId: authed.user.id, next: { plan: billingPreview.plan, schedule: billingPreview.dues, initialPayment }, result })
      return result
    }, { maxWait: 5_000, timeout: 20_000 })

    return res.status(201).json({
      ok: true,
      contactService: created.contactService,
    })
  } catch (error) {
    if (error instanceof ServiceCollectionError) return res.status(error.status).json({ error: error.code })
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
            tenantId: true,
            workflowKind: true,
            configurationSnapshot: true,
            assignedProfessionalSnapshot: true,
            serviceSteps: enrolledServiceStepsSelect,
            stepMovements: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
            completedAt: true,
            canceledAt: true,
            ...billingAccountSelect,
            totalPriceCents: true,
            billingSnapshot: true,
            currency: true,
            allowPartialPayments: true,
            notes: true,
            followUpCoordinatorUserId: true,
            followUpCoordinator: {
              select: {
                id: true,
                name: true,
                email: true,
                image: true,
              },
            },
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
                ...serviceConfigurationSelect,
                id: true,
                name: true,
                description: true,
                basePriceCents: true,
                isTaxExempt: true,
                minimumPartialPaymentCents: true,
                installmentCount: true,
                installmentFrequency: true,
                professionals: {
                  where: { archivedAt: null },
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
                tenant: {
                  select: {
                    timezone: true,
                    taxEnabled: true,
                    taxLabel: true,
                    defaultTaxRateBps: true,
                  },
                },
                checklistItems: {
                  where: { archivedAt: null },
                  select: {
                    id: true,
                  },
                },
              },
            },
            followUpSteps: {
              select: {
                id: true,
                title: true,
                status: true,
                availableAt: true,
                dueAt: true,
                completedAt: true,
                assignedToUserId: true,
                assignedTo: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    image: true,
                  },
                },
                sortOrder: true,
              },
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            },
            checklistItems: {
              select: {
                id: true,
                checklistItemId: true,
                ...enrolledChecklistSnapshotSelect,
                status: true,
                completedAt: true,
                checklistItem: {
                  select: {
                    label: true,
                    description: true,
                    isRequired: true,
                    sortOrder: true,
                  },
                },
              },
              orderBy: [
                { sortOrderSnapshot: "asc" },
                { checklistItem: { sortOrder: "asc" } },
                { createdAt: "asc" },
              ],
            },
            retiredWorkflowSnapshot: true
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

        const serviceChecklistItemIds = (item.configurationSnapshot ? [] : item.service?.checklistItems ?? []).map(
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

      const paymentAggregate = await prismaWithServices.contactServicePayment.aggregate({
        where: { tenantId, contactServiceId, voidedAt: null },
        _sum: { amountCents: true }, _max: { paidAt: true }, _count: { _all: true },
      })
      const paidCents = paymentAggregate._sum.amountCents ?? 0
      const followUpState = resolveSavedFollowUpState(item)
      const nextFollowUp = serializeEffectiveNextFollowUp(followUpState.effectiveNextFollowUp)
      const followUpCompletedCount = item.followUpSteps.filter((step: any) =>
        ["COMPLETED", "SKIPPED"].includes(step.status),
      ).length
      const followUpItems = item.followUpSteps.map((step: any) => {
        const projectedDue =
          followUpState.effectiveNextFollowUp?.stepId === step.id
            ? followUpState.effectiveNextFollowUp
            : null

        return {
          id: step.id,
          title: step.title,
          status: step.status,
          availableAt: step.availableAt,
          dueAt: step.dueAt,
          effectiveDueAt: projectedDue?.at ?? step.dueAt ?? step.availableAt ?? null,
          effectiveDueSource: projectedDue
            ? projectedDue.source
            : step.dueAt
              ? "STEP_DUE"
              : step.availableAt
                ? "STEP_AVAILABLE"
                : null,
          completedAt: step.completedAt,
          assignedToUserId: step.assignedToUserId,
          assignedTo: step.assignedTo,
          sortOrder: step.sortOrder,
        }
      })
      const checklistSummary = item.checklistItems.reduce(
        (summary: { received: number; missing: number; informed: number }, entry: any) => {
          if (entry.status === "RECEIVED") summary.received += 1
          if (entry.status === "MISSING") summary.missing += 1
          if (entry.status === "INFORMED") summary.informed += 1
          return summary
        },
        { received: 0, missing: 0, informed: 0 },
      )

      return res.json({
        ok: true,
        contactService: {
          ...(await serializeContactServiceWorkspaceBase(item, paidCents)),
          nextFollowUp,
          followUpSummary: {
            totalCount: item.followUpSteps.length,
            completedCount: followUpCompletedCount,
            items: followUpItems,
          },
          checklistSummary: {
            totalCount: item.checklistItems.length,
            receivedCount: checklistSummary.received,
            missingCount: checklistSummary.missing,
            informedCount: checklistSummary.informed,
            items: item.checklistItems.map((checklistItem: any) => serializeEnrolledChecklistItem(checklistItem)),
          },
          paymentSummary: {
            latestPaidAt: paymentAggregate._max.paidAt ?? null,
            totalPaymentsCount: paymentAggregate._count._all,
          },
        },
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.patch("/:tenantId/contact-services/:contactServiceId/follow-up-coordinator", requireAuth, async (req, res, next) => {
  try {
    enforceSameOrigin(req)
    const authed = req as AuthedRequest
    const { tenantId, contactServiceId } = TenantContactServicePathSchema.parse(req.params)
    const payload = UpdateFollowUpCoordinatorSchema.parse(req.body)
    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return
    if (!canManageContactServices(membership)) return res.status(403).json({ error: "INSUFFICIENT_SECURITY_LEVEL" })
    const updated = await prisma.$transaction(async tx => {
      const scoped = await tx.contactService.findFirst({ where: { tenantId, id: contactServiceId }, select: { workflowKind: true } })
      if (!scoped) throw new ServiceCollectionError("CONTACT_SERVICE_NOT_FOUND", 404)
      if (scoped.workflowKind === "SERVICE_STEPS") {
        await mutateEnrolledServiceTx(tx, { tenantId, contactServiceId, requestId: randomUUID(), actor: { actorUserId: authed.user.id }, action: { type: "SET_SERVICE_COORDINATOR", serviceConfig: { assignedToUserId: payload.assignedToUserId } } })
      } else {
        const enrollment = await lockSavedFollowUpEnrollment(tx, tenantId, contactServiceId)
        if (["COMPLETED", "CANCELED"].includes(enrollment.status)) throw new ServiceCollectionError("FOLLOW_UP_COORDINATOR_LOCKED", 409)
        if (payload.assignedToUserId && !await tx.membership.findFirst({ where: { tenantId, userId: payload.assignedToUserId, status: "ACTIVE" } })) throw new ServiceCollectionError("INVALID_FOLLOW_UP_COORDINATOR")
        if (payload.assignedToUserId !== enrollment.followUpCoordinatorUserId) {
          await tx.contactService.update({ where: { id: contactServiceId }, data: { followUpCoordinatorUserId: payload.assignedToUserId } })
          await tx.serviceFollowUpExecutionLog.create({ data: { tenantId, contactServiceId, contactId: enrollment.contactId, actorUserId: authed.user.id, eventType: "FOLLOW_UP_COORDINATOR_CHANGED", title: "Enrollment coordinator updated", payload: { previousUserId: enrollment.followUpCoordinatorUserId, userId: payload.assignedToUserId } } })
        }
      }
      return tx.contactService.findFirstOrThrow({ where: { tenantId, id: contactServiceId }, select: { followUpCoordinatorUserId: true, followUpCoordinator: { select: { id: true, name: true, email: true, image: true } } } })
    })
    return res.json({ ok: true, ...updated })
  } catch (error) {
    if (error instanceof ServiceCollectionError) return res.status(error.status).json({ error: error.code })
    return next(error)
  }
})

router.get(
  "/:tenantId/contact-services/:contactServiceId/transaction",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId } = TenantContactServicePathSchema.parse(req.params)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      const item = await prismaWithServices.contactService.findFirst({
        where: { id: contactServiceId, tenantId },
        select: {
          ...contactServiceWorkspaceBaseSelect,
          payments: {
            where: { voidedAt: null },
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
        },
      })

      if (!item) {
        return res.status(404).json({ error: "CONTACT_SERVICE_NOT_FOUND" })
      }

      const paidCents = item.payments.reduce(
        (sum: number, payment: { amountCents: number }) => sum + payment.amountCents,
        0,
      )

      return res.json({
        ok: true,
        contactService: {
          ...(await serializeContactServiceWorkspaceBase(item, paidCents)),
          payments: item.payments,
          followUpSteps: [],
          checklistItems: [],
          noteActivityItems: [],
          executionLogs: [],
          checklistActivityLogs: [],
        },
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.get(
  "/:tenantId/contact-services/:contactServiceId/follow-up",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId } = TenantContactServicePathSchema.parse(req.params)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      const fetchItem = async () =>
        prismaWithServices.contactService.findFirst({
          where: { id: contactServiceId, tenantId },
          select: {
            ...contactServiceWorkspaceBaseSelect,
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
                resolvedByUserId: true,
                resolvedAt: true,
                assignedTo: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    image: true,
                  },
                },
                resolvedBy: {
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
            retiredWorkflowSnapshot: true
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
        const reconciled = await reconcileContactServiceCompletionFromFollowUps(
          prismaTx,
          tenantId,
          item.id,
          authed.user.id,
        )
        return {
          activatedId,
          statusReconciled: reconciled?.status !== item.status,
        }
      })

      if (syncResult.activatedId || syncResult.statusReconciled) {
        item = await fetchItem()
      }
      if (!item) {
        return res.status(404).json({ error: "CONTACT_SERVICE_NOT_FOUND" })
      }

      const paymentAggregate = await prismaWithServices.contactServicePayment.aggregate({
        where: { voidedAt: null, tenantId, contactServiceId },
        _sum: { amountCents: true },
      })
      const paidCents = paymentAggregate._sum.amountCents ?? 0

      return res.json({
        ok: true,
        contactService: {
          ...(await serializeContactServiceWorkspaceBase(item, paidCents)),
          ...serializeSavedFollowUpMetadata(
            item,
            getSafeTimezone(item.service.tenant.timezone),
          ),
          payments: [],
          checklistItems: [],
          noteActivityItems: [],
          executionLogs: [],
          checklistActivityLogs: [],
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

      const activityNotesSelect = {
        select: {
          id: true,
          title: true,
          createdAt: true,
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
        },
        orderBy: [{ createdAt: "desc" as const }],
      }

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
            tenantId: true,
            workflowKind: true,
            configurationSnapshot: true,
            assignedProfessionalSnapshot: true,
            serviceSteps: enrolledServiceStepsSelect,
            stepMovements: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
            completedAt: true,
            canceledAt: true,
            ...billingAccountSelect,
            totalPriceCents: true,
            billingSnapshot: true,
            currency: true,
            allowPartialPayments: true,
            notes: true,
            followUpCoordinatorUserId: true,
            followUpCoordinator: {
              select: {
                id: true,
                name: true,
                email: true,
                image: true,
              },
            },
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
                ...serviceConfigurationSelect,
                id: true,
                name: true,
                description: true,
                basePriceCents: true,
                isTaxExempt: true,
                minimumPartialPaymentCents: true,
                installmentCount: true,
                installmentFrequency: true,
                professionals: {
                  where: { archivedAt: null },
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
                tenant: {
                  select: {
                    timezone: true,
                    taxEnabled: true,
                    taxLabel: true,
                    defaultTaxRateBps: true,
                  },
                },
                checklistItems: {
                  where: { archivedAt: null },
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
            payments: {
              where: { voidedAt: null },
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
            serviceNotes: activityNotesSelect,
            contactNotes: {
              select: {
                id: true,
                title: true,
                createdAt: true,
                createdBy: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    image: true,
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
                    email: true,
                  },
                },
              },
              orderBy: [{ createdAt: "desc" }],
            },
            checklistActivities: {
              select: {
                id: true,
                contactServiceChecklistItemId: true,
                itemLabel: true,
                previousStatus: true,
                status: true,
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
                resolvedByUserId: true,
                resolvedAt: true,
                assignedTo: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    image: true,
                  },
                },
                resolvedBy: {
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
                ...enrolledChecklistSnapshotSelect,
                status: true,
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
                { sortOrderSnapshot: "asc" },
                { checklistItem: { sortOrder: "asc" } },
                { createdAt: "asc" },
              ],
            },
            retiredWorkflowSnapshot: true
          },
        })

      let item: Awaited<ReturnType<typeof fetchItem>> | null = await fetchItem()

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

        const serviceChecklistItemIds = (item.configurationSnapshot ? [] : item.service?.checklistItems ?? []).map(
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

      item = await resolveEnrollmentConfiguration(item)
      const paidCents = item.payments.reduce(
        (sum: number, payment: { amountCents: number }) => sum + payment.amountCents,
        0,
      )
      const noteActivityItems = [...item.serviceNotes, ...item.contactNotes].sort(
        (left, right) =>
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      )

      return res.json({
        ok: true,
        contactService: {
          id: item.id,
          workflowKind: item.workflowKind,
          configurationSnapshot: item.configurationSnapshot,

          serviceSteps: item.serviceSteps ?? [],
          stepMovements: item.stepMovements ?? [],
          contactId: item.contactId,
          status: item.status,
          startedAt: item.startedAt,
          purchasedAt: item.purchasedAt,
          completedAt: item.completedAt,
          canceledAt: item.canceledAt,
          billing: summarizeServiceBilling({ ...item, dues: item.paymentDues ?? [], paidCents, timezone: getSafeTimezone(item.service.tenant?.timezone), today: tenantDateOnly(getSafeTimezone(item.service.tenant?.timezone)) }),
          totalPriceCents: item.totalPriceCents,
          paidCents,
          remainingCents: Math.max(0, item.totalPriceCents - paidCents),
          currency: item.currency,
          allowPartialPayments: item.allowPartialPayments,
          notes: item.notes,
          followUpCoordinatorUserId: item.followUpCoordinatorUserId,
          followUpCoordinator: item.followUpCoordinator,
          assignedProfessional: item.assignedProfessional,
          contactName: [item.contact?.firstName, item.contact?.middleName, item.contact?.lastName]
            .filter(Boolean)
            .join(" "),
          service: {
            id: item.service.id,
            name: item.service.name,
            parentService: item.service.parentService,
            description: item.service.description,
            basePriceCents: item.service.basePriceCents,
            isTaxExempt: item.service.isTaxExempt,
            minimumPartialPaymentCents: item.service.minimumPartialPaymentCents,
            installmentCount: item.service.installmentCount,
            installmentFrequency: item.service.installmentFrequency,
            paymentSettings: resolvePaymentSettings(item.service),
            professionals: item.service.professionals,
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
          ...serializeSavedFollowUpMetadata(
            item,
            getSafeTimezone(item.service.tenant.timezone),
          ),
          payments: item.payments,
          noteActivityItems,
          executionLogs: item.executionLogs,
          checklistActivityLogs: item.checklistActivities.map((activity: any) => ({
            id: activity.id,
            checklistItemId: activity.contactServiceChecklistItemId,
            label: activity.itemLabel,
            previousStatus: activity.previousStatus,
            status: activity.status,
            createdAt: activity.createdAt,
            actor: activity.actor,
          })),
          checklistItems: item.checklistItems.map((checklistItem: any) => serializeEnrolledChecklistItem(checklistItem))
        },
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.get(
  "/:tenantId/contact-services/:contactServiceId/notes",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId } = TenantContactServicePathSchema.parse(req.params)
      const query = ContactServiceNotesQuerySchema.parse(req.query)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      const enrollment = await prismaWithServices.contactService.findFirst({
        where: { id: contactServiceId, tenantId },
        select: contactServiceWorkspaceBaseSelect,
      })
      if (!enrollment) {
        return res.status(404).json({ error: "CONTACT_SERVICE_NOT_FOUND" })
      }

      const authorSearch = {
        is: {
          OR: [
            { name: { contains: query.q, mode: "insensitive" as const } },
            { email: { contains: query.q, mode: "insensitive" as const } },
          ],
        },
      }
      const searchWhere = query.q
        ? {
          OR: [
            { title: { contains: query.q, mode: "insensitive" as const } },
            { body: { contains: query.q, mode: "insensitive" as const } },
            { createdBy: authorSearch },
          ],
        }
        : {}
      const serviceWhere = { tenantId, contactServiceId, ...searchWhere }
      const contactWhere = { tenantId, contactServiceId, ...searchWhere }

      const [serviceTotal, contactTotal, paymentAggregate] = await Promise.all([
        prismaWithServices.contactServiceNote.count({ where: serviceWhere }),
        prismaWithServices.contactNote.count({ where: contactWhere }),
        prismaWithServices.contactServicePayment.aggregate({
          where: { voidedAt: null, tenantId, contactServiceId },
          _sum: { amountCents: true },
        }),
      ])
      const page = getContactServiceNotesPage(
        query.page,
        query.pageSize,
        serviceTotal + contactTotal,
      )
      const orderBy = getServiceNoteOrderBy(query.sort)
      const noteSelect = {
        id: true,
        title: true,
        body: true,
        createdById: true,
        createdAt: true,
        updatedAt: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
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
      }

      const [serviceNotes, contactNotes] = await Promise.all([
        prismaWithServices.contactServiceNote.findMany({
          where: serviceWhere,
          select: noteSelect,
          orderBy,
          take: page.candidateTake,
        }),
        prismaWithServices.contactNote.findMany({
          where: contactWhere,
          select: {
            ...noteSelect,
            contactServiceFollowUpStep: { select: { title: true } },
            retiredWorkflowSnapshot: true
          },
          orderBy,
          take: page.candidateTake,
        }),
      ])

      const items = [
        ...serviceNotes.map((note: any) =>
          serializePaginatedServiceNote(note, "SERVICE_NOTE", {
            membership,
            userId: authed.user.id,
          }),
        ),
        ...contactNotes.map((note: any) =>
          serializePaginatedServiceNote(
            note,
            resolveContactServiceNoteKind({
              isServiceNote: false,
              hasFollowUpTemplate: Boolean(retiredTemplate(note.retiredWorkflowSnapshot)),
              hasFollowUpStep: Boolean(note.contactServiceFollowUpStep),
            }),
            { membership, userId: authed.user.id },
          ),
        ),
      ]
        .sort((left, right) => compareContactServiceNotes(left, right, query.sort))
        .slice(page.offset, page.offset + page.pageSize)

      return res.json({
        ok: true,
        contactService: {
          ...(await serializeContactServiceWorkspaceBase(
            enrollment,
            paymentAggregate._sum.amountCents ?? 0,
          )),
          followUpSteps: [],
          checklistItems: [],
        },
        items,
        pagination: {
          page: page.page,
          pageSize: page.pageSize,
          total: page.total,
          totalPages: page.totalPages,
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
          title: payload.title,
          body: payload.body,
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

router.patch(
  "/:tenantId/contact-services/:contactServiceId/notes/:noteId",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId, noteId } =
        TenantContactServiceNotePathSchema.parse(req.params)
      const payload = UpdateContactServiceNoteSchema.parse(req.body)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      const [existingNote, files] = await Promise.all([
        prismaWithServices.contactServiceNote.findFirst({
          where: { id: noteId, tenantId, contactServiceId },
          select: {
            id: true,
            createdById: true,
            attachments: { select: { fileId: true } },
          },
        }),
        getValidatedServiceNoteFiles(tenantId, payload.attachmentFileIds),
      ])

      if (!existingNote) {
        return res.status(404).json({ error: "NOTE_NOT_FOUND" })
      }
      if (
        !canManageContactServiceNote(
          membership,
          existingNote.createdById,
          authed.user.id,
        )
      ) {
        return res.status(403).json({ error: "FORBIDDEN" })
      }
      if (!files) {
        return res.status(400).json({ error: "INVALID_NOTE_ATTACHMENTS" })
      }

      const existingFileIds = existingNote.attachments.map(
        (attachment: { fileId: string }) => attachment.fileId,
      )
      const nextFileIds = files.map((file: { id: string }) => file.id)
      const { fileIdsToRemove, fileIdsToAdd } =
        resolveContactServiceNoteAttachmentChanges(
          existingFileIds,
          nextFileIds,
        )

      const updated = await prisma.$transaction(async (tx) => {
        const txWithServices = tx as any
        await txWithServices.contactServiceNote.update({
          where: { id: noteId },
          data: {
            title: payload.title,
            body: payload.body,
          },
        })

        if (fileIdsToRemove.length > 0) {
          await txWithServices.contactServiceNoteAttachment.deleteMany({
            where: {
              tenantId,
              noteId,
              fileId: { in: fileIdsToRemove },
            },
          })
        }
        if (fileIdsToAdd.length > 0) {
          await txWithServices.contactServiceNoteAttachment.createMany({
            data: fileIdsToAdd.map((fileId) => ({
              tenantId,
              noteId,
              fileId,
            })),
            skipDuplicates: true,
          })
        }

        return txWithServices.contactServiceNote.findUniqueOrThrow({
          where: { id: noteId },
          select: {
            id: true,
            title: true,
            body: true,
            createdById: true,
            createdAt: true,
            updatedAt: true,
            createdBy: {
              select: {
                id: true,
                name: true,
                email: true,
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
      })

      await deleteServiceNoteFilesIfUnreferenced(fileIdsToRemove)

      return res.json({
        ok: true,
        note: serializePaginatedServiceNote(updated, "SERVICE_NOTE", {
          membership,
          userId: authed.user.id,
        }),
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.delete(
  "/:tenantId/contact-services/:contactServiceId/notes/:noteId",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId, noteId } =
        TenantContactServiceNotePathSchema.parse(req.params)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      const existingNote = await prismaWithServices.contactServiceNote.findFirst({
        where: { id: noteId, tenantId, contactServiceId },
        select: {
          id: true,
          createdById: true,
          attachments: { select: { fileId: true } },
        },
      })
      if (!existingNote) {
        return res.status(404).json({ error: "NOTE_NOT_FOUND" })
      }
      if (
        !canManageContactServiceNote(
          membership,
          existingNote.createdById,
          authed.user.id,
        )
      ) {
        return res.status(403).json({ error: "FORBIDDEN" })
      }

      const attachmentFileIds = existingNote.attachments.map(
        (attachment: { fileId: string }) => attachment.fileId,
      )
      await prismaWithServices.contactServiceNote.delete({ where: { id: noteId } })
      await deleteServiceNoteFilesIfUnreferenced(attachmentFileIds)

      return res.json({ ok: true })
    } catch (error) {
      return next(error)
    }
  },
)

router.post("/:tenantId/contact-services/:contactServiceId/payments", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId, contactServiceId } = TenantContactServicePathSchema.parse(req.params)
    const payload = CreateContactServicePaymentSchema.parse(req.body)
    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return
    if (!canManageContactServices(membership)) return res.status(403).json({ error: "INSUFFICIENT_SECURITY_LEVEL" })

    const result = await prisma.$transaction(async tx => {
      const result = await mutateServicePaymentTx(tx, { tenantId, contactServiceId, operation: "ADDED", actorUserId: authed.user.id, payload, requestKey: payload.requestKey, expectedRevision: payload.expectedRevision })
      if (result.enrollment.workflowKind !== "SERVICE_STEPS") await reconcileContactServiceCompletionFromFollowUps(tx, tenantId, contactServiceId, authed.user.id)
      return { payment: result.payment, summary: result.summary }
    })
    return res.status(201).json({ ok: true, payment: result.payment, summary: result.summary })
  } catch (error) {
    if (error instanceof ServiceCollectionError) return res.status(error.status).json({ error: error.code })
    return next(error)
  }
})

router.patch("/:tenantId/contact-services/:contactServiceId/payments/:paymentId", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId, contactServiceId, paymentId } = TenantContactServicePaymentPathSchema.parse(req.params)
    const payload = UpdateContactServicePaymentSchema.parse(req.body)
    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return
    if (!canManageContactServices(membership)) return res.status(403).json({ error: "INSUFFICIENT_SECURITY_LEVEL" })
    if (!Object.keys(payload).length) return res.status(400).json({ error: "NO_CHANGES_PROVIDED" })
    const result = await prisma.$transaction(async tx => {
      const result = await mutateServicePaymentTx(tx, { tenantId, contactServiceId, operation: "UPDATED", actorUserId: authed.user.id, paymentId, payload, reason: payload.reason, requestKey: payload.requestKey, expectedRevision: payload.expectedRevision })
      if (result.enrollment.workflowKind !== "SERVICE_STEPS") await reconcileContactServiceCompletionFromFollowUps(tx, tenantId, contactServiceId, authed.user.id)
      return { payment: result.payment, summary: result.summary }
    })
    return res.status(200).json({ ok: true, payment: result.payment, summary: result.summary })
  } catch (error) {
    if (error instanceof ServiceCollectionError) return res.status(error.status).json({ error: error.code })
    return next(error)
  }
})

router.delete("/:tenantId/contact-services/:contactServiceId/payments/:paymentId", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId, contactServiceId, paymentId } = TenantContactServicePaymentPathSchema.parse(req.params)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return
    if (!canManageContactServices(membership)) return res.status(403).json({ error: "INSUFFICIENT_SECURITY_LEVEL" })

    const result = await prisma.$transaction(async tx => {
      const result = await mutateServicePaymentTx(tx, { tenantId, contactServiceId, operation: "REMOVED", actorUserId: authed.user.id, paymentId, ...FinancialWriteSchema.extend({ reason: FinancialReasonSchema }).strict().parse(req.body) })
      if (result.enrollment.workflowKind !== "SERVICE_STEPS") await reconcileContactServiceCompletionFromFollowUps(tx, tenantId, contactServiceId, authed.user.id)
      return { payment: result.payment, summary: result.summary }
    })
    return res.status(200).json({ ok: true, summary: result.summary })
  } catch (error) {
    if (error instanceof ServiceCollectionError) return res.status(error.status).json({ error: error.code })
    return next(error)
  }
})

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

      const scopedEnrollment = await prisma.contactService.findFirst({ where: { tenantId, id: contactServiceId }, select: { workflowKind: true } })
      if (scopedEnrollment?.workflowKind === "SERVICE_STEPS") {
        const contactService = await prisma.$transaction(async tx => {
          const locked = await lockServiceActionEnrollment(tx, tenantId, contactServiceId)
          const actor = { actorUserId: authed.user.id }
          if (payload.status && payload.status !== locked.status) {
            if (payload.status !== "IN_PROGRESS" && payload.status !== "CANCELED") throw new ServiceCollectionError("SERVICE_STATUS_IS_DERIVED", 409)
            await mutateEnrolledServiceTx(tx, { tenantId, contactServiceId, actor, requestId: randomUUID(), action: { type: "SET_SERVICE_STATUS", serviceConfig: { status: payload.status } } })
          }
          if (payload.assignedProfessionalId !== undefined) await mutateEnrolledServiceTx(tx, { tenantId, contactServiceId, actor, requestId: randomUUID(), action: { type: "SET_SERVICE_PROFESSIONAL", serviceConfig: { professionalId: payload.assignedProfessionalId } } })
          return tx.contactService.update({ where: { id: contactServiceId }, data: {
              ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
              ...(payload.startedAt !== undefined ? { startedAt: payload.startedAt ? new Date(payload.startedAt) : null } : {}),
              ...(payload.purchasedAt !== undefined ? { purchasedAt: payload.purchasedAt ? new Date(payload.purchasedAt) : null } : {}),
            }, include: { assignedProfessional: true } })
        })
        return res.json({ ok: true, contactService: { ...contactService, assignedProfessional: readProfessionalSnapshot(contactService.assignedProfessionalSnapshot) ?? contactService.assignedProfessional } })
      }
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
          assignedProfessionalId: true,
          configurationSnapshot: true,
          assignedProfessionalSnapshot: true,
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
                },
              },
            },
          },
          service: {
            select: {
              ...serviceConfigurationSelect,
              id: true,
              name: true,
              professionals: {
                where: { archivedAt: null },
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
            },
          },
        },
      })

      if (!existing) {
        return res.status(404).json({ error: "CONTACT_SERVICE_NOT_FOUND" })
      }

      const eligibleProfessionals = await enrollmentProfessionalOptions(prisma, tenantId, existing.configurationSnapshot,
        resolveServiceConfiguration(existing.service).professionals)
      const previousAttribution = readProfessionalSnapshot(existing.assignedProfessionalSnapshot)
      const professionalChange = resolveServiceProfessionalChange({
        assignedProfessionalId: payload.assignedProfessionalId,
        previousProfessional: previousAttribution?.id === existing.assignedProfessional?.id ? previousAttribution : existing.assignedProfessional,
        professionals: eligibleProfessionals,
      })
      if (!professionalChange.valid) {
        return res.status(400).json({ error: "INVALID_ASSIGNED_SERVICE_PROFESSIONAL" })
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

      const executionLogs: Prisma.ServiceFollowUpExecutionLogUncheckedCreateWithoutContactServiceInput[] = []
      if (payload.status !== undefined && payload.status !== existing.status && existing.followUpTemplateId) {
        executionLogs.push({
          tenantId,
          templateId: existing.followUpTemplateId,
          contactId: existing.contactId,
          actorUserId: authed.user.id,
          eventType: "SERVICE_STATUS_UPDATED",
          title: `Service status updated: ${existing.service.name}`,
          details: `Service moved from ${existing.status.toLowerCase().replace(/_/g, " ")} to ${payload.status.toLowerCase().replace(/_/g, " ")}.`,
          payload: { previousStatus: existing.status, status: payload.status },
        })
      }
      if (professionalChange.activity) {
        executionLogs.push({
          tenantId,
          templateId: existing.followUpTemplateId,
          contactId: existing.contactId,
          actorUserId: authed.user.id,
          eventType: "SERVICE_PROFESSIONAL_CHANGED",
          title: `Assigned professional updated: ${existing.service.name}`,
          details: `Changed from ${professionalChange.activity.previousProfessionalName} to ${professionalChange.activity.professionalName}.`,
          payload: professionalChange.activity,
        })
      }

      // Nested activity creation and the enrollment update commit or roll back together.
      const updated = await prisma.$transaction(async (tx) => {
        await lockServiceHierarchyTx(tx, tenantId, existing.service.id)
        const effective = await loadEffectiveServiceConfiguration(tx, tenantId, existing.service.id)
        const current = await tx.contactService.findUniqueOrThrow({
          where: { id: contactServiceId, tenantId }, select: { assignedProfessionalId: true, configurationSnapshot: true },
        })
        const currentOptions = await enrollmentProfessionalOptions(tx, tenantId, current.configurationSnapshot, effective.professionals)
        const nextAttribution = currentOptions.find(p => p.id === payload.assignedProfessionalId) ?? null
        if (payload.assignedProfessionalId && payload.assignedProfessionalId !== current.assignedProfessionalId &&
          !currentOptions.some(p => p.id === payload.assignedProfessionalId)) {
          throw new ServiceCollectionError("INVALID_ASSIGNED_SERVICE_PROFESSIONAL")
        }
        return tx.contactService.update({
          where: { id: contactServiceId, tenantId },
          data: {
            ...statusUpdate,
            ...(payload.startedAt !== undefined
              ? { startedAt: payload.startedAt ? new Date(payload.startedAt) : null }
              : {}),
            ...(payload.purchasedAt !== undefined
              ? { purchasedAt: payload.purchasedAt ? new Date(payload.purchasedAt) : null }
              : {}),
            ...(payload.notes !== undefined
              ? { notes: payload.notes }
              : {}),
            ...(payload.assignedProfessionalId !== undefined
              ? { assignedProfessionalId: payload.assignedProfessionalId,
                ...(payload.assignedProfessionalId !== current.assignedProfessionalId
                  ? { assignedProfessionalSnapshot: nextAttribution ? professionalSnapshot(nextAttribution) : Prisma.DbNull } : {}) }
              : {}),
            ...(executionLogs.length ? { executionLogs: { create: executionLogs } } : {}),
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
            assignedProfessionalId: true,
            assignedProfessionalSnapshot: true,
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
          },
        })
      })

      return res.json({
        ok: true,
        contactService: { ...updated, assignedProfessional: readProfessionalSnapshot(updated.assignedProfessionalSnapshot) ?? updated.assignedProfessional },
      })
    } catch (error) {
      if (error instanceof ServiceCollectionError) return res.status(error.status).json({ error: error.code })
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

      await prisma.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "ContactService" WHERE "tenantId"=${tenantId} AND id=${contactServiceId} FOR UPDATE`)
        const receipts = await tx.contactServicePayment.count({ where: { tenantId, contactServiceId } })
        if (receipts > 0) throw new ServiceCollectionError("SERVICE_HAS_PAYMENT_HISTORY_CANCEL_INSTEAD", 409)
        await tx.contactService.delete({ where: { id: contactServiceId } })
      })

      return res.json({ ok: true })
    } catch (error) {
      if (error instanceof ServiceCollectionError) return res.status(error.status).json({ error: error.code })
      return next(error)
    }
  },
)

router.patch(
  "/:tenantId/contact-services/:contactServiceId/checklist-items/:checklistItemId",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId, checklistItemId } =
        TenantContactServiceChecklistItemPathSchema.parse(req.params)
      const parsedPayload = UpdateContactServiceChecklistItemSchema.safeParse(req.body)

      if (!parsedPayload.success) {
        return res.status(400).json({
          error: "INVALID_CHECKLIST_STATUS_UPDATE",
          issues: parsedPayload.error.issues,
        })
      }

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      const scopedEnrollment = await prisma.contactService.findFirst({ where: { tenantId, id: contactServiceId }, select: { workflowKind: true } })
      if (scopedEnrollment?.workflowKind === "SERVICE_STEPS") {
        const nextStatus = resolveContactServiceChecklistStatus(parsedPayload.data)
        const result = await prisma.$transaction(async tx => {
          const item = await tx.contactServiceChecklistItem.findFirst({ where: { tenantId, contactServiceId, id: checklistItemId } })
          if (!item) throw new ServiceCollectionError("CONTACT_SERVICE_CHECKLIST_ITEM_NOT_FOUND", 404)
          const changed = await mutateEnrolledServiceTx(tx, { tenantId, contactServiceId, actor: { actorUserId: authed.user.id }, requestId: randomUUID(), action: { type: "SET_SERVICE_CHECKLIST_STATUS", serviceConfig: { checklistItemId: item.checklistItemId, status: nextStatus } } })
          const checklistItem = await tx.contactServiceChecklistItem.findUniqueOrThrow({ where: { id: item.id }, include: { checklistItem: true } })
          const activity = changed.changed ? await tx.contactServiceChecklistActivity.findFirst({ where: { tenantId, contactServiceChecklistItemId: item.id }, orderBy: { createdAt: "desc" }, include: { actor: { select: { id: true, name: true } } } }) : null
          return { checklistItem, activity }
        })
        return res.json({ ok: true, checklistItem: serializeEnrolledChecklistItem(result.checklistItem), activity: result.activity ? { ...result.activity, label: result.activity.itemLabel } : null })
      }
      const nextStatus = resolveContactServiceChecklistStatus(parsedPayload.data)
      const result = await prisma.$transaction(async (tx) => {
        const prismaTx = tx as any
        const existing = await prismaTx.contactServiceChecklistItem.findFirst({
          where: {
            id: checklistItemId,
            tenantId,
            contactServiceId,
          },
          select: {
            id: true,
            checklistItemId: true,
            ...enrolledChecklistSnapshotSelect,
            status: true,
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

        if (!existing) return null

        const transition = resolveContactServiceChecklistTransition({
          currentStatus: existing.status,
          currentCompletedAt: existing.completedAt,
          nextStatus,
          now: new Date(),
        })

        if (!transition.changed) {
          return { checklistItem: existing, activity: null }
        }

        const updated = await prismaTx.contactServiceChecklistItem.update({
          where: { id: checklistItemId },
          data: {
            status: nextStatus,
            completedAt: transition.completedAt,
          },
          select: {
            id: true,
            checklistItemId: true,
            ...enrolledChecklistSnapshotSelect,
            status: true,
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
        const activity = await prismaTx.contactServiceChecklistActivity.create({
          data: buildContactServiceChecklistActivityData({
            tenantId,
            contactServiceId,
            contactServiceChecklistItemId: existing.id,
            itemLabel: serializeEnrolledChecklistItem(existing).label || "Checklist item",
            previousStatus: existing.status,
            status: nextStatus,
            actorUserId: authed.user.id,
          }),
          select: {
            id: true,
            contactServiceChecklistItemId: true,
            itemLabel: true,
            previousStatus: true,
            status: true,
            createdAt: true,
            actor: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        })

        return { checklistItem: updated, activity }
      })

      if (!result) {
        return res.status(404).json({ error: "CONTACT_SERVICE_CHECKLIST_ITEM_NOT_FOUND" })
      }

      const updated = result.checklistItem

      return res.json({
        ok: true,
        checklistItem: serializeEnrolledChecklistItem(updated),
        activity: result.activity
          ? {
            id: result.activity.id,
            checklistItemId: result.activity.contactServiceChecklistItemId,
            label: result.activity.itemLabel,
            previousStatus: result.activity.previousStatus,
            status: result.activity.status,
            createdAt: result.activity.createdAt,
            actor: result.activity.actor,
          }
          : null,
      })
    } catch (error) {
      if (error instanceof ServiceCollectionError) return res.status(error.status).json({ error: error.code })
      return next(error)
    }
  },
)

router.post("/:tenantId/contact-services/:contactServiceId/step-occurrences/:occurrenceId/complete", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId, contactServiceId, occurrenceId } = TenantContactServicePathSchema.extend({ occurrenceId: z.uuid() }).parse(req.params)
    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return
    if (!canManageContactServices(membership)) return res.status(403).json({ error: "INSUFFICIENT_SECURITY_LEVEL" })
    const occurrence = await prisma.$transaction(tx => completeServiceStepOccurrenceTx(tx, {
      tenantId, contactServiceId, occurrenceId, actorUserId: authed.user.id,
    }))
    return res.json({ ok: true, occurrence })
  } catch (error) {
    if (error instanceof ServiceCollectionError) return res.status(error.status).json({ error: error.code })
    return next(error)
  }
})

router.post("/:tenantId/contact-services/:contactServiceId/step-movements", requireAuth, async (req, res, next) => {
  try {
    enforceSameOrigin(req)
    const authed = req as AuthedRequest
    const path = TenantContactServicePathSchema.parse(req.params)
    const payload = MoveServiceStepSchema.parse(req.body)
    const membership = await requireActiveMembership(authed, res, path.tenantId)
    if (!membership) return
    if (!canManageContactServices(membership)) return res.status(403).json({ error: "INSUFFICIENT_SECURITY_LEVEL" })
    const movement = await prisma.$transaction(tx => moveServiceStepTx(tx, { ...path, ...payload, actorUserId: authed.user.id }))
    return res.json({ ok: true, movement })
  } catch (error) {
    if (error instanceof ServiceCollectionError) return res.status(error.status).json({ error: error.code })
    return next(error)
  }
})

router.patch("/:tenantId/contact-services/:contactServiceId/service-steps/:stepId/owner", requireAuth, async (req, res, next) => {
  try {
    enforceSameOrigin(req)
    const path = TenantContactServicePathSchema.extend({ stepId: z.uuid() }).parse(req.params)
    const payload = z.object({ assignedToUserId: z.uuid().nullable() }).strict().parse(req.body)
    const authed = req as AuthedRequest
    const membership = await requireActiveMembership(authed, res, path.tenantId)
    if (!membership) return
    if (!canManageContactServices(membership)) return res.status(403).json({ error: "INSUFFICIENT_SECURITY_LEVEL" })
    await prisma.$transaction(tx => mutateEnrolledServiceTx(tx, { ...path, actor: { actorUserId: authed.user.id }, requestId: randomUUID(), action: { type: "SET_SERVICE_STEP_OWNER", serviceConfig: payload } }))
    const step = await prisma.contactServiceStep.findFirstOrThrow({ where: { tenantId: path.tenantId, contactServiceId: path.contactServiceId, id: path.stepId }, include: { assignedTo: { select: { id: true, name: true, email: true } } } })
    return res.json({ ok: true, step })
  } catch (error) {
    if (error instanceof ServiceCollectionError) return res.status(error.status).json({ error: error.code })
    next(error)
  }
})

const StepOccurrencePathSchema = TenantContactServicePathSchema.extend({ occurrenceId: z.uuid() })
router.post("/:tenantId/contact-services/:contactServiceId/step-occurrences/:occurrenceId/deadline", requireAuth, async (req, res, next) => {
  try {
    enforceSameOrigin(req)
    const authed = req as AuthedRequest
    const path = StepOccurrencePathSchema.parse(req.params)
    const payload = ChangeServiceStepDeadlineSchema.parse(req.body)
    const membership = await requireActiveMembership(authed, res, path.tenantId)
    if (!membership) return
    if (!canManageContactServices(membership)) return res.status(403).json({ error: "INSUFFICIENT_SECURITY_LEVEL" })
    const occurrence = await prisma.$transaction(tx => changeServiceStepDeadlineTx(tx, { ...path, ...payload, actorUserId: authed.user.id }))
    return res.json({ ok: true, occurrence })
  } catch (error) {
    if (error instanceof ServiceCollectionError) return res.status(error.status).json({ error: error.code })
    return next(error)
  }
})

router.get("/:tenantId/contact-services/:contactServiceId/step-occurrences/:occurrenceId/completion-wait", requireAuth, async (req, res, next) => {
  try {
    const input = StepOccurrencePathSchema.parse(req.params)
    if (!await requireActiveMembership(req as AuthedRequest, res, input.tenantId)) return
    const waits = await getServiceStepCompletionWaits(prisma, input)
    return res.json({ ok: true, waits, wait: waits[0] ?? null })
  } catch (error) {
    if (error instanceof ServiceCollectionError) return res.status(error.status).json({ error: error.code })
    return next(error)
  }
})
for (const type of ["CONTINUE", "RESCHEDULE"] as const) {
  router.post(`/:tenantId/contact-services/:contactServiceId/step-occurrences/:occurrenceId/completion-wait/${type === "CONTINUE" ? "continue" : "reschedule"}`, requireAuth, async (req, res, next) => {
    try {
      const input = StepOccurrencePathSchema.parse(req.params)
      const authed = req as AuthedRequest
      const membership = await requireActiveMembership(authed, res, input.tenantId)
      if (!membership) return
      if (!canManageContactServices(membership)) return res.status(403).json({ error: "INSUFFICIENT_SECURITY_LEVEL" })
      const change = type === "CONTINUE" ? { type, ...ContinueServiceStepWaitSchema.parse(req.body) } : { type, ...RescheduleServiceStepWaitSchema.parse(req.body) }
      const wait = await prisma.$transaction(tx => changeServiceStepCompletionWaitTx(tx, { ...input, actorUserId: authed.user.id, change }))
      if (type === "CONTINUE") kickAutomationRunWorker({ queueOpportunityEvent: queueOpportunityAutomationEvent })
      return res.json({ ok: true, wait })
    } catch (error) {
      if (error instanceof ServiceCollectionError) return res.status(error.status).json({ error: error.code })
      return next(error)
    }
  })
}

router.use("/:tenantId/contact-services/:contactServiceId/follow-up-steps", requireAuth, async (req, res, next) => {
  if (!["POST", "PATCH", "DELETE"].includes(req.method)) return next()
  try {
    const { tenantId, contactServiceId } = TenantContactServicePathSchema.parse(req.params)
    if (!await requireActiveMembership(req as AuthedRequest, res, tenantId)) return
    const enrollment = await prisma.contactService.findFirst({ where: { tenantId, id: contactServiceId }, select: { workflowKind: true } })
    if (enrollment?.workflowKind === "SERVICE_STEPS") return res.status(409).json({ error: "SERVICE_STEP_WORKFLOW_REQUIRES_SERVICE_ACTIONS" })
    return next()
  } catch (error) { return next(error) }
})

router.patch("/:tenantId/contact-services/:contactServiceId/follow-up-steps/:followUpStepId", requireAuth, async (req, res, next) => {
  try {
    enforceSameOrigin(req)
    const authed = req as AuthedRequest
    const { tenantId, contactServiceId, followUpStepId } = TenantFollowUpStepPathSchema.parse(req.params)
    const payload = UpdateFollowUpStepSchema.parse(req.body)
    if (!await requireActiveMembership(authed, res, tenantId)) return
    const updated = await prisma.$transaction(async tx => {
      const step = await patchSavedFollowUpTx(tx, { tenantId, contactServiceId, stepId: followUpStepId, actorUserId: authed.user.id, patch: payload })
      await reconcileContactServiceCompletionFromFollowUps(tx, tenantId, contactServiceId, authed.user.id)
      return step
    })
    return res.json({ ok: true, followUpStep: updated })
  } catch (error) {
    if (error instanceof ServiceCollectionError) return res.status(error.status).json({ error: error.code })
    return next(error)
  }
})

router.post("/:tenantId/contact-services/:contactServiceId/follow-up-steps", requireAuth, async (req, res, next) => {
  try {
    enforceSameOrigin(req)
    const authed = req as AuthedRequest
    const { tenantId, contactServiceId } = TenantContactServicePathSchema.parse(req.params)
    const payload = CreateFollowUpStepSchema.parse(req.body)
    if (!await requireActiveMembership(authed, res, tenantId)) return
    const step = await prisma.$transaction(async tx => {
      const enrollment = await lockSavedFollowUpEnrollment(tx, tenantId, contactServiceId)
      if (["CANCELED", "COMPLETED"].includes(enrollment.status)) throw new ServiceCollectionError("ENROLLMENT_NOT_ACTIVE", 409)
      if (payload.assignedToUserId && !await tx.membership.findFirst({ where: { tenantId, userId: payload.assignedToUserId, status: "ACTIVE" } })) throw new ServiceCollectionError("INVALID_ASSIGNEE")
      const steps = await tx.contactServiceFollowUpStep.findMany({ where: { tenantId, contactServiceId }, orderBy: { sortOrder: "desc" } })
      const hasOpen = steps.some(item => ["ACTIVE", "PENDING", "POSTPONED"].includes(item.status))
      const status = payload.status ?? (hasOpen ? "PENDING" : "ACTIVE")
      if (status === "ACTIVE" && hasOpen) throw new ServiceCollectionError("FOLLOW_UP_ALREADY_HAS_ACTIVE_STEP", 409)
      const now = new Date()
      const created = await tx.contactServiceFollowUpStep.create({ data: {
          tenantId, contactServiceId, title: payload.title, notesTemplate: payload.notesTemplate, note: payload.note,
          assignedToUserId: payload.assignedToUserId, status, sortOrder: payload.sortOrder ?? (steps[0]?.sortOrder ?? 0) + 10,
          availableAt: payload.availableAt ? new Date(payload.availableAt) : null,
          dueAt: payload.dueAt ? new Date(payload.dueAt) : null,
          completedAt: status === "COMPLETED" ? now : null,
          ...buildFollowUpStepResolutionUpdate({ nextStatus: status, actorUserId: authed.user.id, now }),
        }, include: { assignedTo: { select: { id: true, name: true, email: true, image: true } } } })
      await tx.serviceFollowUpExecutionLog.create({ data: { tenantId, contactServiceId, contactId: enrollment.contactId, actorUserId: authed.user.id, stepId: created.id, eventType: "SAVED_FOLLOW_UP_CREATED", title: "Saved step added: " + created.title } })
      await reconcileContactServiceCompletionFromFollowUps(tx, tenantId, contactServiceId, authed.user.id)
      return created
    })
    return res.status(201).json({ ok: true, followUpStep: step })
  } catch (error) {
    if (error instanceof ServiceCollectionError) return res.status(error.status).json({ error: error.code })
    return next(error)
  }
})

router.delete("/:tenantId/contact-services/:contactServiceId/follow-up-steps/:followUpStepId", requireAuth, async (req, res, next) => {
  try {
    enforceSameOrigin(req)
    const authed = req as AuthedRequest
    const { tenantId, contactServiceId, followUpStepId } = TenantFollowUpStepPathSchema.parse(req.params)
    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return
    if (!canManageContactServices(membership)) return res.status(403).json({ error: "INSUFFICIENT_SECURITY_LEVEL" })
    await prisma.$transaction(async tx => {
      await lockSavedFollowUpEnrollment(tx, tenantId, contactServiceId)
      const step = await tx.contactServiceFollowUpStep.findFirst({ where: { tenantId, contactServiceId, id: followUpStepId }, include: { _count: { select: { tasks: true, contactNotes: true } } } })
      if (!step) throw new ServiceCollectionError("FOLLOW_UP_STEP_NOT_FOUND", 404)
      if (step.status !== "PENDING" || step.runId || step.resolvedAt || step.note || step._count.tasks || step._count.contactNotes) throw new ServiceCollectionError("SAVED_STEP_HISTORY_PROTECTED", 409)
      await tx.contactServiceFollowUpStep.delete({ where: { id: step.id } })
    })
    return res.json({ ok: true })
  } catch (error) {
    if (error instanceof ServiceCollectionError) return res.status(error.status).json({ error: error.code })
    return next(error)
  }
})

export default router
