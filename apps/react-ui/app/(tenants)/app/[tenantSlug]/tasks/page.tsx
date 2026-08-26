import { redirect } from "next/navigation"

import { api } from "@/lib/api"
import { getTenantMembershipContext } from "../_lib/tenant-session"
import type { TaskSummary } from "./_components/task-page-header"
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
  summary: TaskSummary
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
  let summary: TaskSummary = {
    totalTasks: 0,
    overdueTasks: 0,
    dueToday: 0,
    unassignedTasks: 0,
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

    summary = {
      totalTasks: summaryData.summary.totalTasks,
      overdueTasks: summaryData.summary.overdueTasks,
      dueToday: summaryData.summary.dueToday,
      unassignedTasks: summaryData.summary.unassignedTasks,
    }
  } catch {
    // Summary metrics should not block task filters or list rendering.
  }

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <TasksTable
        tenantSlug={tenantSlug}
        tenantId={membership.tenant.id}
        tenantTimezone={tenantTimezone}
        statusOptions={statusOptions}
        assigneeOptions={assigneeOptions}
        summary={summary}
      />
    </section>
  )
}
