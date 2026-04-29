"use client"

import { isAxiosError } from "axios"
import { AlertTriangle, CalendarClock, ClipboardList, Clock3, UserRound } from "lucide-react"
import { type ReactNode, useCallback, useState } from "react"
import { toast } from "sonner"

import { DateTimeInput } from "@/components/ui/date-time-input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { api } from "@/lib/api"
import {
  type DateTimeDraft,
  dateTimeDraftToUtcIso,
  formatUtcIsoToDateTimeDraft,
} from "@/lib/date-time"
import {
  TaskStatusSelect,
  type TaskStatusOption,
} from "../../_components/task-status-select"

type TaskOverviewPanelProps = {
  tenantId: string
  tenantTimezone?: string | null
  taskId: string
  initialTask: {
    id: string
    name: string
    description: string | null
    assignedToUserId: string | null
    assignedPersonName: string | null
    priority: "HIGH" | "MEDIUM" | "LOW" | null
    dueDate: string | null
    startedAt: string | null
    status: string
    statusConfigId: string | null
    statusBgColor: string | null
    statusTextColor: string | null
    contactName: string | null
    linkedEntityName: string | null
    linkedEntityType: "SERVICE" | "PRODUCT" | null
    reminders: Array<{
      id: string
      remindAt: string
      message: string | null
      notifiedAt: string | null
      recipient: {
        id: string
        name: string
        email: string
      }
      createdBy: {
        id: string
        name: string
      }
    }>
  }
  statusOptions: TaskStatusOption[]
  assigneeOptions: Array<{
    label: string
    value: string
  }>
}

type TaskPatchPayload = {
  assignedToUserId?: string | null
  statusConfigId?: string | null
  dueDate?: string | null
  startedAt?: string
}

const NO_STATUS_VALUE = "__NO_STATUS__"
const UNASSIGNED_VALUE = "__UNASSIGNED__"

const formatLinkedEntity = (task: TaskOverviewPanelProps["initialTask"]) => {
  if (!task.linkedEntityName) return "—"
  if (!task.linkedEntityType) return task.linkedEntityName

  return `${task.linkedEntityType === "SERVICE" ? "Service" : "Product"}: ${task.linkedEntityName}`
}

function OverviewEditor({
  icon,
  label,
  children,
}: {
  icon: ReactNode
  label: string
  children: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
      <div className="flex items-center gap-2 text-slate-500">
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">
          {label}
        </span>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  )
}

function TaskStatusBadge({
  label,
  bgColor,
  textColor,
}: {
  label: string
  bgColor: string | null
  textColor: string | null
}) {
  return (
    <span
      className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700"
      style={
        bgColor && textColor
          ? {
              backgroundColor: bgColor,
              color: textColor,
            }
          : undefined
      }
    >
      {label}
    </span>
  )
}

function TaskPriorityBadge({
  priority,
}: {
  priority: "HIGH" | "MEDIUM" | "LOW" | null
}) {
  if (!priority) {
    return (
      <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
        No priority
      </span>
    )
  }

  const styles =
    priority === "HIGH"
      ? { backgroundColor: "#FEE2E2", color: "#B91C1C" }
      : priority === "MEDIUM"
        ? { backgroundColor: "#FEF3C7", color: "#B45309" }
        : { backgroundColor: "#DBEAFE", color: "#1D4ED8" }

  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={styles}
    >
      {priority} priority
    </span>
  )
}

export function TaskOverviewPanel({
  tenantId,
  tenantTimezone,
  taskId,
  initialTask,
  statusOptions,
  assigneeOptions,
}: TaskOverviewPanelProps) {
  const [task, setTask] = useState(initialTask)
  const [dueDateInput, setDueDateInput] = useState<DateTimeDraft>(
    formatUtcIsoToDateTimeDraft(initialTask.dueDate, tenantTimezone),
  )
  const [startedAtInput, setStartedAtInput] = useState<DateTimeDraft>(
    formatUtcIsoToDateTimeDraft(initialTask.startedAt, tenantTimezone),
  )
  const [savingField, setSavingField] = useState<string | null>(null)
  const patchTask = useCallback(
    async (patch: TaskPatchPayload, fieldName: string) => {
      const previousTask = task
      const nextStatusId =
        patch.statusConfigId !== undefined ? patch.statusConfigId : task.statusConfigId
      const nextStatus = statusOptions.find((option) => option.value === nextStatusId)
      const nextAssigneeId =
        patch.assignedToUserId !== undefined
          ? patch.assignedToUserId
          : task.assignedToUserId
      const nextAssignee = assigneeOptions.find(
        (option) => option.value === nextAssigneeId,
      )

      setSavingField(fieldName)
      setTask((current) => ({
        ...current,
        ...(patch.assignedToUserId !== undefined
          ? {
              assignedToUserId: patch.assignedToUserId,
              assignedPersonName: patch.assignedToUserId
                ? nextAssignee?.label ?? null
                : null,
            }
          : {}),
        ...(patch.statusConfigId !== undefined
          ? {
              statusConfigId: patch.statusConfigId,
              status: nextStatus?.label ?? "Unassigned",
              statusBgColor: nextStatus?.bgColor ?? null,
              statusTextColor: nextStatus?.textColor ?? null,
            }
          : {}),
        ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
        ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
      }))

      try {
        await api.patch(`/api/tasks/${tenantId}/${taskId}`, patch)
      } catch (error) {
        setTask(previousTask)
        setDueDateInput(formatUtcIsoToDateTimeDraft(previousTask.dueDate, tenantTimezone))
        setStartedAtInput(formatUtcIsoToDateTimeDraft(previousTask.startedAt, tenantTimezone))

        if (isAxiosError(error)) {
          const backendError = error.response?.data?.error
          toast.error(
            typeof backendError === "string"
              ? backendError.replace(/_/g, " ")
              : "Could not update task.",
          )
        } else {
          toast.error("Could not update task.")
        }
      } finally {
        setSavingField(null)
      }
    },
    [assigneeOptions, statusOptions, task, taskId, tenantId, tenantTimezone],
  )

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-[linear-gradient(145deg,#eff6ff_0%,#ffffff_38%,#f8fafc_100%)] shadow-sm">
      <div className="space-y-5 p-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-2">
              <h2 className="max-w-4xl text-2xl font-semibold tracking-tight text-slate-950">
                {task.name}
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <TaskStatusBadge
                  label={task.status}
                  bgColor={task.statusBgColor}
                  textColor={task.statusTextColor}
                />
                <TaskPriorityBadge priority={task.priority} />
              </div>
            </div>
            <span className="text-xs font-medium text-slate-400">
              {savingField ? "Saving changes..." : "Quick edit enabled"}
            </span>
          </div>

          <div className="w-full rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Description
            </p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">
              {task.description?.trim() ||
                "Track execution, dates, ownership, and reminders from one place."}
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <OverviewEditor
            icon={<CalendarClock className="h-4 w-4" />}
            label="Due Date"
          >
            <DateTimeInput
              value={dueDateInput}
              timezone={tenantTimezone}
              onValueChange={(value) => {
                setDueDateInput(value)
                const nextValue =
                  value.date && value.time
                    ? dateTimeDraftToUtcIso(value, tenantTimezone)
                    : null
                if (nextValue === task.dueDate) return
                void patchTask({ dueDate: nextValue }, "dueDate")
              }}
              disabled={savingField !== null}
              disabledDate={() => false}
            />
          </OverviewEditor>

          <OverviewEditor
            icon={<ClipboardList className="h-4 w-4" />}
            label="Status"
          >
            <TaskStatusSelect
              value={task.statusConfigId ?? NO_STATUS_VALUE}
              onValueChange={(value) => {
                const nextValue = value === NO_STATUS_VALUE ? null : value
                if (nextValue === task.statusConfigId) return
                void patchTask({ statusConfigId: nextValue }, "status")
              }}
              options={statusOptions}
              disabled={savingField !== null}
              placeholder="Unassigned"
              noneValue={NO_STATUS_VALUE}
              noneLabel="Unassigned"
            />
          </OverviewEditor>

          <OverviewEditor
            icon={<AlertTriangle className="h-4 w-4" />}
            label="Priority"
          >
            <TaskPriorityBadge priority={task.priority} />
          </OverviewEditor>

          <OverviewEditor
            icon={<UserRound className="h-4 w-4" />}
            label="Assignee"
          >
            <Select
              value={task.assignedToUserId ?? UNASSIGNED_VALUE}
              onValueChange={(value) => {
                const nextValue = value === UNASSIGNED_VALUE ? null : value
                if (nextValue === task.assignedToUserId) return
                void patchTask({ assignedToUserId: nextValue }, "assignee")
              }}
              disabled={savingField !== null}
            >
              <SelectTrigger className="w-full bg-white">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
                {assigneeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </OverviewEditor>

          <OverviewEditor icon={<Clock3 className="h-4 w-4" />} label="Start Date">
            <DateTimeInput
              value={startedAtInput}
              timezone={tenantTimezone}
              onValueChange={(value) => {
                setStartedAtInput(value)
                if (!value.date || !value.time) {
                  setStartedAtInput(
                    formatUtcIsoToDateTimeDraft(task.startedAt, tenantTimezone),
                  )
                  toast.error("Start date is required.")
                  return
                }

                const nextValue = dateTimeDraftToUtcIso(value, tenantTimezone)
                if (!nextValue || nextValue === task.startedAt) return
                void patchTask({ startedAt: nextValue }, "startedAt")
              }}
              disabled={savingField !== null}
              disabledDate={() => false}
            />
          </OverviewEditor>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Contact
            </p>
            <p className="mt-2 text-sm font-medium text-slate-900">
              {task.contactName ?? "—"}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Service / Product
            </p>
            <p className="mt-2 text-sm font-medium text-slate-900">
              {formatLinkedEntity(task)}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Reminders
            </p>
            <p className="mt-2 text-sm font-medium text-slate-900">
              {task.reminders.length} scheduled
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
