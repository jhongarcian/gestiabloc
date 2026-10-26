"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { AccountProfileController } from "./use-account-profile"

const TIMEZONE_GROUPS = [
  {
    label: "North America",
    values: [
      "America/New_York",
      "America/Toronto",
      "America/Chicago",
      "America/Denver",
      "America/Phoenix",
      "America/Los_Angeles",
      "America/Anchorage",
      "Pacific/Honolulu",
      "America/Mexico_City",
    ],
  },
  {
    label: "South America",
    values: [
      "America/Bogota",
      "America/Lima",
      "America/Santiago",
      "America/Caracas",
      "America/Sao_Paulo",
      "America/Argentina/Buenos_Aires",
      "America/Montevideo",
    ],
  },
  {
    label: "Europe",
    values: [
      "Europe/London",
      "Europe/Dublin",
      "Europe/Lisbon",
      "Europe/Madrid",
      "Europe/Paris",
      "Europe/Brussels",
      "Europe/Amsterdam",
      "Europe/Berlin",
      "Europe/Zurich",
      "Europe/Rome",
      "Europe/Vienna",
      "Europe/Prague",
      "Europe/Warsaw",
      "Europe/Stockholm",
      "Europe/Copenhagen",
      "Europe/Oslo",
      "Europe/Helsinki",
      "Europe/Athens",
      "Europe/Bucharest",
      "Europe/Budapest",
      "Europe/Istanbul",
      "Europe/Kyiv",
    ],
  },
  {
    label: "Global Popular",
    values: [
      "UTC",
      "Asia/Dubai",
      "Asia/Kolkata",
      "Asia/Singapore",
      "Asia/Tokyo",
      "Australia/Sydney",
      "Africa/Johannesburg",
    ],
  },
] as const

export function AccountTimezoneField({
  controller,
}: {
  controller: AccountProfileController
}) {
  const { draft, ready, busy, fieldErrors, setField } = controller
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    const tick = () => setNow(new Date())
    tick()
    const timer = window.setInterval(tick, 30000)
    return () => window.clearInterval(timer)
  }, [])
  const groups = useMemo(() => {
    const known = new Set(
      typeof Intl.supportedValuesOf === "function"
        ? Intl.supportedValuesOf("timeZone")
        : TIMEZONE_GROUPS.flatMap((group) => group.values),
    )
    return TIMEZONE_GROUPS.map((group) => ({
      label: group.label,
      values: group.values.filter((zone) => known.has(zone)),
    })).filter((group) => group.values.length)
  }, [])
  let preview = "Current time appears after loading."
  if (now)
    try {
      preview = new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        ...(draft.timezone ? { timeZone: draft.timezone } : {}),
      }).format(now)
    } catch {
      preview = "Choose a valid timezone."
    }
  const customZone =
    draft.timezone &&
    !groups.some((group) =>
      group.values.some((zone) => zone === draft.timezone),
    )
  return (
    <Field data-invalid={Boolean(fieldErrors.timezone)}>
      <FieldLabel htmlFor="company-timezone">Timezone</FieldLabel>
      <Select
        value={draft.timezone || "__SYSTEM_TIMEZONE__"}
        disabled={!ready || Boolean(busy)}
        onValueChange={(value) =>
          setField("timezone", value === "__SYSTEM_TIMEZONE__" ? "" : value)
        }
      >
        <SelectTrigger
          id="company-timezone"
          aria-invalid={Boolean(fieldErrors.timezone)}
          aria-describedby={
            fieldErrors.timezone
              ? "company-timezone-error"
              : "company-timezone-hint"
          }
          className="h-11 w-full rounded-xl border-slate-200 bg-slate-50/60 data-[size=default]:h-11"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="__SYSTEM_TIMEZONE__">
              System timezone (default)
            </SelectItem>
            {customZone ? (
              <SelectItem value={draft.timezone}>{draft.timezone}</SelectItem>
            ) : null}
          </SelectGroup>
          {groups.map((group) => (
            <SelectGroup key={group.label}>
              <SelectLabel>{group.label}</SelectLabel>
              {group.values.map((zone) => (
                <SelectItem key={zone} value={zone}>
                  {zone}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription id="company-timezone-hint">
        Current time in selected zone: {preview}
      </FieldDescription>
      {fieldErrors.timezone ? (
        <FieldError id="company-timezone-error">
          {fieldErrors.timezone}
        </FieldError>
      ) : null}
    </Field>
  )
}
