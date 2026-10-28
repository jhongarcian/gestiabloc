"use client"

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react"
import { isAxiosError } from "axios"
import { toast } from "sonner"
import { api } from "@/lib/api"
import {
  formatDateTimeForDisplay,
  formatUtcIsoToDateTimeDraft,
  type DateTimeDraft,
} from "@/lib/date-time"
import {
  fixedWaitSchedule,
  waitChangeTarget,
  type CompletionWait,
  type WaitSchedule,
} from "@/lib/service-step-wait"
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

export function ServiceStepCompletionWait({
  tenantId,
  contactServiceId,
  occurrenceId,
  timezone,
  canManage,
  onRefresh,
}: {
  tenantId: string
  contactServiceId: string
  occurrenceId: string
  timezone?: string | null
  canManage: boolean
  onRefresh: () => Promise<void>
}) {
  const waitTimezone = timezone || "UTC"
  const [waits, setWaits] = useState<CompletionWait[]>([])
  const [loadError, setLoadError] = useState(false)
  const [editingWait, setEditingWait] = useState<CompletionWait | null>(null)
  const [mode, setMode] = useState<WaitSchedule["mode"]>("DURATION")
  const [amount, setAmount] = useState("1")
  const [unit, setUnit] = useState<"SECONDS" | "MINUTES" | "HOURS" | "DAYS">("DAYS")
  const [dateTime, setDateTime] = useState<DateTimeDraft>({ date: "", time: "" })
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState<"CONTINUE" | "RESCHEDULE" | null>(null)
  const [continuingWaitId, setContinuingWaitId] = useState<string | null>(null)
  const savingRef = useRef(false)
  const requestRef = useRef(0)
  const id = useId()
  const endpoint = `/api/services/${tenantId}/contact-services/${contactServiceId}/step-occurrences/${occurrenceId}/completion-wait`
  const loadWait = useCallback(async () => {
    const requestId = ++requestRef.current
    try {
      const { data } = await api.get<{ waits: CompletionWait[] }>(endpoint)
      if (requestId !== requestRef.current) return
      setWaits(data.waits)
      setLoadError(false)
    } catch {
      if (requestId === requestRef.current) setLoadError(true)
    }
  }, [endpoint])
  useEffect(() => {
    let loading = false
    const refresh = async () => {
      if (loading || savingRef.current) return
      loading = true
      try {
        await loadWait()
      } finally {
        loading = false
      }
    }
    void refresh()
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh()
    }, 5000)
    return () => {
      clearInterval(timer)
      requestRef.current += 1
    }
  }, [loadWait])

  const changeWait = async (target: CompletionWait, schedule?: WaitSchedule) => {
    if (savingRef.current) return
    savingRef.current = true
    requestRef.current += 1
    const type = schedule ? "RESCHEDULE" : "CONTINUE"
    setSaving(type)
    setFormError(null)
    try {
      const { data } = await api.post<{ wait: CompletionWait }>(
        `${endpoint}/${schedule ? "reschedule" : "continue"}`,
        {
          ...waitChangeTarget(target),
          ...(schedule ? { schedule } : {}),
        },
      )
      setWaits((previous) =>
        previous.map((wait) => (wait.runId === data.wait.runId ? data.wait : wait)),
      )
      setEditingWait(null)
      setContinuingWaitId(schedule ? null : target.waitingNodeExecutionId)
      toast.success(schedule ? "Completion wait rescheduled" : "Continuing completion actions")
      await onRefresh()
    } catch (error) {
      const conflict =
        isAxiosError(error) && (error.response?.status === 409 || error.response?.status === 404)
      const message = conflict
        ? "This wait has already changed. Review its current schedule and try again."
        : "Could not save this wait. Your changes are still available."
      setFormError(message)
      toast.error(message)
      // Keep the edited target intact so a stale dialog cannot silently change a later wait.
      await loadWait()
      if (conflict) await onRefresh()
    } finally {
      savingRef.current = false
      setSaving(null)
    }
  }
  const reschedule = (event: FormEvent) => {
    event.preventDefault()
    if (!editingWait) return
    let schedule: WaitSchedule | null = null
    if (mode === "DURATION") {
      const value = Number(amount)
      const seconds = { SECONDS: 1, MINUTES: 60, HOURS: 3600, DAYS: 86400 }[unit]
      if (Number.isSafeInteger(value) && value > 0 && value * seconds <= 315360000) {
        schedule = { mode, amount: value, unit }
      }
    } else schedule = fixedWaitSchedule(dateTime, waitTimezone)
    if (!schedule) {
      setFormError(
        mode === "DURATION"
          ? "Enter a positive whole-number duration of ten years or less."
          : "Choose a valid future date and time in the displayed time zone.",
      )
      return
    }
    void changeWait(editingWait, schedule)
  }

  if (loadError && !waits.length)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">Could not load the completion wait.</p>
        <Button variant="outline" size="sm" className="rounded-full text-xs font-semibold" onClick={() => void loadWait()}>
          Refresh wait
        </Button>
      </div>
    )
  if (!waits.length)
    return <p className="text-sm text-muted-foreground">Completion actions are processing.</p>
  return (
    <>
      {waits.map((wait) => {
        const ready = continuingWaitId === wait.waitingNodeExecutionId || wait.status === "RUNNING"
        return (
          <div key={wait.runId} className="flex flex-col gap-3 rounded-lg border p-3">
            <p className="text-sm font-medium">{wait.automationName || "Completion automation"}</p>
            <p className="text-sm" role="status">
              {ready
                ? "Continuing completion actions."
                : `Waiting until ${formatDateTimeForDisplay(wait.resumeAt, waitTimezone)} (${timezone || "UTC"}).`}
            </p>
            <p className="text-sm text-muted-foreground">
              Continue now ends this wait. Remaining completion actions still run before the next
              step starts.
            </p>
            {canManage ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm" className="rounded-full text-xs font-semibold"
                  disabled={saving !== null || ready}
                  onClick={() => void changeWait(wait)}
                >
                  {saving === "CONTINUE" || ready ? "Continuing…" : "Continue now"}
                </Button>
                <Button
                  variant="outline"
                  size="sm" className="rounded-full text-xs font-semibold"
                  disabled={saving !== null}
                  onClick={() => {
                    setEditingWait(wait)
                    setDateTime(formatUtcIsoToDateTimeDraft(wait.resumeAt, waitTimezone))
                    setFormError(null)
                    setMode("DURATION")
                    setAmount("1")
                    setUnit("DAYS")
                  }}
                >
                  Reschedule
                </Button>
              </div>
            ) : null}
          </div>
        )
      })}
      <Dialog
        open={editingWait !== null}
        onOpenChange={(open) => {
          if (!open && !savingRef.current) setEditingWait(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reschedule completion wait</DialogTitle>
            <DialogDescription>
              Change the wait for this enrollment. Times are shown in {timezone || "UTC"}.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={reschedule} className="flex flex-col gap-5">
            <FieldGroup>
              <Field>
                <FieldLabel>Schedule by</FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={mode}
                  disabled={saving !== null}
                  onValueChange={(value) => {
                    if (value) {
                      setMode(value as WaitSchedule["mode"])
                      setFormError(null)
                    }
                  }}
                  aria-label="Schedule by"
                >
                  <ToggleGroupItem value="DURATION">Duration</ToggleGroupItem>
                  <ToggleGroupItem value="FIXED_DATE">Date and time</ToggleGroupItem>
                </ToggleGroup>
              </Field>
              {mode === "DURATION" ? (
                <FieldGroup className="grid grid-cols-2 gap-3">
                  <Field data-invalid={Boolean(formError)}>
                    <FieldLabel htmlFor={`${id}-amount`}>Wait amount</FieldLabel>
                    <Input
                      id={`${id}-amount`}
                      type="number"
                      min="1"
                      step="1"
                      value={amount}
                      disabled={saving !== null}
                      aria-invalid={Boolean(formError)}
                      onChange={(event) => setAmount(event.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${id}-unit`}>Unit</FieldLabel>
                    <Select
                      value={unit}
                      disabled={saving !== null}
                      onValueChange={(value) => setUnit(value as typeof unit)}
                    >
                      <SelectTrigger id={`${id}-unit`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="SECONDS">Seconds</SelectItem>
                          <SelectItem value="MINUTES">Minutes</SelectItem>
                          <SelectItem value="HOURS">Hours</SelectItem>
                          <SelectItem value="DAYS">Days</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                </FieldGroup>
              ) : (
                <Field data-invalid={Boolean(formError)}>
                  <FieldLabel htmlFor={`${id}-date`}>Resume date and time</FieldLabel>
                  <FieldLabel className="sr-only" htmlFor={`${id}-time`}>
                    Resume time
                  </FieldLabel>
                  <DateTimeInput
                    id={`${id}-date`}
                    timeId={`${id}-time`}
                    value={dateTime}
                    onValueChange={setDateTime}
                    timezone={waitTimezone}
                    disabled={saving !== null}
                    ariaInvalid={Boolean(formError)}
                  />
                </Field>
              )}
              <FieldDescription>
                {mode === "DURATION" ? "The duration starts when you save. " : ""}
                Future enrollments keep their configured workflow.
              </FieldDescription>
              {formError ? <FieldError>{formError}</FieldError> : null}
            </FieldGroup>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full text-xs font-semibold"
                disabled={saving !== null}
                onClick={() => setEditingWait(null)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" className="rounded-full text-xs font-semibold" disabled={saving !== null}>
                {saving === "RESCHEDULE" ? "Saving…" : "Save schedule"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
