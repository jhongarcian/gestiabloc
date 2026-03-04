import Link from "next/link"
import {
  ArrowLeft,
  BellRing,
  Pencil,
  Trash2,
} from "lucide-react"
import { isAxiosError } from "axios"

import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { api } from "@/lib/api"
import { getTenantMembershipContext } from "../../_lib/tenant-session"
import { DeleteTaskDialog } from "./_components/delete-task-dialog"
import { EditTaskDialog } from "./_components/edit-task-dialog"
import { TaskOverviewPanel } from "./_components/task-overview-panel"
import { TaskReminderPanel } from "./_components/task-reminder-panel"

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
    linkedEntityName: string | null
    linkedEntityType: "SERVICE" | "PRODUCT" | null
    description: string | null
    reminders: Array<{
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
    }>
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
  }>
}

export default async function TaskDetailsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; taskId: string }>
}) {
  const { tenantSlug, taskId } = await params
  const { cookie, membership, user, tenantTimezone } = await getTenantMembershipContext(tenantSlug)

  let task: TaskDetailsResponse["task"] | null = null
  let errorMessage: string | null = null
  let statusOptions: Array<{ label: string; value: string; bgColor?: string; textColor?: string }> = []
  let assigneeOptions: Array<{ label: string; value: string }> = []

  if (membership?.tenant?.id) {
    try {
      const [{ data: taskData }, { data: statusData }, { data: assigneeData }] =
        await Promise.all([
        api.get<TaskDetailsResponse>(`/api/tasks/${membership.tenant.id}/${taskId}`, {
          headers: { cookie },
        }),
        api.get<TaskStatusConfigResponse>(`/api/tasks/${membership.tenant.id}/statuses`, {
          headers: { cookie },
        }),
        api.get<TaskAssigneesResponse>(`/api/tasks/${membership.tenant.id}/assignees`, {
          headers: { cookie },
        }),
      ])

      task = taskData.task
      statusOptions = statusData.items.map((status) => ({
        label: status.name,
        value: status.id,
        bgColor: status.bgColor,
        textColor: status.textColor,
      }))
      assigneeOptions = assigneeData.items.map((assignee) => ({
        label: assignee.label,
        value: assignee.value,
      }))
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) {
        errorMessage = "This task could not be found."
      } else {
        errorMessage =
          "Task details are not available yet. The list page is wired for the task API, but this repository does not include the task backend resources yet."
      }
    }
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <Button asChild variant="outline" size="sm" className="w-fit">
              <Link href={`/app/${tenantSlug}/tasks`}>
                <ArrowLeft />
                Back to tasks
              </Link>
            </Button>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                Task Overview
              </p>
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
                  Task details
                </h1>
                <p className="text-sm text-slate-600">
                  Review progress, assignment, due dates, and reminder activity for this task.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 md:items-end">
            <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-sm text-slate-600 shadow-sm">
              <span className="inline-flex items-center gap-2">
                <BellRing className="h-4 w-4 text-slate-500" />
                <span className="font-semibold text-slate-950">
                  {task?.reminders.length ?? 0}
                </span>{" "}
                reminders scheduled
              </span>
            </div>

            <div className="flex gap-2">
              {task ? (
            <EditTaskDialog
              tenantId={membership.tenant.id}
              tenantTimezone={tenantTimezone}
              taskId={task.id}
              statusOptions={statusOptions}
                  initialTask={{
                    name: task.name,
                    description: task.description,
                    dueDate: task.dueDate,
                    startedAt: task.startedAt,
                    reminderAt: task.reminders[0]?.remindAt ?? null,
                    statusConfigId: task.statusConfigId,
                  }}
                />
              ) : (
                <Button type="button" variant="outline" disabled>
                  <Pencil />
                  Edit task
                </Button>
              )}
              {task ? (
                <DeleteTaskDialog
                  tenantId={membership.tenant.id}
                  tenantSlug={tenantSlug}
                  taskId={task.id}
                  taskName={task.name}
                />
              ) : (
                <Button type="button" variant="destructive" disabled>
                  <Trash2 />
                  Delete task
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {task ? (
        <div className="space-y-5">
          <TaskOverviewPanel
            tenantId={membership.tenant.id}
            tenantTimezone={tenantTimezone}
            taskId={task.id}
            initialTask={task}
            statusOptions={statusOptions}
            assigneeOptions={assigneeOptions}
          />

          <div className="space-y-4">
            <TaskReminderPanel
              tenantId={membership.tenant.id}
              tenantTimezone={tenantTimezone}
              taskId={task.id}
              currentUserId={user.id}
              assignedPersonName={task.assignedPersonName}
              initialReminders={task.reminders}
            />
          </div>
        </div>
      ) : (
        <Card className="border-dashed border-slate-300 bg-slate-50/70">
          <CardHeader>
            <CardTitle className="text-base text-slate-900">
              Task details unavailable
            </CardTitle>
            <CardDescription className="text-slate-600">
              {errorMessage ??
                "The task detail endpoint has not been wired in this environment yet."}
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </section>
  )
}
