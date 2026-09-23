export type AutomationProcessStatus =
  | "PREPARING"
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "COMPLETED_WITH_ERRORS"
  | "FAILED"

export type AutomationProcess = {
  id: string
  processName: string
  automationId: string | null
  automationName: string
  status: AutomationProcessStatus
  requestedByName: string
  expectedContacts: number
  totalContacts: number
  processedContacts: number
  succeededContacts: number
  failedContacts: number
  totalBatches: number
  completedBatches: number
  startedAt: string | null
  completedAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export type AutomationProcessBatch = {
  id: string
  batchNumber: number
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "COMPLETED_WITH_ERRORS"
  contactCount: number
  succeededContacts: number
  failedContacts: number
  attemptCount: number
  startedAt: string | null
  completedAt: string | null
  errorMessage: string | null
}

export type AutomationProcessDetail = AutomationProcess & {
  batches: AutomationProcessBatch[]
  visibleBatchLimit: number
}

export const ACTIVE_AUTOMATION_PROCESS_STATUSES = new Set<AutomationProcessStatus>([
  "PREPARING",
  "QUEUED",
  "RUNNING",
])

export function automationProcessPercent(process: AutomationProcess) {
  const total = Math.max(process.expectedContacts, process.totalContacts, 1)
  if (process.status === "PREPARING") {
    return Math.min(100, Math.round((process.totalContacts / total) * 100))
  }
  return Math.min(100, Math.round((process.processedContacts / total) * 100))
}

export function automationProcessStatusLabel(status: AutomationProcessStatus) {
  if (status === "COMPLETED_WITH_ERRORS") return "Completed with errors"
  return status.charAt(0) + status.slice(1).toLowerCase()
}
