import Link from "next/link"
import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { ClipboardList } from "lucide-react"

import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { formatDateTimeForDisplay } from "@/lib/date-time"
import { getContactDetailsContext } from "../_lib/contact-details"
import { CreateTaskDialog } from "../../../tasks/_components/create-task-dialog"

type ContactTasksResponse = {
  ok: boolean
  items: Array<{
    id: string
    name: string
    description: string | null
    priority: "HIGH" | "MEDIUM" | "LOW" | null
    dueDate: string | null
    assignedPersonName: string | null
    startedAt: string | null
    status: string
    statusConfigId: string | null
    statusBgColor: string | null
    statusTextColor: string | null
    contactName: string | null
    linkedEntityName: string | null
    linkedEntityType: "SERVICE" | "PRODUCT" | null
  }>
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
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

const formatLinkedEntity = (
  task: ContactTasksResponse["items"][number],
) => {
  if (!task.linkedEntityName) return "—"
  if (!task.linkedEntityType) return task.linkedEntityName
  return `${task.linkedEntityType === "SERVICE" ? "Service" : "Product"}: ${task.linkedEntityName}`
}

function PriorityChip({
  priority,
}: {
  priority: "HIGH" | "MEDIUM" | "LOW" | null
}) {
  if (!priority) return null

  const style =
    priority === "HIGH"
      ? { backgroundColor: "#FEE2E2", color: "#B91C1C" }
      : priority === "MEDIUM"
        ? { backgroundColor: "#FEF3C7", color: "#B45309" }
        : { backgroundColor: "#DBEAFE", color: "#1D4ED8" }

  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={style}
    >
      {priority}
    </span>
  )
}

export default async function ContactTasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; contactId: string }>
  searchParams: Promise<{ page?: string; priority?: "HIGH" | "MEDIUM" | "LOW" }>
}) {
  const { tenantSlug, contactId } = await params
  const { page: rawPage, priority } = await searchParams
  const { tenantId, tenantTimezone, contact } = await getContactDetailsContext(tenantSlug, contactId)
  const cookie = (await headers()).get("cookie") ?? ""
  const page = Math.max(1, Number(rawPage ?? "1") || 1)
  const pageSize = 10
  const querySuffix = priority ? `&priority=${priority}` : ""

  let tasks: ContactTasksResponse["items"] = []
  let total = 0
  let totalPages = 1
  let statusOptions: Array<{
    label: string
    value: string
    bgColor?: string
    textColor?: string
  }> = []
  let assigneeOptions: Array<{
    label: string
    value: string
  }> = []

  try {
    const [{ data: tasksData }, { data: statusesData }, { data: assigneesData }] = await Promise.all([
      api.get<ContactTasksResponse>(`/api/tasks/${tenantId}`, {
        headers: { cookie },
        params: {
          page,
          pageSize,
          contactId,
          priority,
        },
      }),
      api.get<TaskStatusConfigResponse>(`/api/tasks/${tenantId}/statuses`, {
        headers: { cookie },
      }),
      api.get<TaskAssigneesResponse>(`/api/tasks/${tenantId}/assignees`, {
        headers: { cookie },
      }),
    ])

    tasks = tasksData.items
    total = tasksData.pagination.total
    totalPages = tasksData.pagination.totalPages
    statusOptions = statusesData.items.map((status) => ({
      label: status.name,
      value: status.id,
      bgColor: status.bgColor,
      textColor: status.textColor,
    }))
    assigneeOptions = assigneesData.items.map((assignee) => ({
      label: assignee.label,
      value: assignee.value,
    }))
  } catch {
    tasks = []
    total = 0
    totalPages = 1
    statusOptions = []
    assigneeOptions = []
  }

  if (page > totalPages && total > 0) {
    notFound()
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            Contact Tasks
          </p>
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
                Tasks and follow-through
              </h1>
              <p className="text-sm text-slate-600">
                Review the work, timing, and ownership currently attached to this contact.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:self-center">
            <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-sm text-slate-600 shadow-sm">
              <span className="inline-flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-slate-500" />
                <span className="font-semibold text-slate-950">{total}</span> tasks
              </span>
            </div>

            <CreateTaskDialog
              tenantId={tenantId}
              tenantTimezone={tenantTimezone}
              statusOptions={statusOptions}
              assigneeOptions={assigneeOptions}
              initialContact={{
                id: contact.id,
                fullName: contact.fullName,
                phoneNumber: contact.phoneNumber,
                email: contact.email,
              }}
              lockContact
              triggerLabel="Create task"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {[
          { label: "All priorities", value: undefined },
          { label: "High", value: "HIGH" },
          { label: "Medium", value: "MEDIUM" },
          { label: "Low", value: "LOW" },
        ].map((option) => {
          const isActive = (priority ?? undefined) === option.value
          const href = option.value
            ? `/app/${tenantSlug}/contacts/${contactId}/tasks?priority=${option.value}`
            : `/app/${tenantSlug}/contacts/${contactId}/tasks`

          return (
            <Link
              key={option.label}
              href={href}
              className={
                isActive
                  ? "inline-flex h-8 items-center rounded-full bg-blue-950 px-3 text-sm font-medium text-white"
                  : "inline-flex h-8 items-center rounded-full border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
              }
            >
              {option.label}
            </Link>
          )
        })}
      </div>

      {tasks.length > 0 ? (
        <div className="space-y-4">
          <div className="space-y-3">
              {tasks.map((task) => (
                <Link
                  key={task.id}
                  href={`/app/${tenantSlug}/tasks/${task.id}`}
                  className="group block rounded-[20px] border border-slate-200 bg-white px-4 py-4 shadow-sm transition hover:border-slate-300 hover:shadow-md"
                >
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-[15px] font-semibold text-slate-950">
                            {task.name}
                          </p>
                          <PriorityChip priority={task.priority} />
                        </div>
                        <p className="line-clamp-2 max-w-3xl text-sm leading-5 text-slate-500">
                          {task.description?.trim() || "No description provided."}
                        </p>
                      </div>

                      <div className="shrink-0 pt-0.5">
                        <span
                          className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700"
                          style={
                            task.statusBgColor && task.statusTextColor
                              ? {
                                  backgroundColor: task.statusBgColor,
                                  color: task.statusTextColor,
                                }
                              : undefined
                          }
                        >
                          {task.status}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-slate-100 pt-2.5 text-[13px] text-slate-600">
                      <p>
                        <span className="font-medium text-slate-900">Due:</span>{" "}
                        {formatDateTimeForDisplay(task.dueDate, tenantTimezone)}
                      </p>
                      <p>
                        <span className="font-medium text-slate-900">Started:</span>{" "}
                        {formatDateTimeForDisplay(task.startedAt, tenantTimezone)}
                      </p>
                      <p className="min-w-0">
                        <span className="font-medium text-slate-900">Linked:</span>{" "}
                        <span className="truncate">{formatLinkedEntity(task)}</span>
                      </p>
                      <p>
                        <span className="font-medium text-slate-900">Assigned:</span>{" "}
                        {task.assignedPersonName ?? "Not assigned"}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-600">
              Showing {(page - 1) * pageSize + 1}-{(page - 1) * pageSize + tasks.length} of {total} tasks
            </p>
            <div className="flex items-center gap-2 self-end sm:self-auto">
              {page > 1 ? (
                <Button
                  asChild
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
                >
                  <Link href={`/app/${tenantSlug}/contacts/${contactId}/tasks?page=${page - 1}${querySuffix}`}>
                    Previous
                  </Link>
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
                  disabled
                >
                  Previous
                </Button>
              )}
              <span className="px-1 text-sm text-slate-600">
                Page {page} of {totalPages}
              </span>
              {page < totalPages ? (
                <Button
                  asChild
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
                >
                  <Link href={`/app/${tenantSlug}/contacts/${contactId}/tasks?page=${page + 1}${querySuffix}`}>
                    Next
                  </Link>
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
                  disabled
                >
                  Next
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50/70 px-6 py-16 text-center">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm">
            <ClipboardList className="h-5 w-5" />
          </span>
          <h2 className="mt-4 text-lg font-semibold text-slate-950">
            No tasks linked to this contact
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Tasks will appear here once they are associated with {contact.fullName}.
          </p>
        </div>
      )}
    </section>
  )
}
