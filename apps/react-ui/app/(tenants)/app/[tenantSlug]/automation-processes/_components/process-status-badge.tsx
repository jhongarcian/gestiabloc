import { AlertTriangle, Check, Clock3, Loader2, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  automationProcessStatusLabel,
  type AutomationProcessStatus,
} from "../../_lib/automation-processes"

export function ProcessStatusBadge({
  status,
  className,
}: {
  status: AutomationProcessStatus
  className?: string
}) {
  const active = status === "PREPARING" || status === "QUEUED" || status === "RUNNING"
  const completed = status === "COMPLETED"
  const warning = status === "COMPLETED_WITH_ERRORS"

  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 border-slate-200 bg-white px-2.5 py-1 text-slate-700",
        active && "border-blue-200 bg-blue-50 text-blue-700",
        completed && "border-emerald-200 bg-emerald-50 text-emerald-700",
        warning && "border-amber-200 bg-amber-50 text-amber-800",
        status === "FAILED" && "border-rose-200 bg-rose-50 text-rose-700",
        className,
      )}
    >
      {status === "RUNNING" ? (
        <Loader2 className="animate-spin" aria-hidden="true" />
      ) : status === "QUEUED" || status === "PREPARING" ? (
        <Clock3 aria-hidden="true" />
      ) : completed ? (
        <Check aria-hidden="true" />
      ) : warning ? (
        <AlertTriangle aria-hidden="true" />
      ) : (
        <X aria-hidden="true" />
      )}
      {automationProcessStatusLabel(status)}
    </Badge>
  )
}
