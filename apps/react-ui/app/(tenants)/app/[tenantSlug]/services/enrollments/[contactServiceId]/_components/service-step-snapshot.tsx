"use client"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export type EnrolledServiceStep = {
  id: string
  sourceStepId: string
  title: string
  instructions: string | null
  completionDuration: number
  completionUnit: "MINUTES" | "HOURS" | "DAYS"
  sortOrder: number
  occurrences: Array<{
    id: string
    occurrenceNumber: number
    enteredAt: string
    dueAt: string
    status: "ACTIVE" | "COMPLETED" | "SKIPPED" | "CANCELED"
    resolvedAt: string | null
    resolutionReason: string | null
  }>
}

export function ServiceStepSnapshot({
  steps,
  timezone,
}: {
  steps: EnrolledServiceStep[]
  timezone?: string | null
}) {
  const date = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone || "UTC",
    }).format(new Date(value))
  return (
    <Card className="mb-5">
      <CardHeader>
        <CardTitle>Service steps</CardTitle>
        <CardDescription>
          The steps and instructions saved for this enrollment. Later service configuration changes
          leave this work unchanged.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-4">
          {steps.map((step, index) => {
            const latest = step.occurrences.at(-1)
            return (
              <li key={step.id} className="flex flex-col gap-3 rounded-xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-medium">
                    {index + 1}. {step.title}
                  </p>
                  <Badge variant={latest?.status === "ACTIVE" ? "default" : "secondary"}>
                    {latest?.status === "ACTIVE"
                      ? "Current step"
                      : latest
                        ? latest.status.toLowerCase()
                        : "Not entered"}
                  </Badge>
                </div>
                {step.instructions ? (
                  <p className="whitespace-pre-wrap text-sm leading-6">{step.instructions}</p>
                ) : null}
                <p className="text-sm text-muted-foreground">
                  Completion timeframe: {step.completionDuration}{" "}
                  {step.completionUnit.toLowerCase()} from entry
                </p>
                {latest ? (
                  <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                    <p>Entered {date(latest.enteredAt)}</p>
                    <p>Deadline {date(latest.dueAt)}</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    The deadline starts when this step is entered.
                  </p>
                )}
                {step.occurrences.length > 1 ? (
                  <div className="flex flex-col gap-2 border-t pt-3">
                    <p className="text-sm font-medium">Entry history</p>
                    {step.occurrences.map((entry) => (
                      <p key={entry.id} className="text-sm text-muted-foreground">
                        Entry {entry.occurrenceNumber}: {date(entry.enteredAt)} ·{" "}
                        {entry.status.toLowerCase()}
                        {entry.resolutionReason ? ` · ${entry.resolutionReason}` : ""}
                      </p>
                    ))}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}
