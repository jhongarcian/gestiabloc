"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, Search } from "lucide-react"

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
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
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
import { cn } from "@/lib/utils"

import type {
  AutomationNodeExecution,
  AutomationNodeExecutionStatus,
} from "./automation-types"

type StatusFilter = "ALL" | AutomationNodeExecutionStatus

type ExecutionLogsResponse = {
  ok: boolean
  items: AutomationNodeExecution[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

const STATUS_STYLES: Record<AutomationNodeExecutionStatus, string> = {
  EXECUTED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  SKIPPED: "border-amber-200 bg-amber-50 text-amber-700",
  FAILED: "border-rose-200 bg-rose-50 text-rose-700",
}

function StatusBadge({ status }: { status: AutomationNodeExecutionStatus }) {
  const label = status.charAt(0) + status.slice(1).toLocaleLowerCase()
  return (
    <Badge variant="outline" className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", STATUS_STYLES[status])}>
      {label}
    </Badge>
  )
}

function NodeLabel({ item }: { item: AutomationNodeExecution }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-medium text-slate-900" title={item.node.label}>{item.node.label}</p>
      <p className="text-xs text-slate-500">
        {item.node.kind === "TRIGGER" ? "Trigger" : `Action ${item.node.index ?? ""}`}
      </p>
    </div>
  )
}

export function AutomationExecutionLogsTab({
  tenantId,
  tenantSlug,
  automationId,
  timezone,
}: {
  tenantId: string
  tenantSlug: string
  automationId: string
  timezone?: string | null
}) {
  const router = useRouter()
  const [items, setItems] = useState<AutomationNodeExecution[]>([])
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<StatusFilter>("ALL")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timeoutId)
  }, [searchInput])

  const loadLogs = useCallback(async () => {
    setIsLoading(true)
    setLoadFailed(false)
    try {
      const { data } = await api.get<ExecutionLogsResponse>(
        `/api/account-settings/${tenantId}/automations/${automationId}/execution-logs`,
        {
          params: {
            page,
            pageSize,
            search: search || undefined,
            status: status === "ALL" ? undefined : status,
          },
        },
      )
      if (page > data.pagination.totalPages) {
        setPage(data.pagination.totalPages)
        return
      }
      setItems(data.items)
      setTotal(data.pagination.total)
      setTotalPages(data.pagination.totalPages)
    } catch {
      setItems([])
      setTotal(0)
      setTotalPages(1)
      setLoadFailed(true)
    } finally {
      setIsLoading(false)
    }
  }, [automationId, page, pageSize, search, status, tenantId])

  useEffect(() => {
    void loadLogs()
  }, [loadLogs])

  const openContact = (contactId: string | null) => {
    if (!contactId) return
    router.push(`/app/${encodeURIComponent(tenantSlug)}/contacts/${encodeURIComponent(contactId)}`)
  }
  const visiblePageCount = Math.min(5, totalPages)
  const firstVisiblePage = Math.max(1, Math.min(page - 2, totalPages - visiblePageCount + 1))
  const visiblePages = Array.from({ length: visiblePageCount }, (_, index) => firstVisiblePage + index)
  const placeholderRowCount = items.length === 0 ? Math.max(0, pageSize - 1) : Math.max(0, pageSize - items.length)
  const firstResult = total ? (page - 1) * pageSize + 1 : 0
  const lastResult = total ? firstResult + items.length - 1 : 0
  const timezoneLabel = timezone?.trim() || "America/Chicago"

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm" aria-label="Automation execution logs">
      <div className="border-b border-slate-200 bg-slate-50/60 px-5 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-950">Execution logs</h2>
              <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">{total}</Badge>
            </div>
            <p className="mt-1 text-xs text-slate-500">Times shown in {timezoneLabel}</p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
            <div className="relative min-w-0 flex-1 lg:w-[320px]">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search contact name"
                aria-label="Search execution logs by contact"
                className="h-10 bg-white pl-9"
              />
            </div>
            <Select value={status} onValueChange={(value) => { setStatus(value as StatusFilter); setPage(1) }}>
              <SelectTrigger className="h-10 w-full bg-white sm:w-[160px]" aria-label="Filter execution status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="ALL">All statuses</SelectItem>
                  <SelectItem value="EXECUTED">Executed</SelectItem>
                  <SelectItem value="SKIPPED">Skipped</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="hidden min-h-0 flex-1 overflow-auto px-4 pt-4 md:block">
        <Table className="min-w-[1040px] table-fixed border-separate border-spacing-0" aria-label="Automation node execution logs">
          <TableHeader className="drop-shadow-sm [&_tr]:border-0">
            <TableRow className="h-14 border-0 hover:bg-transparent">
              <TableHead className="w-[20%] rounded-l-xl border-y border-l bg-slate-50 px-4 text-xs text-slate-600">Contact</TableHead>
              <TableHead className="w-[20%] border-y bg-slate-50 px-4 text-xs text-slate-600">Node</TableHead>
              <TableHead className="w-[12%] border-y bg-slate-50 px-4 text-xs text-slate-600">Status</TableHead>
              <TableHead className="w-[30%] border-y bg-slate-50 px-4 text-xs text-slate-600">Details</TableHead>
              <TableHead className="w-[18%] rounded-r-xl border-y border-r bg-slate-50 px-4 text-xs text-slate-600">Executed on</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow aria-hidden="true" className="h-2 border-0 hover:bg-transparent"><TableCell colSpan={5} className="p-0" /></TableRow>
            {isLoading ? Array.from({ length: pageSize }, (_, index) => (
              <TableRow key={`log-skeleton-${index}`} className="h-14 hover:bg-transparent">
                <TableCell className="px-4 py-0"><Skeleton className="h-4 w-4/5" /></TableCell>
                <TableCell className="px-4 py-0"><Skeleton className="h-8 w-4/5" /></TableCell>
                <TableCell className="px-4 py-0"><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                <TableCell className="px-4 py-0"><Skeleton className="h-4 w-full" /></TableCell>
                <TableCell className="px-4 py-0"><Skeleton className="h-4 w-36" /></TableCell>
              </TableRow>
            )) : loadFailed ? (
              <TableRow className="h-14 hover:bg-transparent"><TableCell colSpan={5} className="px-4 py-0 text-center text-rose-700"><div className="flex items-center justify-center gap-3"><span>Could not load execution logs.</span><Button type="button" size="sm" variant="outline" onClick={() => void loadLogs()}>Try again</Button></div></TableCell></TableRow>
            ) : items.length ? items.map((item) => {
              const isClickable = Boolean(item.contact.id)
              return (
                <TableRow
                  key={item.id}
                  tabIndex={isClickable ? 0 : undefined}
                  role={isClickable ? "link" : undefined}
                  aria-label={isClickable ? `Open ${item.contact.name} details` : undefined}
                  className={cn("h-14 outline-none", isClickable && "cursor-pointer hover:bg-blue-50/50 focus-visible:bg-blue-50/50 focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-inset")}
                  onClick={() => openContact(item.contact.id)}
                  onKeyDown={(event) => {
                    if (isClickable && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault()
                      openContact(item.contact.id)
                    }
                  }}
                >
                  <TableCell className="px-4 py-0"><span className="block truncate font-medium text-slate-950" title={item.contact.name}>{item.contact.name}</span></TableCell>
                  <TableCell className="px-4 py-0"><NodeLabel item={item} /></TableCell>
                  <TableCell className="px-4 py-0"><StatusBadge status={item.status} /></TableCell>
                  <TableCell className="px-4 py-0"><p className="line-clamp-2 text-xs leading-5 text-slate-600" title={item.details ?? undefined}>{item.details ?? "—"}</p></TableCell>
                  <TableCell className="px-4 py-0 text-sm text-slate-600"><time dateTime={item.occurredAt}>{formatDateTimeForDisplay(item.occurredAt, timezone)}</time></TableCell>
                </TableRow>
              )
            }) : (
              <TableRow className="h-14 hover:bg-transparent"><TableCell colSpan={5} className="px-4 py-0 text-center text-slate-500">{search || status !== "ALL" ? "No logs match these filters." : "No execution activity has been recorded yet."}</TableCell></TableRow>
            )}
            {!isLoading && !loadFailed ? Array.from({ length: placeholderRowCount }, (_, index) => (
              <TableRow key={`empty-log-row-${index}`} aria-hidden="true" className="h-14 hover:bg-transparent"><TableCell colSpan={5} className="px-4 py-0" /></TableRow>
            )) : null}
          </TableBody>
        </Table>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 md:hidden">
        {isLoading ? Array.from({ length: 3 }, (_, index) => (
          <Card key={`mobile-log-skeleton-${index}`} className="gap-4 rounded-2xl py-4">
            <CardHeader className="px-4"><Skeleton className="h-5 w-2/3" /><CardAction><Skeleton className="h-6 w-20 rounded-full" /></CardAction></CardHeader>
            <CardContent className="space-y-3 px-4"><Skeleton className="h-8 w-3/5" /><Skeleton className="h-4 w-full" /></CardContent>
            <Separator />
            <CardFooter className="justify-between px-4"><Skeleton className="h-3 w-20" /><Skeleton className="h-3 w-28" /></CardFooter>
          </Card>
        )) : loadFailed ? (
          <div className="flex min-h-44 flex-col items-center justify-center gap-3 rounded-2xl border border-rose-200 bg-rose-50/50 p-5 text-center text-sm text-rose-700"><span>Could not load execution logs.</span><Button type="button" size="sm" variant="outline" onClick={() => void loadLogs()}>Try again</Button></div>
        ) : items.length ? items.map((item) => {
          const isClickable = Boolean(item.contact.id)
          return (
            <Card
              key={item.id}
              tabIndex={isClickable ? 0 : undefined}
              role={isClickable ? "link" : undefined}
              aria-label={isClickable ? `Open ${item.contact.name} details` : undefined}
              className={cn("gap-4 rounded-2xl border-slate-200 py-4 outline-none", isClickable && "cursor-pointer transition hover:bg-blue-50/30 focus-visible:ring-2 focus-visible:ring-blue-500/40 active:bg-blue-50/50")}
              onClick={() => openContact(item.contact.id)}
              onKeyDown={(event) => {
                if (isClickable && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault()
                  openContact(item.contact.id)
                }
              }}
            >
              <CardHeader className="min-w-0 gap-1 px-4">
                <CardTitle className="min-w-0 truncate text-base text-slate-950" title={item.contact.name}>{item.contact.name}</CardTitle>
                <CardDescription>{item.node.kind === "TRIGGER" ? "Trigger" : `Action ${item.node.index ?? ""}`}</CardDescription>
                <CardAction className="flex items-center gap-1.5"><StatusBadge status={item.status} />{isClickable ? <ChevronRight className="size-4 text-slate-400" aria-hidden="true" /> : null}</CardAction>
              </CardHeader>
              <CardContent className="min-w-0 space-y-3 px-4">
                <div className="space-y-1"><p className="text-xs font-medium text-slate-500">Node</p><p className="break-words text-sm font-medium text-slate-900">{item.node.label}</p></div>
                <div className="space-y-1"><p className="text-xs font-medium text-slate-500">Details</p><p className="break-words text-sm leading-6 text-slate-600">{item.details ?? "—"}</p></div>
              </CardContent>
              <Separator />
              <CardFooter className="justify-between gap-4 px-4 text-xs text-slate-500"><span>Executed on</span><time dateTime={item.occurredAt} className="text-right">{formatDateTimeForDisplay(item.occurredAt, timezone)}</time></CardFooter>
            </Card>
          )
        }) : <div className="flex min-h-44 items-center justify-center rounded-2xl border border-dashed border-slate-200 p-5 text-center text-sm text-slate-500">{search || status !== "ALL" ? "No logs match these filters." : "No execution activity has been recorded yet."}</div>}
      </div>

      <footer className="flex flex-col gap-4 border-t border-slate-200 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          {isLoading ? <Skeleton className="h-4 w-44" /> : <p className="text-sm text-slate-500" aria-live="polite">{total ? `Showing ${firstResult}-${lastResult} of ${total} logs` : "No logs found"}</p>}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500"><span className="md:hidden">Per page</span><span className="hidden md:inline">Rows per page</span></span>
            <Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPage(1) }}>
              <SelectTrigger className="h-8 w-[74px] bg-white" aria-label="Rows per page"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{[10, 25, 50].map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </div>
        </div>
        <nav className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-2xl border bg-white p-1.5 shadow-sm md:flex md:w-auto md:self-end md:border-0 md:bg-transparent md:p-0 md:shadow-none lg:self-auto" aria-label="Execution log pagination">
          <Button type="button" variant="outline" size="sm" className="h-10 min-w-0 rounded-xl md:size-8 md:p-0" aria-label="Previous page" disabled={page <= 1 || isLoading} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft aria-hidden="true" /><span className="md:sr-only">Previous</span></Button>
          <span className="min-w-20 rounded-xl bg-slate-50 px-2 py-2 text-center text-xs tabular-nums md:hidden" aria-live="polite"><strong>{page}</strong> of {totalPages}</span>
          <div className="hidden items-center gap-2 md:flex">{visiblePages.map((pageNumber) => <Button key={pageNumber} type="button" variant={pageNumber === page ? "default" : "outline"} size="icon-sm" aria-label={pageNumber === page ? `Page ${pageNumber}` : `Go to page ${pageNumber}`} aria-current={pageNumber === page ? "page" : undefined} disabled={isLoading || pageNumber === page} className={pageNumber === page ? "bg-blue-950 text-white hover:bg-blue-900 disabled:opacity-100" : undefined} onClick={() => setPage(pageNumber)}>{pageNumber}</Button>)}</div>
          <Button type="button" variant="outline" size="sm" className="h-10 min-w-0 rounded-xl md:size-8 md:p-0" aria-label="Next page" disabled={page >= totalPages || isLoading} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}><span className="md:sr-only">Next</span><ChevronRight aria-hidden="true" /></Button>
        </nav>
      </footer>
    </section>
  )
}
