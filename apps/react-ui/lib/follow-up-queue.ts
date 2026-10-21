export type FollowUpQueueState = "ACTIONABLE" | "SCHEDULED" | "NEEDS_ATTENTION" | "FINISHED"
export type FollowUpTiming = {
  status: "OVERDUE" | "DUE_SOON" | "ON_TRACK" | "NONE"
  remainingMs: number | null
  timeframeMs: number | null
  warningAt: string | null
}

export const FOLLOW_UP_QUEUE_OPTIONS = [
  { value: "ALL", label: "All work" },
  { value: "ACTIONABLE", label: "Actionable" },
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "NEEDS_ATTENTION", label: "Needs attention" },
  { value: "FINISHED", label: "Finished" },
] as const

export function sanitizeFollowUpQueue(value: string | null) {
  return FOLLOW_UP_QUEUE_OPTIONS.find((option) => option.value === value)?.value ?? "ALL"
}

export function followUpTimeRemaining(timing: FollowUpTiming): string | null {
  if (timing.status === "NONE" || timing.remainingMs === null) return null
  const ms = Math.abs(timing.remainingMs)
  let duration: string
  if (ms < 60000) duration = "Less than a minute"
  else if (ms < 3600000) {
    const minutes = Math.floor(ms / 60000)
    duration = `${minutes} ${minutes === 1 ? "minute" : "minutes"}`
  } else if (ms < 86400000) {
    const hours = Math.floor(ms / 3600000)
    const minutes = Math.floor((ms % 3600000) / 60000)
    duration = `${hours} ${hours === 1 ? "hour" : "hours"}${minutes ? ` ${minutes} min` : ""}`
  } else {
    const days = Math.floor(ms / 86400000)
    const hours = Math.floor((ms % 86400000) / 3600000)
    duration = `${days} ${days === 1 ? "day" : "days"}${hours ? ` ${hours} hr` : ""}`
  }
  return `${duration} ${timing.status === "OVERDUE" ? "overdue" : "left"}`
}
