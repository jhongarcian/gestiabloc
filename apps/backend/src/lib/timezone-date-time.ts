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
    timeZone: timezone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
  }).formatToParts(date)

  const label = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT"
  return parseOffsetMinutes(label)
}

export function zonedDateTimeToUtc(
  timezone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, 0)
  let utcMs = utcGuess

  for (let index = 0; index < 3; index += 1) {
    const offsetMinutes = getOffsetMinutes(timezone, new Date(utcMs))
    const adjusted = utcGuess - offsetMinutes * 60_000
    if (adjusted === utcMs) break
    utcMs = adjusted
  }

  return new Date(utcMs)
}
