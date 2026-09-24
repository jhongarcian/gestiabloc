export type TaskPriority = "HIGH" | "MEDIUM" | "LOW"

const DAY_IN_MS = 24 * 60 * 60 * 1000
const DEFAULT_TIMEZONE = "America/Chicago"

function getSafeTimezone(timezone?: string | null) {
  return timezone?.trim() || DEFAULT_TIMEZONE
}

export function isCompletedStatusName(statusName?: string | null) {
  return statusName?.trim().toLowerCase() === "completed"
}

function getLocalDateParts(date: Date, timezone?: string | null) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: getSafeTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })

  const parts = formatter.formatToParts(date)

  return {
    year: Number(parts.find((part) => part.type === "year")?.value ?? "0"),
    month: Number(parts.find((part) => part.type === "month")?.value ?? "1"),
    day: Number(parts.find((part) => part.type === "day")?.value ?? "1"),
  }
}

export function isSameLocalDay(
  left: Date | null,
  right: Date | null,
  timezone?: string | null,
) {
  if (!left || !right) return false

  const leftParts = getLocalDateParts(left, timezone)
  const rightParts = getLocalDateParts(right, timezone)

  return (
    leftParts.year === rightParts.year &&
    leftParts.month === rightParts.month &&
    leftParts.day === rightParts.day
  )
}

function startOfDayInTimezone(date: Date, timezone?: string | null) {
  const { year, month, day } = getLocalDateParts(date, timezone)
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0))
}

export function getTaskDueDayOffset(
  dueDate: Date | null,
  timezone?: string | null,
) {
  if (!dueDate) return null

  const today = startOfDayInTimezone(new Date(), timezone)
  const dueDay = startOfDayInTimezone(dueDate, timezone)
  return Math.floor((dueDay.getTime() - today.getTime()) / DAY_IN_MS)
}

export function getTaskPriorityFromDueDate(
  dueDate: Date | null,
  timezone?: string | null,
  isCompleted = false,
) {
  if (isCompleted || !dueDate) return null

  const diffInDays = getTaskDueDayOffset(dueDate, timezone)
  if (diffInDays === null) return null

  if (diffInDays < 3) return "HIGH" satisfies TaskPriority
  if (diffInDays <= 7) return "MEDIUM" satisfies TaskPriority
  return "LOW" satisfies TaskPriority
}
