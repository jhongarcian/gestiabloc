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

export type ContactTemplateCatalog = {
  customFields: Array<{
    key: string
    label: string
    fieldType: ContactTemplateFieldType
  }>
  templateFields: {
    contact: Array<{
      key: string
      label: string
      fieldType: ContactTemplateFieldType
    }>
    dateFormats: Array<{ value: string; label?: string; preview?: string }>
    phoneFormats: Array<{ value: string; label?: string; preview?: string }>
  }
}

type ParsedToken = {
  raw: string
  source: "CONTACT" | "CUSTOM_FIELD" | "DATE"
  key: string
  formatKind?: "date" | "phone" | "currency"
  formatValue?: string
}

const BRACED_EXPRESSION = /\{([^{}]*)\}/g
const TEMPLATE_TOKEN_START = /\{(?:contact|date)\./g

export function isValidTemplateDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function parseToken(raw: string, expression: string): ParsedToken | null {
  const pieces = expression.split("|")
  if (pieces.length > 2) return null
  const path = pieces[0] ?? ""
  const formatParts = pieces[1]?.split(":") ?? []
  if (pieces[1] && formatParts.length !== 2) return null
  const rawFormatKind = formatParts[0]
  if (rawFormatKind && rawFormatKind !== "date" && rawFormatKind !== "phone" && rawFormatKind !== "currency") {
    return null
  }
  const formatKind: ParsedToken["formatKind"] =
    rawFormatKind === "date" || rawFormatKind === "phone" || rawFormatKind === "currency"
      ? rawFormatKind
      : undefined
  if (path === "date.current") {
    if (formatKind && formatKind !== "date") return null
    return {
      raw,
      source: "DATE",
      key: "current",
      ...(formatKind ? { formatKind, formatValue: formatParts[1] } : {}),
    }
  }
  const specificDateMatch = path.match(/^date\.specific\.(\d{4}-\d{2}-\d{2})$/)
  if (specificDateMatch) {
    const date = specificDateMatch[1]!
    if (!isValidTemplateDate(date) || (formatKind && formatKind !== "date")) return null
    return {
      raw,
      source: "DATE",
      key: date,
      ...(formatKind ? { formatKind, formatValue: formatParts[1] } : {}),
    }
  }
  const customMatch = path.match(/^contact\.custom_field\.([a-z0-9_]+)$/)
  if (customMatch) {
    return {
      raw,
      source: "CUSTOM_FIELD",
      key: customMatch[1]!,
      ...(formatKind ? { formatKind, formatValue: formatParts[1] } : {}),
    }
  }
  const contactMatch = path.match(/^contact\.([a-z][a-z0-9_]*)$/)
  if (!contactMatch) return null
  return {
    raw,
    source: "CONTACT",
    key: contactMatch[1]!,
    ...(formatKind ? { formatKind, formatValue: formatParts[1] } : {}),
  }
}

export function validateContactTemplate(value: string, catalog: ContactTemplateCatalog) {
  const ranges: Array<{ start: number; end: number }> = []
  const tokens: ParsedToken[] = []
  for (const match of value.matchAll(BRACED_EXPRESSION)) {
    const expression = match[1] ?? ""
    if (!expression.startsWith("contact.") && !expression.startsWith("date.")) continue
    const start = match.index
    const end = start + match[0].length
    ranges.push({ start, end })
    if (value[start - 1] === "{" || value[end] === "}") {
      return "Use one pair of braces for template values."
    }
    const token = parseToken(match[0], expression)
    if (!token) return `${match[0]} is not a valid template value.`
    tokens.push(token)
  }
  for (const match of value.matchAll(TEMPLATE_TOKEN_START)) {
    if (!ranges.some((range) => match.index >= range.start && match.index < range.end)) {
      return "A template value is missing its closing brace."
    }
  }

  const contactFields = new Map(catalog.templateFields.contact.map((field) => [field.key, field]))
  const customFields = new Map(catalog.customFields.map((field) => [field.key, field]))
  const dateFormats = new Set(catalog.templateFields.dateFormats.map((option) => option.value))
  const phoneFormats = new Set(catalog.templateFields.phoneFormats.map((option) => option.value))

  for (const token of tokens) {
    if (token.source === "DATE") {
      if (token.formatKind && (token.formatKind !== "date" || !dateFormats.has(token.formatValue ?? ""))) {
        return `${token.raw} does not use a valid date format.`
      }
      continue
    }
    const field = token.source === "CONTACT"
      ? contactFields.get(token.key)
      : customFields.get(token.key)
    if (!field) return `The field used by ${token.raw} is not available.`
    if (!token.formatKind) continue
    if (token.formatKind === "date" && (field.fieldType !== "DATE" || !dateFormats.has(token.formatValue ?? ""))) {
      return `${token.raw} does not use a valid date format.`
    }
    if (token.formatKind === "phone" && (field.fieldType !== "PHONE" || !phoneFormats.has(token.formatValue ?? ""))) {
      return `${token.raw} does not use a valid phone format.`
    }
    if (token.formatKind === "currency" && (field.fieldType !== "CURRENCY" || token.formatValue !== "USD")) {
      return `${token.raw} does not use a valid currency format.`
    }
  }
  return null
}

export function buildContactTemplateToken(params: {
  source: "CONTACT" | "CUSTOM_FIELD"
  key: string
  fieldType: ContactTemplateFieldType
  format?: string
}) {
  const path = params.source === "CONTACT"
    ? `contact.${params.key}`
    : `contact.custom_field.${params.key}`
  if (params.fieldType === "DATE") return `{${path}|date:${params.format || "medium"}}`
  if (params.fieldType === "PHONE") return `{${path}|phone:${params.format || "national"}}`
  if (params.fieldType === "CURRENCY") return `{${path}|currency:USD}`
  return `{${path}}`
}

export function buildDateTemplateToken(params: {
  kind: "CURRENT" | "SPECIFIC"
  format?: string
  date?: string
}) {
  const format = params.format || "medium"
  if (params.kind === "CURRENT") return `{date.current|date:${format}}`
  if (!params.date || !isValidTemplateDate(params.date)) return ""
  return `{date.specific.${params.date}|date:${format}}`
}

export function partitionContactTemplateFields(catalog: ContactTemplateCatalog) {
  const contactFields = catalog.templateFields.contact.filter((field) => field.fieldType !== "DATE")
  const customFields = catalog.customFields.filter((field) => field.fieldType !== "DATE")
  const dateFields = [
    ...catalog.templateFields.contact
      .filter((field) => field.fieldType === "DATE")
      .map((field) => ({ ...field, source: "CONTACT" as const, sourceLabel: "Contact field" })),
    ...catalog.customFields
      .filter((field) => field.fieldType === "DATE")
      .map((field) => ({ ...field, source: "CUSTOM_FIELD" as const, sourceLabel: "Custom field" })),
  ]
  return { contactFields, customFields, dateFields }
}
