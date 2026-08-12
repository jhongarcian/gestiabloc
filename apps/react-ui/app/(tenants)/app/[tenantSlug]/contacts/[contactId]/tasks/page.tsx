import Link from "next/link"
import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { ChevronLeft, ChevronRight, ClipboardList } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api } from "@/lib/api"
import { formatDateForDisplay } from "@/lib/date-time"
import { getContactDetailsContext } from "../_lib/contact-details"
import { CreateTaskDialog } from "../../../tasks/_components/create-task-dialog"

type ContactTasksResponse = {
  ok: boolean
  items: Array<{
    id: string
    name: string
    description: string | null
    assignedToUserId: string | null
    priority: "HIGH" | "MEDIUM" | "LOW" | null
    dueDate: string | null
    assignedPersonName: string | null
    assignedPersonImage: string | null
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
    image: string | null
  }>
}

function getInitials(name: string) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")

  return initials || "?"
}

const PRIORITY_BADGE_STYLES = {
  LOW: "border-emerald-100 bg-emerald-50 text-emerald-700",
  MEDIUM: "border-orange-100 bg-orange-50 text-orange-700",
  HIGH: "border-red-100 bg-red-50 text-red-700",
} as const

function PriorityBadge({
  priority,
}: {
  priority: "HIGH" | "MEDIUM" | "LOW" | null
}) {
  if (!priority) {
    return <span className="text-sm text-muted-foreground">Not set</span>
  }

  return (
    <Badge variant="outline" className={PRIORITY_BADGE_STYLES[priority]}>
      {priority.charAt(0) + priority.slice(1).toLowerCase()}
    </Badge>
  )
}

function StatusBadge({
  label,
  bgColor,
  textColor,
}: {
  label: string
  bgColor: string | null
  textColor: string | null
}) {
  return (
    <Badge
      variant="secondary"
      style={
        bgColor && textColor
          ? { backgroundColor: bgColor, color: textColor }
          : undefined
      }
    >
      {label}
    </Badge>
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
    email?: string
    image?: string | null
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
      email: assignee.email,
      image: assignee.image,
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

  const assigneesById = new Map(
    assigneeOptions.map((assignee) => [assignee.value, assignee]),
  )
  const placeholderRowCount =
    tasks.length === 0 ? pageSize - 1 : Math.max(0, pageSize - tasks.length)
  const visiblePageCount = Math.min(5, totalPages)
  const firstVisiblePage = Math.max(
    1,
    Math.min(page - 2, totalPages - visiblePageCount + 1),
  )
  const visiblePages = Array.from(
    { length: visiblePageCount },
    (_, index) => firstVisiblePage + index,
  )

  return (
    <section className="flex flex-col gap-5">
      <div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-blue-700">Contact tasks</p>
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold text-slate-950">
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

      <div className="flex flex-col">
        <div>
          <Table
            className="min-w-[920px] table-fixed border-separate border-spacing-0"
            aria-label="Contact tasks"
          >
            <TableHeader className="drop-shadow-sm [&_tr]:border-0">
              <TableRow className="h-14 border-0 hover:bg-transparent">
                <TableHead className="w-[26%] rounded-l-xl border-y border-l bg-background px-4">
                  Task name
                </TableHead>
                <TableHead className="w-[19%] border-y bg-background px-4">
                  Service / product
                </TableHead>
                <TableHead className="w-[20%] border-y bg-background px-4">
                  Assignee
                </TableHead>
                <TableHead className="w-[11%] border-y bg-background px-4">
                  Priority
                </TableHead>
                <TableHead className="w-[12%] border-y bg-background px-4">
                  Status
                </TableHead>
                <TableHead className="w-[12%] rounded-r-xl border-y border-r bg-background px-4">
                  Due date
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow aria-hidden="true" className="h-2 border-0 hover:bg-transparent">
                <TableCell colSpan={6} className="p-0" />
              </TableRow>

              {tasks.map((task) => {
                const assignee = task.assignedToUserId
                  ? assigneesById.get(task.assignedToUserId)
                  : undefined
                const assigneeName =
                  task.assignedPersonName ?? assignee?.label ?? "Unassigned"
                const assigneeImage = task.assignedPersonImage ?? assignee?.image

                return (
                  <TableRow
                    key={task.id}
                    className="relative h-14 cursor-pointer hover:bg-blue-50/50 focus-within:bg-blue-50/50"
                  >
                    <TableCell className="px-4 py-0">
                      <Link
                        href={`/app/${tenantSlug}/tasks/${task.id}`}
                        className="block truncate font-medium text-foreground transition-colors before:absolute before:inset-0 before:z-10 before:rounded-md hover:text-blue-800 focus-visible:outline-none focus-visible:before:ring-2 focus-visible:before:ring-ring focus-visible:before:ring-offset-1"
                        title={task.name}
                        aria-label={`Open task ${task.name}`}
                      >
                        {task.name}
                      </Link>
                    </TableCell>
                    <TableCell className="px-4 py-0">
                      {task.linkedEntityName ? (
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate text-foreground" title={task.linkedEntityName}>
                            {task.linkedEntityName}
                          </span>
                          {task.linkedEntityType ? (
                            <span className="text-xs text-muted-foreground">
                              {task.linkedEntityType === "SERVICE" ? "Service" : "Product"}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Not linked</span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-0">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar size="sm">
                          {assigneeImage ? (
                            <AvatarImage src={assigneeImage} alt={`${assigneeName} profile photo`} />
                          ) : null}
                          <AvatarFallback>{assigneeName === "Unassigned" ? "—" : getInitials(assigneeName)}</AvatarFallback>
                        </Avatar>
                        <span className="truncate text-foreground" title={assigneeName}>
                          {assigneeName}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-0">
                      <PriorityBadge priority={task.priority} />
                    </TableCell>
                    <TableCell className="px-4 py-0">
                      <StatusBadge
                        label={task.status}
                        bgColor={task.statusBgColor}
                        textColor={task.statusTextColor}
                      />
                    </TableCell>
                    <TableCell className="px-4 py-0 text-foreground">
                      {formatDateForDisplay(task.dueDate, tenantTimezone)}
                    </TableCell>
                  </TableRow>
                )
              })}

              {tasks.length === 0 ? (
                <TableRow className="h-14 hover:bg-transparent">
                  <TableCell colSpan={6} className="px-4 py-0 text-center">
                    <span className="text-sm text-muted-foreground">
                      {priority
                        ? "No tasks match this priority."
                        : `No tasks are linked to ${contact.fullName} yet.`}
                    </span>
                  </TableCell>
                </TableRow>
              ) : null}

              {Array.from({ length: placeholderRowCount }, (_, index) => (
                <TableRow
                  key={`empty-task-row-${index}`}
                  aria-hidden="true"
                  className="h-14 hover:bg-transparent"
                >
                  <TableCell colSpan={6} className="px-4 py-0" />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col items-center gap-3 px-1 py-4 sm:flex-row sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {total > 0
              ? `Showing ${(page - 1) * pageSize + 1}-${(page - 1) * pageSize + tasks.length} of ${total} tasks`
              : "No tasks to show"}
          </p>
          <nav
            className="flex items-center gap-2 self-end sm:self-auto"
            aria-label="Task list pagination"
          >
            {page > 1 ? (
              <Button asChild variant="outline" size="icon-sm">
                <Link
                  href={`/app/${tenantSlug}/contacts/${contactId}/tasks?page=${page - 1}${querySuffix}`}
                  aria-label="Previous page"
                >
                  <ChevronLeft />
                </Link>
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="Previous page"
                disabled
              >
                <ChevronLeft />
              </Button>
            )}

            {visiblePages.map((pageNumber) =>
              pageNumber === page ? (
                <Button
                  key={pageNumber}
                  type="button"
                  size="icon-sm"
                  aria-label={`Page ${pageNumber}`}
                  aria-current="page"
                  disabled
                  className="disabled:opacity-100"
                >
                  {pageNumber}
                </Button>
              ) : (
                <Button key={pageNumber} asChild variant="outline" size="icon-sm">
                  <Link
                    href={`/app/${tenantSlug}/contacts/${contactId}/tasks?page=${pageNumber}${querySuffix}`}
                    aria-label={`Go to page ${pageNumber}`}
                  >
                    {pageNumber}
                  </Link>
                </Button>
              ),
            )}

            {page < totalPages ? (
              <Button asChild variant="outline" size="icon-sm">
                <Link
                  href={`/app/${tenantSlug}/contacts/${contactId}/tasks?page=${page + 1}${querySuffix}`}
                  aria-label="Next page"
                >
                  <ChevronRight />
                </Link>
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="Next page"
                disabled
              >
                <ChevronRight />
              </Button>
            )}
          </nav>
        </div>
      </div>
    </section>
  )
}
