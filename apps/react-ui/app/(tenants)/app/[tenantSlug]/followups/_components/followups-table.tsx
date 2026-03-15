"use client"

import { isAxiosError } from "axios"
import { AlertTriangle, CalendarClock, Clock3, Gauge } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { startTransition, useCallback, useEffect, useMemo, useState } from "react"

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
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELED"
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

const PAGE_SIZE_OPTIONS = [10, 25] as const
const DEFAULT_STATUS = "ACTIVE"
const ALL_STATUS = "ALL"
const ALL_DUE_DATE_PRESETS = "ALL"

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
    <div className="space-y-1">
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
    <div className="min-w-40 space-y-2">
      <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
        <span>
          {completedCount}/{totalCount} completed
        </span>
        <span>{remainingCount} left</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100">
        <div
          className="h-2 rounded-full bg-slate-900 transition-[width]"
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
    () => searchParams.get("dueDatePreset") ?? ALL_DUE_DATE_PRESETS,
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

  useEffect(() => {
    setNowTimestamp(Date.now())
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query.trim())
      setPage(1)
    }, 350)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [query])

  useEffect(() => {
    const nextParams = new URLSearchParams()

    if (debouncedQuery) nextParams.set("search", debouncedQuery)
    if (statusFilter !== DEFAULT_STATUS) nextParams.set("status", statusFilter)
    if (dueDatePreset !== ALL_DUE_DATE_PRESETS) nextParams.set("dueDatePreset", dueDatePreset)
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
  }, [debouncedQuery, dueDatePreset, page, pageSize, pathname, router, searchParams, statusFilter])

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
  }, [debouncedQuery, dueDatePreset, page, pageSize, statusFilter, tenantId])

  useEffect(() => {
    void loadFollowUps()
  }, [loadFollowUps])

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

  const summaryLabel = useMemo(() => {
    if (!total) return "No active service paths found"
    const start = startIndex + 1
    const end = start + enrollments.length - 1
    return `Showing ${start}-${end} of ${total} service paths`
  }, [enrollments.length, startIndex, total])

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-col gap-4">
        <div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
          <div className="flex flex-col gap-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                Follow-Ups
              </p>
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
                  Active service paths
                </h1>
                <p className="text-sm text-slate-600">
                  Keep the team focused on the current step for each enrolled service.
                </p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="min-w-0 rounded-[24px] border border-white/80 bg-white/70 p-6 shadow-sm backdrop-blur">
                <div className="flex items-center gap-2 text-slate-400">
                  <Clock3 className="h-4 w-4" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                    Services In Progress
                  </p>
                </div>
                <p className="mt-3 truncate text-2xl font-semibold tracking-tight text-slate-950">
                  {summary.servicesInProgress}
                </p>
              </div>

              <div className="min-w-0 rounded-[24px] border border-white/80 bg-white/70 p-6 shadow-sm backdrop-blur">
                <div className="flex items-center gap-2 text-slate-400">
                  <AlertTriangle className="h-4 w-4" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                    Overdue
                  </p>
                </div>
                <p className="mt-3 truncate text-2xl font-semibold tracking-tight text-slate-950">
                  {summary.overdueEnrollments}
                </p>
              </div>

              <div className="min-w-0 rounded-[24px] border border-white/80 bg-white/70 p-6 shadow-sm backdrop-blur">
                <div className="flex items-center gap-2 text-slate-400">
                  <CalendarClock className="h-4 w-4" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                    Due Today
                  </p>
                </div>
                <p className="mt-3 truncate text-2xl font-semibold tracking-tight text-slate-950">
                  {summary.dueToday}
                </p>
              </div>

              <div className="min-w-0 rounded-[24px] border border-white/80 bg-white/70 p-6 shadow-sm backdrop-blur">
                <div className="flex items-center gap-2 text-slate-400">
                  <Gauge className="h-4 w-4" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                    Average Progress
                  </p>
                </div>
                <p className="mt-3 truncate text-2xl font-semibold tracking-tight text-slate-950">
                  {summary.averageProgress}%
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-lg bg-white py-1">
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_200px_200px_auto]">
          <Input
            placeholder="Search contact, phone, service, or current step"
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

          <Select
            value={dueDatePreset}
            onValueChange={(value) => {
              setDueDatePreset(value)
              setPage(1)
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Due date" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_DUE_DATE_PRESETS}>All Due Dates</SelectItem>
              <SelectItem value="OVERDUE">Overdue</SelectItem>
              <SelectItem value="TODAY">Due Today</SelectItem>
              <SelectItem value="NEXT_7_DAYS">Next 7 Days</SelectItem>
              <SelectItem value="NO_DUE_DATE">No Due Date</SelectItem>
            </SelectContent>
          </Select>

          <Button
            type="button"
            variant="outline"
            className="border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
            onClick={() => {
              setQuery("")
              setDebouncedQuery("")
              setStatusFilter(DEFAULT_STATUS)
              setDueDatePreset(ALL_DUE_DATE_PRESETS)
              setPage(1)
            }}
          >
            Clear Filters
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-lg bg-white">
        <div className="min-h-0 flex-1 overflow-auto">
          <Table className="[&_td]:py-3 [&_th]:h-8">
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
                      <div className="space-y-1">
                        <p className="font-medium text-slate-900">
                          {item.contactName || "Unnamed contact"}
                        </p>
                        <p className="text-xs text-slate-500">
                          {item.phoneNumber ? formatPhoneNumber(item.phoneNumber) : "No phone number"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium text-slate-900">{item.serviceName}</p>
                        <p className="text-xs text-slate-500">
                          {item.followUpTemplateName || "Manual follow-up flow"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium text-slate-900">
                          {item.currentStep?.title || "No active step"}
                        </p>
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
          <p className="text-sm text-slate-500">{summaryLabel}</p>

          <div className="flex items-center gap-2">
            <Select
              value={String(pageSize)}
              onValueChange={(value) => {
                setPageSize(Number(value) as (typeof PAGE_SIZE_OPTIONS)[number])
                setPage(1)
              }}
            >
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="Page size" />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value} / page
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canGoPrevious || isLoading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </Button>
            <span className="min-w-24 text-center text-sm text-slate-500">
              Page {page} of {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canGoNext || isLoading}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
