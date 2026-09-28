"use client"

import { ArrowRight, ExternalLink, Loader2, Pencil } from "lucide-react"
import Link from "next/link"
import { type FormEvent, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import type { ContactOpportunityRecord } from "../_lib/contact-opportunities"

const compactPrimaryButton =
  "h-8 shrink-0 cursor-pointer rounded-full bg-blue-950 px-3 py-1 text-xs font-semibold text-white shadow-sm ring-1 ring-black/5 transition hover:bg-blue-900 hover:text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
const compactSecondaryButton =
  "h-8 shrink-0 cursor-pointer rounded-full border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"

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

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center sm:gap-4">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="min-w-0 text-sm text-slate-900 sm:text-right">{children}</dd>
    </div>
  )
}

type ContactOpportunityDetailDrawerProps = {
  tenantSlug: string
  opportunity: ContactOpportunityRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onValueChange?: (opportunityId: string, newValueCents: number) => Promise<void>
}

export function ContactOpportunityDetailDrawer({
  tenantSlug,
  opportunity,
  open,
  onOpenChange,
  onValueChange,
}: ContactOpportunityDetailDrawerProps) {
  const [isEditingValue, setIsEditingValue] = useState(false)
  const [editValue, setEditValue] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  const stages = useMemo(
    () => [...(opportunity?.pipeline.stages ?? [])].sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
      return a.name.localeCompare(b.name)
    }),
    [opportunity?.pipeline.stages],
  )

  if (!opportunity) return null

  const currentStageIndex = stages.findIndex((stage) => stage.id === opportunity.stageId)
  const isOpen = opportunity.result === "OPEN"
  const parsedValue = Number(editValue)
  const isValueValid = editValue.trim() !== "" && Number.isFinite(parsedValue) && parsedValue >= 0
  const valueChanged = isValueValid && Math.round(parsedValue * 100) !== opportunity.valueCents

  const resetEditor = () => {
    setIsEditingValue(false)
    setEditValue("")
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isSaving) return
    if (!nextOpen) resetEditor()
    onOpenChange(nextOpen)
  }

  const handleStartEditValue = () => {
    setEditValue(String(opportunity.valueCents / 100))
    setIsEditingValue(true)
  }

  const handleSaveValue = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!onValueChange || !isValueValid || !valueChanged || isSaving) return

    setIsSaving(true)
    try {
      await onValueChange(opportunity.id, Math.round(parsedValue * 100))
      resetEditor()
    } catch {
      // The parent reports the request failure and the editor stays open for retry.
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className="flex h-full w-full flex-col gap-0 overflow-hidden border-l border-slate-200 bg-white p-0 sm:max-w-2xl [&>button]:cursor-pointer"
        onEscapeKeyDown={(event) => {
          if (isSaving) event.preventDefault()
        }}
        onPointerDownOutside={(event) => {
          if (isSaving) event.preventDefault()
        }}
      >
        <SheetHeader className="relative overflow-hidden border-b border-blue-100 bg-[#f1f7ff] px-6 py-6 text-left sm:px-7">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(30,64,175,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(30,64,175,.08)_1px,transparent_1px)] [background-size:42px_42px]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-12 -bottom-20 size-48 rounded-full bg-blue-300/30 blur-3xl"
          />

          <div className="relative pr-10">
            <div className="flex max-w-xl min-w-0 flex-col gap-1.5">
              <p className="text-xs font-semibold text-blue-700">Opportunity details</p>
              <SheetTitle className="truncate text-xl font-semibold text-slate-950 sm:text-2xl">
                {opportunity.pipeline.name}
              </SheetTitle>
              <SheetDescription className="max-w-lg text-sm leading-6 text-slate-600">
                Review the current stage, status, value, and recent activity for this opportunity.
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6 [scrollbar-gutter:stable] sm:px-7">
          <div className="flex flex-col gap-7">
            <section aria-labelledby="opportunity-overview-heading">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <h3
                    id="opportunity-overview-heading"
                    className="text-sm font-semibold text-slate-950"
                  >
                    Overview
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Last updated {formatDateTime(opportunity.updatedAt)}
                  </p>
                </div>
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-full border border-slate-200"
                    style={{ backgroundColor: opportunity.pipeline.color }}
                    aria-hidden="true"
                  />
                  <span className="truncate text-xs font-medium text-slate-600">
                    {opportunity.pipeline.name}
                  </span>
                </span>
              </div>

              <dl className="mt-4 divide-y divide-slate-100 border-y border-slate-100">
                <DetailRow label="Value">
                  {isEditingValue ? (
                    <form
                      className="flex flex-col items-stretch gap-2 sm:items-end"
                      onSubmit={handleSaveValue}
                    >
                      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
                        <div className="relative min-w-0">
                          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">
                            $
                          </span>
                          <Input
                            type="number"
                            value={editValue}
                            onChange={(event) => setEditValue(event.target.value)}
                            aria-label="Opportunity value"
                            aria-invalid={editValue.trim() !== "" && !isValueValid}
                            className="h-8 min-w-0 rounded-full border-slate-200 bg-white pr-3 pl-7 text-sm shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
                            min="0"
                            step="0.01"
                            disabled={isSaving}
                            autoFocus
                            onKeyDown={(event) => {
                              if (event.key === "Escape") resetEditor()
                            }}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className={compactSecondaryButton}
                          disabled={isSaving}
                          onClick={resetEditor}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="submit"
                          variant="ghost"
                          className={compactPrimaryButton}
                          disabled={!valueChanged || isSaving}
                        >
                          {isSaving ? (
                            <Loader2
                              data-icon="inline-start"
                              className="animate-spin"
                              aria-hidden="true"
                            />
                          ) : null}
                          {isSaving ? "Saving" : "Save value"}
                        </Button>
                      </div>
                      {editValue.trim() !== "" && !isValueValid ? (
                        <p className="text-xs text-rose-700">Enter a value of zero or more.</p>
                      ) : null}
                    </form>
                  ) : (
                    <span className="inline-flex flex-wrap items-center justify-end gap-2">
                      <span className="font-semibold text-slate-950">
                        {formatUsdCents(opportunity.valueCents)}
                      </span>
                      {onValueChange && isOpen ? (
                        <Button
                          type="button"
                          variant="outline"
                          className={compactSecondaryButton}
                          onClick={handleStartEditValue}
                        >
                          <Pencil data-icon="inline-start" aria-hidden="true" />
                          Edit value
                        </Button>
                      ) : null}
                    </span>
                  )}
                </DetailRow>

                <DetailRow label="Status">
                  <ResultBadge result={opportunity.result} />
                </DetailRow>

                <DetailRow label="Current stage">
                  <span className="font-medium">{opportunity.stage.name}</span>
                </DetailRow>

                <DetailRow label="Last updated">
                  {formatDateTime(opportunity.updatedAt)}
                </DetailRow>

                {opportunity.closedAt ? (
                  <DetailRow label="Closed">{formatDateTime(opportunity.closedAt)}</DetailRow>
                ) : null}
              </dl>
            </section>

            {stages.length > 0 ? (
              <section
                aria-labelledby="pipeline-progress-heading"
                className="flex flex-col gap-4 border-t border-slate-200 pt-6"
              >
                <div>
                  <h3
                    id="pipeline-progress-heading"
                    className="text-sm font-semibold text-slate-950"
                  >
                    Pipeline progress
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {isOpen
                      ? "See where this opportunity sits in the pipeline."
                      : "This opportunity is closed at the stage shown below."}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 overflow-x-auto pb-2">
                  {stages.map((stage, index) => {
                    const isActive = stage.id === opportunity.stageId
                    const isPast = currentStageIndex >= 0 && index < currentStageIndex

                    return (
                      <div key={stage.id} className="flex shrink-0 items-center gap-1.5">
                        <span
                          className={cn(
                            "flex h-8 items-center rounded-full border px-3 text-xs font-semibold",
                            isActive && "border-blue-950 bg-blue-950 text-white",
                            isPast && "border-blue-100 bg-blue-50 text-blue-800",
                            !isActive && !isPast &&
                              "border-slate-200 bg-slate-50 text-slate-500",
                          )}
                        >
                          {stage.name}
                        </span>
                        {index < stages.length - 1 ? (
                          <ArrowRight
                            className={cn(
                              "size-3.5 shrink-0",
                              isPast ? "text-blue-300" : "text-slate-300",
                            )}
                            aria-hidden="true"
                          />
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </section>
            ) : null}
          </div>
        </div>

        <SheetFooter className="border-t border-slate-200 bg-slate-50/80 px-6 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-7">
          <Button
            type="button"
            variant="outline"
            className={compactSecondaryButton}
            disabled={isSaving}
            onClick={() => handleOpenChange(false)}
          >
            Close
          </Button>
          <Button
            asChild
            variant="outline"
            className={cn(
              compactSecondaryButton,
              isSaving && "pointer-events-none opacity-50",
            )}
          >
            <Link
              href={`/app/${tenantSlug}/opportunities?pipelineId=${encodeURIComponent(opportunity.pipelineId)}`}
              aria-disabled={isSaving}
              tabIndex={isSaving ? -1 : undefined}
            >
              View in pipeline
              <ExternalLink data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
