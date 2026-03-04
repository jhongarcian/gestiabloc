"use client"

import { AlertTriangle, CalendarClock, ClipboardList, Flame } from "lucide-react"

type TaskInsightsProps = {
  summary: {
    totalTasks: number
    overdueTasks: number
    dueThisWeek: number
    highPriorityTasks: number
    myPriorityCounts: {
      HIGH: number
      MEDIUM: number
      LOW: number
    }
  }
}

export function TaskInsights({ summary }: TaskInsightsProps) {
  return (
    <div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          Task Insights
        </p>
        <h2 className="text-xl font-semibold tracking-tight text-slate-950">
          Priority and urgency
        </h2>
        <p className="text-sm text-slate-600">
          Keep the most important work visible before diving into the full task list.
        </p>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-slate-500">
            <ClipboardList className="h-4 w-4" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em]">
              Total Tasks
            </span>
          </div>
          <p className="mt-3 text-2xl font-semibold text-slate-950">
            {summary.totalTasks}
          </p>
        </div>

        <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-slate-500">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em]">
              Overdue
            </span>
          </div>
          <p className="mt-3 text-2xl font-semibold text-slate-950">
            {summary.overdueTasks}
          </p>
        </div>

        <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-slate-500">
            <CalendarClock className="h-4 w-4" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em]">
              Due In 7 Days
            </span>
          </div>
          <p className="mt-3 text-2xl font-semibold text-slate-950">
            {summary.dueThisWeek}
          </p>
        </div>

        <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-slate-500">
            <Flame className="h-4 w-4" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em]">
              High Priority
            </span>
          </div>
          <p className="mt-3 text-2xl font-semibold text-slate-950">
            {summary.highPriorityTasks}
          </p>
        </div>
      </div>
    </div>
  )
}
