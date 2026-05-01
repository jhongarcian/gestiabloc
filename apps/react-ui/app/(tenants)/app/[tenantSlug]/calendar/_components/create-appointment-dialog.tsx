"use client"

import { isAxiosError } from "axios"
import { CalendarClock, Check, ChevronDown, LoaderCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { DateTimeInput } from "@/components/ui/date-time-input"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import { type DateTimeDraft, formatDateTimeForDisplay, formatUtcIsoToDateTimeDraft } from "@/lib/date-time"
import { cn } from "@/lib/utils"
import { createAppointment, getAppointmentSlots, type AppointmentSlotsResponse } from "../_lib/calendar-api"

type ContactSearchItem = {
  id: string
  fullName: string
  phoneNumber: string | null
  email: string | null
}

type ContactSearchResponse = {
  ok: boolean
  items: ContactSearchItem[]
}

type CreateAppointmentDialogProps = {
  tenantId: string
  tenantTimezone: string | null
  currentUserId: string
  initialContact?: ContactSearchItem | null
  triggerLabel?: string
  triggerClassName?: string
  iconOnly?: boolean
  triggerTooltip?: string | null
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
    image?: string | null
    color?: string | null
  }>
  onCreated?: () => Promise<void> | void
}

type FieldErrors = Partial<
  Record<"contactId" | "assignedToUserId" | "date" | "slot" | "title", string>
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

function getInitials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

export function CreateAppointmentDialog({
  tenantId,
  tenantTimezone,
  currentUserId,
  initialContact = null,
  triggerLabel = "Create appointment",
  triggerClassName,
  iconOnly = false,
  triggerTooltip = null,
  meetingIntervalMinutes,
  meetingDurationMinutes,
  serviceOptions,
  assigneeOptions,
  onCreated,
}: CreateAppointmentDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [title, setTitle] = useState("")
  const [notes, setNotes] = useState("")
  const [serviceId, setServiceId] = useState("__NONE__")
  const [assignedToUserId, setAssignedToUserId] = useState(currentUserId)
  const [contactQuery, setContactQuery] = useState("")
  const [debouncedContactQuery, setDebouncedContactQuery] = useState("")
  const [selectedContact, setSelectedContact] = useState<ContactSearchItem | null>(null)
  const [contactResults, setContactResults] = useState<ContactSearchItem[]>([])
  const [isSearchingContacts, setIsSearchingContacts] = useState(false)
  const [appointmentDateInput, setAppointmentDateInput] = useState<DateTimeDraft>({
    date: "",
    time: "",
  })
  const [selectedSlotStartAt, setSelectedSlotStartAt] = useState("")
  const [slotsState, setSlotsState] = useState<SlotsState>({ status: "idle" })
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false)
  const isSelectingContactRef = useRef(false)

  const resetForm = useCallback(() => {
    setFieldErrors({})
    setTitle("")
    setNotes("")
    setServiceId("__NONE__")
    setAssignedToUserId(currentUserId)
    setContactQuery(initialContact?.fullName ?? "")
    setDebouncedContactQuery("")
    setSelectedContact(initialContact)
    setContactResults([])
    setSelectedSlotStartAt("")
    setSlotsState({ status: "idle" })
    setAppointmentDateInput({
      ...formatUtcIsoToDateTimeDraft(new Date().toISOString(), tenantTimezone),
      time: "",
    })
  }, [currentUserId, initialContact, tenantTimezone])

  useEffect(() => {
    if (open) {
      resetForm()
    }
  }, [open, resetForm])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedContactQuery(contactQuery.trim())
    }, 250)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [contactQuery])

  useEffect(() => {
    if (initialContact) {
      setContactResults([])
      setIsSearchingContacts(false)
      return
    }

    const query = debouncedContactQuery

    if (selectedContact && query === selectedContact.fullName) {
      return
    }

    if (query.length < 2) {
      setContactResults([])
      setIsSearchingContacts(false)
      return
    }

    let cancelled = false

    void (async () => {
      setIsSearchingContacts(true)

      try {
        const { data } = await api.get<ContactSearchResponse>(`/api/contacts/${tenantId}/search`, {
          params: { q: query },
        })

        if (!cancelled) {
          setContactResults(data.items)
        }
      } catch {
        if (!cancelled) {
          setContactResults([])
        }
      } finally {
        if (!cancelled) {
          setIsSearchingContacts(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [debouncedContactQuery, initialContact, selectedContact, tenantId])

  const localDateKey = useMemo(
    () => dateDraftToLocalDateKey(appointmentDateInput.date),
    [appointmentDateInput.date],
  )

  useEffect(() => {
    if (!open) return

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
          })

          if (cancelled) return

          setSlotsState({ status: "ready", data })
          setSelectedSlotStartAt((current) => {
            if (current && data.slots.some((slot) => slot.startAt === current && slot.available)) {
              return current
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
  }, [assignedToUserId, localDateKey, open, tenantId])

  const selectedSlot = useMemo(
    () =>
      slotsState.status === "ready"
        ? slotsState.data.slots.find((slot) => slot.startAt === selectedSlotStartAt) ?? null
        : null,
    [selectedSlotStartAt, slotsState],
  )

  const startAtIso = selectedSlot?.startAt ?? null
  const endAtIso = selectedSlot?.endAt ?? null

  const selectedServiceName =
    serviceId !== "__NONE__"
      ? serviceOptions.find((option) => option.id === serviceId)?.name ?? null
      : null

  const selectedAssignee = useMemo(
    () =>
      assigneeOptions.find((assignee) => assignee.id === assignedToUserId) ?? null,
    [assignedToUserId, assigneeOptions],
  )

  const availableSlots =
    slotsState.status === "ready" ? slotsState.data.slots.filter((slot) => slot.available) : []
  const unavailableSlots =
    slotsState.status === "ready" ? slotsState.data.slots.filter((slot) => !slot.available) : []

  const validate = () => {
    const nextErrors: FieldErrors = {}

    if (!selectedContact?.id) {
      nextErrors.contactId = "Contact is required."
    }

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
    if (!validate() || !selectedContact?.id || !startAtIso || !endAtIso) {
      return
    }

    setIsSubmitting(true)
    try {
      await createAppointment(tenantId, {
        contactId: selectedContact.id,
        serviceId: serviceId !== "__NONE__" ? serviceId : null,
        assignedToUserId,
        title: title.trim() || null,
        notes: notes.trim() || null,
        startAt: startAtIso,
        endAt: endAtIso,
      })

      toast.success("Appointment created.")
      setOpen(false)
      await onCreated?.()
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
              : "Could not create appointment.",
          )
        }
      } else {
        toast.error("Could not create appointment.")
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {triggerTooltip ? (
        <TooltipProvider delayDuration={120}>
          <Tooltip>
            <TooltipTrigger asChild>
              <SheetTrigger asChild>
                <Button
                  aria-label={triggerTooltip}
                  className={cn(
                    "bg-blue-950 text-white hover:bg-blue-900",
                    iconOnly && "rounded-full p-0",
                    triggerClassName,
                  )}
                >
                  {iconOnly ? (
                    <CalendarClock className="h-4 w-4" />
                  ) : (
                    triggerLabel
                  )}
                </Button>
              </SheetTrigger>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>
              {triggerTooltip}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <SheetTrigger asChild>
          <Button
            className={cn(
              "bg-blue-950 text-white hover:bg-blue-900",
              iconOnly && "rounded-full p-0",
              triggerClassName,
            )}
          >
            {iconOnly ? <CalendarClock className="h-4 w-4" /> : triggerLabel}
          </Button>
        </SheetTrigger>
      )}
      <SheetContent side="right" className="flex h-full flex-col overflow-hidden gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-slate-200 bg-slate-50 px-6 text-left">
          <SheetTitle className="text-xl font-semibold text-slate-950">Create Appointment</SheetTitle>
          <SheetDescription>
            Pick the contact, assign the appointment, and choose an open slot based on the calendar booking rules.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <section className="border-b border-slate-200 px-6 py-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Booking Rules
            </p>
            <p className="mt-3 text-sm text-slate-700">
              Interval: {formatSlotDurationLabel(meetingIntervalMinutes)} · Duration:{" "}
              {formatSlotDurationLabel(meetingDurationMinutes)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Time slots follow the account booking rules and only open slots can be selected.
            </p>
          </section>

          <section className="border-b border-slate-200 px-6 py-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Contact
            </p>
            <div className="mt-3 space-y-2">
            {initialContact ? (
              <div className="space-y-1">
                <p className="text-base font-semibold text-slate-950">
                  {selectedContact?.fullName ?? initialContact.fullName}
                </p>
                <p className="text-sm text-slate-500">
                  {selectedContact?.email ||
                    selectedContact?.phoneNumber ||
                    initialContact.email ||
                    initialContact.phoneNumber ||
                    "No contact details"}
                </p>
              </div>
            ) : (
              <>
                <Label htmlFor="appointment-contact">Contact</Label>
                <Command className="rounded-xl border border-slate-200">
                  <CommandInput
                    id="appointment-contact"
                    placeholder="Search contact by name..."
                    value={contactQuery}
                    onValueChange={(value) => {
                      setContactQuery(value)

                      if (
                        selectedContact &&
                        value.trim() !== selectedContact.fullName &&
                        !isSelectingContactRef.current
                      ) {
                        setSelectedContact(null)
                      }
                    }}
                  />
                  <CommandList>
                    <CommandEmpty>
                      {isSearchingContacts ? "Searching contacts..." : "No contacts found."}
                    </CommandEmpty>
                    <CommandGroup heading="Results">
                      {contactResults.map((contact) => (
                        <CommandItem
                          key={contact.id}
                          value={`${contact.fullName} ${contact.email ?? ""} ${contact.phoneNumber ?? ""}`}
                          onSelect={() => {
                            isSelectingContactRef.current = true
                            setSelectedContact(contact)
                            setContactQuery(contact.fullName)
                            setContactResults([])
                            window.setTimeout(() => {
                              isSelectingContactRef.current = false
                            }, 0)
                          }}
                        >
                          <div className="flex flex-col">
                            <span>{contact.fullName}</span>
                            <span className="text-xs text-slate-500">
                              {contact.email || contact.phoneNumber || "No contact details"}
                            </span>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </>
            )}
            {fieldErrors.contactId ? (
              <p className="text-sm text-rose-600">{fieldErrors.contactId}</p>
            ) : selectedContact ? (
              !initialContact ? (
              <div className="pt-1">
                <p className="text-base font-semibold text-slate-950">{selectedContact.fullName}</p>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedContact.email || selectedContact.phoneNumber || "No contact details"}
                </p>
              </div>
              ) : null
            ) : null}
            </div>
          </section>

          <section className="border-b border-slate-200 px-6 py-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Appointment
            </p>
            <div className="mt-3 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="appointment-title">Title</Label>
              <Input
                id="appointment-title"
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

            <div className="space-y-2">
              <Label>Service</Label>
              <Select value={serviceId} onValueChange={setServiceId}>
                <SelectTrigger className="border-blue-200 focus-visible:ring-blue-200">
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
            {notes ? (
              <div className="space-y-2">
                <Label htmlFor="appointment-notes">Notes</Label>
                <Textarea
                  id="appointment-notes"
                  placeholder="Optional internal notes for the appointment."
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={5}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="appointment-notes">Notes</Label>
                <Textarea
                  id="appointment-notes"
                  placeholder="Optional internal notes for the appointment."
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={5}
                />
              </div>
            )}
            </div>
          </section>

          <section className="border-b border-slate-200 px-6 py-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Schedule
            </p>
            <div className="mt-3 space-y-4">
              <div className="space-y-2">
                <Label>Designated user</Label>
                <Popover open={assigneePickerOpen} onOpenChange={setAssigneePickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      aria-invalid={Boolean(fieldErrors.assignedToUserId)}
                      className={cn(
                        "h-11 w-full cursor-pointer justify-between border-slate-200 px-3 text-left font-normal hover:bg-slate-50",
                        fieldErrors.assignedToUserId && "border-rose-300 focus-visible:ring-rose-200",
                      )}
                    >
                      {selectedAssignee ? (
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar className="h-7 w-7 shrink-0">
                            <AvatarImage
                              src={selectedAssignee.image ?? undefined}
                              alt={selectedAssignee.label}
                            />
                            <AvatarFallback className="bg-blue-950 text-[10px] font-semibold text-white">
                              {getInitials(selectedAssignee.label)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="truncate text-sm font-medium text-slate-900">
                            {selectedAssignee.label}
                          </span>
                        </div>
                      ) : (
                        <span className="text-sm text-slate-500">Choose user</span>
                      )}
                      <ChevronDown className="ml-3 h-4 w-4 shrink-0 text-slate-500" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-[360px] p-0">
                    <Command>
                      <CommandInput placeholder="Assign appointment to..." />
                      <CommandList>
                        <CommandEmpty>No users found.</CommandEmpty>
                        {assigneeOptions.map((assignee) => (
                          <CommandItem
                            key={assignee.id}
                            value={`${assignee.label} ${assignee.email}`}
                            onSelect={() => {
                              setAssignedToUserId(assignee.id)
                              setAssigneePickerOpen(false)
                            }}
                            className="cursor-pointer gap-3 px-3 py-3"
                          >
                            <Avatar className="h-9 w-9">
                              <AvatarImage
                                src={assignee.image ?? undefined}
                                alt={assignee.label}
                              />
                              <AvatarFallback className="bg-blue-950 text-xs font-semibold text-white">
                                {getInitials(assignee.label)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-slate-900">
                                {assignee.label}
                              </p>
                              <p className="truncate text-xs text-slate-500">
                                {assignee.email}
                              </p>
                            </div>
                            <Check
                              className={cn(
                                "h-4 w-4 text-blue-950",
                                assignedToUserId === assignee.id
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                          </CommandItem>
                        ))}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
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

              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Time Slots
                  </p>
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
                <p className="text-sm text-rose-700">{slotsState.message}</p>
              ) : null}

              {slotsState.status === "ready" ? (
                <>
                  <div className="space-y-2">
                    <Label>Available slot</Label>
                    <Select value={selectedSlotStartAt} onValueChange={setSelectedSlotStartAt}>
                      <SelectTrigger
                        aria-invalid={Boolean(fieldErrors.slot)}
                        className="border-blue-200 focus-visible:ring-blue-200"
                      >
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
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-slate-900">
                        {formatDateTimeForDisplay(selectedSlot.startAt, tenantTimezone)} to{" "}
                        {formatDateTimeForDisplay(selectedSlot.endAt, tenantTimezone)}
                      </p>
                      <p className="text-xs text-slate-500">
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
                <div className="py-2">
                  <p className="font-medium text-slate-900">No slots loaded yet.</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Select a user and date to load the available booking times.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>

        <SheetFooter className="border-t border-slate-200 bg-white px-6 py-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={isSubmitting}
            className="bg-blue-950 text-white hover:bg-blue-900"
          >
            {isSubmitting ? "Creating..." : "Create appointment"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
