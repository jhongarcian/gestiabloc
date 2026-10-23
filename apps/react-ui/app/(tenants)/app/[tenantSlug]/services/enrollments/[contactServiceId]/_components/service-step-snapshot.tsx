"use client"

import { useEffect, useId, useRef, useState, type FormEvent } from "react"
import { isAxiosError } from "axios"
import Link from "next/link"
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  Circle,
  ClipboardList,
  Clock3,
  Ellipsis,
  Loader2,
  X,
} from "lucide-react"
import { AssigneeInput, UNASSIGNED_ASSIGNEE_VALUE, type AssigneeOption } from "@/components/assignee-input"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { enrolledServiceStepLabel, enrolledServiceStepProgress } from "@/lib/service-hierarchy"
import { cn } from "@/lib/utils"
import {
  ServiceStepStatusSelect,
  SERVICE_STEP_STATUSES,
  type ServiceStepStatus,
} from "./service-step-status-select"
import {
  currentServiceStep,
  skippedByStepMove,
  type StepMovement,
} from "@/lib/service-step-movement"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ServiceStepDeadline, ServiceStepDeadlineHistory } from "./service-step-deadline"
import type { StepDeadlineSchedule, StepDeadlineChange } from "@/lib/service-step-deadline"
import { ServiceStepCompletionWait } from "./service-step-completion-wait"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export type EnrolledServiceStep = {
  id: string
  assignedToUserId?: string | null
  assignedTo?: { id: string; name: string; email: string; image?: string | null } | null
  sourceStepId: string
  title: string
  instructions: string | null
  completionDuration: number
  completionUnit: "MINUTES" | "HOURS" | "DAYS"
  sortOrder: number
  occurrences: Array<{
    id: string
    supersededAt?: string | null
    createdAt?: string
    occurrenceNumber: number
    enteredAt: string
    dueAt: string
    defaultDueAt: string
    deadlineOverride: Exclude<StepDeadlineSchedule, { mode: "DEFAULT" }> | null
    deadlineRevision: number
    deadlineChanges: StepDeadlineChange[]
    status: "ACTIVE" | "COMPLETED" | "SKIPPED" | "CANCELED"
    resolvedAt: string | null
    resolutionReason: string | null
    progressionStatus:
      | "NONE"
      | "WAITING_AUTOMATION"
      | "PAUSED"
      | "SUPERSEDED"
      | "ADVANCED"
      | "FINISHED"
    progressionMessage: string | null
  }>
}

export function ServiceStepSnapshot({
  steps,
  movements = [],
  assignees = [],
  timezone,
  tenantId,
  contactServiceId,
  canComplete,
  onRefresh,
  serviceName,
  startedAt,
  detailsHref,
  className,
}: {
  steps: EnrolledServiceStep[]
  assignees?: AssigneeOption[]
  movements?: StepMovement[]
  timezone?: string | null
  tenantId: string
  contactServiceId: string
  canComplete: boolean
  onRefresh: () => Promise<void>
  serviceName: string
  startedAt?: string | null
  detailsHref?: string
  className?: string
}) {
  const [savingId, setSavingId] = useState<string | null>(null)
  const savingRef = useRef(false)
  const formId = useId()
  const current = currentServiceStep(steps)
  const progress = enrolledServiceStepProgress(steps, movements)
  const stepStatuses = steps.map((step) => {
    const label = enrolledServiceStepLabel(step, movements)
    return (Object.keys(SERVICE_STEP_STATUSES) as ServiceStepStatus[]).find(
      (status) => SERVICE_STEP_STATUSES[status].label === label,
    ) ?? "UPCOMING"
  })
  const [fieldError, setFieldError] = useState<{
    stepId: string
    field: "owner" | "status"
    message: string
  } | null>(null)
  const [movement, setMovement] = useState<{
    requestId: string
    expectedOccurrenceId: string
    fromStepId: string
    kind: "MOVE" | "SKIP"
    targetStepId: string
    reason: string
  } | null>(null)
  const [movementOpen, setMovementOpen] = useState(false)
  const [movementError, setMovementError] = useState<string | null>(null)
  const openMovement = (kind: "MOVE" | "SKIP", targetStepId = "") => {
    if (!current || savingRef.current) return
    setMovement({
      requestId: crypto.randomUUID(),
      expectedOccurrenceId: current.entry.id,
      fromStepId: current.step.id,
      kind,
      targetStepId,
      reason: "",
    })
    setMovementOpen(true)
    setMovementError(null)
  }
  const move = async (event: FormEvent) => {
    event.preventDefault()
    if (!movement || savingRef.current) return
    if (!movement.reason.trim() || (movement.kind === "MOVE" && !movement.targetStepId)) {
      setMovementError("Choose a destination and enter a reason.")
      return
    }
    savingRef.current = true
    setSavingId("movement")
    setMovementError(null)
    try {
      await api.post(
        `/api/services/${tenantId}/contact-services/${contactServiceId}/step-movements`,
        {
          requestId: movement.requestId,
          expectedOccurrenceId: movement.expectedOccurrenceId,
          kind: movement.kind,
          reason: movement.reason.trim(),
          ...(movement.kind === "MOVE" ? { targetStepId: movement.targetStepId } : {}),
        },
      )
      setMovementOpen(false)
      toast.success(movement.kind === "SKIP" ? "Step skipped" : "Moved to step")
      try {
        await onRefresh()
      } catch {
        toast.error("The move was saved. Refresh to see the current step.")
      }
    } catch (error) {
      const conflict = isAxiosError(error) && error.response?.status === 409
      const message = conflict
        ? "The current step has changed. Close this dialog and review the latest step before trying again."
        : "Could not move this step. Your reason is still available."
      setMovementError(message)
      toast.error(message)
      if (conflict) {
        try {
          await onRefresh()
        } catch {
          /* Keep the saved request available. */
        }
      }
    } finally {
      savingRef.current = false
      setSavingId(null)
    }
  }
  const assignOwner = async (stepId: string, assignedToUserId: string | null) => {
    if (savingRef.current) return
    if ((steps.find((step) => step.id === stepId)?.assignedToUserId ?? null) === assignedToUserId) return
    savingRef.current = true
    setSavingId(`owner:${stepId}`)
    setFieldError(null)
    try {
      await api.patch(`/api/services/${tenantId}/contact-services/${contactServiceId}/service-steps/${stepId}/owner`, { assignedToUserId })
      await onRefresh()
      toast.success("Step owner updated")
    } catch {
      const message = "Could not update the step owner. Refresh and try again."
      setFieldError({ stepId, field: "owner", message })
      toast.error(message)
    } finally {
      savingRef.current = false
      setSavingId(null)
    }
  }
  const fromIndex = steps.findIndex((step) => step.id === movement?.fromStepId)
  const skipDestination = steps[fromIndex + 1]
  const skipped =
    movement?.kind === "MOVE"
      ? skippedByStepMove(
          steps,
          movement.fromStepId,
          movement.targetStepId,
          current?.entry.status === "ACTIVE",
        )
      : []
  const waiting = steps.some((step) =>
    step.occurrences.some((entry) => entry.progressionStatus === "WAITING_AUTOMATION"),
  )
  const refreshRef = useRef(onRefresh)
  useEffect(() => {
    refreshRef.current = onRefresh
  }, [onRefresh])
  useEffect(() => {
    if (!waiting) return
    let refreshing = false
    const timer = setInterval(async () => {
      if (refreshing || document.visibilityState !== "visible") return
      refreshing = true
      try {
        await refreshRef.current()
      } finally {
        refreshing = false
      }
    }, 5000)
    return () => clearInterval(timer)
  }, [waiting])
  const complete = async (id: string) => {
    if (savingRef.current) return
    savingRef.current = true
    setSavingId(id)
    setFieldError(null)
    try {
      await api.post(
        `/api/services/${tenantId}/contact-services/${contactServiceId}/step-occurrences/${id}/complete`,
      )
      await onRefresh()
      toast.success("Step completed")
    } catch {
      const message = "Could not complete this step. Refresh and try again."
      const stepId = steps.find((step) => step.occurrences.some((entry) => entry.id === id))?.id
      if (stepId) setFieldError({ stepId, field: "status", message })
      toast.error(message)
    } finally {
      savingRef.current = false
      setSavingId(null)
    }
  }
  const date = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone || "UTC",
    }).format(new Date(value))
  const summaryCounts = [
    { label: "Completed", count: stepStatuses.filter((status) => status === "COMPLETED").length, className: "text-emerald-700", icon: Check },
    { label: "In progress", count: stepStatuses.filter((status) => ["ACTIVE", "WAITING_AUTOMATION", "PAUSED"].includes(status)).length, className: "text-blue-700", icon: Circle },
    { label: "Pending", count: stepStatuses.filter((status) => status === "UPCOMING").length, className: "text-slate-500", icon: Circle },
    { label: "Skipped", count: stepStatuses.filter((status) => status === "SKIPPED").length, className: "text-slate-500", icon: ArrowRight },
    { label: "Canceled", count: stepStatuses.filter((status) => status === "CANCELED").length, className: "text-rose-700", icon: X },
  ].filter((item, index) => index < 3 || item.count > 0)

  return (
    <Card className={cn("@container/workflow min-w-0 gap-5 rounded-[26px] py-5", className)}>
      <CardHeader className="px-4 @[36rem]/workflow:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="hidden size-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 @[28rem]/workflow:inline-flex" aria-hidden="true">
              <ClipboardList className="size-6" />
            </span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <p className="text-xs font-medium text-blue-700">Workflow timeline</p>
              <CardTitle className="text-lg leading-tight @[48rem]/workflow:text-2xl">
                <h2>Workflow progression</h2>
              </CardTitle>
              <CardDescription>Track and manage each enrolled step in this workflow.</CardDescription>
            </div>
          </div>
          {detailsHref ? (
            <Button asChild variant="outline" size="icon-sm" className="rounded-full">
              <Link href={detailsHref} aria-label="View workflow details">
                <ArrowRight />
              </Link>
            </Button>
          ) : canComplete && current ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon-sm" className="rounded-full" disabled={savingId !== null} aria-label="Workflow actions">
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={() => openMovement("MOVE")}>Move to step</DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-5 px-3 @[36rem]/workflow:px-5">
        <div className="grid min-w-0 gap-4 @[64rem]/workflow:grid-cols-[15rem_minmax(0,1fr)] @[64rem]/workflow:items-start">
          <section aria-label="Workflow summary" className="flex min-w-0 flex-col gap-4 rounded-2xl border bg-muted/25 p-4 @[64rem]/workflow:sticky @[64rem]/workflow:top-4 @[64rem]/workflow:p-5">
            <div className="flex min-w-0 flex-col gap-1">
              <h3 className="break-words text-base font-semibold leading-snug @[64rem]/workflow:text-lg">{serviceName}</h3>
              <p className="text-xs text-muted-foreground">{steps.length} total {steps.length === 1 ? "step" : "steps"}</p>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <Progress
                  value={progress.percentage}
                  aria-label="Service workflow progress"
                  aria-valuenow={progress.percentage}
                  aria-valuetext={`${progress.completed} of ${progress.total} steps resolved`}
                  className="h-2.5 bg-emerald-100 [&_[data-slot=progress-indicator]]:bg-emerald-600 motion-reduce:[&_[data-slot=progress-indicator]]:transition-none"
                />
                <span className="text-xs font-semibold tabular-nums">{progress.percentage}%</span>
              </div>
              <p className="text-xs text-muted-foreground">{progress.completed} of {progress.total} steps resolved</p>
            </div>
            <Separator />
            <dl className="grid grid-cols-3 gap-x-3 gap-y-4 @[64rem]/workflow:grid-cols-1">
              {summaryCounts.map(({ label, count, className: color, icon: Icon }) => (
                <div key={label} className="flex flex-col gap-1.5 @[64rem]/workflow:flex-row @[64rem]/workflow:items-center @[64rem]/workflow:gap-2.5">
                  <dt className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground @[28rem]/workflow:text-xs @[64rem]/workflow:text-sm">
                    <Icon aria-hidden="true" className={cn("hidden size-3.5 shrink-0 @[28rem]/workflow:block", color)} />
                    {label}
                  </dt>
                  <dd className="text-sm font-semibold tabular-nums @[28rem]/workflow:pl-5 @[64rem]/workflow:ml-auto @[64rem]/workflow:pl-0">{count}</dd>
                </div>
              ))}
            </dl>
            {startedAt ? (
              <div className="hidden flex-col gap-4 @[64rem]/workflow:flex">
                <Separator />
                <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                  <CalendarDays className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>Started<br />{date(startedAt)}</span>
                </p>
              </div>
            ) : null}
          </section>
          <section aria-label="Workflow steps" className="flex min-w-0 flex-col gap-4 @[36rem]/workflow:rounded-2xl @[36rem]/workflow:border @[36rem]/workflow:p-4 @[64rem]/workflow:p-5">
            <div className="flex flex-col gap-1 px-1">
              <h3 className="font-semibold">Workflow steps</h3>
              <p className="text-xs leading-5 text-muted-foreground">Every enrolled step, shown in its configured order.</p>
            </div>
            {steps.length ? (
              <ol aria-label="Saved service steps" className="flex min-w-0 flex-col">
                {steps.map((step, index) => {
                  const latest = step.occurrences.at(-1)
                  const status = stepStatuses[index]
                  const active = status === "ACTIVE"
                  const done = status === "COMPLETED"
                  const skippedMovement = status === "SKIPPED"
                    ? movements.findLast((item) => item.skippedStepIds.includes(step.id))
                    : undefined
                  const options: ServiceStepStatus[] = [status]
                  if (canComplete && current) {
                    if (active && current.entry.id === latest?.id) options.push("COMPLETED", "SKIPPED")
                    else options.push("ACTIVE")
                  }
                  const ownerOptions = step.assignedToUserId && !assignees.some((user) => user.value === step.assignedToUserId)
                    ? [...assignees, { value: step.assignedToUserId, label: step.assignedTo?.name || "Inactive member", email: step.assignedTo?.email, image: step.assignedTo?.image }]
                    : assignees
                  const ownerError = fieldError?.stepId === step.id && fieldError.field === "owner" ? fieldError.message : null
                  const statusError = fieldError?.stepId === step.id && fieldError.field === "status" ? fieldError.message : null
                  const displayDate = skippedMovement?.createdAt ?? latest?.resolvedAt ?? latest?.dueAt
                  return (
                    <li key={step.id} aria-current={active ? "step" : undefined} className="relative grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] gap-2 pb-4 last:pb-0 @[36rem]/workflow:grid-cols-[2rem_minmax(0,1fr)] @[36rem]/workflow:gap-3">
                      {index < steps.length - 1 ? <span aria-hidden="true" className="absolute bottom-0 left-3 top-7 w-px bg-border @[36rem]/workflow:left-4" /> : null}
                      <div className="relative flex justify-center pt-5">
                        <span aria-hidden="true" className={cn(
                          "relative flex size-6 shrink-0 items-center justify-center rounded-full border-2 bg-background ring-4 ring-card @[36rem]/workflow:size-7",
                          done ? "border-emerald-600 bg-emerald-600 text-white" : active ? "border-blue-600 text-blue-600" : status === "PAUSED" ? "border-rose-400 text-rose-700" : "border-slate-300 text-slate-400",
                        )}>
                          {done ? <Check className="size-4" /> : active ? <span className="size-3 rounded-full bg-blue-600" /> : status === "SKIPPED" ? <ArrowRight className="size-3.5" /> : status === "CANCELED" ? <X className="size-3.5" /> : <span className="size-2 rounded-full bg-current" />}
                        </span>
                      </div>
                      <div className={cn(
                        "flex min-w-0 flex-col gap-3 rounded-xl border p-3 @[36rem]/workflow:p-4",
                        done ? "border-emerald-200 bg-emerald-50/40" : active ? "border-blue-200 bg-blue-50/70" : "border-border bg-card",
                      )}>
                        <Collapsible className="group/step flex min-w-0 flex-col gap-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 flex-col gap-1.5">
                              <p className="text-xs text-muted-foreground">Step {index + 1} of {steps.length}</p>
                              <h4 className="break-words text-sm font-semibold leading-5 @[48rem]/workflow:text-base">{step.title}</h4>
                            </div>
                            <CollapsibleTrigger asChild>
                              <Button variant="ghost" size="sm" className="size-8 shrink-0 rounded-full p-0 text-xs font-semibold has-[>svg]:px-0 @[28rem]/workflow:w-auto @[28rem]/workflow:px-3 @[28rem]/workflow:has-[>svg]:px-3" aria-label={`Details for ${step.title}`}>
                                <span className="hidden @[28rem]/workflow:inline">Details</span>
                                <ChevronDown data-icon="inline-end" className="transition-transform group-data-[state=open]/step:rotate-180" />
                              </Button>
                            </CollapsibleTrigger>
                          </div>
                          {step.instructions ? <p className="whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground @[48rem]/workflow:text-sm">{step.instructions}</p> : null}
                          <FieldGroup className="flex-row flex-wrap items-start gap-3">
                            <Field data-disabled={!canComplete || savingId !== null} data-invalid={Boolean(ownerError)} className="w-fit min-w-0 max-w-full gap-1.5">
                              <FieldLabel htmlFor={`${formId}-owner-${step.id}`} className="text-xs text-muted-foreground">Owner</FieldLabel>
                              <div className="flex min-w-0 items-center gap-2" aria-busy={savingId === `owner:${step.id}`}>
                                <AssigneeInput
                                  size="compact"
                                  id={`${formId}-owner-${step.id}`}
                                  value={step.assignedToUserId ?? UNASSIGNED_ASSIGNEE_VALUE}
                                  options={ownerOptions}
                                  disabled={!canComplete || savingId !== null}
                                  ariaInvalid={Boolean(ownerError)}
                                  onValueChange={(value) => void assignOwner(step.id, value === UNASSIGNED_ASSIGNEE_VALUE ? null : value)}
                                />
                                {savingId === `owner:${step.id}` ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-label="Saving owner" /> : null}
                              </div>
                              {ownerError ? <FieldError>{ownerError}</FieldError> : null}
                            </Field>
                            <Field data-disabled={savingId !== null || options.length < 2} data-invalid={Boolean(statusError)} className="w-fit min-w-0 max-w-full gap-1.5">
                              <FieldLabel htmlFor={`${formId}-status-${step.id}`} className="text-xs text-muted-foreground">Status</FieldLabel>
                              <div className="flex min-w-0 items-center gap-2">
                                <ServiceStepStatusSelect
                                  id={`${formId}-status-${step.id}`}
                                  value={status}
                                  options={options}
                                  disabled={savingId !== null || options.length < 2}
                                  busy={savingId === latest?.id}
                                  ariaInvalid={Boolean(statusError)}
                                  onValueChange={(value) => {
                                    setFieldError(null)
                                    if (value === status) return
                                    if (value === "COMPLETED" && latest) void complete(latest.id)
                                    else if (value === "SKIPPED") openMovement("SKIP")
                                    else if (value === "ACTIVE") openMovement("MOVE", step.id)
                                  }}
                                />
                                {savingId === latest?.id ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-label="Saving status" /> : null}
                              </div>
                              {statusError ? <FieldError>{statusError}</FieldError> : null}
                            </Field>
                          </FieldGroup>
                          <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                            {displayDate ? <CalendarDays aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /> : <Clock3 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />}
                            {displayDate ? `${skippedMovement ? "Skipped" : latest?.resolvedAt ? done ? "Completed" : "Resolved" : "Due"} ${date(displayDate)}` : "Deadline starts when this step is entered."}
                          </p>
                          <CollapsibleContent className="flex flex-col gap-3 border-t pt-3 text-sm">
                            <p className="text-muted-foreground">Default timeframe: {step.completionDuration} {step.completionUnit.toLowerCase()} from entry</p>
                            {latest ? <p className="text-muted-foreground">Entered {date(latest.enteredAt)}</p> : null}
                            {skippedMovement ? <p className="whitespace-pre-wrap text-muted-foreground">Skipped during a move: {skippedMovement.reason}</p> : null}
                            {latest ? (
                              <ServiceStepDeadline
                                occurrence={latest}
                                stepTitle={step.title}
                                defaultAmount={step.completionDuration}
                                defaultUnit={step.completionUnit}
                                timezone={timezone}
                                tenantId={tenantId}
                                contactServiceId={contactServiceId}
                                canManage={canComplete}
                                disabled={savingId !== null}
                                mutationRef={savingRef}
                                onSavingChange={(saving) => setSavingId(saving ? `deadline:${latest.id}` : null)}
                                onRefresh={onRefresh}
                              />
                            ) : null}
                            {latest?.resolutionReason ? <p className="whitespace-pre-wrap text-muted-foreground">{latest.resolutionReason}</p> : null}
                            {latest?.progressionStatus === "SUPERSEDED" ? <p className="text-muted-foreground">Step work stopped after a manual move. {latest.progressionMessage}</p> : null}
                            {step.occurrences.length > 1 ? (
                              <section aria-label={`Entry history for ${step.title}`} className="flex flex-col gap-3 border-t pt-3">
                                <h5 className="font-medium">Entry history</h5>
                                {step.occurrences.map((entry) => (
                                  <div key={entry.id} className="flex flex-col gap-2">
                                    <p className="text-muted-foreground">Entry {entry.occurrenceNumber}: {date(entry.enteredAt)} · {entry.status.toLowerCase()}{entry.resolutionReason ? ` · ${entry.resolutionReason}` : ""}{entry.id !== latest?.id ? ` · Deadline ${date(entry.dueAt)}` : ""}</p>
                                    {entry.id !== latest?.id ? <ServiceStepDeadlineHistory changes={entry.deadlineChanges} timezone={timezone} /> : null}
                                  </div>
                                ))}
                              </section>
                            ) : null}
                          </CollapsibleContent>
                        </Collapsible>
                        {status === "WAITING_AUTOMATION" ? (
                          <>
                            <Alert role="status">
                              <AlertTitle>Completion workflow in progress</AlertTitle>
                              <AlertDescription>The next step starts after completion actions finish, including scheduled waits.</AlertDescription>
                            </Alert>
                            <ServiceStepCompletionWait tenantId={tenantId} contactServiceId={contactServiceId} occurrenceId={latest!.id} timezone={timezone} canManage={canComplete} onRefresh={onRefresh} />
                          </>
                        ) : null}
                        {status === "PAUSED" ? <Alert variant="destructive"><AlertTitle>Progression paused</AlertTitle><AlertDescription>{latest?.progressionMessage || "The completion workflow stopped before finishing."}</AlertDescription></Alert> : null}
                      </div>
                    </li>
                  )
                })}
              </ol>
            ) : (
              <Empty><EmptyHeader><EmptyTitle>No workflow steps</EmptyTitle><EmptyDescription>This enrollment has no saved service steps.</EmptyDescription></EmptyHeader></Empty>
            )}
          </section>
        </div>
        {movements.length ? (
          <Collapsible className="group/history flex flex-col gap-3 border-t pt-4">
            <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="w-fit rounded-full text-xs font-semibold">Movement history<ChevronDown data-icon="inline-end" className="transition-transform group-data-[state=open]/history:rotate-180" /></Button></CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-4 px-3">
              {movements.map((item) => (
                <div key={item.id} className="flex flex-col gap-1 text-sm">
                  <p className="font-medium">{item.fromStepTitle} → {item.toStepTitle ?? "Service work finished"}</p>
                  <p className="text-muted-foreground">{date(item.createdAt)} · {item.actorName} · {item.kind === "SKIP" ? "Skipped" : "Moved"}</p>
                  <p className="whitespace-pre-wrap">{item.reason}</p>
                  {item.skippedStepIds.length ? <p className="text-muted-foreground">Skipped: {item.skippedStepIds.map((stepId) => steps.find((step) => step.id === stepId)?.title ?? "Saved step").join(", ")}</p> : null}
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        ) : null}
        <Dialog
          open={movementOpen}
          onOpenChange={(open) => {
            if (!open && !savingRef.current) setMovementOpen(false)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {movement?.kind === "SKIP" ? "Skip current step" : "Move to step"}
              </DialogTitle>
              <DialogDescription>
                Choose where this enrollment continues and record why. Unfinished automations from
                earlier step entries will stop.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={move} className="flex flex-col gap-5">
              <FieldGroup>
                {movement?.kind === "MOVE" ? (
                  <Field>
                    <FieldLabel htmlFor={`${formId}-destination`}>Destination step</FieldLabel>
                    <Select
                      value={movement.targetStepId}
                      disabled={savingId !== null}
                      onValueChange={(targetStepId) =>
                        setMovement((previous) =>
                          previous
                            ? { ...previous, targetStepId, requestId: crypto.randomUUID() }
                            : null,
                        )
                      }
                    >
                      <SelectTrigger id={`${formId}-destination`}>
                        <SelectValue placeholder="Select a step" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {steps
                            .filter(
                              (step) =>
                                step.id !== movement.fromStepId ||
                                current?.entry.status !== "ACTIVE",
                            )
                            .map((step) => (
                              <SelectItem key={step.id} value={step.id}>
                                {step.title}
                                {step.occurrences.length ? " · Revisit" : ""}
                              </SelectItem>
                            ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      {skipped.length
                        ? `Skipped: ${skipped.map((step) => step.title).join(", ")}. `
                        : ""}
                      The destination starts a new entry and runs its entry automations.
                    </FieldDescription>
                  </Field>
                ) : (
                  <p className="text-sm">
                    {skipDestination
                      ? `Next step: ${skipDestination.title}. Its entry automations will run.`
                      : "This finishes the service work. Any unpaid balance remains due."}
                  </p>
                )}
                <Field data-invalid={Boolean(movementError)}>
                  <FieldLabel htmlFor={`${formId}-reason`}>Reason</FieldLabel>
                  <Textarea
                    id={`${formId}-reason`}
                    required
                    maxLength={1000}
                    value={movement?.reason ?? ""}
                    disabled={savingId !== null}
                    aria-invalid={Boolean(movementError)}
                    placeholder="Why is this enrollment moving?"
                    onChange={(event) =>
                      setMovement((previous) =>
                        previous
                          ? {
                              ...previous,
                              reason: event.target.value,
                              requestId: crypto.randomUUID(),
                            }
                          : null,
                      )
                    }
                  />
                  {movementError ? <FieldError>{movementError}</FieldError> : null}
                </Field>
              </FieldGroup>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full text-xs font-semibold"
                  disabled={savingId !== null}
                  onClick={() => setMovementOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  className="rounded-full text-xs font-semibold"
                  disabled={
                    savingId !== null ||
                    !movement?.reason.trim() ||
                    (movement.kind === "MOVE" && !movement.targetStepId)
                  }
                >
                  {savingId === "movement"
                    ? "Saving…"
                    : movement?.kind === "SKIP"
                      ? "Skip step"
                      : "Move step"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
