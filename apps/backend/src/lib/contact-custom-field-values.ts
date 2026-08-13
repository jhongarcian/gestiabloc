export type ContactCustomFieldDefinition = {
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
}

export function normalizeCustomFieldValue(
  field: ContactCustomFieldDefinition,
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
          (item): item is string => typeof item === "string" && item.trim().length > 0,
        )
      : []

    if (value.some((item) => !field.options.includes(item))) {
      return { ok: false as const, message: `${field.label} has invalid option values.` }
    }
    if (field.isRequired && value.length === 0) {
      return { ok: false as const, message: `${field.label} is required.` }
    }
    return { ok: true as const, value: value.length > 0 ? value : null }
  }

  if (field.fieldType === "NUMBER" || field.fieldType === "CURRENCY") {
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
    if (!Number.isFinite(numericValue)) {
      return {
        ok: false as const,
        message:
          field.fieldType === "CURRENCY"
            ? `${field.label} must be a valid amount.`
            : `${field.label} must be a number.`,
      }
    }
    return { ok: true as const, value: numericValue }
  }

  if (field.fieldType === "PHONE") {
    const textValue =
      typeof rawValue === "string" && rawValue.trim().length > 0 ? rawValue.trim() : null
    if (field.isRequired && !textValue) {
      return { ok: false as const, message: `${field.label} is required.` }
    }
    if (textValue && !/^\+[1-9]\d{7,14}$/.test(textValue)) {
      return { ok: false as const, message: `${field.label} must be a valid phone number.` }
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
      return { ok: false as const, message: `${field.label} must be a valid date.` }
    }
    const parsedDate = new Date(rawValue)
    if (Number.isNaN(parsedDate.getTime())) {
      return { ok: false as const, message: `${field.label} must be a valid date.` }
    }
    return { ok: true as const, value: parsedDate.toISOString() }
  }

  const textValue =
    typeof rawValue === "string" && rawValue.trim().length > 0 ? rawValue.trim() : null
  if (
    (field.fieldType === "SELECT" || field.fieldType === "RADIO") &&
    textValue &&
    !field.options.includes(textValue)
  ) {
    return { ok: false as const, message: `${field.label} has an invalid option.` }
  }
  if (field.isRequired && !textValue) {
    return { ok: false as const, message: `${field.label} is required.` }
  }
  return { ok: true as const, value: textValue }
}
