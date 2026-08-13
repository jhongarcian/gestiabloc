"use client"

import { isAxiosError } from "axios"
import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
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
  assignedPersonImage: string | null
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

const PRIORITY_BADGE_STYLES = {
  LOW: "border-emerald-100 bg-emerald-50 text-emerald-700",
  MEDIUM: "border-orange-100 bg-orange-50 text-orange-700",
  HIGH: "border-red-100 bg-red-50 text-red-700",
} as const

function getInitials(name: string) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")

  return initials || "?"
}

function StatusBadge({
  label,
  bgColor,
  textColor,
}: {
  label: string
  bgColor?: string | null
  textColor?: string | null
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

function EmptyRows({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => (
    <TableRow
      key={`empty-task-row-${index}`}
      aria-hidden="true"
      className="h-14 hover:bg-transparent"
    >
      <TableCell colSpan={6} className="px-4 py-0" />
    </TableRow>
  ))
}

function LoadingRows({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => (
    <TableRow key={`loading-task-row-${index}`} className="h-14 hover:bg-transparent">
      <TableCell className="px-4 py-0">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </TableCell>
      <TableCell className="px-4 py-0">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-16" />
        </div>
      </TableCell>
      <TableCell className="px-4 py-0">
        <div className="flex items-center gap-2.5">
          <Skeleton className="size-6 rounded-full" />
          <Skeleton className="h-4 w-24" />
        </div>
      </TableCell>
      <TableCell className="px-4 py-0">
        <Skeleton className="h-5 w-14 rounded-full" />
      </TableCell>
      <TableCell className="px-4 py-0">
        <Skeleton className="h-5 w-16 rounded-full" />
      </TableCell>
      <TableCell className="px-4 py-0">
        <Skeleton className="h-4 w-20" />
      </TableCell>
    </TableRow>
  ))
}

export function TasksTable({
  tenantSlug,
  tenantId,
  tenantTimezone,
  statusOptions,
  assigneeOptions,
}: TasksTableProps) {
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
  const hasActiveFilters =
    query.length > 0 ||
    statusFilter !== ALL_STATUS_VALUE ||
    priorityFilter !== ALL_PRIORITY_VALUE
  const placeholderRowCount =
    tasks.length === 0 ? pageSize - 1 : Math.max(0, pageSize - tasks.length)

  const assigneesById = useMemo(
    () => new Map(assigneeOptions.map((assignee) => [assignee.value, assignee])),
    [assigneeOptions],
  )

  const summaryLabel = useMemo(() => {
    if (!total) return "No tasks to show"
    const start = startIndex + 1
    const end = start + tasks.length - 1
    return `Showing ${start}-${end} of ${total} tasks`
  }, [startIndex, tasks.length, total])

  const visiblePages = useMemo(() => {
    const count = Math.min(5, totalPages)
    const first = Math.max(1, Math.min(page - 2, totalPages - count + 1))
    return Array.from({ length: count }, (_, index) => first + index)
  }, [page, totalPages])

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4 rounded-xl bg-white p-3 md:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-semibold text-foreground">Task list</h2>
          <p className="text-sm text-muted-foreground">{summaryLabel}</p>
        </div>

        <CreateTaskDialog
          tenantId={tenantId}
          tenantTimezone={tenantTimezone}
          statusOptions={statusOptions}
          assigneeOptions={assigneeOptions}
          onCreated={loadTasks}
        />
      </div>

      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_200px_200px_auto]">
        <Input
          aria-label="Search tasks"
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
          <SelectTrigger aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {statusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          value={priorityFilter}
          onValueChange={(value) => {
            setPriorityFilter(value)
            setPage(1)
          }}
        >
          <SelectTrigger aria-label="Filter by priority">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL_PRIORITY_VALUE}>All Priorities</SelectItem>
              <SelectItem value="HIGH">High priority</SelectItem>
              <SelectItem value="MEDIUM">Medium priority</SelectItem>
              <SelectItem value="LOW">Low priority</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          disabled={!hasActiveFilters}
          onClick={() => {
            setQuery("")
            setDebouncedQuery("")
            setStatusFilter(ALL_STATUS_VALUE)
            setPriorityFilter(ALL_PRIORITY_VALUE)
            setPage(1)
          }}
        >
          Clear filters
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          <Table
            className="min-w-[920px] table-fixed border-separate border-spacing-0"
            aria-label="Tasks"
            aria-busy={isLoading}
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

              {isLoading ? (
                <LoadingRows count={pageSize} />
              ) : errorMessage ? (
                <>
                  <TableRow className="h-14 hover:bg-transparent">
                    <TableCell colSpan={6} className="px-4 py-0 text-center text-destructive">
                      {errorMessage}
                    </TableCell>
                  </TableRow>
                  <EmptyRows count={pageSize - 1} />
                </>
              ) : (
                <>
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
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <Link
                              href={`/app/${tenantSlug}/tasks/${task.id}`}
                              className="block truncate font-medium text-foreground transition-colors before:absolute before:inset-0 before:z-10 before:rounded-md hover:text-blue-800 focus-visible:outline-none focus-visible:before:ring-2 focus-visible:before:ring-ring focus-visible:before:ring-offset-1"
                              title={task.name}
                              aria-label={`Open task ${task.name}`}
                            >
                              {task.name}
                            </Link>
                            <span className="truncate text-xs text-muted-foreground">
                              {task.contactName ?? "No contact"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-0">
                          {task.linkedEntityName ? (
                            <div className="flex min-w-0 flex-col gap-0.5">
                              <span
                                className="truncate text-foreground"
                                title={task.linkedEntityName}
                              >
                                {task.linkedEntityName}
                              </span>
                              {task.linkedEntityType ? (
                                <span className="text-xs text-muted-foreground">
                                  {task.linkedEntityType === "SERVICE"
                                    ? "Service"
                                    : "Product"}
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
                                <AvatarImage
                                  src={assigneeImage}
                                  alt={`${assigneeName} profile photo`}
                                />
                              ) : null}
                              <AvatarFallback>
                                {assigneeName === "Unassigned"
                                  ? "—"
                                  : getInitials(assigneeName)}
                              </AvatarFallback>
                            </Avatar>
                            <span
                              className="truncate text-foreground"
                              title={assigneeName}
                            >
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
                          {hasActiveFilters
                            ? "No tasks match the current filters."
                            : "No tasks to display yet."}
                        </span>
                      </TableCell>
                    </TableRow>
                  ) : null}

                  <EmptyRows count={placeholderRowCount} />
                </>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col items-center gap-3 px-1 py-4 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-3">
            <p className="text-sm text-muted-foreground">{summaryLabel}</p>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Rows</span>
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
                <SelectTrigger
                  size="sm"
                  className="w-20"
                  aria-label="Rows per page"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

          <nav
            className="flex items-center gap-2 self-end sm:self-auto"
            aria-label="Task list pagination"
          >
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Previous page"
              disabled={!canGoPrevious || isLoading}
              onClick={() => setPage((previous) => Math.max(1, previous - 1))}
            >
              <ChevronLeft />
            </Button>

            {visiblePages.map((pageNumber) => (
              <Button
                key={pageNumber}
                type="button"
                variant={pageNumber === page ? "default" : "outline"}
                size="icon-sm"
                aria-label={
                  pageNumber === page
                    ? `Current page, page ${pageNumber}`
                    : `Go to page ${pageNumber}`
                }
                aria-current={pageNumber === page ? "page" : undefined}
                disabled={isLoading}
                onClick={() => setPage(pageNumber)}
              >
                {pageNumber}
              </Button>
            ))}

            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Next page"
              disabled={!canGoNext || isLoading}
              onClick={() => setPage((previous) => previous + 1)}
            >
              <ChevronRight />
            </Button>
          </nav>
        </div>
      </div>
    </div>
  )
}
