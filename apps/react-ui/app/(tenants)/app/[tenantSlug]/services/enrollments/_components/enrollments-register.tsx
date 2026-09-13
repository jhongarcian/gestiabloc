"use client"

import { isAxiosError } from "axios"
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  RefreshCw,
} from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { startTransition, useCallback, useEffect, useMemo, useState } from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
  FieldLegend,
  FieldSet,
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
import { api } from "@/lib/api"
import { formatDateTimeForDisplay } from "@/lib/date-time"
import { getServiceEnrollmentHref } from "@/lib/routes"
import { cn } from "@/lib/utils"

type EnrollmentStatus =
  | "IN_PROGRESS"
  | "PENDING_PAYMENT"
  | "COMPLETED"
  | "CANCELED"

type EnrollmentItem = {
  id: string
  contact: {
    id: string
    displayName: string
    phone: string | null
    email: string | null
  }
  service: {
    id: string
    name: string
  }
  template: {
    id: string
    name: string
  } | null
  status: EnrollmentStatus
  coordinator: {
    id: string
    name: string
    email: string
    image: string | null
  } | null
  startedAt: string | null
  lastActivityAt: string
}

type EnrollmentsResponse = {
  ok: boolean
  items: EnrollmentItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

type ServiceOption = {
  id: string
  name: string
  isActive: boolean
}

type TemplateOption = {
  id: string
  name: string
}

type CoordinatorOption = {
  value: string
  label: string
  email: string
  image: string | null
}

const PAGE_SIZE_OPTIONS = [10, 25] as const
const ALL_SERVICES = "ALL_SERVICES"
const ALL_TEMPLATES = "ALL_TEMPLATES"
const NO_TEMPLATE = "NO_TEMPLATE"
const ALL_COORDINATORS = "ALL_COORDINATORS"
const UNASSIGNED = "UNASSIGNED"

const STATUS_OPTIONS: Array<{ value: EnrollmentStatus; label: string }> = [
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "PENDING_PAYMENT", label: "Pending payment" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELED", label: "Canceled" },
]

const STATUS_VALUES = new Set<EnrollmentStatus>(
  STATUS_OPTIONS.map((option) => option.value),
)

const COMPACT_PRIMARY_BUTTON_CLASS =
  "h-8 shrink-0 cursor-pointer rounded-full bg-blue-950 px-3 py-1 text-xs font-semibold text-white shadow-sm ring-1 ring-black/5 transition hover:bg-blue-900 hover:text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"

const COMPACT_SECONDARY_BUTTON_CLASS =
  "h-8 shrink-0 cursor-pointer rounded-full border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function parseStatusFilters(value: string | null) {
  if (!value) return []

  return STATUS_OPTIONS.map((option) => option.value).filter((status) =>
    value
      .split(",")
      .map((item) => item.trim())
      .some((item) => item === status && STATUS_VALUES.has(status)),
  )
}

function getInitials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.length ? parts.map((part) => part[0]?.toUpperCase() ?? "").join("") : "?"
}

function getStatusLabel(status: EnrollmentStatus) {
  return STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status
}

function getStatusClassName(status: EnrollmentStatus) {
  if (status === "COMPLETED") return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (status === "PENDING_PAYMENT") return "border-amber-200 bg-amber-50 text-amber-700"
  if (status === "CANCELED") return "border-slate-200 bg-slate-100 text-slate-500"
  return "border-blue-200 bg-blue-50 text-blue-700"
}

function CoordinatorFilterPicker({
  coordinators,
  value,
  onValueChange,
  id,
}: {
  coordinators: CoordinatorOption[]
  value: string
  onValueChange: (value: string) => void
  id: string
}) {
  const [open, setOpen] = useState(false)
  const selectedCoordinator = useMemo(
    () => coordinators.find((coordinator) => coordinator.value === value) ?? null,
    [coordinators, value],
  )
  const label =
    value === UNASSIGNED
      ? "Unassigned"
      : selectedCoordinator?.label ?? "All coordinators"

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
            <Avatar size="sm" className={selectedCoordinator ? "ring-2 ring-blue-50" : undefined}>
              {selectedCoordinator?.image ? (
                <AvatarImage
                  src={selectedCoordinator.image}
                  alt={`${selectedCoordinator.label} profile photo`}
                  className="object-cover"
                />
              ) : null}
              <AvatarFallback
                className={cn(
                  "font-semibold",
                  selectedCoordinator
                    ? "bg-blue-950 text-white"
                    : "bg-slate-100 text-slate-500",
                )}
              >
                {selectedCoordinator ? getInitials(selectedCoordinator.label) : "—"}
              </AvatarFallback>
            </Avatar>
            <span className="truncate font-medium text-slate-800">{label}</span>
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
            <CommandGroup heading="Coordinator">
              <CommandItem
                value="All coordinators no assignment filter"
                onSelect={() => {
                  onValueChange(ALL_COORDINATORS)
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
                  All coordinators
                </span>
                <Check
                  className={cn(
                    "text-blue-800",
                    value === ALL_COORDINATORS ? "opacity-100" : "opacity-0",
                  )}
                />
              </CommandItem>

              <CommandItem
                value="Unassigned no coordinator"
                onSelect={() => {
                  onValueChange(UNASSIGNED)
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
                  Unassigned
                </span>
                <Check
                  className={cn(
                    "text-blue-800",
                    value === UNASSIGNED ? "opacity-100" : "opacity-0",
                  )}
                />
              </CommandItem>

              {coordinators.map((coordinator) => (
                <CommandItem
                  key={coordinator.value}
                  value={`${coordinator.label} ${coordinator.email} ${coordinator.value}`}
                  onSelect={() => {
                    onValueChange(coordinator.value)
                    setOpen(false)
                  }}
                  className="cursor-pointer gap-3 py-2.5"
                >
                  <Avatar size="sm" className="ring-2 ring-blue-50">
                    {coordinator.image ? (
                      <AvatarImage
                        src={coordinator.image}
                        alt={`${coordinator.label} profile photo`}
                        className="object-cover"
                      />
                    ) : null}
                    <AvatarFallback className="bg-blue-950 font-semibold text-white">
                      {getInitials(coordinator.label)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-800">
                      {coordinator.label}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {coordinator.email}
                    </span>
                  </span>
                  <Check
                    className={cn(
                      "text-blue-800",
                      value === coordinator.value ? "opacity-100" : "opacity-0",
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

export function EnrollmentsRegister({
  tenantId,
  tenantSlug,
  tenantTimezone,
}: {
  tenantId: string
  tenantSlug: string
  tenantTimezone?: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [query, setQuery] = useState(() => searchParams.get("search") ?? "")
  const [debouncedQuery, setDebouncedQuery] = useState(() =>
    (searchParams.get("search") ?? "").trim(),
  )
  const [statusFilters, setStatusFilters] = useState<EnrollmentStatus[]>(() =>
    parseStatusFilters(searchParams.get("statuses")),
  )
  const [serviceFilter, setServiceFilter] = useState(
    () => searchParams.get("serviceId") ?? ALL_SERVICES,
  )
  const [templateFilter, setTemplateFilter] = useState(() =>
    searchParams.get("withoutTemplate") === "true"
      ? NO_TEMPLATE
      : searchParams.get("followUpTemplateId") ?? ALL_TEMPLATES,
  )
  const [coordinatorFilter, setCoordinatorFilter] = useState(() =>
    searchParams.get("unassigned") === "true"
      ? UNASSIGNED
      : searchParams.get("assignedToUserId") ?? ALL_COORDINATORS,
  )
  const [page, setPage] = useState(() => parsePositiveInt(searchParams.get("page"), 1))
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(() =>
    parsePositiveInt(searchParams.get("pageSize"), 10) === 25 ? 25 : 10,
  )
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false)
  const [draftStatusFilters, setDraftStatusFilters] = useState(statusFilters)
  const [draftServiceFilter, setDraftServiceFilter] = useState(serviceFilter)
  const [draftTemplateFilter, setDraftTemplateFilter] = useState(templateFilter)
  const [draftCoordinatorFilter, setDraftCoordinatorFilter] = useState(coordinatorFilter)
  const [data, setData] = useState<EnrollmentsResponse | null>(null)
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([])
  const [templateOptions, setTemplateOptions] = useState<TemplateOption[]>([])
  const [coordinatorOptions, setCoordinatorOptions] = useState<CoordinatorOption[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const normalizedQuery = query.trim()
    if (normalizedQuery === debouncedQuery) return

    const timeout = window.setTimeout(() => {
      setDebouncedQuery(normalizedQuery)
      setPage(1)
    }, 300)

    return () => window.clearTimeout(timeout)
  }, [debouncedQuery, query])

  const serializedQuery = useMemo(() => {
    const nextParams = new URLSearchParams()

    if (debouncedQuery) nextParams.set("search", debouncedQuery)
    if (statusFilters.length) nextParams.set("statuses", statusFilters.join(","))
    if (serviceFilter !== ALL_SERVICES) nextParams.set("serviceId", serviceFilter)
    if (templateFilter === NO_TEMPLATE) {
      nextParams.set("withoutTemplate", "true")
    } else if (templateFilter !== ALL_TEMPLATES) {
      nextParams.set("followUpTemplateId", templateFilter)
    }
    if (coordinatorFilter === UNASSIGNED) {
      nextParams.set("unassigned", "true")
    } else if (coordinatorFilter !== ALL_COORDINATORS) {
      nextParams.set("assignedToUserId", coordinatorFilter)
    }
    if (page > 1) nextParams.set("page", String(page))
    if (pageSize !== 10) nextParams.set("pageSize", String(pageSize))

    return nextParams.toString()
  }, [
    coordinatorFilter,
    debouncedQuery,
    page,
    pageSize,
    serviceFilter,
    statusFilters,
    templateFilter,
  ])

  useEffect(() => {
    if (serializedQuery === searchParams.toString()) return

    startTransition(() => {
      router.replace(serializedQuery ? `${pathname}?${serializedQuery}` : pathname, {
        scroll: false,
      })
    })
  }, [pathname, router, searchParams, serializedQuery])

  const loadEnrollments = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const { data: response } = await api.get<EnrollmentsResponse>(
        `/api/services/${encodeURIComponent(tenantId)}/enrollments`,
        {
          params: {
            page,
            pageSize,
            search: debouncedQuery || undefined,
            statuses: statusFilters.length ? statusFilters.join(",") : undefined,
            serviceId: serviceFilter === ALL_SERVICES ? undefined : serviceFilter,
            followUpTemplateId:
              templateFilter === ALL_TEMPLATES || templateFilter === NO_TEMPLATE
                ? undefined
                : templateFilter,
            withoutTemplate: templateFilter === NO_TEMPLATE ? true : undefined,
            assignedToUserId:
              coordinatorFilter === ALL_COORDINATORS || coordinatorFilter === UNASSIGNED
                ? undefined
                : coordinatorFilter,
            unassigned: coordinatorFilter === UNASSIGNED ? true : undefined,
          },
        },
      )

      setData(response)
      if (page > response.pagination.totalPages) {
        setPage(response.pagination.totalPages)
      }
    } catch (error) {
      setData(null)
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        setErrorMessage(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not load enrollments.",
        )
      } else {
        setErrorMessage("Could not load enrollments.")
      }
    } finally {
      setIsLoading(false)
    }
  }, [
    coordinatorFilter,
    debouncedQuery,
    page,
    pageSize,
    serviceFilter,
    statusFilters,
    templateFilter,
    tenantId,
  ])

  useEffect(() => {
    void loadEnrollments()
  }, [loadEnrollments])

  useEffect(() => {
    let cancelled = false

    const loadFilterOptions = async () => {
      const [servicesResult, templatesResult, coordinatorsResult] = await Promise.allSettled([
        api.get<{ ok: boolean; items: ServiceOption[] }>(
          `/api/account-settings/${encodeURIComponent(tenantId)}/services/options`,
          { params: { includeInactive: true } },
        ),
        api.get<{ ok: boolean; items: TemplateOption[] }>(
          `/api/services/${encodeURIComponent(tenantId)}/follow-up-template-options`,
        ),
        api.get<{ ok: boolean; items: CoordinatorOption[] }>(
          `/api/tasks/${encodeURIComponent(tenantId)}/assignees`,
        ),
      ])

      if (cancelled) return

      setServiceOptions(
        servicesResult.status === "fulfilled" ? servicesResult.value.data.items ?? [] : [],
      )
      setTemplateOptions(
        templatesResult.status === "fulfilled" ? templatesResult.value.data.items ?? [] : [],
      )
      setCoordinatorOptions(
        coordinatorsResult.status === "fulfilled"
          ? coordinatorsResult.value.data.items ?? []
          : [],
      )
    }

    void loadFilterOptions()
    return () => {
      cancelled = true
    }
  }, [tenantId])

  const currentReturnTo = serializedQuery ? `${pathname}?${serializedQuery}` : pathname
  const enrollments = data?.items ?? []
  const total = data?.pagination.total ?? 0
  const totalPages = data?.pagination.totalPages ?? 1
  const startIndex = (page - 1) * pageSize
  const canGoPrevious = page > 1
  const canGoNext = page < totalPages
  const activeFilterCount =
    statusFilters.length +
    (serviceFilter !== ALL_SERVICES ? 1 : 0) +
    (templateFilter !== ALL_TEMPLATES ? 1 : 0) +
    (coordinatorFilter !== ALL_COORDINATORS ? 1 : 0)
  const hasActiveQueryOrFilters = Boolean(query.trim()) || activeFilterCount > 0
  const placeholderRowCount =
    enrollments.length === 0 ? pageSize - 1 : Math.max(0, pageSize - enrollments.length)
  const visiblePageCount = Math.min(5, totalPages)
  const firstVisiblePage = Math.max(
    1,
    Math.min(page - 2, totalPages - visiblePageCount + 1),
  )
  const visiblePages = Array.from(
    { length: visiblePageCount },
    (_, index) => firstVisiblePage + index,
  )
  const summaryLabel = total
    ? `Showing ${startIndex + 1}-${startIndex + enrollments.length} of ${total} enrollments`
    : "No enrollments found"

  const openEnrollment = useCallback(
    (contactServiceId: string) => {
      router.push(
        getServiceEnrollmentHref({
          tenantSlug,
          contactServiceId,
          returnTo: currentReturnTo,
        }),
      )
    },
    [currentReturnTo, router, tenantSlug],
  )

  const clearAllFilters = () => {
    setQuery("")
    setDebouncedQuery("")
    setStatusFilters([])
    setServiceFilter(ALL_SERVICES)
    setTemplateFilter(ALL_TEMPLATES)
    setCoordinatorFilter(ALL_COORDINATORS)
    setDraftStatusFilters([])
    setDraftServiceFilter(ALL_SERVICES)
    setDraftTemplateFilter(ALL_TEMPLATES)
    setDraftCoordinatorFilter(ALL_COORDINATORS)
    setPage(1)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <header className="shrink-0 rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-xs font-semibold text-blue-700">Service operations</p>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold text-slate-950">Enrollments</h1>
            <p className="text-sm text-slate-600">
              Track service ownership, workflow status, and recent activity across your contacts.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(280px,1fr)_auto_auto]">
          <Input
            type="search"
            placeholder="Search contacts, services, templates, or coordinators"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(1)
            }}
            aria-label="Search enrollments"
            className="h-11 rounded-xl border-white/80 bg-white/85 px-4 shadow-sm backdrop-blur placeholder:text-slate-400 focus-visible:border-blue-300 focus-visible:ring-blue-100"
          />
          <Button
            type="button"
            variant="outline"
            className="h-11 cursor-pointer rounded-xl border-white/80 bg-white/85 px-4 text-blue-950 shadow-sm backdrop-blur hover:bg-white hover:text-blue-950"
            onClick={() => {
              setDraftStatusFilters(statusFilters)
              setDraftServiceFilter(serviceFilter)
              setDraftTemplateFilter(templateFilter)
              setDraftCoordinatorFilter(coordinatorFilter)
              setIsFilterSheetOpen(true)
            }}
          >
            <Filter data-icon="inline-start" aria-hidden="true" />
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
            className="h-11 cursor-pointer rounded-xl border-white/80 bg-white/70 px-4 text-slate-700 shadow-sm backdrop-blur hover:bg-white hover:text-slate-950"
            onClick={clearAllFilters}
          >
            Clear filters
          </Button>
        </div>
      </header>

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
              <p className="text-xs font-semibold text-blue-700">Enrollment filters</p>
              <SheetTitle className="mt-1.5 text-xl font-semibold text-slate-950 sm:text-2xl">
                Refine enrollments
              </SheetTitle>
              <SheetDescription className="mt-1.5 max-w-xl text-sm leading-6 text-slate-600">
                Filter by workflow status, service, template, and coordinator.
              </SheetDescription>
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6 [scrollbar-gutter:stable] sm:px-7">
            <FieldGroup className="gap-6">
              <FieldSet className="gap-2">
                <FieldLegend variant="label" className="mb-0 text-slate-800">
                  Enrollment status
                </FieldLegend>
                <FieldDescription className="text-xs">
                  Show enrollments matching any selected status.
                </FieldDescription>
                <FieldGroup className="gap-2">
                  {STATUS_OPTIONS.map((option) => {
                    const checked = draftStatusFilters.includes(option.value)
                    const checkboxId = `enrollment-status-${option.value}`

                    return (
                      <Field
                        key={option.value}
                        orientation="horizontal"
                        className="min-h-10 gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 transition-colors hover:bg-white"
                      >
                        <Checkbox
                          id={checkboxId}
                          checked={checked}
                          onCheckedChange={(nextChecked) => {
                            setDraftStatusFilters((current) =>
                              nextChecked
                                ? [...current, option.value]
                                : current.filter((status) => status !== option.value),
                            )
                          }}
                        />
                        <FieldLabel htmlFor={checkboxId} className="cursor-pointer">
                          <Badge
                            variant="outline"
                            className={getStatusClassName(option.value)}
                          >
                            {option.label}
                          </Badge>
                        </FieldLabel>
                      </Field>
                    )
                  })}
                </FieldGroup>
              </FieldSet>

              <Separator />

              <Field>
                <FieldLabel htmlFor="enrollment-service-filter">Service</FieldLabel>
                <Select value={draftServiceFilter} onValueChange={setDraftServiceFilter}>
                  <SelectTrigger
                    id="enrollment-service-filter"
                    className="h-11 w-full rounded-xl border-blue-100 bg-white"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={ALL_SERVICES}>All services</SelectItem>
                      {serviceOptions.map((service) => (
                        <SelectItem key={service.id} value={service.id}>
                          {service.name}{service.isActive ? "" : " (Inactive)"}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Separator />

              <Field>
                <FieldLabel htmlFor="enrollment-template-filter">Template</FieldLabel>
                <Select value={draftTemplateFilter} onValueChange={setDraftTemplateFilter}>
                  <SelectTrigger
                    id="enrollment-template-filter"
                    className="h-11 w-full rounded-xl border-blue-100 bg-white"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={ALL_TEMPLATES}>All templates</SelectItem>
                      <SelectItem value={NO_TEMPLATE}>No template</SelectItem>
                      {templateOptions.map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription className="text-xs">
                  No template identifies enrollments using a manual flow.
                </FieldDescription>
              </Field>

              <Separator />

              <Field>
                <FieldLabel htmlFor="enrollment-coordinator-filter">
                  Coordinator
                </FieldLabel>
                <CoordinatorFilterPicker
                  id="enrollment-coordinator-filter"
                  coordinators={coordinatorOptions}
                  value={draftCoordinatorFilter}
                  onValueChange={setDraftCoordinatorFilter}
                />
                <FieldDescription className="text-xs">
                  Show enrollments assigned to a specific coordinator or left unassigned.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </div>

          <SheetFooter className="border-t border-slate-200 bg-slate-50/80 px-6 py-4 sm:flex-row sm:justify-end sm:px-7">
            <Button
              type="button"
              variant="outline"
              className={COMPACT_SECONDARY_BUTTON_CLASS}
              onClick={() => {
                setDraftStatusFilters([])
                setDraftServiceFilter(ALL_SERVICES)
                setDraftTemplateFilter(ALL_TEMPLATES)
                setDraftCoordinatorFilter(ALL_COORDINATORS)
              }}
            >
              Clear
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={COMPACT_PRIMARY_BUTTON_CLASS}
              onClick={() => {
                setStatusFilters(
                  STATUS_OPTIONS.map((option) => option.value).filter((status) =>
                    draftStatusFilters.includes(status),
                  ),
                )
                setServiceFilter(draftServiceFilter)
                setTemplateFilter(draftTemplateFilter)
                setCoordinatorFilter(draftCoordinatorFilter)
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
        aria-label="Service enrollments"
        aria-busy={isLoading}
      >
        <div className="min-h-0 flex-1 overflow-auto px-4 pt-4">
          <Table
            className="min-w-[1240px] table-fixed border-separate border-spacing-0"
            aria-label="Enrollments"
          >
            <TableHeader className="drop-shadow-sm [&_tr]:border-0">
              <TableRow className="h-14 border-0 hover:bg-transparent">
                <TableHead className="w-[18%] rounded-l-xl border-y border-l bg-slate-50 px-4 text-xs text-slate-600">
                  Contact name
                </TableHead>
                <TableHead className="w-[17%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Service name
                </TableHead>
                <TableHead className="w-[17%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Template
                </TableHead>
                <TableHead className="w-[13%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Status
                </TableHead>
                <TableHead className="w-[17%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Assigned to
                </TableHead>
                <TableHead className="w-[9%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Started
                </TableHead>
                <TableHead className="w-[9%] rounded-r-xl border-y border-r bg-slate-50 px-4 text-xs text-slate-600">
                  Last activity
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow aria-hidden="true" className="h-2 border-0 hover:bg-transparent">
                <TableCell colSpan={7} className="p-0" />
              </TableRow>

              {isLoading ? (
                Array.from({ length: pageSize }, (_, index) => (
                  <TableRow
                    key={`enrollment-skeleton-${index}`}
                    className="h-14 hover:bg-transparent"
                  >
                    <TableCell className="px-4 py-0"><Skeleton className="h-4 w-4/5" /></TableCell>
                    <TableCell className="px-4 py-0"><Skeleton className="h-4 w-4/5" /></TableCell>
                    <TableCell className="px-4 py-0"><Skeleton className="h-4 w-4/5" /></TableCell>
                    <TableCell className="px-4 py-0"><Skeleton className="h-5 w-24 rounded-full" /></TableCell>
                    <TableCell className="px-4 py-0">
                      <div className="flex items-center gap-2.5">
                        <Skeleton className="size-6 rounded-full" />
                        <Skeleton className="h-4 w-24" />
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-0"><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell className="px-4 py-0"><Skeleton className="h-4 w-20" /></TableCell>
                  </TableRow>
                ))
              ) : errorMessage ? (
                <TableRow className="h-14 hover:bg-transparent">
                  <TableCell colSpan={7} className="px-4 py-0 text-center text-rose-700">
                    <div className="flex items-center justify-center gap-3" role="alert">
                      <span>{errorMessage}</span>
                      <Button
                        type="button"
                        variant="outline"
                        className={COMPACT_SECONDARY_BUTTON_CLASS}
                        onClick={() => void loadEnrollments()}
                      >
                        <RefreshCw data-icon="inline-start" aria-hidden="true" />
                        Try again
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : enrollments.length ? (
                enrollments.map((enrollment) => {
                  const isCanceled = enrollment.status === "CANCELED"
                  const startedLabel = enrollment.startedAt
                    ? formatDateTimeForDisplay(enrollment.startedAt, tenantTimezone)
                    : "—"
                  const lastActivityLabel = formatDateTimeForDisplay(
                    enrollment.lastActivityAt,
                    tenantTimezone,
                  )

                  return (
                    <TableRow
                      key={enrollment.id}
                      tabIndex={0}
                      role="link"
                      aria-label={`Open ${enrollment.contact.displayName} ${enrollment.service.name} enrollment`}
                      className={cn(
                        "h-14 cursor-pointer outline-none hover:bg-blue-50/50 focus-visible:bg-blue-50/50 focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-inset",
                        isCanceled && "bg-slate-50/70",
                      )}
                      onClick={() => openEnrollment(enrollment.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          openEnrollment(enrollment.id)
                        }
                      }}
                    >
                      <TableCell className="px-4 py-0">
                        <span
                          className={cn(
                            "block truncate font-medium text-slate-950",
                            isCanceled && "text-slate-500",
                          )}
                          title={enrollment.contact.displayName}
                        >
                          {enrollment.contact.displayName}
                        </span>
                      </TableCell>
                      <TableCell className="px-4 py-0">
                        <span
                          className={cn(
                            "block truncate font-medium text-slate-800",
                            isCanceled && "text-slate-500",
                          )}
                          title={enrollment.service.name}
                        >
                          {enrollment.service.name}
                        </span>
                      </TableCell>
                      <TableCell className="px-4 py-0">
                        <span
                          className={cn(
                            "block truncate text-slate-700",
                            !enrollment.template && "italic text-slate-500",
                            isCanceled && "text-slate-500",
                          )}
                          title={enrollment.template?.name ?? "Manual flow"}
                        >
                          {enrollment.template?.name ?? "Manual flow"}
                        </span>
                      </TableCell>
                      <TableCell className="px-4 py-0">
                        <Badge
                          variant="outline"
                          className={getStatusClassName(enrollment.status)}
                        >
                          {getStatusLabel(enrollment.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-4 py-0">
                        {enrollment.coordinator ? (
                          <div className="flex min-w-0 items-center gap-2.5">
                            <Avatar size="sm">
                              {enrollment.coordinator.image ? (
                                <AvatarImage
                                  src={enrollment.coordinator.image}
                                  alt={`${enrollment.coordinator.name} profile photo`}
                                  className="object-cover"
                                />
                              ) : null}
                              <AvatarFallback>
                                {getInitials(enrollment.coordinator.name)}
                              </AvatarFallback>
                            </Avatar>
                            <span
                              className={cn(
                                "truncate text-slate-700",
                                isCanceled && "text-slate-500",
                              )}
                              title={enrollment.coordinator.name}
                            >
                              {enrollment.coordinator.name}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-500">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "px-4 py-0 text-xs text-slate-600",
                          isCanceled && "text-slate-500",
                        )}
                      >
                        <span className="block truncate" title={startedLabel}>
                          {startedLabel}
                        </span>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "px-4 py-0 text-xs text-slate-600",
                          isCanceled && "text-slate-500",
                        )}
                      >
                        <span className="block truncate" title={lastActivityLabel}>
                          {lastActivityLabel}
                        </span>
                      </TableCell>
                    </TableRow>
                  )
                })
              ) : (
                <TableRow className="h-14 hover:bg-transparent">
                  <TableCell colSpan={7} className="px-4 py-0 text-center text-slate-500">
                    {hasActiveQueryOrFilters
                      ? "No enrollments match the current search and filters."
                      : "No service enrollments have been created yet."}
                  </TableCell>
                </TableRow>
              )}

              {!isLoading && !errorMessage
                ? Array.from({ length: placeholderRowCount }, (_, index) => (
                    <TableRow
                      key={`enrollment-placeholder-${index}`}
                      aria-hidden="true"
                      className="h-14 hover:bg-transparent"
                    >
                      <TableCell colSpan={7} className="px-4 py-0" />
                    </TableRow>
                  ))
                : null}
            </TableBody>
          </Table>
        </div>

        <footer className="flex flex-col gap-4 border-t border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            {isLoading ? (
              <Skeleton className="h-4 w-40" />
            ) : (
              <p className="text-sm text-slate-500" aria-live="polite">
                {errorMessage ? "Enrollments could not be loaded" : summaryLabel}
              </p>
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
                <SelectTrigger size="sm" aria-label="Rows per page" className="w-20 rounded-lg">
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
            aria-label="Enrollment list pagination"
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
                  pageNumber === page ? `Page ${pageNumber}` : `Go to page ${pageNumber}`
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
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </nav>
        </footer>
      </section>
    </div>
  )
}
