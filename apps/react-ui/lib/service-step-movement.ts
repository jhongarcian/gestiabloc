export type StepMovement = {
  id: string
  kind: "MOVE" | "SKIP"
  fromOccurrenceId: string
  fromStepId: string
  fromStepTitle: string
  toOccurrenceId: string | null
  toStepId: string | null
  toStepTitle: string | null
  skippedStepIds: string[]
  reason: string
  actorName: string
  createdAt: string
}

type StepEntry = {
  id: string
  status: string
  progressionStatus: string
  supersededAt?: string | null
  enteredAt: string
  createdAt?: string
}
type MovementStep = { id: string; title: string; occurrences: StepEntry[] }

export function currentServiceStep<T extends MovementStep>(steps: T[]) {
  const entries = steps
    .flatMap((step) => step.occurrences.map((entry) => ({ step, entry })))
    .sort(
      (left, right) =>
        new Date(right.entry.createdAt ?? right.entry.enteredAt).getTime() -
          new Date(left.entry.createdAt ?? left.entry.enteredAt).getTime() ||
        right.entry.id.localeCompare(left.entry.id),
    )
  return (
    entries.find(({ entry }) => !entry.supersededAt && entry.status === "ACTIVE") ??
    entries.find(
      ({ entry }) =>
        !entry.supersededAt && ["WAITING_AUTOMATION", "PAUSED"].includes(entry.progressionStatus),
    ) ??
    entries[0] ??
    null
  )
}

export function skippedByStepMove<T extends { id: string }>(
  steps: T[],
  fromStepId: string,
  targetStepId: string,
  active: boolean,
) {
  const from = steps.findIndex((step) => step.id === fromStepId)
  const to = steps.findIndex((step) => step.id === targetStepId)
  if (from < 0 || to <= from) return []
  return steps.slice(from, to).filter((step) => active || step.id !== fromStepId)
}
