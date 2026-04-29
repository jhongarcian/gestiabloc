"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { isAxiosError } from "axios"
import { CheckCircle2, Layers3, Route } from "lucide-react"

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
import { cn } from "@/lib/utils"

type ServiceFollowUpsPanelProps = {
  tenantId: string
  tenantSlug: string
  initialServiceId?: string
}

type FollowUpTemplatesResponse = {
  ok: boolean
  items: Array<{
    id: string
    name: string
    isPublished: boolean
    serviceId: string
    serviceName: string
    serviceIsActive: boolean
  }>
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

const PAGE_SIZE_OPTIONS = [10, 25] as const

function TemplateStateBadge({
  isPublished,
}: {
  isPublished: boolean
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]",
        isPublished ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700",
      )}
    >
      {isPublished ? "Published" : "Draft"}
    </span>
  )
}

export function ServiceFollowUpsPanel({
  tenantId,
  tenantSlug,
  initialServiceId,
}: ServiceFollowUpsPanelProps) {
  const router = useRouter()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(10)
  const [search, setSearch] = useState("")
  const [data, setData] = useState<FollowUpTemplatesResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const { data: response } = await api.get<FollowUpTemplatesResponse>(
        `/api/account-settings/${tenantId}/follow-up-templates`,
        {
          params: {
            page,
            pageSize,
            search: search.trim() || undefined,
            serviceId: initialServiceId || undefined,
          },
        },
      )
      setData(response)
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        setErrorMessage(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not load follow-up templates.",
        )
      } else {
        setErrorMessage("Could not load follow-up templates.")
      }
    } finally {
      setIsLoading(false)
    }
  }, [initialServiceId, page, pageSize, search, tenantId])

  useEffect(() => {
    void load()
  }, [load])

  const totalTemplates = data?.pagination.total ?? 0
  const totalPages = data?.pagination.totalPages ?? 1
  const items = useMemo(() => data?.items ?? [], [data?.items])
  const publishedTemplates = useMemo(
    () => items.filter((item) => item.isPublished).length,
    [items],
  )
  const servicesCount = useMemo(
    () => new Set(items.map((item) => item.serviceId)).size,
    [items],
  )

  const summaryLabel = useMemo(() => {
    if (!items.length) return "No services found"

    const start = (page - 1) * pageSize + 1
    const end = start + items.length - 1
    return `Showing ${start}-${end} of ${totalTemplates} templates`
  }, [items.length, page, pageSize, totalTemplates])

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_45%,#fff7ed_100%)]">
        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1.3fr)_360px] lg:p-7">
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                Follow-Ups
              </p>
              <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-slate-950">
                See which services already have follow-up templates configured.
              </h2>
              <p className="max-w-2xl text-sm leading-6 text-slate-600">
                This page stays focused on service coverage. Open the service detail when you need
                to build or edit the template flow.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                  Services
                </p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">{servicesCount}</p>
                <p className="mt-1 text-sm text-slate-500">{summaryLabel}</p>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                  Templates
                </p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">{totalTemplates}</p>
                <p className="mt-1 text-sm text-slate-500">Templates in the current view.</p>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                  Published
                </p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">{publishedTemplates}</p>
                <p className="mt-1 text-sm text-slate-500">Ready for service enrollments.</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-[24px] border border-slate-300/60 bg-slate-950 p-5 text-white shadow-sm">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-200/90">
                Coverage
              </p>
              <p className="text-sm leading-6 text-slate-300">
                Review template coverage across services, then open the exact service detail to
                manage the flow builder.
              </p>
            </div>

            <div className="mt-6 space-y-3">
              <Button asChild type="button" className="w-full bg-white text-slate-950 hover:bg-slate-100">
                <Link href={`/app/${tenantSlug}/account-settings/services`}>Go to services</Link>
              </Button>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
                Draft templates stay visible here so your team can see what still needs to be
                published.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-5 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-slate-900">Follow-up templates</h3>
            <p className="text-sm text-slate-500">Each row opens the builder for that template.</p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(1)
              }}
              placeholder="Search services"
              className="sm:w-64"
            />
            <Select
              value={String(pageSize)}
              onValueChange={(value) => {
                setPageSize(Number(value) as (typeof PAGE_SIZE_OPTIONS)[number])
                setPage(1)
              }}
            >
              <SelectTrigger className="w-full cursor-pointer sm:w-[130px]">
                <SelectValue placeholder="Page size" />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value} per page
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="min-h-0 overflow-x-auto px-5 py-4">
          <Table>
            <TableHeader>
                <TableRow>
                  <TableHead className="w-16">#</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Follow-Up Name</TableHead>
                <TableHead className="w-32">Template</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-40 text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-28 text-center text-sm text-slate-500">
                    Loading follow-up templates...
                  </TableCell>
                </TableRow>
              ) : errorMessage ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-28 text-center text-sm text-rose-600">
                    {errorMessage}
                  </TableCell>
                </TableRow>
              ) : items.length ? (
                items.map((row, index) => (
                  <TableRow
                    key={row.id}
                    className={cn(
                      "cursor-pointer",
                      row.serviceId === initialServiceId && "bg-sky-50/70",
                    )}
                    onClick={() =>
                      router.push(
                        `/app/${tenantSlug}/account-settings/services/${row.serviceId}/follow-up-templates/${row.id}`,
                      )
                    }
                  >
                    <TableCell className="font-medium text-slate-500">
                      {(page - 1) * pageSize + index + 1}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium text-slate-900">{row.serviceName}</p>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <Route className="h-3.5 w-3.5" />
                          <span>Belongs to this service</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium text-slate-900">
                          {row.name?.trim() || "Untitled template"}
                        </p>
                        <p className="text-xs text-slate-500">Template builder</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <TemplateStateBadge isPublished={row.isPublished} />
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
                          row.serviceIsActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600",
                        )}
                      >
                        {row.serviceIsActive ? "Active" : "Inactive"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        asChild
                        type="button"
                        size="sm"
                        variant="outline"
                        className="cursor-pointer"
                      >
                        <Link
                          href={`/app/${tenantSlug}/account-settings/services/${row.serviceId}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          Open service
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="h-28 text-center">
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-slate-900">No services found</p>
                      <p className="text-sm text-slate-500">
                        Create a service first, then add one or more follow-up templates to it.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-500">{summaryLabel}</p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="cursor-pointer"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1}
            >
              Previous
            </Button>
            <span className="text-sm text-slate-500">
              Page {page} of {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="cursor-pointer"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page >= totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
            <Layers3 className="h-3.5 w-3.5" />
            Service coverage
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Published visibility
          </span>
        </div>
      </section>
    </div>
  )
}
