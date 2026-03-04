"use client"

import { isAxiosError } from "axios"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
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
} from "../../_components/task-status-select"

type EditTaskDialogProps = {
  tenantId: string
  tenantTimezone?: string | null
  taskId: string
  statusOptions: TaskStatusOption[]
  initialTask: {
    name: string
    description: string | null
    dueDate: string | null
    startedAt: string | null
    reminderAt: string | null
    statusConfigId: string | null
  }
}

type FieldErrors = Partial<
  Record<
    "name" | "description" | "status" | "dueDate" | "startedAt" | "reminderAt",
    string
  >
>

const ALL_STATUS_VALUE = "ALL"

export function EditTaskDialog({
  tenantId,
  tenantTimezone,
  taskId,
  statusOptions,
  initialTask,
}: EditTaskDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const [name, setName] = useState(initialTask.name)
  const [description, setDescription] = useState(initialTask.description ?? "")
  const [statusConfigId, setStatusConfigId] = useState<string | undefined>(
    initialTask.statusConfigId ?? undefined,
  )
  const [dueDateInput, setDueDateInput] = useState<DateTimeDraft>(
    formatUtcIsoToDateTimeDraft(initialTask.dueDate, tenantTimezone),
  )
  const [startedAtInput, setStartedAtInput] = useState<DateTimeDraft>(
    formatUtcIsoToDateTimeDraft(initialTask.startedAt, tenantTimezone),
  )
  const [reminderAtInput, setReminderAtInput] = useState<DateTimeDraft>(
    formatUtcIsoToDateTimeDraft(initialTask.reminderAt, tenantTimezone),
  )

  const selectableStatuses = useMemo(
    () => statusOptions.filter((option) => option.value !== ALL_STATUS_VALUE),
    [statusOptions],
  )

  const resetForm = () => {
    setName(initialTask.name)
    setDescription(initialTask.description ?? "")
    setStatusConfigId(initialTask.statusConfigId ?? undefined)
    setDueDateInput(formatUtcIsoToDateTimeDraft(initialTask.dueDate, tenantTimezone))
    setStartedAtInput(formatUtcIsoToDateTimeDraft(initialTask.startedAt, tenantTimezone))
    setReminderAtInput(formatUtcIsoToDateTimeDraft(initialTask.reminderAt, tenantTimezone))
    setFieldErrors({})
  }

  const validate = () => {
    const nextErrors: FieldErrors = {}

    if (!name.trim()) {
      nextErrors.name = "Task name is required."
    }

    if (!isDateTimeDraftEmpty(dueDateInput) && !isDateTimeDraftComplete(dueDateInput)) {
      nextErrors.dueDate = "Enter a valid due date and time."
    }

    if (!isDateTimeDraftEmpty(startedAtInput) && !isDateTimeDraftComplete(startedAtInput)) {
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
      const startedAt = isDateTimeDraftEmpty(startedAtInput)
        ? null
        : dateTimeDraftToUtcIso(startedAtInput, tenantTimezone)
      const reminderAt = isDateTimeDraftEmpty(reminderAtInput)
        ? null
        : dateTimeDraftToUtcIso(reminderAtInput, tenantTimezone)

      await api.patch(`/api/tasks/${tenantId}/${taskId}`, {
        name: name.trim(),
        description: description.trim() || null,
        statusConfigId: statusConfigId ?? null,
        dueDate,
        startedAt,
        reminderAt,
      })

      toast.success("Task updated.")
      setOpen(false)
      router.refresh()
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
            if (detail.path === "description" && detail.message) {
              mappedErrors.description = detail.message
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
        } else if (typeof backendError === "string") {
          toast.error(backendError.replace(/_/g, " "))
        } else {
          toast.error("Could not update task.")
        }
      } else {
        toast.error("Could not update task.")
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) resetForm()
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          Edit task
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Task</DialogTitle>
          <DialogDescription>
            Update the task details, dates, and status.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="edit-task-name">Task Name</Label>
            <Input
              id="edit-task-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Follow up on contract review"
            />
            {fieldErrors.name ? (
              <p className="text-xs text-rose-600">{fieldErrors.name}</p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="edit-task-due-date">Due Date</Label>
              <DateTimeInput
                id="edit-task-due-date"
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

            <div className="grid gap-2">
              <Label htmlFor="edit-task-started-at">Start Date</Label>
              <DateTimeInput
                id="edit-task-started-at"
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

            <div className="grid gap-2">
              <Label htmlFor="edit-task-reminder-at">Reminder Date</Label>
              <DateTimeInput
                id="edit-task-reminder-at"
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

          <div className="grid gap-2">
            <Label htmlFor="edit-task-status">Status</Label>
            <TaskStatusSelect
              id="edit-task-status"
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

          <div className="grid gap-2">
            <Label htmlFor="edit-task-description">Description</Label>
            <Textarea
              id="edit-task-description"
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
            {isSubmitting ? "Saving..." : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
