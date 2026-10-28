import {
  dateTimeDraftToUtcIso,
  formatUtcIsoToDateTimeDraft,
  type DateTimeDraft,
} from "@/lib/date-time"

export type StepDeadlineSchedule =
  | { mode: "DEFAULT" }
  | { mode: "DURATION"; amount: number; unit: "MINUTES" | "HOURS" | "DAYS" }
  | { mode: "FIXED_DATE"; dateTime: string }

export type StepDeadlineChange = {
  id: string
  previousDueAt: string
  dueAt: string
  schedule: StepDeadlineSchedule
  actorName: string
  createdAt: string
  revision: number
}

export type StepDeadlineOccurrence = {
  id: string
  enteredAt: string
  dueAt: string
  defaultDueAt: string
  deadlineOverride: Exclude<StepDeadlineSchedule, { mode: "DEFAULT" }> | null
  deadlineRevision: number
  deadlineChanges: StepDeadlineChange[]
  status: string
  supersededAt?: string | null
}

const unitMs = { MINUTES: 60000, HOURS: 3600000, DAYS: 86400000 }
const maxDurationMs = 3650 * unitMs.DAYS

export function previewStepDeadline(
  occurrence: Pick<StepDeadlineOccurrence, "enteredAt" | "defaultDueAt">,
  schedule: StepDeadlineSchedule,
): string | null {
  if (schedule.mode === "DEFAULT") return occurrence.defaultDueAt
  if (
    schedule.mode === "DURATION" &&
    (!Number.isSafeInteger(schedule.amount) || schedule.amount < 1)
  )
    return null
  const entry = new Date(occurrence.enteredAt).getTime()
  const due =
    schedule.mode === "DURATION"
      ? entry + schedule.amount * unitMs[schedule.unit]
      : new Date(schedule.dateTime).getTime()
  return Number.isFinite(due) && due > entry && due - entry <= maxDurationMs
    ? new Date(due).toISOString()
    : null
}

export function fixedStepDeadline(
  value: DateTimeDraft,
  occurrence: Pick<StepDeadlineOccurrence, "enteredAt" | "defaultDueAt">,
  timezone?: string | null,
): StepDeadlineSchedule | null {
  const dateTime = dateTimeDraftToUtcIso(value, timezone)
  if (!dateTime) return null
  const roundTrip = formatUtcIsoToDateTimeDraft(dateTime, timezone)
  if (roundTrip.date !== value.date || roundTrip.time !== value.time) return null
  const schedule = { mode: "FIXED_DATE" as const, dateTime }
  return previewStepDeadline(occurrence, schedule) ? schedule : null
}

// Keep a just-saved deadline visible if refreshing the workspace fails. Status still
// comes from the parent, so a completed or moved entry cannot regain edit controls.
export function latestStepDeadline<T extends StepDeadlineOccurrence>(
  occurrence: T,
  saved: StepDeadlineOccurrence | null,
): T {
  return saved?.id === occurrence.id && saved.deadlineRevision > occurrence.deadlineRevision
    ? {
        ...occurrence,
        dueAt: saved.dueAt,
        defaultDueAt: saved.defaultDueAt,
        deadlineOverride: saved.deadlineOverride,
        deadlineRevision: saved.deadlineRevision,
        deadlineChanges: saved.deadlineChanges,
      }
    : occurrence
}
