import { redirect } from "next/navigation"

import { api } from "@/lib/api"
import { getTenantMembershipContext } from "../_lib/tenant-session"
import { TaskInsights } from "./_components/task-insights"
import { TasksTable } from "./_components/tasks-table"

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

type TaskSummaryResponse = {
  ok: boolean
  summary: {
    totalTasks: number
    overdueTasks: number
    dueToday: number
    dueThisWeek: number
    highPriorityTasks: number
    unassignedTasks: number
    completedToday: number
    myPriorityCounts: {
      HIGH: number
      MEDIUM: number
      LOW: number
    }
  }
}

export default async function TasksPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const { cookie, membership, tenantTimezone } = await getTenantMembershipContext(tenantSlug)

  if (!membership?.tenant?.id) {
    redirect(`/app/${tenantSlug}`)
  }

  let statusOptions: Array<{
    label: string
    value: string
    bgColor?: string
    textColor?: string
  }> = [{ label: "All Statuses", value: "ALL" }]
  let assigneeOptions: Array<{
    label: string
    value: string
    email?: string
    image?: string | null
  }> = []
  let summary: TaskSummaryResponse["summary"] = {
    totalTasks: 0,
    overdueTasks: 0,
    dueToday: 0,
    dueThisWeek: 0,
    highPriorityTasks: 0,
    unassignedTasks: 0,
    completedToday: 0,
    myPriorityCounts: {
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
    },
  }

  try {
    const [{ data: statusData }, { data: assigneeData }] = await Promise.all([
      api.get<TaskStatusConfigResponse>(`/api/tasks/${membership.tenant.id}/statuses`, {
        headers: { cookie },
      }),
      api.get<TaskAssigneesResponse>(`/api/tasks/${membership.tenant.id}/assignees`, {
        headers: { cookie },
      }),
    ])

    statusOptions = [
      { label: "All Statuses", value: "ALL" },
      ...statusData.items.map((status) => ({
        label: status.name,
        value: status.id,
        bgColor: status.bgColor,
        textColor: status.textColor,
      })),
    ]

    assigneeOptions = assigneeData.items.map((assignee) => ({
      label: assignee.label,
      value: assignee.value,
      email: assignee.email,
      image: assignee.image,
    }))
  } catch {
    // The page should remain usable if the task metadata endpoints are unavailable.
  }

  try {
    const { data: summaryData } = await api.get<TaskSummaryResponse>(
      `/api/tasks/${membership.tenant.id}/summary`,
      {
        headers: { cookie },
      },
    )

    summary = summaryData.summary
  } catch {
    // Insights should not block task filters or list rendering.
  }

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <TaskInsights summary={summary} />

      <div className="flex min-h-0 flex-1 rounded-xl bg-white p-2 md:p-4">
        <div className="flex h-full w-full min-h-0 flex-col">
          <TasksTable
            tenantSlug={tenantSlug}
            tenantId={membership.tenant.id}
            tenantTimezone={tenantTimezone}
            statusOptions={statusOptions}
            assigneeOptions={assigneeOptions}
          />
        </div>
      </div>
    </section>
  )
}
