"use client"

import { isAxiosError } from "axios"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  DateTimeInput,
} from "@/components/ui/date-time-input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
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
  }>
  onCreated?: () => Promise<void> | void
  initialContact?: ContactSearchItem | null
  lockContact?: boolean
  triggerLabel?: string
}

type FieldErrors = Partial<
  Record<
    | "name"
    | "contactId"
    | "description"
    | "assignedToUserId"
    | "status"
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

const ALL_STATUS_VALUE = "ALL"

export function CreateTaskDialog({
  tenantId,
  tenantTimezone,
  statusOptions,
  assigneeOptions = [],
  onCreated,
  initialContact = null,
  lockContact = false,
  triggerLabel = "Create Task",
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
  const [statusConfigId, setStatusConfigId] = useState<string | undefined>(undefined)
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
    ? "Create a task already attached to this contact."
    : "Add a new task for this tenant."

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
    setStatusConfigId(undefined)
    setDueDateInput({ date: "", time: "" })
    setStartedAtInput(getDefaultStartedAtDraft())
    setReminderAtInput({ date: "", time: "" })
    setFieldErrors({})
  }

  const validate = () => {
    const nextErrors: FieldErrors = {}

    if (!name.trim()) {
      nextErrors.name = "Task name is required."
    }

    if (!selectedContact?.id) {
      nextErrors.contactId = "Contact is required."
    }

    if (!isDateTimeDraftEmpty(dueDateInput) && !isDateTimeDraftComplete(dueDateInput)) {
      nextErrors.dueDate = "Enter a valid due date and time."
    }

    if (isDateTimeDraftEmpty(startedAtInput)) {
      nextErrors.startedAt = "Start date and time are required."
    } else if (!isDateTimeDraftComplete(startedAtInput)) {
      nextErrors.startedAt = "Enter a valid start date and time."
    }

    if (!isDateTimeDraftEmpty(reminderAtInput) && !isDateTimeDraftComplete(reminderAtInput)) {
      nextErrors.reminderAt = "Enter a valid reminder date and time."
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

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) resetForm()
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          className="bg-blue-950 text-white hover:bg-blue-950/90"
        >
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Create Task</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-6">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <div className="grid gap-2">
              <Label htmlFor="create-task-name">Task Name</Label>
              <Input
                id="create-task-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Follow up on contract review"
              />
              {fieldErrors.name ? (
                <p className="text-xs text-rose-600">{fieldErrors.name}</p>
              ) : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="create-task-contact">Contact</Label>
              {lockContact && selectedContact ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="flex flex-col gap-1">
                    <Input
                      id="create-task-contact"
                      value={selectedContact.fullName}
                      readOnly
                      disabled
                      className="h-10 border-0 bg-transparent px-0 text-sm font-medium text-slate-950 shadow-none disabled:cursor-default disabled:opacity-100"
                    />
                    <p className="text-xs text-slate-500">
                      {selectedContact.email ?? selectedContact.phoneNumber ?? "Task will stay linked to this contact."}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <Command shouldFilter={false}>
                    <CommandInput
                      id="create-task-contact"
                      value={contactQuery}
                      onValueChange={(value) => {
                        if (lockContact) return

                        setContactQuery(value)
                        setFieldErrors((prev) => ({ ...prev, contactId: undefined }))

                        if (
                          !isSelectingContactRef.current &&
                          selectedContact &&
                          value !== selectedContact.fullName
                        ) {
                          setSelectedContact(null)
                        }
                      }}
                      placeholder="Search contact by name, email, or phone"
                      disabled={lockContact}
                    />
                    {!lockContact && contactQuery.trim().length >= 2 && !selectedContact ? (
                      <CommandList>
                        <CommandEmpty>
                          {isSearchingContacts ? "Searching contacts..." : "No contacts found."}
                        </CommandEmpty>
                        <CommandGroup>
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
                                setFieldErrors((prev) => ({
                                  ...prev,
                                  contactId: undefined,
                                }))
                                window.setTimeout(() => {
                                  isSelectingContactRef.current = false
                                }, 0)
                              }}
                            >
                              <div className="flex flex-col">
                                <span>{contact.fullName}</span>
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
              {fieldErrors.contactId ? (
                <p className="text-xs text-rose-600">{fieldErrors.contactId}</p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="create-task-assignee">Assignee</Label>
              <Select
                value={assignedToUserId}
                onValueChange={(value) => {
                  setAssignedToUserId(value)
                  setFieldErrors((prev) => ({ ...prev, assignedToUserId: undefined }))
                }}
                disabled={isSubmitting}
              >
                <SelectTrigger id="create-task-assignee" className="bg-white">
                  <SelectValue placeholder="Not assigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__UNASSIGNED__">Not assigned</SelectItem>
                  {assigneeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldErrors.assignedToUserId ? (
                <p className="text-xs text-rose-600">{fieldErrors.assignedToUserId}</p>
              ) : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="create-task-status">Status</Label>
              <TaskStatusSelect
                id="create-task-status"
                value={statusConfigId ?? "__none__"}
                onValueChange={(value) => {
                  setStatusConfigId(value === "__none__" ? undefined : value)
                  setFieldErrors((prev) => ({ ...prev, status: undefined }))
                }}
                options={selectableStatuses}
                disabled={isSubmitting}
                noneValue="__none__"
                noneLabel="No status"
              />
              {fieldErrors.status ? (
                <p className="text-xs text-rose-600">{fieldErrors.status}</p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="grid gap-2">
              <Label htmlFor="create-task-due-date">Due Date</Label>
              <DateTimeInput
                id="create-task-due-date"
                value={dueDateInput}
                onValueChange={setDueDateInput}
                disabled={isSubmitting}
                ariaInvalid={Boolean(fieldErrors.dueDate)}
                timezone={tenantTimezone}
                disabledDate={() => false}
              />
              {fieldErrors.dueDate ? (
                <p className="text-xs text-rose-600">{fieldErrors.dueDate}</p>
              ) : null}
            </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="grid gap-2">
              <Label htmlFor="create-task-started-at">Start Date</Label>
              <DateTimeInput
                id="create-task-started-at"
                value={startedAtInput}
                onValueChange={setStartedAtInput}
                disabled={isSubmitting}
                ariaInvalid={Boolean(fieldErrors.startedAt)}
                timezone={tenantTimezone}
                disabledDate={() => false}
              />
              {fieldErrors.startedAt ? (
                <p className="text-xs text-rose-600">{fieldErrors.startedAt}</p>
              ) : null}
            </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="grid gap-2">
              <Label htmlFor="create-task-reminder-at">Reminder Date</Label>
              <DateTimeInput
                id="create-task-reminder-at"
                value={reminderAtInput}
                onValueChange={setReminderAtInput}
                disabled={isSubmitting}
                ariaInvalid={Boolean(fieldErrors.reminderAt)}
                timezone={tenantTimezone}
                disabledDate={() => false}
              />
              {fieldErrors.reminderAt ? (
                <p className="text-xs text-rose-600">{fieldErrors.reminderAt}</p>
              ) : null}
            </div>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="create-task-description">Description</Label>
            <Textarea
              id="create-task-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional context for the assignee or team."
              rows={5}
            />
            {fieldErrors.description ? (
              <p className="text-xs text-rose-600">{fieldErrors.description}</p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="button" onClick={onSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create Task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
