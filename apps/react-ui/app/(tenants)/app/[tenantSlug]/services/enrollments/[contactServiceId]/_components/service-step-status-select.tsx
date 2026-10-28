"use client"

import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// Saved service steps use fixed API states rather than tenant-configured statuses.
export const SERVICE_STEP_STATUSES = {
  UPCOMING: { label: "Upcoming", bgColor: "#F1F5F9", textColor: "#334155" },
  ACTIVE: { label: "Current step", bgColor: "#DBEAFE", textColor: "#1D4ED8" },
  COMPLETED: { label: "Completed", bgColor: "#DCFCE7", textColor: "#166534" },
  SKIPPED: { label: "Skipped", bgColor: "#F1F5F9", textColor: "#475569" },
  CANCELED: { label: "Canceled", bgColor: "#FFE4E6", textColor: "#9F1239" },
  WAITING_AUTOMATION: { label: "Waiting for automation", bgColor: "#FEF3C7", textColor: "#92400E" },
  PAUSED: { label: "Needs attention", bgColor: "#FFE4E6", textColor: "#9F1239" },
} as const

export type ServiceStepStatus = keyof typeof SERVICE_STEP_STATUSES

export function ServiceStepStatusSelect({
  id,
  value,
  options,
  onValueChange,
  disabled,
  busy,
  ariaInvalid,
}: {
  id: string
  value: ServiceStepStatus
  options: ServiceStepStatus[]
  onValueChange: (value: ServiceStepStatus) => void
  disabled: boolean
  busy: boolean
  ariaInvalid: boolean
}) {
  const selected = SERVICE_STEP_STATUSES[value]

  return (
    <Select value={value} onValueChange={(next) => onValueChange(next as ServiceStepStatus)} disabled={disabled}>
      <SelectTrigger
        size="sm"
        id={id}
        aria-busy={busy}
        aria-invalid={ariaInvalid}
        className="h-8 w-fit min-w-0 max-w-[min(100%,220px)] rounded-full border-0 px-3 py-1 text-xs font-semibold shadow-sm ring-1 ring-black/5 [&_[data-slot=select-value]]:truncate"
        style={{ backgroundColor: selected.bgColor, color: selected.textColor }}
      >
        <SelectValue>{selected.label}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" className="w-60 max-w-[calc(100vw-2rem)] rounded-2xl p-1.5">
        <SelectGroup>
          {options.map((status) => {
            const option = SERVICE_STEP_STATUSES[status]
            return (
              <SelectItem key={status} value={status} className="rounded-xl py-2.5">
                <Badge
                  variant="secondary"
                  className="max-w-60 truncate rounded-full"
                  style={{ backgroundColor: option.bgColor, color: option.textColor }}
                >
                  {option.label}
                </Badge>
              </SelectItem>
            )
          })}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
