export function registerRealtimeNotification(
  knownNotificationIds: Set<string>,
  notificationId: string,
) {
  if (knownNotificationIds.has(notificationId)) return false
  knownNotificationIds.add(notificationId)
  return true
}
