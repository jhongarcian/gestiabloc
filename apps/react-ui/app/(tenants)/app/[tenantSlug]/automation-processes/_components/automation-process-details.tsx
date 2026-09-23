"use client"

import { ArrowLeft, ChevronLeft, ChevronRight, CircleCheck, CircleX, RotateCw, Users } from "lucide-react"
import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import {
  ACTIVE_AUTOMATION_PROCESS_STATUSES,
  automationProcessPercent,
  type AutomationProcessDetail,
} from "../../_lib/automation-processes"
import { ProcessStatusBadge } from "./process-status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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

type FailedContact = {
  id: string
  contactId: string
  contactName: string
  errorCode: string | null
  errorMessage: string | null
  completedAt: string | null
}

type DetailResponse = {
  process: AutomationProcessDetail
  failedContacts: FailedContact[]
  failedPagination: { page: number; pageSize: number; total: number; totalPages: number }
}

function formatDate(value: string | null) {
  if (!value) return "—"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function BatchStatus({ status }: { status: AutomationProcessDetail["batches"][number]["status"] }) {
  const label = status === "COMPLETED_WITH_ERRORS"
    ? "Completed with errors"
    : status.charAt(0) + status.slice(1).toLowerCase()
  return (
    <Badge
      variant="outline"
      className={
        status === "COMPLETED"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : status === "COMPLETED_WITH_ERRORS"
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-blue-200 bg-blue-50 text-blue-700"
      }
    >
      {label}
    </Badge>
  )
}

export function AutomationProcessDetails({
  tenantId,
  tenantSlug,
  processId,
}: {
  tenantId: string
  tenantSlug: string
  processId: string
}) {
  const [process, setProcess] = useState<AutomationProcessDetail | null>(null)
  const [failedContacts, setFailedContacts] = useState<FailedContact[]>([])
  const [failedPage, setFailedPage] = useState(1)
  const [failedPagination, setFailedPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const { data } = await api.get<DetailResponse>(
        `/api/automation-processes/${encodeURIComponent(tenantId)}/${encodeURIComponent(processId)}`,
        { params: { failedPage, failedPageSize: 25 } },
      )
      setProcess(data.process)
      setFailedContacts(data.failedContacts)
      setFailedPagination(data.failedPagination)
    } catch {
      if (!quiet) toast.error("Could not load this automation process.")
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [failedPage, processId, tenantId])

  useEffect(() => {
    void load()
  }, [load])

  const processStatus = process?.status ?? null

  useEffect(() => {
    if (!processStatus || !ACTIVE_AUTOMATION_PROCESS_STATUSES.has(processStatus)) return
    const interval = window.setInterval(() => void load(true), 2_000)
    return () => window.clearInterval(interval)
  }, [load, processStatus])

  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-48 w-full rounded-[26px]" />
        <div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((item) => <Skeleton key={item} className="h-28 rounded-2xl" />)}</div>
      </div>
    )
  }

  if (!process) {
    return (
      <div className="flex min-h-80 flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-slate-50 text-center">
        <h1 className="text-lg font-semibold text-slate-950">Process not available</h1>
        <Button asChild variant="outline" className="mt-4 rounded-full"><Link href={`/app/${tenantSlug}/automation-processes`}>Back to history</Link></Button>
      </div>
    )
  }

  const percent = automationProcessPercent(process)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <Button asChild variant="ghost" className="w-fit rounded-full px-3 text-slate-600">
        <Link href={`/app/${tenantSlug}/automation-processes`}><ArrowLeft data-icon="inline-start" aria-hidden="true" /> Process history</Link>
      </Button>

      <section className="overflow-hidden rounded-[26px] border border-slate-200 bg-[linear-gradient(120deg,#07111f_0%,#12233e_58%,#1d4ed8_150%)] text-white shadow-sm">
        <div className="p-6 sm:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-blue-200">{process.automationName}</p>
              <h1 className="mt-2 truncate text-2xl font-semibold sm:text-3xl">{process.processName}</h1>
              <p className="mt-2 text-sm text-slate-300">Started by {process.requestedByName} · {formatDate(process.createdAt)}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ProcessStatusBadge status={process.status} className="border-white/20 bg-white/10 text-white" />
              <Button type="button" size="icon" variant="outline" className="rounded-full border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white" aria-label="Refresh progress" onClick={() => void load()}>
                <RotateCw aria-hidden="true" />
              </Button>
            </div>
          </div>

          <div className="mt-7">
            <div className="mb-2 flex items-center justify-between text-sm text-blue-100">
              <span>{process.processedContacts.toLocaleString()} of {process.expectedContacts.toLocaleString()} contacts enrolled</span>
              <span className="font-semibold text-white">{percent}%</span>
            </div>
            <Progress value={percent} className="h-3 bg-white/15 [&_[data-slot=progress-indicator]]:bg-cyan-300" aria-label={`${percent}% complete`} />
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="gap-0 border-slate-200 py-0"><CardContent className="flex items-center gap-4 p-5"><div className="flex size-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Users aria-hidden="true" /></div><div><p className="text-2xl font-semibold text-slate-950">{process.expectedContacts.toLocaleString()}</p><p className="text-xs text-slate-500">Total contacts</p></div></CardContent></Card>
        <Card className="gap-0 border-slate-200 py-0"><CardContent className="flex items-center gap-4 p-5"><div className="flex size-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><CircleCheck aria-hidden="true" /></div><div><p className="text-2xl font-semibold text-slate-950">{process.succeededContacts.toLocaleString()}</p><p className="text-xs text-slate-500">Enrolled</p></div></CardContent></Card>
        <Card className="gap-0 border-slate-200 py-0"><CardContent className="flex items-center gap-4 p-5"><div className="flex size-11 items-center justify-center rounded-xl bg-rose-50 text-rose-700"><CircleX aria-hidden="true" /></div><div><p className="text-2xl font-semibold text-slate-950">{process.failedContacts.toLocaleString()}</p><p className="text-xs text-slate-500">Errors</p></div></CardContent></Card>
      </div>

      {process.lastError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{process.lastError}</div>
      ) : null}

      <Card className="gap-0 overflow-hidden border-slate-200 py-0">
        <CardHeader className="border-b border-slate-200 px-5 py-5">
          <CardTitle className="text-base">Batches</CardTitle>
          <p className="text-sm text-slate-500">Contacts are enrolled in groups of up to 100.</p>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow><TableHead className="px-5">Batch</TableHead><TableHead>Status</TableHead><TableHead>Contacts</TableHead><TableHead>Enrolled</TableHead><TableHead>Errors</TableHead><TableHead className="px-5 text-right">Finished</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {process.batches.map((batch) => (
                <TableRow key={batch.id}>
                  <TableCell className="px-5 font-semibold">#{batch.batchNumber}</TableCell>
                  <TableCell><BatchStatus status={batch.status} /></TableCell>
                  <TableCell>{batch.contactCount.toLocaleString()}</TableCell>
                  <TableCell className="text-emerald-700">{batch.succeededContacts.toLocaleString()}</TableCell>
                  <TableCell className={batch.failedContacts ? "text-rose-700" : "text-slate-500"}>{batch.failedContacts.toLocaleString()}</TableCell>
                  <TableCell className="px-5 text-right text-xs text-slate-500">{formatDate(batch.completedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {process.totalBatches > process.visibleBatchLimit ? (
            <p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">Showing the first {process.visibleBatchLimit} of {process.totalBatches.toLocaleString()} batches.</p>
          ) : null}
        </CardContent>
      </Card>

      {process.failedContacts > 0 ? (
        <Card className="gap-0 overflow-hidden border-slate-200 py-0">
          <CardHeader className="border-b border-slate-200 px-5 py-5">
            <CardTitle className="text-base">Contacts with errors</CardTitle>
            <p className="text-sm text-slate-500">Review contacts that could not be enrolled.</p>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-slate-50"><TableRow><TableHead className="px-5">Contact</TableHead><TableHead>Error</TableHead><TableHead className="px-5 text-right">Time</TableHead></TableRow></TableHeader>
              <TableBody>
                {failedContacts.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell className="px-5"><Link href={`/app/${tenantSlug}/contacts/${contact.contactId}`} className="font-semibold text-blue-800 hover:underline">{contact.contactName}</Link></TableCell>
                    <TableCell className="max-w-xl whitespace-normal text-sm text-slate-600">{contact.errorMessage ?? "The contact could not be enrolled."}</TableCell>
                    <TableCell className="px-5 text-right text-xs text-slate-500">{formatDate(contact.completedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {failedPagination.totalPages > 1 ? (
              <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
                <p className="text-xs text-slate-500">Page {failedPagination.page} of {failedPagination.totalPages}</p>
                <div className="flex gap-2">
                  <Button type="button" size="icon" variant="outline" className="rounded-full" disabled={failedPage <= 1} aria-label="Previous errors page" onClick={() => setFailedPage((current) => Math.max(1, current - 1))}><ChevronLeft aria-hidden="true" /></Button>
                  <Button type="button" size="icon" variant="outline" className="rounded-full" disabled={failedPage >= failedPagination.totalPages} aria-label="Next errors page" onClick={() => setFailedPage((current) => Math.min(failedPagination.totalPages, current + 1))}><ChevronRight aria-hidden="true" /></Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
