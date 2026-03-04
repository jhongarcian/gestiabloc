"use client"

import { History, PencilLine } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { formatDateTimeForDisplay } from "@/lib/date-time"

type TaskActivityPanelProps = {
  tenantTimezone?: string | null
  activities: Array<{
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
  }>
}

export function TaskActivityPanel({
  tenantTimezone,
  activities,
}: TaskActivityPanelProps) {
  return (
    <Card className="border-slate-200">
      <CardHeader className="border-b border-slate-100">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-slate-500" />
          Activity History
        </CardTitle>
        <CardDescription>
          Recent task changes, reminders, and assignment updates.
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-6">
        {activities.length ? (
          <div className="space-y-4">
            {activities.map((activity, index) => (
              <div key={activity.id} className="flex gap-3">
                <div className="flex w-5 flex-col items-center">
                  <span className="mt-1 flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500">
                    <PencilLine className="h-3.5 w-3.5" />
                  </span>
                  {index < activities.length - 1 ? (
                    <span className="mt-2 h-full w-px bg-slate-200" />
                  ) : null}
                </div>

                <div className="min-w-0 flex-1 space-y-1 pb-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-slate-950">
                        {activity.title}
                      </p>
                      <p className="text-xs text-slate-500">
                        {activity.actor?.name?.trim() || activity.actor?.email || "System"}
                      </p>
                    </div>
                    <p className="shrink-0 text-xs text-slate-500">
                      {formatDateTimeForDisplay(activity.createdAt, tenantTimezone, true)}
                    </p>
                  </div>

                  {activity.details ? (
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-600">
                      {activity.details}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Activity will appear here once this task starts changing.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

