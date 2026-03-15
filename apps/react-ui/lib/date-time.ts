export type DateTimeDraft = {
  date: string
  time: string
}

const DEFAULT_TIMEZONE = "America/Chicago"

function getSafeTimezone(timezone?: string | null) {
  return timezone?.trim() || DEFAULT_TIMEZONE
}

function parseOffsetMinutes(label: string) {
  if (label === "GMT" || label === "UTC") return 0

  const normalized = label.replace("UTC", "GMT")
  const match = normalized.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/)
  if (!match) return 0

  const [, sign, hours, minutes] = match
  const total = Number(hours) * 60 + Number(minutes ?? "0")
  return sign === "-" ? -total : total
}

function getOffsetMinutes(timezone: string, date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: getSafeTimezone(timezone),
    timeZoneName: "shortOffset",
    hour: "2-digit",
  }).formatToParts(date)

  const label = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT"
  return parseOffsetMinutes(label)
}

export function parseTimeInput(value: string) {
  const trimmed = value.trim()
  const match = trimmed.match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/)
  if (!match) return null

  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: Number(match[3] ?? "0"),
  }
}

export function isDateTimeDraftEmpty(value: DateTimeDraft) {
  return value.date.trim().length === 0 && value.time.trim().length === 0
}

export function isDateTimeDraftComplete(value: DateTimeDraft) {
  return value.date.trim().length > 0 && parseTimeInput(value.time) !== null
}

export function dateTimeDraftToUtcIso(
  value: DateTimeDraft,
  timezone?: string | null,
) {
  const dateMatch = value.date.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  const timeParts = parseTimeInput(value.time)

  if (!dateMatch || !timeParts) return null

  const [, month, day, year] = dateMatch
  const safeTimezone = getSafeTimezone(timezone)
  const utcGuess = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    timeParts.hour,
    timeParts.minute,
    timeParts.second,
    0,
  )

  let utcMs = utcGuess
  for (let index = 0; index < 3; index += 1) {
    const offsetMinutes = getOffsetMinutes(safeTimezone, new Date(utcMs))
    const adjusted = utcGuess - offsetMinutes * 60_000
    if (adjusted === utcMs) break
    utcMs = adjusted
  }

  return new Date(utcMs).toISOString()
}

export function formatUtcIsoToDateTimeDraft(
  value: string | null,
  timezone?: string | null,
): DateTimeDraft {
  if (!value) {
    return {
      date: "",
      time: "",
    }
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return {
      date: "",
      time: "",
    }
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: getSafeTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date)

  const getPart = (type: string, fallback = "") =>
    parts.find((part) => part.type === type)?.value ?? fallback

  return {
    date: `${getPart("month")}/${getPart("day")}/${getPart("year")}`,
    time: `${getPart("hour", "00")}:${getPart("minute", "00")}`,
  }
}

export function formatDateTimeForDisplay(
  value: string | null,
  timezone?: string | null,
  includeSeconds = false,
) {
  if (!value) return "—"

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"

  return new Intl.DateTimeFormat("en-US", {
    timeZone: getSafeTimezone(timezone),
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" as const } : {}),
  }).format(date)
}

export function formatDateForDisplay(value: string | null, timezone?: string | null) {
  if (!value) return "—"

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"

  return new Intl.DateTimeFormat("en-US", {
    timeZone: getSafeTimezone(timezone),
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(date)
}
