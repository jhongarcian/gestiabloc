import { parseDateInput } from "@/components/ui/date-input"
import {
  dateTimeDraftToUtcIso,
  formatUtcIsoToDateTimeDraft,
  type DateTimeDraft,
} from "@/lib/date-time"

export type CompletionWait = {
  runId: string
  automationId: string | null
  automationName?: string
  waitingNodeExecutionId: string
  resumeAt: string
  status: "WAITING" | "RUNNING"
}

export type WaitSchedule =
  | { mode: "DURATION"; amount: number; unit: "SECONDS" | "MINUTES" | "HOURS" | "DAYS" }
  | { mode: "FIXED_DATE"; dateTime: string }

export function waitChangeTarget(wait: CompletionWait) {
  return {
    runId: wait.runId,
    waitingNodeExecutionId: wait.waitingNodeExecutionId,
    expectedResumeAt: wait.resumeAt,
  }
}

export function fixedWaitSchedule(
  value: DateTimeDraft,
  timezone?: string | null,
  now = Date.now(),
): WaitSchedule | null {
  if (!parseDateInput(value.date)) return null
  const dateTime = dateTimeDraftToUtcIso(value, timezone)
  if (!dateTime || new Date(dateTime).getTime() <= now) return null
  // Reject nonexistent local times (for example during the spring daylight-saving change).
  const roundTrip = formatUtcIsoToDateTimeDraft(dateTime, timezone)
  if (roundTrip.date !== value.date || roundTrip.time !== value.time) return null
  return { mode: "FIXED_DATE", dateTime }
}
