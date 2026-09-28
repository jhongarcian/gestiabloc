"use client"

import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Target,
  Trash2,
} from "lucide-react"
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
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
import { cn } from "@/lib/utils"
import { AddContactOpportunityDialog } from "../../../../opportunities/_components/add-contact-opportunity-dialog"
import { ContactOpportunityDetailDrawer } from "../../_components/contact-opportunity-detail-drawer"
import {
  CONTACT_OPPORTUNITY_PAGE_SIZES,
  CONTACT_OPPORTUNITY_SORT_OPTIONS,
  DEFAULT_CONTACT_OPPORTUNITY_SORT,
  parseContactOpportunityPageSize,
  parseContactOpportunitySort,
  type ContactOpportunitiesResponse,
  type ContactOpportunityRecord,
  type ContactOpportunitySort,
} from "../../_lib/contact-opportunities"
import {
  CONTACT_OPPORTUNITIES_REFRESH_EVENT,
  type ContactOpportunitiesRefreshDetail,
} from "../../_lib/contact-opportunity-events"

type ContactOpportunitiesPageContentProps = {
  tenantId: string
  tenantSlug: string
  contactId: string
  contact: {
    id: string
    fullName: string
    email: string | null
    phoneNumber: string | null
  }
  initialData: ContactOpportunitiesResponse
  initialQuery: {
    search: string
    sort: ContactOpportunitySort
    page: number
    pageSize: (typeof CONTACT_OPPORTUNITY_PAGE_SIZES)[number]
  }
  initialLoadFailed?: boolean
  canManageOpportunities: boolean
}

type OpportunityQuery = ContactOpportunitiesPageContentProps["initialQuery"]

const compactPrimaryButton =
  "h-8 shrink-0 cursor-pointer rounded-full bg-blue-950 px-3 py-1 text-xs font-semibold text-white shadow-sm ring-1 ring-black/5 transition hover:bg-blue-900 hover:text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
const compactSecondaryButton =
  "h-8 rounded-full border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-none hover:bg-slate-50 hover:text-slate-950"
const compactDestructiveButton =
  "h-8 rounded-full border-rose-200 bg-white px-3 text-xs font-semibold text-rose-600 shadow-none hover:bg-rose-50 hover:text-rose-700"

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
})

function formatUsdCents(valueCents: number) {
  return currencyFormatter.format(valueCents / 100)
}

function formatDateTime(value: string) {
  return dateFormatter.format(new Date(value))
}

function ResultBadge({ result }: { result: ContactOpportunityRecord["result"] }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        result === "OPEN" && "border-blue-200 bg-blue-50 text-blue-700",
        result === "WON" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        result === "LOST" && "border-rose-200 bg-rose-50 text-rose-700",
      )}
    >
      {result === "OPEN" ? "Open" : result === "WON" ? "Won" : "Lost"}
    </Badge>
  )
}

export function ContactOpportunitiesPageContent({
  tenantId,
  tenantSlug,
  contactId,
  contact,
  initialData,
  initialQuery,
  initialLoadFailed = false,
  canManageOpportunities,
}: ContactOpportunitiesPageContentProps) {
  const [data, setData] = useState(initialData)
  const [searchInput, setSearchInput] = useState(initialQuery.search)
  const [appliedSearch, setAppliedSearch] = useState(initialQuery.search)
  const [sort, setSort] = useState(initialQuery.sort)
  const [page, setPage] = useState(
    Math.min(initialQuery.page, initialData.pagination.totalPages),
  )
  const [pageSize, setPageSize] = useState(initialQuery.pageSize)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(
    initialLoadFailed ? "Opportunities could not be loaded." : null,
  )
  const [isSortSheetOpen, setIsSortSheetOpen] = useState(false)
  const [selectedOpportunity, setSelectedOpportunity] =
    useState<ContactOpportunityRecord | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [deletingOpportunityId, setDeletingOpportunityId] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const isInitialQueryRef = useRef(
    initialQuery.page <= initialData.pagination.totalPages && !initialLoadFailed,
  )
  const pendingRefreshErrorRef = useRef<string | undefined>(undefined)

  const selectedSortLabel =
    CONTACT_OPPORTUNITY_SORT_OPTIONS.find((option) => option.value === sort)?.label ??
    "Recently updated"

  const currentQuery = useMemo<OpportunityQuery>(
    () => ({ search: appliedSearch, sort, page, pageSize }),
    [appliedSearch, page, pageSize, sort],
  )

  const loadOpportunities = useCallback(
    async (query: OpportunityQuery, failureMessage?: string) => {
      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      setIsLoading(true)
      setErrorMessage(null)

      try {
        const { data: responseData } = await api.get<ContactOpportunitiesResponse>(
          `/api/opportunities/${tenantId}/contact/${contactId}`,
          { params: query },
        )

        if (requestIdRef.current !== requestId) return

        if (query.page > responseData.pagination.totalPages) {
          setPage(responseData.pagination.totalPages)
          return
        }

        setData(responseData)
        setSelectedOpportunity((current) => {
          if (!current) return null
          return responseData.items.find((item) => item.id === current.id) ?? current
        })
      } catch {
        if (requestIdRef.current !== requestId) return
        const message = failureMessage ?? "Opportunities could not be loaded. Try again."
        setErrorMessage(message)
        if (failureMessage) toast.error(message)
      } finally {
        if (requestIdRef.current === requestId) setIsLoading(false)
      }
    },
    [contactId, tenantId],
  )

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const nextSearch = searchInput.trim()
      if (nextSearch === appliedSearch) return
      setAppliedSearch(nextSearch)
      setPage(1)
    }, 300)

    return () => window.clearTimeout(timeout)
  }, [appliedSearch, searchInput])

  useEffect(() => {
    const url = new URL(window.location.href)
    const nextParams = url.searchParams

    if (appliedSearch) nextParams.set("search", appliedSearch)
    else nextParams.delete("search")

    if (sort !== DEFAULT_CONTACT_OPPORTUNITY_SORT) nextParams.set("sort", sort)
    else nextParams.delete("sort")

    if (page > 1) nextParams.set("page", String(page))
    else nextParams.delete("page")

    if (pageSize !== CONTACT_OPPORTUNITY_PAGE_SIZES[0]) {
      nextParams.set("pageSize", String(pageSize))
    } else {
      nextParams.delete("pageSize")
    }

    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`)
  }, [appliedSearch, page, pageSize, sort])

  useEffect(() => {
    if (isInitialQueryRef.current) {
      isInitialQueryRef.current = false
      return
    }

    const failureMessage = pendingRefreshErrorRef.current
    pendingRefreshErrorRef.current = undefined
    void loadOpportunities(currentQuery, failureMessage)
  }, [currentQuery, loadOpportunities])

  const refreshAfterCreate = useCallback(async () => {
    const nextQuery: OpportunityQuery = {
      search: "",
      sort: DEFAULT_CONTACT_OPPORTUNITY_SORT,
      page: 1,
      pageSize,
    }
    const failureMessage =
      "Opportunity was created, but the opportunities list could not be refreshed."
    const queryWillChange =
      appliedSearch !== nextQuery.search ||
      sort !== nextQuery.sort ||
      page !== nextQuery.page

    setSearchInput("")

    if (queryWillChange) {
      pendingRefreshErrorRef.current = failureMessage
      setAppliedSearch(nextQuery.search)
      setSort(nextQuery.sort)
      setPage(nextQuery.page)
      return
    }

    await loadOpportunities(nextQuery, failureMessage)
  }, [appliedSearch, loadOpportunities, page, pageSize, sort])

  useEffect(() => {
    const handleRefresh = (event: Event) => {
      const detail = (event as CustomEvent<ContactOpportunitiesRefreshDetail>).detail

      if (detail?.tenantId !== tenantId || detail.contactId !== contactId) return
      void refreshAfterCreate()
    }

    window.addEventListener(
      CONTACT_OPPORTUNITIES_REFRESH_EVENT,
      handleRefresh as EventListener,
    )

    return () => {
      window.removeEventListener(
        CONTACT_OPPORTUNITIES_REFRESH_EVENT,
        handleRefresh as EventListener,
      )
    }
  }, [contactId, refreshAfterCreate, tenantId])

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextSearch = searchInput.trim()
    if (nextSearch === appliedSearch) {
      if (page !== 1) setPage(1)
      else void loadOpportunities({ ...currentQuery, search: nextSearch, page: 1 })
      return
    }
    setAppliedSearch(nextSearch)
    setPage(1)
  }

  const handleViewDetail = (opportunity: ContactOpportunityRecord) => {
    setSelectedOpportunity(opportunity)
    setIsDrawerOpen(true)
  }

  const handleDelete = async (opportunityId: string) => {
    if (!canManageOpportunities) return false
    setDeletingOpportunityId(opportunityId)

    try {
      await api.delete(`/api/opportunities/${tenantId}/${opportunityId}`)
      toast.success("Opportunity removed.")

      setData((current) => {
        const removedOpportunity = current.items.find(
          (item) => item.id === opportunityId,
        )
        const nextTotal = Math.max(0, current.pagination.total - 1)

        return {
          ...current,
          items: current.items.filter((item) => item.id !== opportunityId),
          pagination: {
            ...current.pagination,
            total: nextTotal,
            totalPages: Math.max(1, Math.ceil(nextTotal / current.pagination.pageSize)),
          },
          summary: {
            ...current.summary,
            active:
              removedOpportunity?.result === "OPEN"
                ? Math.max(0, current.summary.active - 1)
                : current.summary.active,
          },
        }
      })

      if (selectedOpportunity?.id === opportunityId) {
        setIsDrawerOpen(false)
        setSelectedOpportunity(null)
      }

      if (data.items.length === 1 && page > 1) {
        setPage((current) => current - 1)
      } else {
        await loadOpportunities(currentQuery)
      }
      return true
    } catch {
      toast.error("Opportunity could not be removed.")
      return false
    } finally {
      setDeletingOpportunityId(null)
    }
  }

  const handleValueChange = async (opportunityId: string, newValueCents: number) => {
    if (!canManageOpportunities) {
      throw new Error("Opportunity changes require Medium or Max access")
    }

    try {
      await api.patch(`/api/opportunities/${tenantId}/${opportunityId}`, {
        valueCents: newValueCents,
      })

      setData((current) => ({
        ...current,
        items: current.items.map((item) =>
          item.id === opportunityId ? { ...item, valueCents: newValueCents } : item,
        ),
      }))
      setSelectedOpportunity((current) =>
        current?.id === opportunityId ? { ...current, valueCents: newValueCents } : current,
      )
      toast.success("Opportunity value updated.")
      await loadOpportunities(currentQuery, "Value was saved, but the list could not be refreshed.")
    } catch {
      toast.error("Opportunity value could not be updated.")
      throw new Error("Opportunity value could not be updated")
    }
  }

  const visiblePageCount = Math.min(5, data.pagination.totalPages)
  const firstVisiblePage = Math.max(
    1,
    Math.min(page - 2, data.pagination.totalPages - visiblePageCount + 1),
  )
  const visiblePages = Array.from(
    { length: visiblePageCount },
    (_, index) => firstVisiblePage + index,
  )
  const placeholderRowCount =
    data.items.length === 0
      ? pageSize - 1
      : Math.max(0, pageSize - data.items.length)
  const firstResult = data.pagination.total === 0 ? 0 : (page - 1) * pageSize + 1
  const lastResult = Math.min(page * pageSize, data.pagination.total)
  const isFiltered = Boolean(appliedSearch)
  const hasRetainedResults = data.items.length > 0

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <header className="shrink-0 rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-4 sm:p-5">
        <h2 className="sr-only">Pipeline opportunities</h2>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <form
            role="search"
            className="relative w-full sm:max-w-md lg:flex-none"
            onSubmit={handleSearchSubmit}
          >
            <Input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search opportunities"
              aria-label="Search opportunities by pipeline, stage, or status"
              className="h-8 w-full rounded-full border-white/80 bg-white/85 pr-11 pl-3 text-xs shadow-sm backdrop-blur placeholder:text-slate-400 focus-visible:border-blue-300 focus-visible:ring-blue-100"
            />
            <Button
              type="submit"
              size="icon-sm"
              aria-label="Search opportunities"
              className="absolute inset-y-0 right-0 size-8 rounded-l-none rounded-r-full bg-blue-950 text-white shadow-none hover:bg-blue-900"
            >
              <Search aria-hidden="true" />
            </Button>
          </form>

          <div className="grid grid-cols-2 gap-3 sm:flex sm:items-center lg:shrink-0">
            <Button
              type="button"
              variant="outline"
              aria-label={`Sort opportunities, currently ${selectedSortLabel}`}
              aria-expanded={isSortSheetOpen}
              aria-controls="contact-opportunity-sort-sheet"
              className="h-8 min-w-0 rounded-full border-white/80 bg-white/70 px-3 text-xs font-semibold text-slate-800 shadow-sm backdrop-blur hover:bg-white hover:text-slate-950 lg:hidden"
              onClick={() => setIsSortSheetOpen(true)}
            >
              <span className="shrink-0 text-slate-500">Sort by</span>
              <span className="truncate">{selectedSortLabel}</span>
              <ChevronDown data-icon="inline-end" aria-hidden="true" />
            </Button>

            <Select
              value={sort}
              onValueChange={(value) => {
                setSort(parseContactOpportunitySort(value))
                setPage(1)
              }}
            >
              <SelectTrigger
                size="sm"
                aria-label={`Sort opportunities, currently ${selectedSortLabel}`}
                className="hidden min-w-48 rounded-full border-white/80 bg-white/70 px-3 text-xs font-semibold text-slate-800 shadow-sm backdrop-blur hover:bg-white lg:flex"
              >
                <span className="text-slate-500">Sort by</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectGroup>
                  {CONTACT_OPPORTUNITY_SORT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>

            <AddContactOpportunityDialog
              tenantId={tenantId}
              initialContact={{
                id: contact.id,
                fullName: contact.fullName,
                email: contact.email,
                phoneNumber: contact.phoneNumber,
              }}
              lockContact
              onCreated={refreshAfterCreate}
              trigger={
                <Button
                  type="button"
                  className="h-8 rounded-full bg-blue-950 px-3 text-xs font-semibold text-white shadow-sm hover:bg-blue-900"
                >
                  <Plus data-icon="inline-start" aria-hidden="true" />
                  Add to pipeline
                </Button>
              }
            />
          </div>
        </div>
      </header>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm">
        <div className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-950">Opportunity register</h3>
            <p className="text-xs text-slate-500">
              {data.pagination.total} {data.pagination.total === 1 ? "opportunity" : "opportunities"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isLoading ? (
              <Loader2 className="size-4 animate-spin text-slate-400" aria-label="Loading opportunities" />
            ) : null}
            <Badge
              variant="outline"
              className="rounded-full border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700"
            >
              {data.summary.active} active
            </Badge>
          </div>
        </div>

        {errorMessage && hasRetainedResults ? (
          <div
            role="status"
            className="flex shrink-0 flex-col gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between sm:px-5"
          >
            <span>{errorMessage} The previous results are still shown.</span>
            <Button
              type="button"
              variant="outline"
              className="h-8 shrink-0 rounded-full border-amber-300 bg-white px-3 text-xs font-semibold text-amber-950 shadow-none hover:bg-amber-100"
              onClick={() => void loadOpportunities(currentQuery)}
            >
              <RefreshCw data-icon="inline-start" aria-hidden="true" />
              Try again
            </Button>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 md:hidden">
          {isLoading ? (
            <MobileOpportunitySkeletons />
          ) : errorMessage && !hasRetainedResults ? (
            <RegisterState
              icon={RefreshCw}
              title="Opportunities are unavailable"
              description={errorMessage}
              actionLabel="Try again"
              onAction={() => void loadOpportunities(currentQuery)}
            />
          ) : data.items.length === 0 ? (
            <RegisterState
              icon={Target}
              title={isFiltered ? "No matching opportunities" : "No opportunities yet"}
              description={
                isFiltered
                  ? "Try a different pipeline, stage, or status."
                  : "Add this contact to a pipeline to create their first opportunity."
              }
              action={
                !isFiltered ? (
                  <AddContactOpportunityDialog
                    tenantId={tenantId}
                    initialContact={{
                      id: contact.id,
                      fullName: contact.fullName,
                      email: contact.email,
                      phoneNumber: contact.phoneNumber,
                    }}
                    lockContact
                    onCreated={refreshAfterCreate}
                    trigger={
                      <Button type="button" variant="ghost" className={compactPrimaryButton}>
                        <Plus data-icon="inline-start" aria-hidden="true" />
                        Add to pipeline
                      </Button>
                    }
                  />
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-3">
              {data.items.map((opportunity) => (
                <MobileOpportunityCard
                  key={opportunity.id}
                  opportunity={opportunity}
                  contactName={contact.fullName}
                  canManageOpportunities={canManageOpportunities}
                  isDeleting={deletingOpportunityId === opportunity.id}
                  onView={() => handleViewDetail(opportunity)}
                  onDelete={() => handleDelete(opportunity.id)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="hidden min-h-0 flex-1 overflow-auto px-4 pt-4 md:block">
          <Table className="min-w-[900px] table-fixed border-separate border-spacing-0">
            <TableHeader className="drop-shadow-sm [&_tr]:border-0">
              <TableRow className="h-14 border-0 hover:bg-transparent">
                <TableHead className="w-[28%] rounded-l-xl border-y border-l bg-slate-50 px-4 text-xs text-slate-600">
                  Pipeline
                </TableHead>
                <TableHead className="w-[20%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Stage
                </TableHead>
                <TableHead className="w-[13%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Status
                </TableHead>
                <TableHead className="w-[15%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Value
                </TableHead>
                <TableHead className="w-[14%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Updated
                </TableHead>
                <TableHead className="w-[10%] rounded-r-xl border-y border-r bg-slate-50 px-4 text-right text-xs text-slate-600">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow aria-hidden="true" className="h-2 border-0 hover:bg-transparent">
                <TableCell colSpan={6} className="p-0" />
              </TableRow>

              {isLoading
                ? Array.from({ length: pageSize }, (_, index) => (
                    <OpportunitySkeletonRow key={`loading-${index}`} />
                  ))
                : null}

              {!isLoading && errorMessage && !hasRetainedResults ? (
                <TableRow className="h-28 hover:bg-transparent">
                  <TableCell colSpan={6} className="px-4 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <p className="text-sm text-slate-600">{errorMessage}</p>
                      <Button
                        type="button"
                        variant="outline"
                        className={compactSecondaryButton}
                        onClick={() => void loadOpportunities(currentQuery)}
                      >
                        <RefreshCw data-icon="inline-start" aria-hidden="true" />
                        Try again
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : null}

              {!isLoading && !errorMessage && data.items.length === 0 ? (
                <TableRow className="h-28 hover:bg-transparent">
                  <TableCell colSpan={6} className="px-4 text-center">
                    <p className="font-medium text-slate-900">
                      {isFiltered ? "No matching opportunities" : "No opportunities yet"}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {isFiltered
                        ? "Try a different pipeline, stage, or status."
                        : "Add this contact to a pipeline to create their first opportunity."}
                    </p>
                    {!isFiltered ? (
                      <div className="mt-4 flex justify-center">
                        <AddContactOpportunityDialog
                          tenantId={tenantId}
                          initialContact={{
                            id: contact.id,
                            fullName: contact.fullName,
                            email: contact.email,
                            phoneNumber: contact.phoneNumber,
                          }}
                          lockContact
                          onCreated={refreshAfterCreate}
                          trigger={
                            <Button
                              type="button"
                              variant="ghost"
                              className={compactPrimaryButton}
                            >
                              <Plus data-icon="inline-start" aria-hidden="true" />
                              Add to pipeline
                            </Button>
                          }
                        />
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ) : null}

              {!isLoading && (!errorMessage || hasRetainedResults)
                ? data.items.map((opportunity) => (
                    <OpportunityTableRow
                      key={opportunity.id}
                      opportunity={opportunity}
                      contactName={contact.fullName}
                      canManageOpportunities={canManageOpportunities}
                      isDeleting={deletingOpportunityId === opportunity.id}
                      onView={() => handleViewDetail(opportunity)}
                      onDelete={() => handleDelete(opportunity.id)}
                    />
                  ))
                : null}

              {!isLoading && (!errorMessage || hasRetainedResults)
                ? Array.from({ length: placeholderRowCount }, (_, index) => (
                    <TableRow
                      key={`placeholder-${index}`}
                      aria-hidden="true"
                      className="h-14 hover:bg-transparent"
                    >
                      <TableCell colSpan={6} className="px-4 py-0" />
                    </TableRow>
                  ))
                : null}
            </TableBody>
          </Table>
        </div>

        <footer className="flex shrink-0 flex-col gap-4 border-t border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span>
              Showing {firstResult}–{lastResult} of {data.pagination.total}
            </span>
            <div className="flex items-center gap-2">
              <span>Rows per page</span>
              <Select
                value={String(pageSize)}
                onValueChange={(value) => {
                  setPageSize(parseContactOpportunityPageSize(value))
                  setPage(1)
                }}
              >
                <SelectTrigger
                  size="sm"
                  aria-label="Rows per page"
                  className="w-16 rounded-full border-slate-200 bg-white text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    {CONTACT_OPPORTUNITY_PAGE_SIZES.map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 md:hidden">
            <Button
              type="button"
              variant="outline"
              className={compactSecondaryButton}
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft data-icon="inline-start" aria-hidden="true" />
              Previous
            </Button>
            <span className="text-xs text-slate-500">
              Page {page} of {data.pagination.totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              className={compactSecondaryButton}
              disabled={page >= data.pagination.totalPages || isLoading}
              onClick={() =>
                setPage((current) => Math.min(data.pagination.totalPages, current + 1))
              }
            >
              Next
              <ChevronRight data-icon="inline-end" aria-hidden="true" />
            </Button>
          </div>

          <div className="hidden items-center gap-1 md:flex">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Previous page"
              disabled={page <= 1 || isLoading}
              className="rounded-full border-slate-200"
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
                aria-label={`Page ${pageNumber}`}
                aria-current={pageNumber === page ? "page" : undefined}
                disabled={pageNumber === page || isLoading}
                className={cn(
                  "rounded-full",
                  pageNumber === page
                    ? "bg-blue-950 text-white"
                    : "border-slate-200 bg-white text-slate-700",
                )}
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
              disabled={page >= data.pagination.totalPages || isLoading}
              className="rounded-full border-slate-200"
              onClick={() =>
                setPage((current) => Math.min(data.pagination.totalPages, current + 1))
              }
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </footer>
      </section>

      <Sheet open={isSortSheetOpen} onOpenChange={setIsSortSheetOpen}>
        <SheetContent
          id="contact-opportunity-sort-sheet"
          side="bottom"
          className="max-h-[80vh] gap-0 rounded-t-[26px] p-0 lg:hidden"
        >
          <SheetHeader className="border-b border-slate-200 px-5 py-5 text-left">
            <SheetTitle className="text-lg text-slate-950">Sort opportunities</SheetTitle>
            <SheetDescription>
              Choose how opportunities are ordered in the register.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-2 overflow-y-auto p-4">
            {CONTACT_OPPORTUNITY_SORT_OPTIONS.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant="outline"
                className={cn(
                  "h-11 w-full justify-between rounded-xl border-slate-200 px-4 text-sm font-medium",
                  sort === option.value
                    ? "border-blue-200 bg-blue-50 text-blue-950 hover:bg-blue-50"
                    : "bg-white text-slate-700 hover:bg-slate-50",
                )}
                onClick={() => {
                  setSort(option.value)
                  setPage(1)
                  setIsSortSheetOpen(false)
                }}
              >
                {option.label}
                {sort === option.value ? <Check aria-hidden="true" /> : null}
              </Button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <ContactOpportunityDetailDrawer
        key={selectedOpportunity?.id ?? "empty"}
        tenantSlug={tenantSlug}
        opportunity={selectedOpportunity}
        open={isDrawerOpen}
        onOpenChange={setIsDrawerOpen}
        onValueChange={canManageOpportunities ? handleValueChange : undefined}
      />
    </div>
  )
}

function MobileOpportunityCard({
  opportunity,
  contactName,
  canManageOpportunities,
  isDeleting,
  onView,
  onDelete,
}: {
  opportunity: ContactOpportunityRecord
  contactName: string
  canManageOpportunities: boolean
  isDeleting: boolean
  onView: () => void
  onDelete: () => Promise<boolean>
}) {
  return (
    <Card className="min-w-0 gap-4 rounded-[20px] border-slate-200 py-4 shadow-sm">
      <CardHeader className="gap-1.5 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="size-2.5 shrink-0 rounded-full border border-slate-200"
            style={{ backgroundColor: opportunity.pipeline.color }}
            aria-hidden="true"
          />
          <CardTitle className="truncate text-[15px] text-slate-950">
            {opportunity.pipeline.name}
          </CardTitle>
        </div>
        <CardDescription className="truncate text-xs">
          Current stage: {opportunity.stage.name}
        </CardDescription>
        <CardAction>
          <ResultBadge result={opportunity.result} />
        </CardAction>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 px-4 text-sm">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">Value</p>
          <p className="mt-1 truncate font-semibold text-slate-950">
            {formatUsdCents(opportunity.valueCents)}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-slate-500">
            {opportunity.closedAt ? "Closed" : "Last updated"}
          </p>
          <p className="mt-1 truncate font-medium text-slate-700">
            {formatDateTime(opportunity.closedAt ?? opportunity.updatedAt)}
          </p>
        </div>
      </CardContent>
      <Separator />
      <CardFooter className="justify-end gap-2 px-4">
        <Button
          type="button"
          variant="outline"
          className={compactSecondaryButton}
          onClick={onView}
        >
          <ExternalLink data-icon="inline-start" aria-hidden="true" />
          View
        </Button>
        {canManageOpportunities ? (
          <OpportunityDeleteDialog
            opportunity={opportunity}
            contactName={contactName}
            isDeleting={isDeleting}
            presentation="labeled"
            onDelete={onDelete}
          />
        ) : null}
      </CardFooter>
    </Card>
  )
}

function OpportunityTableRow({
  opportunity,
  contactName,
  canManageOpportunities,
  isDeleting,
  onView,
  onDelete,
}: {
  opportunity: ContactOpportunityRecord
  contactName: string
  canManageOpportunities: boolean
  isDeleting: boolean
  onView: () => void
  onDelete: () => Promise<boolean>
}) {
  return (
    <TableRow className="h-14 hover:bg-blue-50/40">
      <TableCell className="px-4 py-0">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="size-2.5 shrink-0 rounded-full border border-slate-200"
            style={{ backgroundColor: opportunity.pipeline.color }}
            aria-hidden="true"
          />
          <span className="truncate font-semibold text-slate-950">
            {opportunity.pipeline.name}
          </span>
        </div>
      </TableCell>
      <TableCell className="truncate px-4 py-0 text-slate-700">
        {opportunity.stage.name}
      </TableCell>
      <TableCell className="px-4 py-0">
        <ResultBadge result={opportunity.result} />
      </TableCell>
      <TableCell className="px-4 py-0 font-medium text-slate-900">
        {formatUsdCents(opportunity.valueCents)}
      </TableCell>
      <TableCell className="px-4 py-0 text-slate-600">
        {formatDateTime(opportunity.updatedAt)}
      </TableCell>
      <TableCell className="px-4 py-0">
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={`View ${opportunity.pipeline.name}`}
            className="rounded-full border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-950"
            onClick={onView}
          >
            <ExternalLink aria-hidden="true" />
          </Button>
          {canManageOpportunities ? (
            <OpportunityDeleteDialog
              opportunity={opportunity}
              contactName={contactName}
              isDeleting={isDeleting}
              presentation="icon"
              onDelete={onDelete}
            />
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  )
}

function OpportunityDeleteDialog({
  opportunity,
  contactName,
  isDeleting,
  presentation,
  onDelete,
}: {
  opportunity: ContactOpportunityRecord
  contactName: string
  isDeleting: boolean
  presentation: "icon" | "labeled"
  onDelete: () => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isDeleting) return
        setOpen(nextOpen)
      }}
    >
      <AlertDialogTrigger asChild>
        {presentation === "icon" ? (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={`Remove ${opportunity.pipeline.name}`}
            disabled={isDeleting}
            className="rounded-full border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
          >
            <Trash2 aria-hidden="true" />
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            className={compactDestructiveButton}
            disabled={isDeleting}
          >
            <Trash2 data-icon="inline-start" aria-hidden="true" />
            Remove
          </Button>
        )}
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this opportunity?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes {contactName} from {opportunity.pipeline.name} and the
            opportunities register. The contact record stays in Gestiabloc. This action
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            className={compactSecondaryButton}
            disabled={isDeleting}
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            className="h-8 min-w-28 rounded-full px-3 text-xs font-semibold"
            disabled={isDeleting}
            onClick={(event) => {
              event.preventDefault()
              void (async () => {
                const deleted = await onDelete()
                if (deleted) setOpen(false)
              })()
            }}
          >
            {isDeleting ? (
              <Loader2
                data-icon="inline-start"
                className="animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Trash2 data-icon="inline-start" aria-hidden="true" />
            )}
            {isDeleting ? "Removing" : "Remove opportunity"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function OpportunitySkeletonRow() {
  return (
    <TableRow className="h-14 hover:bg-transparent">
      <TableCell className="px-4 py-0"><Skeleton className="h-4 w-36" /></TableCell>
      <TableCell className="px-4 py-0"><Skeleton className="h-4 w-24" /></TableCell>
      <TableCell className="px-4 py-0"><Skeleton className="h-6 w-14 rounded-full" /></TableCell>
      <TableCell className="px-4 py-0"><Skeleton className="h-4 w-20" /></TableCell>
      <TableCell className="px-4 py-0"><Skeleton className="h-4 w-24" /></TableCell>
      <TableCell className="px-4 py-0"><Skeleton className="ml-auto h-8 w-20 rounded-full" /></TableCell>
    </TableRow>
  )
}

function MobileOpportunitySkeletons() {
  return (
    <div className="space-y-3" aria-label="Loading opportunities">
      {Array.from({ length: 3 }, (_, index) => (
        <Card key={index} className="gap-4 rounded-[20px] py-4 shadow-sm">
          <CardHeader className="px-4">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 px-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </CardContent>
          <CardFooter className="justify-end gap-2 px-4">
            <Skeleton className="h-8 w-20 rounded-full" />
            <Skeleton className="h-8 w-24 rounded-full" />
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}

function RegisterState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  action,
}: {
  icon: typeof Target
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
  action?: ReactNode
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-5 py-10 text-center">
      <span className="inline-flex size-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <h3 className="mt-4 text-base font-semibold text-slate-950">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>
      {actionLabel && onAction ? (
        <Button
          type="button"
          variant="outline"
          className={cn("mt-4", compactSecondaryButton)}
          onClick={onAction}
        >
          <RefreshCw data-icon="inline-start" aria-hidden="true" />
          {actionLabel}
        </Button>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
