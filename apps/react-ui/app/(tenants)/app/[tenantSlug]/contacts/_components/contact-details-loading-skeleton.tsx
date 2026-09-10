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
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-sm"
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

        <div className="flex shrink-0 flex-col gap-2 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_46%,#fff7ed_100%)] px-4 py-3 md:px-5">
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="size-1 rounded-full" />
            <Skeleton className="h-3 w-40" />
            <Skeleton className="size-1 rounded-full" />
            <Skeleton className="h-3 w-20" />
          </div>

          <div className="flex items-center gap-2 overflow-hidden">
            <Skeleton className="h-3 w-8 shrink-0" />
            <Skeleton className="h-6 w-16 shrink-0 rounded-full" />
            <Skeleton className="h-6 w-20 shrink-0 rounded-full" />
            <Skeleton className="h-6 w-14 shrink-0 rounded-full" />
          </div>

          <div className="flex items-center gap-2 overflow-hidden">
            <Skeleton className="h-3 w-24 shrink-0" />
            <Skeleton className="h-6 w-32 shrink-0 rounded-full" />
            <Skeleton className="h-6 w-40 shrink-0 rounded-full" />
          </div>
        </div>

        <div className="shrink-0 border-t border-slate-200/70 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_46%,#fff7ed_100%)]">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 md:px-5">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="size-5 rounded-full" />
            </div>
            <Skeleton className="h-8 w-16 rounded-lg" />
          </div>

          <div className="grid gap-3 px-4 pb-3 pt-2 sm:grid-cols-2 md:px-5 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <div
                key={index}
                className="flex min-h-24 flex-col justify-between gap-4 rounded-[20px] border border-blue-100 bg-white/75 p-3.5 shadow-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <Skeleton className="h-4 w-28 max-w-[70%]" />
                  <Skeleton className="size-6 rounded-full" />
                </div>
                <Skeleton className="h-7 w-full rounded-full" />
              </div>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-5 overflow-hidden border-y border-slate-200 bg-white px-4 py-3 md:px-5">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton
              key={index}
              className="h-4 w-20 shrink-0 first:w-16"
            />
          ))}
        </div>

        <div className="min-h-0 flex-1 bg-background px-4 py-5 md:px-5 md:py-6">
          <div className="flex flex-col gap-5">
            <div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
              <div className="flex flex-col gap-3">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-7 w-52 max-w-full" />
                <Skeleton className="h-4 w-80 max-w-full" />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 4 }, (_, index) => (
                  <div
                    key={index}
                    className="rounded-[22px] border border-white/80 bg-white/70 p-4 shadow-sm"
                  >
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="mt-3 h-6 w-16" />
                    <Skeleton className="mt-2 h-3 w-28 max-w-full" />
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="mt-2 h-4 w-72 max-w-full" />
              <div className="mt-6 grid gap-5 md:grid-cols-2">
                {Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className="flex flex-col gap-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-10 w-full rounded-xl" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
