"use client"

import { format } from "date-fns"
import {
  ArrowRight,
  Check,
  ExternalLink,
  Pencil,
  X,
} from "lucide-react"
import { useState } from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

type OpportunityRecord = {
  id: string
  pipelineId: string
  stageId: string
  valueCents: number
  result: "OPEN" | "WON" | "LOST"
  closedAt: string | null
  updatedAt: string
  pipeline: {
    id: string
    name: string
    color: string
  }
  stage: {
    id: string
    name: string
    sortOrder: number
  }
}

type StageOption = {
  id: string
  name: string
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

function formatUsdCents(valueCents: number) {
  return currencyFormatter.format(valueCents / 100)
}

function formatDateTime(value: string) {
  return format(new Date(value), "MMM d, yyyy")
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <span className="shrink-0 text-xs text-slate-500">{label}</span>
      <div className="min-w-0 text-right">{children}</div>
    </div>
  )
}

type ContactOpportunityDetailDrawerProps = {
  opportunity: OpportunityRecord | null
  stages: StageOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onValueChange?: (opportunityId: string, newValueCents: number) => Promise<void>
}

export function ContactOpportunityDetailDrawer({
  opportunity,
  stages,
  open,
  onOpenChange,
  onValueChange,
}: ContactOpportunityDetailDrawerProps) {
  const [isEditingValue, setIsEditingValue] = useState(false)
  const [editValue, setEditValue] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  if (!opportunity) return null

  const currentStageIndex = stages.findIndex((s) => s.id === opportunity.stageId)
  const isOpen = opportunity.result === "OPEN"

  const handleStartEditValue = () => {
    setEditValue(String(opportunity.valueCents / 100))
    setIsEditingValue(true)
  }

  const handleCancelEditValue = () => {
    setIsEditingValue(false)
    setEditValue("")
  }

  const handleSaveValue = async () => {
    if (!onValueChange) return

    const parsedValue = parseFloat(editValue)
    if (isNaN(parsedValue) || parsedValue < 0) return

    const newValueCents = Math.round(parsedValue * 100)
    setIsSaving(true)
    try {
      await onValueChange(opportunity.id, newValueCents)
      setIsEditingValue(false)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-md"
        showCloseButton
      >
        <SheetHeader className="border-b border-slate-100 px-6 pb-4 pt-6 text-left">
          <div className="flex items-center gap-2">
            <span
              className="h-3 w-3 shrink-0 rounded-full border border-slate-200"
              style={{ backgroundColor: opportunity.pipeline.color }}
            />
            <SheetTitle className="text-base font-semibold text-slate-950">
              {opportunity.pipeline.name}
            </SheetTitle>
          </div>
          <SheetDescription className="text-xs text-slate-400">
            Last updated {formatDateTime(opportunity.updatedAt)}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-6 py-5">
            <div className="mt-1 divide-y divide-slate-100 border-t border-slate-100">
              <Row label="Value">
                {isEditingValue ? (
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                        $
                      </span>
                      <Input
                        type="number"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="h-8 w-28 pl-6 text-sm"
                        min="0"
                        step="0.01"
                        disabled={isSaving}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleSaveValue()
                          if (e.key === "Escape") handleCancelEditValue()
                        }}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-emerald-600 hover:text-emerald-700"
                      disabled={isSaving}
                      onClick={() => void handleSaveValue()}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-slate-400 hover:text-slate-600"
                      disabled={isSaving}
                      onClick={handleCancelEditValue}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-950">
                      {formatUsdCents(opportunity.valueCents)}
                    </span>
                    {onValueChange && isOpen && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-slate-400 hover:text-slate-600"
                        onClick={handleStartEditValue}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                )}
              </Row>

              <Row label="Status">
                {opportunity.result === "OPEN" && (
                  <Badge className="rounded-full border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-50">
                    Open
                  </Badge>
                )}
                {opportunity.result === "WON" && (
                  <Badge className="rounded-full border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50">
                    Won
                  </Badge>
                )}
                {opportunity.result === "LOST" && (
                  <Badge className="rounded-full border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 hover:bg-rose-50">
                    Lost
                  </Badge>
                )}
              </Row>

              <Row label="Current Stage">
                <span className="text-sm font-medium text-slate-900">
                  {opportunity.stage.name}
                </span>
              </Row>

              {opportunity.closedAt && (
                <Row label="Closed">
                  <span className="text-sm text-slate-700">
                    {formatDateTime(opportunity.closedAt)}
                  </span>
                </Row>
              )}
            </div>

            {/* Stage Progress */}
            {isOpen && stages.length > 0 && (
              <div className="mt-6">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 mb-3">
                  Pipeline Progress
                </p>
                <div className="flex items-center gap-1.5 overflow-x-auto">
                  {stages.map((stage, index) => {
                    const isActive = stage.id === opportunity.stageId
                    const isPast = index < currentStageIndex

                    return (
                      <div key={stage.id} className="flex items-center gap-1.5">
                        <div
                          className={cn(
                            "flex h-6 shrink-0 items-center rounded-full px-2.5 text-[11px] font-medium transition-colors",
                            isActive && "bg-slate-900 text-white",
                            isPast && "bg-slate-200 text-slate-600",
                            !isActive && !isPast && "bg-slate-50 text-slate-400",
                          )}
                        >
                          {stage.name}
                        </div>
                        {index < stages.length - 1 && (
                          <ArrowRight
                            className={cn(
                              "h-3 w-3 shrink-0",
                              isPast ? "text-slate-300" : "text-slate-200",
                            )}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Link to full view */}
            <div className="mt-6 pt-4 border-t border-slate-100">
              <a
                href={`/app/opportunities?pipelineId=${opportunity.pipelineId}`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 transition"
              >
                View in pipeline
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
