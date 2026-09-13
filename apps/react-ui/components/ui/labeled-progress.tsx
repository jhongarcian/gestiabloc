import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

type LabeledProgressProps = {
  value: number
  ariaLabel: string
  ariaValueText: string
  summaryLabel?: string
  size?: "default" | "compact"
  className?: string
}

function LabeledProgress({
  value,
  ariaLabel,
  ariaValueText,
  summaryLabel,
  size = "default",
  className,
}: LabeledProgressProps) {
  const normalizedValue = Math.min(100, Math.max(0, value))
  const isCompact = size === "compact"

  return (
    <div className={cn("relative min-w-0", className)}>
      <Progress
        value={normalizedValue}
        aria-label={ariaLabel}
        aria-valuetext={ariaValueText}
        className={cn(
          "border border-emerald-100/80 bg-emerald-50/80 [&_[data-slot=progress-indicator]]:bg-[linear-gradient(90deg,#a7f3d0_0%,#6ee7b7_100%)] [&_[data-slot=progress-indicator]]:transition-transform [&_[data-slot=progress-indicator]]:duration-700 [&_[data-slot=progress-indicator]]:ease-out motion-reduce:[&_[data-slot=progress-indicator]]:transition-none",
          isCompact ? "h-5" : "h-7",
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "absolute flex items-center rounded-full bg-emerald-700 font-semibold tabular-nums text-white shadow-sm",
          isCompact
            ? "inset-y-[3px] left-[3px] px-1.5 text-[9px] leading-none"
            : "inset-y-1 left-1 px-2 text-[10px]",
        )}
      >
        {normalizedValue}%
      </span>
      {summaryLabel ? (
        <span
          aria-hidden="true"
          className={cn(
            "absolute flex max-w-[65%] items-center truncate rounded-full bg-white/90 font-semibold tabular-nums text-emerald-800 shadow-sm ring-1 ring-emerald-900/5",
            isCompact
              ? "inset-y-[3px] right-[3px] px-1.5 text-[9px] leading-none"
              : "inset-y-1 right-1 px-2 text-[11px]",
          )}
        >
          {summaryLabel}
        </span>
      ) : null}
    </div>
  )
}

export { LabeledProgress }
export type { LabeledProgressProps }
