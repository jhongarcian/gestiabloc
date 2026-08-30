export const CONTACT_SERVICE_CHECKLIST_STATUSES = [
  "NOT_RECEIVED",
  "INFORMED",
  "MISSING",
  "RECEIVED",
] as const

export type ContactServiceChecklistStatus =
  (typeof CONTACT_SERVICE_CHECKLIST_STATUSES)[number]

export function hasExactlyOneChecklistStatusInput(input: {
  status?: ContactServiceChecklistStatus
  completed?: boolean
}) {
  return Number(input.status !== undefined) + Number(input.completed !== undefined) === 1
}

export function resolveContactServiceChecklistStatus(input: {
  status?: ContactServiceChecklistStatus
  completed?: boolean
}): ContactServiceChecklistStatus {
  if (input.status) return input.status
  return input.completed ? "RECEIVED" : "NOT_RECEIVED"
}

export function resolveContactServiceChecklistTransition(input: {
  currentStatus: ContactServiceChecklistStatus
  currentCompletedAt: Date | null
  nextStatus: ContactServiceChecklistStatus
  now: Date
}) {
  const changed = input.currentStatus !== input.nextStatus

  return {
    changed,
    completedAt:
      input.nextStatus === "RECEIVED"
        ? input.currentStatus === "RECEIVED"
          ? input.currentCompletedAt ?? input.now
          : input.now
        : null,
  }
}

export function buildContactServiceChecklistActivityData(input: {
  tenantId: string
  contactServiceId: string
  contactServiceChecklistItemId: string
  itemLabel: string
  previousStatus: ContactServiceChecklistStatus
  status: ContactServiceChecklistStatus
  actorUserId: string
}) {
  return { ...input }
}
