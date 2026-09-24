import { parsePhoneNumberFromString } from "libphonenumber-js"

export const CONTACT_TEMPLATE_DATE_FORMATS = [
  { value: "short", label: "Short", preview: "09/23/2026" },
  { value: "medium", label: "Medium", preview: "Sep 23, 2026" },
  { value: "long", label: "Long", preview: "September 23, 2026" },
  { value: "weekday", label: "With weekday", preview: "Wednesday, September 23, 2026" },
  { value: "iso", label: "ISO", preview: "2026-09-23" },
] as const

export const CONTACT_TEMPLATE_PHONE_FORMATS = [
  { value: "national", label: "National", preview: "(541) 313-4664" },
  { value: "international", label: "International", preview: "+1 541 313 4664" },
  { value: "e164", label: "E.164", preview: "+15413134664" },
] as const

export type ContactTemplateDateFormat = (typeof CONTACT_TEMPLATE_DATE_FORMATS)[number]["value"]
export type ContactTemplatePhoneFormat = (typeof CONTACT_TEMPLATE_PHONE_FORMATS)[number]["value"]

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

export type ContactTemplateFieldDefinition = {
  key: string
  label: string
  fieldType: ContactTemplateFieldType
}

export const CONTACT_TEMPLATE_REGULAR_FIELDS = [
  { key: "name", label: "Full name", fieldType: "TEXT" },
  { key: "first_name", label: "First name", fieldType: "TEXT" },
  { key: "middle_name", label: "Middle name", fieldType: "TEXT" },
  { key: "last_name", label: "Last name", fieldType: "TEXT" },
  { key: "email", label: "Email", fieldType: "TEXT" },
  { key: "phone", label: "Phone", fieldType: "PHONE" },
  { key: "secondary_phone", label: "Secondary phone", fieldType: "PHONE" },
  { key: "status", label: "Status", fieldType: "TEXT" },
  { key: "assigned_to", label: "Assigned to", fieldType: "TEXT" },
  { key: "tags", label: "Tags", fieldType: "MULTI_SELECT" },
  { key: "date_of_birth", label: "Date of birth", fieldType: "DATE" },
  { key: "gender", label: "Gender", fieldType: "TEXT" },
  { key: "height", label: "Height", fieldType: "TEXT" },
  { key: "weight", label: "Weight", fieldType: "TEXT" },
  { key: "deceased_at", label: "Deceased date", fieldType: "DATE" },
  { key: "smoker_status", label: "Smoker status", fieldType: "TEXT" },
  { key: "medicare_part_a", label: "Medicare Part A", fieldType: "CHECKBOX" },
  { key: "medicare_part_b", label: "Medicare Part B", fieldType: "CHECKBOX" },
  { key: "address_line_1", label: "Address line 1", fieldType: "TEXT" },
  { key: "address_line_2", label: "Address line 2", fieldType: "TEXT" },
  { key: "city", label: "City", fieldType: "TEXT" },
  { key: "state", label: "State", fieldType: "TEXT" },
  { key: "postal_code", label: "Postal code", fieldType: "TEXT" },
  { key: "country", label: "Country", fieldType: "TEXT" },
  { key: "mailing_address_line_1", label: "Mailing address line 1", fieldType: "TEXT" },
  { key: "mailing_address_line_2", label: "Mailing address line 2", fieldType: "TEXT" },
  { key: "mailing_city", label: "Mailing city", fieldType: "TEXT" },
  { key: "mailing_state", label: "Mailing state", fieldType: "TEXT" },
  { key: "mailing_postal_code", label: "Mailing postal code", fieldType: "TEXT" },
  { key: "mailing_country", label: "Mailing country", fieldType: "TEXT" },
  { key: "emergency_contact_name", label: "Emergency contact name", fieldType: "TEXT" },
  { key: "emergency_contact_phone", label: "Emergency contact phone", fieldType: "PHONE" },
  { key: "emergency_contact_relationship", label: "Emergency contact relationship", fieldType: "TEXT" },
  { key: "servicing_agent", label: "Servicing agent", fieldType: "TEXT" },
  { key: "additional_agent", label: "Additional agent", fieldType: "TEXT" },
  { key: "lead_date", label: "Lead date", fieldType: "DATE" },
  { key: "lead_source", label: "Lead source", fieldType: "TEXT" },
  { key: "lead_other_source", label: "Other lead source", fieldType: "TEXT" },
  { key: "created_at", label: "Created date", fieldType: "DATE" },
  { key: "updated_at", label: "Last updated date", fieldType: "DATE" },
] as const satisfies readonly ContactTemplateFieldDefinition[]

type ContactTemplateFormat =
  | { kind: "date"; value: ContactTemplateDateFormat }
  | { kind: "phone"; value: ContactTemplatePhoneFormat }
  | { kind: "currency"; value: "USD" }

export type ContactTemplateToken = {
  raw: string
  source: "CONTACT" | "CUSTOM_FIELD"
  key: string
  format?: ContactTemplateFormat
  start: number
  end: number
}

export type ContactTemplateIssue = {
  code: string
  message: string
  token?: string
}

type CustomFieldReference = ContactTemplateFieldDefinition & {
  isActive: boolean
  isEncrypted: boolean
  isSensitive: boolean
}

const REGULAR_FIELD_MAP = new Map<string, ContactTemplateFieldDefinition>(
  CONTACT_TEMPLATE_REGULAR_FIELDS.map((field) => [field.key, field]),
)
const DATE_FORMATS = new Set<string>(CONTACT_TEMPLATE_DATE_FORMATS.map((item) => item.value))
const PHONE_FORMATS = new Set<string>(CONTACT_TEMPLATE_PHONE_FORMATS.map((item) => item.value))
const BRACED_EXPRESSION = /\{([^{}]*)\}/g
const CONTACT_TOKEN_START = /\{contact\./g

function parseFormat(value: string): ContactTemplateFormat | null {
  const separatorIndex = value.indexOf(":")
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) return null
  const kind = value.slice(0, separatorIndex)
  const option = value.slice(separatorIndex + 1)
  if (kind === "date" && DATE_FORMATS.has(option)) {
    return { kind, value: option as ContactTemplateDateFormat }
  }
  if (kind === "phone" && PHONE_FORMATS.has(option)) {
    return { kind, value: option as ContactTemplatePhoneFormat }
  }
  if (kind === "currency" && option === "USD") return { kind, value: option }
  return null
}

function parseToken(raw: string, expression: string, start: number, end: number) {
  const pieces = expression.split("|")
  if (pieces.length > 2) return null
  const path = pieces[0] ?? ""
  const format = pieces[1] ? parseFormat(pieces[1]) : undefined
  if (pieces[1] && !format) return null

  const customMatch = path.match(/^contact\.custom_field\.([a-z0-9_]+)$/)
  if (customMatch) {
    return {
      raw,
      source: "CUSTOM_FIELD" as const,
      key: customMatch[1]!,
      ...(format ? { format } : {}),
      start,
      end,
    }
  }

  const regularMatch = path.match(/^contact\.([a-z][a-z0-9_]*)$/)
  if (!regularMatch) return null
  return {
    raw,
    source: "CONTACT" as const,
    key: regularMatch[1]!,
    ...(format ? { format } : {}),
    start,
    end,
  }
}

export function parseContactTemplate(template: string) {
  const tokens: ContactTemplateToken[] = []
  const issues: ContactTemplateIssue[] = []
  const contactExpressionRanges: Array<{ start: number; end: number }> = []

  for (const match of template.matchAll(BRACED_EXPRESSION)) {
    const expression = match[1] ?? ""
    if (!expression.startsWith("contact.")) continue
    const start = match.index
    const end = start + match[0].length
    contactExpressionRanges.push({ start, end })
    if (template[start - 1] === "{" || template[end] === "}") {
      issues.push({
        code: "DOUBLE_BRACES_NOT_SUPPORTED",
        message: "Contact fields use one pair of braces, for example {contact.name}.",
        token: match[0],
      })
      continue
    }
    const token = parseToken(match[0], expression, start, end)
    if (!token) {
      issues.push({
        code: "INVALID_CONTACT_TOKEN",
        message: `The contact field token ${match[0]} is not valid.`,
        token: match[0],
      })
      continue
    }
    tokens.push(token)
  }

  for (const match of template.matchAll(CONTACT_TOKEN_START)) {
    const start = match.index
    const isContained = contactExpressionRanges.some((range) => start >= range.start && start < range.end)
    if (!isContained) {
      issues.push({
        code: "UNCLOSED_CONTACT_TOKEN",
        message: "A contact field token is missing its closing brace.",
      })
    }
  }

  return { tokens, issues }
}

function formatMatchesField(format: ContactTemplateFormat | undefined, fieldType: ContactTemplateFieldType) {
  if (!format) return true
  if (format.kind === "date") return fieldType === "DATE"
  if (format.kind === "phone") return fieldType === "PHONE"
  return fieldType === "CURRENCY"
}

export function validateContactTemplate(
  template: string,
  customFields: readonly CustomFieldReference[] = [],
) {
  const parsed = parseContactTemplate(template)
  const issues = [...parsed.issues]
  const customFieldMap = new Map(customFields.map((field) => [field.key, field]))

  for (const token of parsed.tokens) {
    const field = token.source === "CONTACT"
      ? REGULAR_FIELD_MAP.get(token.key)
      : customFieldMap.get(token.key)
    if (!field) {
      issues.push({
        code: "CONTACT_TEMPLATE_FIELD_NOT_FOUND",
        message: `The field used by ${token.raw} is no longer available.`,
        token: token.raw,
      })
      continue
    }
    const customField = token.source === "CUSTOM_FIELD"
      ? customFieldMap.get(token.key)
      : undefined
    if (
      customField &&
      (!customField.isActive || customField.isEncrypted || customField.isSensitive)
    ) {
      issues.push({
        code: "CONTACT_TEMPLATE_FIELD_NOT_ALLOWED",
        message: `${customField.label} cannot be used in automation notes.`,
        token: token.raw,
      })
      continue
    }
    if (!formatMatchesField(token.format, field.fieldType)) {
      issues.push({
        code: "CONTACT_TEMPLATE_FORMAT_MISMATCH",
        message: `The format used by ${token.raw} does not match ${field.label}.`,
        token: token.raw,
      })
    }
  }

  return { valid: issues.length === 0, tokens: parsed.tokens, issues }
}

export function contactTemplateCustomFieldKeys(template: string) {
  return [...new Set(
    parseContactTemplate(template).tokens
      .filter((token) => token.source === "CUSTOM_FIELD")
      .map((token) => token.key),
  )]
}

function formatDate(value: unknown, format: ContactTemplateDateFormat) {
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return ""
  if (format === "iso") {
    const year = String(date.getUTCFullYear()).padStart(4, "0")
    const month = String(date.getUTCMonth() + 1).padStart(2, "0")
    const day = String(date.getUTCDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    ...(format === "short"
      ? { month: "2-digit", day: "2-digit", year: "numeric" }
      : format === "medium"
        ? { month: "short", day: "numeric", year: "numeric" }
        : format === "weekday"
          ? { weekday: "long", month: "long", day: "numeric", year: "numeric" }
          : { month: "long", day: "numeric", year: "numeric" }),
  }).format(date)
}

function formatPhone(value: unknown, format: ContactTemplatePhoneFormat) {
  const raw = String(value ?? "").trim()
  if (!raw) return ""
  const parsed = parsePhoneNumberFromString(raw)
  if (!parsed) return raw
  if (format === "e164") return parsed.number
  if (format === "international") return parsed.formatInternational()
  return parsed.formatNational()
}

function humanizeEnum(value: unknown) {
  const text = String(value ?? "").trim()
  if (!text) return ""
  return text
    .toLocaleLowerCase()
    .replace(/_/g, " ")
    .replace(/(^|\s)\S/g, (letter) => letter.toLocaleUpperCase())
}

function formatTemplateValue(
  value: unknown,
  fieldType: ContactTemplateFieldType,
  format?: ContactTemplateFormat,
) {
  if (value === null || value === undefined || value === "") return ""
  if (fieldType === "MULTI_SELECT") {
    return Array.isArray(value) ? value.map(String).filter(Boolean).join(", ") : ""
  }
  if (fieldType === "CHECKBOX") return value === true ? "True" : "False"
  if (fieldType === "DATE") return formatDate(value, format?.kind === "date" ? format.value : "medium")
  if (fieldType === "PHONE") return formatPhone(value, format?.kind === "phone" ? format.value : "national")
  if (fieldType === "CURRENCY") {
    const numericValue = Number(value)
    return Number.isFinite(numericValue)
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(numericValue)
      : ""
  }
  if (fieldType === "NUMBER") {
    const numericValue = Number(value)
    return Number.isFinite(numericValue) ? String(numericValue) : ""
  }
  return String(value)
}

function membershipName(value: unknown) {
  const membership = value && typeof value === "object" ? value as Record<string, unknown> : null
  const user = membership?.user && typeof membership.user === "object"
    ? membership.user as Record<string, unknown>
    : null
  return String(user?.name ?? "").trim() || String(user?.email ?? "").trim()
}

function regularContactValue(contact: Record<string, unknown>, key: string) {
  if (key === "name") {
    return [contact.firstName, contact.middleName, contact.lastName]
      .filter((part) => typeof part === "string" && part.trim())
      .join(" ")
  }
  if (key === "first_name") return contact.firstName
  if (key === "middle_name") return contact.middleName
  if (key === "last_name") return contact.lastName
  if (key === "email") return contact.email
  if (key === "phone") return contact.phone
  if (key === "secondary_phone") return contact.secondaryPhone
  if (key === "status") {
    const status = contact.statusConfig && typeof contact.statusConfig === "object"
      ? contact.statusConfig as Record<string, unknown>
      : null
    return status?.name
  }
  if (key === "assigned_to") return membershipName(contact.assignedToMembership)
  if (key === "tags") {
    return Array.isArray(contact.tags)
      ? contact.tags.map((item) => {
          const contactTag = item && typeof item === "object" ? item as Record<string, unknown> : null
          const tag = contactTag?.tag && typeof contactTag.tag === "object"
            ? contactTag.tag as Record<string, unknown>
            : null
          return String(tag?.name ?? "").trim()
        }).filter(Boolean)
      : []
  }
  if (key === "date_of_birth") return contact.dateOfBirth
  if (key === "gender") return humanizeEnum(contact.gender)
  if (key === "height") return contact.height
  if (key === "weight") return contact.weight
  if (key === "deceased_at") return contact.deceasedAt
  if (key === "smoker_status") return humanizeEnum(contact.smokerStatus)
  if (key === "medicare_part_a") return contact.medicarePartA
  if (key === "medicare_part_b") return contact.medicarePartB
  if (key === "address_line_1") return contact.addressLine1
  if (key === "address_line_2") return contact.addressLine2
  if (key === "city") return contact.city
  if (key === "state") return contact.state
  if (key === "postal_code") return contact.postalCode
  if (key === "country") return contact.country
  if (key === "mailing_address_line_1") return contact.mailingAddressLine1
  if (key === "mailing_address_line_2") return contact.mailingAddressLine2
  if (key === "mailing_city") return contact.mailingCity
  if (key === "mailing_state") return contact.mailingState
  if (key === "mailing_postal_code") return contact.mailingPostalCode
  if (key === "mailing_country") return contact.mailingCountry
  if (key === "emergency_contact_name") return contact.emergencyContactName
  if (key === "emergency_contact_phone") return contact.emergencyContactPhone
  if (key === "emergency_contact_relationship") return contact.emergencyContactRelationship
  if (key === "servicing_agent") return membershipName(contact.servicingAgentMembership)
  if (key === "additional_agent") return membershipName(contact.additionalAgentMembership)
  if (key === "lead_date") return contact.leadDate
  if (key === "lead_source") return contact.leadSource
  if (key === "lead_other_source") return contact.leadOtherSource
  if (key === "created_at") return contact.createdAt
  if (key === "updated_at") return contact.updatedAt
  return null
}

function renderContactTemplate(
  template: string,
  contact: Record<string, unknown>,
  customFields: Map<string, { value: unknown; fieldType: ContactTemplateFieldType }>,
) {
  const parsed = parseContactTemplate(template)
  if (parsed.issues.length > 0) throw new Error(parsed.issues[0]!.message)
  if (parsed.tokens.length === 0) return template

  let result = ""
  let cursor = 0
  for (const token of parsed.tokens) {
    result += template.slice(cursor, token.start)
    if (token.source === "CONTACT") {
      const field = REGULAR_FIELD_MAP.get(token.key)
      result += field
        ? formatTemplateValue(regularContactValue(contact, token.key), field.fieldType, token.format)
        : ""
    } else {
      const field = customFields.get(token.key)
      result += field ? formatTemplateValue(field.value, field.fieldType, token.format) : ""
    }
    cursor = token.end
  }
  return result + template.slice(cursor)
}

export async function renderContactNoteTemplates(
  prismaTx: any,
  params: { tenantId: string; contactId: string; titleTemplate: string; bodyTemplate: string },
) {
  const contact = await prismaTx.contact.findFirst({
    where: { tenantId: params.tenantId, id: params.contactId },
    select: {
      firstName: true,
      middleName: true,
      lastName: true,
      email: true,
      phone: true,
      secondaryPhone: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      postalCode: true,
      country: true,
      mailingAddressLine1: true,
      mailingAddressLine2: true,
      mailingCity: true,
      mailingState: true,
      mailingPostalCode: true,
      mailingCountry: true,
      emergencyContactName: true,
      emergencyContactPhone: true,
      emergencyContactRelationship: true,
      dateOfBirth: true,
      gender: true,
      height: true,
      weight: true,
      deceasedAt: true,
      medicarePartA: true,
      medicarePartB: true,
      smokerStatus: true,
      leadDate: true,
      leadSource: true,
      leadOtherSource: true,
      createdAt: true,
      updatedAt: true,
      statusConfig: { select: { name: true } },
      tags: { select: { tag: { select: { name: true } } } },
      assignedToMembership: { select: { user: { select: { name: true, email: true } } } },
      servicingAgentMembership: { select: { user: { select: { name: true, email: true } } } },
      additionalAgentMembership: { select: { user: { select: { name: true, email: true } } } },
      customFieldValues: {
        select: {
          value: true,
          field: {
            select: {
              key: true,
              fieldType: true,
              isActive: true,
              isEncrypted: true,
              isSensitive: true,
            },
          },
        },
      },
    },
  })
  if (!contact) throw new Error("The contact for this automation note is no longer available.")

  const customFields = new Map<string, { value: unknown; fieldType: ContactTemplateFieldType }>()
  for (const item of contact.customFieldValues ?? []) {
    if (!item.field?.isActive || item.field.isEncrypted || item.field.isSensitive) continue
    customFields.set(item.field.key, { value: item.value, fieldType: item.field.fieldType })
  }
  const contactRecord = contact as Record<string, unknown>
  return {
    title: renderContactTemplate(params.titleTemplate, contactRecord, customFields),
    body: renderContactTemplate(params.bodyTemplate, contactRecord, customFields),
  }
}
