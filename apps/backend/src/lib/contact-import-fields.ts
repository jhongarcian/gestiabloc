import { parsePhoneNumberFromString, isSupportedCountry, type CountryCode } from "libphonenumber-js"
import { normalizeCustomFieldValue } from "./contact-custom-field-values.js"

export const IMPORT_CONTACT_FIELDS = [
  ["firstName", "First name"], ["middleName", "Middle name"], ["lastName", "Last name"],
  ["dateOfBirth", "Date of birth"], ["phone", "Phone"], ["secondaryPhone", "Secondary phone"],
  ["email", "Email"], ["addressLine1", "Address line 1"], ["addressLine2", "Address line 2"],
  ["city", "City"], ["state", "State"], ["postalCode", "Postal code"], ["country", "Country"],
  ["mailingAddressLine1", "Mailing address line 1"], ["mailingAddressLine2", "Mailing address line 2"],
  ["mailingCity", "Mailing city"], ["mailingState", "Mailing state"],
  ["mailingPostalCode", "Mailing postal code"], ["mailingCountry", "Mailing country"],
  ["emergencyContactName", "Emergency contact name"],
  ["emergencyContactPhone", "Emergency contact phone"],
  ["emergencyContactRelationship", "Emergency contact relationship"],
  ["gender", "Gender"], ["height", "Height"], ["weight", "Weight"],
  ["deceasedAt", "Deceased date"], ["smokerStatus", "Smoker status"],
  ["leadDate", "Lead date"], ["leadSource", "Lead source"],
  ["leadOtherSource", "Other lead source"], ["statusConfigId", "Contact status"],
] as const

export type ContactFieldKey = typeof IMPORT_CONTACT_FIELDS[number][0]
export type ImportMapping = {
  sourceIndex: number
  sourceHeader: string
  target: { kind: "CONTACT_FIELD"; key: ContactFieldKey } | { kind: "CUSTOM_FIELD"; fieldId: string } | { kind: "IGNORE" }
}
export type ImportSettings = {
  dateFormat: "YYYY-MM-DD" | "MM/DD/YYYY" | "DD/MM/YYYY"
  phoneCountry: string
  multiSelectSeparator: string
  defaultStatusConfigId: string
}
export type ImportCustomField = {
  id: string
  key: string
  label: string
  fieldType: "TEXT" | "NUMBER" | "PHONE" | "CURRENCY" | "DATE" | "SELECT" | "MULTI_SELECT" | "RADIO" | "TEXTAREA" | "CHECKBOX"
  isEncrypted: boolean
  isSensitive: boolean
  isRequired: boolean
  options: string[]
}
export type ImportCatalog = {
  customFields: ImportCustomField[]
  statuses: Array<{ id: string; name: string }>
  leadSources: Array<{ name: string }>
}

const MAX_LENGTH: Partial<Record<ContactFieldKey, number>> = {
  firstName: 120, middleName: 120, lastName: 120, email: 255,
  addressLine1: 255, addressLine2: 255, city: 120, state: 120, postalCode: 40, country: 120,
  mailingAddressLine1: 255, mailingAddressLine2: 255, mailingCity: 120, mailingState: 120,
  mailingPostalCode: 40, mailingCountry: 120, emergencyContactName: 255,
  emergencyContactRelationship: 120, height: 60, weight: 60, leadOtherSource: 160,
}
const PHONE_KEYS = new Set<ContactFieldKey>(["phone", "secondaryPhone", "emergencyContactPhone"])
const DATE_KEYS = new Set<ContactFieldKey>(["dateOfBirth", "deceasedAt", "leadDate"])

function importDateHint(format: ImportSettings["dateFormat"]) {
  return format === "YYYY-MM-DD" ? "YYYY-MM-DD" : `${format} or YYYY-MM-DD`
}

function keyOf(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "")
}

const FIELD_ALIASES: Record<string, ContactFieldKey> = {
  fname: "firstName", givenname: "firstName", firstname: "firstName",
  mname: "middleName", middlename: "middleName", lname: "lastName", surname: "lastName",
  lastname: "lastName", dob: "dateOfBirth", birthdate: "dateOfBirth",
  mobile: "phone", cellphone: "phone", phonenumber: "phone", mobilephone: "phone",
  emailaddress: "email", zipcode: "postalCode", zip: "postalCode",
  address: "addressLine1", street: "addressLine1", status: "statusConfigId",
  source: "leadSource",
}

export function suggestImportMappings(headers: string[], customFields: ImportCustomField[]): ImportMapping[] {
  const standard = new Map<string, ContactFieldKey>(
    IMPORT_CONTACT_FIELDS.flatMap(([key, label]) => [[keyOf(key), key], [keyOf(label), key]]),
  )
  const custom = new Map<string, string>()
  for (const field of customFields) {
    custom.set(keyOf(field.key), field.id)
    custom.set(keyOf(field.label), field.id)
  }
  const used = new Set<string>()
  return headers.map((sourceHeader, sourceIndex) => {
    const normalized = keyOf(sourceHeader)
    const standardKey = standard.get(normalized) ?? FIELD_ALIASES[normalized]
    const customId = custom.get(normalized)
    let target: ImportMapping["target"] = { kind: "IGNORE" }
    if (standardKey && !used.has(`s:${standardKey}`)) {
      target = { kind: "CONTACT_FIELD", key: standardKey }
      used.add(`s:${standardKey}`)
    } else if (customId && !used.has(`c:${customId}`)) {
      target = { kind: "CUSTOM_FIELD", fieldId: customId }
      used.add(`c:${customId}`)
    }
    return { sourceIndex, sourceHeader, target }
  })
}

export function parseImportDate(value: string, format: ImportSettings["dateFormat"]): Date | null {
  // ISO dates are unambiguous and common in exports, regardless of the selected slash format.
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const match = isoMatch ?? (format === "YYYY-MM-DD" ? null : /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value))
  if (!match) return null
  const year = Number(isoMatch ? match[1] : match[3])
  const month = Number(isoMatch ? match[2] : format === "DD/MM/YYYY" ? match[2] : match[1])
  const day = Number(isoMatch ? match[3] : format === "DD/MM/YYYY" ? match[1] : match[2])
  // Match the contact date input's date-only serialization to avoid timezone shifts.
  const date = new Date(Date.UTC(year, month - 1, day, 12))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date : null
}

export function normalizeImportPhone(value: string, country: string) {
  if (!isSupportedCountry(country)) return null
  const parsed = parsePhoneNumberFromString(value, country as CountryCode)
  // The contact form accepts possible E.164 numbers, including unassigned test prefixes.
  return parsed?.isPossible() ? parsed.number : null
}

export type PreparedImportRow = {
  contact: Record<string, unknown>
  customValues: Array<{ fieldId: string; value: unknown; isEncrypted: boolean }>
  email: string | null
  phone: string | null
}

export function prepareImportRow(
  cells: string[], mappings: ImportMapping[], settings: ImportSettings, catalog: ImportCatalog,
): { ok: true; row: PreparedImportRow } | { ok: false; code: string; message: string } {
  const contact: Record<string, unknown> = { statusConfigId: settings.defaultStatusConfigId }
  const customValues: PreparedImportRow["customValues"] = []
  const customById = new Map(catalog.customFields.map((field) => [field.id, field]))
  for (const mapping of mappings) {
    const raw = (cells[mapping.sourceIndex] ?? "").trim()
    if (mapping.target.kind === "IGNORE") continue
    if (mapping.target.kind === "CUSTOM_FIELD") {
      const field = customById.get(mapping.target.fieldId)
      if (!field) return { ok: false, code: "FIELD_REMOVED", message: `${mapping.sourceHeader}: custom field is unavailable.` }
      if (!raw) {
        if (field.isRequired) return { ok: false, code: "MISSING_REQUIRED_VALUE", message: `${mapping.sourceHeader}: ${field.label} is required.` }
        continue
      }
      let value: unknown = raw
      if (field.fieldType === "PHONE") value = normalizeImportPhone(raw, settings.phoneCountry) ?? raw
      if (field.fieldType === "DATE") {
        const date = parseImportDate(raw, settings.dateFormat)
        if (!date) return { ok: false, code: "INVALID_DATE", message: `${mapping.sourceHeader}: date must match ${importDateHint(settings.dateFormat)}.` }
        value = date.toISOString()
      }
      if (field.fieldType === "MULTI_SELECT") {
        value = raw.split(settings.multiSelectSeparator).map((item) => item.trim()).filter(Boolean)
      }
      if (field.fieldType === "CHECKBOX") {
        const key = raw.toLowerCase()
        if (["true", "yes", "1"].includes(key)) value = true
        else if (["false", "no", "0"].includes(key)) value = false
        else return { ok: false, code: "INVALID_VALUE", message: `${mapping.sourceHeader}: enter yes or no.` }
      }
      if (["SELECT", "RADIO"].includes(field.fieldType)) {
        value = field.options.find((option) => option.toLowerCase() === raw.toLowerCase()) ?? raw
      }
      if (field.fieldType === "MULTI_SELECT") {
        value = (value as string[]).map((item) => field.options.find((option) => option.toLowerCase() === item.toLowerCase()) ?? item)
      }
      const normalized = normalizeCustomFieldValue(field, value)
      if (!normalized.ok) return { ok: false, code: "INVALID_VALUE", message: `${mapping.sourceHeader}: ${normalized.message}` }
      if (normalized.value !== null) customValues.push({ fieldId: field.id, value: normalized.value, isEncrypted: field.isEncrypted })
      continue
    }
    const key = mapping.target.key
    if (!raw) continue
    if (MAX_LENGTH[key] && raw.length > MAX_LENGTH[key]!) {
      return { ok: false, code: "VALUE_TOO_LONG", message: `${mapping.sourceHeader}: value is too long.` }
    }
    if (PHONE_KEYS.has(key)) {
      const phone = normalizeImportPhone(raw, settings.phoneCountry)
      if (!phone) return { ok: false, code: "INVALID_PHONE", message: `${mapping.sourceHeader}: invalid phone number.` }
      contact[key] = phone
    } else if (DATE_KEYS.has(key)) {
      const date = parseImportDate(raw, settings.dateFormat)
      if (!date) return { ok: false, code: "INVALID_DATE", message: `${mapping.sourceHeader}: date must match ${importDateHint(settings.dateFormat)}.` }
      contact[key] = date
    } else if (key === "email") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
        return { ok: false, code: "INVALID_EMAIL", message: `${mapping.sourceHeader}: invalid email address.` }
      }
      contact.email = raw.toLowerCase()
    } else if (key === "statusConfigId") {
      const status = catalog.statuses.find((item) => item.name.toLowerCase() === raw.toLowerCase())
      if (!status) return { ok: false, code: "INVALID_STATUS", message: `${mapping.sourceHeader}: status is not configured.` }
      contact.statusConfigId = status.id
    } else if (key === "leadSource") {
      const source = catalog.leadSources.find((item) => item.name.toLowerCase() === raw.toLowerCase())
      if (!source) return { ok: false, code: "INVALID_LEAD_SOURCE", message: `${mapping.sourceHeader}: lead source is not configured.` }
      contact.leadSource = source.name
    } else if (key === "gender" || key === "smokerStatus") {
      const value = raw.toUpperCase().replace(/[\s-]+/g, "_")
      const valid = key === "gender" ? ["FEMALE", "MALE", "NON_BINARY", "OTHER", "UNKNOWN"] : ["UNKNOWN", "NEVER", "CURRENT", "FORMER"]
      if (!valid.includes(value)) return { ok: false, code: "INVALID_VALUE", message: `${mapping.sourceHeader}: unsupported value.` }
      contact[key] = value
    } else {
      contact[key] = raw
    }
  }
  if (!contact.firstName || !contact.lastName) {
    return { ok: false, code: "MISSING_NAME", message: "First name and last name are required." }
  }
  return { ok: true, row: { contact, customValues, email: (contact.email as string) ?? null, phone: (contact.phone as string) ?? null } }
}
