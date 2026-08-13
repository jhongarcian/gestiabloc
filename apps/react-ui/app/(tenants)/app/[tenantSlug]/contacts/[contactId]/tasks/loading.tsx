import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export default function ContactTasksLoading() {
  return (
    <section
      className="flex flex-col gap-5"
      aria-busy="true"
      aria-label="Loading contact tasks"
    >
      <div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-7 w-64 max-w-full" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          <div className="flex gap-3">
            <Skeleton className="h-11 w-24 rounded-2xl" />
            <Skeleton className="h-11 w-28 rounded-xl" />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-8 w-24 rounded-full" />
        ))}
      </div>

      <div className="flex flex-col">
        <div>
          <Table
            className="min-w-[920px] table-fixed border-separate border-spacing-0"
            aria-label="Loading task list"
          >
            <TableHeader className="drop-shadow-sm [&_tr]:border-0">
              <TableRow className="h-14 border-0 hover:bg-transparent">
                <TableHead className="w-[26%] rounded-l-xl border-y border-l bg-background px-4">
                  Task name
                </TableHead>
                <TableHead className="w-[19%] border-y bg-background px-4">
                  Service / product
                </TableHead>
                <TableHead className="w-[20%] border-y bg-background px-4">
                  Assignee
                </TableHead>
                <TableHead className="w-[11%] border-y bg-background px-4">
                  Priority
                </TableHead>
                <TableHead className="w-[12%] border-y bg-background px-4">
                  Status
                </TableHead>
                <TableHead className="w-[12%] rounded-r-xl border-y border-r bg-background px-4">
                  Due date
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow aria-hidden="true" className="h-2 border-0 hover:bg-transparent">
                <TableCell colSpan={6} className="p-0" />
              </TableRow>

              {Array.from({ length: 10 }, (_, index) => (
                <TableRow key={index} className="h-14 hover:bg-transparent">
                  <TableCell className="px-4 py-0">
                    <Skeleton className="h-4 w-4/5" />
                  </TableCell>
                  <TableCell className="px-4 py-0">
                    <div className="flex flex-col gap-1.5">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-0">
                    <div className="flex items-center gap-2.5">
                      <Skeleton className="size-6 rounded-full" />
                      <Skeleton className="h-4 w-24" />
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-0">
                    <Skeleton className="h-5 w-14 rounded-full" />
                  </TableCell>
                  <TableCell className="px-4 py-0">
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </TableCell>
                  <TableCell className="px-4 py-0">
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between px-1 py-4">
          <Skeleton className="h-4 w-36" />
          <div className="flex items-center gap-2">
            <Skeleton className="size-8 rounded-md" />
            <Skeleton className="size-8 rounded-md" />
            <Skeleton className="size-8 rounded-md" />
          </div>
        </div>
      </div>
    </section>
  )
}
