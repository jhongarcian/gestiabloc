"use client"

import { isAxiosError } from "axios"
import {
  ArrowRight,
  BanknoteArrowDown,
  CalendarRange,
  CircleDollarSign,
  ReceiptText,
  Search,
  WalletCards,
} from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { startTransition, useCallback, useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
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
import { formatDateTimeForDisplay } from "@/lib/date-time"
import { formatPhoneNumber } from "@/lib/format-phone-number"
import { getServiceEnrollmentHref } from "@/lib/routes"
import { cn } from "@/lib/utils"
import { PurchaseTransactionDialog } from "../../_components/services-registry-panel"

type TransactionStatus = "IN_PROGRESS" | "PENDING_PAYMENT" | "COMPLETED" | "CANCELED"
type RangePreset = "ALL_TIME" | "THIS_MONTH" | "LAST_MONTH" | "LAST_3_MONTHS" | "CUSTOM"
type PaymentState = "UNPAID" | "PARTIAL" | "PAID"

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

const parsePositiveInt = (value: string | null, fallback: number) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const sanitizeRangePreset = (value: string | null): RangePreset =>
  RANGE_OPTIONS.some((option) => option.value === value)
    ? (value as RangePreset)
    : "ALL_TIME"

const sanitizeStatus = (value: string | null) =>
  STATUS_OPTIONS.some((option) => option.value === value)
    ? (value as TransactionStatus)
    : ALL_STATUSES

const sanitizeDateOnly = (value: string | null) =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ""

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
    <div className="mt-3 space-y-1.5">
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
  const [query, setQuery] = useState(() => searchParams.get("search") ?? "")
  const [debouncedQuery, setDebouncedQuery] = useState(() =>
    (searchParams.get("search") ?? "").trim(),
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
    () => searchParams.get("serviceId") ?? ALL_SERVICES,
  )
  const [status, setStatus] = useState(() => sanitizeStatus(searchParams.get("status")))
  const [page, setPage] = useState(() => parsePositiveInt(searchParams.get("page"), 1))
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(() =>
    parsePositiveInt(searchParams.get("pageSize"), 10) === 25 ? 25 : 10,
  )
  const [data, setData] = useState<TransactionsResponse | null>(null)
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query.trim())
      setPage(1)
    }, 300)

    return () => window.clearTimeout(timeout)
  }, [query])

  useEffect(() => {
    const nextParams = new URLSearchParams()

    if (debouncedQuery) nextParams.set("search", debouncedQuery)
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
    status,
  ])

  const loadTransactions = useCallback(async () => {
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
          params: {
            page,
            pageSize,
            search: debouncedQuery || undefined,
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
      setIsLoading(false)
    }
  }, [
    customFrom,
    customTo,
    debouncedQuery,
    page,
    pageSize,
    rangePreset,
    serviceId,
    status,
    tenantId,
  ])

  useEffect(() => {
    void loadTransactions()
  }, [loadTransactions])

  useEffect(() => {
    let cancelled = false

    const loadServiceOptions = async () => {
      try {
        const { data: response } = await api.get<{ ok: boolean; items: ServiceOption[] }>(
          `/api/account-settings/${encodeURIComponent(tenantId)}/services/options`,
          { params: { includeInactive: true } },
        )
        if (!cancelled) setServiceOptions(response.items ?? [])
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
  const hasActiveFilters = Boolean(
    query.trim() ||
      rangePreset !== "ALL_TIME" ||
      serviceId !== ALL_SERVICES ||
      status !== ALL_STATUSES,
  )

  const clearFilters = () => {
    setQuery("")
    setDebouncedQuery("")
    setRangePreset("ALL_TIME")
    setCustomFrom("")
    setCustomTo("")
    setServiceId(ALL_SERVICES)
    setStatus(ALL_STATUSES)
    setPage(1)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <section className="overflow-hidden rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
              <ReceiptText className="size-4" aria-hidden="true" />
              Service sales
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              Transactions
            </h1>
            <p className="mt-1 max-w-xl text-sm leading-6 text-slate-600">
              Review every sold service, the amount collected, and the balance still outstanding.
            </p>
          </div>
          <PurchaseTransactionDialog
            tenantId={tenantId}
            tenantSlug={tenantSlug}
            returnTo={currentReturnTo}
          />
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-[22px] border border-white/80 bg-white/75 p-4 shadow-sm backdrop-blur">
            <div className="flex items-center gap-2 text-slate-500">
              <ReceiptText className="size-4 text-blue-600" aria-hidden="true" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">Transactions</p>
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

          <article className="rounded-[22px] border border-white/80 bg-white/75 p-4 shadow-sm backdrop-blur">
            <div className="flex items-center gap-2 text-slate-500">
              <WalletCards className="size-4 text-indigo-600" aria-hidden="true" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">Gross sales</p>
            </div>
            {isLoading && !data ? <Skeleton className="mt-3 h-8 w-28 rounded-lg" /> : (
              <MoneySummary totals={totals} field="grossSalesCents" />
            )}
            <p className="mt-1 text-xs text-slate-500">Canceled transactions excluded.</p>
          </article>

          <article className="rounded-[22px] border border-white/80 bg-white/75 p-4 shadow-sm backdrop-blur">
            <div className="flex items-center gap-2 text-slate-500">
              <BanknoteArrowDown className="size-4 text-emerald-600" aria-hidden="true" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">Collected</p>
            </div>
            {isLoading && !data ? <Skeleton className="mt-3 h-8 w-28 rounded-lg" /> : (
              <MoneySummary totals={totals} field="collectedCents" />
            )}
            <p className="mt-1 text-xs text-slate-500">Payments on matching sales.</p>
          </article>

          <article className="rounded-[22px] border border-white/80 bg-white/75 p-4 shadow-sm backdrop-blur">
            <div className="flex items-center gap-2 text-slate-500">
              <CircleDollarSign className="size-4 text-amber-600" aria-hidden="true" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">Outstanding</p>
            </div>
            {isLoading && !data ? <Skeleton className="mt-3 h-8 w-28 rounded-lg" /> : (
              <MoneySummary totals={totals} field="outstandingCents" />
            )}
            <p className="mt-1 text-xs text-slate-500">Balance on non-canceled sales.</p>
          </article>
        </div>
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="transaction-filters-title">
        <div className="mb-3 flex items-center gap-2">
          <CalendarRange className="size-4 text-blue-700" aria-hidden="true" />
          <h2 id="transaction-filters-title" className="text-sm font-semibold text-slate-900">
            Find transactions
          </h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(260px,1.4fr)_180px_200px_190px_auto]">
          <div className="relative">
            <Label htmlFor="transaction-search" className="sr-only">Search transactions</Label>
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-slate-400" aria-hidden="true" />
            <Input
              id="transaction-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search contact, phone, email, or service"
              className="h-10 pl-9"
            />
          </div>

          <Select
            value={rangePreset}
            onValueChange={(value) => {
              setRangePreset(value as RangePreset)
              setPage(1)
            }}
          >
            <SelectTrigger aria-label="Transaction date range" className="h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={serviceId} onValueChange={(value) => { setServiceId(value); setPage(1) }}>
            <SelectTrigger aria-label="Filter by service" className="h-10 w-full">
              <SelectValue placeholder="All services" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SERVICES}>All services</SelectItem>
              {serviceOptions.map((service) => (
                <SelectItem key={service.id} value={service.id}>
                  {service.name}{service.isActive ? "" : " (Inactive)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1) }}>
            <SelectTrigger aria-label="Filter by transaction status" className="h-10 w-full">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button type="button" variant="outline" disabled={!hasActiveFilters} onClick={clearFilters}>
            Clear filters
          </Button>
        </div>

        {rangePreset === "CUSTOM" ? (
          <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2 sm:max-w-xl">
            <div className="grid gap-1.5">
              <Label htmlFor="transaction-from" className="text-xs text-slate-600">Start date</Label>
              <Input
                id="transaction-from"
                type="date"
                value={customFrom}
                onChange={(event) => { setCustomFrom(event.target.value); setPage(1) }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="transaction-to" className="text-xs text-slate-600">End date</Label>
              <Input
                id="transaction-to"
                type="date"
                value={customTo}
                onChange={(event) => { setCustomTo(event.target.value); setPage(1) }}
              />
            </div>
          </div>
        ) : null}
      </section>

      <section className="flex min-h-[520px] flex-col overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm" aria-labelledby="transactions-register-title">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-5">
          <div>
            <h2 id="transactions-register-title" className="font-semibold text-slate-950">Transaction register</h2>
            <p className="mt-0.5 text-sm text-slate-500" aria-live="polite">
              {isLoading ? "Loading transactions..." : summaryLabel}
            </p>
          </div>
          {isLoading && data ? <span className="text-xs text-slate-400">Refreshing…</span> : null}
        </div>

        {errorMessage ? (
          <div className="m-4 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700" role="alert">
            <p>{errorMessage}</p>
            <Button type="button" variant="outline" size="sm" className="mt-3 bg-white" onClick={() => void loadTransactions()}>
              Try again
            </Button>
          </div>
        ) : null}

        {!errorMessage ? (
          <>
            <div className="hidden min-h-0 flex-1 overflow-auto md:block">
              <Table className="min-w-[1080px] table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[13%] pl-5">Sale date</TableHead>
                    <TableHead className="w-[20%]">Contact</TableHead>
                    <TableHead className="w-[16%]">Service</TableHead>
                    <TableHead className="w-[13%]">Status</TableHead>
                    <TableHead className="w-[11%] text-right">Total</TableHead>
                    <TableHead className="w-[11%] text-right">Collected</TableHead>
                    <TableHead className="w-[11%] text-right">Balance</TableHead>
                    <TableHead className="w-[5%]"><span className="sr-only">Open</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && !data
                    ? Array.from({ length: 6 }, (_, index) => (
                        <TableRow key={`transaction-loading-${index}`} className="h-16">
                          {Array.from({ length: 8 }, (__, cellIndex) => (
                            <TableCell key={cellIndex}><Skeleton className="h-4 w-full max-w-28" /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    : transactions.map((transaction) => (
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
                            "h-16 cursor-pointer outline-none hover:bg-blue-50/50 focus-visible:bg-blue-50/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40",
                            transaction.status === "CANCELED" && "bg-slate-50/70 text-slate-500",
                          )}
                        >
                          <TableCell className="pl-5 text-sm text-slate-600">
                            {formatDateTimeForDisplay(transaction.purchasedAt, tenantTimezone)}
                          </TableCell>
                          <TableCell>
                            <p className="truncate font-medium text-slate-950">{transaction.contact.displayName}</p>
                            <p className="mt-0.5 truncate text-xs text-slate-500">
                              {transaction.contact.phone
                                ? formatPhoneNumber(transaction.contact.phone)
                                : transaction.contact.email || "No contact details"}
                            </p>
                          </TableCell>
                          <TableCell className="truncate font-medium text-slate-800">{transaction.service.name}</TableCell>
                          <TableCell>
                            <div className="flex flex-col items-start gap-1">
                              <Badge variant="outline" className={getStatusClassName(transaction.status)}>
                                {getStatusLabel(transaction.status)}
                              </Badge>
                              <span className="text-[11px] text-slate-500">{getPaymentStateLabel(transaction.paymentState)}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums text-slate-900">
                            {formatCurrency(transaction.totalPriceCents, transaction.currency)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-emerald-700">
                            {formatCurrency(transaction.paidCents, transaction.currency)}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums text-slate-950">
                            {formatCurrency(transaction.remainingCents, transaction.currency)}
                          </TableCell>
                          <TableCell className="pr-5 text-right">
                            <ArrowRight className="ml-auto size-4 text-slate-400" aria-hidden="true" />
                          </TableCell>
                        </TableRow>
                      ))}
                  {!isLoading && transactions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="h-56 text-center text-sm text-slate-500">
                        {hasActiveFilters
                          ? "No transactions match these filters."
                          : "No service transactions have been created yet."}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>

            <div className="divide-y divide-slate-200 md:hidden">
              {isLoading && !data
                ? Array.from({ length: 4 }, (_, index) => (
                    <div key={`mobile-transaction-loading-${index}`} className="space-y-3 p-4">
                      <Skeleton className="h-5 w-2/3" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-16 w-full rounded-xl" />
                    </div>
                  ))
                : transactions.map((transaction) => (
                    <button
                      key={transaction.id}
                      type="button"
                      onClick={() => openTransaction(transaction.id)}
                      className={cn(
                        "block min-h-11 w-full cursor-pointer p-4 text-left outline-none transition hover:bg-blue-50/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40",
                        transaction.status === "CANCELED" && "bg-slate-50/70",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-950">{transaction.contact.displayName}</p>
                          <p className="mt-0.5 truncate text-sm text-slate-600">{transaction.service.name}</p>
                        </div>
                        <Badge variant="outline" className={cn("shrink-0", getStatusClassName(transaction.status))}>
                          {getStatusLabel(transaction.status)}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        {formatDateTimeForDisplay(transaction.purchasedAt, tenantTimezone)} · {getPaymentStateLabel(transaction.paymentState)}
                      </p>
                      <dl className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3">
                        <div><dt className="text-[10px] font-semibold uppercase text-slate-400">Total</dt><dd className="mt-1 truncate text-sm font-semibold text-slate-900">{formatCurrency(transaction.totalPriceCents, transaction.currency)}</dd></div>
                        <div><dt className="text-[10px] font-semibold uppercase text-slate-400">Collected</dt><dd className="mt-1 truncate text-sm font-semibold text-emerald-700">{formatCurrency(transaction.paidCents, transaction.currency)}</dd></div>
                        <div><dt className="text-[10px] font-semibold uppercase text-slate-400">Balance</dt><dd className="mt-1 truncate text-sm font-semibold text-slate-900">{formatCurrency(transaction.remainingCents, transaction.currency)}</dd></div>
                      </dl>
                    </button>
                  ))}
              {!isLoading && transactions.length === 0 ? (
                <div className="p-10 text-center text-sm text-slate-500">
                  {hasActiveFilters
                    ? "No transactions match these filters."
                    : "No service transactions have been created yet."}
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        <footer className="mt-auto flex flex-col gap-3 border-t border-slate-200 bg-slate-50/60 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
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
              <SelectTrigger size="sm" aria-label="Rows per page" className="w-20 bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-end gap-2">
            <span className="mr-1 text-sm text-slate-500">Page {page} of {totalPages}</span>
            <Button type="button" variant="outline" size="sm" disabled={!canGoPrevious || isLoading} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
            <Button type="button" variant="outline" size="sm" disabled={!canGoNext || isLoading} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</Button>
          </div>
        </footer>
      </section>
    </div>
  )
}
