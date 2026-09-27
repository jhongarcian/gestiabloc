export type CalendarDateOffsetUnit = "DAYS" | "WEEKS" | "MONTHS"
export type CalendarDateMathUnit = "DAYS" | "MONTHS" | "YEARS"

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function daysInMonth(year: number, month: number) {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

export function shiftCalendarDate(
  dateKey: string,
  amount: number,
  unit: CalendarDateMathUnit,
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !Number.isSafeInteger(amount)) {
    return null
  }

  const [yearValue, monthValue, dayValue] = dateKey.split("-").map(Number)
  const year = yearValue ?? Number.NaN
  const month = monthValue ?? Number.NaN
  const day = dayValue ?? Number.NaN
  if (
    !year ||
    year > 9999 ||
    !month ||
    month > 12 ||
    !day ||
    day > daysInMonth(year, month)
  ) {
    return null
  }

  if (unit === "MONTHS") {
    const monthIndex = year * 12 + month - 1 + amount
    const targetYear = Math.floor(monthIndex / 12)
    const targetMonthIndex = ((monthIndex % 12) + 12) % 12
    if (targetYear < 1 || targetYear > 9999) return null
    const targetMonth = targetMonthIndex + 1
    const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth))
    return `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`
  }

  if (unit === "YEARS") {
    const targetYear = year + amount
    if (targetYear < 1 || targetYear > 9999) return null
    const targetDay = Math.min(day, daysInMonth(targetYear, month))
    return `${String(targetYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`
  }

  const source = new Date(`${dateKey}T12:00:00.000Z`)
  source.setUTCDate(source.getUTCDate() + amount)
  const targetYear = source.getUTCFullYear()
  if (targetYear < 1 || targetYear > 9999) return null
  return source.toISOString().slice(0, 10)
}

export function addCalendarDateOffset(
  dateKey: string,
  amount: number,
  unit: CalendarDateOffsetUnit,
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !Number.isInteger(amount) || amount < 1) {
    return null
  }

  const [year, month, day] = dateKey.split("-").map(Number)
  const source = new Date(Date.UTC(year!, month! - 1, day!))
  if (
    Number.isNaN(source.getTime()) ||
    source.toISOString().slice(0, 10) !== dateKey
  ) {
    return null
  }

  if (unit === "MONTHS") {
    const monthIndex = year! * 12 + month! - 1 + amount
    const targetYear = Math.floor(monthIndex / 12)
    const targetMonthIndex = monthIndex % 12
    const lastDay = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate()
    const targetDay = Math.min(day!, lastDay)
    return `${String(targetYear).padStart(4, "0")}-${String(targetMonthIndex + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`
  }

  source.setUTCDate(source.getUTCDate() + amount * (unit === "WEEKS" ? 7 : 1))
  return source.toISOString().slice(0, 10)
}
