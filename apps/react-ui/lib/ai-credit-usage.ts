import type { PlanKey } from "./subscription-plans"
export type AiCreditUsage = {
  revision: number; purchaseReviewRequired: boolean
  period: { startsAt: string; endsAt: string } | null
  monthly: { granted: number; used: number; reserved: number; remaining: number }
  purchased: { balance: number; reserved: number; available: number }
  available: number
}
export type AiCreditOverview = {
  enabled: boolean; enforcementEnabled: boolean; asOf: string; timeZone: string | null
  plan: { key: PlanKey; name: string; monthlyAllowance: number } | null
  access: { crmAllowed: boolean; aiAllowed: boolean; state: string; graceEndsAt: string | null } | null
  paidThrough?: string | null; cancelAtPeriodEnd?: boolean
  purchasesEnabled: boolean; eligible: boolean; canResume: boolean
  usage: AiCreditUsage | null
  pendingCheckout: { id: string; packKey: string; url: string | null } | null
}
export function creditUsageIsConsistent(u: AiCreditUsage) {
  const { monthly: m, purchased: p } = u
  if (!m || !p || (m.granted > 0 && !u.period)) return false
  return [m.granted, m.used, m.reserved, m.remaining, p.balance, p.reserved, p.available, u.available].every(v => Number.isSafeInteger(v) && v >= 0)
    && m.granted === m.used + m.reserved + m.remaining && p.balance === p.reserved + p.available && u.available === m.remaining + p.available
    && (!u.period || (Number.isFinite(Date.parse(u.period.startsAt)) && Date.parse(u.period.endsAt) > Date.parse(u.period.startsAt)))
}
type CreditDisplay = { state: "unavailable" | "invalid" } | { state: "review" | "paused" | "reserved" | "exhausted" | "low" | "ready"; reserved: number; available: number; monthlyPercent: number | null }
export function creditDisplay(data: AiCreditOverview): CreditDisplay {
  const u = data.usage
  if (!data.enabled || !data.enforcementEnabled || !u) return { state: "unavailable" as const }
  if (!creditUsageIsConsistent(u)) return { state: "invalid" as const }
  const reserved = u.monthly.reserved + u.purchased.reserved
  const state = u.purchaseReviewRequired ? "review" : !data.access?.aiAllowed ? "paused"
    : u.available === 0 ? reserved > 0 ? "reserved" : "exhausted"
    : u.monthly.granted > 0 && u.available <= Math.ceil(u.monthly.granted * .1) ? "low" : "ready"
  return { state, reserved, available: u.available,
    // Positive fill represents credits remaining, never successful consumption.
    monthlyPercent: u.monthly.granted ? Math.min(100, Math.max(0, Math.round(u.monthly.remaining / u.monthly.granted * 100))) : null }
}
export function formatCreditDate(value: string | null | undefined, timeZone?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return null
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone: timeZone ?? "America/Chicago" }
  try { return new Intl.DateTimeFormat("en-US", opts).format(new Date(value)) }
  catch { return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(new Date(value)) }
}
export function nextCreditRefresh(data: AiCreditOverview | undefined, now = Date.now()) {
  const deadlines = [data?.usage?.period?.endsAt, data?.paidThrough, data?.access?.graceEndsAt].flatMap(value => {
    const at = value ? Date.parse(value) : NaN
    return Number.isFinite(at) && at > now ? [at - now + 100] : []
  })
  return Math.max(1000, Math.min(30000, ...deadlines))
}
