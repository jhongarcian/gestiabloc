"use client"

import { isAxiosError } from "axios"
import { LoaderCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { DateTimeInput } from "@/components/ui/date-time-input"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { type DateTimeDraft, formatDateTimeForDisplay, formatUtcIsoToDateTimeDraft } from "@/lib/date-time"
import {
  getAppointmentSlots,
  type AppointmentSlotsResponse,
  type CalendarEventItem,
  updateAppointment,
} from "../_lib/calendar-api"

type EditAppointmentSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenantId: string
  tenantTimezone: string | null
  appointment: CalendarEventItem | null
  meetingIntervalMinutes: 15 | 30 | 45 | 60 | 120
  meetingDurationMinutes: 15 | 30 | 45 | 60 | 120
  serviceOptions: Array<{
    id: string
    name: string
  }>
  assigneeOptions: Array<{
    id: string
    label: string
    email: string
    color?: string | null
  }>
  onUpdated?: () => Promise<void> | void
}

type FieldErrors = Partial<
  Record<"assignedToUserId" | "date" | "slot" | "title", string>
>

type SlotsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: AppointmentSlotsResponse }
  | { status: "error"; message: string }

function dateDraftToLocalDateKey(value: string) {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) return null

  const [, month, day, year] = match
  return `${year}-${month}-${day}`
}

function formatSlotDurationLabel(minutes: number) {
  if (minutes < 60) {
    return `${minutes} minutes`
  }

  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return `${hours} hour${hours === 1 ? "" : "s"}`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}

export function EditAppointmentSheet({
  open,
  onOpenChange,
  tenantId,
  tenantTimezone,
  appointment,
  meetingIntervalMinutes,
  meetingDurationMinutes,
  serviceOptions,
  assigneeOptions,
  onUpdated,
}: EditAppointmentSheetProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [title, setTitle] = useState("")
  const [notes, setNotes] = useState("")
  const [serviceId, setServiceId] = useState("__NONE__")
  const [assignedToUserId, setAssignedToUserId] = useState("")
  const [appointmentDateInput, setAppointmentDateInput] = useState<DateTimeDraft>({
    date: "",
    time: "",
  })
  const [selectedSlotStartAt, setSelectedSlotStartAt] = useState("")
  const [slotsState, setSlotsState] = useState<SlotsState>({ status: "idle" })

  const resetForm = useCallback(() => {
    if (!appointment) {
      setTitle("")
      setNotes("")
      setServiceId("__NONE__")
      setAssignedToUserId("")
      setAppointmentDateInput({ date: "", time: "" })
      setSelectedSlotStartAt("")
      setSlotsState({ status: "idle" })
      setFieldErrors({})
      return
    }

    setTitle(appointment.title)
    setNotes(appointment.notes ?? "")
    setServiceId(appointment.serviceId ?? "__NONE__")
    setAssignedToUserId(appointment.assignedToUserId ?? "")
    setAppointmentDateInput({
      ...formatUtcIsoToDateTimeDraft(appointment.startAt, tenantTimezone),
      time: "",
    })
    setSelectedSlotStartAt(appointment.startAt)
    setSlotsState({ status: "idle" })
    setFieldErrors({})
  }, [appointment, tenantTimezone])

  useEffect(() => {
    if (open) {
      resetForm()
    }
  }, [open, resetForm])

  const localDateKey = useMemo(
    () => dateDraftToLocalDateKey(appointmentDateInput.date),
    [appointmentDateInput.date],
  )

  useEffect(() => {
    if (!open || !appointment) return

    if (!assignedToUserId || !localDateKey) {
      setSelectedSlotStartAt("")
      setSlotsState({ status: "idle" })
      return
    }

    let cancelled = false
    const timeout = window.setTimeout(() => {
      void (async () => {
        setSlotsState({ status: "loading" })

        try {
          const data = await getAppointmentSlots(tenantId, {
            assignedToUserId,
            date: localDateKey,
            appointmentId: appointment.id,
          })

          if (cancelled) return

          setSlotsState({ status: "ready", data })
          setSelectedSlotStartAt((current) => {
            if (current && data.slots.some((slot) => slot.startAt === current && slot.available)) {
              return current
            }

            if (
              appointment.startAt &&
              data.slots.some((slot) => slot.startAt === appointment.startAt && slot.available)
            ) {
              return appointment.startAt
            }

            return data.slots.find((slot) => slot.available)?.startAt ?? ""
          })
        } catch (error) {
          if (cancelled) return

          if (isAxiosError(error)) {
            setSlotsState({
              status: "error",
              message:
                typeof error.response?.data?.error === "string"
                  ? error.response.data.error.replace(/_/g, " ")
                  : "Could not load time slots.",
            })
            return
          }

          setSlotsState({
            status: "error",
            message: "Could not load time slots.",
          })
        }
      })()
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [appointment, assignedToUserId, localDateKey, open, tenantId])

  const selectedSlot = useMemo(
    () =>
      slotsState.status === "ready"
        ? slotsState.data.slots.find((slot) => slot.startAt === selectedSlotStartAt) ?? null
        : null,
    [selectedSlotStartAt, slotsState],
  )

  const selectedServiceName =
    serviceId !== "__NONE__"
      ? serviceOptions.find((option) => option.id === serviceId)?.name ?? null
      : null

  const availableSlots =
    slotsState.status === "ready" ? slotsState.data.slots.filter((slot) => slot.available) : []
  const unavailableSlots =
    slotsState.status === "ready" ? slotsState.data.slots.filter((slot) => !slot.available) : []

  const validate = () => {
    const nextErrors: FieldErrors = {}

    if (!assignedToUserId) {
      nextErrors.assignedToUserId = "Assignee is required."
    }

    if (!localDateKey) {
      nextErrors.date = "Appointment date is required."
    }

    if (!selectedSlot) {
      nextErrors.slot = "Choose an available time slot."
    }

    setFieldErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const onSubmit = async () => {
    if (!appointment || !validate() || !selectedSlot) {
      return
    }

    setIsSubmitting(true)
    try {
      await updateAppointment(tenantId, appointment.id, {
        contactId: appointment.contactId,
        serviceId: serviceId !== "__NONE__" ? serviceId : null,
        assignedToUserId,
        title: title.trim() || null,
        notes: notes.trim() || null,
        startAt: selectedSlot.startAt,
        endAt: selectedSlot.endAt,
      })

      toast.success("Appointment updated.")
      onOpenChange(false)
      await onUpdated?.()
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        if (backendError === "APPOINTMENT_TIME_UNAVAILABLE") {
          toast.error("That slot was just taken. Choose another time.")
          setSelectedSlotStartAt("")
          if (localDateKey) {
            void (async () => {
              try {
                const data = await getAppointmentSlots(tenantId, {
                  assignedToUserId,
                  date: localDateKey,
                  appointmentId: appointment.id,
                })
                setSlotsState({ status: "ready", data })
              } catch {
                setSlotsState({
                  status: "error",
                  message: "Could not refresh time slots.",
                })
              }
            })()
          }
        } else {
          toast.error(
            typeof backendError === "string"
              ? backendError.replace(/_/g, " ")
              : "Could not update appointment.",
          )
        }
      } else {
        toast.error("Could not update appointment.")
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-4xl">
        <SheetHeader className="border-b border-slate-200 px-6 py-5">
          <SheetTitle>Edit appointment</SheetTitle>
          <SheetDescription>
            Update the assignment, slot, service, and notes while keeping booking conflicts protected.
          </SheetDescription>
        </SheetHeader>

        {appointment ? (
          <div className="space-y-6 px-6 py-6">
            <div className="rounded-[20px] border border-blue-100 bg-blue-50/80 px-4 py-3">
              <p className="text-sm font-medium text-blue-950">
                Interval: {formatSlotDurationLabel(meetingIntervalMinutes)} · Duration: {formatSlotDurationLabel(meetingDurationMinutes)}
              </p>
              <p className="mt-1 text-xs text-blue-800">
                Rescheduling uses the same atomic booking protection as creating a new appointment.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Contact</Label>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="font-medium text-slate-900">{appointment.contactName}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {appointment.contactEmail || appointment.contactPhone || "No contact details"}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-appointment-title">Title</Label>
                <Input
                  id="edit-appointment-title"
                  placeholder={
                    selectedServiceName
                      ? `${selectedServiceName} appointment`
                      : "Optional custom title"
                  }
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  aria-invalid={Boolean(fieldErrors.title)}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Service</Label>
                <Select value={serviceId} onValueChange={setServiceId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Optional service" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__NONE__">No service</SelectItem>
                    {serviceOptions.map((service) => (
                      <SelectItem key={service.id} value={service.id}>
                        {service.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Designated user</Label>
                  <Select value={assignedToUserId} onValueChange={setAssignedToUserId}>
                    <SelectTrigger aria-invalid={Boolean(fieldErrors.assignedToUserId)}>
                      <SelectValue placeholder="Choose user" />
                    </SelectTrigger>
                    <SelectContent>
                      {assigneeOptions.map((assignee) => (
                        <SelectItem key={assignee.id} value={assignee.id}>
                          {assignee.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {fieldErrors.assignedToUserId ? (
                    <p className="text-sm text-rose-600">{fieldErrors.assignedToUserId}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label>Appointment date</Label>
                  <DateTimeInput
                    value={appointmentDateInput}
                    onValueChange={(value) => {
                      setAppointmentDateInput({ ...value, time: "" })
                      setSelectedSlotStartAt("")
                    }}
                    hideTime
                    ariaInvalid={Boolean(fieldErrors.date)}
                  />
                  {fieldErrors.date ? (
                    <p className="text-sm text-rose-600">{fieldErrors.date}</p>
                  ) : null}
                </div>
              </div>

              <div className="space-y-3 rounded-[24px] border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Time slots
                    </h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {localDateKey
                        ? "Choose from available slots for the selected day."
                        : "Pick a date to load available slots."}
                    </p>
                  </div>
                  {slotsState.status === "loading" ? (
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      Loading
                    </div>
                  ) : null}
                </div>

                {slotsState.status === "error" ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {slotsState.message}
                  </div>
                ) : null}

                {slotsState.status === "ready" ? (
                  <>
                    <div className="space-y-2">
                      <Label>Available slot</Label>
                      <Select value={selectedSlotStartAt} onValueChange={setSelectedSlotStartAt}>
                        <SelectTrigger aria-invalid={Boolean(fieldErrors.slot)}>
                          <SelectValue placeholder="Choose a time slot" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableSlots.length > 0 ? (
                            availableSlots.map((slot) => (
                              <SelectItem key={slot.startAt} value={slot.startAt}>
                                {slot.startLabel} to {slot.endLabel}
                              </SelectItem>
                            ))
                          ) : (
                            <SelectItem value="__NONE__" disabled>
                              No open slots
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                      {fieldErrors.slot ? (
                        <p className="text-sm text-rose-600">{fieldErrors.slot}</p>
                      ) : null}
                    </div>

                    {selectedSlot ? (
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3">
                        <p className="text-sm font-medium text-emerald-900">
                          {formatDateTimeForDisplay(selectedSlot.startAt, tenantTimezone)} to{" "}
                          {formatDateTimeForDisplay(selectedSlot.endAt, tenantTimezone)}
                        </p>
                        <p className="mt-1 text-xs text-emerald-800">
                          Duration: {formatSlotDurationLabel(slotsState.data.meetingDurationMinutes)}
                        </p>
                      </div>
                    ) : null}

                    {unavailableSlots.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                          Taken or blocked
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {unavailableSlots.map((slot) => (
                            <div
                              key={slot.startAt}
                              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500"
                            >
                              {slot.startLabel} to {slot.endLabel}
                              {slot.reason ? ` · ${slot.reason}` : ""}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center">
                    <p className="font-medium text-slate-900">No slots loaded yet.</p>
                    <p className="mt-1 text-sm text-slate-500">
                      Select a user and date to load the available booking times.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-appointment-notes">Notes</Label>
              <Textarea
                id="edit-appointment-notes"
                placeholder="Optional internal notes for the appointment."
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={5}
              />
            </div>
          </div>
        ) : null}

        <SheetFooter className="border-t border-slate-200 bg-white px-6 py-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={isSubmitting || !appointment}
            className="bg-blue-950 text-white hover:bg-blue-900"
          >
            {isSubmitting ? "Saving..." : "Save changes"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
