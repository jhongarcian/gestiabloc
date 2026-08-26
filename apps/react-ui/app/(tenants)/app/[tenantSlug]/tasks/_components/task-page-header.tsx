"use client"

import type { ReactNode } from "react"
import {
  AlertTriangle,
  CalendarCheck2,
  ClipboardList,
  type LucideIcon,
  UserX2,
} from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

export type TaskSummary = {
  totalTasks: number
  overdueTasks: number
  dueToday: number
  unassignedTasks: number
}

type TaskPageHeaderProps = {
  summary: TaskSummary
  action: ReactNode
}

type SummaryItem = {
  label: string
  description: string
  valueKey: keyof TaskSummary
  icon: LucideIcon
  valueClassName: string
}

const summaryItems: SummaryItem[] = [
  {
    label: "Total tasks",
    description: "All tasks across active and completed work.",
    valueKey: "totalTasks",
    icon: ClipboardList,
    valueClassName: "text-slate-950",
  },
  {
    label: "Overdue",
    description: "Open tasks with due dates already in the past.",
    valueKey: "overdueTasks",
    icon: AlertTriangle,
    valueClassName: "text-rose-700",
  },
  {
    label: "Due today",
    description: "Open tasks that need attention before the day ends.",
    valueKey: "dueToday",
    icon: CalendarCheck2,
    valueClassName: "text-amber-700",
  },
  {
    label: "Unassigned",
    description: "Open tasks that do not yet have an owner.",
    valueKey: "unassignedTasks",
    icon: UserX2,
    valueClassName: "text-slate-950",
  },
]

export function TaskPageHeader({ summary, action }: TaskPageHeaderProps) {
  return (
    <header className="shrink-0 rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-xs font-semibold text-blue-700">Task management</p>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold text-slate-950">Tasks</h1>
            <p className="text-sm text-slate-600">
              Review priorities, deadlines, and ownership across your team&apos;s work.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center md:self-center">
          {action}
        </div>
      </div>

      <section
        className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Task summary"
      >
        {summaryItems.map((item) => {
          const Icon = item.icon

          return (
            <Card
              key={item.valueKey}
              className="min-w-0 gap-0 rounded-[22px] border-white/80 bg-white/70 py-0 shadow-sm backdrop-blur"
            >
              <CardHeader className="gap-0 px-4 pt-4 pb-0">
                <CardTitle className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  <Icon className="size-4 text-slate-400" aria-hidden="true" />
                  {item.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pt-2 pb-4">
                <p
                  className={cn(
                    "truncate text-xl font-semibold tabular-nums tracking-tight",
                    item.valueClassName,
                  )}
                >
                  {summary[item.valueKey]}
                </p>
                <CardDescription className="mt-1 text-xs">
                  {item.description}
                </CardDescription>
              </CardContent>
            </Card>
          )
        })}
      </section>
    </header>
  )
}
