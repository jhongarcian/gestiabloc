"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { cn } from "@/lib/utils"

import type { AutomationContact } from "./automation-types"

const PAGE_SIZE = 10

const COMPACT_SECONDARY_BUTTON_CLASS =
  "h-8 shrink-0 cursor-pointer rounded-full border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"

type AutomationContactsResponse = {
  ok: boolean
  items: AutomationContact[]
  search: string
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}

export function AutomationContactsTab({
  tenantId,
  tenantSlug,
  automationId,
}: {
  tenantId: string
  tenantSlug: string
  automationId: string
}) {
  const router = useRouter()
  const [items, setItems] = useState<AutomationContact[]>([])
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
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

  const loadContacts = useCallback(async () => {
    setIsLoading(true)
    setLoadFailed(false)
    try {
      const { data } = await api.get<AutomationContactsResponse>(
        `/api/account-settings/${tenantId}/automations/${automationId}/contacts`,
        {
          params: {
            search: search || undefined,
            page,
            pageSize: PAGE_SIZE,
          },
        },
      )

      if (page > data.totalPages) {
        setPage(data.totalPages)
        return
      }

      setItems(data.items)
      setTotalCount(data.totalCount)
      setTotalPages(data.totalPages)
    } catch {
      setItems([])
      setTotalCount(0)
      setTotalPages(1)
      setLoadFailed(true)
    } finally {
      setIsLoading(false)
    }
  }, [automationId, page, search, tenantId])

  useEffect(() => {
    void loadContacts()
  }, [loadContacts])

  const visiblePageCount = Math.min(5, totalPages)
  const firstVisiblePage = Math.max(1, Math.min(page - 2, totalPages - visiblePageCount + 1))
  const visiblePages = Array.from({ length: visiblePageCount }, (_, index) => firstVisiblePage + index)
  const placeholderRowCount = items.length === 0 ? 9 : Math.max(0, PAGE_SIZE - items.length)
  const summaryLabel = totalCount
    ? `Showing ${(page - 1) * PAGE_SIZE + 1}-${(page - 1) * PAGE_SIZE + items.length} of ${totalCount} contacts`
    : "No contacts found"

  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm"
      aria-label="Contacts enrolled in automation"
    >
      <div className="border-b border-slate-200 bg-slate-50/60 px-5 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-950">Enrolled contacts</h2>
              <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">
                {totalCount}
              </Badge>
            </div>
            <p className="text-xs text-slate-500">
              One entry for each contact that has entered this automation.
            </p>
          </div>

          <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
            <div className="relative min-w-0 flex-1 lg:w-[360px]">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search name, email, or phone"
                aria-label="Search enrolled contacts"
                className="h-10 bg-white pl-9"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className={COMPACT_SECONDARY_BUTTON_CLASS}
              onClick={() => void loadContacts()}
              disabled={isLoading}
            >
              <RefreshCw data-icon="inline-start" className={isLoading ? "animate-spin" : undefined} aria-hidden="true" />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 pt-4">
        <Table className="min-w-[980px] table-fixed border-separate border-spacing-0" aria-label="Automation enrolled contacts">
          <TableHeader className="drop-shadow-sm [&_tr]:border-0">
            <TableRow className="h-14 border-0 hover:bg-transparent">
              <TableHead className="w-[22%] rounded-l-xl border-y border-l bg-slate-50 px-4 text-xs text-slate-600">Full name</TableHead>
              <TableHead className="w-[20%] border-y bg-slate-50 px-4 text-xs text-slate-600">Date and time of entry</TableHead>
              <TableHead className="w-[20%] border-y bg-slate-50 px-4 text-xs text-slate-600">Email</TableHead>
              <TableHead className="w-[16%] border-y bg-slate-50 px-4 text-xs text-slate-600">Phone number</TableHead>
              <TableHead className="w-[10%] border-y bg-slate-50 px-4 text-xs text-slate-600">Runs</TableHead>
              <TableHead className="w-[12%] rounded-r-xl border-y border-r bg-slate-50 px-4 text-xs text-slate-600">Last result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow aria-hidden="true" className="h-2 border-0 hover:bg-transparent">
              <TableCell colSpan={6} className="p-0" />
            </TableRow>

            {isLoading ? (
              Array.from({ length: PAGE_SIZE }, (_, index) => (
                <TableRow key={`automation-contact-skeleton-${index}`} className="h-14 hover:bg-transparent">
                  <TableCell className="px-4 py-0"><Skeleton className="h-4 w-4/5" /></TableCell>
                  <TableCell className="px-4 py-0"><Skeleton className="h-4 w-36" /></TableCell>
                  <TableCell className="px-4 py-0"><Skeleton className="h-4 w-4/5" /></TableCell>
                  <TableCell className="px-4 py-0"><Skeleton className="h-4 w-28" /></TableCell>
                  <TableCell className="px-4 py-0"><Skeleton className="h-4 w-8" /></TableCell>
                  <TableCell className="px-4 py-0"><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                </TableRow>
              ))
            ) : loadFailed ? (
              <TableRow className="h-14 hover:bg-transparent">
                <TableCell colSpan={6} className="px-4 py-0 text-center text-rose-700">
                  <div className="flex items-center justify-center gap-3">
                    <span>Could not load enrolled contacts.</span>
                    <Button type="button" variant="outline" className={COMPACT_SECONDARY_BUTTON_CLASS} onClick={() => void loadContacts()}>
                      Try again
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : items.length ? (
              items.map((item) => {
                const href = `/app/${encodeURIComponent(tenantSlug)}/contacts/${encodeURIComponent(item.contact.id)}`
                return (
                  <TableRow
                    key={item.contact.id}
                    tabIndex={0}
                    role="link"
                    aria-label={`Open ${item.contact.name} details`}
                    className="h-14 cursor-pointer outline-none hover:bg-blue-50/50 focus-visible:bg-blue-50/50 focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-inset"
                    onClick={() => router.push(href)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        router.push(href)
                      }
                    }}
                  >
                    <TableCell className="px-4 py-0">
                      <span className="block truncate font-medium text-slate-950" title={item.contact.name}>{item.contact.name}</span>
                    </TableCell>
                    <TableCell className="px-4 py-0 text-slate-700">
                      <time dateTime={item.firstEnteredAt}>{formatDateTimeForDisplay(item.firstEnteredAt)}</time>
                    </TableCell>
                    <TableCell className="px-4 py-0">
                      <span className="block truncate text-slate-700" title={item.contact.email ?? undefined}>{item.contact.email ?? "—"}</span>
                    </TableCell>
                    <TableCell className="px-4 py-0 text-slate-700">{formatPhoneNumber(item.contact.phoneNumber)}</TableCell>
                    <TableCell className="px-4 py-0 text-slate-700">{item.executionCount}</TableCell>
                    <TableCell className="px-4 py-0">
                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded-full px-2.5 py-1 text-xs font-semibold",
                          item.lastStatus === "SUCCEEDED"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : item.lastStatus === "EXITED"
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                            : item.lastStatus === "FAILED"
                              ? "border-rose-200 bg-rose-50 text-rose-700"
                              : "border-slate-200 bg-slate-50 text-slate-600",
                        )}
                      >
                        {item.lastStatus === "SUCCEEDED"
                          ? "Successful"
                          : item.lastStatus === "EXITED"
                            ? "Exited"
                          : item.lastStatus === "FAILED"
                            ? "Failed"
                            : "Waiting for trigger"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                )
              })
            ) : (
              <TableRow className="h-14 hover:bg-transparent">
                <TableCell colSpan={6} className="px-4 py-0 text-center text-slate-500">
                  {search ? "No enrolled contacts match your search." : "No contacts have entered this automation yet."}
                </TableCell>
              </TableRow>
            )}

            {!isLoading && !loadFailed
              ? Array.from({ length: placeholderRowCount }, (_, index) => (
                  <TableRow key={`empty-automation-contact-row-${index}`} aria-hidden="true" className="h-14 hover:bg-transparent">
                    <TableCell colSpan={6} className="px-4 py-0" />
                  </TableRow>
                ))
              : null}
          </TableBody>
        </Table>
      </div>

      <footer className="flex flex-col gap-4 border-t border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        {isLoading ? <Skeleton className="h-4 w-44" /> : <p className="text-sm text-slate-500">{summaryLabel}</p>}
        <nav className="flex items-center gap-2 self-end sm:self-auto" aria-label="Automation contact list pagination">
          <Button type="button" variant="outline" size="icon-sm" aria-label="Previous page" disabled={page <= 1 || isLoading} onClick={() => setPage((current) => Math.max(1, current - 1))}>
            <ChevronLeft />
          </Button>
          {visiblePages.map((pageNumber) => (
            <Button
              key={pageNumber}
              type="button"
              variant={pageNumber === page ? "default" : "outline"}
              size="icon-sm"
              aria-label={pageNumber === page ? `Page ${pageNumber}` : `Go to page ${pageNumber}`}
              aria-current={pageNumber === page ? "page" : undefined}
              disabled={isLoading || pageNumber === page}
              className={pageNumber === page ? "bg-blue-950 text-white hover:bg-blue-900 disabled:opacity-100" : undefined}
              onClick={() => setPage(pageNumber)}
            >
              {pageNumber}
            </Button>
          ))}
          <Button type="button" variant="outline" size="icon-sm" aria-label="Next page" disabled={page >= totalPages || isLoading} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
            <ChevronRight />
          </Button>
        </nav>
      </footer>
    </section>
  )
}
