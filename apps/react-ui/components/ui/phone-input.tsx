"use client"

import type { ComponentProps } from "react"
import PhoneInput, { type Value } from "react-phone-number-input"

import { cn } from "@/lib/utils"

type AppPhoneInputProps = Omit<
  ComponentProps<typeof PhoneInput>,
  "value" | "onChange"
> & {
  value?: string
  onChange?: (value?: string) => void
}

export function AppPhoneInput({
  className,
  value,
  onChange,
  ...props
}: AppPhoneInputProps) {
  return (
    <PhoneInput
      className={cn("app-phone-input", className)}
      value={value as Value | undefined}
      onChange={(next) => onChange?.(next ?? undefined)}
      {...props}
    />
  )
}
