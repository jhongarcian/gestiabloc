const VISIBLE_CONTACT_FOLLOW_UP_SERVICE_STATUSES = new Set([
  "IN_PROGRESS",
  "PENDING_PAYMENT",
])

export type ContactFollowUpServiceCandidate = {
  status: string
  followUpStepCount: number
  service: {
    id: string
    name: string
  }
}

export function isContactFollowUpServiceVisible(
  candidate: Pick<ContactFollowUpServiceCandidate, "status" | "followUpStepCount">,
) {
  return (
    VISIBLE_CONTACT_FOLLOW_UP_SERVICE_STATUSES.has(candidate.status) &&
    candidate.followUpStepCount > 0
  )
}

export function summarizeVisibleContactFollowUpServices(
  candidates: ContactFollowUpServiceCandidate[],
) {
  const servicesById = new Map<string, { id: string; name: string }>()

  for (const candidate of candidates) {
    if (!isContactFollowUpServiceVisible(candidate)) continue
    if (!servicesById.has(candidate.service.id)) {
      servicesById.set(candidate.service.id, candidate.service)
    }
  }

  return Array.from(servicesById.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  )
}

