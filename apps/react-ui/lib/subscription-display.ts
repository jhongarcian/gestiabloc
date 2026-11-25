export function formatSubscriptionDate(value: string | null | undefined, timeZone?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—"
  const options: Intl.DateTimeFormatOptions = {
    month: "short", day: "numeric", year: "numeric", timeZone: timeZone ?? "America/Chicago",
  }
  try { return new Intl.DateTimeFormat("en-US", options).format(new Date(value)) }
  catch { return `${new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(value))} UTC` }
}

export function formatStorageSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—"
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(bytes / 1024 ** index)} ${units[index]}`
}

export const subscriptionPlanDescriptions = {
  STARTER: "For small teams getting organized.",
  PRO: "More room for a growing agency.",
  BUSINESS: "Capacity for larger, established teams.",
} as const
