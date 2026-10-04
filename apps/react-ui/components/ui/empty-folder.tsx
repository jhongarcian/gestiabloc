import * as React from "react"

import { cn } from "@/lib/utils"

type EmptyFolderProps = Omit<React.ComponentProps<"section">, "title"> & {
  heading?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  variant?: "empty" | "card" | "row"
  documentCount?: number
  compact?: boolean
}

function EmptyFolder({
  className,
  heading = "This folder is empty",
  description = "Files added to this folder will appear here.",
  action,
  variant = "empty",
  documentCount = 0,
  compact = false,
  ...props
}: EmptyFolderProps) {
  const visibleDocuments = Math.min(Math.max(documentCount, 0), 3)

  if (variant === "row") {
    return (
      <section
        data-slot="empty-folder"
        className={cn("group flex min-w-0 items-center gap-2", className)}
        {...props}
      >
        <div
          aria-hidden="true"
          className="relative size-6 shrink-0 lg:size-8 before:absolute before:left-0.5 before:top-1 before:h-2 before:w-2.5 before:rounded-t-sm before:bg-blue-500 before:content-[''] lg:before:h-2.5 lg:before:w-3 after:absolute after:inset-x-0.5 after:bottom-0.5 after:z-20 after:h-4 after:rounded-[4px] after:bg-gradient-to-b after:from-blue-500 after:to-blue-800 after:shadow-sm after:transition-transform after:duration-300 after:content-[''] lg:after:h-5 group-hover:after:-translate-y-0.5 motion-reduce:group-hover:after:translate-y-0"
        >
          {visibleDocuments > 0 ? (
            <span className="absolute left-2 top-0.5 z-10 h-4 w-3 rounded-t-[2px] border border-slate-200 bg-white shadow-sm lg:left-2.5 lg:h-5 lg:w-4" />
          ) : null}
        </div>
        {heading ? (
          <span className="truncate text-sm font-semibold text-foreground">
            {heading}
          </span>
        ) : null}
      </section>
    )
  }
  return (
    <section
      data-slot="empty-folder"
      className={cn(
        "group flex w-full flex-col items-center justify-center text-center",
        variant === "empty"
          ? compact
            ? "min-h-56 px-6 py-6"
            : "min-h-72 px-6 py-10"
          : variant === "card"
            ? "min-h-0 px-3 py-3"
            : "min-h-0 flex-row justify-start gap-2 px-0 py-0 text-left",
        className,
      )}
      {...props}
    >
      <div
        aria-hidden="true"
        className={cn(
          "relative shrink-0 [perspective:1000px]",
          variant === "empty"
            ? compact
              ? "-my-4 h-25 w-44 scale-[.68]"
              : "h-25 w-52 lg:my-2 lg:scale-[1.12]"
            : variant === "card"
              ? "-mx-10 -my-7 h-28 w-38 origin-center scale-[.5] sm:-mx-9 sm:-my-6 sm:scale-[.54] lg:-mx-8 lg:-my-6 lg:scale-[.58]"
              : "h-8 w-11 scale-[.21] origin-center -mx-16 -my-14",
        )}
      >
        <div className="absolute inset-x-0 bottom-0 h-28 rounded-2xl bg-blue-800 shadow-[0_18px_40px_-24px_rgba(29,78,216,.6)] before:absolute before:-top-4 before:left-1.5 before:h-5 before:w-20 before:rounded-t-xl before:bg-blue-800 before:content-['']" />

        {visibleDocuments > 0 ? (
          <div className="absolute inset-x-0 bottom-4 z-10 flex justify-center" aria-hidden="true">
            {Array.from({ length: visibleDocuments }, (_, index) => (
              <div
                key={index}
                className={cn(
                  "absolute bottom-0 h-30 w-20 rounded-t-md border border-slate-300 bg-[#f8fbff] shadow-[0_3px_8px_rgba(15,23,42,.16)] transition-transform duration-500 ease-out after:absolute after:right-0 after:top-0 after:size-3 after:border-b after:border-l after:border-slate-300 after:bg-slate-100 after:content-[''] motion-reduce:transition-none group-hover:-translate-y-2",
                  visibleDocuments === 1
                    ? ""
                    : index === 0
                      ? "-translate-x-4 -rotate-8"
                      : index === visibleDocuments - 1
                        ? "translate-x-4 rotate-8"
                        : "-translate-y-1",
                )}
              />
            ))}
          </div>
        ) : null}

        <div className="absolute inset-x-0 bottom-0 z-20 h-28 origin-bottom rounded-2xl bg-gradient-to-t from-blue-950 to-blue-600 shadow-[inset_0_1px_0_rgba(255,255,255,.28),0_18px_36px_-24px_rgba(29,78,216,.65)] transition-transform duration-500 ease-out [transform:rotateX(-12deg)_translateY(1px)] motion-reduce:transition-none group-hover:[transform:rotateX(-43deg)_translateY(2px)]" />
      </div>

      <div
        className={cn(
          "max-w-sm",
          variant === "empty"
            ? compact
              ? "mt-4"
              : "mt-6"
            : variant === "card"
              ? "mt-1"
              : "min-w-0",
        )}
      >
        {heading ? (
          <h3
            className={cn(
              "font-semibold text-foreground",
              variant === "empty" ? "text-base" : "truncate text-sm",
            )}
          >
            {heading}
          </h3>
        ) : null}
        {description ? (
          <p
            className={cn(
              "text-muted-foreground",
              variant === "empty"
                ? "mt-1.5 text-sm leading-6"
                : "mt-0.5 truncate text-xs",
            )}
          >
            {description}
          </p>
        ) : null}
      </div>

      {action ? (
        <div className={compact && variant === "empty" ? "mt-4" : "mt-5"}>
          {action}
        </div>
      ) : null}
    </section>
  )
}

export { EmptyFolder, type EmptyFolderProps }
