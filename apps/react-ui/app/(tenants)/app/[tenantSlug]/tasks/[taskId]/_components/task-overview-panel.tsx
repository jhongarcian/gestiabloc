"use client"

import { isAxiosError } from "axios"
import { Loader2 } from "lucide-react"
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DateTimeInput } from "@/components/ui/date-time-input"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
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
  TaskAssigneeInput,
  type TaskAssigneeOption,
  UNASSIGNED_TASK_VALUE,
} from "../../_components/task-assignee-input"
import {
  TaskStatusSelect,
  type TaskStatusOption,
} from "../../_components/task-status-select"

type TaskServiceOption = {
  id: string
  name: string
}

type TaskOverviewFormProps = {
  tenantId: string
  tenantTimezone?: string | null
  taskId: string
  initialTask: {
    name: string
    description: string | null
    assignedToUserId: string | null
    priority: "HIGH" | "MEDIUM" | "LOW" | null
    dueDate: string | null
    startedAt: string | null
    statusConfigId: string | null
    linkedEntityName: string | null
    linkedEntityType: "SERVICE" | "PRODUCT" | null
  }
  statusOptions: TaskStatusOption[]
  assigneeOptions: TaskAssigneeOption[]
  serviceOptions: TaskServiceOption[]
}

type FieldErrors = Partial<
  Record<
    | "name"
    | "description"
    | "assignedToUserId"
    | "status"
    | "linkedEntity"
    | "dueDate"
    | "startedAt",
    string
  >
>

const NO_STATUS_VALUE = "__NO_STATUS__"
const NO_LINKED_SERVICE_VALUE = "__NO_LINKED_SERVICE__"
const TASK_FORM_FIELD_KEYS = new Set<keyof FieldErrors>([
  "name",
  "description",
  "assignedToUserId",
  "status",
  "linkedEntity",
  "dueDate",
  "startedAt",
])

function getDraftTimestamp(value: DateTimeDraft, timezone?: string | null) {
  if (!isDateTimeDraftComplete(value)) return null
  const iso = dateTimeDraftToUtcIso(value, timezone)
  if (!iso) return null
  const timestamp = Date.parse(iso)
  return Number.isNaN(timestamp) ? null : timestamp
}

function getPriorityLabel(priority: TaskOverviewFormProps["initialTask"]["priority"]) {
  if (!priority) return "No priority"
  return `${priority.charAt(0)}${priority.slice(1).toLowerCase()} priority`
}

export function TaskOverviewForm({
  tenantId,
  tenantTimezone,
  taskId,
  initialTask,
  statusOptions,
  assigneeOptions,
  serviceOptions,
}: TaskOverviewFormProps) {
  const router = useRouter()
  const [isSaving, setIsSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [name, setName] = useState(initialTask.name)
  const [description, setDescription] = useState(initialTask.description ?? "")
  const [assignedToUserId, setAssignedToUserId] = useState(
    initialTask.assignedToUserId ?? UNASSIGNED_TASK_VALUE,
  )
  const [statusConfigId, setStatusConfigId] = useState(
    initialTask.statusConfigId ?? NO_STATUS_VALUE,
  )
  const [linkedServiceId, setLinkedServiceId] = useState(
    initialTask.linkedEntityType === "SERVICE"
      ? serviceOptions.find((service) => service.name === initialTask.linkedEntityName)
          ?.id ?? NO_LINKED_SERVICE_VALUE
      : NO_LINKED_SERVICE_VALUE,
  )
  const [startedAt, setStartedAt] = useState<DateTimeDraft>(() =>
    formatUtcIsoToDateTimeDraft(initialTask.startedAt, tenantTimezone),
  )
  const [dueDate, setDueDate] = useState<DateTimeDraft>(() =>
    formatUtcIsoToDateTimeDraft(initialTask.dueDate, tenantTimezone),
  )

  const currentSnapshot = useMemo(
    () =>
      JSON.stringify({
        name,
        description,
        assignedToUserId,
        statusConfigId,
        linkedServiceId,
        startedAt,
        dueDate,
      }),
    [
      assignedToUserId,
      description,
      dueDate,
      linkedServiceId,
      name,
      startedAt,
      statusConfigId,
    ],
  )
  const [savedSnapshot, setSavedSnapshot] = useState(currentSnapshot)
  const isDirty = currentSnapshot !== savedSnapshot

  const clearError = (field: keyof FieldErrors) => {
    setFieldErrors((current) => ({ ...current, [field]: undefined }))
  }

  const validate = () => {
    const errors: FieldErrors = {}
    const trimmedName = name.trim()
    const trimmedDescription = description.trim()

    if (!trimmedName) {
      errors.name = "Task name is required."
    } else if (trimmedName.length > 160) {
      errors.name = "Task name must be 160 characters or fewer."
    }

    if (trimmedDescription.length > 4000) {
      errors.description = "Description must be 4,000 characters or fewer."
    }

    if (isDateTimeDraftEmpty(startedAt)) {
      errors.startedAt = "Choose a start date and time."
    } else if (!isDateTimeDraftComplete(startedAt)) {
      errors.startedAt = "Enter both a date and time."
    }

    if (!isDateTimeDraftEmpty(dueDate) && !isDateTimeDraftComplete(dueDate)) {
      errors.dueDate = "Enter both a date and time."
    }

    const startTimestamp = getDraftTimestamp(startedAt, tenantTimezone)
    const dueTimestamp = getDraftTimestamp(dueDate, tenantTimezone)
    if (
      startTimestamp !== null &&
      dueTimestamp !== null &&
      dueTimestamp < startTimestamp
    ) {
      errors.dueDate = "Due date must be at or after the start date."
    }

    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSave = async () => {
    if (!validate()) {
      toast.error("Fix the highlighted fields before saving.")
      return
    }

    const startedAtIso = dateTimeDraftToUtcIso(startedAt, tenantTimezone)
    const dueDateIso = isDateTimeDraftEmpty(dueDate)
      ? null
      : dateTimeDraftToUtcIso(dueDate, tenantTimezone)

    if (!startedAtIso) {
      setFieldErrors((current) => ({
        ...current,
        startedAt: "Choose a valid start date and time.",
      }))
      return
    }

    setIsSaving(true)
    setFieldErrors({})

    const normalizedName = name.trim()
    const normalizedDescription = description.trim()
    const selectedService = serviceOptions.find(
      (service) => service.id === linkedServiceId,
    )

    try {
      await api.patch(`/api/tasks/${tenantId}/${taskId}`, {
        name: normalizedName,
        description: normalizedDescription || null,
        assignedToUserId:
          assignedToUserId === UNASSIGNED_TASK_VALUE ? null : assignedToUserId,
        statusConfigId:
          statusConfigId === NO_STATUS_VALUE ? null : statusConfigId,
        linkedEntityType: selectedService ? "SERVICE" : null,
        linkedEntityName: selectedService?.name ?? null,
        startedAt: startedAtIso,
        dueDate: dueDateIso,
      })

      setName(normalizedName)
      setDescription(normalizedDescription)
      setSavedSnapshot(
        JSON.stringify({
          name: normalizedName,
          description: normalizedDescription,
          assignedToUserId,
          statusConfigId,
          linkedServiceId,
          startedAt,
          dueDate,
        }),
      )
      toast.success("Task updated.")
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const responseData = error.response?.data as
          | {
              error?: string
              details?: Array<{ path?: string; message?: string }>
            }
          | undefined
        const mappedErrors: FieldErrors = {}

        for (const detail of responseData?.details ?? []) {
          if (detail.path && detail.message) {
            if (detail.path === "statusConfigId") {
              mappedErrors.status = detail.message
            } else if (
              TASK_FORM_FIELD_KEYS.has(detail.path as keyof FieldErrors)
            ) {
              mappedErrors[detail.path as keyof FieldErrors] = detail.message
            }
          }
        }

        if (responseData?.error === "INVALID_ASSIGNEE") {
          mappedErrors.assignedToUserId =
            "Selected assignee is invalid for this tenant."
        }
        if (responseData?.error === "INVALID_STATUS_CONFIG") {
          mappedErrors.status = "Selected status is invalid for this tenant."
        }
        if (
          responseData?.error === "LINKED_ENTITY_NAME_REQUIRED" ||
          responseData?.error === "LINKED_ENTITY_TYPE_REQUIRED"
        ) {
          mappedErrors.linkedEntity = "Choose a valid service."
        }

        if (Object.keys(mappedErrors).length > 0) {
          setFieldErrors(mappedErrors)
        }

        toast.error(
          typeof responseData?.error === "string"
            ? responseData.error.replace(/_/g, " ")
            : "Could not update task.",
        )
      } else {
        toast.error("Could not update task.")
      }
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-4 rounded-xl border border-slate-100 bg-white p-4 md:p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-slate-900">Task details</h2>
          <p className="text-sm text-slate-500">
            Define the work and give the team the context needed to complete it.
          </p>
        </div>

        <FieldGroup className="gap-4">
          <Field
            data-invalid={Boolean(fieldErrors.name)}
            data-disabled={isSaving}
            className="gap-2"
          >
            <FieldLabel htmlFor="task-detail-name">
              Task name <span className="text-rose-600" aria-hidden="true">*</span>
            </FieldLabel>
            <Input
              id="task-detail-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                clearError("name")
              }}
              maxLength={160}
              disabled={isSaving}
              aria-invalid={Boolean(fieldErrors.name)}
              aria-required="true"
              className="h-11 rounded-xl"
            />
            <FieldError>{fieldErrors.name}</FieldError>
          </Field>

          <Field
            data-invalid={Boolean(fieldErrors.description)}
            data-disabled={isSaving}
            className="gap-2"
          >
            <div className="flex items-center justify-between gap-4">
              <FieldLabel htmlFor="task-detail-description">Description</FieldLabel>
              <span className="text-xs tabular-nums text-slate-500">
                {description.length}/4000
              </span>
            </div>
            <Textarea
              id="task-detail-description"
              value={description}
              onChange={(event) => {
                setDescription(event.target.value)
                clearError("description")
              }}
              maxLength={4000}
              disabled={isSaving}
              aria-invalid={Boolean(fieldErrors.description)}
              placeholder="Add instructions, context, or a desired outcome."
              className="min-h-36 resize-y rounded-xl"
            />
            <FieldError>{fieldErrors.description}</FieldError>
          </Field>
        </FieldGroup>
      </section>

      <section className="flex flex-col gap-4 rounded-xl border border-slate-100 bg-white p-4 md:p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-slate-900">Ownership</h2>
          <p className="text-sm text-slate-500">
            Assign responsibility and keep the workflow state recognizable.
          </p>
        </div>

        <FieldGroup className="gap-4 sm:grid sm:grid-cols-2 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.85fr)_minmax(10rem,0.65fr)]">
          <Field
            data-invalid={Boolean(fieldErrors.assignedToUserId)}
            data-disabled={isSaving}
            className="gap-2"
          >
            <FieldLabel htmlFor="task-detail-assignee">Assignee</FieldLabel>
            <TaskAssigneeInput
              id="task-detail-assignee"
              value={assignedToUserId}
              onValueChange={(value) => {
                setAssignedToUserId(value)
                clearError("assignedToUserId")
              }}
              options={assigneeOptions}
              disabled={isSaving}
              ariaInvalid={Boolean(fieldErrors.assignedToUserId)}
            />
            <FieldError>{fieldErrors.assignedToUserId}</FieldError>
          </Field>

          <Field
            data-invalid={Boolean(fieldErrors.status)}
            data-disabled={isSaving}
            className="gap-2"
          >
            <FieldLabel htmlFor="task-detail-status">Status</FieldLabel>
            <TaskStatusSelect
              id="task-detail-status"
              value={statusConfigId}
              onValueChange={(value) => {
                setStatusConfigId(value)
                clearError("status")
              }}
              options={statusOptions}
              disabled={isSaving}
              ariaInvalid={Boolean(fieldErrors.status)}
              noneValue={NO_STATUS_VALUE}
              noneLabel="No status"
            />
            <FieldError>{fieldErrors.status}</FieldError>
          </Field>

          <Field className="gap-2 sm:col-span-2 lg:col-span-1">
            <FieldTitle>Priority</FieldTitle>
            <div className="flex h-11 items-center">
              <Badge
                variant={initialTask.priority === "HIGH" ? "destructive" : "secondary"}
              >
                {getPriorityLabel(initialTask.priority)}
              </Badge>
            </div>
          </Field>
        </FieldGroup>
      </section>

      <section className="flex flex-col gap-4 rounded-xl border border-slate-100 bg-white p-4 md:p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-slate-900">Schedule</h2>
          <p className="text-sm text-slate-500">
            Set the working window using the tenant’s local timezone.
          </p>
        </div>

        <FieldGroup className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
          <Field
            data-invalid={Boolean(fieldErrors.startedAt)}
            data-disabled={isSaving}
            className="min-w-0 gap-2"
          >
            <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(7.5rem,0.8fr)] gap-0">
              <FieldLabel htmlFor="task-detail-start-date">
                Start date <span className="text-rose-600" aria-hidden="true">*</span>
              </FieldLabel>
              <FieldLabel htmlFor="task-detail-start-time">
                Time <span className="text-rose-600" aria-hidden="true">*</span>
              </FieldLabel>
            </div>
            <DateTimeInput
              id="task-detail-start-date"
              timeId="task-detail-start-time"
              value={startedAt}
              onValueChange={(value) => {
                setStartedAt(value)
                clearError("startedAt")
                clearError("dueDate")
              }}
              disabled={isSaving}
              ariaInvalid={Boolean(fieldErrors.startedAt)}
              timezone={tenantTimezone}
              disabledDate={() => false}
              layout="joined"
            />
            <FieldError>{fieldErrors.startedAt}</FieldError>
          </Field>

          <Field
            data-invalid={Boolean(fieldErrors.dueDate)}
            data-disabled={isSaving}
            className="min-w-0 gap-2"
          >
            <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(7.5rem,0.8fr)] gap-0">
              <FieldLabel htmlFor="task-detail-due-date">Due date</FieldLabel>
              <FieldLabel htmlFor="task-detail-due-time">Time</FieldLabel>
            </div>
            <DateTimeInput
              id="task-detail-due-date"
              timeId="task-detail-due-time"
              value={dueDate}
              onValueChange={(value) => {
                setDueDate(value)
                clearError("dueDate")
              }}
              disabled={isSaving}
              ariaInvalid={Boolean(fieldErrors.dueDate)}
              timezone={tenantTimezone}
              disabledDate={() => false}
              layout="joined"
            />
            <FieldError>{fieldErrors.dueDate}</FieldError>
          </Field>
        </FieldGroup>
      </section>

      <section className="flex flex-col gap-4 rounded-xl border border-slate-100 bg-white p-4 md:p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-slate-900">Related work</h2>
          <p className="text-sm text-slate-500">
            Keep the task connected to the service it supports.
          </p>
        </div>

        <FieldGroup className="sm:max-w-xl">
          <Field
            data-invalid={Boolean(fieldErrors.linkedEntity)}
            data-disabled={isSaving}
            className="gap-2"
          >
            <FieldLabel htmlFor="task-detail-linked-service">Service</FieldLabel>
            <Select
              value={linkedServiceId}
              onValueChange={(value) => {
                setLinkedServiceId(value)
                clearError("linkedEntity")
              }}
              disabled={isSaving}
            >
              <SelectTrigger
                id="task-detail-linked-service"
                aria-invalid={Boolean(fieldErrors.linkedEntity)}
                className="h-11 w-full rounded-xl"
              >
                <SelectValue placeholder="Select a service" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={NO_LINKED_SERVICE_VALUE}>
                    No linked service
                  </SelectItem>
                  {serviceOptions.map((service) => (
                    <SelectItem key={service.id} value={service.id}>
                      {service.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>
              Choose an active service from this tenant’s account.
            </FieldDescription>
            <FieldError>{fieldErrors.linkedEntity}</FieldError>
          </Field>
        </FieldGroup>
      </section>

      {isDirty ? (
        <div className="sticky bottom-4 z-20 flex justify-end">
          <div className="flex items-center rounded-2xl border border-slate-200 bg-white/95 px-3 py-3 shadow-lg backdrop-blur supports-backdrop-filter:bg-white/85">
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving}
              className="min-w-36 bg-blue-950 text-white hover:bg-blue-900"
            >
              {isSaving ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : null}
              {isSaving ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
