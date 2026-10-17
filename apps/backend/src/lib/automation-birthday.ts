const DEFAULT_TIMEZONE = "America/Chicago"

export function birthdayTimezone(value?: string | null) {
  if (!value) return DEFAULT_TIMEZONE
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value })
    return value
  } catch {
    return DEFAULT_TIMEZONE
  }
}

export function birthdayLocalClock(instant: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant)
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00"
  const year = Number(part("year"))
  const month = Number(part("month"))
  const day = Number(part("day"))
  return {
    year,
    month,
    day,
    localDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    localTime: `${part("hour")}:${part("minute")}`,
  }
}

export function isBirthdayOnLocalDate(dateOfBirth: Date | null, year: number, month: number, day: number) {
  if (!dateOfBirth || Number.isNaN(dateOfBirth.getTime()) || dateOfBirth.getUTCFullYear() > year) return false
  const birthMonth = dateOfBirth.getUTCMonth() + 1
  const birthDay = dateOfBirth.getUTCDate()
  if (birthMonth === month && birthDay === day) return true
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  return birthMonth === 2 && birthDay === 29 && month === 2 && day === 28 && !leapYear
}

export function isBirthdayReminderDue(localTime: string, scheduledLocalTime: string) {
  return localTime >= scheduledLocalTime
}
