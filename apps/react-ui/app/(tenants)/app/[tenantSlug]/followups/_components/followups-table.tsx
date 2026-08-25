"use client"

import { isAxiosError } from "axios"
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Filter,
  Gauge,
} from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { startTransition, useCallback, useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api } from "@/lib/api"
import { formatDateTimeForDisplay } from "@/lib/date-time"
import { formatPhoneNumber } from "@/lib/format-phone-number"
import { cn } from "@/lib/utils"

type FollowUpsTableProps = {
  tenantSlug: string
  tenantId: string
  tenantTimezone?: string | null
}

type CurrentStepStatus = "PENDING" | "ACTIVE" | "COMPLETED" | "SKIPPED" | "POSTPONED"

type EnrollmentRow = {
  id: string
  status: "IN_PROGRESS" | "PENDING_PAYMENT" | "COMPLETED" | "CANCELED"
  contactId: string
  contactName: string
  phoneNumber: string | null
  serviceId: string
  serviceName: string
  followUpTemplateId: string | null
  followUpTemplateName: string | null
  followUpTemplateVersion?: { id: string; versionNumber: number } | null
  followUpRun?: {
    id: string
    status: "RUNNING" | "WAITING" | "AWAITING_STEP" | "COMPLETED" | "FAILED" | "NEEDS_REVIEW" | "CANCELED"
    failureMessage: string | null
  } | null
  currentStep: {
    id: string
    title: string
    status: CurrentStepStatus
    availableAt: string | null
    dueAt: string | null
    completedAt: string | null
    assignedToUserId: string | null
    assignedToName: string | null
    note: string | null
    sortOrder: number
    stepNumber: number | null
    resolutionSource?: "USER_COMPLETED" | "USER_SKIPPED" | "CONDITION_SKIPPED" | "FLOW_SKIPPED" | null
    resolutionReason?: string | null
  } | null
  progress: {
    completedCount: number
    totalCount: number
    remainingCount: number
    completionPercentage: number
  }
  overdue: boolean
}

type FollowUpsResponse = {
  ok: boolean
  items: EnrollmentRow[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  summary: {
    servicesInProgress: number
    overdueEnrollments: number
    dueToday: number
    averageProgress: number
  }
}

type FollowUpTemplateOption = {
  id: string
  name: string
}

type AssigneeOption = {
  value: string
  label: string
  email: string
  image: string | null
}

const PAGE_SIZE_OPTIONS = [10, 25] as const
const DEFAULT_STATUS = "ACTIVE"
const ALL_STATUS = "ALL"
const ALL_DUE_DATE_PRESETS = "ALL"
const ALL_TEMPLATE_FILTER = "ALL"
const ALL_ASSIGNEE_FILTER = "ALL"
const FOLLOW_UP_TAB_VALUES = [
  ALL_DUE_DATE_PRESETS,
  "TODAY",
  "OVERDUE",
  "NEXT_7_DAYS",
] as const
const FOLLOW_UP_TABS = [
  { value: ALL_DUE_DATE_PRESETS, label: "All Due Dates" },
  { value: "TODAY", label: "Due Today" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "NEXT_7_DAYS", label: "Next 7 Days" },
] as const

function sanitizeDueDateTab(value: string | null) {
  if (!value) return ALL_DUE_DATE_PRESETS
  return FOLLOW_UP_TAB_VALUES.includes(value as (typeof FOLLOW_UP_TAB_VALUES)[number])
    ? value
    : ALL_DUE_DATE_PRESETS
}

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return parsed
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
  assignees: AssigneeOption[]
  value: string
  onValueChange: (value: string) => void
  id: string
}) {
  const [open, setOpen] = useState(false)

  const selectedAssignee = useMemo(
    () => assignees.find((assignee) => assignee.value === value) ?? null,
    [assignees, value],
  )

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
            <Avatar size="sm" className={selectedAssignee ? "ring-2 ring-blue-50" : undefined}>
              {selectedAssignee?.image ? (
                <AvatarImage
                  src={selectedAssignee.image}
                  alt={`${selectedAssignee.label} profile photo`}
                  className="object-cover"
                />
              ) : null}
              <AvatarFallback
                className={
                  selectedAssignee
                    ? "bg-blue-950 font-semibold text-white"
                    : "bg-slate-100 font-semibold text-slate-500"
                }
              >
                {selectedAssignee ? getInitials(selectedAssignee.label) : "—"}
              </AvatarFallback>
            </Avatar>
            <span className="truncate font-medium text-slate-800">
              {selectedAssignee?.label ?? "All assignees"}
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

function CurrentStepBadge({
  status,
}: {
  status: CurrentStepStatus
}) {
  const config =
    status === "ACTIVE"
      ? { label: "Active", className: "bg-sky-100 text-sky-800" }
      : status === "POSTPONED"
        ? { label: "Postponed", className: "bg-violet-100 text-violet-800" }
        : status === "COMPLETED"
          ? { label: "Completed", className: "bg-emerald-100 text-emerald-800" }
          : status === "SKIPPED"
            ? { label: "Skipped", className: "bg-slate-200 text-slate-700" }
            : { label: "Pending", className: "bg-amber-100 text-amber-800" }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide",
        config.className,
      )}
    >
      {config.label}
    </span>
  )
}

function StepNumberChip({
  stepNumber,
}: {
  stepNumber: number | null
}) {
  const displayOrder = stepNumber && stepNumber > 0 ? stepNumber : 1

  return (
    <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-blue-200 bg-blue-50 px-2 text-[11px] font-semibold text-blue-800">
      {displayOrder}
    </span>
  )
}

function DueDateCell({
  dueAt,
  isOverdue,
  tenantTimezone,
}: {
  dueAt: string | null
  isOverdue: boolean
  tenantTimezone?: string | null
}) {
  if (!dueAt) {
    return <span className="text-sm text-slate-400">No due date</span>
  }

  return (
    <span className={cn("text-sm", isOverdue ? "font-medium text-rose-700" : "text-slate-700")}>
      {formatDateTimeForDisplay(dueAt, tenantTimezone)}
    </span>
  )
}

function ProgressCell({
  completedCount,
  totalCount,
  completionPercentage,
}: EnrollmentRow["progress"]) {
  const boundedPercentage = Math.max(0, Math.min(100, completionPercentage))

  return (
    <div className="flex min-w-48 items-center gap-2">
      <span className="w-10 text-sm font-semibold tabular-nums text-slate-900">
        {boundedPercentage}%
      </span>
      <div
        className="h-2 min-w-20 flex-1 rounded-full bg-slate-100"
        role="progressbar"
        aria-label="Follow-up progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={boundedPercentage}
      >
        <div
          className="h-2 rounded-full bg-blue-950 transition-[width]"
          style={{ width: `${boundedPercentage}%` }}
        />
      </div>
      <span className="w-10 text-right text-xs tabular-nums text-slate-500">
        {completedCount}/{totalCount}
      </span>
    </div>
  )
}

export function FollowUpsTable({
  tenantSlug,
  tenantId,
  tenantTimezone,
}: FollowUpsTableProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [query, setQuery] = useState(() => searchParams.get("search") ?? "")
  const [debouncedQuery, setDebouncedQuery] = useState(() => (searchParams.get("search") ?? "").trim())
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get("status") ?? DEFAULT_STATUS)
  const [dueDatePreset, setDueDatePreset] = useState(
    () => sanitizeDueDateTab(searchParams.get("dueDatePreset")),
  )
  const [templateFilter, setTemplateFilter] = useState(
    () => searchParams.get("followUpTemplateId") ?? ALL_TEMPLATE_FILTER,
  )
  const [assigneeFilter, setAssigneeFilter] = useState(
    () => searchParams.get("assignedToUserId") ?? ALL_ASSIGNEE_FILTER,
  )
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false)
  const [draftStatusFilter, setDraftStatusFilter] = useState(
    () => searchParams.get("status") ?? DEFAULT_STATUS,
  )
  const [draftTemplateFilter, setDraftTemplateFilter] = useState(
    () => searchParams.get("followUpTemplateId") ?? ALL_TEMPLATE_FILTER,
  )
  const [draftAssigneeFilter, setDraftAssigneeFilter] = useState(
    () => searchParams.get("assignedToUserId") ?? ALL_ASSIGNEE_FILTER,
  )
  const [page, setPage] = useState(() => parsePositiveInt(searchParams.get("page"), 1))
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(() => {
    const parsed = parsePositiveInt(searchParams.get("pageSize"), 10)
    return parsed === 25 ? 25 : 10
  })
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [data, setData] = useState<FollowUpsResponse | null>(null)
  const [templateOptions, setTemplateOptions] = useState<FollowUpTemplateOption[]>([])
  const [assigneeOptions, setAssigneeOptions] = useState<AssigneeOption[]>([])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query.trim())
      setPage(1)
    }, 300)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [query])

  useEffect(() => {
    const nextParams = new URLSearchParams()

    if (debouncedQuery) nextParams.set("search", debouncedQuery)
    if (statusFilter !== DEFAULT_STATUS) nextParams.set("status", statusFilter)
    if (dueDatePreset !== ALL_DUE_DATE_PRESETS) nextParams.set("dueDatePreset", dueDatePreset)
    if (templateFilter !== ALL_TEMPLATE_FILTER) {
      nextParams.set("followUpTemplateId", templateFilter)
    }
    if (assigneeFilter !== ALL_ASSIGNEE_FILTER) {
      nextParams.set("assignedToUserId", assigneeFilter)
    }
    if (page > 1) nextParams.set("page", String(page))
    if (pageSize !== 10) nextParams.set("pageSize", String(pageSize))

    const nextQuery = nextParams.toString()
    const currentQuery = searchParams.toString()
    if (nextQuery === currentQuery) return

    startTransition(() => {
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
        scroll: false,
      })
    })
  }, [
    assigneeFilter,
    debouncedQuery,
    dueDatePreset,
    page,
    pageSize,
    pathname,
    router,
    searchParams,
    statusFilter,
    templateFilter,
  ])

  const loadFollowUps = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const { data: response } = await api.get<FollowUpsResponse>(`/api/services/${tenantId}/follow-ups`, {
        params: {
          page,
          pageSize,
          search: debouncedQuery || undefined,
          status:
            statusFilter === ALL_STATUS
              ? undefined
              : statusFilter || undefined,
          dueDatePreset:
            dueDatePreset === ALL_DUE_DATE_PRESETS ? undefined : dueDatePreset,
          followUpTemplateId:
            templateFilter === ALL_TEMPLATE_FILTER ? undefined : templateFilter,
          assignedToUserId:
            assigneeFilter === ALL_ASSIGNEE_FILTER ? undefined : assigneeFilter,
        },
      })

      setData(response)
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        setErrorMessage(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not load follow-ups.",
        )
      } else {
        setErrorMessage("Could not load follow-ups.")
      }
    } finally {
      setIsLoading(false)
    }
  }, [
    assigneeFilter,
    debouncedQuery,
    dueDatePreset,
    page,
    pageSize,
    statusFilter,
    templateFilter,
    tenantId,
  ])

  useEffect(() => {
    void loadFollowUps()
  }, [loadFollowUps])

  useEffect(() => {
    let cancelled = false

    const loadTemplateOptions = async () => {
      try {
        const { data: response } = await api.get<{
          ok: boolean
          items: FollowUpTemplateOption[]
        }>(`/api/services/${encodeURIComponent(tenantId)}/follow-up-template-options`)

        if (cancelled) return
        setTemplateOptions(response.items ?? [])
      } catch {
        if (cancelled) return
        setTemplateOptions([])
      }
    }

    void loadTemplateOptions()

    return () => {
      cancelled = true
    }
  }, [tenantId])

  useEffect(() => {
    let cancelled = false

    const loadAssigneeOptions = async () => {
      try {
        const { data: response } = await api.get<{
          ok: boolean
          items: AssigneeOption[]
        }>(`/api/tasks/${encodeURIComponent(tenantId)}/assignees`)

        if (cancelled) return
        setAssigneeOptions(response.items ?? [])
      } catch {
        if (cancelled) return
        setAssigneeOptions([])
      }
    }

    void loadAssigneeOptions()

    return () => {
      cancelled = true
    }
  }, [tenantId])

  const enrollments = data?.items ?? []
  const summary = data?.summary ?? {
    servicesInProgress: 0,
    overdueEnrollments: 0,
    dueToday: 0,
    averageProgress: 0,
  }
  const total = data?.pagination.total ?? 0
  const totalPages = data?.pagination.totalPages ?? 1
  const startIndex = (page - 1) * pageSize
  const canGoPrevious = page > 1
  const canGoNext = page < totalPages
  const activeFilterCount =
    (statusFilter !== DEFAULT_STATUS ? 1 : 0) +
    (templateFilter !== ALL_TEMPLATE_FILTER ? 1 : 0) +
    (assigneeFilter !== ALL_ASSIGNEE_FILTER ? 1 : 0)
  const hasActiveQueryOrFilters = Boolean(query.trim()) || activeFilterCount > 0
  const placeholderRowCount =
    enrollments.length === 0
      ? pageSize - 1
      : Math.max(0, pageSize - enrollments.length)
  const visiblePageCount = Math.min(5, totalPages)
  const firstVisiblePage = Math.max(
    1,
    Math.min(page - 2, totalPages - visiblePageCount + 1),
  )
  const visiblePages = Array.from(
    { length: visiblePageCount },
    (_, index) => firstVisiblePage + index,
  )

  const summaryLabel = useMemo(() => {
    if (!total) return "No active service paths found"
    const start = startIndex + 1
    const end = start + enrollments.length - 1
    return `Showing ${start}-${end} of ${total} service paths`
  }, [enrollments.length, startIndex, total])

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <p className="text-xs font-semibold text-blue-700">Follow-ups</p>
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold text-slate-950">
                Service follow-up workspace
              </h1>
              <p className="text-sm text-slate-600">
                Review ownership, due dates, and progress across active service paths.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="min-w-0 rounded-[22px] border border-white/80 bg-white/70 px-4 py-3 shadow-sm backdrop-blur">
            <div className="flex items-center gap-2 text-slate-500">
              <Clock3 className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                In Progress
              </p>
            </div>
            <p className="mt-2 truncate text-xl font-semibold tabular-nums tracking-tight text-slate-950">
              {summary.servicesInProgress}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Active service paths currently moving through steps.
            </p>
          </div>

          <div className="min-w-0 rounded-[22px] border border-white/80 bg-white/70 px-4 py-3 shadow-sm backdrop-blur">
            <div className="flex items-center gap-2 text-slate-500">
              <AlertTriangle className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                Overdue
              </p>
            </div>
            <p className="mt-2 truncate text-xl font-semibold tabular-nums tracking-tight text-rose-700">
              {summary.overdueEnrollments}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Current steps with due dates already in the past.
            </p>
          </div>

          <div className="min-w-0 rounded-[22px] border border-white/80 bg-white/70 px-4 py-3 shadow-sm backdrop-blur">
            <div className="flex items-center gap-2 text-slate-500">
              <CalendarClock className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                Due Today
              </p>
            </div>
            <p className="mt-2 truncate text-xl font-semibold tabular-nums tracking-tight text-amber-700">
              {summary.dueToday}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Active steps that need attention before the day ends.
            </p>
          </div>

          <div className="min-w-0 rounded-[22px] border border-white/80 bg-white/70 px-4 py-3 shadow-sm backdrop-blur">
            <div className="flex items-center gap-2 text-slate-500">
              <Gauge className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                Average Progress
              </p>
            </div>
            <p className="mt-2 truncate text-xl font-semibold tabular-nums tracking-tight text-sky-700">
              {summary.averageProgress}%
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Completion level across active service paths.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 rounded-[22px] border border-slate-200 bg-white/75 p-3 shadow-sm backdrop-blur lg:grid-cols-[minmax(280px,1fr)_auto_auto]">
        <Input
          type="search"
          placeholder="Search by contact name or phone number"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setPage(1)
          }}
          aria-label="Search follow-ups"
          className="h-11 rounded-xl border-white/80 bg-white/85 px-4 shadow-sm backdrop-blur placeholder:text-slate-400 focus-visible:border-blue-300 focus-visible:ring-blue-100"
        />
        <Button
          type="button"
          variant="outline"
          className="h-11 cursor-pointer rounded-xl border-white/80 bg-white/85 px-4 text-blue-950 shadow-sm backdrop-blur hover:bg-white hover:text-blue-950"
          onClick={() => {
            setDraftStatusFilter(statusFilter)
            setDraftTemplateFilter(templateFilter)
            setDraftAssigneeFilter(assigneeFilter)
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
            setStatusFilter(DEFAULT_STATUS)
            setTemplateFilter(ALL_TEMPLATE_FILTER)
            setAssigneeFilter(ALL_ASSIGNEE_FILTER)
            setDraftStatusFilter(DEFAULT_STATUS)
            setDraftTemplateFilter(ALL_TEMPLATE_FILTER)
            setDraftAssigneeFilter(ALL_ASSIGNEE_FILTER)
            setPage(1)
          }}
        >
          Clear filters
        </Button>
      </div>

      <Sheet open={isFilterSheetOpen} onOpenChange={setIsFilterSheetOpen}>
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
                  Follow-up filters
                </p>
                <SheetTitle className="text-xl font-semibold text-slate-950 sm:text-2xl">
                  Refine follow-ups
                </SheetTitle>
                <SheetDescription className="max-w-xl text-sm leading-6 text-slate-600">
                  Filter service paths by step status, template, and owner.
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6 [scrollbar-gutter:stable] sm:px-7">
            <FieldGroup className="gap-6">
              <Field className="gap-2">
                <FieldLabel htmlFor="follow-up-status-filter" className="text-slate-800">
                  Step status
                </FieldLabel>
                <Select value={draftStatusFilter} onValueChange={setDraftStatusFilter}>
                  <SelectTrigger
                    id="follow-up-status-filter"
                    className="h-11 w-full rounded-xl border-slate-200 bg-slate-50/60 px-3 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
                  >
                    <SelectValue placeholder="Current step status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_STATUS}>All statuses</SelectItem>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="POSTPONED">Postponed</SelectItem>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="COMPLETED">Completed</SelectItem>
                    <SelectItem value="SKIPPED">Skipped</SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription className="text-xs">
                  Show follow-ups matching the selected current step state.
                </FieldDescription>
              </Field>

              <Field className="gap-2">
                <FieldLabel htmlFor="follow-up-template-filter" className="text-slate-800">
                  Template
                </FieldLabel>
                <Select value={draftTemplateFilter} onValueChange={setDraftTemplateFilter}>
                  <SelectTrigger
                    id="follow-up-template-filter"
                    className="h-11 w-full rounded-xl border-slate-200 bg-slate-50/60 px-3 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
                  >
                    <SelectValue placeholder="Template" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_TEMPLATE_FILTER}>All templates</SelectItem>
                    {templateOptions.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription className="text-xs">
                  Focus on a specific follow-up template across the selected due-date tab.
                </FieldDescription>
              </Field>

              <Field className="gap-2">
                <FieldLabel htmlFor="follow-up-assignee-filter" className="text-slate-800">
                  Assigned to
                </FieldLabel>
                <AssigneeFilterPicker
                  id="follow-up-assignee-filter"
                  assignees={assigneeOptions}
                  value={draftAssigneeFilter}
                  onValueChange={setDraftAssigneeFilter}
                />
                <FieldDescription className="text-xs">
                  Show follow-ups owned by a specific user.
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
                setDraftStatusFilter(DEFAULT_STATUS)
                setDraftTemplateFilter(ALL_TEMPLATE_FILTER)
                setDraftAssigneeFilter(ALL_ASSIGNEE_FILTER)
              }}
            >
              Clear
            </Button>
            <Button
              type="button"
              className="min-w-32 cursor-pointer bg-blue-950 text-white shadow-sm hover:bg-blue-900"
              onClick={() => {
                setStatusFilter(draftStatusFilter)
                setTemplateFilter(draftTemplateFilter)
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

      <Tabs
        value={dueDatePreset}
        onValueChange={(value) => {
          setDueDatePreset(value)
          setPage(1)
        }}
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm"
      >
        <div className="border-b border-slate-200 px-4 pt-4">
          <div className="pb-2">
            <div className="overflow-x-auto overflow-y-hidden">
              <TabsList className="inline-flex h-auto w-max min-w-0 justify-start gap-2 bg-transparent p-0">
                {FOLLOW_UP_TABS.map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className={cn(
                      "inline-flex h-auto items-center whitespace-nowrap rounded-xl border px-4 text-sm font-medium transition cursor-pointer",
                      "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900",
                      "data-[state=active]:border-blue-950 data-[state=active]:bg-blue-950 data-[state=active]:text-white data-[state=active]:shadow-sm",
                      "data-[state=active]:hover:border-blue-950 data-[state=active]:hover:bg-blue-950/90 data-[state=active]:hover:text-white",
                    )}
                  >
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 pt-4">
          <Table
            className="min-w-[1600px] table-fixed border-separate border-spacing-0"
            aria-label="Follow-ups"
          >
            <TableHeader className="drop-shadow-sm [&_tr]:border-0">
              <TableRow className="h-14 border-0 hover:bg-transparent">
                <TableHead className="w-[12%] rounded-l-xl border-y border-l bg-slate-50 px-4 text-xs text-slate-600">
                  Name
                </TableHead>
                <TableHead className="w-[9%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Number
                </TableHead>
                <TableHead className="w-[11%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Service
                </TableHead>
                <TableHead className="w-[13%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Template
                </TableHead>
                <TableHead className="w-[15%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Current Step
                </TableHead>
                <TableHead className="w-[11%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Assigned
                </TableHead>
                <TableHead className="w-[8%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Status
                </TableHead>
                <TableHead className="w-[9%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Due Date
                </TableHead>
                <TableHead className="w-[12%] rounded-r-xl border-y border-r bg-slate-50 px-4 text-xs text-slate-600">
                  Progress
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow
                aria-hidden="true"
                className="h-2 border-0 hover:bg-transparent"
              >
                <TableCell colSpan={9} className="p-0" />
              </TableRow>
              {isLoading ? (
                Array.from({ length: pageSize }, (_, index) => (
                  <TableRow
                    key={`follow-up-loading-${index}`}
                    className="h-14 hover:bg-transparent"
                  >
                    <TableCell className="px-4 py-0">
                      <Skeleton className="h-4 w-4/5" />
                    </TableCell>
                    <TableCell className="px-4 py-0">
                      <Skeleton className="h-4 w-28" />
                    </TableCell>
                    <TableCell className="px-4 py-0">
                      <Skeleton className="h-4 w-4/5" />
                    </TableCell>
                    <TableCell className="px-4 py-0">
                      <Skeleton className="h-4 w-4/5" />
                    </TableCell>
                    <TableCell className="px-4 py-0">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-6 w-8 rounded-full" />
                        <Skeleton className="h-4 w-32" />
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-0">
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell className="px-4 py-0">
                      <Skeleton className="h-5 w-16 rounded-full" />
                    </TableCell>
                    <TableCell className="px-4 py-0">
                      <Skeleton className="h-4 w-32" />
                    </TableCell>
                    <TableCell className="px-4 py-0">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-4 w-10" />
                        <Skeleton className="h-2 flex-1 rounded-full" />
                        <Skeleton className="h-4 w-8" />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : errorMessage ? (
                <TableRow className="h-14 hover:bg-transparent">
                  <TableCell
                    colSpan={9}
                    className="px-4 py-0 text-center text-sm text-rose-600"
                  >
                    {errorMessage}
                  </TableCell>
                </TableRow>
              ) : enrollments.length ? (
                enrollments.map((item) => {
                  const href = `/app/${tenantSlug}/contacts/${item.contactId}/services/${item.id}`

                  return (
                    <TableRow
                      key={item.id}
                      role="link"
                      tabIndex={0}
                      aria-label={`Open ${item.contactName || "Unnamed contact"} service follow-up`}
                      className="h-14 cursor-pointer outline-none hover:bg-blue-50/50 focus-visible:bg-blue-50/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40"
                      onClick={() => router.push(href)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          router.push(href)
                        }
                      }}
                    >
                      <TableCell className="px-4 py-0">
                        <p className="truncate font-medium text-slate-900">
                          {item.contactName || "Unnamed contact"}
                        </p>
                      </TableCell>
                      <TableCell className="px-4 py-0">
                        <span className="text-sm text-slate-600">
                          {item.phoneNumber
                            ? formatPhoneNumber(item.phoneNumber)
                            : "No number"}
                        </span>
                      </TableCell>
                      <TableCell className="px-4 py-0">
                        <p className="truncate font-medium text-slate-900">
                          {item.serviceName}
                        </p>
                      </TableCell>
                      <TableCell className="px-4 py-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 truncate text-sm text-slate-700">
                            {item.followUpTemplateName || "Manual follow-up flow"}
                            {item.followUpTemplateVersion
                              ? ` v${item.followUpTemplateVersion.versionNumber}`
                              : ""}
                          </span>
                          {item.followUpRun?.status === "FAILED" ||
                          item.followUpRun?.status === "NEEDS_REVIEW" ? (
                            <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                              {item.followUpRun.status === "FAILED"
                                ? "Paused"
                                : "Review"}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-0">
                        <div className="flex min-w-0 items-center gap-2">
                          {item.currentStep ? (
                            <StepNumberChip stepNumber={item.currentStep.stepNumber} />
                          ) : null}
                          <span className="min-w-0 truncate font-medium text-slate-900">
                            {item.currentStep?.title || "No active step"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-0">
                        <span className="block truncate text-sm text-slate-700">
                          {item.currentStep?.assignedToName || "Unassigned"}
                        </span>
                      </TableCell>
                      <TableCell className="px-4 py-0">
                        {item.currentStep ? (
                          <CurrentStepBadge status={item.currentStep.status} />
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="px-4 py-0">
                        <DueDateCell
                          dueAt={item.currentStep?.dueAt ?? null}
                          isOverdue={item.overdue}
                          tenantTimezone={tenantTimezone}
                        />
                      </TableCell>
                      <TableCell className="px-4 py-0">
                        <ProgressCell {...item.progress} />
                      </TableCell>
                    </TableRow>
                  )
                })
              ) : (
                <TableRow className="h-14 hover:bg-transparent">
                  <TableCell
                    colSpan={9}
                    className="px-4 py-0 text-center text-sm text-slate-500"
                  >
                    No active service paths match these filters.
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && !errorMessage
                ? Array.from({ length: placeholderRowCount }, (_, index) => (
                    <TableRow
                      key={`follow-up-placeholder-${index}`}
                      aria-hidden="true"
                      className="h-14 hover:bg-transparent"
                    >
                      <TableCell colSpan={9} className="px-4 py-0" />
                    </TableRow>
                  ))
                : null}
            </TableBody>
          </Table>
        </div>

        <footer className="flex flex-col gap-4 border-t border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            {isLoading ? (
              <Skeleton className="h-4 w-44" />
            ) : (
              <p className="text-sm text-slate-500">{summaryLabel}</p>
            )}
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
                <SelectTrigger size="sm" className="w-20 rounded-lg">
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
            aria-label="Follow-up pagination"
          >
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Previous page"
              disabled={!canGoPrevious || isLoading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft aria-hidden="true" />
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
                disabled={isLoading || pageNumber === page}
                className={
                  pageNumber === page
                    ? "bg-blue-950 text-white hover:bg-blue-900 disabled:opacity-100"
                    : undefined
                }
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
              onClick={() => setPage((prev) => prev + 1)}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </nav>
        </footer>
      </Tabs>
    </div>
  )
}
