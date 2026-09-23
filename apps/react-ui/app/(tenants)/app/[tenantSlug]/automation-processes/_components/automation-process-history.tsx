"use client"

import { ChevronLeft, ChevronRight, History, Workflow } from "lucide-react"
import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import {
  ACTIVE_AUTOMATION_PROCESS_STATUSES,
  automationProcessPercent,
  type AutomationProcess,
} from "../../_lib/automation-processes"
import { ProcessStatusBadge } from "./process-status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
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

type ProcessHistoryResponse = {
  items: AutomationProcess[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function ProcessProgress({ process }: { process: AutomationProcess }) {
  const percent = automationProcessPercent(process)
  return (
    <div className="min-w-36 space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
        <span>{process.processedContacts.toLocaleString()} / {process.expectedContacts.toLocaleString()}</span>
        <span className="font-semibold text-slate-700">{percent}%</span>
      </div>
      <Progress value={percent} className="h-1.5 bg-blue-100 [&_[data-slot=progress-indicator]]:bg-blue-700" />
    </div>
  )
}

export function AutomationProcessHistory({
  tenantId,
  tenantSlug,
}: {
  tenantId: string
  tenantSlug: string
}) {
  const [items, setItems] = useState<AutomationProcess[]>([])
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const { data } = await api.get<ProcessHistoryResponse>(
        `/api/automation-processes/${encodeURIComponent(tenantId)}`,
        { params: { page, pageSize: 25 } },
      )
      setItems(data.items)
      setPagination(data.pagination)
    } catch {
      if (!quiet) toast.error("Could not load automation process history.")
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [page, tenantId])

  useEffect(() => {
    void load()
  }, [load])

  const hasActiveProcesses = useMemo(
    () => items.some((item) => ACTIVE_AUTOMATION_PROCESS_STATUSES.has(item.status)),
    [items],
  )

  useEffect(() => {
    if (!hasActiveProcesses) return
    const interval = window.setInterval(() => void load(true), 3_000)
    return () => window.clearInterval(interval)
  }, [hasActiveProcesses, load])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <section className="overflow-hidden rounded-[26px] border border-slate-200 bg-[linear-gradient(120deg,#07111f_0%,#12233e_58%,#1d4ed8_150%)] text-white shadow-sm">
        <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-blue-200">
              <History className="size-4" aria-hidden="true" /> Account activity
            </div>
            <h1 className="text-2xl font-semibold">Automation processes</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              Track contact enrollment processes for automations in this account.
            </p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
            <p className="text-xs text-blue-100">Processes recorded</p>
            <p className="mt-1 text-2xl font-semibold">{pagination.total.toLocaleString()}</p>
          </div>
        </div>
      </section>

      {loading ? (
        <Card className="gap-0 overflow-hidden py-0">
          <CardContent className="space-y-4 p-5">
            {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-16 w-full rounded-xl" />)}
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <div className="flex min-h-80 flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-6 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-blue-950 text-white">
            <Workflow className="size-6" aria-hidden="true" />
          </div>
          <h2 className="mt-5 text-lg font-semibold text-slate-950">No processes yet</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">
            Select contacts from the contact list and add them to an automation. The enrollment will appear here.
          </p>
          <Button asChild className="mt-5 rounded-full bg-blue-950 hover:bg-blue-900">
            <Link href={`/app/${tenantSlug}/contacts`}>Open contacts</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm md:block">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="px-5">Process</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Results</TableHead>
                  <TableHead>Started by</TableHead>
                  <TableHead className="px-5 text-right">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((process) => (
                  <TableRow key={process.id} className="group">
                    <TableCell className="px-5 py-4">
                      <Link href={`/app/${tenantSlug}/automation-processes/${process.id}`} className="block max-w-64">
                        <span className="block truncate font-semibold text-slate-950 group-hover:text-blue-800">{process.processName}</span>
                        <span className="mt-1 block truncate text-xs text-slate-500">{process.automationName}</span>
                      </Link>
                    </TableCell>
                    <TableCell><ProcessStatusBadge status={process.status} /></TableCell>
                    <TableCell><ProcessProgress process={process} /></TableCell>
                    <TableCell>
                      <span className="font-semibold text-emerald-700">{process.succeededContacts.toLocaleString()} enrolled</span>
                      <span className="mx-1.5 text-slate-300">/</span>
                      <span className={process.failedContacts ? "font-semibold text-rose-700" : "text-slate-500"}>{process.failedContacts.toLocaleString()} errors</span>
                    </TableCell>
                    <TableCell className="max-w-40 truncate text-slate-600">{process.requestedByName}</TableCell>
                    <TableCell className="px-5 text-right text-xs text-slate-500">{formatDate(process.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="grid gap-3 md:hidden">
            {items.map((process) => (
              <Link key={process.id} href={`/app/${tenantSlug}/automation-processes/${process.id}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-200">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-950">{process.processName}</p>
                    <p className="mt-1 truncate text-xs text-slate-500">{process.automationName}</p>
                  </div>
                  <ProcessStatusBadge status={process.status} />
                </div>
                <div className="mt-4"><ProcessProgress process={process} /></div>
                <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                  <span>{process.succeededContacts.toLocaleString()} enrolled · {process.failedContacts.toLocaleString()} errors</span>
                  <span>{formatDate(process.createdAt)}</span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      {!loading && pagination.totalPages > 1 ? (
        <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-sm text-slate-500">Page {pagination.page} of {pagination.totalPages}</p>
          <div className="flex gap-2">
            <Button type="button" size="icon" variant="outline" className="rounded-full" disabled={page <= 1} aria-label="Previous page" onClick={() => setPage((current) => Math.max(1, current - 1))}>
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Button type="button" size="icon" variant="outline" className="rounded-full" disabled={page >= pagination.totalPages} aria-label="Next page" onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}>
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
