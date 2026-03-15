type TaskActivityType =
  | "CREATED"
  | "UPDATED"
  | "STATUS_CHANGED"
  | "ASSIGNEE_CHANGED"
  | "DUE_DATE_CHANGED"
  | "START_DATE_CHANGED"
  | "REMINDER_CREATED"
  | "REMINDER_CANCELED"

type CreateTaskActivityInput = {
  prismaClient: any
  tenantId: string
  taskId: string
  actorUserId?: string | null
  type: TaskActivityType
  title: string
  details?: string | null
}

export async function createTaskActivity({
  prismaClient,
  tenantId,
  taskId,
  actorUserId,
  type,
  title,
  details,
}: CreateTaskActivityInput) {
  return prismaClient.taskActivity.create({
    data: {
      tenantId,
      taskId,
      actorUserId: actorUserId ?? null,
      type,
      title,
      details: details?.trim() || null,
    },
  })
}

