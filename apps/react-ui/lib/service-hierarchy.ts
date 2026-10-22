export type ServiceOfferingOption = {
  id: string
  name: string
  kind?: "GROUP" | "OFFERING"
  isActive?: boolean
  parentServiceId?: string | null
  parentService?: { id: string; name: string; isActive?: boolean } | null
  stepsCount?: number
}

export function serviceOfferingLabel(service: ServiceOfferingOption) {
  return service.parentService ? `${service.parentService.name} / ${service.name}` : service.name
}
export function serviceGroups(offerings: ServiceOfferingOption[]) {
  return [...new Map(offerings.flatMap(item => item.parentService ? [[item.parentService.id, item.parentService] as const] : [])).values()]
    .sort((a, b) => a.name.localeCompare(b.name))
}
export function offeringsInGroup(offerings: ServiceOfferingOption[], groupId: string) {
  return offerings.filter(item => item.kind !== "GROUP" && (!groupId || item.parentService?.id === groupId))
}
export function serviceWorkflowError(service: { steps?: unknown[] } | null | undefined) {
  return !service ? "Choose a sub-service and wait for its configuration to load."
    : !service.steps?.length ? "Add steps to this sub-service before creating an enrollment." : null
}

type ProgressStep = {
  id?: string
  occurrences: Array<{
    status: string
    enteredAt?: string
    createdAt?: string
    supersededAt?: string | null
    progressionStatus?: string
  }>
}
type ProgressMovement = { skippedStepIds: string[]; createdAt: string }

function wasStepBypassed(step: ProgressStep, movements: ProgressMovement[]) {
  const latest = step.occurrences.at(-1)
  const skippedAt = movements
    .filter(move => step.id && move.skippedStepIds.includes(step.id))
    .reduce((last, move) => Math.max(last, new Date(move.createdAt).getTime()), 0)
  return Boolean(skippedAt && (!latest || new Date(latest.createdAt ?? latest.enteredAt ?? 0).getTime() < skippedAt))
}

export function enrolledServiceStepLabel(step: ProgressStep, movements: ProgressMovement[] = []) {
  if (wasStepBypassed(step, movements)) return "Skipped"
  const entry = step.occurrences.at(-1)
  if (!entry) return "Upcoming"
  if (!entry.supersededAt && entry.progressionStatus === "WAITING_AUTOMATION") return "Waiting for automation"
  if (!entry.supersededAt && entry.progressionStatus === "PAUSED") return "Needs attention"
  return ({ ACTIVE: "Current step", COMPLETED: "Completed", SKIPPED: "Skipped", CANCELED: "Canceled" })[entry.status] ?? "Upcoming"
}

export function enrolledServiceStepProgress(steps: ProgressStep[], movements: ProgressMovement[] = []) {
  const completed = steps.filter(step => wasStepBypassed(step, movements) || ["COMPLETED", "SKIPPED"].includes(step.occurrences.at(-1)?.status ?? "")).length
  return { total: steps.length, completed, remaining: steps.length - completed, percentage: steps.length ? Math.round(completed / steps.length * 100) : 0 }
}
