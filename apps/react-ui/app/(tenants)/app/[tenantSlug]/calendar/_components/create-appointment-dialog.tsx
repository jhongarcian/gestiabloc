"use client"

import { isAxiosError } from "axios"
import { CalendarClock, Check, ChevronDown, LoaderCircle, Plus, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { DateTimeInput } from "@/components/ui/date-time-input"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
  lockContact?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
  initialDate?: Date | null
  initialAssignedToUserId?: string | null
  preferredSlotStartAt?: string | null
  preferredSlotTime?: string | null
  triggerLabel?: string
  triggerClassName?: string
  iconOnly?: boolean
  triggerTooltip?: string | null
  trigger?: ReactNode
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

function sanitizeServiceSearchInput(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .replace(/^\s+/, "")
    .slice(0, 120)
}

const SERVICE_SEARCH_DEBOUNCE_MS = 250

export function CreateAppointmentDialog({
  tenantId,
  tenantTimezone,
  currentUserId,
  initialContact = null,
  lockContact = false,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
  initialDate = null,
  initialAssignedToUserId = null,
  preferredSlotStartAt = null,
  preferredSlotTime = null,
  triggerLabel = "Create appointment",
  triggerClassName,
  iconOnly = false,
  triggerTooltip = null,
  trigger,
  meetingIntervalMinutes,
  meetingDurationMinutes,
  serviceOptions,
  assigneeOptions,
  onCreated,
}: CreateAppointmentDialogProps) {
  const router = useRouter()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [title, setTitle] = useState("")
  const [notes, setNotes] = useState("")
  const [serviceId, setServiceId] = useState("__NONE__")
  const [servicePickerOpen, setServicePickerOpen] = useState(false)
  const [serviceQuery, setServiceQuery] = useState("")
  const [debouncedServiceQuery, setDebouncedServiceQuery] = useState("")
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
  const contactInputRef = useRef<HTMLInputElement>(null)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (controlledOpen === undefined) {
        setUncontrolledOpen(nextOpen)
      }
      onOpenChange?.(nextOpen)
    },
    [controlledOpen, onOpenChange],
  )

  const resetForm = useCallback(() => {
    setFieldErrors({})
    setTitle("")
    setNotes("")
    setServiceId("__NONE__")
    setServicePickerOpen(false)
    setServiceQuery("")
    setDebouncedServiceQuery("")
    setAssignedToUserId(initialAssignedToUserId ?? currentUserId)
    setContactQuery("")
    setDebouncedContactQuery("")
    setSelectedContact(initialContact)
    setContactResults([])
    setIsSearchingContacts(false)
    setSelectedSlotStartAt(preferredSlotStartAt ?? "")
    setSlotsState({ status: "idle" })
    setAppointmentDateInput({
      ...formatUtcIsoToDateTimeDraft((initialDate ?? new Date()).toISOString(), tenantTimezone),
      time: "",
    })
  }, [
    currentUserId,
    initialAssignedToUserId,
    initialContact,
    initialDate,
    preferredSlotStartAt,
    tenantTimezone,
  ])

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
    if (!servicePickerOpen) return

    const timeout = window.setTimeout(() => {
      setDebouncedServiceQuery(serviceQuery.trim())
    }, SERVICE_SEARCH_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [servicePickerOpen, serviceQuery])

  useEffect(() => {
    if (initialContact || selectedContact) {
      setContactResults([])
      setIsSearchingContacts(false)
      return
    }

    const query = debouncedContactQuery

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

            if (
              preferredSlotStartAt &&
              data.slots.some(
                (slot) => slot.startAt === preferredSlotStartAt && slot.available,
              )
            ) {
              return preferredSlotStartAt
            }

            if (preferredSlotTime) {
              const matchingSlot = data.slots.find((slot) => {
                if (!slot.available) return false
                return (
                  formatUtcIsoToDateTimeDraft(slot.startAt, tenantTimezone).time ===
                  preferredSlotTime
                )
              })

              if (matchingSlot) {
                return matchingSlot.startAt
              }
            }

            return data.slots.find((slot) => slot.available)?.startAt ?? ""
          })
        } catch (error) {
          if (cancelled) return

          if (isAxiosError(error)) {
            const backendError = error.response?.data?.error
            setSlotsState({
              status: "error",
              message:
                backendError === "ASSIGNEE_NOT_FOUND"
                  ? "Calendar availability is not configured for this user."
                  : typeof backendError === "string"
                    ? backendError.replace(/_/g, " ")
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
  }, [
    assignedToUserId,
    localDateKey,
    open,
    preferredSlotStartAt,
    preferredSlotTime,
    tenantId,
    tenantTimezone,
  ])

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

  const isSearchingServices =
    servicePickerOpen &&
    serviceQuery.trim().toLocaleLowerCase() !==
      debouncedServiceQuery.trim().toLocaleLowerCase()

  const visibleServiceOptions = useMemo(() => {
    if (isSearchingServices) return []

    const normalizedQuery = debouncedServiceQuery.trim().toLocaleLowerCase()
    const matchingOptions = normalizedQuery
      ? serviceOptions.filter((option) =>
          option.name.toLocaleLowerCase().includes(normalizedQuery),
        )
      : serviceOptions

    return matchingOptions.slice(0, 5)
  }, [debouncedServiceQuery, isSearchingServices, serviceOptions])

  const selectedAssignee = useMemo(
    () =>
      assigneeOptions.find((assignee) => assignee.id === assignedToUserId) ?? null,
    [assignedToUserId, assigneeOptions],
  )

  const availableSlots =
    slotsState.status === "ready" ? slotsState.data.slots.filter((slot) => slot.available) : []
  const unavailableSlots =
    slotsState.status === "ready" ? slotsState.data.slots.filter((slot) => !slot.available) : []

  const slotPlaceholder =
    slotsState.status === "loading"
      ? "Loading available times..."
      : slotsState.status === "error"
        ? "Availability unavailable"
        : slotsState.status === "ready" && availableSlots.length === 0
          ? "No open times for this date"
          : slotsState.status === "ready"
            ? "Choose an available time"
            : "Choose a user and date first"

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
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isSubmitting) return
        setOpen(nextOpen)
        if (!nextOpen) resetForm()
      }}
    >
      {!hideTrigger && trigger ? (
        <SheetTrigger asChild>{trigger}</SheetTrigger>
      ) : !hideTrigger && triggerTooltip ? (
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
                    <>
                      <Plus className="h-4 w-4" />
                      <span>{triggerLabel}</span>
                    </>
                  )}
                </Button>
              </SheetTrigger>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>
              {triggerTooltip}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : !hideTrigger ? (
        <SheetTrigger asChild>
          <Button
            className={cn(
              "bg-blue-950 text-white hover:bg-blue-900",
              iconOnly && "rounded-full p-0",
              triggerClassName,
            )}
          >
            {iconOnly ? (
              <CalendarClock className="h-4 w-4" />
            ) : (
              <>
                <Plus className="h-4 w-4" />
                <span>{triggerLabel}</span>
              </>
            )}
          </Button>
        </SheetTrigger>
      ) : null}
      <SheetContent
        side="right"
        className="flex h-full w-full flex-col gap-0 overflow-hidden border-l border-slate-200 bg-white p-0 sm:max-w-2xl [&>button]:right-5 [&>button]:top-5 [&>button]:cursor-pointer [&>button]:rounded-full [&>button]:bg-white/80 [&>button]:opacity-100 [&>button]:shadow-sm [&>button]:backdrop-blur"
      >
        <SheetHeader className="relative overflow-hidden border-b border-blue-100 bg-[#f1f7ff] px-6 py-6 text-left sm:px-7">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(30,64,175,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(30,64,175,.08)_1px,transparent_1px)] [background-size:42px_42px]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-12 -bottom-20 size-48 rounded-full bg-blue-300/30 blur-3xl"
          />
          <div className="relative pr-10">
            <div className="flex min-w-0 flex-col gap-1.5">
              <p className="text-xs font-semibold text-blue-700">Calendar workflow</p>
              <SheetTitle className="text-xl font-semibold text-slate-950 sm:text-2xl">
                Create appointment
              </SheetTitle>
              <SheetDescription className="max-w-xl text-sm leading-6 text-slate-600">
                {lockContact
                  ? "Choose an owner and available time for this contact."
                  : "Choose a contact, owner, and available time for the appointment."}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6 [scrollbar-gutter:stable] sm:px-7">
          <div className="flex flex-col gap-7">
            <section className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <p className="text-xs font-semibold text-blue-700">Appointment details</p>
                <h3 className="text-base font-semibold text-slate-950">Define the visit</h3>
                <p className="text-sm leading-6 text-slate-600">
                  Add the context your team needs before the appointment begins.
                </p>
              </div>

              <FieldGroup className="gap-5">
                {!lockContact ? (
                  <Field
                    data-invalid={Boolean(fieldErrors.contactId)}
                    data-disabled={isSubmitting}
                    className="gap-2"
                  >
                    <FieldLabel htmlFor="create-appointment-contact">
                      Contact <span className="text-rose-500" aria-hidden="true">*</span>
                    </FieldLabel>
                    {initialContact ? (
                      <div
                        id="create-appointment-contact"
                        className="flex flex-col gap-1 border-l-2 border-blue-200 py-1 pl-3"
                      >
                        <p className="text-sm font-semibold text-slate-950">
                          {selectedContact?.fullName ?? initialContact.fullName}
                        </p>
                        <p className="text-xs leading-5 text-slate-600">
                          {selectedContact?.email ||
                            selectedContact?.phoneNumber ||
                            initialContact.email ||
                            initialContact.phoneNumber ||
                            "No contact details"}
                        </p>
                      </div>
                    ) : selectedContact ? (
                      <div
                        id="create-appointment-contact"
                        className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-950">
                            {selectedContact.fullName}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            {selectedContact.email ||
                              selectedContact.phoneNumber ||
                              "No contact details"}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={isSubmitting}
                          aria-label={`Remove ${selectedContact.fullName}`}
                          className="cursor-pointer text-slate-500 hover:bg-white hover:text-slate-950"
                          onClick={() => {
                            setSelectedContact(null)
                            setContactQuery("")
                            setDebouncedContactQuery("")
                            setContactResults([])
                            setIsSearchingContacts(false)
                            window.requestAnimationFrame(() =>
                              contactInputRef.current?.focus(),
                            )
                          }}
                        >
                          <X />
                        </Button>
                      </div>
                    ) : (
                      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm focus-within:border-blue-400 focus-within:ring-3 focus-within:ring-blue-100">
                        <Command shouldFilter={false}>
                          <CommandInput
                            ref={contactInputRef}
                            id="create-appointment-contact"
                            placeholder="Search by name, email, or phone"
                            value={contactQuery}
                            disabled={isSubmitting}
                            aria-invalid={Boolean(fieldErrors.contactId)}
                            onValueChange={(value) => {
                              setContactQuery(value)
                              setFieldErrors((current) => ({
                                ...current,
                                contactId: undefined,
                              }))
                            }}
                          />
                          {contactQuery.trim().length >= 2 ? (
                            <CommandList>
                              <CommandEmpty>
                                {isSearchingContacts
                                  ? "Searching contacts..."
                                  : "No contacts found."}
                              </CommandEmpty>
                              <CommandGroup heading="Contacts">
                                {contactResults.map((contact) => (
                                  <CommandItem
                                    key={contact.id}
                                    value={contact.id}
                                    onSelect={() => {
                                      setSelectedContact(contact)
                                      setContactQuery("")
                                      setDebouncedContactQuery("")
                                      setContactResults([])
                                      setIsSearchingContacts(false)
                                      setFieldErrors((current) => ({
                                        ...current,
                                        contactId: undefined,
                                      }))
                                    }}
                                    className="cursor-pointer"
                                  >
                                    <div className="flex flex-col gap-0.5">
                                      <span className="font-medium">{contact.fullName}</span>
                                      <span className="text-xs text-slate-500">
                                        {contact.email ||
                                          contact.phoneNumber ||
                                          "No contact details"}
                                      </span>
                                    </div>
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          ) : null}
                        </Command>
                      </div>
                    )}
                    <FieldDescription>
                      {initialContact
                        ? "This appointment will stay linked to the selected contact."
                        : "Type at least two characters to find a contact."}
                    </FieldDescription>
                    <FieldError>{fieldErrors.contactId}</FieldError>
                  </Field>
                ) : null}

                <FieldGroup className="gap-4">
                  <Field
                    data-invalid={Boolean(fieldErrors.title)}
                    data-disabled={isSubmitting}
                    className="gap-2"
                  >
                    <FieldLabel htmlFor="create-appointment-title">
                      Title <span className="text-xs font-normal text-slate-500">Optional</span>
                    </FieldLabel>
                    <Input
                      id="create-appointment-title"
                      placeholder={
                        selectedServiceName
                          ? `${selectedServiceName} appointment`
                          : "Add a recognizable title"
                      }
                      value={title}
                      onChange={(event) => {
                        setTitle(event.target.value)
                        setFieldErrors((current) => ({ ...current, title: undefined }))
                      }}
                      disabled={isSubmitting}
                      aria-invalid={Boolean(fieldErrors.title)}
                      className="h-11 rounded-xl border-slate-200 bg-slate-50/60 px-4 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
                    />
                    <FieldError>{fieldErrors.title}</FieldError>
                  </Field>

                  <Field data-disabled={isSubmitting} className="gap-2">
                    <FieldLabel htmlFor="create-appointment-service">
                      Service <span className="text-xs font-normal text-slate-500">Optional</span>
                    </FieldLabel>
                    <Popover
                      open={servicePickerOpen}
                      onOpenChange={(nextOpen) => {
                        if (isSubmitting) return
                        setServicePickerOpen(nextOpen)
                        if (!nextOpen) {
                          setServiceQuery("")
                          setDebouncedServiceQuery("")
                        }
                      }}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          id="create-appointment-service"
                          type="button"
                          variant="outline"
                          disabled={isSubmitting}
                          aria-expanded={servicePickerOpen}
                          className="h-11 w-full justify-between rounded-xl border-slate-200 bg-slate-50/60 px-3 shadow-none hover:bg-slate-50/60 focus-visible:border-blue-400 focus-visible:ring-blue-100"
                        >
                          <span className="min-w-0 truncate rounded-full bg-slate-100 px-2.5 py-1 text-sm font-medium text-slate-700">
                            {selectedServiceName ?? "No service"}
                          </span>
                          <ChevronDown data-icon="inline-end" className="ml-auto text-slate-400" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        className="w-[var(--radix-popover-trigger-width)] p-0"
                      >
                        <Command shouldFilter={false}>
                          <CommandInput
                            placeholder="Search services..."
                            value={serviceQuery}
                            onValueChange={(value) =>
                              setServiceQuery(sanitizeServiceSearchInput(value))
                            }
                            disabled={isSubmitting}
                          />
                          <CommandList>
                            <CommandEmpty>
                              {isSearchingServices
                                ? "Searching services..."
                                : "No services found."}
                            </CommandEmpty>
                            <CommandGroup heading="Services">
                              {serviceQuery.trim().length === 0 ? (
                                <CommandItem
                                  value="No service"
                                  onSelect={() => {
                                    setServiceId("__NONE__")
                                    setServicePickerOpen(false)
                                    setServiceQuery("")
                                    setDebouncedServiceQuery("")
                                  }}
                                  className="cursor-pointer gap-3 py-2.5"
                                >
                                  <span className="min-w-0 flex-1 truncate rounded-full bg-slate-100 px-2.5 py-1 text-sm font-medium text-slate-600">
                                    No service
                                  </span>
                                  <Check
                                    className={cn(
                                      "text-blue-950",
                                      serviceId === "__NONE__"
                                        ? "opacity-100"
                                        : "opacity-0",
                                    )}
                                  />
                                </CommandItem>
                              ) : null}
                              {visibleServiceOptions.map((service) => (
                                <CommandItem
                                  key={service.id}
                                  value={`${service.name} ${service.id}`}
                                  onSelect={() => {
                                    setServiceId(service.id)
                                    setServicePickerOpen(false)
                                    setServiceQuery("")
                                    setDebouncedServiceQuery("")
                                  }}
                                  className="cursor-pointer gap-3 py-2.5"
                                >
                                  <span className="min-w-0 flex-1 truncate rounded-full bg-blue-50 px-2.5 py-1 text-sm font-medium text-blue-950">
                                    {service.name}
                                  </span>
                                  <Check
                                    className={cn(
                                      "text-blue-950",
                                      serviceId === service.id
                                        ? "opacity-100"
                                        : "opacity-0",
                                    )}
                                  />
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <FieldDescription>
                      Search services; up to five matches are shown.
                    </FieldDescription>
                  </Field>
                </FieldGroup>

                <Field data-disabled={isSubmitting} className="gap-2">
                  <FieldLabel htmlFor="create-appointment-notes">
                    Notes <span className="text-xs font-normal text-slate-500">Optional</span>
                  </FieldLabel>
                  <Textarea
                    id="create-appointment-notes"
                    placeholder="Add internal context for the appointment."
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={4}
                    disabled={isSubmitting}
                    className="min-h-28 resize-y rounded-xl border-slate-200 bg-slate-50/60 px-4 py-3 leading-6 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
                  />
                </Field>
              </FieldGroup>
            </section>

            <section className="flex flex-col gap-4 border-t border-slate-200 pt-6">
              <div className="flex flex-col gap-1">
                <p className="text-xs font-semibold text-blue-700">Schedule</p>
                <h3 className="text-base font-semibold text-slate-950">
                  Choose an available time
                </h3>
                <p className="text-sm leading-6 text-slate-600">
                  Availability uses {formatSlotDurationLabel(meetingIntervalMinutes)} intervals
                  and reserves {formatSlotDurationLabel(meetingDurationMinutes)}.
                </p>
              </div>

              <FieldGroup className="gap-4 sm:grid sm:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                <Field
                  data-invalid={Boolean(fieldErrors.assignedToUserId)}
                  data-disabled={isSubmitting}
                  className="min-w-0 gap-2"
                >
                  <FieldLabel htmlFor="create-appointment-assignee">
                    Assignee <span className="text-rose-500" aria-hidden="true">*</span>
                  </FieldLabel>
                  <Popover
                    open={assigneePickerOpen}
                    onOpenChange={(nextOpen) => {
                      if (!isSubmitting) setAssigneePickerOpen(nextOpen)
                    }}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        id="create-appointment-assignee"
                        type="button"
                        variant="outline"
                        disabled={isSubmitting}
                        aria-invalid={Boolean(fieldErrors.assignedToUserId)}
                        aria-expanded={assigneePickerOpen}
                        className="h-11 w-full justify-between rounded-xl border-blue-100 bg-white px-3 shadow-none hover:bg-white focus-visible:border-blue-400 focus-visible:ring-blue-100"
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Avatar size="sm" className="ring-2 ring-blue-50">
                            {selectedAssignee?.image ? (
                              <AvatarImage
                                src={selectedAssignee.image}
                                alt={`${selectedAssignee.label} profile photo`}
                              />
                            ) : null}
                            <AvatarFallback className="bg-blue-950 font-semibold text-white">
                              {selectedAssignee ? getInitials(selectedAssignee.label) : "?"}
                            </AvatarFallback>
                          </Avatar>
                          <span className="truncate font-medium text-slate-800">
                            {selectedAssignee?.label ?? "Choose a user"}
                          </span>
                        </span>
                        <ChevronDown data-icon="inline-end" className="ml-auto text-slate-400" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-[var(--radix-popover-trigger-width)] p-0"
                    >
                      <Command>
                        <CommandInput
                          placeholder="Search calendar users..."
                          disabled={isSubmitting}
                        />
                        <CommandList>
                          <CommandEmpty>
                            No users have calendar availability configured.
                          </CommandEmpty>
                          <CommandGroup heading="Calendar users">
                            {assigneeOptions.map((assignee) => (
                              <CommandItem
                                key={assignee.id}
                                value={`${assignee.label} ${assignee.email} ${assignee.id}`}
                                onSelect={() => {
                                  setAssignedToUserId(assignee.id)
                                  setAssigneePickerOpen(false)
                                  setSelectedSlotStartAt("")
                                  setFieldErrors((current) => ({
                                    ...current,
                                    assignedToUserId: undefined,
                                    slot: undefined,
                                  }))
                                }}
                                className="cursor-pointer gap-3 py-2.5"
                              >
                                <Avatar size="sm">
                                  {assignee.image ? (
                                    <AvatarImage
                                      src={assignee.image}
                                      alt={`${assignee.label} profile photo`}
                                    />
                                  ) : null}
                                  <AvatarFallback className="bg-blue-950 font-semibold text-white">
                                    {getInitials(assignee.label)}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                  <span className="truncate font-medium text-slate-900">
                                    {assignee.label}
                                  </span>
                                  <span className="truncate text-xs text-slate-500">
                                    {assignee.email}
                                  </span>
                                </span>
                                <Check
                                  className={cn(
                                    "text-blue-950",
                                    assignedToUserId === assignee.id
                                      ? "opacity-100"
                                      : "opacity-0",
                                  )}
                                />
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <FieldError>{fieldErrors.assignedToUserId}</FieldError>
                </Field>

                <Field
                  data-invalid={Boolean(fieldErrors.date)}
                  data-disabled={isSubmitting}
                  className="min-w-0 gap-2"
                >
                  <FieldLabel htmlFor="create-appointment-date">
                    Appointment date <span className="text-rose-500" aria-hidden="true">*</span>
                  </FieldLabel>
                  <DateTimeInput
                    id="create-appointment-date"
                    value={appointmentDateInput}
                    onValueChange={(value) => {
                      setAppointmentDateInput({ ...value, time: "" })
                      setSelectedSlotStartAt("")
                      setFieldErrors((current) => ({
                        ...current,
                        date: undefined,
                        slot: undefined,
                      }))
                    }}
                    disabled={isSubmitting}
                    hideTime
                    layout="joined"
                    timezone={tenantTimezone}
                    ariaInvalid={Boolean(fieldErrors.date)}
                  />
                  <FieldDescription>Choose the day to load open times.</FieldDescription>
                  <FieldError>{fieldErrors.date}</FieldError>
                </Field>
              </FieldGroup>

              <Field
                data-invalid={
                  Boolean(fieldErrors.slot) || slotsState.status === "error"
                }
                data-disabled={isSubmitting || slotsState.status !== "ready"}
                className="gap-2 border-t border-slate-200 pt-4 sm:max-w-[calc(50%-0.5rem)]"
              >
                <FieldLabel htmlFor="create-appointment-slot">
                  Available time <span className="text-rose-500" aria-hidden="true">*</span>
                </FieldLabel>
                <Select
                  value={selectedSlotStartAt}
                  onValueChange={(value) => {
                    setSelectedSlotStartAt(value)
                    setFieldErrors((current) => ({ ...current, slot: undefined }))
                  }}
                  disabled={
                    isSubmitting ||
                    slotsState.status !== "ready" ||
                    availableSlots.length === 0
                  }
                >
                  <SelectTrigger
                    id="create-appointment-slot"
                    aria-invalid={
                      Boolean(fieldErrors.slot) || slotsState.status === "error"
                    }
                    className="h-11 w-full rounded-xl border-slate-200 bg-slate-50/60 px-3 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
                  >
                    <SelectValue placeholder={slotPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {availableSlots.length > 0 ? (
                        availableSlots.map((slot) => (
                          <SelectItem key={slot.startAt} value={slot.startAt}>
                            {slot.startLabel} to {slot.endLabel}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="__NONE__" disabled>
                          No open times
                        </SelectItem>
                      )}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {slotsState.status === "loading" ? (
                  <FieldDescription className="flex items-center gap-2" aria-live="polite">
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                    Checking calendar availability...
                  </FieldDescription>
                ) : selectedSlot ? (
                  <FieldDescription>
                    {formatDateTimeForDisplay(selectedSlot.startAt, tenantTimezone)} to{" "}
                    {formatDateTimeForDisplay(selectedSlot.endAt, tenantTimezone)} ·{" "}
                    {formatSlotDurationLabel(slotsState.status === "ready"
                      ? slotsState.data.meetingDurationMinutes
                      : meetingDurationMinutes)}
                  </FieldDescription>
                ) : (
                  <FieldDescription>
                    Only times allowed by the account booking rules are shown.
                  </FieldDescription>
                )}
                <FieldError>
                  {fieldErrors.slot ??
                    (slotsState.status === "error" ? slotsState.message : undefined)}
                </FieldError>
              </Field>

              {slotsState.status === "ready" && unavailableSlots.length > 0 ? (
                <div className="flex flex-col gap-2 border-t border-slate-200 pt-4">
                  <p className="text-sm font-medium text-slate-800">Unavailable times</p>
                  <div className="flex flex-wrap gap-2">
                    {unavailableSlots.map((slot) => (
                      <span
                        key={slot.startAt}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500"
                      >
                        {slot.startLabel} to {slot.endLabel}
                        {slot.reason ? ` · ${slot.reason}` : ""}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        </div>

        <SheetFooter className="border-t border-slate-200 bg-slate-50/80 px-6 py-4 sm:flex-row sm:justify-end sm:px-7">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setOpen(false)
              resetForm()
            }}
            disabled={isSubmitting}
            className="border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void onSubmit()}
            disabled={isSubmitting}
            className="min-w-40 bg-blue-950 text-white shadow-sm hover:bg-blue-900"
          >
            {isSubmitting ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            ) : null}
            {isSubmitting ? "Creating..." : "Create appointment"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
