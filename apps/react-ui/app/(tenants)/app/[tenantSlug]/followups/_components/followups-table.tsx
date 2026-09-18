"use client"

import { isAxiosError } from "axios"
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Filter,
  Gauge,
  RefreshCw,
  Search,
} from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { startTransition, useCallback, useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
import { LabeledProgress } from "@/components/ui/labeled-progress"
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
import { Separator } from "@/components/ui/separator"
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api } from "@/lib/api"
import { formatDateTimeForDisplay } from "@/lib/date-time"
import { formatPhoneNumber } from "@/lib/format-phone-number"
import { getServiceEnrollmentFollowUpHref } from "@/lib/routes"
import { cn } from "@/lib/utils"

type FollowUpsTableProps = {
  tenantSlug: string
  tenantId: string
  tenantTimezone?: string | null
}

type CurrentStepStatus = "PENDING" | "ACTIVE" | "COMPLETED" | "SKIPPED" | "POSTPONED"
type FollowUpSort = "UPDATED_DESC" | "STARTED_DESC" | "CONTACT_ASC" | "SERVICE_ASC"

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
    effectiveDueAt: string | null
    effectiveDueSource: "USER_SCHEDULED_WAIT" | "STEP_DUE" | "STEP_AVAILABLE" | null
    effectiveDueProjected: boolean
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
const ALL_STATUS = "ALL"
const DEFAULT_STATUS = ALL_STATUS
const ALL_DUE_DATE_PRESETS = "ALL"
const ALL_TEMPLATE_FILTER = "ALL"
const ALL_ASSIGNEE_FILTER = "ALL"
const DEFAULT_SORT: FollowUpSort = "UPDATED_DESC"
const MAX_FOLLOW_UP_PAGE = 1_000_000
const FOLLOW_UP_SEARCH_MAX_LENGTH = 200

const COMPACT_PRIMARY_BUTTON_CLASS =
  "h-8 shrink-0 cursor-pointer rounded-full bg-blue-950 px-3 py-1 text-xs font-semibold text-white shadow-sm ring-1 ring-black/5 transition hover:bg-blue-900 hover:text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"

const COMPACT_SECONDARY_BUTTON_CLASS =
  "h-8 shrink-0 cursor-pointer rounded-full border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"

const STATUS_VALUES = [
  ALL_STATUS,
  "ACTIVE",
  "POSTPONED",
  "PENDING",
  "COMPLETED",
  "SKIPPED",
] as const

const SORT_OPTIONS: Array<{ value: FollowUpSort; label: string }> = [
  { value: "UPDATED_DESC", label: "Recently updated" },
  { value: "STARTED_DESC", label: "Recently started" },
  { value: "CONTACT_ASC", label: "Contact A–Z" },
  { value: "SERVICE_ASC", label: "Service A–Z" },
]
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

function sanitizeStatus(value: string | null) {
  if (!value) return DEFAULT_STATUS
  return STATUS_VALUES.includes(value as (typeof STATUS_VALUES)[number])
    ? value
    : DEFAULT_STATUS
}

function sanitizeSort(value: string | null): FollowUpSort {
  return SORT_OPTIONS.some((option) => option.value === value)
    ? (value as FollowUpSort)
    : DEFAULT_SORT
}

function sanitizeFollowUpSearchInput(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .slice(0, FOLLOW_UP_SEARCH_MAX_LENGTH)
}

function sanitizeFollowUpSearchQuery(value: string) {
  return sanitizeFollowUpSearchInput(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
}

function parsePositiveInt(value: string | null, fallback: number) {
  if (!value || !/^\d+$/.test(value)) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_FOLLOW_UP_PAGE
    ? parsed
    : fallback
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
    <LabeledProgress
      value={boundedPercentage}
      ariaLabel="Follow-up progress"
      ariaValueText={`${boundedPercentage}% complete, ${completedCount} of ${totalCount} follow-up steps resolved`}
      summaryLabel={`${completedCount}/${totalCount}`}
      size="compact"
      className="w-full"
    />
  )
}

function FollowUpMobileCard({
  item,
  tenantTimezone,
  onOpen,
}: {
  item: EnrollmentRow
  tenantTimezone?: string | null
  onOpen: (enrollmentId: string) => void
}) {
  const contactName = item.contactName || "Unnamed contact"
  const phoneNumber = item.phoneNumber
    ? formatPhoneNumber(item.phoneNumber)
    : "No phone number"
  const templateName = `${item.followUpTemplateName || "Manual follow-up flow"}${
    item.followUpTemplateVersion
      ? ` v${item.followUpTemplateVersion.versionNumber}`
      : ""
  }`
  const dueAt = item.currentStep?.effectiveDueAt ?? item.currentStep?.dueAt ?? null
  const dueLabel = dueAt
    ? formatDateTimeForDisplay(dueAt, tenantTimezone)
    : "No due date"
  const openCard = () => onOpen(item.id)

  return (
    <Card
      role="link"
      tabIndex={0}
      aria-label={`Open ${contactName} service follow-up`}
      className="group cursor-pointer gap-0 rounded-[22px] border-slate-200 bg-white py-0 shadow-sm outline-none transition-[border-color,box-shadow,background-color,transform] hover:border-blue-200 hover:shadow-md focus-visible:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-500/40 active:scale-[0.995] motion-reduce:transform-none motion-reduce:transition-none"
      onClick={openCard}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          openCard()
        }
      }}
    >
      <CardHeader className="gap-1.5 px-4 pt-4 pb-3 has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
        <CardTitle className="truncate pr-2 text-base text-slate-950" title={contactName}>
          {contactName}
        </CardTitle>
        <CardDescription className="truncate text-xs" title={phoneNumber}>
          {phoneNumber}
        </CardDescription>
        <CardAction className="flex items-center gap-1.5">
          {item.currentStep ? (
            <CurrentStepBadge status={item.currentStep.status} />
          ) : null}
          <ArrowRight
            aria-hidden="true"
            className="size-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5"
          />
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 px-4 pb-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs font-medium text-slate-500">Service</p>
          <p className="truncate text-sm font-medium text-slate-800" title={item.serviceName}>
            {item.serviceName}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-slate-500">Current step</p>
            <div className="mt-1 flex min-w-0 items-center gap-2">
              {item.currentStep ? (
                <StepNumberChip stepNumber={item.currentStep.stepNumber} />
              ) : null}
              <p className="truncate text-sm font-medium text-slate-900">
                {item.currentStep?.title || "No active step"}
              </p>
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-slate-500">Assigned</p>
            <p className="mt-1 truncate text-sm text-slate-700">
              {item.currentStep?.assignedToName || "Unassigned"}
            </p>
          </div>
          <div className="col-span-2 min-w-0">
            <p className="text-[11px] font-medium text-slate-500">Template</p>
            <div className="mt-1 flex min-w-0 items-center gap-2">
              <p className="truncate text-sm text-slate-700" title={templateName}>
                {templateName}
              </p>
              {item.followUpRun?.status === "FAILED" ||
              item.followUpRun?.status === "NEEDS_REVIEW" ? (
                <Badge className="shrink-0 border-0 bg-rose-100 text-rose-700">
                  {item.followUpRun.status === "FAILED" ? "Paused" : "Review"}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>

        <ProgressCell {...item.progress} />
      </CardContent>

      <Separator />
      <CardFooter className="flex items-center justify-between gap-3 bg-slate-50/60 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-slate-500">Due date</p>
          <p
            className={cn(
              "mt-1 truncate text-xs",
              item.overdue ? "font-medium text-rose-700" : "text-slate-700",
            )}
            title={dueLabel}
          >
            {dueLabel}
          </p>
        </div>
        {item.overdue ? (
          <Badge variant="outline" className="shrink-0 border-rose-200 bg-rose-50 text-rose-700">
            Overdue
          </Badge>
        ) : (
          <span className="shrink-0 text-xs font-medium text-slate-500">
            {item.progress.remainingCount} remaining
          </span>
        )}
      </CardFooter>
    </Card>
  )
}

function FollowUpMobileCardSkeleton() {
  return (
    <Card aria-hidden="true" className="gap-0 rounded-[22px] py-0 shadow-sm">
      <CardHeader className="gap-2 px-4 pt-4 pb-3 has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
        <CardTitle><Skeleton className="h-5 w-3/5" /></CardTitle>
        <CardDescription><Skeleton className="h-3 w-2/5" /></CardDescription>
        <CardAction><Skeleton className="h-5 w-20 rounded-full" /></CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-4 pb-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-4 w-3/5" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
        <Skeleton className="h-5 w-full rounded-full" />
      </CardContent>
      <Separator />
      <CardFooter className="flex items-center justify-between gap-3 bg-slate-50/60 px-4 py-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-28" />
        </div>
        <Skeleton className="h-5 w-20 rounded-full" />
      </CardFooter>
    </Card>
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
  const [query, setQuery] = useState(() =>
    sanitizeFollowUpSearchInput(searchParams.get("search") ?? ""),
  )
  const [debouncedQuery, setDebouncedQuery] = useState(() =>
    sanitizeFollowUpSearchQuery(searchParams.get("search") ?? ""),
  )
  const [statusFilter, setStatusFilter] = useState(() =>
    sanitizeStatus(searchParams.get("status")),
  )
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
  const [isSortSheetOpen, setIsSortSheetOpen] = useState(false)
  const [sort, setSort] = useState<FollowUpSort>(() =>
    sanitizeSort(searchParams.get("sort")),
  )
  const [draftStatusFilter, setDraftStatusFilter] = useState(
    () => sanitizeStatus(searchParams.get("status")),
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
      setDebouncedQuery(sanitizeFollowUpSearchQuery(query))
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
    if (sort !== DEFAULT_SORT) nextParams.set("sort", sort)
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
    sort,
    statusFilter,
    templateFilter,
  ])

  const loadFollowUps = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const { data: response } = await api.get<FollowUpsResponse>(`/api/services/${encodeURIComponent(tenantId)}/follow-ups`, {
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
          sort,
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
    sort,
    statusFilter,
    templateFilter,
    tenantId,
  ])

  useEffect(() => {
    void loadFollowUps()
  }, [loadFollowUps])

  useEffect(() => {
    const responseTotalPages = data?.pagination.totalPages
    if (responseTotalPages && page > responseTotalPages) {
      setPage(responseTotalPages)
    }
  }, [data?.pagination.totalPages, page])

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
  const hasAppliedFilters = activeFilterCount > 0
  const hasActiveRefinements =
    Boolean(debouncedQuery) ||
    activeFilterCount > 0 ||
    dueDatePreset !== ALL_DUE_DATE_PRESETS
  const hasDraftFilters =
    draftStatusFilter !== DEFAULT_STATUS ||
    draftTemplateFilter !== ALL_TEMPLATE_FILTER ||
    draftAssigneeFilter !== ALL_ASSIGNEE_FILTER
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
  const currentReturnTo = useMemo(() => {
    const queryString = searchParams.toString()
    return queryString ? `${pathname}?${queryString}` : pathname
  }, [pathname, searchParams])
  const selectedSortLabel =
    SORT_OPTIONS.find((option) => option.value === sort)?.label ??
    SORT_OPTIONS[0].label

  const summaryLabel = useMemo(() => {
    if (!total) return "No service follow-ups found"
    const start = startIndex + 1
    const end = start + enrollments.length - 1
    return `Showing ${start}-${end} of ${total} service paths`
  }, [enrollments.length, startIndex, total])

  const clearFilters = () => {
    setStatusFilter(DEFAULT_STATUS)
    setTemplateFilter(ALL_TEMPLATE_FILTER)
    setAssigneeFilter(ALL_ASSIGNEE_FILTER)
    setDraftStatusFilter(DEFAULT_STATUS)
    setDraftTemplateFilter(ALL_TEMPLATE_FILTER)
    setDraftAssigneeFilter(ALL_ASSIGNEE_FILTER)
    setPage(1)
  }

  const openFilterSheet = () => {
    setDraftStatusFilter(statusFilter)
    setDraftTemplateFilter(templateFilter)
    setDraftAssigneeFilter(assigneeFilter)
    setIsFilterSheetOpen(true)
  }

  const applyFilters = () => {
    setStatusFilter(sanitizeStatus(draftStatusFilter))
    setTemplateFilter(draftTemplateFilter)
    setAssigneeFilter(draftAssigneeFilter)
    setPage(1)
    setIsFilterSheetOpen(false)
  }

  const openFollowUp = (enrollmentId: string) => {
    router.push(
      getServiceEnrollmentFollowUpHref({
        tenantSlug,
        contactServiceId: enrollmentId,
        returnTo: currentReturnTo,
      }),
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <header className="shrink-0 rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-4 sm:p-5">
        <h1 className="sr-only">Service follow-ups</h1>

        <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
          <article className="min-w-0 rounded-[22px] border border-white/80 bg-white/75 p-3 shadow-sm backdrop-blur sm:p-4">
            <div className="flex items-center gap-2 text-slate-500">
              <Clock3 className="size-4 text-blue-600" aria-hidden="true" />
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] sm:text-[11px] sm:tracking-[0.16em]">In progress</p>
            </div>
            {isLoading && !data ? <Skeleton className="mt-3 h-8 w-20 rounded-lg" /> : (
              <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight text-slate-950">{summary.servicesInProgress}</p>
            )}
            <p className="mt-1 text-xs text-slate-500">Active service paths.</p>
          </article>

          <article className="min-w-0 rounded-[22px] border border-white/80 bg-white/75 p-3 shadow-sm backdrop-blur sm:p-4">
            <div className="flex items-center gap-2 text-slate-500">
              <AlertTriangle className="size-4 text-rose-600" aria-hidden="true" />
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] sm:text-[11px] sm:tracking-[0.16em]">Overdue</p>
            </div>
            {isLoading && !data ? <Skeleton className="mt-3 h-8 w-20 rounded-lg" /> : (
              <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight text-rose-700">{summary.overdueEnrollments}</p>
            )}
            <p className="mt-1 text-xs text-slate-500">Past-due current steps.</p>
          </article>

          <article className="min-w-0 rounded-[22px] border border-white/80 bg-white/75 p-3 shadow-sm backdrop-blur sm:p-4">
            <div className="flex items-center gap-2 text-slate-500">
              <CalendarClock className="size-4 text-amber-600" aria-hidden="true" />
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] sm:text-[11px] sm:tracking-[0.16em]">Due today</p>
            </div>
            {isLoading && !data ? <Skeleton className="mt-3 h-8 w-20 rounded-lg" /> : (
              <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight text-amber-700">{summary.dueToday}</p>
            )}
            <p className="mt-1 text-xs text-slate-500">Needs attention today.</p>
          </article>

          <article className="min-w-0 rounded-[22px] border border-white/80 bg-white/75 p-3 shadow-sm backdrop-blur sm:p-4">
            <div className="flex items-center gap-2 text-slate-500">
              <Gauge className="size-4 text-indigo-600" aria-hidden="true" />
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] sm:text-[11px] sm:tracking-[0.16em]">Average progress</p>
            </div>
            {isLoading && !data ? <Skeleton className="mt-3 h-8 w-20 rounded-lg" /> : (
              <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight text-indigo-700">{summary.averageProgress}%</p>
            )}
            <p className="mt-1 text-xs text-slate-500">Across active paths.</p>
          </article>
        </div>

        <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center">
          <form
            role="search"
            className="relative w-full lg:min-w-0 lg:flex-1"
            onSubmit={(event) => {
              event.preventDefault()
              setDebouncedQuery(sanitizeFollowUpSearchQuery(query))
              setPage(1)
            }}
          >
            <Input
              id="follow-up-search"
              type="search"
              value={query}
              maxLength={FOLLOW_UP_SEARCH_MAX_LENGTH}
              placeholder="Search by contact name or phone number"
              aria-label="Search follow-ups"
              onChange={(event) => setQuery(sanitizeFollowUpSearchInput(event.target.value))}
              className="h-11 w-full rounded-xl border-white/80 bg-white/85 pr-14 pl-4 text-sm shadow-sm backdrop-blur placeholder:text-slate-400 focus-visible:border-blue-300 focus-visible:ring-blue-100"
            />
            <Button
              type="submit"
              size="icon-lg"
              aria-label="Search follow-ups"
              className="absolute inset-y-0 right-0 h-11 w-12 rounded-l-none rounded-r-xl bg-blue-950 text-white shadow-none hover:bg-blue-900"
            >
              <Search aria-hidden="true" />
            </Button>
          </form>

          <div className="grid w-full grid-cols-2 gap-2 md:grid-cols-3 lg:flex lg:w-auto lg:shrink-0">
            <Button
              type="button"
              variant="outline"
              aria-label={activeFilterCount > 0 ? `Open filters, ${activeFilterCount} active` : "Open filters"}
              aria-expanded={isFilterSheetOpen}
              aria-controls="follow-up-filter-sheet"
              className="h-11 min-w-0 cursor-pointer rounded-full border-white/80 bg-white/85 px-2.5 text-xs font-semibold text-blue-950 shadow-sm backdrop-blur hover:bg-white hover:text-blue-950 sm:px-3 sm:text-sm"
              onClick={openFilterSheet}
            >
              <Filter data-icon="inline-start" aria-hidden="true" />
              <span className="sm:hidden">Filter</span>
              <span className="hidden sm:inline">Filters</span>
              {activeFilterCount > 0 ? (
                <Badge className="h-5 min-w-5 rounded-full bg-blue-950 px-1.5 text-[10px] text-white">{activeFilterCount}</Badge>
              ) : null}
            </Button>

            <Button
              type="button"
              variant="outline"
              aria-label={`Sort follow-ups, currently ${selectedSortLabel}`}
              aria-expanded={isSortSheetOpen}
              aria-controls="follow-up-sort-sheet"
              className="h-11 min-w-0 cursor-pointer rounded-full border-white/80 bg-white/70 px-2.5 text-xs font-semibold text-slate-800 shadow-sm backdrop-blur hover:bg-white hover:text-slate-950 sm:px-3 sm:text-sm lg:hidden"
              onClick={() => setIsSortSheetOpen(true)}
            >
              <span className="truncate sm:hidden">Sort</span>
              <span className="hidden truncate sm:inline">{selectedSortLabel}</span>
              <ChevronDown data-icon="inline-end" aria-hidden="true" />
            </Button>

            <Select
              value={sort}
              onValueChange={(value) => {
                setSort(sanitizeSort(value))
                setPage(1)
              }}
            >
              <SelectTrigger
                size="sm"
                aria-label={`Sort follow-ups, currently ${selectedSortLabel}`}
                className="hidden min-w-48 rounded-full border-white/80 bg-white/70 px-3 text-sm font-semibold text-slate-800 shadow-sm backdrop-blur hover:bg-white data-[size=sm]:h-11 lg:flex"
              >
                <span className="text-slate-500">Sort by</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectGroup>
                  {SORT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>

            <Button
              type="button"
              variant="outline"
              disabled={!hasAppliedFilters}
              className="hidden h-11 min-w-0 cursor-pointer rounded-full border-white/80 bg-white/70 px-3 text-sm font-semibold text-slate-700 shadow-sm backdrop-blur hover:bg-white hover:text-slate-950 md:inline-flex"
              onClick={clearFilters}
            >
              Clear filters
            </Button>
          </div>
        </div>
      </header>

      <Sheet open={isSortSheetOpen} onOpenChange={setIsSortSheetOpen}>
        <SheetContent
          id="follow-up-sort-sheet"
          side="bottom"
          className="mx-auto max-h-[min(32rem,72dvh)] w-full gap-0 overflow-hidden rounded-t-[26px] border-x border-t border-slate-200 bg-white p-0 sm:bottom-4 sm:left-1/2 sm:right-auto sm:w-[min(32rem,calc(100%-2rem))] sm:-translate-x-1/2 sm:rounded-[26px] sm:border [&>button]:right-5 [&>button]:top-5 [&>button]:cursor-pointer [&>button]:rounded-full [&>button]:bg-slate-100 [&>button]:opacity-100"
        >
          <div aria-hidden="true" className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-slate-200 sm:hidden" />
          <SheetHeader className="border-b border-slate-100 px-5 pt-4 pb-3 text-left sm:px-6 sm:pt-5">
            <SheetTitle className="pr-10 text-lg font-semibold text-slate-950">Sort follow-ups</SheetTitle>
            <SheetDescription className="sr-only">Choose the order used for the follow-up register.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:px-5 sm:pb-5">
            <ToggleGroup
              type="single"
              value={sort}
              orientation="vertical"
              spacing={2}
              aria-label="Choose follow-up order"
              className="grid w-full gap-2"
              onValueChange={(value) => {
                if (!value) return
                setSort(sanitizeSort(value))
                setPage(1)
                setIsSortSheetOpen(false)
              }}
            >
              {SORT_OPTIONS.map((option) => (
                <ToggleGroupItem
                  key={option.value}
                  value={option.value}
                  variant="outline"
                  aria-label={`Sort by ${option.label}`}
                  className="h-12 w-full justify-between rounded-xl border-slate-200 bg-white px-4 text-left text-sm font-medium text-slate-700 shadow-none hover:bg-slate-50 hover:text-slate-950 data-[state=on]:border-blue-200 data-[state=on]:bg-blue-50 data-[state=on]:text-blue-950"
                >
                  <span>{option.label}</span>
                  <Check aria-hidden="true" className={cn("text-blue-800 transition-opacity", option.value === sort ? "opacity-100" : "opacity-0")} />
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={isFilterSheetOpen} onOpenChange={setIsFilterSheetOpen}>
        <SheetContent
          id="follow-up-filter-sheet"
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
                <Select
                  value={draftStatusFilter}
                  onValueChange={(value) => setDraftStatusFilter(sanitizeStatus(value))}
                >
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
              disabled={!hasDraftFilters && !hasAppliedFilters}
              className={COMPACT_SECONDARY_BUTTON_CLASS}
              onClick={() => {
                clearFilters()
                setIsFilterSheetOpen(false)
              }}
            >
              Clear filters
            </Button>
            <Button
              type="button"
              className={COMPACT_PRIMARY_BUTTON_CLASS}
              onClick={applyFilters}
            >
              Apply filters
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Tabs
        value={dueDatePreset}
        onValueChange={(value) => {
          setDueDatePreset(sanitizeDueDateTab(value))
          setPage(1)
        }}
        aria-label="Follow-ups by due date"
        aria-busy={isLoading}
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

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 md:hidden">
          {isLoading ? (
            <div className="flex flex-col gap-3" role="status">
              <span className="sr-only">Loading follow-ups</span>
              {Array.from({ length: 3 }, (_, index) => (
                <FollowUpMobileCardSkeleton key={`mobile-follow-up-skeleton-${index}`} />
              ))}
            </div>
          ) : errorMessage ? (
            <div
              className="flex flex-col items-start gap-3 rounded-[20px] border border-rose-200 bg-rose-50/60 p-4 text-sm text-rose-700"
              role="alert"
            >
              <p>{errorMessage}</p>
              <Button
                type="button"
                variant="outline"
                className={COMPACT_SECONDARY_BUTTON_CLASS}
                onClick={() => void loadFollowUps()}
              >
                <RefreshCw data-icon="inline-start" aria-hidden="true" />
                Try again
              </Button>
            </div>
          ) : enrollments.length ? (
            <div className="flex flex-col gap-3" role="list">
              {enrollments.map((item) => (
                <div key={`mobile-${item.id}`} role="listitem">
                  <FollowUpMobileCard
                    item={item}
                    tenantTimezone={tenantTimezone}
                    onOpen={openFollowUp}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-[20px] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-10 text-center">
              <p className="text-sm leading-6 text-slate-500">
                {hasActiveRefinements
                  ? "No service follow-ups match the current search and filters."
                  : "No service follow-ups are available yet."}
              </p>
            </div>
          )}
        </div>

        <div className="hidden min-h-0 flex-1 overflow-auto px-4 pt-4 md:block">
          <Table
            className="min-w-[1280px] table-fixed border-separate border-spacing-0"
            aria-label="Follow-ups"
          >
            <TableHeader className="drop-shadow-sm [&_tr]:border-0">
              <TableRow className="h-14 border-0 hover:bg-transparent">
                <TableHead className="w-[18%] rounded-l-xl border-y border-l bg-slate-50 px-4 text-xs text-slate-600">
                  Contact
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
                <TableHead className="w-[10%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Assigned
                </TableHead>
                <TableHead className="w-[8%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Status
                </TableHead>
                <TableHead className="w-[10%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Due Date
                </TableHead>
                <TableHead className="w-[15%] rounded-r-xl border-y border-r bg-slate-50 px-4 text-xs text-slate-600">
                  Progress
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow
                aria-hidden="true"
                className="h-2 border-0 hover:bg-transparent"
              >
                <TableCell colSpan={8} className="p-0" />
              </TableRow>
              {isLoading ? (
                Array.from({ length: pageSize }, (_, index) => (
                  <TableRow
                    key={`follow-up-loading-${index}`}
                    className="h-14 hover:bg-transparent"
                  >
                    <TableCell className="px-4 py-0">
                      <div className="flex flex-col gap-1.5">
                        <Skeleton className="h-4 w-4/5" />
                        <Skeleton className="h-3 w-3/5" />
                      </div>
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
                      <Skeleton className="h-5 w-full rounded-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : errorMessage ? (
                <TableRow className="h-14 hover:bg-transparent">
                  <TableCell
                    colSpan={8}
                    className="px-4 py-0 text-center text-sm text-rose-600"
                  >
                    <div className="flex items-center justify-center gap-3" role="alert">
                      <span>{errorMessage}</span>
                      <Button
                        type="button"
                        variant="outline"
                        className={COMPACT_SECONDARY_BUTTON_CLASS}
                        onClick={() => void loadFollowUps()}
                      >
                        <RefreshCw data-icon="inline-start" aria-hidden="true" />
                        Try again
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : enrollments.length ? (
                enrollments.map((item) => (
                    <TableRow
                      key={item.id}
                      role="link"
                      tabIndex={0}
                      aria-label={`Open ${item.contactName || "Unnamed contact"} service follow-up`}
                      className="h-14 cursor-pointer outline-none hover:bg-blue-50/50 focus-visible:bg-blue-50/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40"
                      onClick={() => openFollowUp(item.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          openFollowUp(item.id)
                        }
                      }}
                    >
                      <TableCell className="px-4 py-0">
                        <p className="truncate font-medium text-slate-900">
                          {item.contactName || "Unnamed contact"}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {item.phoneNumber
                            ? formatPhoneNumber(item.phoneNumber)
                            : "No number"}
                        </p>
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
                          dueAt={item.currentStep?.effectiveDueAt ?? item.currentStep?.dueAt ?? null}
                          isOverdue={item.overdue}
                          tenantTimezone={tenantTimezone}
                        />
                      </TableCell>
                      <TableCell className="px-4 py-0">
                        <ProgressCell {...item.progress} />
                      </TableCell>
                    </TableRow>
                ))
              ) : (
                <TableRow className="h-14 hover:bg-transparent">
                  <TableCell
                    colSpan={8}
                    className="px-4 py-0 text-center text-sm text-slate-500"
                  >
                    {hasActiveRefinements
                      ? "No service follow-ups match the current search and filters."
                      : "No service follow-ups are available yet."}
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
                      <TableCell colSpan={8} className="px-4 py-0" />
                    </TableRow>
                  ))
                : null}
            </TableBody>
          </Table>
        </div>

        <footer className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50/40 px-3 py-3 md:flex-row md:items-center md:justify-between md:bg-white md:px-4 md:py-4">
          <div className="flex w-full items-center justify-between gap-3 md:w-auto md:flex-wrap md:justify-start md:gap-x-5 md:gap-y-3">
            {isLoading ? (
              <Skeleton className="h-4 w-40" />
            ) : (
              <p className="min-w-0 truncate text-xs text-slate-500 sm:text-sm" aria-live="polite">
                {errorMessage ? "Follow-ups could not be loaded" : summaryLabel}
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
            aria-label="Follow-up list pagination"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Previous page"
              disabled={!canGoPrevious || isLoading}
              className="h-10 min-w-0 rounded-xl px-3 text-xs text-slate-700 shadow-none md:size-8 md:rounded-md md:px-0"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
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
                aria-label={pageNumber === page ? `Page ${pageNumber}` : `Go to page ${pageNumber}`}
                aria-current={pageNumber === page ? "page" : undefined}
                disabled={isLoading || pageNumber === page}
                className={cn(
                  "hidden md:inline-flex",
                  pageNumber === page &&
                    "bg-blue-950 text-white hover:bg-blue-900 disabled:opacity-100",
                )}
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
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              <span className="md:sr-only">Next</span>
              <ChevronRight aria-hidden="true" />
            </Button>
          </nav>
        </footer>
      </Tabs>
    </div>
  )
}
