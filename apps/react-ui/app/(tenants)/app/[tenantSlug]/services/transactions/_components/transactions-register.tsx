"use client"

import { isAxiosError } from "axios"
import {
  ArrowRight,
  BanknoteArrowDown,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Filter,
  RefreshCw,
  ReceiptText,
  Search,
  WalletCards,
} from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { startTransition, useCallback, useEffect, useMemo, useState } from "react"

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
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
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
import { formatDateTimeForDisplay } from "@/lib/date-time"
import { formatPhoneNumber } from "@/lib/format-phone-number"
import { getServiceEnrollmentHref } from "@/lib/routes"
import { sanitizeTransactionId } from "@/lib/transaction-inputs"
import { cn } from "@/lib/utils"
import { PurchaseTransactionDialog } from "../../_components/services-registry-panel"
import {
  TRANSACTION_SEARCH_DEBOUNCE_MS,
  TRANSACTION_SEARCH_MAX_LENGTH,
  sanitizeTransactionSearchInput,
  sanitizeTransactionSearchQuery,
} from "../_lib/transaction-search"

type TransactionStatus = "IN_PROGRESS" | "PENDING_PAYMENT" | "COMPLETED" | "CANCELED"
type RangePreset = "ALL_TIME" | "THIS_MONTH" | "LAST_MONTH" | "LAST_3_MONTHS" | "CUSTOM"
type PaymentState = "UNPAID" | "PARTIAL" | "PAID"
type TransactionSort =
  | "PURCHASED_DESC"
  | "PURCHASED_ASC"
  | "CONTACT_ASC"
  | "SERVICE_ASC"
  | "TOTAL_DESC"

type TransactionItem = {
  id: string
  purchasedAt: string
  status: TransactionStatus
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
  currency: string
  totalPriceCents: number
  paidCents: number
  remainingCents: number
  paymentState: PaymentState
}

type CurrencyTotals = {
  currency: string
  grossSalesCents: number
  collectedCents: number
  outstandingCents: number
}

type TransactionsResponse = {
  ok: boolean
  items: TransactionItem[]
  summary: {
    transactionCount: number
    totalsByCurrency: CurrencyTotals[]
    excludesCanceledTransactions: boolean
  }
  range: {
    preset: RangePreset
    from: string | null
    to: string | null
  }
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

const PAGE_SIZE_OPTIONS = [10, 25] as const
const ALL_SERVICES = "ALL_SERVICES"
const ALL_STATUSES = "ALL_STATUSES"
const DEFAULT_SORT: TransactionSort = "PURCHASED_DESC"
const MAX_TRANSACTION_PAGE = 1_000_000

const COMPACT_PRIMARY_BUTTON_CLASS =
  "h-8 shrink-0 cursor-pointer rounded-full bg-blue-950 px-3 py-1 text-xs font-semibold text-white shadow-sm ring-1 ring-black/5 transition hover:bg-blue-900 hover:text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"

const COMPACT_SECONDARY_BUTTON_CLASS =
  "h-8 shrink-0 cursor-pointer rounded-full border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"

const RANGE_OPTIONS: Array<{ value: RangePreset; label: string }> = [
  { value: "ALL_TIME", label: "All time" },
  { value: "THIS_MONTH", label: "This month" },
  { value: "LAST_MONTH", label: "Last month" },
  { value: "LAST_3_MONTHS", label: "Last 3 months" },
  { value: "CUSTOM", label: "Custom range" },
]

const STATUS_OPTIONS: Array<{ value: TransactionStatus; label: string }> = [
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "PENDING_PAYMENT", label: "Pending payment" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELED", label: "Canceled" },
]

const SORT_OPTIONS: Array<{ value: TransactionSort; label: string }> = [
  { value: "PURCHASED_DESC", label: "Newest sales" },
  { value: "PURCHASED_ASC", label: "Oldest sales" },
  { value: "CONTACT_ASC", label: "Contact A–Z" },
  { value: "SERVICE_ASC", label: "Service A–Z" },
  { value: "TOTAL_DESC", label: "Highest total" },
]

const parsePositiveInt = (value: string | null, fallback: number) => {
  if (!value || !/^\d+$/.test(value)) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_TRANSACTION_PAGE
    ? parsed
    : fallback
}

const sanitizeRangePreset = (value: string | null): RangePreset =>
  RANGE_OPTIONS.some((option) => option.value === value)
    ? (value as RangePreset)
    : "ALL_TIME"

const sanitizeStatus = (value: string | null) =>
  STATUS_OPTIONS.some((option) => option.value === value)
    ? (value as TransactionStatus)
    : ALL_STATUSES

const sanitizeSort = (value: string | null): TransactionSort =>
  SORT_OPTIONS.some((option) => option.value === value)
    ? (value as TransactionSort)
    : DEFAULT_SORT

const sanitizeDateOnly = (value: string | null) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return ""

  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? value
    : ""
}

const getDateRangeDayCount = (from: string, to: string) => {
  const fromTime = Date.parse(`${from}T00:00:00.000Z`)
  const toTime = Date.parse(`${to}T00:00:00.000Z`)
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) return null
  return Math.floor((toTime - fromTime) / 86_400_000) + 1
}

const formatCurrency = (amountCents: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amountCents / 100)
  } catch {
    return `${currency} ${(amountCents / 100).toFixed(2)}`
  }
}

const getStatusLabel = (status: TransactionStatus) =>
  STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status

const getStatusClassName = (status: TransactionStatus) => {
  if (status === "COMPLETED") return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (status === "PENDING_PAYMENT") return "border-amber-200 bg-amber-50 text-amber-700"
  if (status === "CANCELED") return "border-slate-200 bg-slate-100 text-slate-500"
  return "border-blue-200 bg-blue-50 text-blue-700"
}

const getPaymentStateLabel = (state: PaymentState) => {
  if (state === "PAID") return "Paid"
  if (state === "PARTIAL") return "Partially paid"
  return "Unpaid"
}

const getPaymentStateClassName = (state: PaymentState) => {
  if (state === "PAID") return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (state === "PARTIAL") return "border-amber-200 bg-amber-50 text-amber-700"
  return "border-rose-200 bg-rose-50 text-rose-700"
}

function TransactionMobileCard({
  transaction,
  tenantTimezone,
  onOpen,
}: {
  transaction: TransactionItem
  tenantTimezone?: string | null
  onOpen: (transactionId: string) => void
}) {
  const isCanceled = transaction.status === "CANCELED"
  const purchasedAtLabel = formatDateTimeForDisplay(
    transaction.purchasedAt,
    tenantTimezone,
  )
  const contactDetail = transaction.contact.phone
    ? formatPhoneNumber(transaction.contact.phone)
    : transaction.contact.email || "No contact details"
  const openCard = () => onOpen(transaction.id)

  return (
    <Card
      role="link"
      tabIndex={0}
      aria-label={`Open ${transaction.contact.displayName} ${transaction.service.name} transaction`}
      className={cn(
        "group cursor-pointer gap-0 rounded-[22px] border-slate-200 bg-white py-0 shadow-sm outline-none transition-[border-color,box-shadow,background-color,transform] hover:border-blue-200 hover:shadow-md focus-visible:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-500/40 active:scale-[0.995] motion-reduce:transform-none motion-reduce:transition-none",
        isCanceled && "bg-slate-50/80",
      )}
      onClick={openCard}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          openCard()
        }
      }}
    >
      <CardHeader className="gap-1.5 px-4 pt-4 pb-3 has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
        <CardTitle
          className={cn(
            "truncate pr-2 text-base text-slate-950",
            isCanceled && "text-slate-500",
          )}
          title={transaction.contact.displayName}
        >
          {transaction.contact.displayName}
        </CardTitle>
        <CardDescription className="truncate text-xs" title={contactDetail}>
          {contactDetail}
        </CardDescription>
        <CardAction className="flex items-center gap-1.5">
          <Badge variant="outline" className={getStatusClassName(transaction.status)}>
            {getStatusLabel(transaction.status)}
          </Badge>
          <ArrowRight
            aria-hidden="true"
            className="size-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5"
          />
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 px-4 pb-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs font-medium text-slate-500">Service</p>
          <p
            className={cn(
              "truncate text-sm font-medium text-slate-800",
              isCanceled && "text-slate-500",
            )}
            title={transaction.service.name}
          >
            {transaction.service.name}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total", value: transaction.totalPriceCents, emphasis: "text-slate-900" },
            { label: "Collected", value: transaction.paidCents, emphasis: "text-emerald-700" },
            { label: "Balance", value: transaction.remainingCents, emphasis: "text-slate-950" },
          ].map((amount) => {
            const formattedAmount = formatCurrency(amount.value, transaction.currency)

            return (
              <div key={amount.label} className="min-w-0">
                <p className="text-[11px] font-medium text-slate-500">{amount.label}</p>
                <p
                  className={cn(
                    "mt-1 truncate text-sm font-semibold tabular-nums",
                    amount.emphasis,
                    isCanceled && "text-slate-500",
                  )}
                  title={formattedAmount}
                >
                  {formattedAmount}
                </p>
              </div>
            )
          })}
        </div>
      </CardContent>

      <Separator />
      <CardFooter className="flex items-center justify-between gap-3 bg-slate-50/60 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-slate-500">Sale date</p>
          <p
            className={cn(
              "mt-1 truncate text-xs text-slate-700",
              isCanceled && "text-slate-500",
            )}
            title={purchasedAtLabel}
          >
            {purchasedAtLabel}
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0",
            getPaymentStateClassName(transaction.paymentState),
            isCanceled && "border-slate-200 bg-slate-100 text-slate-500",
          )}
        >
          {getPaymentStateLabel(transaction.paymentState)}
        </Badge>
      </CardFooter>
    </Card>
  )
}

function TransactionMobileCardSkeleton() {
  return (
    <Card aria-hidden="true" className="gap-0 rounded-[22px] py-0 shadow-sm">
      <CardHeader className="gap-2 px-4 pt-4 pb-3 has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
        <CardTitle><Skeleton className="h-5 w-3/5" /></CardTitle>
        <CardDescription><Skeleton className="h-3 w-2/5" /></CardDescription>
        <CardAction><Skeleton className="h-5 w-24 rounded-full" /></CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-4 pb-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-4 w-3/5" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
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

function MoneySummary({
  totals,
  field,
}: {
  totals: CurrencyTotals[]
  field: "grossSalesCents" | "collectedCents" | "outstandingCents"
}) {
  if (!totals.length) {
    return <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">$0.00</p>
  }

  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {totals.map((total) => (
        <p
          key={total.currency}
          className="truncate text-xl font-semibold tabular-nums tracking-tight text-slate-950"
        >
          {formatCurrency(total[field], total.currency)}
        </p>
      ))}
    </div>
  )
}

export function TransactionsRegister({
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
  const [query, setQuery] = useState(() =>
    sanitizeTransactionSearchInput(searchParams.get("search") ?? ""),
  )
  const [debouncedQuery, setDebouncedQuery] = useState(() =>
    sanitizeTransactionSearchQuery(searchParams.get("search") ?? ""),
  )
  const [sort, setSort] = useState<TransactionSort>(() =>
    sanitizeSort(searchParams.get("sort")),
  )
  const [rangePreset, setRangePreset] = useState<RangePreset>(() =>
    sanitizeRangePreset(searchParams.get("rangePreset")),
  )
  const [customFrom, setCustomFrom] = useState(() =>
    sanitizeDateOnly(searchParams.get("from")),
  )
  const [customTo, setCustomTo] = useState(() =>
    sanitizeDateOnly(searchParams.get("to")),
  )
  const [serviceId, setServiceId] = useState(
    () => sanitizeTransactionId(searchParams.get("serviceId")) || ALL_SERVICES,
  )
  const [status, setStatus] = useState(() => sanitizeStatus(searchParams.get("status")))
  const [page, setPage] = useState(() => parsePositiveInt(searchParams.get("page"), 1))
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(() =>
    parsePositiveInt(searchParams.get("pageSize"), 10) === 25 ? 25 : 10,
  )
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false)
  const [isSortSheetOpen, setIsSortSheetOpen] = useState(false)
  const [draftRangePreset, setDraftRangePreset] = useState(rangePreset)
  const [draftCustomFrom, setDraftCustomFrom] = useState(customFrom)
  const [draftCustomTo, setDraftCustomTo] = useState(customTo)
  const [draftServiceId, setDraftServiceId] = useState(serviceId)
  const [draftStatus, setDraftStatus] = useState(status)
  const [data, setData] = useState<TransactionsResponse | null>(null)
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const sanitizedQuery = sanitizeTransactionSearchQuery(query)
    if (sanitizedQuery === debouncedQuery) return

    const timeout = window.setTimeout(() => {
      setDebouncedQuery(sanitizedQuery)
      setPage(1)
    }, TRANSACTION_SEARCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timeout)
  }, [debouncedQuery, query])

  useEffect(() => {
    const nextParams = new URLSearchParams()

    if (debouncedQuery) nextParams.set("search", debouncedQuery)
    if (sort !== DEFAULT_SORT) nextParams.set("sort", sort)
    if (rangePreset !== "ALL_TIME") nextParams.set("rangePreset", rangePreset)
    if (rangePreset === "CUSTOM") {
      if (customFrom) nextParams.set("from", customFrom)
      if (customTo) nextParams.set("to", customTo)
    }
    if (serviceId !== ALL_SERVICES) nextParams.set("serviceId", serviceId)
    if (status !== ALL_STATUSES) nextParams.set("status", status)
    if (page > 1) nextParams.set("page", String(page))
    if (pageSize !== 10) nextParams.set("pageSize", String(pageSize))

    const nextQuery = nextParams.toString()
    if (nextQuery === searchParams.toString()) return

    startTransition(() => {
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false })
    })
  }, [
    customFrom,
    customTo,
    debouncedQuery,
    page,
    pageSize,
    pathname,
    rangePreset,
    router,
    searchParams,
    serviceId,
    sort,
    status,
  ])

  const loadTransactions = useCallback(async (signal?: AbortSignal) => {
    if (rangePreset === "CUSTOM" && (!customFrom || !customTo)) {
      setData(null)
      setErrorMessage("Select both a start date and an end date for the custom range.")
      setIsLoading(false)
      return
    }

    if (rangePreset === "CUSTOM" && customFrom > customTo) {
      setData(null)
      setErrorMessage("End date must be the same day or after the start date.")
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setErrorMessage(null)

    try {
      const { data: response } = await api.get<TransactionsResponse>(
        `/api/services/${encodeURIComponent(tenantId)}/transactions`,
        {
          signal,
          params: {
            page,
            pageSize,
            search: debouncedQuery || undefined,
            sort,
            rangePreset,
            from: rangePreset === "CUSTOM" ? customFrom : undefined,
            to: rangePreset === "CUSTOM" ? customTo : undefined,
            serviceId: serviceId === ALL_SERVICES ? undefined : serviceId,
            status: status === ALL_STATUSES ? undefined : status,
          },
        },
      )

      if (page > response.pagination.totalPages) {
        setPage(response.pagination.totalPages)
        return
      }

      setData(response)
    } catch (error) {
      if (signal?.aborted) return

      setData(null)
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        setErrorMessage(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not load transactions.",
        )
      } else {
        setErrorMessage("Could not load transactions.")
      }
    } finally {
      if (!signal?.aborted) setIsLoading(false)
    }
  }, [
    customFrom,
    customTo,
    debouncedQuery,
    page,
    pageSize,
    rangePreset,
    serviceId,
    sort,
    status,
    tenantId,
  ])

  useEffect(() => {
    const controller = new AbortController()
    void loadTransactions(controller.signal)

    return () => controller.abort()
  }, [loadTransactions])

  useEffect(() => {
    let cancelled = false

    const loadServiceOptions = async () => {
      try {
        const { data: response } = await api.get<{ ok: boolean; items: ServiceOption[] }>(
          `/api/account-settings/${encodeURIComponent(tenantId)}/services/options`,
          { params: { includeInactive: true } },
        )
        if (!cancelled) {
          setServiceOptions(
            (response.items ?? []).filter((service) =>
              Boolean(sanitizeTransactionId(service.id)),
            ),
          )
        }
      } catch {
        if (!cancelled) setServiceOptions([])
      }
    }

    void loadServiceOptions()
    return () => {
      cancelled = true
    }
  }, [tenantId])

  const currentReturnTo = useMemo(() => {
    const queryString = searchParams.toString()
    return queryString ? `${pathname}?${queryString}` : pathname
  }, [pathname, searchParams])

  const openTransaction = useCallback(
    (transactionId: string) => {
      router.push(
        getServiceEnrollmentHref({
          tenantSlug,
          contactServiceId: transactionId,
          view: "transaction",
          returnTo: currentReturnTo,
        }),
      )
    },
    [currentReturnTo, router, tenantSlug],
  )

  const transactions = data?.items ?? []
  const totals = data?.summary.totalsByCurrency ?? []
  const total = data?.pagination.total ?? 0
  const totalPages = data?.pagination.totalPages ?? 1
  const canGoPrevious = page > 1
  const canGoNext = page < totalPages
  const startIndex = (page - 1) * pageSize
  const summaryLabel = total
    ? `Showing ${startIndex + 1}-${startIndex + transactions.length} of ${total} transactions`
    : "No transactions found"
  const activeFilterCount =
    (rangePreset !== "ALL_TIME" ? 1 : 0) +
    (serviceId !== ALL_SERVICES ? 1 : 0) +
    (status !== ALL_STATUSES ? 1 : 0)
  const hasActiveRefinements = Boolean(query.trim()) || activeFilterCount > 0
  const hasAppliedFilters = activeFilterCount > 0
  const placeholderRowCount =
    transactions.length === 0 ? pageSize - 1 : Math.max(0, pageSize - transactions.length)
  const visiblePageCount = Math.min(5, totalPages)
  const firstVisiblePage = Math.max(
    1,
    Math.min(page - 2, totalPages - visiblePageCount + 1),
  )
  const visiblePages = Array.from(
    { length: visiblePageCount },
    (_, index) => firstVisiblePage + index,
  )
  const draftDateError =
    draftRangePreset === "CUSTOM" && (!draftCustomFrom || !draftCustomTo)
      ? "Select both a start date and an end date."
      : draftRangePreset === "CUSTOM" && draftCustomFrom > draftCustomTo
        ? "End date must be the same day or after the start date."
        : draftRangePreset === "CUSTOM" &&
            (getDateRangeDayCount(draftCustomFrom, draftCustomTo) ?? 0) > 366
          ? "Custom date range cannot exceed 366 days."
        : null
  const selectedSortLabel =
    SORT_OPTIONS.find((option) => option.value === sort)?.label ?? "Newest sales"

  const clearFilters = () => {
    setRangePreset("ALL_TIME")
    setCustomFrom("")
    setCustomTo("")
    setServiceId(ALL_SERVICES)
    setStatus(ALL_STATUSES)
    setDraftRangePreset("ALL_TIME")
    setDraftCustomFrom("")
    setDraftCustomTo("")
    setDraftServiceId(ALL_SERVICES)
    setDraftStatus(ALL_STATUSES)
    setPage(1)
  }

  const openFilterSheet = () => {
    setDraftRangePreset(rangePreset)
    setDraftCustomFrom(customFrom)
    setDraftCustomTo(customTo)
    setDraftServiceId(serviceId)
    setDraftStatus(status)
    setIsFilterSheetOpen(true)
  }

  const applyFilters = () => {
    if (draftDateError) return

    const nextRangePreset = sanitizeRangePreset(draftRangePreset)
    const nextServiceId =
      draftServiceId === ALL_SERVICES ||
      serviceOptions.some((service) => service.id === draftServiceId)
        ? draftServiceId
        : ALL_SERVICES

    setRangePreset(nextRangePreset)
    setCustomFrom(nextRangePreset === "CUSTOM" ? sanitizeDateOnly(draftCustomFrom) : "")
    setCustomTo(nextRangePreset === "CUSTOM" ? sanitizeDateOnly(draftCustomTo) : "")
    setServiceId(nextServiceId)
    setStatus(sanitizeStatus(draftStatus))
    setPage(1)
    setIsFilterSheetOpen(false)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <header className="shrink-0 rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-4 sm:p-5">
        <div className="flex justify-end">
          <PurchaseTransactionDialog
            tenantId={tenantId}
            tenantSlug={tenantSlug}
            returnTo={currentReturnTo}
            triggerClassName={COMPACT_PRIMARY_BUTTON_CLASS}
          />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
          <article className="min-w-0 rounded-[22px] border border-white/80 bg-white/75 p-3 shadow-sm backdrop-blur sm:p-4">
            <div className="flex items-center gap-2 text-slate-500">
              <ReceiptText className="size-4 text-blue-600" aria-hidden="true" />
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] sm:text-[11px] sm:tracking-[0.16em]">Transactions</p>
            </div>
            {isLoading && !data ? (
              <Skeleton className="mt-3 h-8 w-20 rounded-lg" />
            ) : (
              <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight text-slate-950">
                {data?.summary.transactionCount ?? 0}
              </p>
            )}
            <p className="mt-1 text-xs text-slate-500">Includes every matching status.</p>
          </article>

          <article className="min-w-0 rounded-[22px] border border-white/80 bg-white/75 p-3 shadow-sm backdrop-blur sm:p-4">
            <div className="flex items-center gap-2 text-slate-500">
              <WalletCards className="size-4 text-indigo-600" aria-hidden="true" />
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] sm:text-[11px] sm:tracking-[0.16em]">Gross sales</p>
            </div>
            {isLoading && !data ? <Skeleton className="mt-3 h-8 w-28 rounded-lg" /> : (
              <MoneySummary totals={totals} field="grossSalesCents" />
            )}
            <p className="mt-1 text-xs text-slate-500">Canceled transactions excluded.</p>
          </article>

          <article className="min-w-0 rounded-[22px] border border-white/80 bg-white/75 p-3 shadow-sm backdrop-blur sm:p-4">
            <div className="flex items-center gap-2 text-slate-500">
              <BanknoteArrowDown className="size-4 text-emerald-600" aria-hidden="true" />
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] sm:text-[11px] sm:tracking-[0.16em]">Collected</p>
            </div>
            {isLoading && !data ? <Skeleton className="mt-3 h-8 w-28 rounded-lg" /> : (
              <MoneySummary totals={totals} field="collectedCents" />
            )}
            <p className="mt-1 text-xs text-slate-500">Payments on matching sales.</p>
          </article>

          <article className="min-w-0 rounded-[22px] border border-white/80 bg-white/75 p-3 shadow-sm backdrop-blur sm:p-4">
            <div className="flex items-center gap-2 text-slate-500">
              <CircleDollarSign className="size-4 text-amber-600" aria-hidden="true" />
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] sm:text-[11px] sm:tracking-[0.16em]">Outstanding</p>
            </div>
            {isLoading && !data ? <Skeleton className="mt-3 h-8 w-28 rounded-lg" /> : (
              <MoneySummary totals={totals} field="outstandingCents" />
            )}
            <p className="mt-1 text-xs text-slate-500">Balance on non-canceled sales.</p>
          </article>
        </div>

        <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center">
          <form
            role="search"
            className="relative w-full lg:min-w-0 lg:flex-1"
            onSubmit={(event) => {
              event.preventDefault()
              setDebouncedQuery(sanitizeTransactionSearchQuery(query))
              setPage(1)
            }}
          >
            <Input
              id="transaction-search"
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(sanitizeTransactionSearchInput(event.target.value))
              }}
              maxLength={TRANSACTION_SEARCH_MAX_LENGTH}
              placeholder="Search contacts, phone, email, or service"
              aria-label="Search transactions"
              className="h-11 w-full rounded-xl border-white/80 bg-white/85 pr-14 pl-4 text-sm shadow-sm backdrop-blur placeholder:text-slate-400 focus-visible:border-blue-300 focus-visible:ring-blue-100"
            />
            <Button
              type="submit"
              size="icon-lg"
              aria-label="Search transactions"
              className="absolute inset-y-0 right-0 h-11 w-12 rounded-l-none rounded-r-xl bg-blue-950 text-white shadow-none hover:bg-blue-900"
            >
              <Search aria-hidden="true" />
            </Button>
          </form>

          <div className="grid w-full grid-cols-2 gap-2 md:grid-cols-3 lg:flex lg:w-auto lg:shrink-0">
            <Button
              type="button"
              variant="outline"
              aria-label={
                activeFilterCount > 0
                  ? `Open filters, ${activeFilterCount} active`
                  : "Open filters"
              }
              aria-expanded={isFilterSheetOpen}
              aria-controls="transaction-filter-sheet"
              className="h-11 min-w-0 cursor-pointer rounded-full border-white/80 bg-white/85 px-2.5 text-xs font-semibold text-blue-950 shadow-sm backdrop-blur hover:bg-white hover:text-blue-950 sm:px-3 sm:text-sm"
              onClick={openFilterSheet}
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
              aria-label={`Sort transactions, currently ${selectedSortLabel}`}
              aria-expanded={isSortSheetOpen}
              aria-controls="transaction-sort-sheet"
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
                aria-label={`Sort transactions, currently ${selectedSortLabel}`}
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
          id="transaction-sort-sheet"
          side="bottom"
          className="mx-auto max-h-[min(32rem,72dvh)] w-full gap-0 overflow-hidden rounded-t-[26px] border-x border-t border-slate-200 bg-white p-0 sm:bottom-4 sm:left-1/2 sm:right-auto sm:w-[min(32rem,calc(100%-2rem))] sm:-translate-x-1/2 sm:rounded-[26px] sm:border [&>button]:right-5 [&>button]:top-5 [&>button]:cursor-pointer [&>button]:rounded-full [&>button]:bg-slate-100 [&>button]:opacity-100"
        >
          <div
            aria-hidden="true"
            className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-slate-200 sm:hidden"
          />
          <SheetHeader className="border-b border-slate-100 px-5 pt-4 pb-3 text-left sm:px-6 sm:pt-5">
            <SheetTitle className="pr-10 text-lg font-semibold text-slate-950">
              Sort transactions
            </SheetTitle>
            <SheetDescription className="sr-only">
              Choose the order used for the transaction register.
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:px-5 sm:pb-5">
            <ToggleGroup
              type="single"
              value={sort}
              orientation="vertical"
              spacing={2}
              aria-label="Choose transaction order"
              className="grid w-full gap-2"
              onValueChange={(value) => {
                if (!value) return
                setSort(sanitizeSort(value))
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

      <Sheet open={isFilterSheetOpen} onOpenChange={setIsFilterSheetOpen}>
        <SheetContent
          id="transaction-filter-sheet"
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
              <p className="text-xs font-semibold text-blue-700">Transaction filters</p>
              <SheetTitle className="mt-1.5 text-xl font-semibold text-slate-950 sm:text-2xl">
                Refine transactions
              </SheetTitle>
              <SheetDescription className="mt-1.5 max-w-xl text-sm leading-6 text-slate-600">
                Filter sold services by date, service, and transaction status.
              </SheetDescription>
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6 [scrollbar-gutter:stable] sm:px-7">
            <FieldGroup className="gap-6">
              <Field>
                <FieldLabel htmlFor="transaction-range-filter">Sale date</FieldLabel>
                <Select
                  value={draftRangePreset}
                  onValueChange={(value) =>
                    setDraftRangePreset(sanitizeRangePreset(value))
                  }
                >
                  <SelectTrigger
                    id="transaction-range-filter"
                    className="h-11 w-full rounded-xl border-blue-100 bg-white"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {RANGE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription className="text-xs">
                  Dates are interpreted in the tenant timezone.
                </FieldDescription>
              </Field>

              {draftRangePreset === "CUSTOM" ? (
                <FieldSet className="gap-3" data-invalid={Boolean(draftDateError)}>
                  <FieldLegend variant="label" className="mb-0 text-slate-800">
                    Custom range
                  </FieldLegend>
                  <FieldGroup className="gap-4 sm:grid sm:grid-cols-2">
                    <Field data-invalid={Boolean(draftDateError)} className="gap-2">
                      <FieldLabel htmlFor="transaction-from">Start date</FieldLabel>
                      <Input
                        id="transaction-from"
                        type="date"
                        value={draftCustomFrom}
                        onChange={(event) =>
                          setDraftCustomFrom(sanitizeDateOnly(event.target.value))
                        }
                        aria-invalid={Boolean(draftDateError)}
                        className="h-11 rounded-xl border-slate-200 bg-slate-50/60 px-3 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
                      />
                    </Field>
                    <Field data-invalid={Boolean(draftDateError)} className="gap-2">
                      <FieldLabel htmlFor="transaction-to">End date</FieldLabel>
                      <Input
                        id="transaction-to"
                        type="date"
                        value={draftCustomTo}
                        onChange={(event) =>
                          setDraftCustomTo(sanitizeDateOnly(event.target.value))
                        }
                        aria-invalid={Boolean(draftDateError)}
                        className="h-11 rounded-xl border-slate-200 bg-slate-50/60 px-3 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
                      />
                    </Field>
                  </FieldGroup>
                  <FieldError>{draftDateError}</FieldError>
                </FieldSet>
              ) : null}

              <Separator />

              <Field>
                <FieldLabel htmlFor="transaction-service-filter">Service</FieldLabel>
                <Select
                  value={draftServiceId}
                  onValueChange={(value) =>
                    setDraftServiceId(
                      value === ALL_SERVICES ||
                        serviceOptions.some((service) => service.id === value)
                        ? value
                        : ALL_SERVICES,
                    )
                  }
                >
                  <SelectTrigger
                    id="transaction-service-filter"
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
                <FieldLabel htmlFor="transaction-status-filter">Transaction status</FieldLabel>
                <Select
                  value={draftStatus}
                  onValueChange={(value) => setDraftStatus(sanitizeStatus(value))}
                >
                  <SelectTrigger
                    id="transaction-status-filter"
                    className="h-11 w-full rounded-xl border-blue-100 bg-white"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
                      {STATUS_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription className="text-xs">
                  Canceled transactions remain available in the register.
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
                clearFilters()
                setIsFilterSheetOpen(false)
              }}
            >
              Clear filters
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={Boolean(draftDateError)}
              className={COMPACT_PRIMARY_BUTTON_CLASS}
              onClick={applyFilters}
            >
              Apply filters
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <section
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm"
        aria-label="Service transactions"
        aria-busy={isLoading}
      >
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 md:hidden">
          {isLoading ? (
            <div className="flex flex-col gap-3" role="status">
              <span className="sr-only">Loading transactions</span>
              {Array.from({ length: 3 }, (_, index) => (
                <TransactionMobileCardSkeleton key={`mobile-skeleton-${index}`} />
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
                onClick={() => void loadTransactions()}
              >
                <RefreshCw data-icon="inline-start" aria-hidden="true" />
                Try again
              </Button>
            </div>
          ) : transactions.length ? (
            <div className="flex flex-col gap-3" role="list">
              {transactions.map((transaction) => (
                <div key={`mobile-${transaction.id}`} role="listitem">
                  <TransactionMobileCard
                    transaction={transaction}
                    tenantTimezone={tenantTimezone}
                    onOpen={openTransaction}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-[20px] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-10 text-center">
              <p className="text-sm leading-6 text-slate-500">
                {hasActiveRefinements
                  ? "No transactions match the current search and filters."
                  : "No service transactions have been created yet."}
              </p>
            </div>
          )}
        </div>

        <div className="hidden min-h-0 flex-1 overflow-auto px-4 pt-4 md:block">
          <Table
            className="min-w-[1180px] table-fixed border-separate border-spacing-0"
            aria-label="Transactions"
          >
            <TableHeader className="drop-shadow-sm [&_tr]:border-0">
              <TableRow className="h-14 border-0 hover:bg-transparent">
                <TableHead className="w-[13%] rounded-l-xl border-y border-l bg-slate-50 px-4 text-xs text-slate-600">
                  Sale date
                </TableHead>
                <TableHead className="w-[20%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Contact
                </TableHead>
                <TableHead className="w-[16%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Service
                </TableHead>
                <TableHead className="w-[14%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Status
                </TableHead>
                <TableHead className="w-[11%] border-y bg-slate-50 px-4 text-right text-xs text-slate-600">
                  Total
                </TableHead>
                <TableHead className="w-[11%] border-y bg-slate-50 px-4 text-right text-xs text-slate-600">
                  Collected
                </TableHead>
                <TableHead className="w-[10%] border-y bg-slate-50 px-4 text-right text-xs text-slate-600">
                  Balance
                </TableHead>
                <TableHead className="w-[5%] rounded-r-xl border-y border-r bg-slate-50 px-4 text-xs text-slate-600">
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow aria-hidden="true" className="h-2 border-0 hover:bg-transparent">
                <TableCell colSpan={8} className="p-0" />
              </TableRow>

              {isLoading ? (
                Array.from({ length: pageSize }, (_, index) => (
                  <TableRow
                    key={`transaction-skeleton-${index}`}
                    className="h-14 hover:bg-transparent"
                  >
                    <TableCell className="px-4 py-0"><Skeleton className="h-4 w-4/5" /></TableCell>
                    <TableCell className="px-4 py-0">
                      <div className="flex flex-col gap-1.5">
                        <Skeleton className="h-4 w-4/5" />
                        <Skeleton className="h-3 w-3/5" />
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-0"><Skeleton className="h-4 w-4/5" /></TableCell>
                    <TableCell className="px-4 py-0"><Skeleton className="h-5 w-24 rounded-full" /></TableCell>
                    <TableCell className="px-4 py-0"><Skeleton className="ml-auto h-4 w-20" /></TableCell>
                    <TableCell className="px-4 py-0"><Skeleton className="ml-auto h-4 w-20" /></TableCell>
                    <TableCell className="px-4 py-0"><Skeleton className="ml-auto h-4 w-20" /></TableCell>
                    <TableCell className="px-4 py-0"><Skeleton className="ml-auto size-4" /></TableCell>
                  </TableRow>
                ))
              ) : errorMessage ? (
                <TableRow className="h-14 hover:bg-transparent">
                  <TableCell colSpan={8} className="px-4 py-0 text-center text-rose-700">
                    <div className="flex items-center justify-center gap-3" role="alert">
                      <span>{errorMessage}</span>
                      <Button
                        type="button"
                        variant="outline"
                        className={COMPACT_SECONDARY_BUTTON_CLASS}
                        onClick={() => void loadTransactions()}
                      >
                        <RefreshCw data-icon="inline-start" aria-hidden="true" />
                        Try again
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : transactions.length ? (
                transactions.map((transaction) => {
                  const isCanceled = transaction.status === "CANCELED"
                  const purchasedAtLabel = formatDateTimeForDisplay(
                    transaction.purchasedAt,
                    tenantTimezone,
                  )

                  return (
                    <TableRow
                      key={transaction.id}
                      role="link"
                      tabIndex={0}
                      aria-label={`Open ${transaction.contact.displayName} ${transaction.service.name} transaction`}
                      onClick={() => openTransaction(transaction.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          openTransaction(transaction.id)
                        }
                      }}
                      className={cn(
                        "h-14 cursor-pointer outline-none hover:bg-blue-50/50 focus-visible:bg-blue-50/50 focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-inset",
                        isCanceled && "bg-slate-50/70",
                      )}
                    >
                      <TableCell className={cn("px-4 py-0 text-xs text-slate-600", isCanceled && "text-slate-500")}>
                        <span className="block truncate" title={purchasedAtLabel}>
                          {purchasedAtLabel}
                        </span>
                      </TableCell>
                      <TableCell className="px-4 py-0">
                        <p className={cn("truncate font-medium text-slate-950", isCanceled && "text-slate-500")}>
                          {transaction.contact.displayName}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {transaction.contact.phone
                            ? formatPhoneNumber(transaction.contact.phone)
                            : transaction.contact.email || "No contact details"}
                        </p>
                      </TableCell>
                      <TableCell className="px-4 py-0">
                        <span className={cn("block truncate font-medium text-slate-800", isCanceled && "text-slate-500")} title={transaction.service.name}>
                          {transaction.service.name}
                        </span>
                      </TableCell>
                      <TableCell className="px-4 py-0">
                        <div className="flex flex-col items-start gap-1">
                          <Badge variant="outline" className={getStatusClassName(transaction.status)}>
                            {getStatusLabel(transaction.status)}
                          </Badge>
                          <span className="text-[11px] text-slate-500">
                            {getPaymentStateLabel(transaction.paymentState)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className={cn("px-4 py-0 text-right font-medium tabular-nums text-slate-900", isCanceled && "text-slate-500")}>
                        {formatCurrency(transaction.totalPriceCents, transaction.currency)}
                      </TableCell>
                      <TableCell className={cn("px-4 py-0 text-right tabular-nums text-emerald-700", isCanceled && "text-slate-500")}>
                        {formatCurrency(transaction.paidCents, transaction.currency)}
                      </TableCell>
                      <TableCell className={cn("px-4 py-0 text-right font-semibold tabular-nums text-slate-950", isCanceled && "text-slate-500")}>
                        {formatCurrency(transaction.remainingCents, transaction.currency)}
                      </TableCell>
                      <TableCell className="px-4 py-0 text-right">
                        <ArrowRight className="ml-auto size-4 text-slate-400" aria-hidden="true" />
                      </TableCell>
                    </TableRow>
                  )
                })
              ) : (
                <TableRow className="h-14 hover:bg-transparent">
                  <TableCell colSpan={8} className="px-4 py-0 text-center text-slate-500">
                    {hasActiveRefinements
                      ? "No transactions match the current search and filters."
                      : "No service transactions have been created yet."}
                  </TableCell>
                </TableRow>
              )}

              {!isLoading && !errorMessage
                ? Array.from({ length: placeholderRowCount }, (_, index) => (
                    <TableRow
                      key={`transaction-placeholder-${index}`}
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
                {errorMessage ? "Transactions could not be loaded" : summaryLabel}
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
            aria-label="Transaction list pagination"
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
      </section>
    </div>
  )
}
