"use client"

import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type StackedAvatarGroupItem = {
  id: string
  label: string
  imageUrl?: string | null
  tone?: "internal" | "external" | "neutral"
}

type StackedAvatarGroupProps = {
  items: StackedAvatarGroupItem[]
  maxVisible?: number
  emptyLabel?: string
  className?: string
  avatarSize?: "sm" | "default" | "lg"
  enableHoverEffect?: boolean
}

const TONE_STYLES = {
  internal: {
    avatarClass: "ring-sky-200 bg-sky-50",
    fallbackClass: "bg-sky-100 text-sky-900",
  },
  external: {
    avatarClass: "ring-orange-200 bg-orange-50",
    fallbackClass: "bg-orange-100 text-orange-900",
  },
  neutral: {
    avatarClass: "ring-slate-200 bg-slate-50",
    fallbackClass: "bg-slate-100 text-slate-900",
  },
} as const

function getInitials(value: string) {
  const parts = value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2)

  if (parts.length === 0) return "?"

  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("")
}

export function StackedAvatarGroup({
  items,
  maxVisible = 4,
  emptyLabel = "No items assigned.",
  className,
  avatarSize = "default",
  enableHoverEffect = true,
}: StackedAvatarGroupProps) {
  if (items.length === 0) {
    return <p className="text-xs text-slate-500">{emptyLabel}</p>
  }

  const visibleItems = items.slice(0, maxVisible)
  const overflowItems = items.slice(maxVisible)
  const interactiveClassName = enableHoverEffect
    ? "transition-all duration-200 hover:z-20 hover:mx-1 hover:scale-125"
    : ""
  const fallbackTextClassName =
    avatarSize === "sm"
      ? "text-[9px]"
      : avatarSize === "lg"
        ? "text-xs"
        : "text-[11px]"

  return (
    <TooltipProvider delayDuration={120}>
      <AvatarGroup className={cn("w-fit overflow-visible pl-2", className)}>
        {visibleItems.map((item) => {
          const toneStyles = TONE_STYLES[item.tone ?? "neutral"]

          return (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <div className={cn("-ml-2 first:ml-0", interactiveClassName)}>
                  <Avatar
                    className={cn(
                      "border-2 border-white shadow-sm ring-1",
                      toneStyles.avatarClass,
                    )}
                    size={avatarSize}
                  >
                    {item.imageUrl ? (
                      <AvatarImage
                        src={item.imageUrl}
                        alt={item.label}
                        className="object-cover"
                      />
                    ) : null}
                    <AvatarFallback
                      className={cn(
                        fallbackTextClassName,
                        "font-semibold",
                        toneStyles.fallbackClass,
                      )}
                    >
                      {getInitials(item.label)}
                    </AvatarFallback>
                  </Avatar>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>
                {item.label}
              </TooltipContent>
            </Tooltip>
          )
        })}

        {overflowItems.length ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className={cn("-ml-2 first:ml-0", interactiveClassName)}>
                <AvatarGroupCount className="bg-slate-100 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
                  +{overflowItems.length}
                </AvatarGroupCount>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8} className="max-w-56">
              {overflowItems.map((item) => item.label).join(", ")}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </AvatarGroup>
    </TooltipProvider>
  )
}
