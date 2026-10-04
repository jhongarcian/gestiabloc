import * as React from "react"

import { cn } from "@/lib/utils"

type EmptyFolderProps = Omit<React.ComponentProps<"section">, "title"> & {
  heading?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
}

function EmptyFolder({
  className,
  heading = "This folder is empty",
  description = "Files added to this folder will appear here.",
  action,
  ...props
}: EmptyFolderProps) {
  return (
    <section
      data-slot="empty-folder"
      className={cn(
        "group flex min-h-72 w-full flex-col items-center justify-center px-6 py-10 text-center",
        className
      )}
      {...props}
    >
      <div
        aria-hidden="true"
        className="relative h-36 w-52 [perspective:1000px]"
      >
        <div className="absolute inset-x-0 bottom-0 h-31 rounded-2xl bg-primary/80 shadow-[0_18px_40px_-24px_color-mix(in_oklab,var(--primary)_60%,transparent)] before:absolute before:bottom-[calc(100%-1px)] before:left-0 before:h-5 before:w-20 before:rounded-t-xl before:bg-primary/80 before:content-['']" />

        <div className="absolute inset-x-1 bottom-1 h-27 rounded-xl border border-border/70 bg-card shadow-sm" />

        <div className="absolute inset-x-0 bottom-0 h-29 origin-bottom rounded-2xl bg-gradient-to-t from-primary to-primary/75 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--primary-foreground)_20%,transparent),0_18px_36px_-24px_color-mix(in_oklab,var(--primary)_65%,transparent)] transition-transform duration-500 ease-out [transform:rotateX(-32deg)_translateY(1px)] motion-reduce:transition-none group-hover:[transform:rotateX(-48deg)_translateY(2px)]" />

        <div className="absolute inset-x-10 bottom-9 flex items-center justify-center gap-1.5 rounded-full border border-primary-foreground/15 bg-primary-foreground/10 px-3 py-1.5 text-primary-foreground/70 backdrop-blur-sm transition-transform duration-500 ease-out motion-reduce:transition-none group-hover:translate-y-1">
          <span className="size-1.5 rounded-full bg-current" />
          <span className="size-1.5 rounded-full bg-current opacity-70" />
          <span className="size-1.5 rounded-full bg-current opacity-40" />
        </div>
      </div>

      <div className="mt-6 max-w-sm">
        <h3 className="text-base font-semibold text-foreground">{heading}</h3>
        {description ? (
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>

      {action ? <div className="mt-5">{action}</div> : null}
    </section>
  )
}

export { EmptyFolder, type EmptyFolderProps }
