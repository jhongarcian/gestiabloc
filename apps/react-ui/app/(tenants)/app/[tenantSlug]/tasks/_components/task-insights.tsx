"use client"

import {
  AlertTriangle,
  CalendarCheck2,
  CalendarClock,
  CheckCheck,
  ClipboardList,
  Flame,
  UserX2,
} from "lucide-react"

type TaskInsightsProps = {
  summary: {
    totalTasks: number
    overdueTasks: number
    dueToday: number
    dueThisWeek: number
    highPriorityTasks: number
    unassignedTasks: number
    completedToday: number
    myPriorityCounts: {
      HIGH: number
      MEDIUM: number
      LOW: number
    }
  }
}

const insightItems = [
  {
    label: "Total Tasks",
    valueKey: "totalTasks",
    icon: ClipboardList,
  },
  {
    label: "Overdue",
    valueKey: "overdueTasks",
    icon: AlertTriangle,
  },
  {
    label: "Due Today",
    valueKey: "dueToday",
    icon: CalendarCheck2,
  },
  {
    label: "Due In 7 Days",
    valueKey: "dueThisWeek",
    icon: CalendarClock,
  },
  {
    label: "High Priority",
    valueKey: "highPriorityTasks",
    icon: Flame,
  },
  {
    label: "Unassigned",
    valueKey: "unassignedTasks",
    icon: UserX2,
  },
  {
    label: "Completed Today",
    valueKey: "completedToday",
    icon: CheckCheck,
  },
] as const

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

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {insightItems.map((item) => {
          const Icon = item.icon

          return (
            <div
              key={item.valueKey}
              className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm"
            >
              <div className="flex items-center gap-2 text-slate-500">
                <Icon className="h-4 w-4" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em]">
                  {item.label}
                </span>
              </div>
              <p className="mt-3 text-2xl font-semibold text-slate-950">
                {summary[item.valueKey]}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
