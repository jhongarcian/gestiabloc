"use client"

import { format } from "date-fns"
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Pencil,
  X,
  XCircle,
} from "lucide-react"
import { useState } from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

type OpportunityCardRecord = {
  id: string
  tenantId: string
  contactId: string
  pipelineId: string
  stageId: string
  valueCents: number
  result: "OPEN" | "WON" | "LOST"
  closedAt: string | null
  createdAt: string
  updatedAt: string
  contact: {
    id: string
    fullName: string
    email: string | null
    phoneNumber: string | null
  }
  assignedTo: {
    userId: string
    name: string
    email: string
    image: string | null
  } | null
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

function getInitials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

function formatUsdCents(valueCents: number) {
  return currencyFormatter.format(valueCents / 100)
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <span className="shrink-0 text-xs text-slate-500">{label}</span>
      <div className="min-w-0 text-right">{children}</div>
    </div>
  )
}

type OpportunityDetailDrawerProps = {
  opportunity: OpportunityCardRecord
  tenantSlug: string
  stages: StageOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onStageChange: (opportunityId: string, targetStageId: string) => Promise<void>
  onCloseOpportunity: (opportunityId: string, result: "WON" | "LOST") => Promise<void>
  onValueChange?: (opportunityId: string, newValueCents: number) => Promise<void>
}

export function OpportunityDetailDrawer({
  opportunity,
  tenantSlug,
  stages,
  open,
  onOpenChange,
  onStageChange,
  onCloseOpportunity,
  onValueChange,
}: OpportunityDetailDrawerProps) {
  const [isMovingStage, setIsMovingStage] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [isEditingValue, setIsEditingValue] = useState(false)
  const [editValue, setEditValue] = useState("")
  const [isSavingValue, setIsSavingValue] = useState(false)

  const handleStageChange = async (targetStageId: string) => {
    if (targetStageId === opportunity.stageId) return

    setIsMovingStage(true)
    try {
      await onStageChange(opportunity.id, targetStageId)
    } finally {
      setIsMovingStage(false)
    }
  }

  const handleClose = async (result: "WON" | "LOST") => {
    setIsClosing(true)
    try {
      await onCloseOpportunity(opportunity.id, result)
      onOpenChange(false)
    } finally {
      setIsClosing(false)
    }
  }

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
    setIsSavingValue(true)
    try {
      await onValueChange(opportunity.id, newValueCents)
      setIsEditingValue(false)
    } finally {
      setIsSavingValue(false)
    }
  }

  const currentStageIndex = stages.findIndex((s) => s.id === opportunity.stageId)
  const currentStageName = currentStageIndex >= 0 ? stages[currentStageIndex].name : "Unknown"
  const isOpen = opportunity.result === "OPEN"

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-md"
        showCloseButton
      >
        <SheetHeader className="border-b border-slate-100 px-6 pb-4 pt-6 text-left">
          <SheetTitle className="text-base font-semibold text-slate-950">
            Opportunity
          </SheetTitle>
          <SheetDescription className="text-xs text-slate-400">
            Created {format(new Date(opportunity.createdAt), "MMM d, yyyy")}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-6 py-5">
            <a
              href={`/app/${tenantSlug}/contacts/${opportunity.contact.id}/overview`}
              className="group inline-flex items-center gap-1.5 text-sm font-semibold text-slate-950 transition hover:text-blue-600"
            >
              {opportunity.contact.fullName}
              <ExternalLink className="h-3 w-3 text-slate-400 transition group-hover:text-blue-500" />
            </a>
            <p className="mt-0.5 text-xs text-slate-400">
              {opportunity.contact.email ?? opportunity.contact.phoneNumber ?? "No contact details"}
            </p>

            <div className="mt-5 divide-y divide-slate-100 border-t border-slate-100">
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
                        disabled={isSavingValue}
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
                      disabled={isSavingValue}
                      onClick={() => void handleSaveValue()}
                    >
                      {isSavingValue ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-slate-400 hover:text-slate-600"
                      disabled={isSavingValue}
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

              <Row label="Assigned to">
                {opportunity.assignedTo ? (
                  <div className="inline-flex items-center gap-2">
                    <Avatar className="h-5 w-5">
                      <AvatarImage
                        src={opportunity.assignedTo.image ?? undefined}
                        alt={opportunity.assignedTo.name}
                      />
                      <AvatarFallback className="bg-slate-100 text-[9px] font-medium text-slate-600">
                        {getInitials(opportunity.assignedTo.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm text-slate-700">
                      {opportunity.assignedTo.name}
                    </span>
                  </div>
                ) : (
                  <span className="text-sm text-slate-400">Unassigned</span>
                )}
              </Row>
            </div>

            {isOpen ? (
              <div className="mt-6 space-y-5">
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

                <Select
                  value={opportunity.stageId}
                  onValueChange={(value) => void handleStageChange(value)}
                  disabled={isMovingStage}
                >
                  <SelectTrigger className="h-9 w-full rounded-lg border-slate-200 text-sm">
                    <SelectValue>
                      <div className="flex items-center gap-2">
                        {isMovingStage && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                        <span>{currentStageName}</span>
                      </div>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent
                    position="popper"
                    side="bottom"
                    align="start"
                    sideOffset={4}
                    className="rounded-lg border-slate-200"
                  >
                    {stages.map((stage) => (
                      <SelectItem key={stage.id} value={stage.id}>
                        {stage.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={isClosing}
                    onClick={() => void handleClose("WON")}
                    className={cn(
                      "flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200",
                      isClosing && "pointer-events-none opacity-50",
                    )}
                  >
                    {isClosing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )}
                    Won
                  </button>
                  <button
                    type="button"
                    disabled={isClosing}
                    onClick={() => void handleClose("LOST")}
                    className={cn(
                      "flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200",
                      isClosing && "pointer-events-none opacity-50",
                    )}
                  >
                    {isClosing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5" />
                    )}
                    Lost
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <SheetFooter className="border-t border-slate-100 px-6 py-3">
          <Button
            type="button"
            variant="ghost"
            className="cursor-pointer text-sm text-slate-500 hover:text-slate-700"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
