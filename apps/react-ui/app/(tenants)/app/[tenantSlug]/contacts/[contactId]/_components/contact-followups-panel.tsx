"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { isAxiosError } from "axios"
import { ListTodo, NotebookPen, Plus } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DateTimeInput } from "@/components/ui/date-time-input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import {
  dateTimeDraftToUtcIso,
  formatUtcIsoToDateTimeDraft,
  isDateTimeDraftComplete,
  isDateTimeDraftEmpty,
  type DateTimeDraft,
} from "@/lib/date-time"

type FollowUpStep = {
  id: string
  title: string
  notesTemplate?: string | null
  status?: "PENDING" | "ACTIVE" | "COMPLETED" | "SKIPPED" | "POSTPONED"
  availableAt: string | null
  dueAt: string | null
  completedAt: string | null
  note?: string | null
  sortOrder: number
}

type ContactServiceItem = {
  id: string
  service: {
    id: string
    name: string
  }
  followUpTemplate: {
    id: string
    name: string
  } | null
  followUpSteps: FollowUpStep[]
}

type ContactServicesResponse = {
  ok: boolean
  items: ContactServiceItem[]
}

type FlattenedStep = FollowUpStep & {
  contactServiceId: string
  serviceName: string
  templateName: string | null
}

type ServiceFollowUpView = {
  contactServiceId: string
  serviceName: string
  templateName: string | null
  steps: FlattenedStep[]
  completedCount: number
  totalCount: number
  remainingCount: number
  completionPercentage: number
}

type ContactFollowUpsPanelProps = {
  tenantId: string
  contactId: string
}

type StepTimeMeta = {
  label: string
  helper: string
  badgeClassName: string
}

const isBeforeToday = (date: Date) => {
  const candidate = new Date(date)
  candidate.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return candidate < today
}

const toInputDateTime = (value: string | null) => {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const offset = date.getTimezoneOffset() * 60_000
  const local = new Date(date.getTime() - offset)
  return local.toISOString().slice(0, 16)
}

const fromInputDateTime = (value: string) => {
  if (!value.trim()) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

const getStepTimeMeta = (step: FlattenedStep): StepTimeMeta => {
  if (step.status === "COMPLETED") {
    return {
      label: "Completed",
      helper: step.completedAt ? new Date(step.completedAt).toLocaleString() : "Marked as completed",
      badgeClassName: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
    }
  }
  if (step.status === "POSTPONED") {
    return {
      label: "Postponed",
      helper: step.dueAt ? `Now due ${new Date(step.dueAt).toLocaleString()}` : "Postponed",
      badgeClassName: "bg-violet-100 text-violet-800 hover:bg-violet-100",
    }
  }
  if (!step.dueAt) {
    return {
      label: "No due date",
      helper: "No due date configured",
      badgeClassName: "bg-slate-100 text-slate-700 hover:bg-slate-100",
    }
  }

  const dueDate = new Date(step.dueAt)
  const diffMs = dueDate.getTime() - Date.now()
  const diffHours = Math.round(diffMs / (1000 * 60 * 60))

  if (diffMs < 0) {
    return {
      label: "Overdue",
      helper: `Due ${dueDate.toLocaleString()}`,
      badgeClassName: "bg-rose-100 text-rose-800 hover:bg-rose-100",
    }
  }

  if (diffHours <= 24) {
    return {
      label: "Due soon",
      helper: `Due ${dueDate.toLocaleString()}`,
      badgeClassName: "bg-amber-100 text-amber-800 hover:bg-amber-100",
    }
  }

  return {
    label: "Upcoming",
    helper: `Due ${dueDate.toLocaleString()}`,
    badgeClassName: "bg-sky-100 text-sky-800 hover:bg-sky-100",
  }
}

export function ContactFollowUpsPanel({ tenantId, contactId }: ContactFollowUpsPanelProps) {
  const router = useRouter()
  const [services, setServices] = useState<ContactServiceItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [mutatingStepId, setMutatingStepId] = useState<string | null>(null)

  const [createContactServiceId, setCreateContactServiceId] = useState("")
  const [createTitle, setCreateTitle] = useState("")
  const [createDueAt, setCreateDueAt] = useState("")
  const [createNotes, setCreateNotes] = useState("")

  const [isNoteDialogOpen, setIsNoteDialogOpen] = useState(false)
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false)
  const [isStepStatusDialogOpen, setIsStepStatusDialogOpen] = useState(false)
  const [isStepDetailsDialogOpen, setIsStepDetailsDialogOpen] = useState(false)
  const [activeStepContext, setActiveStepContext] = useState<FlattenedStep | null>(null)
  const [stepStatusValue, setStepStatusValue] = useState<FollowUpStep["status"]>("PENDING")
  const [stepStatusNote, setStepStatusNote] = useState("")
  const [stepPostponeInput, setStepPostponeInput] = useState<DateTimeDraft>({ date: "", time: "" })
  const [isSavingStepStatus, setIsSavingStepStatus] = useState(false)
  const [stepNoteTitle, setStepNoteTitle] = useState("")
  const [stepNoteBody, setStepNoteBody] = useState("")
  const [isSavingStepNote, setIsSavingStepNote] = useState(false)
  const [stepTaskName, setStepTaskName] = useState("")
  const [stepTaskDescription, setStepTaskDescription] = useState("")
  const [stepTaskDueAt, setStepTaskDueAt] = useState("")
  const [isSavingStepTask, setIsSavingStepTask] = useState(false)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const { data } = await api.get<ContactServicesResponse>(`/api/services/${tenantId}/contact-services`, {
        params: {
          page: 1,
          pageSize: 25,
          contactId,
        },
      })
      setServices(data.items)
    } catch {
      setServices([])
      toast.error("Could not load follow-up records.")
    } finally {
      setIsLoading(false)
    }
  }, [tenantId, contactId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const servicesView = useMemo<ServiceFollowUpView[]>(() => {
    return services.map((service) => {
      const steps = (service.followUpSteps ?? [])
        .map((step) => ({
          ...step,
          status: step.status ?? (step.completedAt ? "COMPLETED" : "PENDING"),
          contactServiceId: service.id,
          serviceName: service.service.name,
          templateName: service.followUpTemplate?.name ?? null,
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder)
      const totalCount = steps.length
      const completedCount = steps.filter(
        (step) => step.status === "COMPLETED" || step.status === "SKIPPED",
      ).length
      const remainingCount = Math.max(0, totalCount - completedCount)
      const completionPercentage = totalCount ? Math.round((completedCount / totalCount) * 100) : 0

      return {
        contactServiceId: service.id,
        serviceName: service.service.name,
        templateName: service.followUpTemplate?.name ?? null,
        steps,
        completedCount,
        totalCount,
        remainingCount,
        completionPercentage,
      }
    })
  }, [services])

  const onCreate = async () => {
    if (!createContactServiceId) {
      toast.error("Select an enrolled service.")
      return
    }
    if (!createTitle.trim()) {
      toast.error("Title is required.")
      return
    }

    setIsSaving(true)
    try {
      await api.post(`/api/services/${tenantId}/contact-services/${createContactServiceId}/follow-up-steps`, {
        title: createTitle.trim(),
        ...(fromInputDateTime(createDueAt) ? { dueAt: fromInputDateTime(createDueAt) } : {}),
        ...(createNotes.trim() ? { notesTemplate: createNotes.trim() } : {}),
      })
      toast.success("Follow-up created.")
      setCreateContactServiceId("")
      setCreateTitle("")
      setCreateDueAt("")
      setCreateNotes("")
      setIsCreateOpen(false)
      await loadData()
      router.refresh()
    } catch {
      toast.error("Could not create follow-up.")
    } finally {
      setIsSaving(false)
    }
  }

  const updateStepStatus = async (
    step: FlattenedStep,
    nextStatus: FollowUpStep["status"],
    note?: string,
    postponeTo?: string,
  ) => {
    if (!nextStatus) return
    setMutatingStepId(step.id)
    try {
      await api.patch(
        `/api/services/${tenantId}/contact-services/${step.contactServiceId}/follow-up-steps/${step.id}`,
        {
          status: nextStatus,
          ...(note?.trim() ? { note: note.trim() } : {}),
          ...(postponeTo ? { postponeTo, cascadeFutureSteps: true } : {}),
        },
      )
      toast.success(nextStatus === "COMPLETED" ? "Step marked as completed." : "Step status updated.")
      await loadData()
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(typeof backendError === "string" ? backendError.replace(/_/g, " ") : "Could not update this follow-up step.")
      } else {
        toast.error("Could not update this follow-up step.")
      }
    } finally {
      setMutatingStepId(null)
    }
  }

  const openStepStatusDialog = (step: FlattenedStep) => {
    setActiveStepContext(step)
    setStepStatusValue(step.status ?? "PENDING")
    setStepStatusNote("")
    setStepPostponeInput(formatUtcIsoToDateTimeDraft(step.dueAt, "America/Chicago"))
    setIsStepStatusDialogOpen(true)
  }

  const openStepDetailsDialog = (step: FlattenedStep) => {
    setActiveStepContext(step)
    setIsStepDetailsDialogOpen(true)
  }

  const saveStepStatus = async () => {
    if (!activeStepContext || !stepStatusValue) return
    if (
      stepStatusValue === "POSTPONED" &&
      (!isDateTimeDraftComplete(stepPostponeInput) ||
        isDateTimeDraftEmpty(stepPostponeInput))
    ) {
      toast.error("Postpone date/time is required.")
      return
    }
    if (
      stepStatusValue === "POSTPONED" &&
      !isDateTimeDraftEmpty(stepPostponeInput) &&
      !isDateTimeDraftComplete(stepPostponeInput)
    ) {
      toast.error("Postpone date/time is incomplete.")
      return
    }
    const postponeToIso = stepStatusValue !== "POSTPONED" || isDateTimeDraftEmpty(stepPostponeInput)
      ? undefined
      : dateTimeDraftToUtcIso(stepPostponeInput, "America/Chicago") ?? undefined
    setIsSavingStepStatus(true)
    await updateStepStatus(
      activeStepContext,
      stepStatusValue,
      stepStatusNote,
      postponeToIso,
    )
    setIsSavingStepStatus(false)
    setIsStepStatusDialogOpen(false)
    setActiveStepContext(null)
    setStepStatusNote("")
    setStepPostponeInput({ date: "", time: "" })
  }

  const openStepNoteDialog = (step: FlattenedStep) => {
    setActiveStepContext(step)
    setStepNoteTitle(`${step.serviceName} - ${step.title}`)
    setStepNoteBody("")
    setIsNoteDialogOpen(true)
  }

  const saveStepNote = async () => {
    if (!activeStepContext) return
    if (!stepNoteTitle.trim() || !stepNoteBody.trim()) {
      toast.error("Title and note body are required.")
      return
    }

    setIsSavingStepNote(true)
    try {
      await api.post(`/api/contacts/${tenantId}/${contactId}/notes`, {
        title: stepNoteTitle.trim(),
        body: `Service: ${activeStepContext.serviceName}\nStep: ${activeStepContext.title}\n\n${stepNoteBody.trim()}`,
      })
      toast.success("Step note created.")
      setIsNoteDialogOpen(false)
      setActiveStepContext(null)
      setStepNoteTitle("")
      setStepNoteBody("")
      router.refresh()
    } catch {
      toast.error("Could not create a note for this step.")
    } finally {
      setIsSavingStepNote(false)
    }
  }

  const openStepTaskDialog = (step: FlattenedStep) => {
    setActiveStepContext(step)
    setStepTaskName(`Follow-up: ${step.title}`)
    setStepTaskDescription(`Service: ${step.serviceName}\nStep: ${step.title}`)
    setStepTaskDueAt(toInputDateTime(step.dueAt))
    setIsTaskDialogOpen(true)
  }

  const saveStepTask = async () => {
    if (!activeStepContext) return
    if (!stepTaskName.trim()) {
      toast.error("Task title is required.")
      return
    }

    setIsSavingStepTask(true)
    try {
      await api.post(`/api/tasks/${tenantId}`, {
        name: stepTaskName.trim(),
        contactId,
        description: stepTaskDescription.trim() || null,
        linkedEntityName: `${activeStepContext.serviceName} - ${activeStepContext.title}`,
        linkedEntityType: "SERVICE",
        dueDate: fromInputDateTime(stepTaskDueAt),
        startedAt: new Date().toISOString(),
      })
      toast.success("Task created for follow-up step.")
      setIsTaskDialogOpen(false)
      setActiveStepContext(null)
      setStepTaskName("")
      setStepTaskDescription("")
      setStepTaskDueAt("")
      router.refresh()
    } catch {
      toast.error("Could not create task for this step.")
    } finally {
      setIsSavingStepTask(false)
    }
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Contact Follow-Ups</p>
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Follow-up records</h1>
              <p className="text-sm text-slate-600">Track, edit, and complete follow-up steps after service purchase enrollment.</p>
            </div>
          </div>
          <Button type="button" onClick={() => setIsCreateOpen(true)} className="cursor-pointer md:self-center">
            <Plus className="h-4 w-4" />
            Add follow-up
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-[20px] border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Loading follow-ups...
        </div>
      ) : servicesView.length ? (
        <TooltipProvider>
          <div className="space-y-4">
          {servicesView.map((service) => (
            <section key={service.contactServiceId} className="rounded-[20px] border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <h3 className="text-base font-semibold text-slate-900">{service.serviceName}</h3>
                  <p className="text-xs font-medium text-slate-600">
                    Template: {service.templateName ?? "No template selected"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {service.completedCount} of {service.totalCount} steps completed
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                    {service.completionPercentage}% complete
                  </Badge>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="w-[180px] cursor-pointer">
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full rounded-full bg-emerald-500 transition-all"
                            style={{ width: `${service.completionPercentage}%` }}
                          />
                        </div>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56" align="end">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-slate-900">
                          {service.completionPercentage}% Completed
                        </p>
                        <p className="text-xs text-slate-600">
                          {service.completedCount} completed, {service.remainingCount} remaining out of{" "}
                          {service.totalCount} steps.
                        </p>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Step</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-[260px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {service.steps.length ? (
                      service.steps.map((step) => {
                        const timeMeta = getStepTimeMeta(step)
                        const isStatusLocked = (step.status ?? "PENDING") === "PENDING"
                        return (
                          <TableRow key={step.id}>
                            <TableCell>
                              <button
                                type="button"
                                className="cursor-pointer text-left font-medium text-slate-900 transition hover:text-slate-700"
                                onClick={() => openStepDetailsDialog(step)}
                              >
                                {step.title}
                              </button>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                <Badge className={timeMeta.badgeClassName}>{timeMeta.label}</Badge>
                                <p className="text-xs text-slate-500">{timeMeta.helper}</p>
                              </div>
                            </TableCell>
                            <TableCell>
                              {!isStatusLocked ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="min-w-[136px] cursor-pointer justify-center capitalize"
                                  disabled={mutatingStepId === step.id}
                                  onClick={() => openStepStatusDialog(step)}
                                >
                                  {(step.status ?? "PENDING").toLowerCase().replace(/_/g, " ")}
                                </Button>
                              ) : (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="inline-flex">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="min-w-[136px] cursor-not-allowed justify-center capitalize"
                                        disabled
                                      >
                                        {(step.status ?? "PENDING").toLowerCase().replace(/_/g, " ")}
                                      </Button>
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" sideOffset={6}>
                                    Status locked until this step becomes active.
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="cursor-pointer"
                                  onClick={() => openStepNoteDialog(step)}
                                >
                                  <NotebookPen className="h-3.5 w-3.5" />
                                  Add note
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="cursor-pointer"
                                  onClick={() => openStepTaskDialog(step)}
                                >
                                  <ListTodo className="h-3.5 w-3.5" />
                                  Create task
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })
                    ) : (
                      <TableRow>
                        <TableCell colSpan={4} className="h-16 text-center text-slate-500">
                          No follow-up steps configured for this service yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </section>
          ))}
          </div>
        </TooltipProvider>
      ) : (
        <div className="rounded-[20px] border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          No follow-up services enrolled yet.
        </div>
      )}

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add follow-up step</DialogTitle>
            <DialogDescription>Create a follow-up step under an enrolled service.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid gap-2">
              <Label>Enrolled service</Label>
              <Select value={createContactServiceId} onValueChange={setCreateContactServiceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select enrolled service" />
                </SelectTrigger>
                <SelectContent>
                  {services.map((service) => (
                    <SelectItem key={service.id} value={service.id} className="cursor-pointer">
                      {service.service.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Title</Label>
              <Input value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Due date</Label>
              <Input type="datetime-local" value={createDueAt} onChange={(event) => setCreateDueAt(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Notes template</Label>
              <Textarea value={createNotes} onChange={(event) => setCreateNotes(event.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)} disabled={isSaving}>Cancel</Button>
            <Button type="button" onClick={() => void onCreate()} disabled={isSaving}>{isSaving ? "Saving..." : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isStepStatusDialogOpen} onOpenChange={setIsStepStatusDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Update step status</DialogTitle>
            <DialogDescription>
              Change follow-up step status and add an optional note for completed or skipped steps.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            {activeStepContext ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <p><span className="font-medium text-slate-900">Service:</span> {activeStepContext.serviceName}</p>
                <p><span className="font-medium text-slate-900">Template:</span> {activeStepContext.templateName ?? "No template selected"}</p>
                <p><span className="font-medium text-slate-900">Step:</span> {activeStepContext.title}</p>
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select
                value={stepStatusValue}
                onValueChange={(value) => {
                  const nextValue = value as FollowUpStep["status"]
                  setStepStatusValue(nextValue)
                  if (nextValue !== "POSTPONED") {
                    setStepPostponeInput({ date: "", time: "" })
                  }
                }}
              >
                <SelectTrigger className="cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PENDING" className="cursor-pointer">Pending</SelectItem>
                  <SelectItem value="ACTIVE" className="cursor-pointer">Active</SelectItem>
                  <SelectItem value="COMPLETED" className="cursor-pointer">Completed</SelectItem>
                  <SelectItem value="SKIPPED" className="cursor-pointer">Skipped</SelectItem>
                  <SelectItem value="POSTPONED" className="cursor-pointer">Postponed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Step note (optional)</Label>
              <Textarea
                rows={4}
                placeholder="Add context about why this step was completed, skipped, or updated..."
                value={stepStatusNote}
                onChange={(event) => setStepStatusNote(event.target.value)}
              />
            </div>
            {stepStatusValue === "POSTPONED" ? (
              <div className="grid gap-2">
                <Label>Postpone to</Label>
                <DateTimeInput
                  value={stepPostponeInput}
                  onValueChange={setStepPostponeInput}
                  disabledDate={isBeforeToday}
                />
                <p className="text-xs text-slate-500">
                  This step and all upcoming pending/active steps will shift to match the new timing.
                </p>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsStepStatusDialogOpen(false)} disabled={isSavingStepStatus}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveStepStatus()} disabled={isSavingStepStatus}>
              {isSavingStepStatus ? "Saving..." : "Save status"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isStepDetailsDialogOpen} onOpenChange={setIsStepDetailsDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Follow-up step details</DialogTitle>
            <DialogDescription>
              Review the description and current details for this follow-up step.
            </DialogDescription>
          </DialogHeader>
          {activeStepContext ? (
            <div className="space-y-4 py-1">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <p><span className="font-medium text-slate-900">Service:</span> {activeStepContext.serviceName}</p>
                <p><span className="font-medium text-slate-900">Template:</span> {activeStepContext.templateName ?? "No template selected"}</p>
                <p><span className="font-medium text-slate-900">Step:</span> {activeStepContext.title}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Status</p>
                  <p className="mt-1 text-sm capitalize text-slate-900">
                    {(activeStepContext.status ?? "PENDING").toLowerCase().replace(/_/g, " ")}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Due</p>
                  <p className="mt-1 text-sm text-slate-900">
                    {activeStepContext.dueAt ? new Date(activeStepContext.dueAt).toLocaleString() : "No due date"}
                  </p>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Description</p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                  {activeStepContext.notesTemplate?.trim() || "No description provided for this step."}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Latest step note</p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                  {activeStepContext.note?.trim() || "No step note recorded yet."}
                </p>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsStepDetailsDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isNoteDialogOpen} onOpenChange={setIsNoteDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add step note</DialogTitle>
            <DialogDescription>
              This note will be saved in the contact note section with service and step reference.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {activeStepContext ? (
                <>
                  <p><span className="font-medium text-slate-900">Service:</span> {activeStepContext.serviceName}</p>
                  <p><span className="font-medium text-slate-900">Template:</span> {activeStepContext.templateName ?? "No template selected"}</p>
                  <p><span className="font-medium text-slate-900">Step:</span> {activeStepContext.title}</p>
                </>
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label>Note title</Label>
              <Input value={stepNoteTitle} onChange={(event) => setStepNoteTitle(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Note body</Label>
              <Textarea value={stepNoteBody} onChange={(event) => setStepNoteBody(event.target.value)} rows={5} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsNoteDialogOpen(false)} disabled={isSavingStepNote}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveStepNote()} disabled={isSavingStepNote}>
              {isSavingStepNote ? "Saving..." : "Save note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isTaskDialogOpen} onOpenChange={setIsTaskDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Create step task</DialogTitle>
            <DialogDescription>
              Create a task linked to this service follow-up step.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {activeStepContext ? (
                <>
                  <p><span className="font-medium text-slate-900">Service:</span> {activeStepContext.serviceName}</p>
                  <p><span className="font-medium text-slate-900">Template:</span> {activeStepContext.templateName ?? "No template selected"}</p>
                  <p><span className="font-medium text-slate-900">Step:</span> {activeStepContext.title}</p>
                </>
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label>Task title</Label>
              <Input value={stepTaskName} onChange={(event) => setStepTaskName(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Description</Label>
              <Textarea
                value={stepTaskDescription}
                onChange={(event) => setStepTaskDescription(event.target.value)}
                rows={4}
              />
            </div>
            <div className="grid gap-2">
              <Label>Due date (optional)</Label>
              <Input type="datetime-local" value={stepTaskDueAt} onChange={(event) => setStepTaskDueAt(event.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsTaskDialogOpen(false)} disabled={isSavingStepTask}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveStepTask()} disabled={isSavingStepTask}>
              {isSavingStepTask ? "Saving..." : "Create task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
