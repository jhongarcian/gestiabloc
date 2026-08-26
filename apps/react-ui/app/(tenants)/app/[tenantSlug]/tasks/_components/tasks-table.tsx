"use client"

import { isAxiosError } from "axios"
import Link from "next/link"
import { ChevronLeft, ChevronRight, Filter } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
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
import {
  TaskPageHeader,
  type TaskSummary,
} from "./task-page-header"

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
  summary: TaskSummary
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
  summary,
}: TasksTableProps) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState(ALL_STATUS_VALUE)
  const [priorityFilter, setPriorityFilter] = useState(ALL_PRIORITY_VALUE)
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false)
  const [draftStatusFilter, setDraftStatusFilter] = useState(ALL_STATUS_VALUE)
  const [draftPriorityFilter, setDraftPriorityFilter] = useState(
    ALL_PRIORITY_VALUE,
  )
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
  const activeFilterCount =
    (statusFilter !== ALL_STATUS_VALUE ? 1 : 0) +
    (priorityFilter !== ALL_PRIORITY_VALUE ? 1 : 0)
  const hasActiveQueryOrFilters = Boolean(query.trim()) || activeFilterCount > 0
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

  const handleTaskCreated = useCallback(async () => {
    await loadTasks()
    router.refresh()
  }, [loadTasks, router])

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4">
      <TaskPageHeader
        summary={summary}
        action={
          <CreateTaskDialog
            tenantId={tenantId}
            tenantTimezone={tenantTimezone}
            statusOptions={statusOptions}
            assigneeOptions={assigneeOptions}
            onCreated={handleTaskCreated}
          />
        }
      />

      <div className="grid gap-3 rounded-[22px] border border-slate-200 bg-white/75 p-3 shadow-sm backdrop-blur lg:grid-cols-[minmax(280px,1fr)_auto_auto]">
        <Input
          type="search"
          aria-label="Search tasks"
          placeholder="Search tasks, contacts, assignees, services, or products"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setPage(1)
          }}
          className="h-11 rounded-xl border-white/80 bg-white/85 px-4 shadow-sm backdrop-blur placeholder:text-slate-400 focus-visible:border-blue-300 focus-visible:ring-blue-100"
        />
        <Button
          type="button"
          variant="outline"
          className="h-11 cursor-pointer rounded-xl border-white/80 bg-white/85 px-4 text-blue-950 shadow-sm backdrop-blur hover:bg-white hover:text-blue-950"
          onClick={() => {
            setDraftStatusFilter(statusFilter)
            setDraftPriorityFilter(priorityFilter)
            setIsFilterSheetOpen(true)
          }}
        >
          <Filter data-icon="inline-start" />
          Filters
          {activeFilterCount > 0 ? (
            <Badge className="min-w-5 bg-blue-950 px-1.5 text-white">
              {activeFilterCount}
            </Badge>
          ) : null}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!hasActiveQueryOrFilters}
          className="h-11 cursor-pointer rounded-xl border-white/80 bg-white/70 px-4 text-slate-700 shadow-sm backdrop-blur hover:bg-white hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-55"
          onClick={() => {
            setQuery("")
            setDebouncedQuery("")
            setStatusFilter(ALL_STATUS_VALUE)
            setPriorityFilter(ALL_PRIORITY_VALUE)
            setDraftStatusFilter(ALL_STATUS_VALUE)
            setDraftPriorityFilter(ALL_PRIORITY_VALUE)
            setPage(1)
          }}
        >
          Clear filters
        </Button>
      </div>

      <Sheet
        open={isFilterSheetOpen}
        onOpenChange={(nextOpen) => {
          setIsFilterSheetOpen(nextOpen)
          if (!nextOpen) {
            setDraftStatusFilter(statusFilter)
            setDraftPriorityFilter(priorityFilter)
          }
        }}
      >
        <SheetContent
          side="right"
          className="flex h-full w-full flex-col gap-0 overflow-hidden border-l border-slate-200 bg-white p-0 sm:max-w-lg [&>button]:right-5 [&>button]:top-5 [&>button]:cursor-pointer [&>button]:rounded-full [&>button]:bg-white/80 [&>button]:opacity-100 [&>button]:shadow-sm [&>button]:backdrop-blur"
        >
          <SheetHeader className="relative overflow-hidden border-b border-blue-100 bg-[#f1f7ff] px-6 py-6 text-left sm:px-7">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(30,64,175,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(30,64,175,.08)_1px,transparent_1px)] [background-size:42px_42px]"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-12 -bottom-20 size-48 rounded-full bg-blue-300/30 blur-3xl"
            />
            <div className="relative pr-10">
              <div className="flex min-w-0 flex-col gap-1.5">
                <p className="text-xs font-semibold text-blue-700">
                  Task filters
                </p>
                <SheetTitle className="text-xl font-semibold text-slate-950 sm:text-2xl">
                  Refine tasks
                </SheetTitle>
                <SheetDescription className="max-w-xl text-sm leading-6 text-slate-600">
                  Filter tasks by status and priority.
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6 [scrollbar-gutter:stable] sm:px-7">
            <FieldGroup className="gap-6">
              <Field className="gap-2">
                <FieldLabel htmlFor="task-status-filter" className="text-slate-800">
                  Status
                </FieldLabel>
                <Select
                  value={draftStatusFilter}
                  onValueChange={setDraftStatusFilter}
                >
                  <SelectTrigger
                    id="task-status-filter"
                    className="h-11 w-full rounded-xl border-slate-200 bg-slate-50/60 px-3 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
                  >
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
                <FieldDescription className="text-xs">
                  Show tasks matching the selected workflow status.
                </FieldDescription>
              </Field>

              <Field className="gap-2">
                <FieldLabel
                  htmlFor="task-priority-filter"
                  className="text-slate-800"
                >
                  Priority
                </FieldLabel>
                <Select
                  value={draftPriorityFilter}
                  onValueChange={setDraftPriorityFilter}
                >
                  <SelectTrigger
                    id="task-priority-filter"
                    className="h-11 w-full rounded-xl border-slate-200 bg-slate-50/60 px-3 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
                  >
                    <SelectValue placeholder="Priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={ALL_PRIORITY_VALUE}>
                        All priorities
                      </SelectItem>
                      <SelectItem value="HIGH">High priority</SelectItem>
                      <SelectItem value="MEDIUM">Medium priority</SelectItem>
                      <SelectItem value="LOW">Low priority</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription className="text-xs">
                  Focus the task list on one priority level.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </div>

          <SheetFooter className="border-t border-slate-200 bg-slate-50/80 px-6 py-4 sm:flex-row sm:justify-end sm:px-7">
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
              onClick={() => {
                setDraftStatusFilter(ALL_STATUS_VALUE)
                setDraftPriorityFilter(ALL_PRIORITY_VALUE)
              }}
            >
              Clear
            </Button>
            <Button
              type="button"
              className="min-w-32 cursor-pointer bg-blue-950 text-white shadow-sm hover:bg-blue-900"
              onClick={() => {
                setStatusFilter(draftStatusFilter)
                setPriorityFilter(draftPriorityFilter)
                setPage(1)
                setIsFilterSheetOpen(false)
              }}
            >
              Apply filters
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <section
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm"
        aria-label="Task list"
      >
        <div className="min-h-0 flex-1 overflow-auto px-4 pt-4">
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
                          {hasActiveQueryOrFilters
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

        <footer className="flex flex-col items-center gap-3 border-t border-slate-200 px-4 py-4 sm:flex-row sm:justify-between">
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
        </footer>
      </section>
    </div>
  )
}
