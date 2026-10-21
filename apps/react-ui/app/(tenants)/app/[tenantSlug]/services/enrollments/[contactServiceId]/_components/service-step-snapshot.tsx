"use client"

import { useEffect, useId, useRef, useState, type FormEvent } from "react"
import { isAxiosError } from "axios"
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
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export type EnrolledServiceStep = {
  id: string
  assignedToUserId?: string | null
  assignedTo?: { id: string; name: string; email: string } | null
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
}: {
  steps: EnrolledServiceStep[]
  assignees?: Array<{ value: string; label: string }>
  movements?: StepMovement[]
  timezone?: string | null
  tenantId: string
  contactServiceId: string
  canComplete: boolean
  onRefresh: () => Promise<void>
}) {
  const [savingId, setSavingId] = useState<string | null>(null)
  const savingRef = useRef(false)
  const formId = useId()
  const current = currentServiceStep(steps)
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
  const openMovement = (kind: "MOVE" | "SKIP") => {
    if (!current || savingRef.current) return
    setMovement({
      requestId: crypto.randomUUID(),
      expectedOccurrenceId: current.entry.id,
      fromStepId: current.step.id,
      kind,
      targetStepId: "",
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
    savingRef.current = true
    setSavingId(`owner:${stepId}`)
    try {
      await api.patch(`/api/services/${tenantId}/contact-services/${contactServiceId}/service-steps/${stepId}/owner`, { assignedToUserId })
      await onRefresh()
      toast.success("Step owner updated")
    } catch {
      toast.error("Could not update the step owner. Refresh and try again.")
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
    try {
      await api.post(
        `/api/services/${tenantId}/contact-services/${contactServiceId}/step-occurrences/${id}/complete`,
      )
      await onRefresh()
      toast.success("Step completed")
    } catch {
      toast.error("Could not complete this step. Refresh and try again.")
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
  return (
    <Card className="mb-5">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Service steps</CardTitle>
          {canComplete && current ? (
            <Button
              variant="outline"
              size="sm"
              disabled={savingId !== null}
              onClick={() => openMovement("MOVE")}
            >
              Move to step
            </Button>
          ) : null}
        </div>
        <CardDescription>
          The steps and instructions saved for this enrollment. Later service configuration changes
          leave this work unchanged.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-4">
          {steps.map((step, index) => {
            const latest = step.occurrences.at(-1)
            const skippedMovement = movements.findLast((item) =>
              item.skippedStepIds.includes(step.id),
            )
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
                        : skippedMovement
                          ? "Skipped"
                          : "Not entered"}
                  </Badge>
                </div>
                <Field className="max-w-sm">
                  <FieldLabel htmlFor={`${formId}-owner-${step.id}`}>Step owner</FieldLabel>
                  {canComplete ? <Select value={step.assignedToUserId ?? "unassigned"} disabled={savingId !== null} onValueChange={value => void assignOwner(step.id, value === "unassigned" ? null : value)}>
                    <SelectTrigger id={`${formId}-owner-${step.id}`}><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {step.assignedToUserId && !assignees.some(user => user.value === step.assignedToUserId) ? <SelectItem value={step.assignedToUserId} disabled>{step.assignedTo?.name ?? "Inactive member"}</SelectItem> : null}
                      {assignees.map(user => <SelectItem key={user.value} value={user.value}>{user.label}</SelectItem>)}
                    </SelectContent>
                  </Select> : <p className="text-sm text-muted-foreground">{step.assignedTo?.name ?? "Unassigned"}</p>}
                  <FieldDescription>Retained when this step is revisited.</FieldDescription>
                </Field>
                {step.instructions ? (
                  <p className="whitespace-pre-wrap text-sm leading-6">{step.instructions}</p>
                ) : null}
                <p className="text-sm text-muted-foreground">
                  Default timeframe: {step.completionDuration}{" "}
                  {step.completionUnit.toLowerCase()} from entry
                </p>
                {latest ? (
                  <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                    <p>Entered {date(latest.enteredAt)}</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {skippedMovement
                      ? `Skipped during a move on ${date(skippedMovement.createdAt)}. ${skippedMovement.reason}`
                      : "The deadline starts when this step is entered."}
                  </p>
                )}
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
                    onSavingChange={(saving) =>
                      setSavingId(saving ? `deadline:${latest.id}` : null)
                    }
                    onRefresh={onRefresh}
                  />
                ) : null}
                {latest?.status === "ACTIVE" && canComplete ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={savingId !== null}
                      onClick={() => void complete(latest.id)}
                    >
                      {savingId === latest.id ? "Completing…" : "Complete step"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={savingId !== null}
                      onClick={() => openMovement("SKIP")}
                    >
                      Skip current step
                    </Button>
                  </div>
                ) : null}
                {latest?.resolvedAt ? (
                  <p className="text-sm text-muted-foreground">
                    {latest.status === "COMPLETED" ? "Completed" : "Resolved"}{" "}
                    {date(latest.resolvedAt)}
                    {latest.resolutionReason ? ` · ${latest.resolutionReason}` : ""}
                  </p>
                ) : null}
                {latest?.progressionStatus === "SUPERSEDED" ? (
                  <p className="text-sm text-muted-foreground">
                    Step work stopped after a manual move.
                    {latest.progressionMessage ? ` ${latest.progressionMessage}` : ""}
                  </p>
                ) : null}
                {latest?.progressionStatus === "WAITING_AUTOMATION" ? (
                  <Alert role="status">
                    <AlertTitle>Completion workflow in progress</AlertTitle>
                    <AlertDescription>
                      The step is complete. The next step will start after its completion actions
                      finish, including any scheduled waits.
                    </AlertDescription>
                  </Alert>
                ) : null}
                {latest?.progressionStatus === "WAITING_AUTOMATION" ? (
                  <ServiceStepCompletionWait
                    tenantId={tenantId}
                    contactServiceId={contactServiceId}
                    occurrenceId={latest.id}
                    timezone={timezone}
                    canManage={canComplete}
                    onRefresh={onRefresh}
                  />
                ) : null}
                {latest?.progressionStatus === "PAUSED" ? (
                  <Alert variant="destructive">
                    <AlertTitle>Progression paused</AlertTitle>
                    <AlertDescription>
                      {latest.progressionMessage ||
                        "The completion workflow stopped before finishing."}
                    </AlertDescription>
                  </Alert>
                ) : null}
                {latest?.progressionStatus === "FINISHED" ? (
                  <p className="text-sm text-muted-foreground">Service step work is finished.</p>
                ) : null}
                {step.occurrences.length > 1 ? (
                  <div className="flex flex-col gap-2 border-t pt-3">
                    <p className="text-sm font-medium">Entry history</p>
                    {step.occurrences.map((entry) => (
                      <div key={entry.id} className="flex flex-col gap-2">
                        <p className="text-sm text-muted-foreground">
                          Entry {entry.occurrenceNumber}: {date(entry.enteredAt)} ·{" "}
                          {entry.status.toLowerCase()}
                          {entry.resolutionReason ? ` · ${entry.resolutionReason}` : ""}
                          {entry.id !== latest?.id ? ` · Deadline ${date(entry.dueAt)}` : ""}
                        </p>
                        {entry.id !== latest?.id ? (
                          <ServiceStepDeadlineHistory
                            changes={entry.deadlineChanges}
                            timezone={timezone}
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ol>
        {movements.length ? (
          <section className="mt-5 flex flex-col gap-3 border-t pt-4" aria-label="Movement history">
            <h3 className="font-medium">Movement history</h3>
            {movements.map((item) => (
              <div key={item.id} className="flex flex-col gap-1 text-sm">
                <p className="font-medium">
                  {item.fromStepTitle} → {item.toStepTitle ?? "Service work finished"}
                </p>
                <p className="text-muted-foreground">
                  {date(item.createdAt)} · {item.actorName} ·{" "}
                  {item.kind === "SKIP" ? "Skipped" : "Moved"}
                </p>
                <p className="whitespace-pre-wrap">{item.reason}</p>
                {item.skippedStepIds.length ? (
                  <p className="text-muted-foreground">
                    Skipped:{" "}
                    {item.skippedStepIds
                      .map(
                        (stepId) => steps.find((step) => step.id === stepId)?.title ?? "Saved step",
                      )
                      .join(", ")}
                  </p>
                ) : null}
              </div>
            ))}
          </section>
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
                  disabled={savingId !== null}
                  onClick={() => setMovementOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
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
