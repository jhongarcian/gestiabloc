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
  source: "CONTACT" | "CUSTOM_FIELD"
  key: string
  formatKind?: "date" | "phone" | "currency"
  formatValue?: string
}

const BRACED_EXPRESSION = /\{([^{}]*)\}/g
const CONTACT_TOKEN_START = /\{contact\./g

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
    if (!expression.startsWith("contact.")) continue
    const start = match.index
    const end = start + match[0].length
    ranges.push({ start, end })
    if (value[start - 1] === "{" || value[end] === "}") {
      return "Use one pair of braces for contact fields."
    }
    const token = parseToken(match[0], expression)
    if (!token) return `${match[0]} is not a valid contact field.`
    tokens.push(token)
  }
  for (const match of value.matchAll(CONTACT_TOKEN_START)) {
    if (!ranges.some((range) => match.index >= range.start && match.index < range.end)) {
      return "A contact field is missing its closing brace."
    }
  }

  const contactFields = new Map(catalog.templateFields.contact.map((field) => [field.key, field]))
  const customFields = new Map(catalog.customFields.map((field) => [field.key, field]))
  const dateFormats = new Set(catalog.templateFields.dateFormats.map((option) => option.value))
  const phoneFormats = new Set(catalog.templateFields.phoneFormats.map((option) => option.value))

  for (const token of tokens) {
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
