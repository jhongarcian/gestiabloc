"use client"

import { isAxiosError } from "axios"
import Link from "next/link"
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api } from "@/lib/api"
import { formatDateForDisplay } from "@/lib/date-time"
import { cn } from "@/lib/utils"
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

type TaskSort =
  | "DUE_ASC"
  | "DUE_DESC"
  | "CREATED_DESC"
  | "CREATED_ASC"
  | "UPDATED_DESC"

const PAGE_SIZE_OPTIONS = [10, 25] as const
const ALL_STATUS_VALUE = "ALL"
const ALL_PRIORITY_VALUE = "ALL"
const ALL_ASSIGNEE_FILTER = "ALL"
const UNASSIGNED_ASSIGNEE_FILTER = "__UNASSIGNED__"
const DEFAULT_SORT: TaskSort = "DUE_ASC"

const SORT_OPTIONS: Array<{ value: TaskSort; label: string }> = [
  { value: "DUE_ASC", label: "Due date soonest" },
  { value: "DUE_DESC", label: "Due date latest" },
  { value: "CREATED_DESC", label: "Recently created" },
  { value: "CREATED_ASC", label: "Oldest created" },
  { value: "UPDATED_DESC", label: "Recently updated" },
]

const PRIORITY_BADGE_STYLES = {
  LOW: "border-emerald-100 bg-emerald-50 text-emerald-700",
  MEDIUM: "border-orange-100 bg-orange-50 text-orange-700",
  HIGH: "border-red-100 bg-red-50 text-red-700",
} as const

function parseSort(value: string | null): TaskSort {
  return SORT_OPTIONS.some((option) => option.value === value)
    ? (value as TaskSort)
    : DEFAULT_SORT
}

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeSelectFilter(value: string | null, fallback: string) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : fallback
}

function parsePriorityFilter(value: string | null) {
  return value === "HIGH" || value === "MEDIUM" || value === "LOW"
    ? value
    : ALL_PRIORITY_VALUE
}

function sanitizeTaskSearchInput(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .replace(/^\s+/, "")
    .slice(0, 120)
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

function AssigneeFilterPicker({
  assignees,
  value,
  onValueChange,
  id,
}: {
  assignees: SelectOption[]
  value: string
  onValueChange: (value: string) => void
  id: string
}) {
  const [open, setOpen] = useState(false)

  const selectedAssignee = useMemo(
    () => assignees.find((assignee) => assignee.value === value) ?? null,
    [assignees, value],
  )
  const isUnassigned = value === UNASSIGNED_ASSIGNEE_FILTER
  const hasSelectedAssignee = value !== ALL_ASSIGNEE_FILTER && !isUnassigned
  const triggerLabel = isUnassigned
    ? "Not assigned"
    : (selectedAssignee?.label ??
      (hasSelectedAssignee ? "Selected assignee" : "All assignees"))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-expanded={open}
          className="h-11 w-full justify-between rounded-xl border-blue-100 bg-white px-3 shadow-none hover:bg-white focus-visible:border-blue-400 focus-visible:ring-blue-100"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <Avatar
              size="sm"
              className={cn(
                (selectedAssignee || hasSelectedAssignee) &&
                  "ring-2 ring-blue-50",
              )}
            >
              {selectedAssignee?.image ? (
                <AvatarImage
                  src={selectedAssignee.image}
                  alt={`${selectedAssignee.label} profile photo`}
                  className="object-cover"
                />
              ) : null}
              <AvatarFallback
                className={cn(
                  "font-semibold",
                  selectedAssignee || hasSelectedAssignee
                    ? "bg-blue-950 text-white"
                    : "bg-slate-100 text-slate-500",
                )}
              >
                {selectedAssignee
                  ? getInitials(selectedAssignee.label)
                  : hasSelectedAssignee
                    ? "?"
                    : "—"}
              </AvatarFallback>
            </Avatar>
            <span className="truncate font-medium text-slate-800">
              {triggerLabel}
            </span>
          </span>
          <ChevronDown data-icon="inline-end" className="ml-auto text-slate-400" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command>
          <CommandInput placeholder="Search team members..." />
          <CommandList>
            <CommandEmpty>No team members found.</CommandEmpty>
            <CommandGroup heading="Assignee">
              <CommandItem
                value="All assignees no owner filter"
                onSelect={() => {
                  onValueChange(ALL_ASSIGNEE_FILTER)
                  setOpen(false)
                }}
                className="cursor-pointer gap-3 py-2.5"
              >
                <Avatar size="sm">
                  <AvatarFallback className="bg-slate-100 font-semibold text-slate-500">
                    —
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 font-medium text-slate-700">
                  All assignees
                </span>
                <Check
                  className={cn(
                    "text-blue-800",
                    value === ALL_ASSIGNEE_FILTER ? "opacity-100" : "opacity-0",
                  )}
                />
              </CommandItem>

              <CommandItem
                value="Not assigned unassigned no owner"
                onSelect={() => {
                  onValueChange(UNASSIGNED_ASSIGNEE_FILTER)
                  setOpen(false)
                }}
                className="cursor-pointer gap-3 py-2.5"
              >
                <Avatar size="sm">
                  <AvatarFallback className="bg-slate-100 font-semibold text-slate-500">
                    —
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 font-medium text-slate-700">
                  Not assigned
                </span>
                <Check
                  className={cn(
                    "text-blue-800",
                    value === UNASSIGNED_ASSIGNEE_FILTER
                      ? "opacity-100"
                      : "opacity-0",
                  )}
                />
              </CommandItem>

              {assignees.map((assignee) => (
                <CommandItem
                  key={assignee.value}
                  value={`${assignee.label} ${assignee.email ?? ""} ${assignee.value}`}
                  onSelect={() => {
                    onValueChange(assignee.value)
                    setOpen(false)
                  }}
                  className="cursor-pointer gap-3 py-2.5"
                >
                  <Avatar size="sm" className="ring-2 ring-blue-50">
                    {assignee.image ? (
                      <AvatarImage
                        src={assignee.image}
                        alt={`${assignee.label} profile photo`}
                        className="object-cover"
                      />
                    ) : null}
                    <AvatarFallback className="bg-blue-950 font-semibold text-white">
                      {getInitials(assignee.label)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium text-slate-900">
                      {assignee.label}
                    </span>
                    {assignee.email ? (
                      <span className="truncate text-xs text-slate-500">
                        {assignee.email}
                      </span>
                    ) : null}
                  </span>
                  <Check
                    className={cn(
                      "text-blue-800",
                      value === assignee.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
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
      className="max-w-32 truncate"
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

function TaskMobileCard({
  task,
  assigneeName,
  assigneeImage,
  tenantTimezone,
  onOpen,
}: {
  task: TaskItem
  assigneeName: string
  assigneeImage?: string | null
  tenantTimezone?: string | null
  onOpen: () => void
}) {
  const linkedEntityLabel =
    task.linkedEntityType === "SERVICE"
      ? "Service"
      : task.linkedEntityType === "PRODUCT"
        ? "Product"
        : "Service / product"

  return (
    <Card
      role="link"
      tabIndex={0}
      aria-label={`Open task ${task.name}`}
      className="group cursor-pointer gap-0 rounded-[22px] border-slate-200 bg-white py-0 shadow-sm outline-none transition-[border-color,box-shadow,transform] hover:border-blue-200 hover:shadow-md focus-visible:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-500/40 active:scale-[0.995] motion-reduce:transform-none motion-reduce:transition-none"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <CardHeader className="gap-1.5 px-4 pt-4 pb-3 has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
        <CardTitle className="truncate pr-2 text-base text-slate-950" title={task.name}>
          {task.name}
        </CardTitle>
        <CardDescription className="truncate text-sm font-medium text-slate-600">
          {task.contactName ?? "No contact linked"}
        </CardDescription>
        <CardAction className="flex max-w-36 items-center gap-1.5">
          <StatusBadge
            label={task.status}
            bgColor={task.statusBgColor}
            textColor={task.statusTextColor}
          />
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5"
          />
        </CardAction>
      </CardHeader>

      <CardContent className="grid min-w-0 grid-cols-2 items-start gap-4 px-4 pb-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs font-medium text-slate-500">
            {task.linkedEntityName ? linkedEntityLabel : "Service / product"}
          </p>
          <p
            className="truncate text-sm font-medium text-slate-700"
            title={task.linkedEntityName ?? undefined}
          >
            {task.linkedEntityName ?? "Not linked"}
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="text-xs font-medium text-slate-500">Assigned to</p>
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar size="sm">
              {assigneeImage ? (
                <AvatarImage
                  src={assigneeImage}
                  alt={`${assigneeName} profile photo`}
                  className="object-cover"
                />
              ) : null}
              <AvatarFallback>
                {assigneeName === "Unassigned" ? "—" : getInitials(assigneeName)}
              </AvatarFallback>
            </Avatar>
            <span
              className="truncate text-sm font-medium text-slate-700"
              title={assigneeName}
            >
              {assigneeName}
            </span>
          </div>
        </div>
      </CardContent>

      <Separator />
      <CardFooter className="grid grid-cols-2 gap-4 bg-slate-50/60 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs font-medium text-slate-500">Priority</p>
          <div><PriorityBadge priority={task.priority} /></div>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs font-medium text-slate-500">Due date</p>
          <p className="text-xs leading-5 text-slate-700">
            {formatDateForDisplay(task.dueDate, tenantTimezone)}
          </p>
        </div>
      </CardFooter>
    </Card>
  )
}

function TaskMobileCardSkeleton() {
  return (
    <Card aria-hidden="true" className="gap-0 rounded-[22px] py-0 shadow-sm">
      <CardHeader className="gap-2 px-4 pt-4 pb-3 has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
        <CardTitle><Skeleton className="h-5 w-3/5" /></CardTitle>
        <CardDescription><Skeleton className="h-4 w-2/5" /></CardDescription>
        <CardAction><Skeleton className="h-5 w-20 rounded-full" /></CardAction>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 px-4 pb-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-4 w-4/5" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-16" />
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
      </CardContent>
      <Separator />
      <CardFooter className="grid grid-cols-2 gap-4 bg-slate-50/60 px-4 py-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-4 w-24" />
        </div>
      </CardFooter>
    </Card>
  )
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
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [query, setQuery] = useState(() =>
    sanitizeTaskSearchInput(searchParams.get("search") ?? ""),
  )
  const [debouncedQuery, setDebouncedQuery] = useState(() =>
    sanitizeTaskSearchInput(searchParams.get("search") ?? "").trim(),
  )
  const [statusFilter, setStatusFilter] = useState(() =>
    normalizeSelectFilter(searchParams.get("statusConfigId"), ALL_STATUS_VALUE),
  )
  const [priorityFilter, setPriorityFilter] = useState(() =>
    parsePriorityFilter(searchParams.get("priority")),
  )
  const [assigneeFilter, setAssigneeFilter] = useState(() =>
    normalizeSelectFilter(
      searchParams.get("assignedToUserId"),
      ALL_ASSIGNEE_FILTER,
    ),
  )
  const [sort, setSort] = useState<TaskSort>(() =>
    parseSort(searchParams.get("sort")),
  )
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false)
  const [isSortSheetOpen, setIsSortSheetOpen] = useState(false)
  const [draftStatusFilter, setDraftStatusFilter] = useState(statusFilter)
  const [draftPriorityFilter, setDraftPriorityFilter] = useState(
    priorityFilter,
  )
  const [draftAssigneeFilter, setDraftAssigneeFilter] = useState(
    assigneeFilter,
  )
  const [page, setPage] = useState(() =>
    parsePositiveInt(searchParams.get("page"), 1),
  )
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(
    () => {
      const parsed = parsePositiveInt(searchParams.get("pageSize"), 10)
      return parsed === 25 ? 25 : 10
    },
  )
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [data, setData] = useState<TasksListResponse | null>(null)

  useEffect(() => {
    const normalizedQuery = sanitizeTaskSearchInput(query).trim()
    if (normalizedQuery === debouncedQuery) return

    const timeout = window.setTimeout(() => {
      setDebouncedQuery(normalizedQuery)
      setPage(1)
    }, 300)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [debouncedQuery, query])

  const serializedState = useMemo(() => {
    const nextParams = new URLSearchParams()

    if (debouncedQuery) nextParams.set("search", debouncedQuery)
    if (statusFilter !== ALL_STATUS_VALUE) {
      nextParams.set("statusConfigId", statusFilter)
    }
    if (priorityFilter !== ALL_PRIORITY_VALUE) {
      nextParams.set("priority", priorityFilter)
    }
    if (assigneeFilter !== ALL_ASSIGNEE_FILTER) {
      nextParams.set("assignedToUserId", assigneeFilter)
    }
    if (sort !== DEFAULT_SORT) nextParams.set("sort", sort)
    if (page > 1) nextParams.set("page", String(page))
    if (pageSize !== 10) nextParams.set("pageSize", String(pageSize))

    return nextParams.toString()
  }, [
    assigneeFilter,
    debouncedQuery,
    page,
    pageSize,
    priorityFilter,
    sort,
    statusFilter,
  ])

  useEffect(() => {
    if (serializedState === searchParams.toString()) return

    startTransition(() => {
      router.replace(serializedState ? `${pathname}?${serializedState}` : pathname, {
        scroll: false,
      })
    })
  }, [pathname, router, searchParams, serializedState])

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
            assignedToUserId:
              assigneeFilter === ALL_ASSIGNEE_FILTER
                ? undefined
                : assigneeFilter,
            sort,
          },
        },
      )
      setData(response)
      if (page > response.pagination.totalPages) {
        setPage(response.pagination.totalPages)
      }
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
  }, [
    assigneeFilter,
    tenantId,
    page,
    pageSize,
    debouncedQuery,
    statusFilter,
    priorityFilter,
    sort,
  ])

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
    (priorityFilter !== ALL_PRIORITY_VALUE ? 1 : 0) +
    (assigneeFilter !== ALL_ASSIGNEE_FILTER ? 1 : 0)
  const hasActiveQueryOrFilters = Boolean(debouncedQuery) || activeFilterCount > 0
  const hasDraftFilters =
    draftStatusFilter !== ALL_STATUS_VALUE ||
    draftPriorityFilter !== ALL_PRIORITY_VALUE ||
    draftAssigneeFilter !== ALL_ASSIGNEE_FILTER
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
  const selectedSortLabel =
    SORT_OPTIONS.find((option) => option.value === sort)?.label ??
    "Due date soonest"
  const currentRegisterHref = serializedState
    ? `${pathname}?${serializedState}`
    : pathname

  const getTaskHref = (taskId: string) => {
    const detailParams = new URLSearchParams({ returnTo: currentRegisterHref })
    return `/app/${encodeURIComponent(tenantSlug)}/tasks/${encodeURIComponent(taskId)}?${detailParams.toString()}`
  }

  const clearFilters = () => {
    setStatusFilter(ALL_STATUS_VALUE)
    setPriorityFilter(ALL_PRIORITY_VALUE)
    setAssigneeFilter(ALL_ASSIGNEE_FILTER)
    setDraftStatusFilter(ALL_STATUS_VALUE)
    setDraftPriorityFilter(ALL_PRIORITY_VALUE)
    setDraftAssigneeFilter(ALL_ASSIGNEE_FILTER)
    setPage(1)
    setIsFilterSheetOpen(false)
  }

  const handleTaskCreated = useCallback(async () => {
    await loadTasks()
    router.refresh()
  }, [loadTasks, router])

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4">
      <TaskPageHeader
        summary={summary}
        action={
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <form
              role="search"
              className="relative w-full lg:min-w-0 lg:flex-1"
              onSubmit={(event) => {
                event.preventDefault()
                setDebouncedQuery(sanitizeTaskSearchInput(query).trim())
                setPage(1)
              }}
            >
              <Input
                type="search"
                maxLength={120}
                aria-label="Search tasks by name, contact, assignee, service, or product"
                placeholder="Search tasks"
                value={query}
                onChange={(event) => {
                  setQuery(sanitizeTaskSearchInput(event.target.value))
                }}
                className="h-11 w-full rounded-xl border-white/80 bg-white/85 pr-14 pl-4 text-sm shadow-sm backdrop-blur placeholder:text-slate-400 focus-visible:border-blue-300 focus-visible:ring-blue-100"
              />
              <Button
                type="submit"
                size="icon-lg"
                aria-label="Search tasks"
                className="absolute inset-y-0 right-0 h-11 w-12 rounded-l-none rounded-r-xl bg-blue-950 text-white shadow-none hover:bg-blue-900"
              >
                <Search aria-hidden="true" />
              </Button>
            </form>

            <div className="grid w-full grid-cols-3 gap-2 md:grid-cols-4 lg:flex lg:w-auto lg:shrink-0">
              <Button
                type="button"
                variant="outline"
                aria-label={
                  activeFilterCount > 0
                    ? `Open filters, ${activeFilterCount} active`
                    : "Open filters"
                }
                aria-expanded={isFilterSheetOpen}
                aria-controls="task-filter-sheet"
                className="h-11 min-w-0 cursor-pointer rounded-full border-white/80 bg-white/85 px-2.5 text-xs font-semibold text-blue-950 shadow-sm backdrop-blur hover:bg-white hover:text-blue-950 sm:px-3 sm:text-sm"
                onClick={() => {
                  setDraftStatusFilter(statusFilter)
                  setDraftPriorityFilter(priorityFilter)
                  setDraftAssigneeFilter(assigneeFilter)
                  setIsFilterSheetOpen(true)
                }}
              >
                <Filter data-icon="inline-start" aria-hidden="true" />
                <span className="sm:hidden">Filter</span>
                <span className="hidden sm:inline">Filters</span>
                {activeFilterCount > 0 ? (
                  <Badge className="h-5 min-w-5 rounded-full bg-blue-950 px-1.5 text-[10px] text-white">
                    {activeFilterCount}
                  </Badge>
                ) : null}
              </Button>

              <Button
                type="button"
                variant="outline"
                aria-label={`Sort tasks, currently ${selectedSortLabel}`}
                aria-expanded={isSortSheetOpen}
                aria-controls="task-sort-sheet"
                className="h-11 min-w-0 cursor-pointer rounded-full border-white/80 bg-white/70 px-2.5 text-xs font-semibold text-slate-800 shadow-sm backdrop-blur hover:bg-white hover:text-slate-950 sm:px-3 sm:text-sm lg:hidden"
                onClick={() => setIsSortSheetOpen(true)}
              >
                <span className="sm:hidden">Sort</span>
                <span className="hidden truncate sm:inline">{selectedSortLabel}</span>
                <ChevronDown data-icon="inline-end" aria-hidden="true" />
              </Button>

              <Select
                value={sort}
                onValueChange={(value) => {
                  setSort(parseSort(value))
                  setPage(1)
                }}
              >
                <SelectTrigger
                  size="sm"
                  aria-label={`Sort tasks, currently ${selectedSortLabel}`}
                  className="hidden min-w-48 rounded-full border-white/80 bg-white/70 px-3 text-sm font-semibold text-slate-800 shadow-sm backdrop-blur hover:bg-white data-[size=sm]:h-11 lg:flex"
                >
                  <span className="text-slate-500">Sort by</span>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectGroup>
                    {SORT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>

              <Button
                type="button"
                variant="outline"
                disabled={activeFilterCount === 0}
                className="hidden h-11 min-w-0 cursor-pointer rounded-full border-white/80 bg-white/70 px-3 text-sm font-semibold text-slate-700 shadow-sm backdrop-blur hover:bg-white hover:text-slate-950 md:inline-flex"
                onClick={clearFilters}
              >
                Clear filters
              </Button>

              <CreateTaskDialog
                tenantId={tenantId}
                tenantTimezone={tenantTimezone}
                statusOptions={statusOptions}
                assigneeOptions={assigneeOptions}
                onCreated={handleTaskCreated}
                trigger={
                  <Button
                    type="button"
                    className="h-11 min-w-0 w-full cursor-pointer rounded-full bg-blue-950 px-2 text-xs font-semibold text-white shadow-sm ring-1 ring-black/5 hover:bg-blue-900 sm:px-3 sm:text-sm lg:w-auto lg:px-4"
                  >
                    <Plus data-icon="inline-start" aria-hidden="true" />
                    <span className="sm:hidden">Add</span>
                    <span className="hidden sm:inline">Create task</span>
                  </Button>
                }
              />
            </div>
          </div>
        }
      />

      <Sheet open={isSortSheetOpen} onOpenChange={setIsSortSheetOpen}>
        <SheetContent
          id="task-sort-sheet"
          side="bottom"
          className="mx-auto max-h-[min(32rem,72dvh)] w-full gap-0 overflow-hidden rounded-t-[26px] border-x border-t border-slate-200 bg-white p-0 sm:bottom-4 sm:left-1/2 sm:right-auto sm:w-[min(32rem,calc(100%-2rem))] sm:-translate-x-1/2 sm:rounded-[26px] sm:border [&>button]:right-5 [&>button]:top-5 [&>button]:cursor-pointer [&>button]:rounded-full [&>button]:bg-slate-100 [&>button]:opacity-100"
        >
          <div
            aria-hidden="true"
            className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-slate-200 sm:hidden"
          />
          <SheetHeader className="border-b border-slate-100 px-5 pt-4 pb-3 text-left sm:px-6 sm:pt-5">
            <SheetTitle className="pr-10 text-lg font-semibold text-slate-950">
              Sort tasks
            </SheetTitle>
            <SheetDescription className="sr-only">
              Choose the order used for the task register.
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:px-5 sm:pb-5">
            <ToggleGroup
              type="single"
              value={sort}
              orientation="vertical"
              spacing={2}
              aria-label="Choose task order"
              className="grid w-full gap-2"
              onValueChange={(value) => {
                if (!value) return
                setSort(parseSort(value))
                setPage(1)
                setIsSortSheetOpen(false)
              }}
            >
              {SORT_OPTIONS.map((option) => {
                const isSelected = option.value === sort

                return (
                  <ToggleGroupItem
                    key={option.value}
                    value={option.value}
                    variant="outline"
                    aria-label={`Sort by ${option.label}`}
                    className="h-12 w-full justify-between rounded-xl border-slate-200 bg-white px-4 text-left text-sm font-medium text-slate-700 shadow-none hover:bg-slate-50 hover:text-slate-950 data-[state=on]:border-blue-200 data-[state=on]:bg-blue-50 data-[state=on]:text-blue-950"
                  >
                    <span>{option.label}</span>
                    <Check
                      aria-hidden="true"
                      className={cn(
                        "text-blue-800 transition-opacity",
                        isSelected ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </ToggleGroupItem>
                )
              })}
            </ToggleGroup>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet
        open={isFilterSheetOpen}
        onOpenChange={(nextOpen) => {
          setIsFilterSheetOpen(nextOpen)
          if (!nextOpen) {
            setDraftStatusFilter(statusFilter)
            setDraftPriorityFilter(priorityFilter)
            setDraftAssigneeFilter(assigneeFilter)
          }
        }}
      >
        <SheetContent
          id="task-filter-sheet"
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
                  Filter tasks by status, priority, and assignee.
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

              <Field className="gap-2">
                <FieldLabel
                  htmlFor="task-assignee-filter"
                  className="text-slate-800"
                >
                  Assigned to
                </FieldLabel>
                <AssigneeFilterPicker
                  id="task-assignee-filter"
                  assignees={assigneeOptions}
                  value={draftAssigneeFilter}
                  onValueChange={setDraftAssigneeFilter}
                />
                <FieldDescription className="text-xs">
                  Show tasks owned by a specific team member or tasks without an owner.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </div>

          <SheetFooter className="border-t border-slate-200 bg-slate-50/80 px-6 py-4 sm:flex-row sm:justify-end sm:px-7">
            <Button
              type="button"
              variant="outline"
              disabled={!hasDraftFilters && activeFilterCount === 0}
              className="cursor-pointer border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
              onClick={clearFilters}
            >
              Clear filters
            </Button>
            <Button
              type="button"
              className="min-w-32 cursor-pointer bg-blue-950 text-white shadow-sm hover:bg-blue-900"
              onClick={() => {
                setStatusFilter(draftStatusFilter)
                setPriorityFilter(draftPriorityFilter)
                setAssigneeFilter(draftAssigneeFilter)
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
        <div
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 md:hidden"
          aria-busy={isLoading}
        >
          {isLoading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 3 }, (_, index) => (
                <TaskMobileCardSkeleton key={`task-card-skeleton-${index}`} />
              ))}
            </div>
          ) : errorMessage ? (
            <Card className="gap-4 rounded-[22px] border-dashed border-rose-200 bg-rose-50/40 py-5 shadow-none">
              <CardHeader className="gap-1 px-5">
                <CardTitle className="text-base text-slate-950">
                  Tasks could not be loaded
                </CardTitle>
                <CardDescription>{errorMessage}</CardDescription>
              </CardHeader>
              <CardFooter className="px-5">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-full bg-white"
                  onClick={() => void loadTasks()}
                >
                  <RefreshCw data-icon="inline-start" aria-hidden="true" />
                  Retry
                </Button>
              </CardFooter>
            </Card>
          ) : tasks.length ? (
            <div className="flex flex-col gap-3">
              {tasks.map((task) => {
                const assignee = task.assignedToUserId
                  ? assigneesById.get(task.assignedToUserId)
                  : undefined
                const assigneeName =
                  task.assignedPersonName ?? assignee?.label ?? "Unassigned"
                const assigneeImage = task.assignedPersonImage ?? assignee?.image

                return (
                  <TaskMobileCard
                    key={task.id}
                    task={task}
                    assigneeName={assigneeName}
                    assigneeImage={assigneeImage}
                    tenantTimezone={tenantTimezone}
                    onOpen={() => router.push(getTaskHref(task.id))}
                  />
                )
              })}
            </div>
          ) : (
            <Card className="gap-1 rounded-[22px] border-dashed border-slate-200 bg-slate-50/60 py-7 text-center shadow-none">
              <CardHeader className="gap-1 px-5">
                <CardTitle className="text-base text-slate-950">
                  {hasActiveQueryOrFilters ? "No matching tasks" : "No tasks yet"}
                </CardTitle>
                <CardDescription>
                  {hasActiveQueryOrFilters
                    ? "Try changing the search or filters."
                    : "Create a task to start organizing the work."}
                </CardDescription>
              </CardHeader>
            </Card>
          )}
        </div>

        <div className="hidden min-h-0 flex-1 overflow-auto px-4 pt-4 md:block">
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
                              href={getTaskHref(task.id)}
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

        <footer className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50/40 px-3 py-3 md:flex-row md:items-center md:justify-between md:bg-white md:px-4 md:py-4">
          <div className="flex w-full items-center justify-between gap-3 md:w-auto md:flex-wrap md:justify-start md:gap-x-5 md:gap-y-3">
            {isLoading ? (
              <Skeleton className="h-4 w-36" />
            ) : (
              <p
                className="min-w-0 truncate text-xs text-slate-500 sm:text-sm"
                aria-live="polite"
              >
                {summaryLabel}
              </p>
            )}
            <div className="flex shrink-0 items-center gap-2 text-xs text-slate-600 sm:text-sm">
              <span className="sm:hidden">Per page</span>
              <span className="hidden sm:inline">Rows per page</span>
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
                  aria-label="Rows per page"
                  className="w-16 rounded-lg bg-white sm:w-20"
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
            className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm md:flex md:w-auto md:justify-start md:self-auto md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none"
            aria-label="Task list pagination"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Previous page"
              disabled={!canGoPrevious || isLoading}
              className="h-10 min-w-0 rounded-xl px-3 text-xs text-slate-700 shadow-none md:size-8 md:rounded-md md:px-0"
              onClick={() => setPage((previous) => Math.max(1, previous - 1))}
            >
              <ChevronLeft aria-hidden="true" />
              <span className="md:sr-only">Previous</span>
            </Button>

            <span
              className="min-w-20 rounded-xl bg-slate-50 px-2 py-2 text-center text-xs tabular-nums text-slate-500 md:hidden"
              aria-live="polite"
            >
              <span className="font-semibold text-slate-900">{page}</span> of {totalPages}
            </span>

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
                className="hidden md:inline-flex"
                onClick={() => setPage(pageNumber)}
              >
                {pageNumber}
              </Button>
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Next page"
              disabled={!canGoNext || isLoading}
              className="h-10 min-w-0 rounded-xl px-3 text-xs text-slate-700 shadow-none md:size-8 md:rounded-md md:px-0"
              onClick={() => setPage((previous) => previous + 1)}
            >
              <span className="md:sr-only">Next</span>
              <ChevronRight aria-hidden="true" />
            </Button>
          </nav>
        </footer>
      </section>
    </div>
  )
}
