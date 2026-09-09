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
import { COMPACT_SECONDARY_BUTTON_CLASS } from "./service-followup-template-styles"

type TemplateEnrollment = {
  id: string
  enrolledAt: string
  enrollmentStatus: "SUCCESS" | "ERROR"
  errorMessage: string | null
  contact: {
    id: string
    name: string
    email: string | null
    phoneNumber: string | null
  }
}

type TemplateEnrollmentsResponse = {
  ok: boolean
  items: TemplateEnrollment[]
  search: string
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}

export function ServiceFollowUpTemplateContactsTab({
  tenantId,
  tenantSlug,
  serviceId,
  templateId,
  timezone,
}: {
  tenantId: string
  tenantSlug: string
  serviceId: string
  templateId: string
  timezone?: string | null
}) {
  const router = useRouter()
  const [items, setItems] = useState<TemplateEnrollment[]>([])
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

  const loadEnrollments = useCallback(async () => {
    setIsLoading(true)
    setLoadFailed(false)

    try {
      const { data } = await api.get<TemplateEnrollmentsResponse>(
        `/api/account-settings/${tenantId}/services/${serviceId}/follow-up-templates/${templateId}/enrollments`,
        {
          params: {
            search: search || undefined,
            page,
            pageSize: 10,
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
  }, [page, search, serviceId, templateId, tenantId])

  useEffect(() => {
    void loadEnrollments()
  }, [loadEnrollments])

  const visiblePageCount = Math.min(5, totalPages)
  const firstVisiblePage = Math.max(
    1,
    Math.min(page - 2, totalPages - visiblePageCount + 1),
  )
  const visiblePages = Array.from(
    { length: visiblePageCount },
    (_, index) => firstVisiblePage + index,
  )
  const placeholderRowCount = items.length === 0 ? 9 : Math.max(0, 10 - items.length)
  const summaryLabel = totalCount
    ? `Showing ${(page - 1) * 10 + 1}-${(page - 1) * 10 + items.length} of ${totalCount} enrollments`
    : "No enrollments found"

  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm"
      aria-label="Enrolled contact list"
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
              One entry for every enrollment in this follow-up template.
            </p>
          </div>

          <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
            <div className="relative min-w-0 flex-1 lg:w-[360px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
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
              onClick={() => void loadEnrollments()}
              disabled={isLoading}
            >
              <RefreshCw
                data-icon="inline-start"
                className={isLoading ? "animate-spin" : undefined}
                aria-hidden="true"
              />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 pt-4">
        <Table
          className="min-w-[920px] table-fixed border-separate border-spacing-0"
          aria-label="Follow-up template enrollments"
        >
          <TableHeader className="drop-shadow-sm [&_tr]:border-0">
            <TableRow className="h-14 border-0 hover:bg-transparent">
              <TableHead className="w-[22%] rounded-l-xl border-y border-l bg-slate-50 px-4 text-xs text-slate-600">
                Full name
              </TableHead>
              <TableHead className="w-[22%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                Date and time of entry
              </TableHead>
              <TableHead className="w-[22%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                Email
              </TableHead>
              <TableHead className="w-[18%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                Phone number
              </TableHead>
              <TableHead className="w-[16%] rounded-r-xl border-y border-r bg-slate-50 px-4 text-xs text-slate-600">
                Enrollment status
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow aria-hidden="true" className="h-2 border-0 hover:bg-transparent">
              <TableCell colSpan={5} className="p-0" />
            </TableRow>

            {isLoading ? (
              Array.from({ length: 10 }, (_, index) => (
                <TableRow key={`enrollment-skeleton-${index}`} className="h-14 hover:bg-transparent">
                  <TableCell className="px-4 py-0"><Skeleton className="h-4 w-4/5" /></TableCell>
                  <TableCell className="px-4 py-0"><Skeleton className="h-4 w-36" /></TableCell>
                  <TableCell className="px-4 py-0"><Skeleton className="h-4 w-4/5" /></TableCell>
                  <TableCell className="px-4 py-0"><Skeleton className="h-4 w-28" /></TableCell>
                  <TableCell className="px-4 py-0"><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                </TableRow>
              ))
            ) : loadFailed ? (
              <TableRow className="h-14 hover:bg-transparent">
                <TableCell colSpan={5} className="px-4 py-0 text-center text-rose-700">
                  <div className="flex items-center justify-center gap-3">
                    <span>Could not load enrolled contacts.</span>
                    <Button
                      type="button"
                      variant="outline"
                      className={COMPACT_SECONDARY_BUTTON_CLASS}
                      onClick={() => void loadEnrollments()}
                    >
                      Try again
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : items.length ? (
              items.map((enrollment) => {
                const href = `/app/${encodeURIComponent(tenantSlug)}/contacts/${encodeURIComponent(enrollment.contact.id)}`

                return (
                  <TableRow
                    key={enrollment.id}
                    tabIndex={0}
                    role="link"
                    aria-label={`Open ${enrollment.contact.name} details`}
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
                      <span className="block truncate font-medium text-slate-950" title={enrollment.contact.name}>
                        {enrollment.contact.name}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-0 text-slate-700">
                      <time dateTime={enrollment.enrolledAt}>
                        {formatDateTimeForDisplay(enrollment.enrolledAt, timezone)}
                      </time>
                    </TableCell>
                    <TableCell className="px-4 py-0">
                      <span className="block truncate text-slate-700" title={enrollment.contact.email ?? undefined}>
                        {enrollment.contact.email ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-0 text-slate-700">
                      {formatPhoneNumber(enrollment.contact.phoneNumber)}
                    </TableCell>
                    <TableCell className="px-4 py-0">
                      <Badge
                        variant="outline"
                        title={enrollment.errorMessage ?? undefined}
                        className={cn(
                          "rounded-full px-2.5 py-1 text-xs font-semibold",
                          enrollment.enrollmentStatus === "SUCCESS"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-rose-200 bg-rose-50 text-rose-700",
                        )}
                      >
                        {enrollment.enrollmentStatus === "SUCCESS" ? "Successful" : "Error"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                )
              })
            ) : (
              <TableRow className="h-14 hover:bg-transparent">
                <TableCell colSpan={5} className="px-4 py-0 text-center text-slate-500">
                  {search
                    ? "No enrolled contacts match your search."
                    : "No contacts are enrolled in this template yet."}
                </TableCell>
              </TableRow>
            )}

            {!isLoading && !loadFailed
              ? Array.from({ length: placeholderRowCount }, (_, index) => (
                  <TableRow
                    key={`empty-enrollment-row-${index}`}
                    aria-hidden="true"
                    className="h-14 hover:bg-transparent"
                  >
                    <TableCell colSpan={5} className="px-4 py-0" />
                  </TableRow>
                ))
              : null}
          </TableBody>
        </Table>
      </div>

      <footer className="flex flex-col gap-4 border-t border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        {isLoading ? <Skeleton className="h-4 w-44" /> : <p className="text-sm text-slate-500">{summaryLabel}</p>}
        <nav className="flex items-center gap-2 self-end sm:self-auto" aria-label="Enrollment list pagination">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Previous page"
            disabled={page <= 1 || isLoading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
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
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Next page"
            disabled={page >= totalPages || isLoading}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            <ChevronRight />
          </Button>
        </nav>
      </footer>
    </section>
  )
}
