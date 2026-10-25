"use client"

import { Bot, Compass, Lightbulb, Sparkles } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import type { AiHelperSettings } from "../_lib/helper-settings"

export const AVATAR_ICONS = {
  bot: Bot,
  sparkles: Sparkles,
  compass: Compass,
  lightbulb: Lightbulb,
}
export const AVATAR_LABELS = {
  bot: "Bot",
  sparkles: "Sparkles",
  compass: "Compass",
  lightbulb: "Lightbulb",
}

export function AiHelperAvatar({
  avatar,
  name,
  className,
}: {
  avatar?: AiHelperSettings["avatar"]
  name: string
  className?: string
}) {
  const Icon = AVATAR_ICONS[avatar?.presetId ?? "bot"] ?? Bot
  return (
    <Avatar className={cn("size-11 rounded-2xl", className)}>
      {avatar?.imageUrl ? (
        <AvatarImage src={avatar.imageUrl} alt={`${name} avatar`} />
      ) : null}
      <AvatarFallback
        role="img"
        className="rounded-2xl bg-blue-950 text-white"
        aria-label={`${name} avatar`}
      >
        <Icon className="size-6" aria-hidden="true" />
      </AvatarFallback>
    </Avatar>
  )
}
