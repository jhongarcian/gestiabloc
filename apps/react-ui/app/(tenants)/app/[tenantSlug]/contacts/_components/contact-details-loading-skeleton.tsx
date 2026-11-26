import { Skeleton } from "@/components/ui/skeleton"

type ContactDetailsLoadingSkeletonProps = {
  contactName?: string
}

export function ContactDetailsLoadingSkeleton({
  contactName,
}: ContactDetailsLoadingSkeletonProps) {
  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-busy="true"
      aria-label="Loading contact details"
      role="status"
    >
      <span className="sr-only">
        {contactName
          ? `Loading contact details for ${contactName}. Please wait.`
          : "Loading contact details. Please wait."}
      </span>

      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-clip rounded-[28px] border border-slate-200/80 bg-white shadow-sm"
        aria-hidden="true"
      >
        <header className="shrink-0 bg-slate-100">
          <div className="flex flex-col gap-3 rounded-t-[27px] border-b border-slate-200/80 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_46%,#fff7ed_100%)] p-3 shadow-sm md:px-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <Skeleton className="h-7 w-52 max-w-[65%]" />
            </div>
            <div className="flex max-w-full items-center gap-2 overflow-hidden">
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="size-8 shrink-0 rounded-full" />
              ))}
              <Skeleton className="h-8 w-24 shrink-0 rounded-full" />
              <Skeleton className="h-8 w-32 shrink-0 rounded-full" />
            </div>
          </div>
        </header>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col xl:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-2 overflow-hidden border-y border-blue-200/80 bg-[#e4efff] px-4 py-3 md:px-5">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-8 w-20 shrink-0 rounded-lg first:w-16" />
              ))}
            </div>

            <div className="@container/contact-content min-h-0 min-w-0 flex-1 bg-background px-4 py-5 md:px-5 md:py-6">
              <div className="flex flex-col gap-5">
                <div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
                  <div className="grid gap-3 @lg/contact-content:grid-cols-2 @5xl/contact-content:grid-cols-4">
                    {Array.from({ length: 4 }, (_, index) => (
                      <div key={index} className="rounded-[22px] border border-white/80 bg-white/70 p-4 shadow-sm">
                        <Skeleton className="h-3 w-24 max-w-full" />
                        <Skeleton className="mt-3 h-6 w-16" />
                        <Skeleton className="mt-2 h-3 w-28 max-w-full" />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <Skeleton className="h-6 w-40 max-w-full" />
                  <Skeleton className="mt-2 h-4 w-72 max-w-full" />
                  <div className="mt-6 grid gap-5 @lg/contact-content:grid-cols-2">
                    {Array.from({ length: 6 }, (_, index) => (
                      <div key={index} className="flex min-w-0 flex-col gap-2">
                        <Skeleton className="h-3 w-24 max-w-full" />
                        <Skeleton className="h-9 w-full rounded-md" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="order-first min-w-0 border-b border-slate-200/80 bg-[linear-gradient(160deg,#f8fafc_0%,#f1f6fd_55%,#fffaf5_100%)] xl:order-last xl:w-72 xl:shrink-0 xl:border-b-0 xl:border-l 2xl:w-80">
            <div className="divide-y divide-slate-200/70">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="flex flex-col gap-4 px-4 py-5">
                  <div className="flex items-center justify-between gap-3">
                    <Skeleton className="h-4 w-28" />
                    {index > 0 ? <Skeleton className="size-7 rounded-full" /> : null}
                  </div>
                  {Array.from({ length: index === 0 ? 3 : 2 }, (_, row) => (
                    <div key={row} className="flex flex-col gap-2">
                      <Skeleton className="h-3 w-16" />
                      <Skeleton className="h-4 w-40 max-w-full" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
