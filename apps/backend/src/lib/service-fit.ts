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

export const SERVICE_FIT_RULE_SOURCES = [
  "core",
  "status",
  "tags",
  "custom",
  "derived",
] as const

export const SERVICE_FIT_VALUE_TYPES = [
  "string",
  "number",
  "date",
  "boolean",
  "stringArray",
] as const

export const SERVICE_FIT_OPERATORS = [
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
] as const

export type ServiceFitRuleSource = (typeof SERVICE_FIT_RULE_SOURCES)[number]
export type ServiceFitValueType = (typeof SERVICE_FIT_VALUE_TYPES)[number]
export type ServiceFitOperator = (typeof SERVICE_FIT_OPERATORS)[number]

export type ServiceFitRule = {
  id: string
  source: ServiceFitRuleSource
  fieldKey: string
  valueType: ServiceFitValueType
  operator: ServiceFitOperator
  compareValue: unknown
  required: boolean
  requiredGroup: string | null
  requiredBranch: string | null
  weight: number
  label: string | null
  explanation: string | null
}

export type ServiceFitProfile = {
  enabled: boolean
  summary: string
  rules: ServiceFitRule[]
}

export type ServiceFitFieldOption = {
  value: string
  label: string
}

export type ServiceFitFieldDefinition = {
  source: ServiceFitRuleSource
  fieldKey: string
  label: string
  description: string | null
  valueType: ServiceFitValueType
  operators: ServiceFitOperator[]
  options: ServiceFitFieldOption[]
  customFieldId?: string | null
}

export type ServiceFitCatalogInput = {
  statuses: Array<{ id: string; name: string }>
  tags: Array<{ id: string; name: string }>
  customFields: Array<{
    id: string
    key: string
    label: string
    description: string | null
    fieldType: ContactCustomFieldType
    options: string[]
    isActive?: boolean
    isSensitive?: boolean
  }>
}

export type ServiceFitContactSnapshot = {
  id: string
  firstName: string | null
  middleName: string | null
  lastName: string | null
  email: string | null
  phoneNumber: string | null
  secondaryPhoneNumber: string | null
  dateOfBirth: Date | string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  country: string | null
  statusConfigId: string | null
  tagIds: string[]
  customFieldValues: Record<string, unknown>
}

export type ServiceFitRuleEvaluation = {
  ruleId: string
  label: string
  reason: string
}

export type ServiceFitEvaluation = {
  eligibilityStatus: "ELIGIBLE" | "NEEDS_INFO" | "NOT_ELIGIBLE"
  fitScore: number
  matchedRules: ServiceFitRuleEvaluation[]
  blockingRules: ServiceFitRuleEvaluation[]
  missingRules: ServiceFitRuleEvaluation[]
  summary: string
}

export const DEFAULT_SERVICE_FIT_PROFILE: ServiceFitProfile = {
  enabled: false,
  summary: "",
  rules: [],
}

const DEFAULT_TIMEZONE = "America/Chicago"

const CORE_FIELD_DEFINITIONS: Array<{
  fieldKey: string
  label: string
  description: string | null
  valueType: ServiceFitValueType
}> = [
  { fieldKey: "firstName", label: "First name", description: null, valueType: "string" },
  { fieldKey: "middleName", label: "Middle name", description: null, valueType: "string" },
  { fieldKey: "lastName", label: "Last name", description: null, valueType: "string" },
  { fieldKey: "email", label: "Email", description: null, valueType: "string" },
  { fieldKey: "phoneNumber", label: "Phone number", description: null, valueType: "string" },
  {
    fieldKey: "secondaryPhoneNumber",
    label: "Secondary phone number",
    description: null,
    valueType: "string",
  },
  {
    fieldKey: "dateOfBirth",
    label: "Date of birth",
    description: "Used directly for date comparisons.",
    valueType: "date",
  },
  { fieldKey: "addressLine1", label: "Address line 1", description: null, valueType: "string" },
  { fieldKey: "addressLine2", label: "Address line 2", description: null, valueType: "string" },
  { fieldKey: "city", label: "City", description: null, valueType: "string" },
  { fieldKey: "state", label: "State", description: null, valueType: "string" },
  { fieldKey: "postalCode", label: "Postal code", description: null, valueType: "string" },
  { fieldKey: "country", label: "Country", description: null, valueType: "string" },
]

const EMPTY_VALUE_OPERATORS = new Set<ServiceFitOperator>(["is_empty", "is_not_empty"])

const CORE_FIELD_LABELS = new Map(
  CORE_FIELD_DEFINITIONS.map((field) => [field.fieldKey, field.label]),
)

function getSafeTimezone(timezone?: string | null) {
  return timezone?.trim() || DEFAULT_TIMEZONE
}

function getLocalDateParts(date: Date, timezone?: string | null) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: getSafeTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })

  const parts = formatter.formatToParts(date)
  const year = Number.parseInt(parts.find((item) => item.type === "year")?.value ?? "", 10)
  const month = Number.parseInt(parts.find((item) => item.type === "month")?.value ?? "", 10)
  const day = Number.parseInt(parts.find((item) => item.type === "day")?.value ?? "", 10)

  return { year, month, day }
}

function formatDateOnly(value: Date, timezone?: string | null) {
  const parts = getLocalDateParts(value, timezone)
  if (!Number.isFinite(parts.year) || !Number.isFinite(parts.month) || !Number.isFinite(parts.day)) {
    return ""
  }

  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`
}

function parseDateValue(value: unknown) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return null

    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
      ? `${trimmed}T00:00:00.000Z`
      : trimmed
    const date = new Date(normalized)
    return Number.isNaN(date.getTime()) ? null : date
  }

  return null
}

function calculateAgeYears(dateOfBirth: Date | string | null | undefined, timezone?: string | null) {
  const birthDate = parseDateValue(dateOfBirth)
  if (!birthDate) return null

  const today = getLocalDateParts(new Date(), timezone)
  const birth = getLocalDateParts(birthDate, timezone)

  let age = today.year - birth.year
  if (today.month < birth.month || (today.month === birth.month && today.day < birth.day)) {
    age -= 1
  }

  return age >= 0 ? age : null
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return []

  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ]
}

function toValueType(fieldType: ContactCustomFieldType): ServiceFitValueType {
  switch (fieldType) {
    case "NUMBER":
    case "CURRENCY":
      return "number"
    case "DATE":
      return "date"
    case "CHECKBOX":
      return "boolean"
    case "MULTI_SELECT":
      return "stringArray"
    default:
      return "string"
  }
}

export function getOperatorsForValueType(valueType: ServiceFitValueType): ServiceFitOperator[] {
  switch (valueType) {
    case "number":
    case "date":
      return [
        "equals",
        "not_equals",
        "greater_than",
        "greater_than_or_equal",
        "less_than",
        "less_than_or_equal",
        "between",
        "is_empty",
        "is_not_empty",
      ]
    case "boolean":
      return ["is_true", "is_false", "is_empty", "is_not_empty"]
    case "stringArray":
      return ["includes_any", "includes_all", "excludes_all", "is_empty", "is_not_empty"]
    default:
      return ["equals", "not_equals", "contains", "not_contains", "is_empty", "is_not_empty"]
  }
}

export function buildServiceFitFieldCatalog(input: ServiceFitCatalogInput): ServiceFitFieldDefinition[] {
  const coreFields: ServiceFitFieldDefinition[] = CORE_FIELD_DEFINITIONS.map((field) => ({
    source: "core",
    fieldKey: field.fieldKey,
    label: field.label,
    description: field.description,
    valueType: field.valueType,
    operators: getOperatorsForValueType(field.valueType),
    options: [],
  }))

  const statusField: ServiceFitFieldDefinition = {
    source: "status",
    fieldKey: "statusConfigId",
    label: "Status",
    description: "Current contact status.",
    valueType: "string",
    operators: getOperatorsForValueType("string"),
    options: input.statuses.map((status) => ({ value: status.id, label: status.name })),
  }

  const tagField: ServiceFitFieldDefinition = {
    source: "tags",
    fieldKey: "tagIds",
    label: "Tags",
    description: "Current contact tags.",
    valueType: "stringArray",
    operators: getOperatorsForValueType("stringArray"),
    options: input.tags.map((tag) => ({ value: tag.id, label: tag.name })),
  }

  const derivedField: ServiceFitFieldDefinition = {
    source: "derived",
    fieldKey: "ageYears",
    label: "Age in years",
    description: "Calculated from date of birth using the tenant date.",
    valueType: "number",
    operators: getOperatorsForValueType("number"),
    options: [],
  }

  const customFields = input.customFields
    .filter((field) => field.isActive !== false && field.isSensitive !== true)
    .map<ServiceFitFieldDefinition>((field) => ({
      source: "custom",
      fieldKey: field.key,
      label: field.label,
      description: field.description ?? null,
      valueType: toValueType(field.fieldType),
      operators: getOperatorsForValueType(toValueType(field.fieldType)),
      options:
        field.fieldType === "SELECT" ||
        field.fieldType === "RADIO" ||
        field.fieldType === "MULTI_SELECT"
          ? field.options.map((option) => ({ value: option, label: option }))
          : [],
      customFieldId: field.id,
    }))

  return [...coreFields, statusField, tagField, derivedField, ...customFields]
}

export function normalizeServiceFitProfile(value: unknown): ServiceFitProfile {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_SERVICE_FIT_PROFILE, rules: [] }
  }

  const record = value as Record<string, unknown>
  const rules = Array.isArray(record.rules)
    ? record.rules
        .map((rule) => normalizeServiceFitRule(rule))
        .filter((item): item is ServiceFitRule => Boolean(item))
    : []

  return {
    enabled: record.enabled === true,
    summary: typeof record.summary === "string" ? record.summary.trim() : "",
    rules,
  }
}

function normalizeServiceFitRule(value: unknown): ServiceFitRule | null {
  if (!value || typeof value !== "object") return null

  const record = value as Record<string, unknown>
  const id = normalizeString(record.id)
  const source = SERVICE_FIT_RULE_SOURCES.includes(record.source as ServiceFitRuleSource)
    ? (record.source as ServiceFitRuleSource)
    : null
  const valueType = SERVICE_FIT_VALUE_TYPES.includes(record.valueType as ServiceFitValueType)
    ? (record.valueType as ServiceFitValueType)
    : null
  const operator = SERVICE_FIT_OPERATORS.includes(record.operator as ServiceFitOperator)
    ? (record.operator as ServiceFitOperator)
    : null
  const fieldKey = normalizeString(record.fieldKey)

  if (!id || !source || !valueType || !operator || !fieldKey) {
    return null
  }

  const numericWeight =
    typeof record.weight === "number"
      ? Math.round(record.weight)
      : Number.parseInt(String(record.weight ?? "1"), 10)

  return {
    id,
    source,
    fieldKey,
    valueType,
    operator,
    compareValue: record.compareValue ?? null,
    required: record.required === true,
    requiredGroup: normalizeString(record.requiredGroup) || null,
    requiredBranch: normalizeString(record.requiredBranch) || null,
    weight:
      Number.isFinite(numericWeight) && numericWeight > 0
        ? Math.min(10, Math.max(1, numericWeight))
        : 1,
    label: normalizeString(record.label) || null,
    explanation: normalizeString(record.explanation) || null,
  }
}

function sanitizeCompareValue(valueType: ServiceFitValueType, operator: ServiceFitOperator, rawValue: unknown) {
  if (EMPTY_VALUE_OPERATORS.has(operator)) {
    return { ok: true as const, value: null }
  }

  if (valueType === "boolean") {
    return { ok: true as const, value: null }
  }

  if (valueType === "stringArray") {
    const values = normalizeStringArray(rawValue)
    return values.length > 0
      ? { ok: true as const, value: values }
      : { ok: false as const, message: "Select at least one option." }
  }

  if (valueType === "number") {
    if (operator === "between") {
      const value = rawValue as { min?: unknown; max?: unknown } | null
      const min = Number.parseFloat(String(value?.min ?? ""))
      const max = Number.parseFloat(String(value?.max ?? ""))
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        return { ok: false as const, message: "Enter a valid minimum and maximum." }
      }
      return { ok: true as const, value: { min, max } }
    }

    const parsed = Number.parseFloat(String(rawValue ?? ""))
    return Number.isFinite(parsed)
      ? { ok: true as const, value: parsed }
      : { ok: false as const, message: "Enter a valid number." }
  }

  if (valueType === "date") {
    if (operator === "between") {
      const value = rawValue as { min?: unknown; max?: unknown } | null
      const min = normalizeString(value?.min)
      const max = normalizeString(value?.max)
      if (!parseDateValue(min) || !parseDateValue(max)) {
        return { ok: false as const, message: "Enter a valid start and end date." }
      }
      return { ok: true as const, value: { min, max } }
    }

    const normalized = normalizeString(rawValue)
    return parseDateValue(normalized)
      ? { ok: true as const, value: normalized }
      : { ok: false as const, message: "Enter a valid date." }
  }

  const normalized = normalizeString(rawValue)
  return normalized
    ? { ok: true as const, value: normalized }
    : { ok: false as const, message: "Enter a comparison value." }
}

export function validateServiceFitProfile(
  profile: ServiceFitProfile,
  catalog: ServiceFitFieldDefinition[],
) {
  const fieldMap = new Map(catalog.map((field) => [`${field.source}:${field.fieldKey}`, field] as const))
  const normalizedRules: ServiceFitRule[] = []

  for (const rule of profile.rules) {
    const field = fieldMap.get(`${rule.source}:${rule.fieldKey}`)
    if (!field) {
      return {
        ok: false as const,
        error: `Unknown field for rule "${rule.label ?? rule.id}".`,
      }
    }

    if (!field.operators.includes(rule.operator)) {
      return {
        ok: false as const,
        error: `Operator "${rule.operator}" is not supported for ${field.label}.`,
      }
    }

    const compareValue = sanitizeCompareValue(field.valueType, rule.operator, rule.compareValue)
    if (!compareValue.ok) {
      return {
        ok: false as const,
        error: `${field.label}: ${compareValue.message}`,
      }
    }

    normalizedRules.push({
      ...rule,
      valueType: field.valueType,
      compareValue: compareValue.value,
      requiredGroup: rule.required ? rule.requiredGroup : null,
      requiredBranch: rule.required ? rule.requiredBranch : null,
      weight: rule.required ? 1 : rule.weight,
    })
  }

  return {
    ok: true as const,
    profile: {
      enabled: profile.enabled,
      summary: profile.summary.trim(),
      rules: normalizedRules,
    },
  }
}

function isEmptyValue(value: unknown, valueType: ServiceFitValueType) {
  if (valueType === "stringArray") {
    return normalizeStringArray(value).length === 0
  }

  if (valueType === "number") {
    return value === null || value === undefined || !Number.isFinite(Number(value))
  }

  if (valueType === "date") {
    return parseDateValue(value) === null
  }

  if (valueType === "boolean") {
    return value === null || value === undefined
  }

  return normalizeString(value).length === 0
}

function getFieldLabel(field: ServiceFitFieldDefinition, rule: ServiceFitRule) {
  return rule.label?.trim() || field.label
}

function getCompareValueLabel(field: ServiceFitFieldDefinition, compareValue: unknown) {
  if (field.valueType === "stringArray") {
    const optionMap = new Map(field.options.map((option) => [option.value, option.label]))
    return normalizeStringArray(compareValue)
      .map((value) => optionMap.get(value) ?? value)
      .join(", ")
  }

  if (field.options.length > 0 && typeof compareValue === "string") {
    return field.options.find((option) => option.value === compareValue)?.label ?? compareValue
  }

  if (field.valueType === "date" && typeof compareValue === "string") {
    return compareValue
  }

  return String(compareValue ?? "")
}

function resolveRuleValue(
  rule: ServiceFitRule,
  contact: ServiceFitContactSnapshot,
  timezone?: string | null,
) {
  if (rule.source === "core") {
    return (contact as Record<string, unknown>)[rule.fieldKey] ?? null
  }

  if (rule.source === "status") {
    return contact.statusConfigId ?? null
  }

  if (rule.source === "tags") {
    return contact.tagIds
  }

  if (rule.source === "custom") {
    return contact.customFieldValues[rule.fieldKey] ?? null
  }

  if (rule.fieldKey === "ageYears") {
    return calculateAgeYears(contact.dateOfBirth, timezone)
  }

  return null
}

function evaluateArrayOperator(operator: ServiceFitOperator, currentValue: string[], compareValue: string[]) {
  if (operator === "includes_any") {
    return compareValue.some((item) => currentValue.includes(item))
  }
  if (operator === "includes_all") {
    return compareValue.every((item) => currentValue.includes(item))
  }
  return compareValue.every((item) => !currentValue.includes(item))
}

function evaluateScalarOperator(
  operator: ServiceFitOperator,
  currentValue: unknown,
  compareValue: unknown,
  valueType: ServiceFitValueType,
) {
  if (valueType === "number") {
    const currentNumber = Number(currentValue)
    if (!Number.isFinite(currentNumber)) return false

    if (operator === "between") {
      const range = compareValue as { min: number; max: number }
      return currentNumber >= range.min && currentNumber <= range.max
    }

    const nextNumber = Number(compareValue)
    if (!Number.isFinite(nextNumber)) return false

    switch (operator) {
      case "equals":
        return currentNumber === nextNumber
      case "not_equals":
        return currentNumber !== nextNumber
      case "greater_than":
        return currentNumber > nextNumber
      case "greater_than_or_equal":
        return currentNumber >= nextNumber
      case "less_than":
        return currentNumber < nextNumber
      case "less_than_or_equal":
        return currentNumber <= nextNumber
      default:
        return false
    }
  }

  if (valueType === "date") {
    const currentDate = parseDateValue(currentValue)
    if (!currentDate) return false

    const currentTime = currentDate.getTime()
    if (operator === "between") {
      const range = compareValue as { min: string; max: string }
      const minDate = parseDateValue(range.min)
      const maxDate = parseDateValue(range.max)
      if (!minDate || !maxDate) return false
      return currentTime >= minDate.getTime() && currentTime <= maxDate.getTime()
    }

    const compareDate = parseDateValue(compareValue)
    if (!compareDate) return false
    const compareTime = compareDate.getTime()

    switch (operator) {
      case "equals":
        return currentTime === compareTime
      case "not_equals":
        return currentTime !== compareTime
      case "greater_than":
        return currentTime > compareTime
      case "greater_than_or_equal":
        return currentTime >= compareTime
      case "less_than":
        return currentTime < compareTime
      case "less_than_or_equal":
        return currentTime <= compareTime
      default:
        return false
    }
  }

  const currentString = normalizeString(currentValue)
  const compareString = normalizeString(compareValue)

  switch (operator) {
    case "equals":
      return currentString === compareString
    case "not_equals":
      return currentString !== compareString
    case "contains":
      return currentString.toLowerCase().includes(compareString.toLowerCase())
    case "not_contains":
      return !currentString.toLowerCase().includes(compareString.toLowerCase())
    default:
      return false
  }
}

function formatRuleReason(
  field: ServiceFitFieldDefinition,
  rule: ServiceFitRule,
  outcome: "matched" | "blocked" | "missing",
  timezone?: string | null,
) {
  const label = getFieldLabel(field, rule)

  if (outcome === "missing") {
    if (rule.operator === "is_not_empty") {
      return `${label} is missing.`
    }
    return `${label} does not have enough data yet.`
  }

  if (rule.operator === "is_empty") {
    return outcome === "matched" ? `${label} is empty.` : `${label} is not empty.`
  }

  if (rule.operator === "is_not_empty") {
    return outcome === "matched" ? `${label} is present.` : `${label} is missing.`
  }

  if (rule.operator === "is_true" || rule.operator === "is_false") {
    const expected = rule.operator === "is_true" ? "Yes" : "No"
    return outcome === "matched"
      ? `${label} matches ${expected}.`
      : `${label} does not match ${expected}.`
  }

  if (field.valueType === "date" && rule.operator === "between") {
    const range = rule.compareValue as { min: string; max: string }
    return outcome === "matched"
      ? `${label} falls between ${range.min} and ${range.max}.`
      : `${label} does not fall between ${range.min} and ${range.max}.`
  }

  if (field.valueType === "number" && rule.operator === "between") {
    const range = rule.compareValue as { min: number; max: number }
    return outcome === "matched"
      ? `${label} falls between ${range.min} and ${range.max}.`
      : `${label} does not fall between ${range.min} and ${range.max}.`
  }

  const compareLabel = getCompareValueLabel(field, rule.compareValue)
  const phrases: Record<ServiceFitOperator, string> = {
    equals: "matches",
    not_equals: "does not match",
    contains: "contains",
    not_contains: "does not contain",
    greater_than: "is greater than",
    greater_than_or_equal: "is at least",
    less_than: "is less than",
    less_than_or_equal: "is at most",
    between: "falls between",
    includes_any: "includes any of",
    includes_all: "includes all of",
    excludes_all: "excludes all of",
    is_true: "matches",
    is_false: "matches",
    is_empty: "is empty",
    is_not_empty: "is present",
  }

  const verb = phrases[rule.operator]
  return outcome === "matched"
    ? `${label} ${verb} ${compareLabel}.`
    : `${label} does not satisfy ${verb} ${compareLabel}.`
}

export function evaluateServiceFitProfile(params: {
  profile: ServiceFitProfile
  catalog: ServiceFitFieldDefinition[]
  contact: ServiceFitContactSnapshot
  timezone?: string | null
}) {
  const { profile, catalog, contact, timezone } = params
  const fieldMap = new Map(catalog.map((field) => [`${field.source}:${field.fieldKey}`, field] as const))

  type EvaluatedRuleResult = {
    outcome: "matched" | "blocked" | "missing"
    entry: ServiceFitRuleEvaluation
  }

  function evaluateRule(rule: ServiceFitRule): EvaluatedRuleResult | null {
    const field = fieldMap.get(`${rule.source}:${rule.fieldKey}`)
    if (!field) return null

    const currentValue = resolveRuleValue(rule, contact, timezone)
    const isMissing =
      rule.source === "tags"
        ? false
        : isEmptyValue(currentValue, field.valueType)

    if (rule.operator === "is_empty") {
      const matched = isEmptyValue(currentValue, field.valueType)
      const reason = formatRuleReason(field, rule, matched ? "matched" : "blocked", timezone)
      const entry = { ruleId: rule.id, label: getFieldLabel(field, rule), reason }
      return { outcome: matched ? "matched" : "blocked", entry }
    }

    if (rule.operator === "is_not_empty") {
      if (isMissing) {
        return {
          outcome: "missing",
          entry: {
            ruleId: rule.id,
            label: getFieldLabel(field, rule),
            reason: formatRuleReason(field, rule, "missing", timezone),
          },
        }
      }
      return {
        outcome: "matched",
        entry: {
          ruleId: rule.id,
          label: getFieldLabel(field, rule),
          reason: formatRuleReason(field, rule, "matched", timezone),
        },
      }
    }

    if ((rule.operator === "is_true" || rule.operator === "is_false") && isMissing) {
      return {
        outcome: "missing",
        entry: {
          ruleId: rule.id,
          label: getFieldLabel(field, rule),
          reason: formatRuleReason(field, rule, "missing", timezone),
        },
      }
    }

    if (!EMPTY_VALUE_OPERATORS.has(rule.operator) && rule.operator !== "is_true" && rule.operator !== "is_false") {
      const shouldTreatAsMissing =
        field.valueType === "stringArray" ? rule.source !== "tags" && isMissing : isMissing
      if (shouldTreatAsMissing) {
        return {
          outcome: "missing",
          entry: {
            ruleId: rule.id,
            label: getFieldLabel(field, rule),
            reason: formatRuleReason(field, rule, "missing", timezone),
          },
        }
      }
    }

    const matched =
      field.valueType === "stringArray"
        ? evaluateArrayOperator(
            rule.operator,
            normalizeStringArray(currentValue),
            normalizeStringArray(rule.compareValue),
          )
        : rule.operator === "is_true"
          ? currentValue === true
          : rule.operator === "is_false"
            ? currentValue === false
            : evaluateScalarOperator(rule.operator, currentValue, rule.compareValue, field.valueType)

    const entry = {
      ruleId: rule.id,
      label: getFieldLabel(field, rule),
      reason: formatRuleReason(field, rule, matched ? "matched" : "blocked", timezone),
    }

    return { outcome: matched ? "matched" : "blocked", entry }
  }

  const matchedRules: ServiceFitRuleEvaluation[] = []
  const blockingRules: ServiceFitRuleEvaluation[] = []
  const missingRules: ServiceFitRuleEvaluation[] = []

  let scoredWeightTotal = 0
  let scoredWeightMatched = 0
  let hasRequiredFailure = false
  let hasRequiredMissing = false

  const globalRequiredRules = profile.rules.filter((rule) => rule.required && !rule.requiredGroup)
  const groupedRequiredRules = new Map<string, Map<string, ServiceFitRule[]>>()
  const optionalRules = profile.rules.filter((rule) => !rule.required)

  for (const rule of profile.rules.filter((item) => item.required && item.requiredGroup)) {
    const groupName = normalizeString(rule.requiredGroup)
    if (!groupName) continue

    const normalizedGroupKey = groupName.toLowerCase()
    const branchName = normalizeString(rule.requiredBranch) || normalizeString(rule.requiredGroup)
    const normalizedBranchKey = branchName.toLowerCase()
    if (!normalizedBranchKey) continue

    const group = groupedRequiredRules.get(normalizedGroupKey) ?? new Map<string, ServiceFitRule[]>()
    const branchRules = group.get(normalizedBranchKey) ?? []
    branchRules.push(rule)
    group.set(normalizedBranchKey, branchRules)
    groupedRequiredRules.set(normalizedGroupKey, group)
  }

  for (const rule of globalRequiredRules) {
    const result = evaluateRule(rule)
    if (!result) continue

    if (result.outcome === "matched") {
      matchedRules.push(result.entry)
    } else if (result.outcome === "missing") {
      missingRules.push(result.entry)
      hasRequiredMissing = true
    } else {
      blockingRules.push(result.entry)
      hasRequiredFailure = true
    }
  }

  type BranchEvaluation = {
    key: string
    matchedRules: ServiceFitRuleEvaluation[]
    blockingRules: ServiceFitRuleEvaluation[]
    missingRules: ServiceFitRuleEvaluation[]
    status: "PASSED" | "NEEDS_INFO" | "FAILED"
  }

  type RequiredGroupEvaluation = {
    key: string
    branches: BranchEvaluation[]
    selectedBranch: BranchEvaluation | null
    status: "PASSED" | "NEEDS_INFO" | "FAILED"
  }

  const groupEvaluations: RequiredGroupEvaluation[] = []
  for (const [key, branches] of groupedRequiredRules) {
    const branchEvaluations: BranchEvaluation[] = []

    for (const [branchKey, rules] of branches) {
      const branchMatched: ServiceFitRuleEvaluation[] = []
      const branchBlocking: ServiceFitRuleEvaluation[] = []
      const branchMissing: ServiceFitRuleEvaluation[] = []

      for (const rule of rules) {
        const result = evaluateRule(rule)
        if (!result) continue

        if (result.outcome === "matched") {
          branchMatched.push(result.entry)
        } else if (result.outcome === "missing") {
          branchMissing.push(result.entry)
        } else {
          branchBlocking.push(result.entry)
        }
      }

      branchEvaluations.push({
        key: branchKey,
        matchedRules: branchMatched,
        blockingRules: branchBlocking,
        missingRules: branchMissing,
        status:
          branchBlocking.length > 0
            ? "FAILED"
            : branchMissing.length > 0
              ? "NEEDS_INFO"
              : "PASSED",
      })
    }

    const pickBestGroup = (groups: BranchEvaluation[]) =>
      [...groups].sort(
        (a, b) =>
          b.matchedRules.length - a.matchedRules.length ||
          a.blockingRules.length - b.blockingRules.length ||
          a.missingRules.length - b.missingRules.length ||
          a.key.localeCompare(b.key),
      )[0] ?? null

    const passedBranch = pickBestGroup(branchEvaluations.filter((branch) => branch.status === "PASSED"))
    const needsInfoBranch = pickBestGroup(
      branchEvaluations.filter((branch) => branch.status === "NEEDS_INFO"),
    )
    const failedBranch = pickBestGroup(branchEvaluations.filter((branch) => branch.status === "FAILED"))
    const selectedBranch = passedBranch ?? needsInfoBranch ?? failedBranch

    groupEvaluations.push({
      key,
      branches: branchEvaluations,
      selectedBranch,
      status: passedBranch ? "PASSED" : needsInfoBranch ? "NEEDS_INFO" : "FAILED",
    })
  }

  if (groupEvaluations.length > 0) {
    for (const group of groupEvaluations) {
      if (group.selectedBranch) {
        matchedRules.push(...group.selectedBranch.matchedRules)
        blockingRules.push(...group.selectedBranch.blockingRules)
        missingRules.push(...group.selectedBranch.missingRules)
      }

      if (group.status === "NEEDS_INFO") {
        hasRequiredMissing = true
      } else if (group.status === "FAILED") {
        hasRequiredFailure = true
      }
    }
  }

  for (const rule of optionalRules) {
    const result = evaluateRule(rule)
    if (!result) continue

    scoredWeightTotal += rule.weight
    if (result.outcome === "matched") {
      matchedRules.push(result.entry)
      scoredWeightMatched += rule.weight
    } else if (result.outcome === "missing") {
      missingRules.push(result.entry)
    }
  }

  const eligibilityStatus = hasRequiredFailure
    ? "NOT_ELIGIBLE"
    : hasRequiredMissing
      ? "NEEDS_INFO"
      : "ELIGIBLE"

  const fitScore =
    scoredWeightTotal > 0
      ? Math.round((scoredWeightMatched / scoredWeightTotal) * 100)
      : eligibilityStatus === "ELIGIBLE"
        ? 100
        : 0

  return {
    eligibilityStatus,
    fitScore,
    matchedRules,
    blockingRules,
    missingRules,
    summary: profile.summary.trim(),
  } satisfies ServiceFitEvaluation
}

export function serializeServiceFitProfile(profile: unknown) {
  return normalizeServiceFitProfile(profile)
}

export function sortServiceFitEvaluations<T extends { eligibilityStatus: string; fitScore: number; serviceName: string }>(
  items: T[],
) {
  const statusRank = {
    ELIGIBLE: 0,
    NEEDS_INFO: 1,
    NOT_ELIGIBLE: 2,
  } as const

  return [...items].sort((left, right) => {
    const leftRank = statusRank[left.eligibilityStatus as keyof typeof statusRank] ?? 99
    const rightRank = statusRank[right.eligibilityStatus as keyof typeof statusRank] ?? 99
    if (leftRank !== rightRank) return leftRank - rightRank
    if (left.fitScore !== right.fitScore) return right.fitScore - left.fitScore
    return left.serviceName.localeCompare(right.serviceName)
  })
}

export function getServiceFitFieldLabel(source: ServiceFitRuleSource, fieldKey: string) {
  if (source === "core") return CORE_FIELD_LABELS.get(fieldKey) ?? fieldKey
  if (source === "status") return "Status"
  if (source === "tags") return "Tags"
  if (source === "derived" && fieldKey === "ageYears") return "Age in years"
  return fieldKey
}

export function formatServiceFitContactDate(value: Date | string | null | undefined, timezone?: string | null) {
  const parsed = parseDateValue(value)
  if (!parsed) return ""
  return formatDateOnly(parsed, timezone)
}
