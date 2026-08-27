import { isAxiosError } from "axios"
import { ArrowLeft, History } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { api } from "@/lib/api"
import { formatPhoneNumber } from "@/lib/format-phone-number"
import { getTenantMembershipContext } from "../../_lib/tenant-session"
import { DeleteTaskDialog } from "./_components/delete-task-dialog"
import {
  TaskActivitySheet,
  type TaskActivity,
} from "./_components/task-activity-panel"
import { TaskOverviewForm } from "./_components/task-overview-panel"
import {
  TaskReminderPanel,
  type TaskReminder,
} from "./_components/task-reminder-panel"

type TaskDetailsResponse = {
  ok: boolean
  task: {
    id: string
    name: string
    assignedToUserId: string | null
    priority: "HIGH" | "MEDIUM" | "LOW" | null
    dueDate: string | null
    startedAt: string | null
    statusConfigId: string | null
    assignedPersonName: string | null
    status: string
    statusBgColor: string | null
    statusTextColor: string | null
    contactName: string | null
    contact: {
      id: string
      fullName: string
      email: string | null
      phoneNumber: string | null
      dateOfBirth: string | null
    } | null
    linkedEntityName: string | null
    linkedEntityType: "SERVICE" | "PRODUCT" | null
    description: string | null
    reminders: TaskReminder[]
    activities: TaskActivity[]
  }
}

type TaskStatusConfigResponse = {
  ok: boolean
  items: Array<{
    id: string
    name: string
    bgColor: string
    textColor: string
    isActive: boolean
    sortOrder: number
  }>
}

type TaskAssigneesResponse = {
  ok: boolean
  items: Array<{
    value: string
    label: string
    email: string
    image: string | null
  }>
}

type LinkedEntityOptionsResponse = {
  ok: boolean
  items: Array<{
    id: string
    name: string
    type: "SERVICE" | "PRODUCT"
  }>
}

function formatContactDate(value: string | null | undefined) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date)
}

export default async function TaskDetailsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; taskId: string }>
}) {
  const { tenantSlug, taskId } = await params
  const { cookie, membership, user, tenantTimezone } =
    await getTenantMembershipContext(tenantSlug)

  let task: TaskDetailsResponse["task"] | null = null
  let errorMessage: string | null = null
  let statusOptions: Array<{
    label: string
    value: string
    bgColor?: string
    textColor?: string
  }> = []
  let assigneeOptions: TaskAssigneesResponse["items"] = []
  let linkedEntityOptions: LinkedEntityOptionsResponse["items"] = []

  if (membership?.tenant?.id) {
    try {
      const [
        { data: taskData },
        { data: statusData },
        { data: assigneeData },
        linkedEntityResult,
      ] = await Promise.all([
        api.get<TaskDetailsResponse>(
          `/api/tasks/${membership.tenant.id}/${taskId}`,
          { headers: { cookie } },
        ),
        api.get<TaskStatusConfigResponse>(
          `/api/tasks/${membership.tenant.id}/statuses`,
          { headers: { cookie } },
        ),
        api.get<TaskAssigneesResponse>(
          `/api/tasks/${membership.tenant.id}/assignees`,
          { headers: { cookie } },
        ),
        api
          .get<LinkedEntityOptionsResponse>(
            `/api/services-products/${membership.tenant.id}/options`,
            {
              headers: { cookie },
              params: { limit: 100 },
            },
          )
          .catch(() => null),
      ])

      task = taskData.task
      statusOptions = statusData.items.map((status) => ({
        label: status.name,
        value: status.id,
        bgColor: status.bgColor,
        textColor: status.textColor,
      }))
      assigneeOptions = assigneeData.items
      if (
        task.assignedToUserId &&
        !assigneeOptions.some((option) => option.value === task?.assignedToUserId)
      ) {
        assigneeOptions = [
          {
            value: task.assignedToUserId,
            label: task.assignedPersonName?.trim() || "Assigned user",
            email: "",
            image: null,
          },
          ...assigneeOptions,
        ]
      }
      linkedEntityOptions = linkedEntityResult?.data.items ?? []
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) {
        errorMessage = "This task could not be found."
      } else {
        errorMessage = "Task details are temporarily unavailable."
      }
    }
  }

  const contactName = task?.contact?.fullName ?? "No contact linked"
  const contactPhone = task?.contact?.phoneNumber
    ? formatPhoneNumber(task.contact.phoneNumber)
    : "—"
  const contactEmail = task?.contact?.email ?? "—"
  const contactDateOfBirth = formatContactDate(task?.contact?.dateOfBirth)

  return (
    <section className="flex flex-col gap-5">
      <header className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Button asChild variant="outline" size="icon" className="shrink-0 bg-white/80 hover:bg-white">
                <Link href={`/app/${tenantSlug}/tasks`} aria-label="Back to tasks">
                  <ArrowLeft />
                </Link>
              </Button>
              <div className="flex min-w-0 flex-col gap-1.5">
                <p className="text-xs font-semibold text-blue-700">Task details</p>
                <h1 className="truncate text-2xl font-semibold text-slate-950">
                  {contactName}
                </h1>
              </div>
            </div>

            <p className="max-w-3xl text-sm text-slate-600">
              Review and update this task’s ownership, schedule, reminders, and
              related work.
            </p>

            <div
              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500"
              aria-label="Contact details"
            >
              <span>
                <span className="sr-only">Phone: </span>
                {contactPhone}
              </span>
              <span className="size-1 rounded-full bg-slate-300" aria-hidden="true" />
              <span className="min-w-0 truncate">
                <span className="sr-only">Email: </span>
                {contactEmail}
              </span>
              <span className="size-1 rounded-full bg-slate-300" aria-hidden="true" />
              <span className="tabular-nums">
                <span className="sr-only">Date of birth: </span>
                {contactDateOfBirth}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center md:shrink-0">
            {task ? (
              <TaskActivitySheet
                tenantTimezone={tenantTimezone}
                activities={task.activities}
              />
            ) : (
              <Button type="button" variant="outline" disabled>
                <History data-icon="inline-start" />
                Activity history
              </Button>
            )}
            {task && membership?.tenant?.id ? (
              <DeleteTaskDialog
                tenantId={membership.tenant.id}
                tenantSlug={tenantSlug}
                taskId={task.id}
                taskName={task.name}
              />
            ) : null}
          </div>
        </div>
      </header>

      {task && membership?.tenant?.id ? (
        <div className="flex flex-col gap-5">
          <TaskOverviewForm
            tenantId={membership.tenant.id}
            tenantTimezone={tenantTimezone}
            taskId={task.id}
            initialTask={task}
            statusOptions={statusOptions}
            assigneeOptions={assigneeOptions}
            linkedEntityOptions={linkedEntityOptions}
          />
          <TaskReminderPanel
            tenantId={membership.tenant.id}
            tenantTimezone={tenantTimezone}
            taskId={task.id}
            currentUserId={user.id}
            assignedPersonName={task.assignedPersonName}
            initialReminders={task.reminders}
          />
        </div>
      ) : (
        <Card className="border-dashed border-slate-300 bg-slate-50/70">
          <CardHeader>
            <CardTitle className="text-base text-slate-900">
              Task details unavailable
            </CardTitle>
            <CardDescription className="text-slate-600">
              {errorMessage ?? "This task is not available in the current tenant."}
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </section>
  )
}
