"use client"

import { isAxiosError } from "axios"
import { Loader2, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
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
} from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import {
  type DateTimeDraft,
  dateTimeDraftToUtcIso,
  formatDateTimeForDisplay,
  isDateTimeDraftComplete,
  isDateTimeDraftEmpty,
} from "@/lib/date-time"

export type TaskReminder = {
  id: string
  remindAt: string
  message: string | null
  notifiedAt: string | null
  recipient: {
    id: string
    name: string
    email: string
  }
  createdBy: {
    id: string
    name: string
  }
}

type TaskReminderPanelProps = {
  tenantId: string
  tenantTimezone?: string | null
  taskId: string
  currentUserId: string
  assignedPersonName: string | null
  initialReminders: TaskReminder[]
}

type CreateReminderResponse = {
  ok: boolean
  reminder: TaskReminder
}

export function TaskReminderPanel({
  tenantId,
  tenantTimezone,
  taskId,
  currentUserId,
  assignedPersonName,
  initialReminders,
}: TaskReminderPanelProps) {
  const router = useRouter()
  const [reminders, setReminders] = useState(initialReminders)
  const [remindAt, setRemindAt] = useState<DateTimeDraft>({ date: "", time: "" })
  const [message, setMessage] = useState("")
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deletingReminderId, setDeletingReminderId] = useState<string | null>(null)

  const recipientSummary = useMemo(() => {
    if (assignedPersonName) {
      return `New reminders default to ${assignedPersonName}.`
    }

    return "New reminders default to you when the task has no assigned person."
  }, [assignedPersonName])

  const handleCreateReminder = async () => {
    if (isDateTimeDraftEmpty(remindAt)) {
      setFieldError("Choose a reminder date and time.")
      return
    }
    if (!isDateTimeDraftComplete(remindAt)) {
      setFieldError("Enter both a date and time.")
      return
    }

    const remindAtIso = dateTimeDraftToUtcIso(remindAt, tenantTimezone)
    if (!remindAtIso) {
      setFieldError("Choose a valid reminder date and time.")
      return
    }

    setIsSubmitting(true)
    setFieldError(null)

    try {
      const { data } = await api.post<CreateReminderResponse>(
        `/api/tasks/${tenantId}/${taskId}/reminders`,
        {
          remindAt: remindAtIso,
          message: message.trim() || null,
        },
      )

      setReminders((current) =>
        [...current, data.reminder].sort((left, right) =>
          left.remindAt.localeCompare(right.remindAt),
        ),
      )
      setMessage("")
      setRemindAt({ date: "", time: "" })
      toast.success("Reminder created.")
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not create reminder.",
        )
      } else {
        toast.error("Could not create reminder.")
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteReminder = async (reminderId: string) => {
    setDeletingReminderId(reminderId)

    try {
      await api.delete(`/api/tasks/${tenantId}/${taskId}/reminders/${reminderId}`)
      setReminders((current) => current.filter((item) => item.id !== reminderId))
      toast.success("Reminder deleted.")
      router.refresh()
    } catch {
      toast.error("Could not delete reminder.")
    } finally {
      setDeletingReminderId(null)
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-slate-100 bg-white p-4 md:p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-slate-900">Reminders</h2>
        <p className="text-sm text-slate-500">{recipientSummary}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <FieldGroup className="gap-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
          <Field
            data-invalid={Boolean(fieldError)}
            data-disabled={isSubmitting}
            className="min-w-0 gap-2"
          >
            <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(7.5rem,0.8fr)] gap-0">
              <FieldLabel htmlFor="task-reminder-date">Reminder date</FieldLabel>
              <FieldLabel htmlFor="task-reminder-time">Time</FieldLabel>
            </div>
            <DateTimeInput
              id="task-reminder-date"
              timeId="task-reminder-time"
              value={remindAt}
              onValueChange={(value) => {
                setRemindAt(value)
                setFieldError(null)
              }}
              disabled={isSubmitting}
              ariaInvalid={Boolean(fieldError)}
              timezone={tenantTimezone}
              disabledDate={() => false}
              layout="joined"
            />
            <FieldError>{fieldError}</FieldError>
          </Field>

          <Field data-disabled={isSubmitting} className="gap-2">
            <div className="flex items-center justify-between gap-4">
              <FieldLabel htmlFor="task-reminder-message">Message</FieldLabel>
              <span className="text-xs tabular-nums text-slate-500">
                {message.length}/500
              </span>
            </div>
            <Textarea
              id="task-reminder-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Add context for the reminder notification."
              disabled={isSubmitting}
              maxLength={500}
              className="min-h-28 resize-y rounded-xl bg-white"
            />
            <FieldDescription>
              The message is included with the reminder notification.
            </FieldDescription>
          </Field>

          <Button
            type="button"
            className="w-full bg-blue-950 text-white hover:bg-blue-900"
            disabled={isSubmitting}
            onClick={() => void handleCreateReminder()}
          >
            {isSubmitting ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : null}
            {isSubmitting ? "Saving..." : "Create reminder"}
          </Button>
        </FieldGroup>

        <div className="flex min-w-0 flex-col gap-3">
          {reminders.length > 0 ? (
            reminders.map((reminder) => {
              const isDeleting = deletingReminderId === reminder.id
              const isOwnReminder = reminder.recipient.id === currentUserId

              return (
                <article
                  key={reminder.id}
                  className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <time
                        dateTime={reminder.remindAt}
                        className="text-sm font-semibold tabular-nums text-slate-950"
                      >
                        {formatDateTimeForDisplay(
                          reminder.remindAt,
                          tenantTimezone,
                          true,
                        )}
                      </time>
                      <Badge variant="secondary">
                        {reminder.notifiedAt ? "Sent" : "Scheduled"}
                      </Badge>
                    </div>

                    <div className="flex flex-col gap-1 text-sm text-slate-600">
                      <p>
                        Recipient:{" "}
                        <span className="font-medium text-slate-900">
                          {isOwnReminder ? "You" : reminder.recipient.name}
                        </span>
                      </p>
                      <p>
                        Created by{" "}
                        <span className="font-medium text-slate-900">
                          {reminder.createdBy.name}
                        </span>
                      </p>
                      <p className="whitespace-pre-wrap leading-6 text-slate-700">
                        {reminder.message?.trim() || "No reminder message provided."}
                      </p>
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isDeleting}
                    onClick={() => void handleDeleteReminder(reminder.id)}
                  >
                    {isDeleting ? (
                      <Loader2 data-icon="inline-start" className="animate-spin" />
                    ) : (
                      <Trash2 data-icon="inline-start" />
                    )}
                    {isDeleting ? "Removing..." : "Delete"}
                  </Button>
                </article>
              )
            })
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-6 text-sm text-slate-500">
              No reminders scheduled yet.
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
