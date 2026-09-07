export type ContactAssigneeUpdate = {
  assignedToUserId?: string | null
}

export function buildContactAssigneeUpdate(
  assignedToUserId: string | null | undefined,
): ContactAssigneeUpdate {
  return assignedToUserId === undefined ? {} : { assignedToUserId }
}
