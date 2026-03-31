"use client"

import { isAxiosError } from "axios"
import { AlertTriangle, CalendarClock, Clock3, Filter, Gauge, Search, X } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { startTransition, useCallback, useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
  nowTimestamp,
  tenantTimezone,
}: {
  dueAt: string | null
  isOverdue: boolean
  nowTimestamp: number | null
  tenantTimezone?: string | null
}) {
  if (!dueAt) {
    return <span className="text-xs text-slate-400">No due date</span>
  }

  const dueDate = new Date(dueAt)
  const isDueSoon =
    nowTimestamp !== null && dueDate.getTime() - nowTimestamp <= 24 * 60 * 60 * 1000

  return (
    <div className="space-y-0.5">
      <p className={cn("text-sm", isOverdue ? "font-medium text-rose-700" : "text-slate-700")}>
        {formatDateTimeForDisplay(dueAt, tenantTimezone)}
      </p>
      <p
        className={cn(
          "text-xs",
          isOverdue
            ? "text-rose-600"
            : isDueSoon
              ? "text-amber-600"
              : "text-slate-500",
        )}
      >
        {isOverdue ? "Overdue" : isDueSoon ? "Due soon" : "Scheduled"}
      </p>
    </div>
  )
}

function ProgressCell({
  completedCount,
  totalCount,
  remainingCount,
  completionPercentage,
}: EnrollmentRow["progress"]) {
  return (
    <div className="min-w-40 space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
        <span>
          {completedCount}/{totalCount} completed
        </span>
        <span>{remainingCount} left</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100">
        <div
          className="h-1.5 rounded-full bg-slate-900 transition-[width]"
          style={{ width: `${completionPercentage}%` }}
        />
      </div>
      <p className="text-xs font-medium text-slate-600">{completionPercentage}% complete</p>
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
  const [nowTimestamp, setNowTimestamp] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [data, setData] = useState<FollowUpsResponse | null>(null)
  const [templateOptions, setTemplateOptions] = useState<FollowUpTemplateOption[]>([])
  const [assigneeOptions, setAssigneeOptions] = useState<AssigneeOption[]>([])

  useEffect(() => {
    setNowTimestamp(Date.now())
  }, [])

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

  const summaryLabel = useMemo(() => {
    if (!total) return "No active service paths found"
    const start = startIndex + 1
    const end = start + enrollments.length - 1
    return `Showing ${start}-${end} of ${total} service paths`
  }, [enrollments.length, startIndex, total])

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Follow-Ups</h2>
          <p className="text-sm text-slate-500">{summaryLabel}</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="min-w-0 rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-slate-400">
            <Clock3 className="h-4 w-4" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
              Services In Progress
            </p>
          </div>
          <p className="mt-2 truncate text-xl font-semibold tracking-tight text-slate-950">
            {summary.servicesInProgress}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Enrollments that still have an active service step.
          </p>
        </div>

        <div className="min-w-0 rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-slate-400">
            <AlertTriangle className="h-4 w-4" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
              Overdue
            </p>
          </div>
          <p className="mt-2 truncate text-xl font-semibold tracking-tight text-rose-700">
            {summary.overdueEnrollments}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Current steps with a due date already in the past.
          </p>
        </div>

        <div className="min-w-0 rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-slate-400">
            <CalendarClock className="h-4 w-4" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
              Due Today
            </p>
          </div>
          <p className="mt-2 truncate text-xl font-semibold tracking-tight text-amber-700">
            {summary.dueToday}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Active steps that need attention before the day ends.
          </p>
        </div>

        <div className="min-w-0 rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-slate-400">
            <Gauge className="h-4 w-4" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
              Average Progress
            </p>
          </div>
          <p className="mt-2 truncate text-xl font-semibold tracking-tight text-sky-700">
            {summary.averageProgress}%
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Completion level across all active service paths.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-lg bg-white py-1">
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search by contact name and phone number"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
              className="pl-9 pr-12"
            />
            {query ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1.5 top-1/2 h-8 w-8 -translate-y-1/2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                onClick={() => {
                  setQuery("")
                  setPage(1)
                }}
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Clear search</span>
              </Button>
            ) : null}
          </div>
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
            onClick={() => {
              setDraftStatusFilter(statusFilter)
              setDraftTemplateFilter(templateFilter)
              setDraftAssigneeFilter(assigneeFilter)
              setIsFilterSheetOpen(true)
            }}
          >
            <Filter className="h-4 w-4" />
            Filters
            {activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
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
            Clear Filters
          </Button>
        </div>
      </div>

      <Sheet open={isFilterSheetOpen} onOpenChange={setIsFilterSheetOpen}>
        <SheetContent side="right" className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>
              Narrow follow-ups by current step status, template, or assignee.
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
            <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900">Step Status</p>
                <p className="text-xs text-slate-500">
                  Show follow-ups matching the selected current step state.
                </p>
              </div>
              <Select value={draftStatusFilter} onValueChange={setDraftStatusFilter}>
                <SelectTrigger className="h-11 w-full rounded-xl border-slate-200 bg-white shadow-sm">
                  <SelectValue placeholder="Current step status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_STATUS}>All Statuses</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="POSTPONED">Postponed</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="SKIPPED">Skipped</SelectItem>
                </SelectContent>
              </Select>
            </section>

            <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900">Template</p>
                <p className="text-xs text-slate-500">
                  Focus on a specific follow-up template across the selected due-date tab.
                </p>
              </div>
              <Select value={draftTemplateFilter} onValueChange={setDraftTemplateFilter}>
                <SelectTrigger className="h-11 w-full rounded-xl border-slate-200 bg-white shadow-sm">
                  <SelectValue placeholder="Template" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_TEMPLATE_FILTER}>All Templates</SelectItem>
                  {templateOptions.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </section>

            <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900">Assigned To</p>
                <p className="text-xs text-slate-500">
                  Show follow-ups owned by a specific user.
                </p>
              </div>
              <Select value={draftAssigneeFilter} onValueChange={setDraftAssigneeFilter}>
                <SelectTrigger className="h-11 w-full rounded-xl border-slate-200 bg-white shadow-sm">
                  <SelectValue placeholder="Assigned to" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ASSIGNEE_FILTER}>All Assignees</SelectItem>
                  {assigneeOptions.map((assignee) => (
                    <SelectItem key={assignee.value} value={assignee.value}>
                      {assignee.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </section>
          </div>

          <SheetFooter>
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer"
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
              className="cursor-pointer bg-blue-950 text-white hover:bg-blue-950/90"
              onClick={() => {
                setStatusFilter(draftStatusFilter)
                setTemplateFilter(draftTemplateFilter)
                setAssigneeFilter(draftAssigneeFilter)
                setPage(1)
                setIsFilterSheetOpen(false)
              }}
            >
              Apply Filters
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
        className="flex min-h-0 flex-1 flex-col rounded-[22px] border border-slate-200 bg-white shadow-sm"
      >
        <div className="border-b border-slate-200 px-4 pt-3">
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

        <div className="min-h-0 flex-1 overflow-auto">
          <Table className="[&_td]:py-2.5 [&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th]:h-8 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-48 text-xs">Contact</TableHead>
                <TableHead className="min-w-44 text-xs">Service</TableHead>
                <TableHead className="min-w-56 text-xs">Current Step</TableHead>
                <TableHead className="min-w-32 text-xs">Status</TableHead>
                <TableHead className="min-w-44 text-xs">Due Date</TableHead>
                <TableHead className="min-w-44 text-xs">Progress</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-slate-500">
                    Loading service paths...
                  </TableCell>
                </TableRow>
              ) : errorMessage ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-rose-600">
                    {errorMessage}
                  </TableCell>
                </TableRow>
              ) : enrollments.length ? (
                enrollments.map((item) => (
                  <TableRow
                    key={item.id}
                    className={cn(
                      "cursor-pointer",
                      item.overdue && "bg-rose-50/50 hover:bg-rose-50",
                    )}
                    onClick={() =>
                      router.push(
                        `/app/${tenantSlug}/contacts/${item.contactId}/services/${item.id}`,
                      )
                    }
                  >
                    <TableCell>
                      <div className="space-y-0.5">
                        <p className="font-medium text-slate-900">
                          {item.contactName || "Unnamed contact"}
                        </p>
                        <p className="text-xs text-slate-500">
                          {item.phoneNumber ? formatPhoneNumber(item.phoneNumber) : "No phone number"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-0.5">
                        <p className="font-medium text-slate-900">{item.serviceName}</p>
                        <p className="text-xs text-slate-500">
                          {item.followUpTemplateName || "Manual follow-up flow"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          {item.currentStep ? (
                            <StepNumberChip stepNumber={item.currentStep.stepNumber} />
                          ) : null}
                          <p className="font-medium text-slate-900">
                            {item.currentStep?.title || "No active step"}
                          </p>
                        </div>
                        <p className="text-xs text-slate-500">
                          {item.currentStep?.assignedToName
                            ? `Assigned to ${item.currentStep.assignedToName}`
                            : "Unassigned"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {item.currentStep ? <CurrentStepBadge status={item.currentStep.status} /> : "—"}
                    </TableCell>
                    <TableCell>
                      <DueDateCell
                        dueAt={item.currentStep?.dueAt ?? null}
                        isOverdue={item.overdue}
                        nowTimestamp={nowTimestamp}
                        tenantTimezone={tenantTimezone}
                      />
                    </TableCell>
                    <TableCell>
                      <ProgressCell {...item.progress} />
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-slate-500">
                    No active service paths match these filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
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
              onClick={() => setPage((current) => Math.max(1, current - 1))}
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
      </Tabs>
    </div>
  )
}
