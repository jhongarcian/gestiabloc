import type { Server } from "socket.io"

export type RealtimeNotificationPayload = {
  id: string
  tenantId: string
  userId: string
  contactId: string | null
  type:
    | "TASK_REMINDER"
    | "TASK_ASSIGNED"
    | "TASK_DUE"
    | "CUSTOM_FIELD_ACCESS_REQUEST"
    | "CUSTOM_FIELD_ACCESS_GRANTED"
  title: string
  body: string | null
  readAt: string | null
  createdAt: string
  taskId: string | null
  taskReminderId: string | null
}

let io: Server | null = null

export function setRealtimeServer(server: Server) {
  io = server
}

export function getUserRoom(userId: string) {
  return `user:${userId}`
}

export function emitNotificationCreated(
  userId: string,
  notification: RealtimeNotificationPayload,
) {
  io?.to(getUserRoom(userId)).emit("notification:created", notification)
}
