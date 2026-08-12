"use client"

import { isAxiosError } from "axios"
import { Check, ChevronDown, Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
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
  triggerLabel?: string
  trigger?: ReactNode
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

type LinkedEntityOption = {
  id: string
  name: string
  type: "SERVICE" | "PRODUCT"
}

type LinkedEntityOptionsResponse = {
  ok: boolean
  items: LinkedEntityOption[]
}

const ALL_STATUS_VALUE = "ALL"

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
  triggerLabel = "Create Task",
  trigger,
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
  const [assignedToUserId, setAssignedToUserId] = useState<string>("__UNASSIGNED__")
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false)
  const [statusConfigId, setStatusConfigId] = useState<string | undefined>(undefined)
  const [linkedEntityType, setLinkedEntityType] = useState<"__none__" | "SERVICE" | "PRODUCT">(
    "__none__",
  )
  const [linkedEntityName, setLinkedEntityName] = useState("")
  const [linkedEntityOptions, setLinkedEntityOptions] = useState<LinkedEntityOption[]>([])
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
  const selectedAssignee = useMemo(
    () => assigneeOptions.find((option) => option.value === assignedToUserId) ?? null,
    [assignedToUserId, assigneeOptions],
  )
  const dialogDescription = lockContact
    ? "Create, assign, and schedule work already attached to this contact."
    : "Create, assign, and schedule work for a tenant contact."

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
    setAssignedToUserId("__UNASSIGNED__")
    setAssigneePickerOpen(false)
    setStatusConfigId(undefined)
    setLinkedEntityType("__none__")
    setLinkedEntityName("")
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

    if (
      (linkedEntityType === "__none__" && linkedEntityName.trim()) ||
      (linkedEntityType !== "__none__" && !linkedEntityName.trim())
    ) {
      nextErrors.linkedEntity = "Select a type and enter a matching name."
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
          assignedToUserId === "__UNASSIGNED__" ? null : assignedToUserId,
        statusConfigId: statusConfigId ?? null,
        linkedEntityName: linkedEntityName.trim() || null,
        linkedEntityType: linkedEntityType === "__none__" ? null : linkedEntityType,
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
            linkedEntity: "Select a type and enter a matching name.",
          }))
          toast.error("Service/Product information is incomplete.")
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
    if (!open) return

    let cancelled = false
    void (async () => {
      try {
        const { data } = await api.get<LinkedEntityOptionsResponse>(
          `/api/services-products/${tenantId}/options`,
          {
            params: { limit: 100 },
          },
        )
        if (!cancelled) {
          setLinkedEntityOptions(data.items)
        }
      } catch {
        if (!cancelled) {
          setLinkedEntityOptions([])
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, tenantId])

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
            Give the task a clear name, connect it to a contact, and add useful context.
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
              placeholder="Follow up on contract review"
              disabled={isSubmitting}
              aria-invalid={Boolean(fieldErrors.name)}
              className="h-11 rounded-xl border-slate-200 bg-slate-50/60 px-4 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
            />
            <FieldDescription>Use a short action your team can recognize quickly.</FieldDescription>
            <FieldError>{fieldErrors.name}</FieldError>
          </Field>

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
              placeholder="Add optional instructions, context, or expected next steps."
              rows={4}
              disabled={isSubmitting}
              aria-invalid={Boolean(fieldErrors.description)}
              className="min-h-28 resize-y rounded-xl border-slate-200 bg-slate-50/60 px-4 py-3 leading-6 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
            />
            <FieldDescription>Optional details for the assignee or team.</FieldDescription>
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
            <Popover open={assigneePickerOpen} onOpenChange={setAssigneePickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="create-task-assignee"
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
                        {selectedAssignee ? getInitials(selectedAssignee.label) : "—"}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate font-medium text-slate-800">
                      {selectedAssignee?.label ?? "Not assigned"}
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
                  <CommandInput placeholder="Search team members..." />
                  <CommandList>
                    <CommandEmpty>No team members found.</CommandEmpty>
                    <CommandGroup heading="Assignment">
                      <CommandItem
                        value="Not assigned unassigned"
                        onSelect={() => {
                          setAssignedToUserId("__UNASSIGNED__")
                          setAssigneePickerOpen(false)
                          setFieldErrors((current) => ({
                            ...current,
                            assignedToUserId: undefined,
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
                          Not assigned
                        </span>
                        <Check
                          className={
                            assignedToUserId === "__UNASSIGNED__"
                              ? "text-blue-800 opacity-100"
                              : "opacity-0"
                          }
                        />
                      </CommandItem>
                      {assigneeOptions.map((option) => (
                        <CommandItem
                          key={option.value}
                          value={`${option.label} ${option.email ?? ""} ${option.value}`}
                          onSelect={() => {
                            setAssignedToUserId(option.value)
                            setAssigneePickerOpen(false)
                            setFieldErrors((current) => ({
                              ...current,
                              assignedToUserId: undefined,
                            }))
                          }}
                          className="cursor-pointer gap-3 py-2.5"
                        >
                          <Avatar size="sm" className="ring-2 ring-blue-50">
                            {option.image ? (
                              <AvatarImage
                                src={option.image}
                                alt={`${option.label} profile photo`}
                              />
                            ) : null}
                            <AvatarFallback className="bg-blue-950 font-semibold text-white">
                              {getInitials(option.label)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate font-medium text-slate-900">
                              {option.label}
                            </span>
                            {option.email ? (
                              <span className="truncate text-xs text-slate-500">
                                {option.email}
                              </span>
                            ) : null}
                          </span>
                          <Check
                            className={
                              assignedToUserId === option.value
                                ? "text-blue-800 opacity-100"
                                : "opacity-0"
                            }
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
            Connect a service or product
          </h3>
          <p className="text-sm leading-6 text-slate-600">
            Optionally associate this task with an item from the tenant catalog.
          </p>
        </div>

        <Field
          data-invalid={Boolean(fieldErrors.linkedEntity)}
          data-disabled={isSubmitting}
          className="gap-3"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <FieldLabel htmlFor="create-task-linked-type">Item type</FieldLabel>
              <Select
                value={linkedEntityType}
                onValueChange={(value) => {
                  setLinkedEntityType(value as "__none__" | "SERVICE" | "PRODUCT")
                  setFieldErrors((current) => ({
                    ...current,
                    linkedEntity: undefined,
                  }))
                }}
                disabled={isSubmitting}
              >
                <SelectTrigger
                  id="create-task-linked-type"
                  aria-invalid={Boolean(fieldErrors.linkedEntity)}
                  className="h-11 w-full rounded-xl border-slate-200 bg-slate-50/60 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
                >
                  <SelectValue placeholder="No linked item" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="__none__">No linked item</SelectItem>
                    <SelectItem value="SERVICE">Service</SelectItem>
                    <SelectItem value="PRODUCT">Product</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <FieldLabel htmlFor="create-task-linked-name">Item name</FieldLabel>
              <Input
                id="create-task-linked-name"
                value={linkedEntityName}
                onChange={(event) => {
                  setLinkedEntityName(event.target.value)
                  setFieldErrors((current) => ({
                    ...current,
                    linkedEntity: undefined,
                  }))
                }}
                placeholder="Type or select from catalog"
                list="create-task-linked-name-options"
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldErrors.linkedEntity)}
                className="h-11 rounded-xl border-slate-200 bg-slate-50/60 px-4 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
              />
              <datalist id="create-task-linked-name-options">
                {linkedEntityOptions
                  .filter(
                    (option) =>
                      linkedEntityType === "__none__" || option.type === linkedEntityType,
                  )
                  .map((option) => (
                    <option key={option.id} value={option.name} />
                  ))}
              </datalist>
            </div>
          </div>
          <FieldDescription>Select both a type and matching name, or leave both empty.</FieldDescription>
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

        <FieldGroup className="grid gap-x-4 gap-y-4 md:grid-cols-2">
          <Field
            data-invalid={Boolean(fieldErrors.startedAt)}
            data-disabled={isSubmitting}
            className="min-w-0 gap-2 md:pr-4"
          >
            <FieldLabel htmlFor="create-task-started-at" className="justify-between gap-2">
              Start date
              <span className="text-[11px] font-medium text-blue-700">Required</span>
            </FieldLabel>
            <DateTimeInput
              id="create-task-started-at"
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
            />
            <FieldError>{fieldErrors.startedAt}</FieldError>
          </Field>

          <Field
            data-invalid={Boolean(fieldErrors.dueDate)}
            data-disabled={isSubmitting}
            className="min-w-0 gap-2 border-t border-slate-200 pt-3 md:border-t-0 md:border-l md:pt-0 md:pl-4"
          >
            <FieldLabel htmlFor="create-task-due-date" className="justify-between gap-2">
              Due date
              <span className="text-[11px] font-normal text-slate-500">Optional</span>
            </FieldLabel>
            <DateTimeInput
              id="create-task-due-date"
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
            />
            <FieldError>{fieldErrors.dueDate}</FieldError>
          </Field>

          <Field
            data-invalid={Boolean(fieldErrors.reminderAt)}
            data-disabled={isSubmitting}
            className="min-w-0 gap-2 border-t border-slate-200 pt-4 md:col-span-2 md:max-w-[calc(50%-0.5rem)]"
          >
            <FieldLabel htmlFor="create-task-reminder-at" className="justify-between gap-2">
              Reminder
              <span className="text-[11px] font-normal text-slate-500">Optional</span>
            </FieldLabel>
            <DateTimeInput
              id="create-task-reminder-at"
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
            />
            <FieldError>{fieldErrors.reminderAt}</FieldError>
          </Field>
        </FieldGroup>
      </section>
    </div>
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
      <SheetTrigger asChild>
        {trigger ?? (
          <Button
            type="button"
            className="bg-blue-950 text-white hover:bg-blue-900"
          >
            {triggerLabel}
          </Button>
        )}
      </SheetTrigger>
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
