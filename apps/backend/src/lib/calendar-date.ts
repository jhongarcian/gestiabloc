export type CalendarDateOffsetUnit = "DAYS" | "WEEKS" | "MONTHS"

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
