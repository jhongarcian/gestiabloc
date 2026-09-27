"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { isAxiosError } from "axios"
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
  Phone,
  RefreshCw,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"
import { formatDateTimeForDisplay } from "@/lib/date-time"
import { formatPhoneNumber } from "@/lib/format-phone-number"
import { cn } from "@/lib/utils"
import { waitingRunCountdown } from "@/lib/automation-waiting-runs"

import type { AutomationWaitingRun } from "./automation-types"

const PAGE_SIZE = 10

const COMPACT_SECONDARY_BUTTON_CLASS =
  "h-8 shrink-0 cursor-pointer rounded-full border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"

const COMPACT_REMOVE_BUTTON_CLASS =
  "h-8 shrink-0 cursor-pointer rounded-full border-rose-200 bg-white px-3 py-1 text-xs font-semibold text-rose-700 shadow-sm transition hover:bg-rose-50 hover:text-rose-800 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"

type WaitingRunsResponse = {
  ok: boolean
  items: AutomationWaitingRun[]
  pagination: {
    page: number
    pageSize: 10
    total: number
    totalPages: number
  }
}

function apiMessage(error: unknown, fallback: string) {
  if (!isAxiosError(error)) return fallback
  const message = (error.response?.data as { message?: unknown } | undefined)?.message
  return typeof message === "string" && message.trim() ? message : fallback
}

export function AutomationWaitingRunsSheet({
  open,
  onOpenChange,
  tenantId,
  automationId,
  nodeKey,
  timezone,
  onCountChange,
  onRefreshCounts,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenantId: string
  automationId: string
  nodeKey: string
  timezone?: string | null
  onCountChange: (nodeKey: string, count: number) => void
  onRefreshCounts: () => Promise<void>
}) {
  const [items, setItems] = useState<AutomationWaitingRun[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [removeTarget, setRemoveTarget] = useState<AutomationWaitingRun | null>(null)
  const [removingRunId, setRemovingRunId] = useState<string | null>(null)

  const loadRuns = useCallback(async () => {
    if (!open) return
    setIsLoading(true)
    setLoadFailed(false)
    try {
      const { data } = await api.get<WaitingRunsResponse>(
        `/api/account-settings/${tenantId}/automations/${automationId}/wait-nodes/${nodeKey}/waiting-runs`,
        { params: { page } },
      )
      setItems(data.items)
      setPage(data.pagination.page)
      setTotal(data.pagination.total)
      setTotalPages(data.pagination.totalPages)
      onCountChange(nodeKey, data.pagination.total)
    } catch {
      setItems([])
      setTotal(0)
      setTotalPages(1)
      setLoadFailed(true)
    } finally {
      setIsLoading(false)
    }
  }, [automationId, nodeKey, onCountChange, open, page, tenantId])

  useEffect(() => {
    if (!open) return
    void loadRuns()
  }, [loadRuns, open])

  useEffect(() => {
    if (!open) return
    setNowMs(Date.now())
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 15_000)
    return () => window.clearInterval(intervalId)
  }, [open])

  const visiblePages = useMemo(() => {
    const count = Math.min(5, totalPages)
    const first = Math.max(1, Math.min(page - 2, totalPages - count + 1))
    return Array.from({ length: count }, (_, index) => first + index)
  }, [page, totalPages])
  const firstResult = total ? (page - 1) * PAGE_SIZE + 1 : 0
  const lastResult = total ? firstResult + items.length - 1 : 0
  const timezoneLabel = timezone?.trim() || "America/Chicago"

  const refresh = async () => {
    await Promise.all([loadRuns(), onRefreshCounts()])
  }

  const removeRun = async () => {
    if (!removeTarget) return
    setRemovingRunId(removeTarget.runId)
    try {
      await api.delete(
        `/api/account-settings/${tenantId}/automations/${automationId}/wait-nodes/${nodeKey}/waiting-runs/${removeTarget.runId}`,
      )
      toast.success(`${removeTarget.contact.name} was removed from this automation run.`)
      setRemoveTarget(null)
      await Promise.all([loadRuns(), onRefreshCounts()])
    } catch (error) {
      toast.error(apiMessage(error, "Could not remove this contact from the automation run."))
      if (isAxiosError(error) && error.response?.status === 409) {
        setRemoveTarget(null)
        await Promise.all([loadRuns(), onRefreshCounts()])
      }
    } finally {
      setRemovingRunId(null)
    }
  }

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && removingRunId) return
          if (!nextOpen) {
            setPage(1)
            setRemoveTarget(null)
          }
          onOpenChange(nextOpen)
        }}
      >
        <SheetContent side="right" className="flex h-full w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <SheetHeader className="relative shrink-0 border-b border-blue-100 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_58%,#fff7ed_100%)] px-6 py-5 pr-14 text-left">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <SheetTitle className="text-lg font-semibold text-slate-950">Contacts waiting</SheetTitle>
                  <Badge variant="outline" className="rounded-full border-blue-200 bg-white/80 text-blue-950">
                    {isLoading ? "…" : loadFailed ? "!" : total}
                  </Badge>
                </div>
                <SheetDescription className="mt-1 text-xs leading-5 text-slate-600">
                  Each active run is listed separately. Times shown in {timezoneLabel}.
                </SheetDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                className={COMPACT_SECONDARY_BUTTON_CLASS}
                onClick={() => void refresh()}
                disabled={isLoading || Boolean(removingRunId)}
              >
                <RefreshCw data-icon="inline-start" className={isLoading ? "animate-spin" : undefined} aria-hidden="true" />
                Refresh
              </Button>
            </div>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-slate-50/50 p-4 [scrollbar-gutter:stable]">
            {isLoading ? (
              Array.from({ length: 4 }, (_, index) => (
                <Card key={`waiting-run-skeleton-${index}`} className="gap-4 rounded-2xl border-slate-200 bg-white py-4">
                  <CardHeader className="px-4">
                    <Skeleton className="h-5 w-2/3" />
                    <CardAction><Skeleton className="h-6 w-28 rounded-full" /></CardAction>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-3 px-4">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </CardContent>
                  <Separator />
                  <CardFooter className="justify-end px-4"><Skeleton className="h-8 w-20 rounded-full" /></CardFooter>
                </Card>
              ))
            ) : loadFailed ? (
              <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-2xl border border-rose-200 bg-white p-6 text-center">
                <p className="text-sm font-medium text-rose-700">Could not load the contacts waiting here.</p>
                <Button type="button" variant="outline" className={COMPACT_SECONDARY_BUTTON_CLASS} onClick={() => void refresh()}>
                  Try again
                </Button>
              </div>
            ) : items.length ? (
              items.map((item) => {
                const countdown = waitingRunCountdown(item.nextActionAt, nowMs)
                const isDue = countdown === "Due now"
                const isUnavailable = countdown === "Schedule unavailable"
                return (
                  <Card key={item.runId} className="gap-4 rounded-2xl border-slate-200 bg-white py-4 shadow-sm">
                    <CardHeader className="min-w-0 gap-1 px-4">
                      <CardTitle className="truncate text-base text-slate-950" title={item.contact.name}>
                        {item.contact.name}
                      </CardTitle>
                      <CardDescription className="flex items-center gap-1.5 text-xs text-slate-500">
                        <Phone className="size-3.5" aria-hidden="true" />
                        <span>{formatPhoneNumber(item.contact.phoneNumber)}</span>
                      </CardDescription>
                      <CardAction>
                        <Badge
                          variant="outline"
                          className={cn(
                            "rounded-full px-2.5 py-1 text-xs font-semibold",
                            isDue
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : isUnavailable
                                ? "border-rose-200 bg-rose-50 text-rose-700"
                                : "border-blue-200 bg-blue-50 text-blue-700",
                          )}
                        >
                          {countdown}
                        </Badge>
                      </CardAction>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 gap-3 px-4">
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs font-medium text-slate-500">Entered wait</p>
                        <time dateTime={item.enteredAt} className="mt-1 block text-sm leading-5 text-slate-800">
                          {formatDateTimeForDisplay(item.enteredAt, timezone)}
                        </time>
                      </div>
                      <div className="rounded-xl bg-blue-50/70 p-3">
                        <p className="flex items-center gap-1.5 text-xs font-medium text-blue-700">
                          <Clock3 className="size-3.5" aria-hidden="true" /> Next action
                        </p>
                        <time dateTime={item.nextActionAt ?? undefined} className="mt-1 block text-sm leading-5 text-slate-800">
                          {formatDateTimeForDisplay(item.nextActionAt, timezone)}
                        </time>
                      </div>
                    </CardContent>
                    <Separator />
                    <CardFooter className="justify-end px-4">
                      <Button
                        type="button"
                        variant="outline"
                        className={COMPACT_REMOVE_BUTTON_CLASS}
                        disabled={Boolean(removingRunId)}
                        onClick={() => setRemoveTarget(item)}
                      >
                        {removingRunId === item.runId
                          ? <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" />
                          : <Trash2 data-icon="inline-start" aria-hidden="true" />}
                        {removingRunId === item.runId ? "Removing" : "Remove"}
                      </Button>
                    </CardFooter>
                  </Card>
                )
              })
            ) : (
              <div className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
                <Clock3 className="mb-3 size-8 text-slate-400" aria-hidden="true" />
                <p className="text-sm font-semibold text-slate-900">No contacts are waiting here</p>
                <p className="mt-1 max-w-xs text-xs leading-5 text-slate-500">New qualifying runs will appear after they reach this Wait action.</p>
              </div>
            )}
          </div>

          <footer className="flex shrink-0 flex-col gap-3 border-t border-slate-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            {isLoading ? (
              <Skeleton className="h-4 w-44" />
            ) : (
              <p className="text-xs text-slate-500">
                {total ? `Showing ${firstResult}-${lastResult} of ${total} waiting runs` : "No waiting runs"}
              </p>
            )}
            <nav className="flex items-center gap-1.5 self-end sm:self-auto" aria-label="Waiting runs pagination">
              <Button type="button" variant="outline" size="icon-sm" aria-label="Previous page" disabled={page <= 1 || isLoading || Boolean(removingRunId)} onClick={() => setPage((current) => Math.max(1, current - 1))}>
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
                  disabled={isLoading || Boolean(removingRunId) || pageNumber === page}
                  className={pageNumber === page ? "bg-blue-950 text-white hover:bg-blue-900 disabled:opacity-100" : undefined}
                  onClick={() => setPage(pageNumber)}
                >
                  {pageNumber}
                </Button>
              ))}
              <Button type="button" variant="outline" size="icon-sm" aria-label="Next page" disabled={page >= totalPages || isLoading || Boolean(removingRunId)} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
                <ChevronRight />
              </Button>
            </nav>
          </footer>
        </SheetContent>
      </Sheet>

      <Dialog
        open={Boolean(removeTarget)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !removingRunId) setRemoveTarget(null)
        }}
      >
        <DialogContent showCloseButton={!removingRunId} className="rounded-2xl border-slate-200 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {removeTarget?.contact.name ?? "this contact"} from this run?</DialogTitle>
            <DialogDescription className="leading-6">
              This ends only this waiting run and skips every remaining action. Other parallel runs are not affected. The contact stays in your account and can enter this automation again from a future trigger.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" className={COMPACT_SECONDARY_BUTTON_CLASS} disabled={Boolean(removingRunId)} onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" className="h-8 shrink-0 cursor-pointer rounded-full px-3 py-1 text-xs font-semibold shadow-sm disabled:cursor-not-allowed" disabled={Boolean(removingRunId)} onClick={() => void removeRun()}>
              {removingRunId ? <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : null}
              {removingRunId ? "Removing" : "Remove from automation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
