export type AiAnalyticsChannel = "ALL" | "TEST" | "CONTACT_ASSISTANT"
export type AiAnalyticsPeriod = "7" | "30" | "90"
export type AiAnalyticsMetrics = {
  conversations: number
  answered: number
  needsReview: number
  qualificationRuns: number
}
export type AiAnalytics = {
  days: number
  channel: AiAnalyticsChannel
  timezone: "UTC"
  from: string
  through: string
  totals: AiAnalyticsMetrics
  daily: (AiAnalyticsMetrics & { date: string })[]
}
