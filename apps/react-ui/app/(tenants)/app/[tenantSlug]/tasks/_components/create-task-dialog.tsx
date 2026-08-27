"use client"

import { isAxiosError } from "axios"
import { Check, ChevronDown, Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { DateTimeInput } from "@/components/ui/date-time-input"
import { parseDateInput } from "@/components/ui/date-input"
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
import {
  type DateTimeDraft,
  dateTimeDraftToUtcIso,
  formatUtcIsoToDateTimeDraft,
  isDateTimeDraftComplete,
  isDateTimeDraftEmpty,
} from "@/lib/date-time"
import {
  TaskStatusSelect,
  type TaskStatusOption,
} from "./task-status-select"
import {
  TaskAssigneeInput,
  UNASSIGNED_TASK_VALUE,
} from "./task-assignee-input"

type CreateTaskDialogProps = {
  tenantId: string
  tenantTimezone?: string | null
  statusOptions: TaskStatusOption[]
  assigneeOptions?: Array<{
    label: string
    value: string
    email?: string
    image?: string | null
  }>
  onCreated?: () => Promise<void> | void
  initialContact?: ContactSearchItem | null
  lockContact?: boolean
  hideContact?: boolean
  triggerLabel?: string
  trigger?: ReactNode
  triggerTooltip?: string
}

type FieldErrors = Partial<
  Record<
    | "name"
    | "contactId"
    | "description"
    | "assignedToUserId"
    | "status"
    | "linkedEntity"
    | "dueDate"
    | "startedAt"
    | "reminderAt",
    string
  >
>

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

type LinkedServiceOption = {
  id: string
  name: string
  type: "SERVICE"
}

type LinkedServiceOptionsResponse = {
  ok: boolean
  items: LinkedServiceOption[]
}

const ALL_STATUS_VALUE = "ALL"
const SERVICE_SEARCH_LIMIT = 5
const SERVICE_SEARCH_DEBOUNCE_MS = 250

function sanitizeServiceSearchInput(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .replace(/^\s+/, "")
    .slice(0, 120)
}

function getInitials(name: string) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")

  return initials || "?"
}

function getDateKey(date: Date) {
  return date.getFullYear() * 10_000 + (date.getMonth() + 1) * 100 + date.getDate()
}

function getDraftDateKey(value: DateTimeDraft) {
  const date = parseDateInput(value.date)
  return date ? getDateKey(date) : null
}

function getDraftTimestamp(value: DateTimeDraft, timezone?: string | null) {
  if (!isDateTimeDraftComplete(value) || !parseDateInput(value.date)) return null

  const utcIso = dateTimeDraftToUtcIso(value, timezone)
  if (!utcIso) return null

  const timestamp = Date.parse(utcIso)
  return Number.isNaN(timestamp) ? null : timestamp
}

export function CreateTaskDialog({
  tenantId,
  tenantTimezone,
  statusOptions,
  assigneeOptions = [],
  onCreated,
  initialContact = null,
  lockContact = false,
  hideContact = false,
  triggerLabel = "Create Task",
  trigger,
  triggerTooltip,
}: CreateTaskDialogProps) {
  const router = useRouter()
  const getDefaultStartedAtDraft = useCallback(
    () => formatUtcIsoToDateTimeDraft(new Date().toISOString(), tenantTimezone),
    [tenantTimezone],
  )
  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [contactQuery, setContactQuery] = useState(initialContact?.fullName ?? "")
  const [debouncedContactQuery, setDebouncedContactQuery] = useState("")
  const [selectedContact, setSelectedContact] = useState<ContactSearchItem | null>(
    initialContact,
  )
  const [contactResults, setContactResults] = useState<ContactSearchItem[]>([])
  const [isSearchingContacts, setIsSearchingContacts] = useState(false)
  const [assignedToUserId, setAssignedToUserId] = useState<string>(
    UNASSIGNED_TASK_VALUE,
  )
  const [statusConfigId, setStatusConfigId] = useState<string | undefined>(undefined)
  const [selectedLinkedService, setSelectedLinkedService] =
    useState<LinkedServiceOption | null>(null)
  const [servicePickerOpen, setServicePickerOpen] = useState(false)
  const [serviceQuery, setServiceQuery] = useState("")
  const [debouncedServiceQuery, setDebouncedServiceQuery] = useState("")
  const [linkedServiceOptions, setLinkedServiceOptions] = useState<LinkedServiceOption[]>([])
  const [isSearchingServices, setIsSearchingServices] = useState(false)
  const [dueDateInput, setDueDateInput] = useState<DateTimeDraft>({ date: "", time: "" })
  const [startedAtInput, setStartedAtInput] = useState<DateTimeDraft>({ date: "", time: "" })
  const [reminderAtInput, setReminderAtInput] = useState<DateTimeDraft>({
    date: "",
    time: "",
  })
  const isSelectingContactRef = useRef(false)

  const selectableStatuses = useMemo(
    () => statusOptions.filter((option) => option.value !== ALL_STATUS_VALUE),
    [statusOptions],
  )
  const dialogDescription = lockContact
    ? "Create, assign, and schedule work already attached to this contact."
    : "Create, assign, and schedule work for a tenant contact."
  const shouldHideContact = hideContact && Boolean(initialContact)

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedContactQuery(contactQuery.trim())
    }, 250)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [contactQuery])

  useEffect(() => {
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
        const { data } = await api.get<ContactSearchResponse>(
          `/api/contacts/${tenantId}/search`,
          {
            params: { q: query },
          },
        )

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
  }, [debouncedContactQuery, selectedContact, tenantId])

  const resetForm = () => {
    setName("")
    setDescription("")
    setContactQuery(initialContact?.fullName ?? "")
    setDebouncedContactQuery("")
    setSelectedContact(initialContact)
    setContactResults([])
    setAssignedToUserId(UNASSIGNED_TASK_VALUE)
    setStatusConfigId(undefined)
    setSelectedLinkedService(null)
    setServicePickerOpen(false)
    setServiceQuery("")
    setDebouncedServiceQuery("")
    setLinkedServiceOptions([])
    setIsSearchingServices(false)
    setDueDateInput({ date: "", time: "" })
    setStartedAtInput(getDefaultStartedAtDraft())
    setReminderAtInput({ date: "", time: "" })
    setFieldErrors({})
  }

  const validate = () => {
    const nextErrors: FieldErrors = {}
    const dueDateIsEmpty = isDateTimeDraftEmpty(dueDateInput)
    const reminderIsEmpty = isDateTimeDraftEmpty(reminderAtInput)
    const startedAtTimestamp = getDraftTimestamp(startedAtInput, tenantTimezone)
    const dueDateTimestamp = getDraftTimestamp(dueDateInput, tenantTimezone)
    const reminderTimestamp = getDraftTimestamp(reminderAtInput, tenantTimezone)

    if (!name.trim()) {
      nextErrors.name = "Task name is required."
    }

    if (!selectedContact?.id) {
      nextErrors.contactId = "Contact is required."
    }

    if (!dueDateIsEmpty && dueDateTimestamp === null) {
      nextErrors.dueDate = "Enter a valid due date and time."
    }

    if (isDateTimeDraftEmpty(startedAtInput)) {
      nextErrors.startedAt = "Start date and time are required."
    } else if (startedAtTimestamp === null) {
      nextErrors.startedAt = "Enter a valid start date and time."
    }

    if (!reminderIsEmpty && reminderTimestamp === null) {
      nextErrors.reminderAt = "Enter a valid reminder date and time."
    }

    if (
      startedAtTimestamp !== null &&
      dueDateTimestamp !== null &&
      dueDateTimestamp < startedAtTimestamp
    ) {
      nextErrors.dueDate = "Due date cannot be before the start date."
    }

    if (!reminderIsEmpty && reminderTimestamp !== null) {
      if (dueDateIsEmpty) {
        nextErrors.dueDate = "Set a due date before adding a reminder."
      } else if (
        startedAtTimestamp !== null &&
        dueDateTimestamp !== null &&
        dueDateTimestamp >= startedAtTimestamp &&
        (reminderTimestamp < startedAtTimestamp || reminderTimestamp > dueDateTimestamp)
      ) {
        nextErrors.reminderAt = "Reminder must be between the start and due dates."
      }
    }

    setFieldErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const onSubmit = async () => {
    if (!validate()) return

    setIsSubmitting(true)
    try {
      const dueDate = isDateTimeDraftEmpty(dueDateInput)
        ? null
        : dateTimeDraftToUtcIso(dueDateInput, tenantTimezone)
      const startedAt = dateTimeDraftToUtcIso(startedAtInput, tenantTimezone)
      const reminderAt = isDateTimeDraftEmpty(reminderAtInput)
        ? null
        : dateTimeDraftToUtcIso(reminderAtInput, tenantTimezone)

      await api.post(`/api/tasks/${tenantId}`, {
        name: name.trim(),
        contactId: selectedContact?.id,
        description: description.trim() || null,
        assignedToUserId:
          assignedToUserId === UNASSIGNED_TASK_VALUE ? null : assignedToUserId,
        statusConfigId: statusConfigId ?? null,
        linkedEntityName: selectedLinkedService?.name ?? null,
        linkedEntityType: selectedLinkedService ? "SERVICE" : null,
        dueDate,
        startedAt,
        reminderAt,
      })

      toast.success("Task created.")
      if (onCreated) {
        await onCreated()
      } else {
        router.refresh()
      }
      setOpen(false)
      resetForm()
    } catch (error) {
      if (isAxiosError(error)) {
        const responseData = error.response?.data as
          | { error?: string; details?: Array<{ path?: string; message?: string }> }
          | undefined

        if (Array.isArray(responseData?.details)) {
          const mappedErrors: FieldErrors = {}

          for (const detail of responseData.details) {
            if (detail.path === "name" && detail.message) {
              mappedErrors.name = detail.message
            }
            if (detail.path === "contactId" && detail.message) {
              mappedErrors.contactId = detail.message
            }
            if (detail.path === "description" && detail.message) {
              mappedErrors.description = detail.message
            }
            if (detail.path === "assignedToUserId" && detail.message) {
              mappedErrors.assignedToUserId = detail.message
            }
            if (detail.path === "dueDate" && detail.message) {
              mappedErrors.dueDate = detail.message
            }
            if (detail.path === "startedAt" && detail.message) {
              mappedErrors.startedAt = detail.message
            }
            if (detail.path === "reminderAt" && detail.message) {
              mappedErrors.reminderAt = detail.message
            }
          }

          if (Object.keys(mappedErrors).length) {
            setFieldErrors(mappedErrors)
          }
        }

        const backendError = responseData?.error
        if (backendError === "INVALID_STATUS_CONFIG") {
          setFieldErrors((prev) => ({
            ...prev,
            status: "Selected status is invalid for this tenant.",
          }))
          toast.error("Selected status is invalid for this tenant.")
        } else if (backendError === "INVALID_ASSIGNEE") {
          setFieldErrors((prev) => ({
            ...prev,
            assignedToUserId: "Selected assignee is invalid for this tenant.",
          }))
          toast.error("Selected assignee is invalid for this tenant.")
        } else if (backendError === "INVALID_CONTACT") {
          setFieldErrors((prev) => ({
            ...prev,
            contactId: "Selected contact is invalid for this tenant.",
          }))
          toast.error("Selected contact is invalid for this tenant.")
        } else if (
          backendError === "LINKED_ENTITY_NAME_REQUIRED" ||
          backendError === "LINKED_ENTITY_TYPE_REQUIRED"
        ) {
          setFieldErrors((prev) => ({
            ...prev,
            linkedEntity: "Select a service or leave this field empty.",
          }))
          toast.error("Service information is incomplete.")
        } else if (typeof backendError === "string") {
          toast.error(backendError.replace(/_/g, " "))
        } else {
          toast.error("Could not create task.")
        }
      } else {
        toast.error("Could not create task.")
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  useEffect(() => {
    setSelectedContact(initialContact)
    setContactQuery(initialContact?.fullName ?? "")
  }, [initialContact])

  useEffect(() => {
    if (!open) return
    if (!isDateTimeDraftEmpty(startedAtInput)) return

    setStartedAtInput(getDefaultStartedAtDraft())
  }, [getDefaultStartedAtDraft, open, startedAtInput])

  useEffect(() => {
    if (!servicePickerOpen) return

    const timeout = window.setTimeout(() => {
      setDebouncedServiceQuery(sanitizeServiceSearchInput(serviceQuery).trim())
    }, SERVICE_SEARCH_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [servicePickerOpen, serviceQuery])

  useEffect(() => {
    if (!servicePickerOpen) return

    let cancelled = false
    void (async () => {
      setIsSearchingServices(true)

      try {
        const { data } = await api.get<LinkedServiceOptionsResponse>(
          `/api/services-products/${tenantId}/options`,
          {
            params: {
              q: debouncedServiceQuery || undefined,
              type: "SERVICE",
              limit: SERVICE_SEARCH_LIMIT,
            },
          },
        )
        if (!cancelled) {
          setLinkedServiceOptions(data.items.slice(0, SERVICE_SEARCH_LIMIT))
        }
      } catch {
        if (!cancelled) {
          setLinkedServiceOptions([])
        }
      } finally {
        if (!cancelled) {
          setIsSearchingServices(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [debouncedServiceQuery, servicePickerOpen, tenantId])

  const startDateKey = getDraftDateKey(startedAtInput)
  const dueDateKey = getDraftDateKey(dueDateInput)

  const formContent = (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-blue-700">
            Task details
          </p>
          <h3 className="text-base font-semibold text-slate-950">
            What needs to happen?
          </h3>
          <p className="text-sm leading-6 text-slate-600">
            {shouldHideContact
              ? "Give the task a clear name and add the context your team needs."
              : "Give the task a clear name, connect it to a contact, and add useful context."}
          </p>
        </div>

        <FieldGroup className="gap-5">
          <Field
            data-invalid={Boolean(fieldErrors.name)}
            data-disabled={isSubmitting}
            className="gap-2"
          >
            <FieldLabel htmlFor="create-task-name">Task name</FieldLabel>
            <Input
              id="create-task-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setFieldErrors((current) => ({ ...current, name: undefined }))
              }}
              disabled={isSubmitting}
              aria-invalid={Boolean(fieldErrors.name)}
              className="h-11 rounded-xl border-slate-200 bg-slate-50/60 px-4 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
            />
            <FieldError>{fieldErrors.name}</FieldError>
          </Field>

          {!shouldHideContact ? (
            <Field
              data-invalid={Boolean(fieldErrors.contactId)}
              data-disabled={isSubmitting}
              className="gap-2"
            >
            <FieldLabel htmlFor="create-task-contact">Contact</FieldLabel>
            {lockContact && selectedContact ? (
              <div
                id="create-task-contact"
                className="flex flex-col gap-1 border-l-2 border-blue-200 py-1 pl-3"
              >
                <p className="text-sm font-semibold text-slate-950">
                  {selectedContact.fullName}
                </p>
                <p className="text-xs leading-5 text-slate-600">
                  {selectedContact.email ??
                    selectedContact.phoneNumber ??
                    "This task will stay linked to the current contact."}
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm focus-within:border-blue-400 focus-within:ring-3 focus-within:ring-blue-100">
                <Command shouldFilter={false}>
                  <CommandInput
                    id="create-task-contact"
                    value={contactQuery}
                    onValueChange={(value) => {
                      setContactQuery(value)
                      setFieldErrors((current) => ({
                        ...current,
                        contactId: undefined,
                      }))

                      if (
                        !isSelectingContactRef.current &&
                        selectedContact &&
                        value !== selectedContact.fullName
                      ) {
                        setSelectedContact(null)
                      }
                    }}
                    placeholder="Search by name, email, or phone"
                    disabled={isSubmitting}
                    aria-invalid={Boolean(fieldErrors.contactId)}
                  />
                  {contactQuery.trim().length >= 2 && !selectedContact ? (
                    <CommandList>
                      <CommandEmpty>
                        {isSearchingContacts ? "Searching contacts..." : "No contacts found."}
                      </CommandEmpty>
                      <CommandGroup heading="Contacts">
                        {contactResults.map((contact) => (
                          <CommandItem
                            key={contact.id}
                            value={contact.id}
                            onSelect={() => {
                              isSelectingContactRef.current = true
                              setSelectedContact(contact)
                              setContactQuery(contact.fullName)
                              setDebouncedContactQuery(contact.fullName)
                              setContactResults([])
                              setFieldErrors((current) => ({
                                ...current,
                                contactId: undefined,
                              }))
                              window.setTimeout(() => {
                                isSelectingContactRef.current = false
                              }, 0)
                            }}
                            className="cursor-pointer"
                          >
                            <div className="flex flex-col gap-0.5">
                              <span className="font-medium">{contact.fullName}</span>
                              <span className="text-xs text-slate-500">
                                {contact.email ?? contact.phoneNumber ?? "No extra details"}
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
              {lockContact
                ? "The contact is fixed for this task."
                : "Type at least two characters to find a contact."}
            </FieldDescription>
            <FieldError>{fieldErrors.contactId}</FieldError>
            </Field>
          ) : null}

          <Field
            data-invalid={Boolean(fieldErrors.description)}
            data-disabled={isSubmitting}
            className="gap-2"
          >
            <FieldLabel htmlFor="create-task-description">Description</FieldLabel>
            <Textarea
              id="create-task-description"
              value={description}
              onChange={(event) => {
                setDescription(event.target.value)
                setFieldErrors((current) => ({
                  ...current,
                  description: undefined,
                }))
              }}
              rows={4}
              disabled={isSubmitting}
              aria-invalid={Boolean(fieldErrors.description)}
              className="min-h-28 resize-y rounded-xl border-slate-200 bg-slate-50/60 px-4 py-3 leading-6 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
            />
            <FieldError>{fieldErrors.description}</FieldError>
          </Field>
        </FieldGroup>
      </section>

      <section className="flex flex-col gap-4 border-t border-slate-200 pt-6">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-blue-700">
            Ownership
          </p>
          <h3 className="text-base font-semibold text-slate-950">Assign and track</h3>
          <p className="text-sm leading-6 text-slate-600">
            Choose who owns the work and how it should appear in the task flow.
          </p>
        </div>

        <FieldGroup className="gap-4 sm:grid sm:grid-cols-[minmax(0,1.35fr)_minmax(0,0.85fr)]">
          <Field
            data-invalid={Boolean(fieldErrors.assignedToUserId)}
            data-disabled={isSubmitting}
            className="gap-2"
          >
            <FieldLabel htmlFor="create-task-assignee">Assignee</FieldLabel>
            <TaskAssigneeInput
              id="create-task-assignee"
              value={assignedToUserId}
              onValueChange={(value) => {
                setAssignedToUserId(value)
                setFieldErrors((current) => ({
                  ...current,
                  assignedToUserId: undefined,
                }))
              }}
              options={assigneeOptions}
              disabled={isSubmitting}
              ariaInvalid={Boolean(fieldErrors.assignedToUserId)}
            />
            <FieldError>{fieldErrors.assignedToUserId}</FieldError>
          </Field>

          <Field
            data-invalid={Boolean(fieldErrors.status)}
            data-disabled={isSubmitting}
            className="gap-2"
          >
            <FieldLabel htmlFor="create-task-status">Status</FieldLabel>
            <TaskStatusSelect
              id="create-task-status"
              value={statusConfigId ?? "__none__"}
              onValueChange={(value) => {
                setStatusConfigId(value === "__none__" ? undefined : value)
                setFieldErrors((current) => ({ ...current, status: undefined }))
              }}
              options={selectableStatuses}
              disabled={isSubmitting}
              ariaInvalid={Boolean(fieldErrors.status)}
              noneValue="__none__"
              noneLabel="No status"
              triggerClassName="bg-white"
            />
            <FieldError>{fieldErrors.status}</FieldError>
          </Field>
        </FieldGroup>
      </section>

      <section className="flex flex-col gap-4 border-t border-slate-200 pt-6">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-blue-700">
            Related work
          </p>
          <h3 className="text-base font-semibold text-slate-950">
            Connect a service
          </h3>
          <p className="text-sm leading-6 text-slate-600">
            Optionally associate this task with a service from the tenant catalog.
          </p>
        </div>

        <Field
          data-invalid={Boolean(fieldErrors.linkedEntity)}
          data-disabled={isSubmitting}
          className="gap-2"
        >
          <FieldLabel htmlFor="create-task-linked-service">
            Service <span className="font-normal text-slate-500">(optional)</span>
          </FieldLabel>
          <Popover
            open={servicePickerOpen}
            onOpenChange={(nextOpen) => {
              setServicePickerOpen(nextOpen)
              if (!nextOpen) {
                setServiceQuery("")
                setDebouncedServiceQuery("")
              }
            }}
          >
            <PopoverTrigger asChild>
              <Button
                id="create-task-linked-service"
                type="button"
                variant="outline"
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldErrors.linkedEntity)}
                aria-expanded={servicePickerOpen}
                className="h-11 w-full justify-between rounded-xl border-blue-100 bg-white px-3 shadow-none hover:bg-white focus-visible:border-blue-400 focus-visible:ring-blue-100"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <Avatar size="sm" className="ring-2 ring-blue-50">
                    <AvatarFallback className="bg-blue-50 font-semibold text-blue-950">
                      {selectedLinkedService
                        ? getInitials(selectedLinkedService.name)
                        : "—"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate font-medium text-slate-800">
                    {selectedLinkedService?.name ?? "No linked service"}
                  </span>
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
                  value={serviceQuery}
                  onValueChange={(value) => {
                    setServiceQuery(sanitizeServiceSearchInput(value))
                    setFieldErrors((current) => ({
                      ...current,
                      linkedEntity: undefined,
                    }))
                  }}
                  placeholder="Search services..."
                  disabled={isSubmitting}
                />
                <CommandList>
                  <CommandGroup heading="Services">
                    <CommandItem
                      value="No linked service"
                      onSelect={() => {
                        setSelectedLinkedService(null)
                        setServicePickerOpen(false)
                        setServiceQuery("")
                        setDebouncedServiceQuery("")
                        setFieldErrors((current) => ({
                          ...current,
                          linkedEntity: undefined,
                        }))
                      }}
                      className="cursor-pointer gap-3 py-2.5"
                    >
                      <Avatar size="sm">
                        <AvatarFallback className="bg-slate-100 font-semibold text-slate-500">
                          —
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1 font-medium text-slate-700">
                        No linked service
                      </span>
                      <Check
                        className={
                          selectedLinkedService === null
                            ? "text-blue-800 opacity-100"
                            : "opacity-0"
                        }
                      />
                    </CommandItem>

                    {isSearchingServices ||
                    serviceQuery.trim() !== debouncedServiceQuery ? (
                      <CommandItem value="Searching services" disabled>
                        <Loader2 className="animate-spin" />
                        Searching services...
                      </CommandItem>
                    ) : linkedServiceOptions.length > 0 ? (
                      linkedServiceOptions.map((service) => (
                        <CommandItem
                          key={service.id}
                          value={service.id}
                          onSelect={() => {
                            setSelectedLinkedService(service)
                            setServicePickerOpen(false)
                            setServiceQuery("")
                            setDebouncedServiceQuery("")
                            setFieldErrors((current) => ({
                              ...current,
                              linkedEntity: undefined,
                            }))
                          }}
                          className="cursor-pointer gap-3 py-2.5"
                        >
                          <Avatar size="sm" className="ring-2 ring-blue-50">
                            <AvatarFallback className="bg-blue-50 font-semibold text-blue-950">
                              {getInitials(service.name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="min-w-0 flex-1 truncate font-medium text-slate-900">
                            {service.name}
                          </span>
                          <Check
                            className={
                              selectedLinkedService?.id === service.id
                                ? "text-blue-800 opacity-100"
                                : "opacity-0"
                            }
                          />
                        </CommandItem>
                      ))
                    ) : (
                      <CommandItem value="No services found" disabled>
                        No services found.
                      </CommandItem>
                    )}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <FieldDescription>
            Search active services; up to five matches are shown.
          </FieldDescription>
          <FieldError>{fieldErrors.linkedEntity}</FieldError>
        </Field>
      </section>

      <section className="flex flex-col gap-4 border-t border-slate-200 pt-6">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-blue-700">
            Schedule
          </p>
          <h3 className="text-base font-semibold text-slate-950">Set the timeline</h3>
          <p className="text-sm leading-6 text-slate-600">
            Start defines when work begins. Due must be at or after Start, and Reminder
            must fall between them.
          </p>
        </div>

        <FieldGroup className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
          <Field
            data-invalid={Boolean(fieldErrors.startedAt)}
            data-disabled={isSubmitting}
            className="min-w-0 gap-2"
          >
            <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(7.5rem,0.8fr)] gap-0">
              <FieldLabel htmlFor="create-task-started-at">
                Start date <span className="text-rose-500" aria-hidden="true">*</span>
              </FieldLabel>
              <FieldLabel htmlFor="create-task-started-at-time">
                Time <span className="text-rose-500" aria-hidden="true">*</span>
              </FieldLabel>
            </div>
            <DateTimeInput
              id="create-task-started-at"
              timeId="create-task-started-at-time"
              value={startedAtInput}
              onValueChange={(value) => {
                setStartedAtInput(value)
                setFieldErrors((current) => ({
                  ...current,
                  startedAt: undefined,
                  dueDate: undefined,
                  reminderAt: undefined,
                }))
              }}
              disabled={isSubmitting}
              ariaInvalid={Boolean(fieldErrors.startedAt)}
              timezone={tenantTimezone}
              disabledDate={() => false}
              layout="joined"
            />
            <FieldError>{fieldErrors.startedAt}</FieldError>
          </Field>

          <Field
            data-invalid={Boolean(fieldErrors.dueDate)}
            data-disabled={isSubmitting}
            className="min-w-0 gap-2"
          >
            <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(7.5rem,0.8fr)] gap-0">
              <FieldLabel htmlFor="create-task-due-date">
                Due date
                <span className="text-xs font-normal text-slate-500">Optional</span>
              </FieldLabel>
              <FieldLabel htmlFor="create-task-due-date-time">Time</FieldLabel>
            </div>
            <DateTimeInput
              id="create-task-due-date"
              timeId="create-task-due-date-time"
              value={dueDateInput}
              onValueChange={(value) => {
                setDueDateInput(value)
                setFieldErrors((current) => ({
                  ...current,
                  dueDate: undefined,
                  reminderAt: undefined,
                }))
              }}
              disabled={isSubmitting}
              ariaInvalid={Boolean(fieldErrors.dueDate)}
              timezone={tenantTimezone}
              disabledDate={(date) =>
                startDateKey !== null && getDateKey(date) < startDateKey
              }
              layout="joined"
            />
            <FieldError>{fieldErrors.dueDate}</FieldError>
          </Field>

          <Field
            data-invalid={Boolean(fieldErrors.reminderAt)}
            data-disabled={isSubmitting}
            className="min-w-0 gap-2 border-t border-slate-200 pt-4 sm:col-span-2 sm:max-w-[calc(50%-0.5rem)]"
          >
            <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(7.5rem,0.8fr)] gap-0">
              <FieldLabel htmlFor="create-task-reminder-at">
                Reminder date
                <span className="text-xs font-normal text-slate-500">Optional</span>
              </FieldLabel>
              <FieldLabel htmlFor="create-task-reminder-at-time">Time</FieldLabel>
            </div>
            <DateTimeInput
              id="create-task-reminder-at"
              timeId="create-task-reminder-at-time"
              value={reminderAtInput}
              onValueChange={(value) => {
                setReminderAtInput(value)
                setFieldErrors((current) => ({ ...current, reminderAt: undefined }))
              }}
              disabled={isSubmitting}
              ariaInvalid={Boolean(fieldErrors.reminderAt)}
              timezone={tenantTimezone}
              disabledDate={(date) => {
                const dateKey = getDateKey(date)
                return (
                  (startDateKey !== null && dateKey < startDateKey) ||
                  (dueDateKey !== null && dateKey > dueDateKey)
                )
              }}
              layout="joined"
            />
            <FieldError>{fieldErrors.reminderAt}</FieldError>
          </Field>
        </FieldGroup>
      </section>
    </div>
  )

  const triggerNode = trigger ?? (
    <Button
      type="button"
      className="bg-blue-950 text-white hover:bg-blue-900"
    >
      {triggerLabel}
    </Button>
  )

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isSubmitting) return
        setOpen(nextOpen)
        if (!nextOpen) resetForm()
      }}
    >
      {triggerTooltip ? (
        <TooltipProvider delayDuration={120}>
          <Tooltip>
            <TooltipTrigger asChild>
              <SheetTrigger asChild>{triggerNode}</SheetTrigger>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>
              {triggerTooltip}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <SheetTrigger asChild>{triggerNode}</SheetTrigger>
      )}
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
              <p className="text-xs font-semibold text-blue-700">
                Task workflow
              </p>
              <SheetTitle className="text-xl font-semibold text-slate-950 sm:text-2xl">
                Create task
              </SheetTitle>
              <SheetDescription className="max-w-xl text-sm leading-6 text-slate-600">
                {dialogDescription}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6 [scrollbar-gutter:stable] sm:px-7">
          {formContent}
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
            className="min-w-32 bg-blue-950 text-white shadow-sm hover:bg-blue-900"
          >
            {isSubmitting ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : null}
            {isSubmitting ? "Creating..." : "Create task"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
