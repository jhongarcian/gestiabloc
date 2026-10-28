"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"

export type ServiceSectionMode = "INHERIT" | "CUSTOM"

export function ServiceSectionInheritance({
  section,
  mode,
  parentName,
  parentHref,
  disabled,
  onChange,
}: {
  section: string
  mode: ServiceSectionMode
  parentName: string
  parentHref: string
  disabled: boolean
  onChange: (mode: ServiceSectionMode) => void
}) {
  const inherited = mode === "INHERIT"
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-muted/40 p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">
          {section}: {inherited ? "Inherited from " : "Customized for this sub-service"}
          {inherited ? (
            <Link href={parentHref} className="underline underline-offset-4">
              {parentName}
            </Link>
          ) : null}
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          {inherited
            ? "Parent changes apply to new enrollments. Customize to edit this section independently."
            : "This section has its own settings. Restore defaults to use the parent’s current settings."}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onChange(inherited ? "CUSTOM" : "INHERIT")}
      >
        {inherited ? "Customize this section" : "Restore parent settings"}
      </Button>
    </div>
  )
}
