"use client"

import { isAxiosError } from "axios"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { formatDateTimeForDisplay } from "@/lib/date-time"
import {
  getAppointmentAuditLogs,
  type AppointmentStatus,
  type AppointmentAuditLogItem,
  type CalendarEventItem,
  updateAppointment,
} from "../../../../calendar/_lib/calendar-api"
import { EditAppointmentForm } from "../../../../calendar/_components/edit-appointment-sheet"

const INITIAL_VISIBLE_COUNT = 5
const LOAD_MORE_COUNT = 5
const APPOINTMENT_STATUS_OPTIONS = [
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "SHOW", label: "Show" },
  { value: "NO_SHOW", label: "No Show" },
  { value: "CANCELED", label: "Canceled" },
] as const

type ContactAppointmentsPanelProps = {
  tenantSlug: string
  tenantId: string
  tenantTimezone: string | null
  canViewAuditLogs: boolean
  items: CalendarEventItem[]
  meetingIntervalMinutes: 15 | 30 | 45 | 60 | 120
  meetingDurationMinutes: 15 | 30 | 45 | 60 | 120
  serviceOptions: Array<{
    id: string
    name: string
  }>
  assigneeOptions: Array<{
    id: string
    label: string
    email: string
    color?: string | null
  }>
}

function getInitials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase()
}

function formatAppointmentStatus(status: string) {
  const normalized = status.trim().toUpperCase()

  if (normalized === "SHOW") return "Show"
  if (normalized === "NO_SHOW") return "No Show"
  if (normalized === "CANCELED") return "Canceled"
  if (normalized === "CONFIRMED") return "Confirmed"
  if (normalized === "SCHEDULED") return "Scheduled"

  return normalized
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function getAppointmentStatusClass(status: string) {
  const normalized = status.trim().toUpperCase()

  if (normalized === "CANCELED") {
    return "border-rose-200 bg-rose-50 text-rose-700"
  }

  if (normalized === "NO_SHOW") {
    return "border-amber-200 bg-amber-50 text-amber-700"
  }

  if (normalized === "SHOW") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700"
  }

  if (normalized === "CONFIRMED") {
    return "border-sky-200 bg-sky-50 text-sky-700"
  }

  if (normalized === "RESCHEDULED") {
    return "border-violet-200 bg-violet-50 text-violet-700"
  }

  return "border-blue-200 bg-blue-50 text-blue-950"
}

function AuditTrailDialogContent({
  logs,
  tenantTimezone,
  isLoading,
  error,
}: {
  logs: AppointmentAuditLogItem[]
  tenantTimezone: string | null
  isLoading: boolean
  error: string | null
}) {
  return (
    <div className="space-y-1">
      <DialogHeader>
        <DialogTitle>Audit Log</DialogTitle>
        <DialogDescription>
          Review the appointment activity history for this booking.
        </DialogDescription>
      </DialogHeader>

      {isLoading ? (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-12 rounded-xl" />
          <Skeleton className="h-12 rounded-xl" />
        </div>
      ) : error ? (
        <p className="mt-4 text-sm text-rose-600">{error}</p>
      ) : logs.length > 0 ? (
        <div className="mt-4 space-y-4">
          {logs.map((log) => (
            <div
              key={log.id}
              className="border-b border-slate-100 pb-4 last:border-b-0 last:pb-0"
            >
              <p className="text-sm leading-6 text-slate-700">{log.message}</p>
              <p className="mt-1 text-xs text-slate-400">
                {formatDateTimeForDisplay(log.createdAt, tenantTimezone)}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">
          No audit activity has been recorded for this appointment.
        </p>
      )}
    </div>
  )
}

export function ContactAppointmentsPanel({
  tenantSlug,
  tenantId,
  tenantTimezone,
  canViewAuditLogs,
  items,
  meetingIntervalMinutes,
  meetingDurationMinutes,
  serviceOptions,
  assigneeOptions,
}: ContactAppointmentsPanelProps) {
  const router = useRouter()
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT)
  const [appointments, setAppointments] = useState(items)
  const [selectedAppointment, setSelectedAppointment] =
    useState<CalendarEventItem | null>(null)
  const [selectedAppointmentAuditLogs, setSelectedAppointmentAuditLogs] =
    useState<AppointmentAuditLogItem[]>([])
  const [isLoadingAppointmentAuditLogs, setIsLoadingAppointmentAuditLogs] =
    useState(false)
  const [appointmentAuditLogsError, setAppointmentAuditLogsError] = useState<
    string | null
  >(null)
  const [selectedStatus, setSelectedStatus] = useState<AppointmentStatus>("SCHEDULED")
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false)
  const [isEditingAppointment, setIsEditingAppointment] = useState(false)
  const [isCancelingAppointment, setIsCancelingAppointment] = useState(false)
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false)
  const [isAuditDialogOpen, setIsAuditDialogOpen] = useState(false)

  useEffect(() => {
    setAppointments(items)
  }, [items])

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_COUNT)
  }, [items.length])

  useEffect(() => {
    if (!selectedAppointment) {
      setSelectedAppointmentAuditLogs([])
      setAppointmentAuditLogsError(null)
      setIsLoadingAppointmentAuditLogs(false)
      setSelectedStatus("SCHEDULED")
      setIsUpdatingStatus(false)
      setIsEditingAppointment(false)
      setIsCancelDialogOpen(false)
      setIsAuditDialogOpen(false)
      return
    }

    setSelectedStatus(
      (selectedAppointment.status as AppointmentStatus) ?? "SCHEDULED",
    )
  }, [selectedAppointment])
  const drawerAppointment = selectedAppointment

  const selectedAssignee = useMemo(
    () =>
      drawerAppointment?.assignedToUserId
        ? (assigneeOptions.find(
            (user) => user.id === drawerAppointment.assignedToUserId,
          ) ?? null)
        : null,
    [assigneeOptions, drawerAppointment],
  )

  const visibleAppointments = appointments.slice(0, visibleCount)
  const hasMoreAppointments = visibleCount < appointments.length

  const onCancelAppointment = async () => {
    if (!drawerAppointment) return

    setIsCancelingAppointment(true)
    try {
      await updateAppointment(tenantId, drawerAppointment.id, {
        status: "CANCELED",
      })

      toast.success("Appointment canceled.")
      setIsCancelDialogOpen(false)
      setSelectedAppointment(null)
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not cancel appointment.",
        )
      } else {
        toast.error("Could not cancel appointment.")
      }
    } finally {
      setIsCancelingAppointment(false)
    }
  }

  const onOpenAuditLog = async () => {
    if (!drawerAppointment || !canViewAuditLogs) return

    setIsAuditDialogOpen(true)
    setSelectedAppointmentAuditLogs([])
    setAppointmentAuditLogsError(null)
    setIsLoadingAppointmentAuditLogs(true)

    try {
      const response = await getAppointmentAuditLogs(
        tenantId,
        drawerAppointment.id,
      )
      setSelectedAppointmentAuditLogs(response.items)
    } catch {
      setAppointmentAuditLogsError(
        "Could not load the audit trail for this appointment.",
      )
    } finally {
      setIsLoadingAppointmentAuditLogs(false)
    }
  }

  const onUpdateStatus = async () => {
    if (!drawerAppointment || selectedStatus === drawerAppointment.status)
      return

    setIsUpdatingStatus(true)
    try {
      const response = await updateAppointment(tenantId, drawerAppointment.id, {
        status: selectedStatus,
      })

      setSelectedAppointment((current) =>
        current
          ? {
              ...current,
              status: response.item.status,
            }
          : current,
      )
      toast.success("Appointment status updated.")
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        if (
          error.response?.status === 409 &&
          backendError === "APPOINTMENT_TIME_UNAVAILABLE"
        ) {
          setSelectedStatus(drawerAppointment.status)
          toast.error("This slot has been taken already. Choose another time.")
          return
        }
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not update appointment status.",
        )
      } else {
        toast.error("Could not update appointment status.")
      }

      setSelectedStatus(drawerAppointment.status)
    } finally {
      setIsUpdatingStatus(false)
    }
  }

  return (
    <>
      {appointments.length > 0 ? (
        <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
          <div className="hidden border-b border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,1.3fr)_auto] lg:gap-4">
            <span>Appointment</span>
            <span>Service</span>
            <span>Assigned</span>
            <span>Start</span>
            <span>Status</span>
          </div>

          <div className="divide-y divide-slate-200">
            {visibleAppointments.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedAppointment(item)}
                className="grid w-full cursor-pointer gap-3 px-4 py-3 text-left transition hover:bg-slate-50 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,1.3fr)_auto] lg:items-center lg:gap-4"
              >
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-semibold text-slate-950">
                    {item.title}
                  </p>
                  <p className="truncate text-xs text-slate-500 lg:hidden">
                    {formatDateTimeForDisplay(item.startAt, tenantTimezone)}
                  </p>
                </div>

                <p className="truncate text-sm text-slate-600">
                  {item.serviceName ?? "No service"}
                </p>

                <p className="truncate text-sm text-slate-600">
                  {item.assignedToLabel}
                </p>

                <p className="hidden text-sm text-slate-600 lg:block">
                  {formatDateTimeForDisplay(item.startAt, tenantTimezone)}
                </p>

                <Badge
                  variant="secondary"
                  className={`w-fit rounded-full border px-3 py-1 ${getAppointmentStatusClass(item.status)}`}
                >
                  {formatAppointmentStatus(item.status)}
                </Badge>
              </button>
            ))}
          </div>

          {hasMoreAppointments ? (
            <div className="border-t border-slate-200 px-4 py-4">
              <Button
                type="button"
                variant="outline"
                className="border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
                onClick={() =>
                  setVisibleCount((current) =>
                    Math.min(current + LOAD_MORE_COUNT, appointments.length),
                  )
                }
              >
                Show 5 more appointments
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
          <p className="font-medium text-slate-900">
            No appointments for this contact yet.
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Appointments linked to this contact will appear here once they are
            created.
          </p>
        </div>
      )}

      <Sheet
        open={Boolean(selectedAppointment)}
        onOpenChange={(open) => {
          if (!open) {
            setIsEditingAppointment(false)
            setSelectedAppointment(null)
          }
        }}
      >
        <SheetContent
          side="right"
          className="flex h-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
        >
          {drawerAppointment ? (
            <>
              <SheetHeader className="border-b border-slate-200 bg-slate-50 px-6  text-left">
                <SheetTitle className="text-xl font-semibold text-slate-950">
                  {isEditingAppointment
                    ? "Edit Appointment"
                    : "Appointment Details"}
                </SheetTitle>
                <SheetDescription className="mt-1">
                  {isEditingAppointment
                    ? "Update the assignment, slot, service, and notes while keeping booking conflicts protected."
                    : "Review the appointment details for this booking."}
                </SheetDescription>
              </SheetHeader>

              {isEditingAppointment ? (
                <EditAppointmentForm
                  tenantId={tenantId}
                  tenantTimezone={tenantTimezone}
                  appointment={drawerAppointment}
                  meetingIntervalMinutes={meetingIntervalMinutes}
                  meetingDurationMinutes={meetingDurationMinutes}
                  serviceOptions={serviceOptions}
                  assigneeOptions={assigneeOptions}
                  onCancel={() => setIsEditingAppointment(false)}
                  onUpdated={async () => {
                    setIsEditingAppointment(false)
                    setSelectedAppointment(null)
                    router.refresh()
                  }}
                />
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <section className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
                    <Badge
                      variant="secondary"
                      className={`w-fit rounded-full border px-3 py-1 ${getAppointmentStatusClass(drawerAppointment.status)}`}
                    >
                      {formatAppointmentStatus(drawerAppointment.status)}
                    </Badge>
                    {canViewAuditLogs ? (
                      <Button
                        type="button"
                        variant="link"
                        className="p-0 text-blue-600 hover:text-blue-700"
                        onClick={() => void onOpenAuditLog()}
                      >
                        View Audit Log
                      </Button>
                    ) : null}
                  </section>

                  <section className="border-b border-slate-200 px-6 py-6">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Appointment
                    </p>
                    <div className="mt-3 space-y-4">
                      <p className="text-lg font-semibold leading-tight text-slate-950">
                        {drawerAppointment.title}
                      </p>
                      {drawerAppointment.serviceName ? (
                        <p className="text-sm text-slate-600">
                          Related service: {drawerAppointment.serviceName}
                        </p>
                      ) : null}
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Status
                        </p>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <Select
                            value={selectedStatus}
                            onValueChange={(value) =>
                              setSelectedStatus(value as AppointmentStatus)
                            }
                          >
                            <SelectTrigger className="border-blue-200 focus-visible:ring-blue-200 sm:w-[220px]">
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                            <SelectContent>
                              {APPOINTMENT_STATUS_OPTIONS.map((option) => (
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                >
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            variant="outline"
                            className="border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
                            disabled={
                              isUpdatingStatus ||
                              selectedStatus === drawerAppointment.status
                            }
                            onClick={() => void onUpdateStatus()}
                          >
                            {isUpdatingStatus ? "Saving..." : "Save status"}
                          </Button>
                        </div>
                      </div>
                      {drawerAppointment.notes ? (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Notes
                          </p>
                          <p className="whitespace-pre-wrap text-sm leading-6 text-slate-600">
                            {drawerAppointment.notes}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </section>

                  <section className="border-b border-slate-200 px-6 py-6">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Schedule
                    </p>
                    <div className="mt-4 flex flex-wrap gap-8">
                      <div className="flex flex-col gap-1">
                        <p className="text-sm font-medium text-slate-900">
                          Start
                        </p>
                        <p className="text-sm text-slate-600">
                          {formatDateTimeForDisplay(
                            drawerAppointment.startAt,
                            tenantTimezone,
                          )}
                        </p>
                      </div>
                      <div className="flex flex-col gap-1">
                        <p className="text-sm font-medium text-slate-900">
                          End
                        </p>
                        <p className="text-sm text-slate-600">
                          {formatDateTimeForDisplay(
                            drawerAppointment.endAt,
                            tenantTimezone,
                          )}
                        </p>
                      </div>
                    </div>
                  </section>

                  <section className="border-b border-slate-200 px-6 py-6">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-4">
                        <Avatar
                          size="lg"
                          className="shrink-0 border border-slate-200 shadow-sm"
                        >
                          <AvatarImage
                            src={drawerAppointment.assignedToImage ?? undefined}
                            alt={drawerAppointment.assignedToLabel}
                          />
                          <AvatarFallback>
                            {getInitials(drawerAppointment.assignedToLabel)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Assigned Staff
                          </p>
                          <p className="mt-1 text-base font-semibold text-slate-950">
                            {drawerAppointment.assignedToLabel}
                          </p>
                          {selectedAssignee?.email ? (
                            <p className="mt-1 truncate text-sm text-slate-500">
                              {selectedAssignee.email}
                            </p>
                          ) : (
                            <p className="mt-1 text-sm text-slate-400">
                              No email available
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="px-6 py-6">
                    <div className="flex items-center gap-4">
                      <Avatar
                        size="lg"
                        className="shrink-0 border border-slate-200 shadow-sm"
                      >
                        <AvatarFallback>
                          {getInitials(drawerAppointment.contactName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Contact
                        </p>
                        <Link
                          href={`/app/${tenantSlug}/contacts/${drawerAppointment.contactId}/overview`}
                          className="mt-1 block truncate text-base font-semibold text-slate-950 transition hover:text-blue-950 hover:underline"
                        >
                          {drawerAppointment.contactName}
                        </Link>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-500">
                          <span>
                            {drawerAppointment.contactEmail ??
                              "No email available"}
                          </span>
                          <span>
                            {drawerAppointment.contactPhone ??
                              "No phone available"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
              )}
            </>
          ) : null}
          {!isEditingAppointment && drawerAppointment ? (
            <SheetFooter className="border-t border-slate-200 px-6 py-4">
              {drawerAppointment.status !== "CANCELED" ? (
                <Button
                  type="button"
                  variant="outline"
                  className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                  disabled={isCancelingAppointment}
                  onClick={() => setIsCancelDialogOpen(true)}
                >
                  {isCancelingAppointment ? "Canceling..." : "Cancel appointment"}
                </Button>
              ) : null}
              <Button
                type="button"
                className="bg-blue-950 text-white hover:bg-blue-900"
                onClick={() => setIsEditingAppointment(true)}
              >
                Edit appointment
              </Button>
            </SheetFooter>
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog open={isAuditDialogOpen} onOpenChange={setIsAuditDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <AuditTrailDialogContent
            logs={selectedAppointmentAuditLogs}
            tenantTimezone={tenantTimezone}
            isLoading={isLoadingAppointmentAuditLogs}
            error={appointmentAuditLogsError}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel appointment</DialogTitle>
            <DialogDescription>
              {drawerAppointment
                ? `Are you sure you want to cancel "${drawerAppointment.title}"?`
                : "Are you sure you want to cancel this appointment?"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsCancelDialogOpen(false)}
            >
              Keep appointment
            </Button>
            <Button
              type="button"
              className="bg-rose-700 text-white hover:bg-rose-800"
              disabled={isCancelingAppointment}
              onClick={() => void onCancelAppointment()}
            >
              {isCancelingAppointment
                ? "Canceling..."
                : "Yes, cancel appointment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
