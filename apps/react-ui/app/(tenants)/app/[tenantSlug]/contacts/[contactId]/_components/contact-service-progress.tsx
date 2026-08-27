"use client"

import { ChevronDown } from "lucide-react"
import { type ReactNode, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

type ContactServiceProgressProps = {
  count: number
  children: ReactNode
}

export function ContactServiceProgress({
  count,
  children,
}: ContactServiceProgressProps) {
  const [open, setOpen] = useState(true)

  return (
    <section aria-labelledby="service-progress-title">
      <Collapsible
        open={open}
        onOpenChange={setOpen}
        className="border-t border-slate-200/70 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_46%,#fff7ed_100%)]"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 md:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <h2
              id="service-progress-title"
              className="truncate text-sm font-semibold text-slate-800"
            >
              Service progress
            </h2>
            <Badge variant="secondary" className="tabular-nums">
              {count}
            </Badge>
          </div>

          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`${open ? "Collapse" : "Expand"} service progress`}
            >
              {open ? "Hide" : "Show"}
              <ChevronDown
                data-icon="inline-end"
                aria-hidden="true"
                className={cn("transition-transform", open && "rotate-180")}
              />
            </Button>
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent className="overflow-hidden">
          {children}
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}
