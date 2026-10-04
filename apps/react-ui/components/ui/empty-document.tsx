import * as React from "react"

import { cn } from "@/lib/utils"

type EmptyDocumentProps = React.ComponentProps<"div"> & { variant?: "empty" | "card" | "row" }

function EmptyDocument({
  className,
  "aria-label": ariaLabel,
  variant = "empty",
  ...props
}: EmptyDocumentProps) {
  return (
    <div
      data-slot="empty-document"
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      className={cn(
        "relative h-36 w-28 shrink-0 overflow-hidden border border-border bg-card shadow-[0_16px_35px_-22px_color-mix(in_oklab,var(--foreground)_35%,transparent)] [clip-path:polygon(0_0,calc(100%-1.75rem)_0,100%_1.75rem,100%_100%,0_100%)]",
        "after:absolute after:right-0 after:top-0 after:size-7 after:border-b after:border-l after:border-border after:bg-muted after:shadow-[-2px_2px_6px_color-mix(in_oklab,var(--foreground)_8%,transparent)] after:content-['']",
        "transition-transform duration-300 ease-out motion-reduce:transition-none group-hover:-translate-y-1 group-hover:rotate-[-3deg]",
        variant === "card"
          ? "-my-6 scale-[.66]"
          : variant === "row"
            ? "h-5 w-4 border-[0.25px] border-slate-400 shadow-[0_2px_5px_-3px_rgb(15_23_42/.14)] [clip-path:polygon(0_0,calc(100%-0.375rem)_0,100%_0.375rem,100%_100%,0_100%)] after:size-1.5 after:border-b-[0.75px] after:border-l-[0.75px] after:border-slate-400 after:bg-slate-200"
            : "",
        className
      )}
      {...props}
    />
  )
}

export { EmptyDocument, type EmptyDocumentProps }
