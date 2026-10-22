import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { formatDateTimeForDisplay } from "@/lib/date-time"

export type RetiredServiceWorkflow = {
  template: { id: string; name: string } | null
  version: { id: string; versionNumber: number } | null
  previousStatus: string | null
  previousScheduledAt: string | null
  hadUnfinishedWork: boolean
  notice: string
}

export function RetiredServiceWorkflowNotice({ workflow, timezone }: {
  workflow?: RetiredServiceWorkflow | null
  timezone?: string | null
}) {
  if (!workflow) return null
  return (
    <Alert className="mb-4">
      <AlertTitle>Earlier workflow retired{workflow.template ? `: ${workflow.template.name}` : ""}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <p>{workflow.notice}</p>
        {workflow.version ? <p>Saved version {workflow.version.versionNumber}</p> : null}
        {workflow.hadUnfinishedWork && workflow.previousScheduledAt ? (
          <p>Previous schedule: {formatDateTimeForDisplay(workflow.previousScheduledAt, timezone)}. This is retained for reference; it will not run automatically.</p>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}
