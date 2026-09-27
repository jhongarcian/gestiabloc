export function waitingRunCountdown(nextActionAt: string | null, nowMs: number) {
  if (!nextActionAt) return "Schedule unavailable"
  const scheduledMs = new Date(nextActionAt).getTime()
  if (!Number.isFinite(scheduledMs)) return "Schedule unavailable"
  const remainingMs = scheduledMs - nowMs
  if (remainingMs <= 0) return "Due now"
  const minutes = Math.ceil(remainingMs / 60_000)
  return `${minutes.toLocaleString("en-US")} min remaining`
}
