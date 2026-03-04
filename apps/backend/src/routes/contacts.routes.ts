import { type NextFunction, type Response, Router } from "express"
import { z } from "zod"

import {
  decryptCustomFieldValue,
  encryptCustomFieldValue,
} from "../lib/contact-custom-field-encryption.js"
import { prisma } from "../lib/prisma.js"
import { enforceSameOrigin } from "../lib/security.js"
import { deleteObject } from "../lib/s3.js"
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js"

const router = Router()
const prismaWithContacts = prisma as any

const TenantPathSchema = z.object({
  tenantId: z.string().min(1),
})
const TenantContactPathSchema = TenantPathSchema.extend({
  contactId: z.string().min(1),
})
const TenantContactRelationshipPathSchema = TenantContactPathSchema.extend({
  relationshipId: z.string().min(1),
})
const TenantContactTagPathSchema = TenantContactPathSchema.extend({
  tagId: z.string().min(1),
})
const TenantContactNotePathSchema = TenantContactPathSchema.extend({
  noteId: z.string().min(1),
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
  statusConfigId: z.string().trim().max(80).optional(),
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
  .array(z.string().min(1))
  .max(10)
  .default([])

const CreateContactNoteSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(5000),
  attachmentFileIds: ContactNoteAttachmentIdsSchema,
})

const UpdateContactNoteSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(5000),
  attachmentFileIds: ContactNoteAttachmentIdsSchema,
})

const CreateContactTagSchema = z.object({
  tagId: z.string().min(1),
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

function normalizeTagSearchTerm(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
}

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

const CONTACT_DEFAULT_STATUSES = [
  {
    name: "Active",
    bgColor: "#DCFCE7",
    textColor: "#166534",
    sortOrder: 10,
  },
  {
    name: "Inactive",
    bgColor: "#E2E8F0",
    textColor: "#334155",
    sortOrder: 20,
  },
  {
    name: "Pending",
    bgColor: "#FEF3C7",
    textColor: "#92400E",
    sortOrder: 30,
  },
] as const

async function ensureDefaultContactStatuses(tenantId: string) {
  await prismaWithContacts.contactStatusConfig.updateMany({
    where: {
      tenantId,
      name: { in: CONTACT_DEFAULT_STATUSES.map((item) => item.name) },
      isSystemDefault: false,
    },
    data: {
      isSystemDefault: true,
    },
  })

  await prismaWithContacts.contactStatusConfig.createMany({
    data: CONTACT_DEFAULT_STATUSES.map((item) => ({
      tenantId,
      name: item.name,
      bgColor: item.bgColor,
      textColor: item.textColor,
      sortOrder: item.sortOrder,
      isActive: true,
      isSystemDefault: true,
    })),
    skipDuplicates: true,
  })
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
    },
  })

  if (!membership || membership.status !== "ACTIVE") {
    res.status(403).json({ error: "FORBIDDEN" })
    return null
  }

  return membership
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
      deleteObject({ key: file.key }).catch(() => undefined),
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

function normalizeCustomFieldValue(
  field: {
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
  },
  rawValue: unknown,
) {
  if (field.fieldType === "CHECKBOX") {
    const value = typeof rawValue === "boolean" ? rawValue : false
    if (field.isRequired && value !== true) {
      return { ok: false as const, message: `${field.label} is required.` }
    }
    return { ok: true as const, value }
  }

  if (field.fieldType === "MULTI_SELECT") {
    const value = Array.isArray(rawValue)
      ? rawValue.filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
      : []

    if (value.some((item) => !field.options.includes(item))) {
      return {
        ok: false as const,
        message: `${field.label} has invalid option values.`,
      }
    }
    if (field.isRequired && value.length === 0) {
      return { ok: false as const, message: `${field.label} is required.` }
    }
    return { ok: true as const, value: value.length > 0 ? value : null }
  }

  if (field.fieldType === "NUMBER") {
    if (rawValue === null || rawValue === undefined || rawValue === "") {
      if (field.isRequired) {
        return { ok: false as const, message: `${field.label} is required.` }
      }
      return { ok: true as const, value: null }
    }

    const numericValue =
      typeof rawValue === "number"
        ? rawValue
        : typeof rawValue === "string"
          ? Number(rawValue)
          : Number.NaN

    if (Number.isNaN(numericValue)) {
      return { ok: false as const, message: `${field.label} must be a number.` }
    }

    return { ok: true as const, value: numericValue }
  }

  if (field.fieldType === "CURRENCY") {
    if (rawValue === null || rawValue === undefined || rawValue === "") {
      if (field.isRequired) {
        return { ok: false as const, message: `${field.label} is required.` }
      }
      return { ok: true as const, value: null }
    }

    const numericValue =
      typeof rawValue === "number"
        ? rawValue
        : typeof rawValue === "string"
          ? Number(rawValue)
          : Number.NaN

    if (Number.isNaN(numericValue)) {
      return {
        ok: false as const,
        message: `${field.label} must be a valid amount.`,
      }
    }

    return { ok: true as const, value: numericValue }
  }

  if (field.fieldType === "PHONE") {
    const textValue =
      typeof rawValue === "string" && rawValue.trim().length > 0
        ? rawValue.trim()
        : null

    if (field.isRequired && !textValue) {
      return { ok: false as const, message: `${field.label} is required.` }
    }

    if (textValue && !/^\+[1-9]\d{7,14}$/.test(textValue)) {
      return {
        ok: false as const,
        message: `${field.label} must be a valid phone number.`,
      }
    }

    return { ok: true as const, value: textValue }
  }

  if (field.fieldType === "DATE") {
    if (rawValue === null || rawValue === undefined || rawValue === "") {
      if (field.isRequired) {
        return { ok: false as const, message: `${field.label} is required.` }
      }
      return { ok: true as const, value: null }
    }

    if (typeof rawValue !== "string") {
      return {
        ok: false as const,
        message: `${field.label} must be a valid date.`,
      }
    }

    const parsedDate = new Date(rawValue)
    if (Number.isNaN(parsedDate.getTime())) {
      return {
        ok: false as const,
        message: `${field.label} must be a valid date.`,
      }
    }

    return { ok: true as const, value: parsedDate.toISOString() }
  }

  const textValue =
    typeof rawValue === "string" && rawValue.trim().length > 0
      ? rawValue.trim()
      : null

  if (
    (field.fieldType === "SELECT" || field.fieldType === "RADIO") &&
    textValue
  ) {
    if (!field.options.includes(textValue)) {
      return {
        ok: false as const,
        message: `${field.label} has an invalid option.`,
      }
    }
  }

  if (field.isRequired && !textValue) {
    return { ok: false as const, message: `${field.label} is required.` }
  }

  return { ok: true as const, value: textValue }
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
  return value?.trim().toLowerCase() ?? ""
}

function normalizePhoneSearchValue(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "")
}

function getContactSearchRank(
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
  const firstName = normalizeSearchValue(contact.firstName)
  const middleName = normalizeSearchValue(contact.middleName)
  const lastName = normalizeSearchValue(contact.lastName)
  const fullName = [firstName, middleName, lastName].filter(Boolean).join(" ")
  const email = normalizeSearchValue(contact.email)
  const phone = normalizePhoneSearchValue(contact.phone)

  if (fullName === normalizedQuery) return 0
  if (email && email === normalizedQuery) return 1
  if (phone && queryPhone && phone === queryPhone) return 2
  if (
    firstName.startsWith(normalizedQuery) ||
    lastName.startsWith(normalizedQuery)
  )
    return 3
  if (fullName.startsWith(normalizedQuery)) return 4
  if (email && email.startsWith(normalizedQuery)) return 5
  if (phone && queryPhone && phone.startsWith(queryPhone)) return 6
  if (fullName.includes(normalizedQuery)) return 7
  if (email && email.includes(normalizedQuery)) return 8
  if (phone && queryPhone && phone.includes(queryPhone)) return 9
  return 10
}

router.get("/:tenantId/statuses", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    await ensureDefaultContactStatuses(tenantId)

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
      where: {
        tenantId,
        ...(excludeContactId ? { NOT: { id: excludeContactId } } : {}),
        OR: [
          { firstName: { contains: q, mode: "insensitive" } },
          { middleName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { phone: { contains: q, mode: "insensitive" } },
        ],
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 20,
      select: {
        id: true,
        firstName: true,
        middleName: true,
        lastName: true,
        phone: true,
        email: true,
      },
    })

    const rankedContacts = [...contacts].sort((left, right) => {
      const rankDiff =
        getContactSearchRank(left, q) - getContactSearchRank(right, q)
      if (rankDiff !== 0) return rankDiff

      const leftFullName = [left.firstName, left.middleName, left.lastName]
        .filter(Boolean)
        .join(" ")
      const rightFullName = [right.firstName, right.middleName, right.lastName]
        .filter(Boolean)
        .join(" ")

      return leftFullName.localeCompare(rightFullName)
    })

    return res.json({
      ok: true,
      items: rankedContacts.slice(0, 8).map((contact) => ({
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
    const { page, pageSize, search, statusConfigId } =
      ContactsListQuerySchema.parse(req.query)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const skip = (page - 1) * pageSize

    const where = {
      tenantId,
      ...(statusConfigId ? { statusConfigId } : {}),
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
      items: contacts.map((contact) => ({
        id: contact.id,
        fullName: [contact.firstName, contact.middleName, contact.lastName]
          .filter(Boolean)
          .join(" "),
        dateOfBirth: contact.dateOfBirth,
        phoneNumber: contact.phone ?? null,
        email: contact.email ?? null,
        status: contact.statusConfig?.name ?? "Unassigned",
        statusConfigId: contact.statusConfig?.id ?? null,
        statusBgColor: contact.statusConfig?.bgColor ?? null,
        statusTextColor: contact.statusConfig?.textColor ?? null,
        followUps: 0,
      })),
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
          id: field.id,
          key: field.key,
          label: field.label,
          description: field.description ?? null,
          fieldType: field.fieldType,
          isRequired: field.isRequired,
          isEncrypted: field.isEncrypted,
          options: Array.isArray(field.options) ? field.options : [],
          sortOrder: field.sortOrder,
          value: decodeCustomFieldValue(
            field,
            storedValueByFieldId.get(field.id) ??
              EMPTY_STORED_CUSTOM_FIELD_VALUE,
          ),
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
              phoneNumber: related.phone ?? null,
              email: related.email ?? null,
            },
          }
        }),
        createdAt: contact.createdAt,
        updatedAt: contact.updatedAt,
      },
    })
  } catch (error) {
    return next(error)
  }
})

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
      const where = {
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
      const orderBy =
        sort === "updated_asc"
          ? [{ updatedAt: "asc" as const }, { createdAt: "asc" as const }]
          : sort === "created_desc"
            ? [{ createdAt: "desc" as const }, { updatedAt: "desc" as const }]
            : [{ updatedAt: "desc" as const }, { createdAt: "desc" as const }]

      const [contact, total, notes] = await Promise.all([
        prisma.contact.findFirst({
          where: { id: contactId, tenantId },
          select: { id: true },
        }),
        prismaWithContacts.contactNote.count({ where }),
        prismaWithContacts.contactNote.findMany({
          where,
          orderBy,
          skip,
          take: pageSize,
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

      return res.json({
        ok: true,
        items: notes.map((note: any) =>
          serializeContactNote(note, membership, authed.user.id),
        ),
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

      const [contact, files] = await Promise.all([
        prisma.contact.findFirst({
          where: { id: contactId, tenantId },
          select: { id: true },
        }),
        getValidatedNoteFiles(tenantId, payload.attachmentFileIds),
      ])

      if (!contact) {
        return res.status(404).json({ error: "CONTACT_NOT_FOUND" })
      }

      if (!files) {
        return res.status(400).json({ error: "INVALID_NOTE_ATTACHMENTS" })
      }

      const created = await prisma.$transaction(async (tx) => {
        const txWithContacts = tx as any
        const note = await txWithContacts.contactNote.create({
          data: {
            tenantId,
            contactId,
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
        note: serializeContactNote(created, membership, authed.user.id),
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
        note: serializeContactNote(updated, membership, authed.user.id),
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

    await ensureDefaultContactStatuses(tenantId)

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
      nextDecodedValueByFieldId.set(
        field.id,
        existingValue ? decodeCustomFieldValue(field, existingValue) : null,
      )
    }

    for (const field of customFields as Array<any>) {
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
        status: updated.updatedContact.statusConfig?.name ?? "Unassigned",
        statusConfigId: updated.updatedContact.statusConfig?.id ?? null,
        statusBgColor: updated.updatedContact.statusConfig?.bgColor ?? null,
        statusTextColor: updated.updatedContact.statusConfig?.textColor ?? null,
        customFields: customFields.map((field: any) => ({
          id: field.id,
          key: field.key,
          label: field.label,
          description: field.description ?? null,
          fieldType: field.fieldType,
          isRequired: field.isRequired,
          isEncrypted: field.isEncrypted,
          options: Array.isArray(field.options) ? field.options : [],
          sortOrder: field.sortOrder,
          value: nextDecodedValueByFieldId.get(field.id) ?? null,
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
