"use client"

import { format } from "date-fns"
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  XCircle,
} from "lucide-react"
import { useState } from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"

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

function statusBadge(result: "OPEN" | "WON" | "LOST") {
  switch (result) {
    case "OPEN":
      return (
        <Badge className="rounded-full border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-800 hover:bg-blue-50">
          Open
        </Badge>
      )
    case "WON":
      return (
        <Badge className="rounded-full border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800 hover:bg-emerald-50">
          Won
        </Badge>
      )
    case "LOST":
      return (
        <Badge className="rounded-full border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-800 hover:bg-rose-50">
          Lost
        </Badge>
      )
  }
}

type OpportunityDetailDrawerProps = {
  opportunity: OpportunityCardRecord
  tenantSlug: string
  stages: StageOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onStageChange: (opportunityId: string, targetStageId: string) => Promise<void>
  onCloseOpportunity: (opportunityId: string, result: "WON" | "LOST") => Promise<void>
}

export function OpportunityDetailDrawer({
  opportunity,
  tenantSlug,
  stages,
  open,
  onOpenChange,
  onStageChange,
  onCloseOpportunity,
}: OpportunityDetailDrawerProps) {
  const [isMovingStage, setIsMovingStage] = useState(false)
  const [isClosing, setIsClosing] = useState(false)

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

  const currentStageName = stages.find((s) => s.id === opportunity.stageId)?.name ?? "Unknown"

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-md"
        showCloseButton
      >
        <SheetHeader className="space-y-2 px-1">
          <SheetTitle className="text-lg font-semibold text-slate-950">
            Opportunity Details
          </SheetTitle>
          <SheetDescription className="text-sm text-slate-500">
            View and manage this opportunity
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-1">
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Contact
            </p>
            <a
              href={`/app/${tenantSlug}/contacts/${opportunity.contact.id}/overview`}
              className="group inline-flex items-center gap-2 text-sm font-semibold text-slate-950 transition hover:text-blue-600"
            >
              {opportunity.contact.fullName}
              <ExternalLink className="h-3.5 w-3.5 text-slate-400 transition group-hover:text-blue-500" />
            </a>
            <p className="text-xs text-slate-500">
              {opportunity.contact.email ?? opportunity.contact.phoneNumber ?? "No contact details"}
            </p>
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Status
              </p>
              {statusBadge(opportunity.result)}
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Value
              </p>
              <p className="text-sm font-semibold text-slate-950">
                {formatUsdCents(opportunity.valueCents)}
              </p>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Created
              </p>
              <p className="text-sm text-slate-700">
                {format(new Date(opportunity.createdAt), "MMM d, yyyy")}
              </p>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Assigned to
              </p>
              {opportunity.assignedTo ? (
                <div className="flex items-center gap-2">
                  <Avatar className="h-6 w-6 border border-slate-200 bg-white">
                    <AvatarImage
                      src={opportunity.assignedTo.image ?? undefined}
                      alt={opportunity.assignedTo.name}
                    />
                    <AvatarFallback className="bg-blue-100 text-[10px] font-semibold text-blue-900">
                      {getInitials(opportunity.assignedTo.name)}
                    </AvatarFallback>
                  </Avatar>
                  <p className="truncate text-sm text-slate-700">
                    {opportunity.assignedTo.name}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-slate-400">Unassigned</p>
              )}
            </div>
          </div>

          <Separator />

          {opportunity.result === "OPEN" ? (
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Stage
              </p>
              <Select
                value={opportunity.stageId}
                onValueChange={(value) => void handleStageChange(value)}
                disabled={isMovingStage}
              >
                <SelectTrigger className="h-10 w-full rounded-xl border-slate-200 bg-white text-sm">
                  <SelectValue>
                    <div className="flex items-center gap-2">
                      {isMovingStage && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      <span>{currentStageName}</span>
                    </div>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  side="bottom"
                  align="start"
                  sideOffset={4}
                  className="rounded-xl border-slate-200 bg-white"
                >
                  {stages.map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      {stage.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {opportunity.result === "OPEN" ? (
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Actions
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 cursor-pointer rounded-xl border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 hover:text-emerald-900"
                  disabled={isClosing}
                  onClick={() => void handleClose("WON")}
                >
                  {isClosing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  Mark Won
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 cursor-pointer rounded-xl border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100 hover:text-rose-900"
                  disabled={isClosing}
                  onClick={() => void handleClose("LOST")}
                >
                  {isClosing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <XCircle className="mr-2 h-4 w-4" />
                  )}
                  Mark Lost
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
