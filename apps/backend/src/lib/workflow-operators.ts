function isEmpty(value: unknown) {
  if (value === null || value === undefined) return true
  if (typeof value === "string") return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

function comparableNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function comparableDate(value: unknown) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

export function evaluateWorkflowOperator<T extends { operator: string; valueType: string; compareValue?: unknown }>(condition: T, left: unknown) {
  if (condition.operator === "is_empty") return isEmpty(left)
  if (condition.operator === "is_not_empty") return !isEmpty(left)
  if (condition.valueType === "number") {
    const leftNumber = comparableNumber(left)
    const rightNumber = comparableNumber(condition.compareValue)
    if (leftNumber === null || rightNumber === null) return false
    if (condition.operator === "eq") return leftNumber === rightNumber
    if (condition.operator === "neq") return leftNumber !== rightNumber
    if (condition.operator === "gt") return leftNumber > rightNumber
    if (condition.operator === "gte") return leftNumber >= rightNumber
    if (condition.operator === "lt") return leftNumber < rightNumber
    if (condition.operator === "lte") return leftNumber <= rightNumber
    return false
  }
  if (condition.valueType === "dateTime") {
    const leftDate = comparableDate(left)
    const rightDate = comparableDate(condition.compareValue)
    if (!leftDate || !rightDate) return false
    if (condition.operator === "eq") return leftDate.getTime() === rightDate.getTime()
    if (condition.operator === "neq") return leftDate.getTime() !== rightDate.getTime()
    if (condition.operator === "gt") return leftDate > rightDate
    if (condition.operator === "gte") return leftDate >= rightDate
    if (condition.operator === "lt") return leftDate < rightDate
    if (condition.operator === "lte") return leftDate <= rightDate
    return false
  }
  if (condition.valueType === "boolean") {
    const right = condition.compareValue === true || condition.compareValue === "true"
    const leftBoolean = left === true || left === "true"
    return condition.operator === "neq" ? leftBoolean !== right : leftBoolean === right
  }
  const leftText = String(left ?? "").toLocaleLowerCase()
  const rightText = String(condition.compareValue ?? "").toLocaleLowerCase()
  if (condition.operator === "includes") return leftText.includes(rightText)
  if (condition.operator === "not_includes") return !leftText.includes(rightText)
  if (condition.operator === "eq") return leftText === rightText
  if (condition.operator === "neq") return leftText !== rightText
  return false
}

