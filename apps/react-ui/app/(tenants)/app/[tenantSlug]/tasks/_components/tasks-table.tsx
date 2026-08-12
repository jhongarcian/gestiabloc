"use client"

import { isAxiosError } from "axios"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api } from "@/lib/api"
import { formatDateTimeForDisplay } from "@/lib/date-time"
import { CreateTaskDialog } from "./create-task-dialog"

type SelectOption = {
  label: string
  value: string
  bgColor?: string
  textColor?: string
  email?: string
  image?: string | null
}

type TasksTableProps = {
  tenantSlug: string
  tenantId: string
  tenantTimezone?: string | null
  statusOptions: SelectOption[]
  assigneeOptions: SelectOption[]
}

type TaskItem = {
  id: string
  name: string
  assignedToUserId: string | null
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
}

type TasksListResponse = {
  ok: boolean
  items: TaskItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

const PAGE_SIZE_OPTIONS = [10, 25] as const
const ALL_STATUS_VALUE = "ALL"
const ALL_PRIORITY_VALUE = "ALL"

function StatusBadge({
  label,
  bgColor,
  textColor,
}: {
  label: string
  bgColor?: string
  textColor?: string
}) {
  return (
    <span
      className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-slate-700"
      style={
        bgColor && textColor
          ? { backgroundColor: bgColor, color: textColor }
          : undefined
      }
    >
      {label}
    </span>
  )
}

function PriorityBadge({
  priority,
}: {
  priority: "HIGH" | "MEDIUM" | "LOW" | null
}) {
  if (!priority) {
    return <span className="text-xs text-slate-400">No priority</span>
  }

  const styles =
    priority === "HIGH"
      ? { backgroundColor: "#FEE2E2", color: "#B91C1C" }
      : priority === "MEDIUM"
        ? { backgroundColor: "#FEF3C7", color: "#B45309" }
        : { backgroundColor: "#DBEAFE", color: "#1D4ED8" }

  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide"
      style={styles}
    >
      {priority}
    </span>
  )
}

const formatLinkedEntity = (task: TaskItem) => {
  if (!task.linkedEntityName) return "—"
  if (!task.linkedEntityType) return task.linkedEntityName

  const prefix = task.linkedEntityType === "SERVICE" ? "Service" : "Product"
  return `${prefix}: ${task.linkedEntityName}`
}

export function TasksTable({
  tenantSlug,
  tenantId,
  tenantTimezone,
  statusOptions,
  assigneeOptions,
}: TasksTableProps) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState(ALL_STATUS_VALUE)
  const [priorityFilter, setPriorityFilter] = useState(ALL_PRIORITY_VALUE)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(10)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [data, setData] = useState<TasksListResponse | null>(null)

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query.trim())
      setPage(1)
    }, 350)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [query])

  const loadTasks = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const { data: response } = await api.get<TasksListResponse>(
        `/api/tasks/${tenantId}`,
        {
          params: {
            page,
            pageSize,
            search: debouncedQuery || undefined,
            statusConfigId:
              statusFilter === ALL_STATUS_VALUE ? undefined : statusFilter,
            priority:
              priorityFilter === ALL_PRIORITY_VALUE ? undefined : priorityFilter,
          },
        },
      )
      setData(response)
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        if (typeof backendError === "string") {
          setErrorMessage(backendError.replace(/_/g, " "))
        } else {
          setErrorMessage("Could not load tasks.")
        }
      } else {
        setErrorMessage("Could not load tasks.")
      }
    } finally {
      setIsLoading(false)
    }
  }, [tenantId, page, pageSize, debouncedQuery, statusFilter, priorityFilter])

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  const tasks = data?.items ?? []
  const total = data?.pagination.total ?? 0
  const totalPages = data?.pagination.totalPages ?? 1
  const startIndex = (page - 1) * pageSize
  const canGoPrevious = page > 1
  const canGoNext = page < totalPages

  const summaryLabel = useMemo(() => {
    if (!total) return "No tasks found"
    const start = startIndex + 1
    const end = start + tasks.length - 1
    return `Showing ${start}-${end} of ${total} tasks`
  }, [startIndex, tasks.length, total])

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5">
          <h2 className="text-lg font-semibold text-slate-900">Task list</h2>
          <p className="text-sm text-slate-500">{summaryLabel}</p>
        </div>

        <CreateTaskDialog
          tenantId={tenantId}
          tenantTimezone={tenantTimezone}
          statusOptions={statusOptions}
          assigneeOptions={assigneeOptions}
          onCreated={loadTasks}
        />
      </div>

      <div className="flex flex-col gap-2 rounded-lg bg-white py-1">
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_200px_200px_auto]">
          <Input
            placeholder="Search tasks, contacts, assignees, services, or products"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(1)
            }}
          />
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              setStatusFilter(value)
              setPage(1)
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={priorityFilter}
            onValueChange={(value) => {
              setPriorityFilter(value)
              setPage(1)
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_PRIORITY_VALUE}>All Priorities</SelectItem>
              <SelectItem value="HIGH">High priority</SelectItem>
              <SelectItem value="MEDIUM">Medium priority</SelectItem>
              <SelectItem value="LOW">Low priority</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            className="border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
            onClick={() => {
              setQuery("")
              setDebouncedQuery("")
              setStatusFilter(ALL_STATUS_VALUE)
              setPriorityFilter(ALL_PRIORITY_VALUE)
              setPage(1)
            }}
          >
            Clear Filters
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-lg bg-white">
        <div className="min-h-0 flex-1 overflow-auto">
          <Table className="[&_td]:py-2 [&_th]:h-8">
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-52 text-xs">Name</TableHead>
                <TableHead className="min-w-32 text-xs">Priority</TableHead>
                <TableHead className="min-w-36 text-xs">Due Date</TableHead>
                <TableHead className="min-w-40 text-xs">Assigned To</TableHead>
                <TableHead className="min-w-40 text-xs">Started At</TableHead>
                <TableHead className="min-w-32 text-xs">Status</TableHead>
                <TableHead className="min-w-44 text-xs">Contact</TableHead>
                <TableHead className="min-w-56 text-xs">Service / Product</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-slate-500">
                    Loading tasks...
                  </TableCell>
                </TableRow>
              ) : errorMessage ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-rose-600">
                    {errorMessage}
                  </TableCell>
                </TableRow>
              ) : tasks.length ? (
                tasks.map((task) => {
                  const href = `/app/${tenantSlug}/tasks/${task.id}`

                  return (
                    <TableRow
                      key={task.id}
                      tabIndex={0}
                      role="link"
                      aria-label={`Open ${task.name} details`}
                      className="cursor-pointer transition-colors hover:bg-slate-50 focus-visible:bg-slate-50"
                      onClick={() => {
                        router.push(href)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          router.push(href)
                        }
                      }}
                    >
                      <TableCell className="font-medium text-slate-900">
                        {task.name}
                      </TableCell>
                      <TableCell>
                        <PriorityBadge priority={task.priority} />
                      </TableCell>
                      <TableCell className="text-slate-700">
                        {formatDateTimeForDisplay(task.dueDate, tenantTimezone)}
                      </TableCell>
                      <TableCell className="text-slate-700">
                        {task.assignedPersonName ?? "—"}
                      </TableCell>
                      <TableCell className="text-slate-700">
                        {formatDateTimeForDisplay(task.startedAt, tenantTimezone)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          label={task.status}
                          bgColor={task.statusBgColor ?? undefined}
                          textColor={task.statusTextColor ?? undefined}
                        />
                      </TableCell>
                      <TableCell className="text-slate-700">
                        {task.contactName ?? "—"}
                      </TableCell>
                      <TableCell className="text-slate-700">
                        {formatLinkedEntity(task)}
                      </TableCell>
                    </TableRow>
                  )
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-slate-500">
                    No tasks to display yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <span>Rows per page</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => {
              const next = Number(value)
              if (next === 10 || next === 25) {
                setPageSize(next)
                setPage(1)
              }
            }}
          >
            <SelectTrigger size="sm" className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
            disabled={!canGoPrevious || isLoading}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            Previous
          </Button>
          <span className="px-1 text-sm text-slate-600">
            Page {page} of {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
            disabled={!canGoNext || isLoading}
            onClick={() => setPage((prev) => prev + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
