"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Loader2, RefreshCw, Search, UsersRound } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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

type TemplateEnrollment = {
  id: string
  enrolledAt: string
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

  return (
    <section className="min-h-0 flex-1 overflow-y-auto rounded-[20px] border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-sky-50/60 px-5 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-sky-100 bg-sky-50 text-sky-700">
                <UsersRound className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-950">Enrolled contacts</p>
                <p className="text-xs text-slate-500">
                  One entry for every enrollment in this follow-up template.
                </p>
              </div>
              <Badge variant="outline" className="ml-1 border-slate-200 bg-white text-slate-600">
                {totalCount}
              </Badge>
            </div>
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
              className="h-10 cursor-pointer bg-white"
              onClick={() => void loadEnrollments()}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <div className="p-5">
        {isLoading ? (
          <div className="flex min-h-64 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50/70 text-sm text-slate-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading enrolled contacts...
          </div>
        ) : loadFailed ? (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-rose-200 bg-rose-50/60 px-6 text-center">
            <p className="text-sm font-semibold text-rose-900">Could not load enrolled contacts.</p>
            <p className="mt-1 text-xs text-rose-700">Try refreshing this list.</p>
            <Button type="button" variant="outline" className="mt-4 cursor-pointer bg-white" onClick={() => void loadEnrollments()}>
              Try again
            </Button>
          </div>
        ) : items.length ? (
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="overflow-x-auto">
              <Table className="min-w-[760px]">
                <TableHeader className="bg-slate-50/80">
                  <TableRow>
                    <TableHead className="w-[30%]">Contact</TableHead>
                    <TableHead>Date and time of entry</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone number</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((enrollment) => (
                    <TableRow key={enrollment.id} className="hover:bg-sky-50/40">
                      <TableCell>
                        <Link
                          href={`/app/${encodeURIComponent(tenantSlug)}/contacts/${encodeURIComponent(enrollment.contact.id)}/overview`}
                          className="font-medium text-slate-950 underline-offset-4 hover:text-sky-700 hover:underline"
                        >
                          {enrollment.contact.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-slate-600">
                        <time dateTime={enrollment.enrolledAt}>
                          {formatDateTimeForDisplay(enrollment.enrolledAt, timezone)}
                        </time>
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {enrollment.contact.email ? (
                          <a className="hover:text-sky-700 hover:underline" href={`mailto:${enrollment.contact.email}`}>
                            {enrollment.contact.email}
                          </a>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {enrollment.contact.phoneNumber ? (
                          <a className="hover:text-sky-700 hover:underline" href={`tel:${enrollment.contact.phoneNumber}`}>
                            {formatPhoneNumber(enrollment.contact.phoneNumber)}
                          </a>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-500">
                Showing {items.length} of {totalCount} enrollment{totalCount === 1 ? "" : "s"}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="cursor-pointer bg-white"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1}
                >
                  Previous
                </Button>
                <span className="min-w-24 text-center text-xs text-slate-500">
                  Page {page} of {totalPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="cursor-pointer bg-white"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={page >= totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-6 text-center">
            <UsersRound className="h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-800">
              {search ? "No enrolled contacts match your search." : "No contacts are enrolled yet."}
            </p>
            <p className="mt-1 max-w-md text-xs text-slate-500">
              {search
                ? "Try a different name, email address, or phone number."
                : "Contacts will appear here after they are enrolled in this published template."}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
