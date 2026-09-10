const DEFAULT_TIMEZONE = "America/Chicago"

function safeTimezone(timezone?: string | null) {
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
    timeZone: safeTimezone(timezone),
    timeZoneName: "shortOffset",
    hour: "2-digit",
  }).formatToParts(date)

  const label = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT"
  return parseOffsetMinutes(label)
}

function getTimezoneDayParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)

  const getPart = (type: string, fallback: string) =>
    parts.find((part) => part.type === type)?.value ?? fallback

  return {
    year: Number(getPart("year", "0")),
    month: Number(getPart("month", "1")),
    day: Number(getPart("day", "1")),
  }
}

function zonedDateTimeToUtc(timezone: string, year: number, month: number, day: number) {
  const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0, 0)
  let utcMs = utcGuess

  for (let index = 0; index < 3; index += 1) {
    const adjusted = utcGuess - getOffsetMinutes(timezone, new Date(utcMs)) * 60_000
    if (adjusted === utcMs) break
    utcMs = adjusted
  }

  return new Date(utcMs)
}

export function getFollowUpListDateRanges(
  timezone?: string | null,
  now = new Date(),
) {
  const resolvedTimezone = safeTimezone(timezone)
  const today = getTimezoneDayParts(now, resolvedTimezone)
  const start = zonedDateTimeToUtc(
    resolvedTimezone,
    today.year,
    today.month,
    today.day,
  )
  const end = zonedDateTimeToUtc(
    resolvedTimezone,
    today.year,
    today.month,
    today.day + 1,
  )
  const nextSevenDaysEnd = zonedDateTimeToUtc(
    resolvedTimezone,
    today.year,
    today.month,
    today.day + 7,
  )

  return {
    today: { start, end },
    nextSevenDaysEnd,
  }
}
