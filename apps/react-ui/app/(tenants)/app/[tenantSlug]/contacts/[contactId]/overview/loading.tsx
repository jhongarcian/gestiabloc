import { Skeleton } from "@/components/ui/skeleton"

function MetricSkeleton() {
  return (
    <div className="rounded-[22px] border border-white/80 bg-white/70 p-4 shadow-sm backdrop-blur">
      <div className="flex items-center gap-2">
        <Skeleton className="size-4 rounded-md" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="mt-3 h-6 w-20" />
      <Skeleton className="mt-2 h-3 w-32 max-w-full" />
    </div>
  )
}

export default function ContactOverviewLoading() {
  return (
    <section
      className="flex flex-col gap-5"
      aria-busy="true"
      aria-label="Loading contact overview"
    >
      <div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-3">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-7 w-44" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <Skeleton className="h-11 w-36 rounded-2xl" />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <MetricSkeleton key={index} />
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-2 h-4 w-72 max-w-full" />
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-10 w-full rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
