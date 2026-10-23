"use client"

import { useId, useRef, useState, type FormEvent, type RefObject } from "react"
import { isAxiosError } from "axios"
import { toast } from "sonner"
import { api } from "@/lib/api"
import {
  formatDateTimeForDisplay,
  formatUtcIsoToDateTimeDraft,
  type DateTimeDraft,
} from "@/lib/date-time"
import {
  fixedStepDeadline,
  latestStepDeadline,
  previewStepDeadline,
  type StepDeadlineChange,
  type StepDeadlineOccurrence,
  type StepDeadlineSchedule,
} from "@/lib/service-step-deadline"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DateTimeInput } from "@/components/ui/date-time-input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

export function ServiceStepDeadlineHistory({
  changes,
  timezone,
}: {
  changes: StepDeadlineChange[]
  timezone?: string | null
}) {
  if (!changes.length) return null
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="font-medium">Deadline history</p>
      {changes.map((change) => (
        <div key={change.id} className="flex flex-col gap-1 text-muted-foreground">
          <p>
            {formatDateTimeForDisplay(change.createdAt, timezone)} · {change.actorName} ·{" "}
            {change.schedule.mode === "DEFAULT"
              ? "Restored default"
              : change.schedule.mode === "DURATION"
                ? `${change.schedule.amount} ${change.schedule.unit.toLowerCase()} from entry`
                : "Date and time"}
          </p>
          <p>
            {formatDateTimeForDisplay(change.previousDueAt, timezone)} →{" "}
            {formatDateTimeForDisplay(change.dueAt, timezone)}
          </p>
        </div>
      ))}
    </div>
  )
}

export function ServiceStepDeadline({
  occurrence,
  stepTitle,
  defaultAmount,
  defaultUnit,
  timezone,
  tenantId,
  contactServiceId,
  canManage,
  disabled,
  mutationRef,
  onSavingChange,
  onRefresh,
}: {
  occurrence: StepDeadlineOccurrence
  stepTitle: string
  defaultAmount: number
  defaultUnit: "MINUTES" | "HOURS" | "DAYS"
  timezone?: string | null
  tenantId: string
  contactServiceId: string
  canManage: boolean
  disabled: boolean
  mutationRef: RefObject<boolean>
  onSavingChange: (saving: boolean) => void
  onRefresh: () => Promise<void>
}) {
  const id = useId()
  const zone = timezone || "UTC"
  const [saved, setSaved] = useState<StepDeadlineOccurrence | null>(null)
  const displayed = latestStepDeadline(occurrence, saved)
  const [target, setTarget] = useState<StepDeadlineOccurrence | null>(null)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<"DURATION" | "FIXED_DATE">("DURATION")
  const [amount, setAmount] = useState(String(defaultAmount))
  const [unit, setUnit] = useState(defaultUnit)
  const [dateTime, setDateTime] = useState<DateTimeDraft>({ date: "", time: "" })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const lastRequest = useRef<{ signature: string; requestId: string } | null>(null)
  const editable = canManage && displayed.status === "ACTIVE" && !displayed.supersededAt
  const schedule: StepDeadlineSchedule | null = target
    ? mode === "DURATION"
      ? { mode, amount: Number(amount), unit }
      : fixedStepDeadline(dateTime, target, zone)
    : null
  const preview = target && schedule ? previewStepDeadline(target, schedule) : null

  const change = async (snapshot: StepDeadlineOccurrence, nextSchedule: StepDeadlineSchedule) => {
    if (mutationRef.current) return
    const signature = JSON.stringify({
      occurrenceId: snapshot.id,
      revision: snapshot.deadlineRevision,
      schedule: nextSchedule,
    })
    if (lastRequest.current?.signature !== signature)
      lastRequest.current = { signature, requestId: crypto.randomUUID() }
    mutationRef.current = true
    setSaving(true)
    onSavingChange(true)
    setError(null)
    try {
      const { data } = await api.post<{ occurrence: StepDeadlineOccurrence }>(
        `/api/services/${tenantId}/contact-services/${contactServiceId}/step-occurrences/${snapshot.id}/deadline`,
        {
          requestId: lastRequest.current.requestId,
          expectedDeadlineRevision: snapshot.deadlineRevision,
          schedule: nextSchedule,
        },
      )
      setSaved(data.occurrence)
      setOpen(false)
      toast.success(
        nextSchedule.mode === "DEFAULT" ? "Default deadline restored" : "Step deadline updated",
      )
      try {
        await onRefresh()
      } catch {
        toast.error("The deadline was saved. Refresh to reload the enrollment.")
      }
    } catch (failure) {
      const conflict = isAxiosError(failure) && [404, 409].includes(failure.response?.status ?? 0)
      const message = conflict
        ? open
          ? "This step or its deadline has changed. Close this dialog and review the current step before trying again."
          : "This step or its deadline has changed. Refresh and review the current step before trying again."
        : "Could not save the deadline. Your changes are still available."
      setError(message)
      toast.error(message)
      if (conflict) {
        try {
          await onRefresh()
        } catch {
          /* Keep the displayed edit intact. */
        }
      }
    } finally {
      mutationRef.current = false
      setSaving(false)
      onSavingChange(false)
    }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!target || !schedule || !preview) {
      setError(
        "Choose a positive whole-number duration, or a valid date after step entry, within ten years of entry.",
      )
      return
    }
    void change(target, schedule)
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <p>
          Deadline {formatDateTimeForDisplay(displayed.dueAt, zone)} ({zone})
        </p>
        {displayed.deadlineOverride ? <Badge variant="outline">Custom deadline</Badge> : null}
      </div>
      {displayed.deadlineOverride?.mode === "DURATION" ? (
        <p className="text-sm text-muted-foreground">
          Custom timeframe: {displayed.deadlineOverride.amount}{" "}
          {displayed.deadlineOverride.unit.toLowerCase()} from entry
        </p>
      ) : null}
      {displayed.deadlineOverride ? (
        <p className="text-sm text-muted-foreground">
          Service default: {formatDateTimeForDisplay(displayed.defaultDueAt, zone)}
        </p>
      ) : null}
      {editable ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm" className="rounded-full text-xs font-semibold"
            disabled={disabled || saving}
            onClick={() => {
              if (mutationRef.current) return
              setTarget(structuredClone(displayed))
              setMode(displayed.deadlineOverride?.mode === "FIXED_DATE" ? "FIXED_DATE" : "DURATION")
              setAmount(
                String(
                  displayed.deadlineOverride?.mode === "DURATION"
                    ? displayed.deadlineOverride.amount
                    : defaultAmount,
                ),
              )
              setUnit(
                displayed.deadlineOverride?.mode === "DURATION"
                  ? displayed.deadlineOverride.unit
                  : defaultUnit,
              )
              setDateTime(formatUtcIsoToDateTimeDraft(displayed.dueAt, zone))
              setError(null)
              setOpen(true)
            }}
          >
            Change deadline
          </Button>
          {displayed.deadlineOverride ? (
            <Button
              variant="outline"
              size="sm" className="rounded-full text-xs font-semibold"
              disabled={disabled || saving}
              onClick={() => void change(structuredClone(displayed), { mode: "DEFAULT" })}
            >
              {saving && !open ? "Restoring…" : "Restore default"}
            </Button>
          ) : null}
        </div>
      ) : null}
      <ServiceStepDeadlineHistory changes={displayed.deadlineChanges} timezone={zone} />
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!mutationRef.current) setOpen(nextOpen)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change step deadline</DialogTitle>
            <DialogDescription>
              {stepTitle}. This deadline applies only to this entry. Times are shown in {zone}.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="flex flex-col gap-5">
            <FieldGroup>
              <Field>
                <FieldLabel>Schedule by</FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={mode}
                  disabled={saving}
                  aria-label="Schedule deadline by"
                  onValueChange={(value) => {
                    if (value) {
                      setMode(value as typeof mode)
                      setError(null)
                    }
                  }}
                >
                  <ToggleGroupItem value="DURATION">Duration</ToggleGroupItem>
                  <ToggleGroupItem value="FIXED_DATE">Date and time</ToggleGroupItem>
                </ToggleGroup>
              </Field>
              {mode === "DURATION" ? (
                <FieldGroup className="grid grid-cols-2 gap-3">
                  <Field data-invalid={Boolean(error)}>
                    <FieldLabel htmlFor={`${id}-amount`}>Timeframe</FieldLabel>
                    <Input
                      id={`${id}-amount`}
                      type="number"
                      min="1"
                      step="1"
                      value={amount}
                      disabled={saving}
                      aria-invalid={Boolean(error)}
                      onChange={(event) => setAmount(event.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${id}-unit`}>Unit</FieldLabel>
                    <Select
                      value={unit}
                      disabled={saving}
                      onValueChange={(value) => setUnit(value as typeof unit)}
                    >
                      <SelectTrigger id={`${id}-unit`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="MINUTES">Minutes</SelectItem>
                          <SelectItem value="HOURS">Hours</SelectItem>
                          <SelectItem value="DAYS">Days</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                </FieldGroup>
              ) : (
                <Field data-invalid={Boolean(error)}>
                  <FieldLabel htmlFor={`${id}-date`}>Deadline date and time</FieldLabel>
                  <FieldLabel className="sr-only" htmlFor={`${id}-time`}>
                    Deadline time
                  </FieldLabel>
                  <DateTimeInput
                    id={`${id}-date`}
                    timeId={`${id}-time`}
                    value={dateTime}
                    onValueChange={setDateTime}
                    timezone={zone}
                    disabled={saving}
                    ariaInvalid={Boolean(error)}
                  />
                </Field>
              )}
              <FieldDescription>
                Counted from step entry:{" "}
                {target ? formatDateTimeForDisplay(target.enteredAt, zone) : ""}. The timeframe can
                be up to ten years.
              </FieldDescription>
              {preview ? (
                <p className="text-sm" role="status">
                  New deadline: {formatDateTimeForDisplay(preview, zone)} ({zone})
                </p>
              ) : null}
              {error ? <FieldError>{error}</FieldError> : null}
            </FieldGroup>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full text-xs font-semibold"
                disabled={saving}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" className="rounded-full text-xs font-semibold" disabled={saving || !preview}>
                {saving ? "Saving…" : "Save deadline"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
