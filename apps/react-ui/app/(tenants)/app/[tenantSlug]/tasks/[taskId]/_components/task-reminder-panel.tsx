"use client"

import { isAxiosError } from "axios"
import { BellRing, LoaderCircle, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  DateTimeInput,
} from "@/components/ui/date-time-input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import {
  type DateTimeDraft,
  dateTimeDraftToUtcIso,
  formatDateTimeForDisplay,
  isDateTimeDraftComplete,
  isDateTimeDraftEmpty,
} from "@/lib/date-time"

type TaskReminder = {
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
  const [reminders, setReminders] = useState(initialReminders)
  const [remindAtInput, setRemindAtInput] = useState<DateTimeDraft>({
    date: "",
    time: "",
  })
  const [message, setMessage] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deletingReminderId, setDeletingReminderId] = useState<string | null>(null)

  const recipientSummary = useMemo(() => {
    if (assignedPersonName) {
      return `New reminders default to ${assignedPersonName}.`
    }

    return "New reminders default to you when the task has no assigned person."
  }, [assignedPersonName])

  const handleCreateReminder = async () => {
    if (isDateTimeDraftEmpty(remindAtInput) || !isDateTimeDraftComplete(remindAtInput)) {
      toast.error("Choose a valid reminder date and time.")
      return
    }

    setIsSubmitting(true)

    try {
      const remindAt = dateTimeDraftToUtcIso(remindAtInput, tenantTimezone)

      const { data } = await api.post<CreateReminderResponse>(
        `/api/tasks/${tenantId}/${taskId}/reminders`,
        {
          remindAt,
          message: message.trim() || null,
        },
      )

      setReminders((current) =>
        [...current, data.reminder].sort((left, right) =>
          left.remindAt.localeCompare(right.remindAt),
        ),
      )
      setMessage("")
      setRemindAtInput({ date: "", time: "" })
      toast.success("Reminder created.")
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        if (typeof backendError === "string") {
          toast.error(backendError.replace(/_/g, " "))
        } else {
          toast.error("Could not create reminder.")
        }
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
    } catch {
      toast.error("Could not delete reminder.")
    } finally {
      setDeletingReminderId(null)
    }
  }

  return (
    <Card className="border-slate-200 lg:col-span-2">
      <CardHeader className="border-b border-slate-100">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <BellRing className="h-4 w-4 text-slate-500" />
              Reminders
            </CardTitle>
            <CardDescription>{recipientSummary}</CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid gap-6 pt-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
          <div className="space-y-2">
            <Label htmlFor="task-remind-at">Reminder Date</Label>
            <DateTimeInput
              id="task-remind-at"
              value={remindAtInput}
              onValueChange={setRemindAtInput}
              disabled={isSubmitting}
              timezone={tenantTimezone}
              disabledDate={() => false}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-reminder-message">Message</Label>
            <Textarea
              id="task-reminder-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Optional note for the reminder notification"
              disabled={isSubmitting}
              maxLength={500}
              className="min-h-28 bg-white"
            />
          </div>

          <Button
            type="button"
            className="w-full"
            disabled={isSubmitting}
            onClick={() => void handleCreateReminder()}
          >
            {isSubmitting ? (
              <>
                <LoaderCircle className="animate-spin" />
                Saving reminder
              </>
            ) : (
              "Create reminder"
            )}
          </Button>
        </div>

        <div className="space-y-3">
          {reminders.length ? (
            reminders.map((reminder) => {
              const isDeleting = deletingReminderId === reminder.id
              const isOwnReminder = reminder.recipient.id === currentUserId

              return (
                <div
                  key={reminder.id}
                  className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-950">
                        {formatDateTimeForDisplay(reminder.remindAt, tenantTimezone, true)}
                      </p>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                        {reminder.notifiedAt ? "Sent" : "Scheduled"}
                      </span>
                    </div>

                    <div className="space-y-1 text-sm text-slate-600">
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
                      <>
                        <LoaderCircle className="animate-spin" />
                        Removing
                      </>
                    ) : (
                      <>
                        <Trash2 />
                        Delete
                      </>
                    )}
                  </Button>
                </div>
              )
            })
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-6 text-sm text-slate-500">
              No reminders scheduled yet.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
