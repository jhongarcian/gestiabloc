import { Clock3 } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { cn } from "@/lib/utils"

type ServiceWorkflowPreviewStep = {
  id: string
  title: string
  instructions: string | null
  completionDuration: number
  completionUnit: "MINUTES" | "HOURS" | "DAYS"
  sortOrder: number
}

export function ServiceWorkflowTimeline({
  steps,
  serviceName,
}: {
  steps: ServiceWorkflowPreviewStep[]
  serviceName?: string
}) {
  if (!steps.length) {
    return (
      <Alert className="border-0 bg-transparent p-0">
        <AlertTitle>No steps configured</AlertTitle>
        <AlertDescription>
          This service needs steps configured by an administrator before it can be purchased.
        </AlertDescription>
      </Alert>
    )
  }

  const orderedSteps = [...steps].sort((left, right) => left.sortOrder - right.sortOrder)

  return (
    <section aria-label="Service workflow" className="@container/purchase-workflow flex min-w-0 flex-col gap-5">
      <header className="flex min-w-0 flex-col gap-1.5">
        <p className="text-xs font-medium text-blue-700">Workflow timeline</p>
        <h3 className="text-base font-semibold">Service steps</h3>
        <p className="text-sm text-muted-foreground">
          Review the steps included with this service, in their configured order.
        </p>
      </header>
      <div className="flex min-w-0 flex-col gap-5">
        <section
          aria-label="Workflow summary"
          className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b pb-4"
        >
          <div className="flex min-w-0 flex-col gap-1">
            {serviceName ? <p className="break-words text-sm font-semibold">{serviceName}</p> : null}
            <p className="text-xs text-muted-foreground">
              {orderedSteps.length} total {orderedSteps.length === 1 ? "step" : "steps"}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Starts after purchase
          </p>
        </section>
        <ol aria-label="Service workflow preview" className="flex min-w-0 flex-col">
          {orderedSteps.map((step, index) => {
            const isFirst = index === 0
            const unit = step.completionUnit.toLowerCase()
            const timeframe = `${step.completionDuration} ${step.completionDuration === 1 ? unit.slice(0, -1) : unit}`

            return (
              <li
                key={step.id}
                className="relative grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] gap-3 pb-6 last:pb-0 @[28rem]/purchase-workflow:grid-cols-[2rem_minmax(0,1fr)]"
              >
                {index < orderedSteps.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0 left-3 top-7 w-px bg-border @[28rem]/purchase-workflow:left-4"
                  />
                ) : null}
                <div className="relative flex justify-center pt-0.5">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "relative flex size-6 shrink-0 items-center justify-center rounded-full border-2 bg-background text-[10px] font-semibold tabular-nums ring-4 ring-background @[28rem]/purchase-workflow:size-7",
                      isFirst ? "border-blue-600 text-blue-600" : "border-slate-300 text-slate-500",
                    )}
                  >
                    {index + 1}
                  </span>
                </div>
                <div className="flex min-w-0 flex-col gap-2.5">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <p className="text-xs text-muted-foreground">
                      Step {index + 1} of {orderedSteps.length}
                    </p>
                    <h4 className="break-words text-sm font-semibold leading-5">{step.title}</h4>
                  </div>
                  {step.instructions ? (
                    <p className="whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
                      {step.instructions}
                    </p>
                  ) : null}
                  <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                    <Clock3 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                    <span>{timeframe} from step entry</span>
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}
