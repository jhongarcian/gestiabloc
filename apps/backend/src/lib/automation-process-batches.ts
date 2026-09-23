export const AUTOMATION_PROCESS_BATCH_SIZE = 100

export function getAutomationProcessBatchCount(contactCount: number) {
  if (!Number.isInteger(contactCount) || contactCount < 1) return 0
  return Math.ceil(contactCount / AUTOMATION_PROCESS_BATCH_SIZE)
}
