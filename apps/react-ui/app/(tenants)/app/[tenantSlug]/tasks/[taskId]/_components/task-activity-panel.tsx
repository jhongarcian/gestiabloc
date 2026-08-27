"use client"

import { History, PencilLine } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatDateTimeForDisplay } from "@/lib/date-time"

export type TaskActivity = {
  id: string
  type:
    | "CREATED"
    | "UPDATED"
    | "STATUS_CHANGED"
    | "ASSIGNEE_CHANGED"
    | "DUE_DATE_CHANGED"
    | "START_DATE_CHANGED"
    | "REMINDER_CREATED"
    | "REMINDER_CANCELED"
  title: string
  details: string | null
  createdAt: string
  actor: {
    id: string
    name: string
    email: string
  } | null
}

type TaskActivitySheetProps = {
  tenantTimezone?: string | null
  activities: TaskActivity[]
}

export function TaskActivitySheet({
  tenantTimezone,
  activities,
}: TaskActivitySheetProps) {
  return (
    <Sheet>
      <TooltipProvider delayDuration={120}>
        <Tooltip>
          <TooltipTrigger asChild>
            <SheetTrigger asChild>
              <Button
                type="button"
                size="icon"
                aria-label="Activity history"
                className="h-8 w-8 cursor-pointer rounded-full border border-white/70 bg-blue-950 text-white shadow-sm backdrop-blur transition hover:bg-blue-900"
              >
                <History className="size-4" aria-hidden="true" />
              </Button>
            </SheetTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            Activity history
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <SheetContent
        side="right"
        className="flex h-full w-full flex-col gap-0 overflow-hidden border-l border-slate-200 bg-white p-0 sm:max-w-lg [&>button]:cursor-pointer"
      >
        <SheetHeader className="relative overflow-hidden border-b border-blue-100 bg-[#f1f7ff] px-6 py-6 text-left sm:px-7">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(30,64,175,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(30,64,175,.08)_1px,transparent_1px)] [background-size:42px_42px]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-12 -bottom-20 size-48 rounded-full bg-blue-300/30 blur-3xl"
          />
          <div className="relative pr-10">
            <div className="flex min-w-0 flex-col gap-1.5">
              <p className="text-xs font-semibold text-blue-700">Task activity</p>
              <SheetTitle className="text-xl font-semibold text-slate-950 sm:text-2xl">
                Activity history
              </SheetTitle>
              <SheetDescription className="max-w-xl text-sm leading-6 text-slate-600">
                Review the most recent changes to this task.
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6 [scrollbar-gutter:stable] sm:px-7">
          {activities.length > 0 ? (
            <ol className="flex flex-col" aria-label="Task activity timeline">
              {activities.map((activity, index) => (
                <li key={activity.id} className="flex gap-3">
                  <div className="flex w-8 shrink-0 flex-col items-center">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm">
                      <PencilLine className="size-3.5" aria-hidden="true" />
                    </span>
                    {index < activities.length - 1 ? (
                      <span
                        aria-hidden="true"
                        className="min-h-6 w-px flex-1 bg-slate-200"
                      />
                    ) : null}
                  </div>

                  <div className="min-w-0 flex-1 pb-6">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                      <div className="flex min-w-0 flex-col gap-1">
                        <p className="text-sm font-semibold text-slate-950">
                          {activity.title}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {activity.actor?.name?.trim() ||
                            activity.actor?.email ||
                            "System"}
                        </p>
                      </div>
                      <time
                        dateTime={activity.createdAt}
                        className="shrink-0 text-xs tabular-nums text-slate-500"
                      >
                        {formatDateTimeForDisplay(
                          activity.createdAt,
                          tenantTimezone,
                          true,
                        )}
                      </time>
                    </div>

                    {activity.details ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                        {activity.details}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-6 text-center">
              <p className="text-sm font-semibold text-slate-900">No activity yet</p>
              <p className="mt-1 text-sm text-slate-500">
                Changes, assignments, and reminders will appear here.
              </p>
            </div>
          )}
        </div>

        <SheetFooter className="border-t border-slate-200 bg-slate-50/80 px-6 py-4 sm:flex-row sm:justify-end sm:px-7">
          <SheetClose asChild>
            <Button type="button" variant="outline">
              Close
            </Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
