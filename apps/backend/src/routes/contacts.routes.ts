import { type NextFunction, type Response, Router } from "express"
import { z } from "zod"

import {
  decryptCustomFieldValue,
  encryptCustomFieldValue,
} from "../lib/contact-custom-field-encryption.js"
import { buildContactAssigneeUpdate } from "../lib/contact-assignee-update.js"
import { normalizeCustomFieldValue } from "../lib/contact-custom-field-values.js"
import { summarizeVisibleContactFollowUpServices } from "../lib/contact-followup-visibility.js"
import {
  NoteBodyInputSchema,
  NoteTitleInputSchema,
} from "../lib/note-inputs.js"
import { prisma } from "../lib/prisma.js"
import { emitNotificationCreated } from "../lib/realtime.js"
import { deletePrivateObject } from "../lib/private-storage.js"
import { enforceSameOrigin } from "../lib/security.js"
import { normalizeTagSearchTerm, parseCsvIds } from "../lib/tag-utils.js"
import { serializeNotification } from "../lib/task-notifications.js"
import { ensureDefaultContactStatuses } from "../lib/tenant-defaults.js"
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js"

const router = Router()
const prismaWithContacts = prisma as any

const stripHtmlTags = (value: string) => value.replace(/<[^>]*>/g, " ")
const removeUnsafeControls = (value: string) =>
  value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
const sanitizeSingleLineText = (value: string) =>
  removeUnsafeControls(stripHtmlTags(value)).replace(/\s+/g, " ").trim()
const sanitizeMultilineText = (value: string) =>
  removeUnsafeControls(stripHtmlTags(value))
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .trim()

const TenantPathSchema = z.object({
  tenantId: z.string().trim().min(1),
})
const TenantContactPathSchema = TenantPathSchema.extend({
  contactId: z.string().trim().min(1),
})
const TenantContactRelationshipPathSchema = TenantContactPathSchema.extend({
  relationshipId: z.string().trim().min(1),
})
const TenantContactTagPathSchema = TenantContactPathSchema.extend({
  tagId: z.string().trim().min(1),
})
const TenantContactNotePathSchema = TenantContactPathSchema.extend({
  noteId: z.string().trim().min(1),
})
const TenantFieldAccessRequestPathSchema = TenantPathSchema.extend({
  requestId: z.string().trim().min(1),
})

const ContactsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((value) => value === 10 || value === 25, {
      message: "pageSize must be 10 or 25",
    })
    .default(10),
  search: z.string().trim().max(120).optional().default(""),
  statusConfigIds: z.string().trim().max(2000).optional().default(""),
  tagIds: z.string().trim().max(2000).optional().default(""),
  assignedToUserId: z.string().trim().max(120).optional().default(""),
})

const ContactSearchQuerySchema = z.object({
  q: z.string().trim().max(120).optional().default(""),
  excludeContactId: z.string().trim().min(1).optional(),
})

const ContactTagSearchQuerySchema = z.object({
  q: z.string().trim().max(120).optional().default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((value) => value === 10 || value === 25, {
      message: "pageSize must be 10 or 25",
    })
    .default(10),
})

const ContactNotesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((value) => value === 10 || value === 25 || value === 50, {
      message: "pageSize must be 10, 25, or 50",
    })
    .default(10),
  q: z.string().trim().max(160).optional().default(""),
  sort: z
    .enum(["updated_desc", "updated_asc", "created_desc"])
    .default("updated_desc"),
})

const ContactRelationshipTypeSchema = z.enum([
  "FATHER",
  "MOTHER",
  "PARENT",
  "SON",
  "DAUGHTER",
  "CHILD",
  "HUSBAND",
  "WIFE",
  "SPOUSE",
  "PARTNER",
  "BROTHER",
  "SISTER",
  "SIBLING",
  "GRANDFATHER",
  "GRANDMOTHER",
  "GRANDPARENT",
  "GRANDSON",
  "GRANDDAUGHTER",
  "GRANDCHILD",
  "UNCLE",
  "AUNT",
  "AUNT_OR_UNCLE",
  "NEPHEW",
  "NIECE",
  "NIECE_OR_NEPHEW",
  "COUSIN",
  "GUARDIAN",
  "WARD",
  "CAREGIVER",
  "DEPENDENT",
  "FRIEND",
  "OTHER",
])

const CreateContactRelationshipSchema = z.object({
  relatedContactId: z.string().min(1),
  relationshipType: ContactRelationshipTypeSchema,
})

const ContactNoteAttachmentIdsSchema = z
  .array(z.string().trim().min(1))
  .max(10)
  .default([])

const CreateContactNoteSchema = z.object({
  title: NoteTitleInputSchema,
  body: NoteBodyInputSchema,
  contactServiceId: z.string().trim().min(1).nullable().optional(),
  followUpTemplateId: z.string().trim().min(1).nullable().optional(),
  contactServiceFollowUpStepId: z.string().trim().min(1).nullable().optional(),
  attachmentFileIds: ContactNoteAttachmentIdsSchema,
})

const UpdateContactNoteSchema = z.object({
  title: NoteTitleInputSchema,
  body: NoteBodyInputSchema,
  attachmentFileIds: ContactNoteAttachmentIdsSchema,
})

const CreateContactTagSchema = z.object({
  tagId: z.string().min(1),
})
const RequestCustomFieldAccessSchema = z.object({
  fieldId: z.string().min(1),
})
const ResolveCustomFieldAccessRequestSchema = z.object({
  decisionNote: z.preprocess((value) => {
    if (typeof value !== "string") return value
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }, z.string().max(500).nullable().optional()),
})
const ApproveCustomFieldAccessRequestSchema = ResolveCustomFieldAccessRequestSchema.extend({
  grantMode: z.enum(["ONCE", "MINUTES", "HOURS"]).default("ONCE"),
  durationValue: z.coerce.number().int().min(1).optional(),
}).superRefine((value, ctx) => {
  if (value.grantMode === "ONCE") {
    return
  }

  if (!value.durationValue) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["durationValue"],
      message: "Duration is required.",
    })
    return
  }

  if (value.grantMode === "HOURS" && value.durationValue > 12) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["durationValue"],
      message: "Hours cannot exceed 12.",
    })
    return
  }

  if (value.grantMode === "MINUTES" && value.durationValue > 720) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["durationValue"],
      message: "Minutes cannot exceed 720.",
    })
  }
})

const optionalStringField = (max: number) =>
  z.preprocess((value) => {
    if (typeof value !== "string") return value
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }, z.string().max(max).nullable().optional())

const optionalEmailField = () =>
  z.preprocess((value) => {
    if (typeof value !== "string") return value
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed.toLowerCase() : null
  }, z.string().email().max(255).nullable().optional())

const optionalDateField = () =>
  z.preprocess((value) => {
    if (value === null || value === undefined) return null
    if (typeof value !== "string") return value
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }, z.string().datetime().nullable().optional())

const CreateContactSchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  middleName: optionalStringField(120),
  lastName: z.string().trim().min(1).max(120),
  dateOfBirth: optionalDateField(),
  phone: optionalStringField(60),
  email: optionalEmailField(),
  statusConfigId: optionalStringField(80),
})

const UpdateContactSchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  middleName: optionalStringField(120),
  lastName: z.string().trim().min(1).max(120),
  dateOfBirth: optionalDateField(),
  phone: optionalStringField(60),
  secondaryPhone: optionalStringField(60),
  email: optionalEmailField(),
  addressLine1: optionalStringField(255),
  addressLine2: optionalStringField(255),
  city: optionalStringField(120),
  state: optionalStringField(120),
  postalCode: optionalStringField(40),
  country: optionalStringField(120),
  statusConfigId: optionalStringField(80),
  assignedToUserId: optionalStringField(80),
  customFieldValues: z
    .array(
      z.object({
        fieldId: z.string().min(1),
        value: z.unknown().nullable().optional(),
      }),
    )
    .optional()
    .default([]),
})

const UpdateContactAssigneeSchema = z.object({
  assignedToUserId: optionalStringField(80),
})

const UpdateContactStatusSchema = z.object({
  statusConfigId: optionalStringField(80),
})

const NOTIFICATION_SELECT = {
  id: true,
  tenantId: true,
  userId: true,
  type: true,
  title: true,
  body: true,
  readAt: true,
  createdAt: true,
  taskId: true,
  taskReminderId: true,
} as const

const SECURITY_LEVEL_WEIGHT = {
  LOW: 1,
  MEDIUM: 2,
  MAX: 3,
} as const

function canApproveSensitiveFieldAccess(membership: {
  role: "TENANT_ADMIN" | "TENANT_USER"
  securityLevel: "LOW" | "MEDIUM" | "MAX"
}) {
  return membership.role === "TENANT_ADMIN" || membership.securityLevel === "MAX"
}

function canReadSensitiveFieldValue(
  membership: {
    role: "TENANT_ADMIN" | "TENANT_USER"
    securityLevel: "LOW" | "MEDIUM" | "MAX"
  },
  hasGrant: boolean,
) {
  if (membership.role === "TENANT_ADMIN") return true
  if (SECURITY_LEVEL_WEIGHT[membership.securityLevel] >= SECURITY_LEVEL_WEIGHT.MAX) {
    return true
  }
  return hasGrant
}

function isGrantActive(
  grant:
    | {
        expiresAt: Date | null
        remainingReads: number | null
      }
    | undefined,
  now = new Date(),
) {
  if (!grant) return false
  if (typeof grant.remainingReads === "number") {
    return grant.remainingReads > 0
  }
  if (grant.expiresAt) {
    return grant.expiresAt.getTime() > now.getTime()
  }
  return false
}

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
    res.status(403).json({ error: "FORBIDDEN" })
    return null
  }

  return membership
}

function canManageContactTags(membership: {
  role: string
  securityLevel: "LOW" | "MEDIUM" | "MAX"
}) {
  return (
    membership.role === "TENANT_ADMIN" || membership.securityLevel !== "LOW"
  )
}

function canManageContactNote(
  membership: { role: string },
  createdById: string,
  userId: string,
) {
  return membership.role === "TENANT_ADMIN" || createdById === userId
}

function fileNameFromKey(key: string) {
  const segments = key.split("/")
  return segments[segments.length - 1] ?? key
}

async function getValidatedNoteFiles(
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

async function deleteFilesIfUnreferenced(fileIds: string[]) {
  const uniqueFileIds = [...new Set(fileIds)]
  if (uniqueFileIds.length === 0) {
    return
  }

  const attachments = await prismaWithContacts.contactNoteAttachment.findMany({
    where: { fileId: { in: uniqueFileIds } },
    select: { fileId: true },
  })
  const referencedFileIds = new Set(
    attachments.map((attachment: { fileId: string }) => attachment.fileId),
  )
  const orphanFileIds = uniqueFileIds.filter(
    (fileId) => !referencedFileIds.has(fileId),
  )

  if (orphanFileIds.length === 0) {
    return
  }

  const orphanFiles = await prisma.file.findMany({
    where: { id: { in: orphanFileIds } },
    select: { id: true, key: true },
  })

  if (orphanFiles.length === 0) {
    return
  }

  await prisma.file.deleteMany({
    where: { id: { in: orphanFiles.map((file) => file.id) } },
  })

  await Promise.all(
    orphanFiles.map((file) =>
      deletePrivateObject({ path: file.key }).catch(() => undefined),
    ),
  )
}

function serializeContactNote(
  note: {
    id: string
    title: string
    body: string
    createdById: string
    createdAt: Date
    updatedAt: Date
    createdBy: { id: string; name: string | null; email: string }
    contactService?: {
      id: string
      service: {
        name: string
      }
    } | null
    followUpTemplate?: {
      id: string
      name: string
    } | null
    contactServiceFollowUpStep?: {
      id: string
      title: string
    } | null
    attachments: Array<{
      id: string
      file: {
        id: string
        key: string
        contentType: string
        size: number | null
      }
    }>
  },
  membership: { role: string },
  userId: string,
  source?: {
    type: "CONTACT" | "SERVICE"
    contactServiceId?: string
    serviceName?: string
    followUpTemplateName?: string
    followUpStepTitle?: string
  },
) {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    author: {
      id: note.createdBy.id,
      name: note.createdBy.name ?? note.createdBy.email,
      email: note.createdBy.email,
    },
    permissions: {
      canEdit: canManageContactNote(membership, note.createdById, userId),
      canDelete: canManageContactNote(membership, note.createdById, userId),
    },
    source: source ?? {
      type: "CONTACT" as const,
    },
    attachments: note.attachments.map((attachment) => ({
      id: attachment.id,
      fileId: attachment.file.id,
      key: attachment.file.key,
      fileName: fileNameFromKey(attachment.file.key),
      contentType: attachment.file.contentType,
      size: attachment.file.size ?? null,
    })),
  }
}

function buildContactNoteSource(note: {
  contactService?: {
    id: string
    service: {
      name: string
    }
  } | null
  followUpTemplate?: {
    id: string
    name: string
  } | null
  contactServiceFollowUpStep?: {
    id: string
    title: string
  } | null
}) {
  if (!note.contactService && !note.followUpTemplate && !note.contactServiceFollowUpStep) {
    return undefined
  }

  return {
    type: "SERVICE" as const,
    contactServiceId: note.contactService?.id,
    serviceName: note.contactService?.service?.name,
    followUpTemplateName: note.followUpTemplate?.name,
    followUpStepTitle: note.contactServiceFollowUpStep?.title,
  }
}

function decodeCustomFieldValue(
  field: {
    id: string
    isEncrypted: boolean
  },
  storedValue: {
    value: unknown
    valueCiphertext: string | null
    valueIv: string | null
    valueAuthTag: string | null
    valueKeyVersion: number | null
  },
) {
  if (!field.isEncrypted) {
    return storedValue.value ?? null
  }

  return decryptCustomFieldValue({
    valueCiphertext: storedValue.valueCiphertext,
    valueIv: storedValue.valueIv,
    valueAuthTag: storedValue.valueAuthTag,
    valueKeyVersion: storedValue.valueKeyVersion,
  })
}

type StoredCustomFieldValue = {
  fieldId: string
  value: unknown
  valueCiphertext: string | null
  valueIv: string | null
  valueAuthTag: string | null
  valueKeyVersion: number | null
}

const EMPTY_STORED_CUSTOM_FIELD_VALUE: Omit<StoredCustomFieldValue, "fieldId"> =
  {
    value: null,
    valueCiphertext: null,
    valueIv: null,
    valueAuthTag: null,
    valueKeyVersion: null,
  }

function areCustomFieldValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

const RELATIONSHIP_LABELS: Record<
  z.infer<typeof ContactRelationshipTypeSchema>,
  string
> = {
  FATHER: "Father",
  MOTHER: "Mother",
  PARENT: "Parent",
  SON: "Son",
  DAUGHTER: "Daughter",
  CHILD: "Child",
  HUSBAND: "Husband",
  WIFE: "Wife",
  SPOUSE: "Spouse",
  PARTNER: "Partner",
  BROTHER: "Brother",
  SISTER: "Sister",
  SIBLING: "Sibling",
  GRANDFATHER: "Grandfather",
  GRANDMOTHER: "Grandmother",
  GRANDPARENT: "Grandparent",
  GRANDSON: "Grandson",
  GRANDDAUGHTER: "Granddaughter",
  GRANDCHILD: "Grandchild",
  UNCLE: "Uncle",
  AUNT: "Aunt",
  AUNT_OR_UNCLE: "Aunt or Uncle",
  NEPHEW: "Nephew",
  NIECE: "Niece",
  NIECE_OR_NEPHEW: "Niece or Nephew",
  COUSIN: "Cousin",
  GUARDIAN: "Guardian",
  WARD: "Ward",
  CAREGIVER: "Caregiver",
  DEPENDENT: "Dependent",
  FRIEND: "Friend",
  OTHER: "Other",
}

function resolveGenderedType(
  gender: string | null | undefined,
  options: {
    male: z.infer<typeof ContactRelationshipTypeSchema>
    female: z.infer<typeof ContactRelationshipTypeSchema>
    neutral: z.infer<typeof ContactRelationshipTypeSchema>
  },
) {
  if (gender === "MALE") return options.male
  if (gender === "FEMALE") return options.female
  return options.neutral
}

function getReciprocalRelationshipType(
  relationshipType: z.infer<typeof ContactRelationshipTypeSchema>,
  sourceContactGender: string | null | undefined,
) {
  switch (relationshipType) {
    case "FATHER":
    case "MOTHER":
    case "PARENT":
      return resolveGenderedType(sourceContactGender, {
        male: "SON",
        female: "DAUGHTER",
        neutral: "CHILD",
      })
    case "SON":
    case "DAUGHTER":
    case "CHILD":
      return resolveGenderedType(sourceContactGender, {
        male: "FATHER",
        female: "MOTHER",
        neutral: "PARENT",
      })
    case "HUSBAND":
      return resolveGenderedType(sourceContactGender, {
        male: "HUSBAND",
        female: "WIFE",
        neutral: "SPOUSE",
      })
    case "WIFE":
      return resolveGenderedType(sourceContactGender, {
        male: "HUSBAND",
        female: "WIFE",
        neutral: "SPOUSE",
      })
    case "SPOUSE":
    case "PARTNER":
      return relationshipType
    case "BROTHER":
    case "SISTER":
    case "SIBLING":
      return resolveGenderedType(sourceContactGender, {
        male: "BROTHER",
        female: "SISTER",
        neutral: "SIBLING",
      })
    case "GRANDFATHER":
    case "GRANDMOTHER":
    case "GRANDPARENT":
      return resolveGenderedType(sourceContactGender, {
        male: "GRANDSON",
        female: "GRANDDAUGHTER",
        neutral: "GRANDCHILD",
      })
    case "GRANDSON":
    case "GRANDDAUGHTER":
    case "GRANDCHILD":
      return resolveGenderedType(sourceContactGender, {
        male: "GRANDFATHER",
        female: "GRANDMOTHER",
        neutral: "GRANDPARENT",
      })
    case "UNCLE":
    case "AUNT":
    case "AUNT_OR_UNCLE":
      return resolveGenderedType(sourceContactGender, {
        male: "NEPHEW",
        female: "NIECE",
        neutral: "NIECE_OR_NEPHEW",
      })
    case "NEPHEW":
    case "NIECE":
    case "NIECE_OR_NEPHEW":
      return resolveGenderedType(sourceContactGender, {
        male: "UNCLE",
        female: "AUNT",
        neutral: "AUNT_OR_UNCLE",
      })
    case "COUSIN":
      return "COUSIN"
    case "GUARDIAN":
      return "WARD"
    case "WARD":
    case "DEPENDENT":
      return "GUARDIAN"
    case "CAREGIVER":
      return "DEPENDENT"
    case "FRIEND":
      return "FRIEND"
    case "OTHER":
      return "OTHER"
  }
}

function buildRelationshipPairKey(contactId: string, relatedContactId: string) {
  return [contactId, relatedContactId]
    .sort((left, right) => left.localeCompare(right))
    .join(":")
}

function normalizeSearchValue(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? ""
}

function normalizePhoneSearchValue(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "")
}

function splitSearchTokens(value: string | null | undefined) {
  return normalizeSearchValue(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
}

function getSearchTokens(
  value: string | null | undefined,
  options?: { includeSingleCharacter?: boolean },
) {
  const includeSingleCharacter = options?.includeSingleCharacter ?? false

  return splitSearchTokens(value).filter((token) => {
    if (includeSingleCharacter) return true
    return token.length > 1 || /\d/.test(token)
  })
}

function getNameSearchPrefix(token: string, options?: { broad?: boolean }) {
  const normalizedToken = normalizeSearchValue(token)
  if (!normalizedToken) return ""
  if (!options?.broad) return normalizedToken
  if (normalizedToken.length <= 2) return normalizedToken
  return normalizedToken.slice(0, 2)
}

function getTokenDistance(left: string, right: string, maxDistance = 1) {
  if (left === right) return 0
  if (!left || !right) return maxDistance + 1

  const leftLength = left.length
  const rightLength = right.length

  if (Math.abs(leftLength - rightLength) > maxDistance) {
    return maxDistance + 1
  }

  const matrix = Array.from({ length: leftLength + 1 }, () =>
    Array<number>(rightLength + 1).fill(0),
  )

  for (let row = 0; row <= leftLength; row += 1) {
    matrix[row]![0] = row
  }

  for (let column = 0; column <= rightLength; column += 1) {
    matrix[0]![column] = column
  }

  for (let row = 1; row <= leftLength; row += 1) {
    let rowMin = maxDistance + 1

    for (let column = 1; column <= rightLength; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1

      let nextValue = Math.min(
        matrix[row - 1]![column]! + 1,
        matrix[row]![column - 1]! + 1,
        matrix[row - 1]![column - 1]! + cost,
      )

      if (
        row > 1 &&
        column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        nextValue = Math.min(nextValue, matrix[row - 2]![column - 2]! + 1)
      }

      matrix[row]![column] = nextValue
      rowMin = Math.min(rowMin, nextValue)
    }

    if (rowMin > maxDistance) {
      return maxDistance + 1
    }
  }

  return matrix[leftLength]![rightLength]!
}

function getTokenMatchStrength(contactToken: string, queryToken: string) {
  if (!contactToken || !queryToken) return Number.POSITIVE_INFINITY
  if (contactToken === queryToken) return 0
  if (contactToken.startsWith(queryToken) || queryToken.startsWith(contactToken)) {
    return 1
  }
  if (contactToken.includes(queryToken) || queryToken.includes(contactToken)) {
    return 2
  }
  if (queryToken.length >= 4 && contactToken.length >= 4) {
    const distance = getTokenDistance(contactToken, queryToken, 1)
    if (distance <= 1) return 3
  }
  return Number.POSITIVE_INFINITY
}

function getBestTokenStrength(contactTokens: string[], queryToken: string) {
  return contactTokens.reduce((best, candidateToken) => {
    const strength = getTokenMatchStrength(candidateToken, queryToken)
    return Math.min(best, strength)
  }, Number.POSITIVE_INFINITY)
}

function compareMatchStrength(left: number, right: number) {
  const leftFinite = Number.isFinite(left)
  const rightFinite = Number.isFinite(right)

  if (!leftFinite && !rightFinite) return 0
  if (!leftFinite) return 1
  if (!rightFinite) return -1
  return left - right
}

function buildStartsWithClauses(
  fields: string[],
  token: string,
  options?: { broad?: boolean },
) {
  const normalizedToken = normalizeSearchValue(token)
  if (!normalizedToken) return []

  const values = [
    normalizedToken,
    getNameSearchPrefix(normalizedToken, options),
  ].filter(Boolean)

  return fields.flatMap((field) =>
    [...new Set(values)].map((value) => ({
      [field]: { startsWith: value, mode: "insensitive" as const },
    })),
  )
}

function buildContactSearchWhere(
  tenantId: string,
  query: string,
  excludeContactId?: string,
) {
  const normalizedQuery = normalizeSearchValue(query)
  const queryTokens = getSearchTokens(query, { includeSingleCharacter: true })
  const hasEmailLikeQuery = normalizedQuery.includes("@")
  const hasPhoneLikeQuery = normalizePhoneSearchValue(query).length >= 3
  const nameTokens = queryTokens.filter((token) => /[a-z]/i.test(token))

  const andClauses: Array<Record<string, unknown>> = [{ tenantId }]

  if (excludeContactId) {
    andClauses.push({ NOT: { id: excludeContactId } })
  }

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

function getContactSearchMetrics(
  contact: {
    firstName: string
    middleName: string | null
    lastName: string
    email: string | null
    phone: string | null
  },
  query: string,
) {
  const normalizedQuery = normalizeSearchValue(query)
  const queryPhone = normalizePhoneSearchValue(query)
  const queryTokens = getSearchTokens(query, { includeSingleCharacter: true })
  const firstName = normalizeSearchValue(contact.firstName)
  const middleName = normalizeSearchValue(contact.middleName)
  const lastName = normalizeSearchValue(contact.lastName)
  const fullName = [firstName, middleName, lastName].filter(Boolean).join(" ")
  const email = normalizeSearchValue(contact.email)
  const phone = normalizePhoneSearchValue(contact.phone)
  const firstNameTokens = getSearchTokens(contact.firstName, {
    includeSingleCharacter: true,
  })
  const middleNameTokens = getSearchTokens(contact.middleName, {
    includeSingleCharacter: true,
  })
  const lastNameTokens = getSearchTokens(contact.lastName, {
    includeSingleCharacter: true,
  })
  const emailTokens = getSearchTokens(contact.email, {
    includeSingleCharacter: true,
  })
  const candidateTokens = [
    ...firstNameTokens,
    ...middleNameTokens,
    ...lastNameTokens,
    ...emailTokens,
  ]

  let matchedTokenCount = 0
  let exactTokenCount = 0
  let fuzzyTokenCount = 0
  let aggregateTokenStrength = 0
  let middleNameMatchedTokenCount = 0
  let middleNameExactTokenCount = 0

  for (const token of queryTokens) {
    const bestStrength = getBestTokenStrength(candidateTokens, token)

    if (bestStrength !== Number.POSITIVE_INFINITY) {
      matchedTokenCount += 1
      aggregateTokenStrength += bestStrength
      if (bestStrength === 0) {
        exactTokenCount += 1
      }
      if (bestStrength === 3) {
        fuzzyTokenCount += 1
      }
    }

    const middleNameStrength = getBestTokenStrength(middleNameTokens, token)
    if (middleNameStrength !== Number.POSITIVE_INFINITY) {
      middleNameMatchedTokenCount += 1
      if (middleNameStrength === 0) {
        middleNameExactTokenCount += 1
      }
    }
  }

  const firstQueryToken = queryTokens[0] ?? ""
  const lastQueryToken = queryTokens.length > 1 ? queryTokens[queryTokens.length - 1] : ""
  const firstNameStrength = firstQueryToken
    ? getBestTokenStrength(firstNameTokens, firstQueryToken)
    : Number.POSITIVE_INFINITY
  const middleNameStrength =
    queryTokens.length > 2
      ? queryTokens
          .slice(1, -1)
          .reduce(
            (best, token) => Math.min(best, getBestTokenStrength(middleNameTokens, token)),
            Number.POSITIVE_INFINITY,
          )
      : Number.POSITIVE_INFINITY
  const lastNameStrength = lastQueryToken
    ? getBestTokenStrength(lastNameTokens, lastQueryToken)
    : Number.POSITIVE_INFINITY
  const fullNameIncludesQuery = fullName.includes(normalizedQuery)
  const hasStructuredMultiTokenNameMatch =
    queryTokens.length >= 2 &&
    lastNameStrength !== Number.POSITIVE_INFINITY &&
    (firstNameStrength !== Number.POSITIVE_INFINITY ||
      middleNameMatchedTokenCount > 0)

  let rank = 10

  if (fullName === normalizedQuery) rank = 0
  else if (email && email === normalizedQuery) rank = 1
  else if (phone && queryPhone && phone === queryPhone) rank = 2
  else if (
    queryTokens.length >= 2 &&
    matchedTokenCount === queryTokens.length &&
    hasStructuredMultiTokenNameMatch
  ) {
    rank = fuzzyTokenCount > 0 ? 4 : 3
  } else if (hasStructuredMultiTokenNameMatch) {
    rank = 5
  } else if (queryTokens.length > 0 && matchedTokenCount === queryTokens.length) {
    rank = fuzzyTokenCount > 0 ? 6 : 5
  }
  if (
    rank === 10 &&
    (firstName.startsWith(normalizedQuery) || lastName.startsWith(normalizedQuery))
  ) {
    rank = 6
  } else if (rank === 10 && fullName.startsWith(normalizedQuery)) {
    rank = 7
  } else if (rank === 10 && email && email.startsWith(normalizedQuery)) {
    rank = 8
  } else if (rank === 10 && phone && queryPhone && phone.startsWith(queryPhone)) {
    rank = 9
  } else if (
    rank === 10 &&
    (fullName.includes(normalizedQuery) ||
      (email && email.includes(normalizedQuery)) ||
      (phone && queryPhone && phone.includes(queryPhone)) ||
      matchedTokenCount > 0)
  ) {
    rank = 10
  }

  return {
    rank,
    queryTokenCount: queryTokens.length,
    matchedTokenCount,
    exactTokenCount,
    fuzzyTokenCount,
    aggregateTokenStrength,
    firstNameStrength,
    middleNameStrength,
    lastNameStrength,
    middleNameMatchedTokenCount,
    middleNameExactTokenCount,
    hasStructuredMultiTokenNameMatch,
    fullNameIncludesQuery,
  }
}

router.get("/:tenantId/statuses", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    await ensureDefaultContactStatuses(prismaWithContacts, tenantId)

    const statuses = await prismaWithContacts.contactStatusConfig.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        bgColor: true,
        textColor: true,
        sortOrder: true,
        isActive: true,
      },
    })

    return res.json({
      ok: true,
      items: statuses,
    })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId/tags", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const tags = await prismaWithContacts.tenantTag.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        bgColor: true,
        textColor: true,
        sortOrder: true,
      },
    })

    return res.json({
      ok: true,
      items: tags,
    })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId/search", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const { q, excludeContactId } = ContactSearchQuerySchema.parse(req.query)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    if (q.trim().length < 2) {
      return res.json({ ok: true, items: [] })
    }

    const contacts = await prisma.contact.findMany({
      where: buildContactSearchWhere(tenantId, q, excludeContactId),
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 25,
      select: {
        id: true,
        firstName: true,
        middleName: true,
        lastName: true,
        phone: true,
        email: true,
      },
    })

    const rankedContacts = contacts
      .map((contact) => ({
        contact,
        metrics: getContactSearchMetrics(contact, q),
      }))
      .filter(({ metrics }) => {
        if (metrics.rank <= 2) return true

        if (metrics.queryTokenCount >= 2) {
          return metrics.hasStructuredMultiTokenNameMatch
        }

        return metrics.matchedTokenCount > 0 || metrics.fullNameIncludesQuery
      })
      .sort((left, right) => {
        const leftMetrics = left.metrics
        const rightMetrics = right.metrics
      const rankDiff = leftMetrics.rank - rightMetrics.rank
      if (rankDiff !== 0) return rankDiff

      const structuredMatchDiff =
        Number(rightMetrics.hasStructuredMultiTokenNameMatch) -
        Number(leftMetrics.hasStructuredMultiTokenNameMatch)
      if (structuredMatchDiff !== 0) return structuredMatchDiff

      const matchedTokenDiff =
        rightMetrics.matchedTokenCount - leftMetrics.matchedTokenCount
      if (matchedTokenDiff !== 0) return matchedTokenDiff

      const exactTokenDiff = rightMetrics.exactTokenCount - leftMetrics.exactTokenCount
      if (exactTokenDiff !== 0) return exactTokenDiff

      const middleNameExactDiff =
        rightMetrics.middleNameExactTokenCount - leftMetrics.middleNameExactTokenCount
      if (middleNameExactDiff !== 0) return middleNameExactDiff

      const middleNameMatchDiff =
        rightMetrics.middleNameMatchedTokenCount - leftMetrics.middleNameMatchedTokenCount
      if (middleNameMatchDiff !== 0) return middleNameMatchDiff

      const firstNameStrengthDiff = compareMatchStrength(
        leftMetrics.firstNameStrength,
        rightMetrics.firstNameStrength,
      )
      if (firstNameStrengthDiff !== 0) return firstNameStrengthDiff

      const lastNameStrengthDiff = compareMatchStrength(
        leftMetrics.lastNameStrength,
        rightMetrics.lastNameStrength,
      )
      if (lastNameStrengthDiff !== 0) return lastNameStrengthDiff

      const middleNameStrengthDiff = compareMatchStrength(
        leftMetrics.middleNameStrength,
        rightMetrics.middleNameStrength,
      )
      if (middleNameStrengthDiff !== 0) return middleNameStrengthDiff

      const tokenStrengthDiff =
        leftMetrics.aggregateTokenStrength - rightMetrics.aggregateTokenStrength
      if (tokenStrengthDiff !== 0) return tokenStrengthDiff

      const fuzzyTokenDiff = leftMetrics.fuzzyTokenCount - rightMetrics.fuzzyTokenCount
      if (fuzzyTokenDiff !== 0) return fuzzyTokenDiff

      const leftFullName = [left.contact.firstName, left.contact.middleName, left.contact.lastName]
        .filter(Boolean)
        .join(" ")
      const rightFullName = [right.contact.firstName, right.contact.middleName, right.contact.lastName]
        .filter(Boolean)
        .join(" ")

      return leftFullName.localeCompare(rightFullName)
      })

    return res.json({
      ok: true,
      items: rankedContacts.slice(0, 8).map(({ contact }) => ({
        id: contact.id,
        fullName: [contact.firstName, contact.middleName, contact.lastName]
          .filter(Boolean)
          .join(" "),
        phoneNumber: contact.phone ?? null,
        email: contact.email ?? null,
      })),
    })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const { page, pageSize, search, statusConfigIds, tagIds, assignedToUserId } =
      ContactsListQuerySchema.parse(req.query)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const skip = (page - 1) * pageSize
    const selectedStatusConfigIds = parseCsvIds(statusConfigIds)
    const selectedTagIds = parseCsvIds(tagIds)
    const assignedToUserIdFilter =
      assignedToUserId === "ALL" ? "" : assignedToUserId

    const where = {
      tenantId,
      ...(selectedStatusConfigIds.length > 0
        ? {
            statusConfigId: {
              in: selectedStatusConfigIds,
            },
          }
        : {}),
      ...(selectedTagIds.length > 0
        ? {
            tags: {
              some: {
                tagId: {
                  in: selectedTagIds,
                },
              },
            },
          }
        : {}),
      ...(assignedToUserIdFilter
        ? assignedToUserIdFilter === "__UNASSIGNED__"
          ? {
              assignedToUserId: null,
            }
          : {
              assignedToUserId: assignedToUserIdFilter,
              assignedToMembership: {
                is: {
                  status: "ACTIVE" as const,
                },
              },
            }
        : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: "insensitive" as const } },
              {
                middleName: { contains: search, mode: "insensitive" as const },
              },
              { lastName: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } },
              { phone: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    }

    const [total, contacts] = await prisma.$transaction([
      prisma.contact.count({ where }),
      prisma.contact.findMany({
        where,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        skip,
        take: pageSize,
        select: {
          id: true,
          firstName: true,
          middleName: true,
          lastName: true,
          dateOfBirth: true,
          phone: true,
          email: true,
          assignedToMembership: {
            select: {
              userId: true,
              user: {
                select: {
                  name: true,
                  email: true,
                  image: true,
                },
              },
            },
          },
          serviceProcesses: {
            where: {
              status: {
                in: ["IN_PROGRESS", "PENDING_PAYMENT"] as const,
              },
              followUpSteps: {
                some: {},
              },
            },
            select: {
              status: true,
              _count: {
                select: {
                  followUpSteps: true,
                },
              },
              service: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          statusConfig: {
            select: {
              id: true,
              name: true,
              bgColor: true,
              textColor: true,
            },
          },
        },
      }),
    ])

    const totalPages = Math.max(1, Math.ceil(total / pageSize))

    return res.json({
      ok: true,
      items: contacts.map((contact) => {
        const activeFollowUpServices = summarizeVisibleContactFollowUpServices(
          contact.serviceProcesses.map((serviceProcess) => ({
            status: serviceProcess.status,
            followUpStepCount: serviceProcess._count.followUpSteps,
            service: serviceProcess.service,
          })),
        )

        return {
          id: contact.id,
          fullName: [contact.firstName, contact.middleName, contact.lastName]
            .filter(Boolean)
            .join(" "),
          dateOfBirth: contact.dateOfBirth,
          phoneNumber: contact.phone ?? null,
          email: contact.email ?? null,
          assignedTo: contact.assignedToMembership
            ? {
                userId: contact.assignedToMembership.userId,
                name:
                  contact.assignedToMembership.user.name?.trim() ||
                  contact.assignedToMembership.user.email,
                email: contact.assignedToMembership.user.email,
                image: contact.assignedToMembership.user.image ?? null,
              }
            : null,
          activeFollowUpServices,
          status: contact.statusConfig?.name ?? "Unassigned",
          statusConfigId: contact.statusConfig?.id ?? null,
          statusBgColor: contact.statusConfig?.bgColor ?? null,
          statusTextColor: contact.statusConfig?.textColor ?? null,
        }
      }),
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId/:contactId", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId, contactId } = TenantContactPathSchema.parse(req.params)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const [contact, tags, customFields, customFieldValues, relationships] =
      await Promise.all([
        prisma.contact.findFirst({
          where: {
            id: contactId,
            tenantId,
          },
          select: {
            id: true,
            firstName: true,
            middleName: true,
            lastName: true,
            dateOfBirth: true,
            phone: true,
            secondaryPhone: true,
            email: true,
            addressLine1: true,
            addressLine2: true,
            city: true,
            state: true,
            postalCode: true,
            country: true,
            gender: true,
            assignedToUserId: true,
            assignedToMembership: {
              select: {
                userId: true,
                user: {
                  select: {
                    name: true,
                    email: true,
                    image: true,
                  },
                },
              },
            },
            statusConfig: {
              select: {
                id: true,
                name: true,
                bgColor: true,
                textColor: true,
              },
            },
            createdAt: true,
            updatedAt: true,
          },
        }),
        prismaWithContacts.contactTag.findMany({
          where: { tenantId, contactId },
          orderBy: [{ tag: { sortOrder: "asc" } }, { tag: { name: "asc" } }],
          select: {
            tag: {
              select: {
                id: true,
                name: true,
                bgColor: true,
                textColor: true,
                sortOrder: true,
              },
            },
          },
        }),
        prismaWithContacts.contactCustomField.findMany({
          where: { tenantId, isActive: true },
          orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
          select: {
            id: true,
            key: true,
            label: true,
            description: true,
            fieldType: true,
            isRequired: true,
            isEncrypted: true,
            isSensitive: true,
            options: true,
            sortOrder: true,
          },
        }),
        prismaWithContacts.contactCustomFieldValue.findMany({
          where: { tenantId, contactId },
          select: {
            fieldId: true,
            value: true,
            valueCiphertext: true,
            valueIv: true,
            valueAuthTag: true,
            valueKeyVersion: true,
          },
        }),
        prismaWithContacts.contactRelationship.findMany({
          where: {
            tenantId,
            OR: [{ contactId }, { relatedContactId: contactId }],
          },
          orderBy: [{ createdAt: "asc" }],
          select: {
            id: true,
            contactId: true,
            relatedContactId: true,
            relationshipType: true,
            reciprocalRelationshipType: true,
            contact: {
              select: {
                id: true,
                firstName: true,
                middleName: true,
                lastName: true,
                dateOfBirth: true,
                phone: true,
                email: true,
              },
            },
            relatedContact: {
              select: {
                id: true,
                firstName: true,
                middleName: true,
                lastName: true,
                dateOfBirth: true,
                phone: true,
                email: true,
              },
            },
          },
        }),
      ])

    if (!contact) {
      return res.status(404).json({ error: "CONTACT_NOT_FOUND" })
    }

    const storedValueByFieldId = new Map<string, StoredCustomFieldValue>(
      customFieldValues.map((item: StoredCustomFieldValue) => [
        item.fieldId,
        item,
      ]),
    )

    const sensitiveFieldIds = (customFields as Array<any>)
      .filter((field) => field.isSensitive)
      .map((field) => field.id)

    const [grants, ownPendingRequests, approverPendingRequests] = await Promise.all([
      sensitiveFieldIds.length > 0
        ? prismaWithContacts.contactCustomFieldAccessGrant.findMany({
            where: {
              tenantId,
              userId: authed.user.id,
              fieldId: { in: sensitiveFieldIds },
            },
            select: {
              id: true,
              fieldId: true,
              expiresAt: true,
              remainingReads: true,
            },
          })
        : Promise.resolve([]),
      sensitiveFieldIds.length > 0
        ? prismaWithContacts.contactCustomFieldAccessRequest.findMany({
            where: {
              tenantId,
              requesterUserId: authed.user.id,
              fieldId: { in: sensitiveFieldIds },
              status: "PENDING",
            },
            select: {
              id: true,
              fieldId: true,
              status: true,
              createdAt: true,
            },
          })
        : Promise.resolve([]),
      canApproveSensitiveFieldAccess(membership) && sensitiveFieldIds.length > 0
        ? prismaWithContacts.contactCustomFieldAccessRequest.findMany({
            where: {
              tenantId,
              status: "PENDING",
              fieldId: { in: sensitiveFieldIds },
            },
            orderBy: [{ createdAt: "asc" }],
            select: {
              id: true,
              fieldId: true,
              status: true,
              createdAt: true,
              requesterUserId: true,
              requester: {
                select: {
                  name: true,
                  email: true,
                },
              },
            },
          })
        : Promise.resolve([]),
    ])

    const now = new Date()
    const activeGrantByFieldId = new Map<
      string,
      {
        id: string
        fieldId: string
        expiresAt: Date | null
        remainingReads: number | null
      }
    >()
    for (const grant of grants as Array<any>) {
      if (!isGrantActive(grant, now)) continue
      activeGrantByFieldId.set(grant.fieldId, grant)
    }
    const ownPendingByFieldId = new Map<
      string,
      {
        id: string
        status: "PENDING"
        createdAt: Date
      }
    >(
      ownPendingRequests.map((request: any) => [request.fieldId, request]),
    )
    const approverPendingByFieldId = new Map<
      string,
      Array<{
        id: string
        status: "PENDING"
        createdAt: Date
        requesterUserId: string
        requester: {
          name: string
          email: string
        }
      }>
    >()
    for (const request of approverPendingRequests as Array<any>) {
      const existing = approverPendingByFieldId.get(request.fieldId) ?? []
      existing.push({
        id: request.id,
        status: "PENDING",
        createdAt: request.createdAt,
        requesterUserId: request.requesterUserId,
        requester: {
          name: request.requester.name,
          email: request.requester.email,
        },
      })
      approverPendingByFieldId.set(request.fieldId, existing)
    }

    return res.json({
      ok: true,
      contact: {
        id: contact.id,
        firstName: contact.firstName,
        middleName: contact.middleName ?? null,
        lastName: contact.lastName,
        fullName: [contact.firstName, contact.middleName, contact.lastName]
          .filter(Boolean)
          .join(" "),
        dateOfBirth: contact.dateOfBirth,
        phoneNumber: contact.phone ?? null,
        secondaryPhoneNumber: contact.secondaryPhone ?? null,
        email: contact.email ?? null,
        address: {
          addressLine1: contact.addressLine1 ?? null,
          addressLine2: contact.addressLine2 ?? null,
          city: contact.city ?? null,
          state: contact.state ?? null,
          postalCode: contact.postalCode ?? null,
          country: contact.country ?? null,
        },
        assignedTo: contact.assignedToMembership
          ? {
              userId: contact.assignedToMembership.userId,
              name:
                contact.assignedToMembership.user.name?.trim() ||
                contact.assignedToMembership.user.email,
              email: contact.assignedToMembership.user.email,
              image: contact.assignedToMembership.user.image ?? null,
            }
          : null,
        status: contact.statusConfig?.name ?? "Unassigned",
        statusConfigId: contact.statusConfig?.id ?? null,
        statusBgColor: contact.statusConfig?.bgColor ?? null,
        statusTextColor: contact.statusConfig?.textColor ?? null,
        tags: tags.map((item: any) => ({
          id: item.tag.id,
          name: item.tag.name,
          bgColor: item.tag.bgColor,
          textColor: item.tag.textColor,
          sortOrder: item.tag.sortOrder,
        })),
        customFields: customFields.map((field: any) => ({
          ...(function resolveFieldAccess() {
            const hasGrant = activeGrantByFieldId.has(field.id)
            const canReadSensitiveValue = !field.isSensitive
              ? true
              : canReadSensitiveFieldValue(membership, hasGrant)
            const ownPendingRequest = ownPendingByFieldId.get(field.id)
            const pendingApprovals = approverPendingByFieldId.get(field.id) ?? []

            return {
              isSensitive: field.isSensitive,
              isValueRestricted: field.isSensitive && !canReadSensitiveValue,
              canRequestAccess:
                field.isSensitive &&
                membership.securityLevel === "MEDIUM" &&
                membership.role !== "TENANT_ADMIN" &&
                !hasGrant,
              hasAccessGrant: hasGrant,
              pendingAccessRequest: ownPendingRequest
                ? {
                    id: ownPendingRequest.id,
                    status: ownPendingRequest.status,
                    createdAt: ownPendingRequest.createdAt,
                  }
                : null,
              pendingApprovals: pendingApprovals.map((request) => ({
                id: request.id,
                status: request.status,
                createdAt: request.createdAt,
                requesterUserId: request.requesterUserId,
                requesterName: request.requester.name,
                requesterEmail: request.requester.email,
              })),
              value: canReadSensitiveValue
                ? decodeCustomFieldValue(
                    field,
                    storedValueByFieldId.get(field.id) ??
                      EMPTY_STORED_CUSTOM_FIELD_VALUE,
                  )
                : null,
            }
          })(),
          id: field.id,
          key: field.key,
          label: field.label,
          description: field.description ?? null,
          fieldType: field.fieldType,
          isRequired: field.isRequired,
          isEncrypted: field.isEncrypted,
          options: Array.isArray(field.options) ? field.options : [],
          sortOrder: field.sortOrder,
        })),
        relationships: relationships.map((relationship: any) => {
          const isSource = relationship.contactId === contactId
          const related = isSource
            ? relationship.relatedContact
            : relationship.contact
          const relationshipType: z.infer<
            typeof ContactRelationshipTypeSchema
          > = isSource
            ? relationship.relationshipType
            : relationship.reciprocalRelationshipType

          return {
            id: relationship.id,
            relatedContactId: related.id,
            relationshipType,
            relationshipLabel: RELATIONSHIP_LABELS[relationshipType],
            relatedContact: {
              id: related.id,
              fullName: [
                related.firstName,
                related.middleName,
                related.lastName,
              ]
                .filter(Boolean)
                .join(" "),
              dateOfBirth: related.dateOfBirth ?? null,
              phoneNumber: related.phone ?? null,
              email: related.email ?? null,
            },
          }
        }),
        createdAt: contact.createdAt,
        updatedAt: contact.updatedAt,
      },
    })

    const oneTimeGrantIdsToConsume = Array.from(activeGrantByFieldId.values())
      .filter((grant) => typeof grant.remainingReads === "number")
      .filter((grant) => (grant.remainingReads ?? 0) > 0)
      .map((grant) => grant.id)
    if (oneTimeGrantIdsToConsume.length > 0) {
      await Promise.all(
        oneTimeGrantIdsToConsume.map((grantId) =>
          prismaWithContacts.contactCustomFieldAccessGrant.updateMany({
            where: {
              id: grantId,
              remainingReads: {
                gt: 0,
              },
            },
            data: {
              remainingReads: {
                decrement: 1,
              },
            },
          }),
        ),
      )
    }
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId/:contactId/summary", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId, contactId } = TenantContactPathSchema.parse(req.params)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const contact = await prisma.contact.findFirst({
      where: {
        id: contactId,
        tenantId,
      },
      select: {
        id: true,
      },
    })

    if (!contact) {
      return res.status(404).json({ error: "CONTACT_NOT_FOUND" })
    }

    const now = new Date()
    const activeTaskWhere = {
      tenantId,
      contactId,
      OR: [
        { statusConfigId: null },
        {
          statusConfig: {
            is: {
              name: {
                not: "Completed",
                mode: "insensitive" as const,
              },
            },
          },
        },
      ],
    }

    const [
      paymentSummary,
      opportunityCount,
      openOpportunityCount,
      activeTaskCount,
      overdueTaskCount,
      nextAppointment,
    ] = await Promise.all([
      prismaWithContacts.contactServicePayment.aggregate({
        where: {
          tenantId,
          contactService: {
            tenantId,
            contactId,
          },
        },
        _sum: {
          amountCents: true,
        },
        _max: {
          paidAt: true,
        },
      }),
      prismaWithContacts.contactOpportunity.count({
        where: {
          tenantId,
          contactId,
        },
      }),
      prismaWithContacts.contactOpportunity.count({
        where: {
          tenantId,
          contactId,
          result: "OPEN",
        },
      }),
      prismaWithContacts.task.count({
        where: activeTaskWhere,
      }),
      prismaWithContacts.task.count({
        where: {
          ...activeTaskWhere,
          dueDate: {
            lt: now,
          },
        },
      }),
      prismaWithContacts.appointment.findFirst({
        where: {
          tenantId,
          contactId,
          status: {
            in: ["SCHEDULED", "CONFIRMED"],
          },
          startAt: {
            gte: now,
          },
        },
        orderBy: [{ startAt: "asc" }],
        select: {
          id: true,
          title: true,
          startAt: true,
        },
      }),
    ])

    return res.json({
      ok: true,
      summary: {
        totalSpendingCents: paymentSummary._sum.amountCents ?? 0,
        lastPaymentAt: paymentSummary._max.paidAt?.toISOString() ?? null,
        opportunityCount,
        openOpportunityCount,
        activeTaskCount,
        overdueTaskCount,
        nextAppointment: nextAppointment
          ? {
              id: nextAppointment.id,
              title: nextAppointment.title,
              startAt: nextAppointment.startAt.toISOString(),
            }
          : null,
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.post("/:tenantId/custom-field-access-requests", requireAuth, async (req, res, next) => {
  try {
    enforceSameOrigin(req)

    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const payload = RequestCustomFieldAccessSchema.parse(req.body)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    if (membership.securityLevel !== "MEDIUM" || membership.role === "TENANT_ADMIN") {
      return res.status(403).json({ error: "FORBIDDEN" })
    }

    const field = await prismaWithContacts.contactCustomField.findFirst({
      where: {
        id: payload.fieldId,
        tenantId,
        isActive: true,
      },
      select: {
        id: true,
        label: true,
        isSensitive: true,
      },
    })

    if (!field) {
      return res.status(404).json({ error: "CUSTOM_FIELD_NOT_FOUND" })
    }

    if (!field.isSensitive) {
      return res.status(400).json({ error: "FIELD_IS_NOT_SENSITIVE" })
    }

    const [existingGrant, existingPendingRequest] = await Promise.all([
      prismaWithContacts.contactCustomFieldAccessGrant.findFirst({
        where: {
          tenantId,
          fieldId: field.id,
          userId: authed.user.id,
        },
        select: {
          id: true,
          expiresAt: true,
          remainingReads: true,
        },
      }),
      prismaWithContacts.contactCustomFieldAccessRequest.findFirst({
        where: {
          tenantId,
          fieldId: field.id,
          requesterUserId: authed.user.id,
          status: "PENDING",
        },
        select: {
          id: true,
          createdAt: true,
        },
      }),
    ])

    if (isGrantActive(existingGrant ?? undefined)) {
      return res.status(409).json({ error: "CUSTOM_FIELD_ACCESS_ALREADY_GRANTED" })
    }

    if (existingPendingRequest) {
      return res.status(409).json({
        error: "CUSTOM_FIELD_ACCESS_REQUEST_ALREADY_PENDING",
        request: {
          id: existingPendingRequest.id,
          status: "PENDING",
          createdAt: existingPendingRequest.createdAt,
        },
      })
    }

    const approvers = await prisma.membership.findMany({
      where: {
        tenantId,
        status: "ACTIVE",
        userId: { not: authed.user.id },
        OR: [{ role: "TENANT_ADMIN" }, { securityLevel: "MAX" }],
      },
      select: {
        userId: true,
      },
    })

    const requestRecord = await prismaWithContacts.contactCustomFieldAccessRequest.create({
      data: {
        tenantId,
        fieldId: field.id,
        requesterUserId: authed.user.id,
        status: "PENDING",
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
      },
    })

    const approverIds = Array.from(new Set(approvers.map((item: any) => item.userId)))
    if (approverIds.length > 0) {
      const notifications = await Promise.all(
        approverIds.map((approverId) =>
          prismaWithContacts.notification.create({
            data: {
              tenantId,
              userId: approverId,
              eventKey: `custom-field-access-request:${requestRecord.id}:${approverId}`,
              type: "CUSTOM_FIELD_ACCESS_REQUEST",
              title: `Sensitive field access request: ${field.label}`,
              body: `${authed.user.name} requested access to "${field.label}".`,
            },
            select: NOTIFICATION_SELECT,
          }),
        ),
      )

      for (const notification of notifications) {
        const serialized = serializeNotification(notification)
        emitNotificationCreated(serialized.userId, serialized)
      }
    }

    return res.status(201).json({
      ok: true,
      request: requestRecord,
      notifiedApproverCount: approverIds.length,
    })
  } catch (error) {
    return next(error)
  }
})

router.post(
  "/:tenantId/custom-field-access-requests/:requestId/approve",
  requireAuth,
  async (req, res, next) => {
    try {
      enforceSameOrigin(req)

      const authed = req as AuthedRequest
      const { tenantId, requestId } = TenantFieldAccessRequestPathSchema.parse(req.params)
      const payload = ApproveCustomFieldAccessRequestSchema.parse(req.body ?? {})

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      if (!canApproveSensitiveFieldAccess(membership)) {
        return res.status(403).json({ error: "FORBIDDEN" })
      }

      const existing = await prismaWithContacts.contactCustomFieldAccessRequest.findFirst({
        where: {
          id: requestId,
          tenantId,
        },
        select: {
          id: true,
          tenantId: true,
          fieldId: true,
          requesterUserId: true,
          status: true,
          field: {
            select: {
              label: true,
              isSensitive: true,
            },
          },
        },
      })

      if (!existing) {
        return res.status(404).json({ error: "CUSTOM_FIELD_ACCESS_REQUEST_NOT_FOUND" })
      }

      if (existing.status !== "PENDING") {
        return res.status(409).json({ error: "CUSTOM_FIELD_ACCESS_REQUEST_ALREADY_RESOLVED" })
      }

      if (!existing.field.isSensitive) {
        return res.status(400).json({ error: "FIELD_IS_NOT_SENSITIVE" })
      }

      const now = new Date()
      const grantData =
        payload.grantMode === "ONCE"
          ? {
              expiresAt: null,
              remainingReads: 1,
            }
          : payload.grantMode === "MINUTES"
            ? {
                expiresAt: new Date(now.getTime() + (payload.durationValue ?? 0) * 60_000),
                remainingReads: null,
              }
            : {
                expiresAt: new Date(now.getTime() + (payload.durationValue ?? 0) * 3_600_000),
                remainingReads: null,
              }
      const grantSummary =
        payload.grantMode === "ONCE"
          ? "for one-time view"
          : payload.grantMode === "MINUTES"
            ? `for ${payload.durationValue} minute${payload.durationValue === 1 ? "" : "s"}`
            : `for ${payload.durationValue} hour${payload.durationValue === 1 ? "" : "s"}`

      const result = await prisma.$transaction(async (tx) => {
        const txAny = tx as any
        const updatedRequest = await txAny.contactCustomFieldAccessRequest.update({
          where: { id: existing.id },
          data: {
            status: "APPROVED",
            decidedByUserId: authed.user.id,
            decidedAt: new Date(),
            decisionNote: payload.decisionNote ?? null,
          },
          select: {
            id: true,
            status: true,
            createdAt: true,
            decidedAt: true,
            decisionNote: true,
          },
        })

        await txAny.contactCustomFieldAccessGrant.upsert({
          where: {
            tenantId_fieldId_userId: {
              tenantId,
              fieldId: existing.fieldId,
              userId: existing.requesterUserId,
            },
          },
          update: {
            grantedByUserId: authed.user.id,
            expiresAt: grantData.expiresAt,
            remainingReads: grantData.remainingReads,
          },
          create: {
            tenantId,
            fieldId: existing.fieldId,
            userId: existing.requesterUserId,
            grantedByUserId: authed.user.id,
            expiresAt: grantData.expiresAt,
            remainingReads: grantData.remainingReads,
          },
        })

        const notification = await txAny.notification.create({
          data: {
            tenantId,
            userId: existing.requesterUserId,
            eventKey: `custom-field-access-granted:${existing.id}:${existing.requesterUserId}`,
            type: "CUSTOM_FIELD_ACCESS_GRANTED",
            title: `Access granted: ${existing.field.label}`,
            body: `${authed.user.name} approved your request ${grantSummary}.`,
          },
          select: NOTIFICATION_SELECT,
        })

        return { updatedRequest, notification }
      })

      const serialized = serializeNotification(result.notification)
      emitNotificationCreated(serialized.userId, serialized)

      return res.json({
        ok: true,
        request: result.updatedRequest,
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.post(
  "/:tenantId/custom-field-access-requests/:requestId/reject",
  requireAuth,
  async (req, res, next) => {
    try {
      enforceSameOrigin(req)

      const authed = req as AuthedRequest
      const { tenantId, requestId } = TenantFieldAccessRequestPathSchema.parse(req.params)
      const payload = ResolveCustomFieldAccessRequestSchema.parse(req.body ?? {})

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      if (!canApproveSensitiveFieldAccess(membership)) {
        return res.status(403).json({ error: "FORBIDDEN" })
      }

      const existing = await prismaWithContacts.contactCustomFieldAccessRequest.findFirst({
        where: {
          id: requestId,
          tenantId,
        },
        select: {
          id: true,
          status: true,
        },
      })

      if (!existing) {
        return res.status(404).json({ error: "CUSTOM_FIELD_ACCESS_REQUEST_NOT_FOUND" })
      }

      if (existing.status !== "PENDING") {
        return res.status(409).json({ error: "CUSTOM_FIELD_ACCESS_REQUEST_ALREADY_RESOLVED" })
      }

      const updated = await prismaWithContacts.contactCustomFieldAccessRequest.update({
        where: { id: existing.id },
        data: {
          status: "REJECTED",
          decidedByUserId: authed.user.id,
          decidedAt: new Date(),
          decisionNote: payload.decisionNote ?? null,
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
          decidedAt: true,
          decisionNote: true,
        },
      })

      return res.json({
        ok: true,
        request: updated,
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.get(
  "/:tenantId/:contactId/notes",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactId } = TenantContactPathSchema.parse(req.params)
      const { page, pageSize, q, sort } = ContactNotesQuerySchema.parse(req.query)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return
      const skip = (page - 1) * pageSize
      const contactNotesWhere = {
        tenantId,
        contactId,
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" as const } },
                { body: { contains: q, mode: "insensitive" as const } },
                {
                  createdBy: {
                    name: { contains: q, mode: "insensitive" as const },
                  },
                },
              ],
            }
          : {}),
      }
      const serviceNotesWhere = {
        tenantId,
        contactService: {
          contactId,
        },
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" as const } },
                { body: { contains: q, mode: "insensitive" as const } },
                {
                  createdBy: {
                    name: { contains: q, mode: "insensitive" as const },
                  },
                },
                {
                  contactService: {
                    service: {
                      name: { contains: q, mode: "insensitive" as const },
                    },
                  },
                },
              ],
            }
          : {}),
      }

      const [contact, contactNotes, serviceNotes] = await Promise.all([
        prisma.contact.findFirst({
          where: { id: contactId, tenantId },
          select: { id: true },
        }),
        prismaWithContacts.contactNote.findMany({
          where: contactNotesWhere,
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
              },
            },
            contactService: {
              select: {
                id: true,
                service: {
                  select: {
                    name: true,
                  },
                },
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
        }),
        prismaWithContacts.contactServiceNote.findMany({
          where: serviceNotesWhere,
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
              },
            },
            contactService: {
              select: {
                id: true,
                followUpTemplate: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
                service: {
                  select: {
                    name: true,
                  },
                },
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
        }),
      ])

      if (!contact) {
        return res.status(404).json({ error: "CONTACT_NOT_FOUND" })
      }

      const mergedNotes = [
        ...contactNotes.map((note: any) =>
          serializeContactNote(
            note,
            membership,
            authed.user.id,
            buildContactNoteSource(note),
          ),
        ),
        ...serviceNotes.map((note: any) => ({
          id: note.id,
          title: note.title,
          body: note.body,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
          author: {
            id: note.createdBy.id,
            name: note.createdBy.name ?? note.createdBy.email,
            email: note.createdBy.email,
          },
          permissions: {
            canEdit: false,
            canDelete: false,
          },
          source: {
            type: "SERVICE" as const,
            contactServiceId: note.contactService.id,
            serviceName: note.contactService.service.name,
            followUpTemplateName: note.contactService.followUpTemplate?.name,
          },
          attachments: note.attachments.map((attachment: any) => ({
            id: attachment.id,
            fileId: attachment.file.id,
            key: attachment.file.key,
            fileName: fileNameFromKey(attachment.file.key),
            contentType: attachment.file.contentType,
            size: attachment.file.size,
          })),
        })),
      ].sort((left, right) => {
        const leftUpdatedAt = new Date(left.updatedAt).getTime()
        const rightUpdatedAt = new Date(right.updatedAt).getTime()
        const leftCreatedAt = new Date(left.createdAt).getTime()
        const rightCreatedAt = new Date(right.createdAt).getTime()

        if (sort === "updated_asc") {
          if (leftUpdatedAt !== rightUpdatedAt) return leftUpdatedAt - rightUpdatedAt
          return leftCreatedAt - rightCreatedAt
        }

        if (sort === "created_desc") {
          if (leftCreatedAt !== rightCreatedAt) return rightCreatedAt - leftCreatedAt
          return rightUpdatedAt - leftUpdatedAt
        }

        if (leftUpdatedAt !== rightUpdatedAt) return rightUpdatedAt - leftUpdatedAt
        return rightCreatedAt - leftCreatedAt
      })

      const total = mergedNotes.length
      const paginatedNotes = mergedNotes.slice(skip, skip + pageSize)

      return res.json({
        ok: true,
        items: paginatedNotes,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        },
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.post(
  "/:tenantId/:contactId/notes",
  requireAuth,
  async (req, res, next) => {
    try {
      enforceSameOrigin(req)

      const authed = req as AuthedRequest
      const { tenantId, contactId } = TenantContactPathSchema.parse(req.params)
      const payload = CreateContactNoteSchema.parse(req.body)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      const [contact, files, linkedContactService] = await Promise.all([
        prisma.contact.findFirst({
          where: { id: contactId, tenantId },
          select: { id: true },
        }),
        getValidatedNoteFiles(tenantId, payload.attachmentFileIds),
        payload.contactServiceId
          ? prismaWithContacts.contactService.findFirst({
              where: {
                id: payload.contactServiceId,
                tenantId,
                contactId,
              },
              select: {
                id: true,
                followUpTemplateId: true,
              },
            })
          : Promise.resolve(null),
      ])

      if (!contact) {
        return res.status(404).json({ error: "CONTACT_NOT_FOUND" })
      }

      if (!files) {
        return res.status(400).json({ error: "INVALID_NOTE_ATTACHMENTS" })
      }

      let resolvedContactServiceId: string | null = null
      let resolvedFollowUpTemplateId: string | null = null
      let resolvedContactServiceFollowUpStepId: string | null = null

      if (payload.contactServiceId || payload.followUpTemplateId || payload.contactServiceFollowUpStepId) {
        if (!payload.contactServiceId) {
          return res.status(400).json({ error: "CONTACT_SERVICE_ID_REQUIRED" })
        }

        const contactService = linkedContactService

        if (!contactService) {
          return res.status(400).json({ error: "INVALID_CONTACT_SERVICE" })
        }

        if (
          payload.followUpTemplateId &&
          payload.followUpTemplateId !== contactService.followUpTemplateId
        ) {
          return res.status(400).json({ error: "INVALID_FOLLOW_UP_TEMPLATE" })
        }

        if (payload.contactServiceFollowUpStepId) {
          const followUpStep = await prismaWithContacts.contactServiceFollowUpStep.findFirst({
            where: {
              id: payload.contactServiceFollowUpStepId,
              tenantId,
              contactServiceId: contactService.id,
            },
            select: {
              id: true,
            },
          })

          if (!followUpStep) {
            return res.status(400).json({ error: "INVALID_FOLLOW_UP_STEP" })
          }

          resolvedContactServiceFollowUpStepId = followUpStep.id
        }

        resolvedContactServiceId = contactService.id
        resolvedFollowUpTemplateId =
          payload.followUpTemplateId ?? contactService.followUpTemplateId ?? null
      }

      const created = await prisma.$transaction(async (tx) => {
        const txWithContacts = tx as any
        const note = await txWithContacts.contactNote.create({
          data: {
            tenantId,
            contactId,
            contactServiceId: resolvedContactServiceId,
            followUpTemplateId: resolvedFollowUpTemplateId,
            contactServiceFollowUpStepId: resolvedContactServiceFollowUpStepId,
            title: payload.title,
            body: payload.body,
            createdById: authed.user.id,
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
            createdById: true,
            createdAt: true,
            updatedAt: true,
            createdBy: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            contactService: {
              select: {
                id: true,
                service: {
                  select: {
                    name: true,
                  },
                },
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
        })

        return note
      })

      return res.status(201).json({
        ok: true,
        note: serializeContactNote(
          created,
          membership,
          authed.user.id,
          buildContactNoteSource(created),
        ),
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.patch(
  "/:tenantId/:contactId/notes/:noteId",
  requireAuth,
  async (req, res, next) => {
    try {
      enforceSameOrigin(req)

      const authed = req as AuthedRequest
      const { tenantId, contactId, noteId } = TenantContactNotePathSchema.parse(
        req.params,
      )
      const payload = UpdateContactNoteSchema.parse(req.body)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      const [existingNote, files] = await Promise.all([
        prismaWithContacts.contactNote.findFirst({
          where: { id: noteId, tenantId, contactId },
          select: {
            id: true,
            createdById: true,
            attachments: {
              select: {
                id: true,
                fileId: true,
              },
            },
          },
        }),
        getValidatedNoteFiles(tenantId, payload.attachmentFileIds),
      ])

      if (!existingNote) {
        return res.status(404).json({ error: "NOTE_NOT_FOUND" })
      }

      if (
        !canManageContactNote(
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

      const existingFileIds = new Set<string>(
        existingNote.attachments.map(
          (attachment: { fileId: string }) => attachment.fileId,
        ),
      )
      const nextFileIds = new Set<string>(
        files.map((file: { id: string }) => file.id),
      )
      const fileIdsToRemove: string[] = [...existingFileIds].filter(
        (fileId) => !nextFileIds.has(fileId),
      )

      const updated = await prisma.$transaction(async (tx) => {
        const txWithContacts = tx as any
        await txWithContacts.contactNote.update({
          where: { id: noteId },
          data: {
            title: payload.title,
            body: payload.body,
          },
        })

        if (fileIdsToRemove.length > 0) {
          await txWithContacts.contactNoteAttachment.deleteMany({
            where: {
              tenantId,
              noteId,
              fileId: { in: fileIdsToRemove },
            },
          })
        }

        const fileIdsToAdd = files
          .map((file: { id: string }) => file.id)
          .filter((fileId) => !existingFileIds.has(fileId))

        if (fileIdsToAdd.length > 0) {
          await txWithContacts.contactNoteAttachment.createMany({
            data: fileIdsToAdd.map((fileId: string) => ({
              tenantId,
              noteId,
              fileId,
            })),
            skipDuplicates: true,
          })
        }

        return txWithContacts.contactNote.findUniqueOrThrow({
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
              },
            },
            contactService: {
              select: {
                id: true,
                service: {
                  select: {
                    name: true,
                  },
                },
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
        })
      })

      await deleteFilesIfUnreferenced(fileIdsToRemove)

      return res.json({
        ok: true,
        note: serializeContactNote(
          updated,
          membership,
          authed.user.id,
          buildContactNoteSource(updated),
        ),
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.delete(
  "/:tenantId/:contactId/notes/:noteId",
  requireAuth,
  async (req, res, next) => {
    try {
      enforceSameOrigin(req)

      const authed = req as AuthedRequest
      const { tenantId, contactId, noteId } = TenantContactNotePathSchema.parse(
        req.params,
      )

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      const existingNote = await prismaWithContacts.contactNote.findFirst({
        where: { id: noteId, tenantId, contactId },
        select: {
          id: true,
          createdById: true,
          attachments: {
            select: {
              fileId: true,
            },
          },
        },
      })

      if (!existingNote) {
        return res.status(404).json({ error: "NOTE_NOT_FOUND" })
      }

      if (
        !canManageContactNote(
          membership,
          existingNote.createdById,
          authed.user.id,
        )
      ) {
        return res.status(403).json({ error: "FORBIDDEN" })
      }

      const attachmentFileIds: string[] = existingNote.attachments.map(
        (attachment: { fileId: string }) => attachment.fileId,
      )

      await prismaWithContacts.contactNote.delete({
        where: { id: noteId },
      })

      await deleteFilesIfUnreferenced(attachmentFileIds)

      return res.json({ ok: true })
    } catch (error) {
      return next(error)
    }
  },
)

router.post(
  "/:tenantId/:contactId/relationships",
  requireAuth,
  async (req, res, next) => {
    try {
      enforceSameOrigin(req)

      const authed = req as AuthedRequest
      const { tenantId, contactId } = TenantContactPathSchema.parse(req.params)
      const payload = CreateContactRelationshipSchema.parse(req.body)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      if (payload.relatedContactId === contactId) {
        return res.status(400).json({ error: "CANNOT_RELATE_CONTACT_TO_SELF" })
      }

      const [sourceContact, relatedContact, existingRelationship] =
        await Promise.all([
          prisma.contact.findFirst({
            where: { id: contactId, tenantId },
            select: { id: true, gender: true },
          }),
          prisma.contact.findFirst({
            where: { id: payload.relatedContactId, tenantId },
            select: { id: true },
          }),
          prismaWithContacts.contactRelationship.findFirst({
            where: {
              tenantId,
              OR: [
                { contactId, relatedContactId: payload.relatedContactId },
                {
                  contactId: payload.relatedContactId,
                  relatedContactId: contactId,
                },
              ],
            },
            select: { id: true },
          }),
        ])

      if (!sourceContact || !relatedContact) {
        return res.status(404).json({ error: "CONTACT_NOT_FOUND" })
      }

      if (existingRelationship) {
        return res.status(409).json({ error: "RELATIONSHIP_ALREADY_EXISTS" })
      }

      const reciprocalRelationshipType = getReciprocalRelationshipType(
        payload.relationshipType,
        sourceContact.gender,
      )

      const created = await prismaWithContacts.contactRelationship.create({
        data: {
          tenantId,
          contactId,
          relatedContactId: payload.relatedContactId,
          relationshipPairKey: buildRelationshipPairKey(
            contactId,
            payload.relatedContactId,
          ),
          relationshipType: payload.relationshipType,
          reciprocalRelationshipType,
        },
        select: {
          id: true,
          contactId: true,
          relatedContactId: true,
          relationshipType: true,
          reciprocalRelationshipType: true,
          relatedContact: {
            select: {
              id: true,
              firstName: true,
              middleName: true,
              lastName: true,
              dateOfBirth: true,
              phone: true,
              email: true,
            },
          },
        },
      })

      return res.status(201).json({
        ok: true,
        relationship: {
          id: created.id,
          relatedContactId: created.relatedContact.id,
          relationshipType: created.relationshipType,
          relationshipLabel:
            RELATIONSHIP_LABELS[
              created.relationshipType as z.infer<
                typeof ContactRelationshipTypeSchema
              >
            ],
          relatedContact: {
            id: created.relatedContact.id,
            fullName: [
              created.relatedContact.firstName,
              created.relatedContact.middleName,
              created.relatedContact.lastName,
            ]
              .filter(Boolean)
              .join(" "),
            dateOfBirth: created.relatedContact.dateOfBirth ?? null,
            phoneNumber: created.relatedContact.phone ?? null,
            email: created.relatedContact.email ?? null,
          },
        },
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.delete(
  "/:tenantId/:contactId/relationships/:relationshipId",
  requireAuth,
  async (req, res, next) => {
    try {
      enforceSameOrigin(req)

      const authed = req as AuthedRequest
      const { tenantId, contactId, relationshipId } =
        TenantContactRelationshipPathSchema.parse(req.params)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      const existing = await prismaWithContacts.contactRelationship.findFirst({
        where: {
          id: relationshipId,
          tenantId,
          OR: [{ contactId }, { relatedContactId: contactId }],
        },
        select: { id: true },
      })

      if (!existing) {
        return res.status(404).json({ error: "RELATIONSHIP_NOT_FOUND" })
      }

      await prismaWithContacts.contactRelationship.delete({
        where: { id: relationshipId },
      })

      return res.json({ ok: true })
    } catch (error) {
      return next(error)
    }
  },
)

router.post("/:tenantId", requireAuth, async (req, res, next) => {
  try {
    enforceSameOrigin(req)

    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const payload = CreateContactSchema.parse(req.body)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    await ensureDefaultContactStatuses(prismaWithContacts, tenantId)

    let resolvedStatusConfigId = payload.statusConfigId ?? null
    if (resolvedStatusConfigId) {
      const selectedStatus =
        await prismaWithContacts.contactStatusConfig.findUnique({
          where: { id: resolvedStatusConfigId },
          select: { id: true, tenantId: true },
        })

      if (!selectedStatus || selectedStatus.tenantId !== tenantId) {
        return res.status(400).json({ error: "INVALID_STATUS_CONFIG" })
      }
    } else {
      const defaultStatus =
        await prismaWithContacts.contactStatusConfig.findFirst({
          where: {
            tenantId,
            isActive: true,
            name: "Active",
          },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: { id: true },
        })
      resolvedStatusConfigId = defaultStatus?.id ?? null
    }

    const created = await prisma.contact.create({
      data: {
        tenantId,
        firstName: payload.firstName,
        middleName: payload.middleName ?? null,
        lastName: payload.lastName,
        phone: payload.phone ?? null,
        email: payload.email ?? null,
        dateOfBirth: payload.dateOfBirth ? new Date(payload.dateOfBirth) : null,
        statusConfigId: resolvedStatusConfigId,
      },
      select: {
        id: true,
        firstName: true,
        middleName: true,
        lastName: true,
        dateOfBirth: true,
        phone: true,
        email: true,
        statusConfig: {
          select: {
            id: true,
            name: true,
            bgColor: true,
            textColor: true,
          },
        },
        createdAt: true,
      },
    })

    return res.status(201).json({
      ok: true,
      contact: {
        id: created.id,
        firstName: created.firstName,
        middleName: created.middleName ?? null,
        lastName: created.lastName,
        fullName: [created.firstName, created.middleName, created.lastName]
          .filter(Boolean)
          .join(" "),
        dateOfBirth: created.dateOfBirth,
        phoneNumber: created.phone ?? null,
        email: created.email ?? null,
        status: created.statusConfig?.name ?? "Unassigned",
        statusConfigId: created.statusConfig?.id ?? null,
        statusBgColor: created.statusConfig?.bgColor ?? null,
        statusTextColor: created.statusConfig?.textColor ?? null,
        createdAt: created.createdAt,
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId/:contactId/tags/search", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId, contactId } = TenantContactPathSchema.parse(req.params)
    const { q, page, pageSize } = ContactTagSearchQuerySchema.parse(req.query)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const contact = await prisma.contact.findFirst({
      where: { id: contactId, tenantId },
      select: { id: true },
    })

    if (!contact) {
      return res.status(404).json({ error: "CONTACT_NOT_FOUND" })
    }

    const normalizedQuery = normalizeTagSearchTerm(q)
    const skip = (page - 1) * pageSize
    const where = {
      tenantId,
      ...(normalizedQuery
        ? {
            name: {
              contains: normalizedQuery,
            },
          }
        : {}),
      contactTags: {
        none: {
          contactId,
        },
      },
    } as const

    const [total, tags] = await Promise.all([
      prismaWithContacts.tenantTag.count({ where }),
      prismaWithContacts.tenantTag.findMany({
        where,
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        skip,
        take: pageSize,
        select: {
          id: true,
          name: true,
          bgColor: true,
          textColor: true,
          sortOrder: true,
        },
      }),
    ])

    return res.json({
      ok: true,
      items: tags,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
      query: normalizedQuery,
    })
  } catch (error) {
    return next(error)
  }
})

router.post("/:tenantId/:contactId/tags", requireAuth, async (req, res, next) => {
  try {
    enforceSameOrigin(req)

    const authed = req as AuthedRequest
    const { tenantId, contactId } = TenantContactPathSchema.parse(req.params)
    const { tagId } = CreateContactTagSchema.parse(req.body)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return
    if (!canManageContactTags(membership)) {
      return res.status(403).json({ error: "FORBIDDEN" })
    }

    const [contact, tag, existingAssignment] = await Promise.all([
      prisma.contact.findFirst({
        where: { id: contactId, tenantId },
        select: { id: true },
      }),
      prismaWithContacts.tenantTag.findFirst({
        where: { id: tagId, tenantId },
        select: {
          id: true,
          name: true,
          bgColor: true,
          textColor: true,
          sortOrder: true,
        },
      }),
      prismaWithContacts.contactTag.findFirst({
        where: { tenantId, contactId, tagId },
        select: { id: true },
      }),
    ])

    if (!contact) {
      return res.status(404).json({ error: "CONTACT_NOT_FOUND" })
    }

    if (!tag) {
      return res.status(404).json({ error: "TAG_NOT_FOUND" })
    }

    if (existingAssignment) {
      return res.status(409).json({ error: "CONTACT_TAG_ALREADY_EXISTS" })
    }

    await prismaWithContacts.contactTag.create({
      data: {
        tenantId,
        contactId,
        tagId,
      },
    })

    return res.status(201).json({
      ok: true,
      tag,
    })
  } catch (error) {
    return next(error)
  }
})

router.delete("/:tenantId/:contactId/tags/:tagId", requireAuth, async (req, res, next) => {
  try {
    enforceSameOrigin(req)

    const authed = req as AuthedRequest
    const { tenantId, contactId, tagId } = TenantContactTagPathSchema.parse(req.params)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return
    if (!canManageContactTags(membership)) {
      return res.status(403).json({ error: "FORBIDDEN" })
    }

    const existingAssignment = await prismaWithContacts.contactTag.findFirst({
      where: { tenantId, contactId, tagId },
      select: { id: true },
    })

    if (!existingAssignment) {
      return res.status(404).json({ error: "CONTACT_TAG_NOT_FOUND" })
    }

    await prismaWithContacts.contactTag.delete({
      where: { id: existingAssignment.id },
    })

    return res.json({ ok: true })
  } catch (error) {
    return next(error)
  }
})

router.patch("/:tenantId/:contactId/assignee", requireAuth, async (req, res, next) => {
  try {
    enforceSameOrigin(req)

    const authed = req as AuthedRequest
    const { tenantId, contactId } = TenantContactPathSchema.parse(req.params)
    const payload = UpdateContactAssigneeSchema.parse(req.body)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const existing = await prisma.contact.findFirst({
      where: {
        id: contactId,
        tenantId,
      },
      select: {
        id: true,
      },
    })

    if (!existing) {
      return res.status(404).json({ error: "CONTACT_NOT_FOUND" })
    }

    const resolvedAssignedToUserId = payload.assignedToUserId ?? null
    if (resolvedAssignedToUserId) {
      const assigneeMembership = await prisma.membership.findUnique({
        where: {
          userId_tenantId: {
            tenantId,
            userId: resolvedAssignedToUserId,
          },
        },
        select: {
          userId: true,
          status: true,
        },
      })

      if (!assigneeMembership || assigneeMembership.status !== "ACTIVE") {
        return res.status(400).json({ error: "INVALID_ASSIGNEE" })
      }
    }

    const updatedContact = await prisma.contact.update({
      where: { id: contactId },
      data: {
        assignedToUserId: resolvedAssignedToUserId,
      },
      select: {
        id: true,
        assignedToMembership: {
          select: {
            userId: true,
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

    return res.json({
      ok: true,
      contact: {
        id: updatedContact.id,
        assignedTo: updatedContact.assignedToMembership
          ? {
              userId: updatedContact.assignedToMembership.userId,
              name:
                updatedContact.assignedToMembership.user.name?.trim() ||
                updatedContact.assignedToMembership.user.email,
              email: updatedContact.assignedToMembership.user.email,
              image: updatedContact.assignedToMembership.user.image ?? null,
            }
          : null,
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.patch("/:tenantId/:contactId/status", requireAuth, async (req, res, next) => {
  try {
    enforceSameOrigin(req)

    const authed = req as AuthedRequest
    const { tenantId, contactId } = TenantContactPathSchema.parse(req.params)
    const payload = UpdateContactStatusSchema.parse(req.body)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const existing = await prisma.contact.findFirst({
      where: {
        id: contactId,
        tenantId,
      },
      select: {
        id: true,
      },
    })

    if (!existing) {
      return res.status(404).json({ error: "CONTACT_NOT_FOUND" })
    }

    const resolvedStatusConfigId = payload.statusConfigId ?? null
    if (resolvedStatusConfigId) {
      const selectedStatus = await prismaWithContacts.contactStatusConfig.findUnique({
        where: { id: resolvedStatusConfigId },
        select: {
          id: true,
          tenantId: true,
          isActive: true,
        },
      })

      if (!selectedStatus || selectedStatus.tenantId !== tenantId || !selectedStatus.isActive) {
        return res.status(400).json({ error: "INVALID_STATUS_CONFIG" })
      }
    }

    const updatedContact = await prisma.contact.update({
      where: { id: contactId },
      data: {
        statusConfigId: resolvedStatusConfigId,
      },
      select: {
        id: true,
        statusConfig: {
          select: {
            id: true,
            name: true,
            bgColor: true,
            textColor: true,
          },
        },
      },
    })

    return res.json({
      ok: true,
      contact: {
        id: updatedContact.id,
        status: updatedContact.statusConfig?.name ?? "Unassigned",
        statusConfigId: updatedContact.statusConfig?.id ?? null,
        statusBgColor: updatedContact.statusConfig?.bgColor ?? null,
        statusTextColor: updatedContact.statusConfig?.textColor ?? null,
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.patch("/:tenantId/:contactId", requireAuth, async (req, res, next) => {
  try {
    enforceSameOrigin(req)

    const authed = req as AuthedRequest
    const { tenantId, contactId } = TenantContactPathSchema.parse(req.params)
    const payload = UpdateContactSchema.parse(req.body)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const [existing, customFields, existingCustomFieldValues] =
      await Promise.all([
        prisma.contact.findFirst({
          where: {
            id: contactId,
            tenantId,
          },
          select: {
            id: true,
          },
        }),
        prismaWithContacts.contactCustomField.findMany({
          where: { tenantId, isActive: true },
          orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
          select: {
            id: true,
            key: true,
            label: true,
            description: true,
            fieldType: true,
            isRequired: true,
            isEncrypted: true,
            isSensitive: true,
            options: true,
            sortOrder: true,
          },
        }),
        prismaWithContacts.contactCustomFieldValue.findMany({
          where: { tenantId, contactId },
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

    if (!existing) {
      return res.status(404).json({ error: "CONTACT_NOT_FOUND" })
    }

    const sensitiveFieldIds = (customFields as Array<any>)
      .filter((field) => field.isSensitive)
      .map((field) => field.id)
    const grants = sensitiveFieldIds.length
      ? await prismaWithContacts.contactCustomFieldAccessGrant.findMany({
          where: {
            tenantId,
            userId: authed.user.id,
            fieldId: { in: sensitiveFieldIds },
          },
          select: {
            id: true,
            fieldId: true,
            expiresAt: true,
            remainingReads: true,
          },
        })
      : []
    const now = new Date()
    const grantFieldIds = new Set(
      grants
        .filter((grant: any) => isGrantActive(grant, now))
        .map((grant: any) => grant.fieldId),
    )
    const oneTimeGrantIdsToConsume = (grants as Array<any>)
      .filter((grant) => isGrantActive(grant, now))
      .filter((grant) => typeof grant.remainingReads === "number")
      .filter((grant) => (grant.remainingReads ?? 0) > 0)
      .map((grant) => grant.id)

    const customFieldInputMap = new Map(
      payload.customFieldValues.map((item) => [item.fieldId, item.value]),
    )

    const normalizedCustomFieldValues: Array<{
      fieldId: string
      value: unknown
      isEncrypted: boolean
    }> = []
    const customFieldById = new Map<string, any>(
      (customFields as Array<any>).map((field) => [field.id, field]),
    )
    const existingStoredValueByFieldId = new Map<
      string,
      StoredCustomFieldValue
    >(
      existingCustomFieldValues.map((item: StoredCustomFieldValue) => [
        item.fieldId,
        item,
      ]),
    )
    const nextDecodedValueByFieldId = new Map<string, unknown>()

    for (const field of customFields as Array<any>) {
      const existingValue = existingStoredValueByFieldId.get(field.id)
      const hasGrant = grantFieldIds.has(field.id)
      const canReadSensitiveValue = !field.isSensitive
        ? true
        : canReadSensitiveFieldValue(membership, hasGrant)
      nextDecodedValueByFieldId.set(
        field.id,
        canReadSensitiveValue && existingValue
          ? decodeCustomFieldValue(field, existingValue)
          : null,
      )
    }

    for (const field of customFields as Array<any>) {
      const hasGrant = grantFieldIds.has(field.id)
      const canReadSensitiveValue = !field.isSensitive
        ? true
        : canReadSensitiveFieldValue(membership, hasGrant)
      if (field.isSensitive && !canReadSensitiveValue) {
        continue
      }

      const result = normalizeCustomFieldValue(
        {
          id: field.id,
          label: field.label,
          fieldType: field.fieldType,
          isRequired: field.isRequired,
          options: Array.isArray(field.options) ? field.options : [],
        },
        customFieldInputMap.get(field.id),
      )

      if (!result.ok) {
        return res.status(400).json({
          error: "INVALID_CUSTOM_FIELD_VALUE",
          details: [
            { path: `customFieldValues.${field.id}`, message: result.message },
          ],
        })
      }

      normalizedCustomFieldValues.push({
        fieldId: field.id,
        value: result.value,
        isEncrypted: field.isEncrypted,
      })
    }

    let resolvedStatusConfigId = payload.statusConfigId ?? null
    if (resolvedStatusConfigId) {
      const selectedStatus =
        await prismaWithContacts.contactStatusConfig.findUnique({
          where: { id: resolvedStatusConfigId },
          select: { id: true, tenantId: true },
        })

      if (!selectedStatus || selectedStatus.tenantId !== tenantId) {
        return res.status(400).json({ error: "INVALID_STATUS_CONFIG" })
      }
    }

    const assigneeUpdate = buildContactAssigneeUpdate(payload.assignedToUserId)
    if (assigneeUpdate.assignedToUserId) {
      const assigneeMembership = await prisma.membership.findUnique({
        where: {
          userId_tenantId: {
            tenantId,
            userId: assigneeUpdate.assignedToUserId,
          },
        },
        select: {
          userId: true,
          status: true,
        },
      })

      if (!assigneeMembership || assigneeMembership.status !== "ACTIVE") {
        return res.status(400).json({ error: "INVALID_ASSIGNEE" })
      }
    }

    const fieldsToDelete: string[] = []
    const fieldsToCreate: Array<Record<string, unknown>> = []
    const fieldsToUpdate: Array<{
      fieldId: string
      data: Record<string, unknown>
    }> = []

    for (const item of normalizedCustomFieldValues) {
      const field = customFieldById.get(item.fieldId)
      if (!field) {
        continue
      }

      const existingValue = existingStoredValueByFieldId.get(item.fieldId)
      const currentDecodedValue = existingValue
        ? decodeCustomFieldValue(field, existingValue)
        : null
      const isEmpty =
        item.value === null ||
        item.value === undefined ||
        (Array.isArray(item.value) && item.value.length === 0)

      if (isEmpty) {
        if (existingValue) {
          fieldsToDelete.push(item.fieldId)
          nextDecodedValueByFieldId.set(item.fieldId, null)
        }
        continue
      }

      if (areCustomFieldValuesEqual(currentDecodedValue, item.value)) {
        continue
      }

      const persistenceData = item.isEncrypted
        ? {
            value: null,
            ...encryptCustomFieldValue(item.value),
          }
        : {
            value: item.value as any,
            valueCiphertext: null,
            valueIv: null,
            valueAuthTag: null,
            valueKeyVersion: null,
          }

      nextDecodedValueByFieldId.set(item.fieldId, item.value)

      if (existingValue) {
        fieldsToUpdate.push({
          fieldId: item.fieldId,
          data: persistenceData,
        })
      } else {
        fieldsToCreate.push({
          tenantId,
          contactId,
          fieldId: item.fieldId,
          ...persistenceData,
        })
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const txContacts = tx as any
      const updatedContact = await tx.contact.update({
        where: { id: contactId },
        data: {
          firstName: payload.firstName,
          middleName: payload.middleName ?? null,
          lastName: payload.lastName,
          dateOfBirth: payload.dateOfBirth
            ? new Date(payload.dateOfBirth)
            : null,
          phone: payload.phone ?? null,
          secondaryPhone: payload.secondaryPhone ?? null,
          email: payload.email ?? null,
          addressLine1: payload.addressLine1 ?? null,
          addressLine2: payload.addressLine2 ?? null,
          city: payload.city ?? null,
          state: payload.state ?? null,
          postalCode: payload.postalCode ?? null,
          country: payload.country ?? null,
          statusConfigId: resolvedStatusConfigId,
          ...assigneeUpdate,
        },
        select: {
          id: true,
          firstName: true,
          middleName: true,
          lastName: true,
          dateOfBirth: true,
          phone: true,
          secondaryPhone: true,
          email: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          postalCode: true,
          country: true,
          assignedToUserId: true,
          assignedToMembership: {
            select: {
              userId: true,
              user: {
                select: {
                  name: true,
                  email: true,
                  image: true,
                },
              },
            },
          },
          statusConfig: {
            select: {
              id: true,
              name: true,
              bgColor: true,
              textColor: true,
            },
          },
          createdAt: true,
          updatedAt: true,
        },
      })

      if (fieldsToDelete.length > 0) {
        await txContacts.contactCustomFieldValue.deleteMany({
          where: {
            tenantId,
            contactId,
            fieldId: {
              in: fieldsToDelete,
            },
          },
        })
      }

      if (fieldsToCreate.length > 0) {
        await txContacts.contactCustomFieldValue.createMany({
          data: fieldsToCreate as any,
        })
      }

      if (fieldsToUpdate.length > 0) {
        await Promise.all(
          fieldsToUpdate.map((item) =>
            txContacts.contactCustomFieldValue.update({
              where: {
                tenantId_contactId_fieldId: {
                  tenantId,
                  contactId,
                  fieldId: item.fieldId,
                },
              },
              data: item.data as any,
            }),
          ),
        )
      }

      return { updatedContact }
    })

    const tags = await prismaWithContacts.contactTag.findMany({
      where: { tenantId, contactId },
      orderBy: [{ tag: { sortOrder: "asc" } }, { tag: { name: "asc" } }],
      select: {
        tag: {
          select: {
            id: true,
            name: true,
            bgColor: true,
            textColor: true,
            sortOrder: true,
          },
        },
      },
    })

    if (oneTimeGrantIdsToConsume.length > 0) {
      await Promise.all(
        oneTimeGrantIdsToConsume.map((grantId) =>
          prismaWithContacts.contactCustomFieldAccessGrant.updateMany({
            where: {
              id: grantId,
              remainingReads: {
                gt: 0,
              },
            },
            data: {
              remainingReads: {
                decrement: 1,
              },
            },
          }),
        ),
      )
    }

    return res.json({
      ok: true,
      contact: {
        id: updated.updatedContact.id,
        firstName: updated.updatedContact.firstName,
        middleName: updated.updatedContact.middleName ?? null,
        lastName: updated.updatedContact.lastName,
        fullName: [
          updated.updatedContact.firstName,
          updated.updatedContact.middleName,
          updated.updatedContact.lastName,
        ]
          .filter(Boolean)
          .join(" "),
        dateOfBirth: updated.updatedContact.dateOfBirth,
        phoneNumber: updated.updatedContact.phone ?? null,
        secondaryPhoneNumber: updated.updatedContact.secondaryPhone ?? null,
        email: updated.updatedContact.email ?? null,
        address: {
          addressLine1: updated.updatedContact.addressLine1 ?? null,
          addressLine2: updated.updatedContact.addressLine2 ?? null,
          city: updated.updatedContact.city ?? null,
          state: updated.updatedContact.state ?? null,
          postalCode: updated.updatedContact.postalCode ?? null,
          country: updated.updatedContact.country ?? null,
        },
        assignedTo: updated.updatedContact.assignedToMembership
          ? {
              userId: updated.updatedContact.assignedToMembership.userId,
              name:
                updated.updatedContact.assignedToMembership.user.name?.trim() ||
                updated.updatedContact.assignedToMembership.user.email,
              email: updated.updatedContact.assignedToMembership.user.email,
              image: updated.updatedContact.assignedToMembership.user.image ?? null,
            }
          : null,
        status: updated.updatedContact.statusConfig?.name ?? "Unassigned",
        statusConfigId: updated.updatedContact.statusConfig?.id ?? null,
        statusBgColor: updated.updatedContact.statusConfig?.bgColor ?? null,
        statusTextColor: updated.updatedContact.statusConfig?.textColor ?? null,
        tags: tags.map((item: any) => ({
          id: item.tag.id,
          name: item.tag.name,
          bgColor: item.tag.bgColor,
          textColor: item.tag.textColor,
          sortOrder: item.tag.sortOrder,
        })),
        customFields: customFields.map((field: any) => ({
          id: field.id,
          key: field.key,
          label: field.label,
          description: field.description ?? null,
          fieldType: field.fieldType,
          isRequired: field.isRequired,
          isEncrypted: field.isEncrypted,
          isSensitive: field.isSensitive,
          options: Array.isArray(field.options) ? field.options : [],
          sortOrder: field.sortOrder,
          value:
            field.isSensitive &&
            !canReadSensitiveFieldValue(membership, grantFieldIds.has(field.id))
              ? null
              : nextDecodedValueByFieldId.get(field.id) ?? null,
          isValueRestricted:
            field.isSensitive &&
            !canReadSensitiveFieldValue(membership, grantFieldIds.has(field.id)),
          canRequestAccess:
            field.isSensitive &&
            membership.securityLevel === "MEDIUM" &&
            membership.role !== "TENANT_ADMIN" &&
            !grantFieldIds.has(field.id),
          hasAccessGrant: grantFieldIds.has(field.id),
          pendingAccessRequest: null,
          pendingApprovals: [],
        })),
        createdAt: updated.updatedContact.createdAt,
        updatedAt: updated.updatedContact.updatedAt,
      },
    })
  } catch (error) {
    return next(error)
  }
})

export default router
