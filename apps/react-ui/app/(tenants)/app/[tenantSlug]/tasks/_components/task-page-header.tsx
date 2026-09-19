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
    <header className="shrink-0 rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-4 sm:p-5">
      <h1 className="sr-only">Tasks</h1>

      <section
        className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4"
        aria-label="Task summary"
      >
        {summaryItems.map((item) => {
          const Icon = item.icon

          return (
            <Card
              key={item.valueKey}
              className="min-w-0 gap-0 rounded-[20px] border-white/80 bg-white/70 py-0 shadow-sm backdrop-blur sm:rounded-[22px]"
            >
              <CardHeader className="gap-0 px-3 pt-3 pb-0 sm:px-4 sm:pt-4">
                <CardTitle className="flex items-center gap-2 text-xs font-medium text-slate-500">
                  <Icon className="size-4 text-slate-400" aria-hidden="true" />
                  {item.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pt-2 pb-3 sm:px-4 sm:pb-4">
                <p
                  className={cn(
                    "truncate text-xl font-semibold tabular-nums",
                    item.valueClassName,
                  )}
                >
                  {summary[item.valueKey]}
                </p>
                <CardDescription className="mt-1 hidden text-xs sm:block">
                  {item.description}
                </CardDescription>
              </CardContent>
            </Card>
          )
        })}
      </section>

      <div className="mt-4">{action}</div>
    </header>
  )
}
