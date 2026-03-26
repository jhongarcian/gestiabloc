"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { isAxiosError } from "axios"
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleCheckBig,
  CircleDashed,
  Clock3,
  CreditCard,
  ListTodo,
  Loader2,
  NotebookPen,
  Plus,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DateTimeInput } from "@/components/ui/date-time-input"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { cn } from "@/lib/utils"

type ContactServiceStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELED"
type FollowUpStepStatus = "PENDING" | "ACTIVE" | "COMPLETED" | "SKIPPED" | "POSTPONED"

type ContactServiceDetails = {
  id: string
  contactId: string
  contactName?: string
  status: ContactServiceStatus
  startedAt?: string | null
  purchasedAt?: string | null
  completedAt?: string | null
  canceledAt?: string | null
  totalPriceCents: number
  paidCents: number
  remainingCents: number
  currency: string
  allowPartialPayments: boolean
  notes: string | null
  service: {
    id: string
    name: string
    description: string | null
    basePriceCents: number
  }
  followUpTemplate?: {
    id: string
    name: string
  } | null
  assignedProfessional?: {
    id: string
    kind: "INTERNAL_USER" | "EXTERNAL"
    userId: string | null
    externalProfessionalName: string | null
    externalContact: string | null
    user?: {
      name: string | null
      email: string | null
      image?: string | null
    } | null
  } | null
  followUpSteps: Array<{
    id: string
    title: string
    notesTemplate?: string | null
    status?: FollowUpStepStatus
    availableAt: string | null
    dueAt: string | null
    completedAt: string | null
    note?: string | null
    sortOrder: number
  }>
  payments: Array<{
    id: string
    amountCents: number
    paidAt: string
    paymentMethod: string | null
    note: string | null
    recordedBy?: {
      id: string
      name: string
    } | null
  }>
  serviceNotes: Array<{
    id: string
    title: string
    body: string
    createdAt: string
    createdBy?: {
      id: string
      name: string
      image?: string | null
    } | null
  }>
  checklistItems: Array<{
    id: string
    checklistItemId: string
    completedAt: string | null
    label: string
    description: string | null
    isRequired: boolean
    sortOrder: number
  }>
}

type ContactServiceResponse = {
  ok: boolean
  contactService: ContactServiceDetails
}

type ContactServiceDetailsPanelProps = {
  tenantId: string
  tenantSlug: string
  contactId: string
  contactServiceId: string
  membershipSecurityLevel: "LOW" | "MEDIUM" | "MAX"
}

type ServiceStatusOption = {
  value: ContactServiceStatus
  label: string
  bgClassName: string
  textClassName: string
}

type ActivityItem = {
  id: string
  createdAt: string
  title: string
  description: string
  tone: string
  icon: "payment" | "checklist" | "note" | "status"
}

type StepTimeMeta = {
  label: string
  helper: string
  badgeClassName: string
}

const currencyFormatter = (valueCents: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((valueCents || 0) / 100)

const centsToUsdInput = (valueCents: number) => ((valueCents || 0) / 100).toFixed(2)

const parseUsdToCents = (value: string) => {
  const normalized = value.replace(/\$/g, "").replace(/,/g, "").trim()
  if (!normalized) return null
  const parsed = Number.parseFloat(normalized)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.round(parsed * 100)
}

const toSentence = (value: string) => value.toLowerCase().replace(/_/g, " ")

const getAssignedProfessionalLabel = (
  professional: ContactServiceDetails["assignedProfessional"],
) => {
  if (!professional) return "No assigned professional"

  return (
    professional.externalProfessionalName?.trim() ||
    professional.user?.name?.trim() ||
    professional.user?.email?.trim() ||
    professional.externalContact?.trim() ||
    "Assigned professional"
  )
}

const PAYMENT_METHOD_OPTIONS = [
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card" },
  { value: "CHECK", label: "Check" },
  { value: "TRANSFER", label: "Transfer" },
  { value: "ACH", label: "ACH" },
] as const

const PAYMENTS_PAGE_SIZE = 5

const formatPaymentMethod = (value: string | null | undefined) => {
  if (!value) return null

  return PAYMENT_METHOD_OPTIONS.find((option) => option.value === value)?.label ?? value
}

const SERVICE_STATUS_OPTIONS: ServiceStatusOption[] = [
  {
    value: "PENDING",
    label: "Pending",
    bgClassName: "bg-amber-100",
    textClassName: "text-amber-800",
  },
  {
    value: "IN_PROGRESS",
    label: "In Progress",
    bgClassName: "bg-sky-100",
    textClassName: "text-sky-800",
  },
  {
    value: "COMPLETED",
    label: "Completed",
    bgClassName: "bg-emerald-100",
    textClassName: "text-emerald-800",
  },
  {
    value: "CANCELED",
    label: "Canceled",
    bgClassName: "bg-rose-100",
    textClassName: "text-rose-800",
  },
]

const STATUS_OPTION_BY_VALUE = Object.fromEntries(
  SERVICE_STATUS_OPTIONS.map((option) => [option.value, option]),
) as Record<ContactServiceStatus, ServiceStatusOption>

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "-"
  return new Date(value).toLocaleString()
}

const isBeforeToday = (date: Date) => {
  const candidate = new Date(date)
  candidate.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return candidate < today
}

const getStepTimeMeta = (step: ContactServiceDetails["followUpSteps"][number]): StepTimeMeta => {
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

const getInitials = (value: string | null | undefined) =>
  (value ?? "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "NA"

export function ContactServiceDetailsPanel({
  tenantId,
  tenantSlug,
  contactId,
  contactServiceId,
  membershipSecurityLevel,
}: ContactServiceDetailsPanelProps) {
  const router = useRouter()
  const canManageSensitiveServiceActions = membershipSecurityLevel !== "LOW"
  const [item, setItem] = useState<ContactServiceDetails | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isChecklistSavingId, setIsChecklistSavingId] = useState<string | null>(null)
  const [statusOpen, setStatusOpen] = useState(false)
  const [isStatusSaving, setIsStatusSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isPaymentOpen, setIsPaymentOpen] = useState(false)
  const [isPaymentSaving, setIsPaymentSaving] = useState(false)
  const [isPaymentEditOpen, setIsPaymentEditOpen] = useState(false)
  const [isPaymentDeleting, setIsPaymentDeleting] = useState(false)
  const [isNoteOpen, setIsNoteOpen] = useState(false)
  const [isNoteSaving, setIsNoteSaving] = useState(false)
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null)
  const [paymentAmountUsd, setPaymentAmountUsd] = useState("")
  const [paymentMethod, setPaymentMethod] = useState<string>("")
  const [paymentNote, setPaymentNote] = useState("")
  const [editPaymentAmountUsd, setEditPaymentAmountUsd] = useState("")
  const [editPaymentMethod, setEditPaymentMethod] = useState<string>("")
  const [editPaymentNote, setEditPaymentNote] = useState("")
  const [serviceNoteTitle, setServiceNoteTitle] = useState("")
  const [serviceNoteBody, setServiceNoteBody] = useState("")
  const [visiblePaymentsCount, setVisiblePaymentsCount] = useState(PAYMENTS_PAGE_SIZE)
  const [isStepStatusDialogOpen, setIsStepStatusDialogOpen] = useState(false)
  const [isStepDetailsDialogOpen, setIsStepDetailsDialogOpen] = useState(false)
  const [isStepNoteDialogOpen, setIsStepNoteDialogOpen] = useState(false)
  const [isStepTaskDialogOpen, setIsStepTaskDialogOpen] = useState(false)
  const [activeStep, setActiveStep] = useState<ContactServiceDetails["followUpSteps"][number] | null>(
    null,
  )
  const [mutatingStepId, setMutatingStepId] = useState<string | null>(null)
  const [stepStatusValue, setStepStatusValue] = useState<FollowUpStepStatus>("PENDING")
  const [stepStatusNote, setStepStatusNote] = useState("")
  const [stepPostponeInput, setStepPostponeInput] = useState<DateTimeDraft>({ date: "", time: "" })
  const [isSavingStepStatus, setIsSavingStepStatus] = useState(false)
  const [stepNoteTitle, setStepNoteTitle] = useState("")
  const [stepNoteBody, setStepNoteBody] = useState("")
  const [isSavingStepNote, setIsSavingStepNote] = useState(false)
  const [stepTaskName, setStepTaskName] = useState("")
  const [stepTaskDescription, setStepTaskDescription] = useState("")
  const [stepTaskDueAt, setStepTaskDueAt] = useState<DateTimeDraft>({ date: "", time: "" })
  const [isSavingStepTask, setIsSavingStepTask] = useState(false)

  const backHref = `/app/${tenantSlug}/contacts/${contactId}/services`

  const loadItem = useCallback(async () => {
    setIsLoading(true)
    try {
      const { data } = await api.get<ContactServiceResponse>(
        `/api/services/${tenantId}/contact-services/${contactServiceId}`,
      )
      setItem(data.contactService)
    } catch {
      setItem(null)
      toast.error("Could not load service enrollment.")
    } finally {
      setIsLoading(false)
    }
  }, [contactServiceId, tenantId])

  useEffect(() => {
    void loadItem()
  }, [loadItem])

  useEffect(() => {
    setVisiblePaymentsCount(PAYMENTS_PAGE_SIZE)
  }, [item?.id, item?.payments?.length])

  const resetPaymentForm = () => {
    setPaymentAmountUsd("")
    setPaymentMethod("")
    setPaymentNote("")
  }

  const resetEditPaymentForm = () => {
    setEditPaymentAmountUsd("")
    setEditPaymentMethod("")
    setEditPaymentNote("")
    setSelectedPaymentId(null)
  }

  const resetNoteForm = () => {
    setServiceNoteTitle("")
    setServiceNoteBody("")
  }

  const updateStatus = async (nextStatus: ContactServiceStatus) => {
    if (!item || isStatusSaving || item.status === nextStatus) return

    setIsStatusSaving(true)
    try {
      await api.patch(`/api/services/${tenantId}/contact-services/${item.id}`, {
        status: nextStatus,
      })
      setItem((current) =>
        current
          ? {
              ...current,
              status: nextStatus,
            }
          : current,
      )
      setStatusOpen(false)
      toast.success("Service status updated.")
      await loadItem()
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not update service status.",
        )
      } else {
        toast.error("Could not update service status.")
      }
    } finally {
      setIsStatusSaving(false)
    }
  }

  const onAddPayment = async () => {
    if (!item) return
    const amountCents = parseUsdToCents(paymentAmountUsd)
    if (amountCents === null || amountCents <= 0) {
      toast.error("Enter a valid payment amount in USD.")
      return
    }

    setIsPaymentSaving(true)
    try {
      await api.post(`/api/services/${tenantId}/contact-services/${item.id}/payments`, {
        amountCents,
        ...(paymentMethod ? { paymentMethod } : {}),
        ...(paymentNote.trim() ? { note: paymentNote.trim() } : {}),
      })
      toast.success("Payment recorded.")
      setIsPaymentOpen(false)
      resetPaymentForm()
      await loadItem()
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not record payment.",
        )
      } else {
        toast.error("Could not record payment.")
      }
    } finally {
      setIsPaymentSaving(false)
    }
  }

  const onDeleteService = async () => {
    if (!item) return

    setIsDeleting(true)
    try {
      await api.delete(`/api/services/${tenantId}/contact-services/${item.id}`)
      toast.success("Service removed.")
      router.push(backHref)
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not remove service.",
        )
      } else {
        toast.error("Could not remove service.")
      }
    } finally {
      setIsDeleting(false)
    }
  }

  const openEditPayment = (payment: ContactServiceDetails["payments"][number]) => {
    setSelectedPaymentId(payment.id)
    setEditPaymentAmountUsd(centsToUsdInput(payment.amountCents))
    setEditPaymentMethod(payment.paymentMethod ?? "")
    setEditPaymentNote(payment.note ?? "")
    setIsPaymentEditOpen(true)
  }

  const onUpdatePayment = async () => {
    if (!item || !selectedPaymentId) return
    const amountCents = parseUsdToCents(editPaymentAmountUsd)
    if (amountCents === null || amountCents <= 0) {
      toast.error("Enter a valid payment amount in USD.")
      return
    }

    setIsPaymentSaving(true)
    try {
      await api.patch(
        `/api/services/${tenantId}/contact-services/${item.id}/payments/${selectedPaymentId}`,
        {
          amountCents,
          paymentMethod: editPaymentMethod || null,
          note: editPaymentNote.trim() || null,
        },
      )
      toast.success("Payment updated.")
      setIsPaymentEditOpen(false)
      resetEditPaymentForm()
      await loadItem()
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not update payment.",
        )
      } else {
        toast.error("Could not update payment.")
      }
    } finally {
      setIsPaymentSaving(false)
    }
  }

  const onDeletePayment = async () => {
    if (!item || !selectedPaymentId) return

    setIsPaymentDeleting(true)
    try {
      await api.delete(
        `/api/services/${tenantId}/contact-services/${item.id}/payments/${selectedPaymentId}`,
      )
      toast.success("Payment deleted.")
      setIsPaymentEditOpen(false)
      resetEditPaymentForm()
      await loadItem()
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not delete payment.",
        )
      } else {
        toast.error("Could not delete payment.")
      }
    } finally {
      setIsPaymentDeleting(false)
    }
  }

  const onAddServiceNote = async () => {
    if (!item) return
    if (!serviceNoteTitle.trim() || !serviceNoteBody.trim()) {
      toast.error("Title and body are required.")
      return
    }

    setIsNoteSaving(true)
    try {
      await api.post(`/api/services/${tenantId}/contact-services/${item.id}/notes`, {
        title: serviceNoteTitle,
        body: serviceNoteBody,
      })
      toast.success("Service note added.")
      setIsNoteOpen(false)
      resetNoteForm()
      await loadItem()
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not add service note.",
        )
      } else {
        toast.error("Could not add service note.")
      }
    } finally {
      setIsNoteSaving(false)
    }
  }

  const toggleChecklistItem = async (
    checklistItem: ContactServiceDetails["checklistItems"][number],
  ) => {
    if (!item) return
    const nextCompleted = !Boolean(checklistItem.completedAt)
    setIsChecklistSavingId(checklistItem.id)
    try {
      const { data } = await api.patch<{
        ok: boolean
        checklistItem: ContactServiceDetails["checklistItems"][number]
      }>(
        `/api/services/${tenantId}/contact-services/${item.id}/checklist-items/${checklistItem.id}`,
        {
          completed: nextCompleted,
        },
      )

      setItem((current) =>
        current
          ? {
              ...current,
              checklistItems: current.checklistItems.map((entry) =>
                entry.id === checklistItem.id ? data.checklistItem : entry,
              ),
            }
          : current,
      )
    } catch {
      toast.error("Could not update checklist item.")
    } finally {
      setIsChecklistSavingId(null)
    }
  }

  const payments = useMemo(() => item?.payments ?? [], [item?.payments])
  const visiblePayments = useMemo(
    () => payments.slice(0, visiblePaymentsCount),
    [payments, visiblePaymentsCount],
  )
  const serviceNotes = useMemo(() => item?.serviceNotes ?? [], [item?.serviceNotes])
  const checklistItems = useMemo(() => item?.checklistItems ?? [], [item?.checklistItems])
  const followUpSteps = useMemo(
    () =>
      [...(item?.followUpSteps ?? [])]
        .map((step) => ({
          ...step,
          status: step.status ?? (step.completedAt ? "COMPLETED" : "PENDING"),
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [item?.followUpSteps],
  )
  const checklistCompletedCount = useMemo(
    () => checklistItems.filter((entry) => Boolean(entry.completedAt)).length,
    [checklistItems],
  )
  const followUpCompletedCount = useMemo(
    () =>
      followUpSteps.filter((step) => step.status === "COMPLETED" || step.status === "SKIPPED").length,
    [followUpSteps],
  )
  const followUpCompletionPercentage = useMemo(
    () => (followUpSteps.length ? Math.round((followUpCompletedCount / followUpSteps.length) * 100) : 0),
    [followUpCompletedCount, followUpSteps.length],
  )
  const canAddPayments = Boolean(item && item.remainingCents > 0)
  const currentStatusOption = item ? STATUS_OPTION_BY_VALUE[item.status] : null

  const openStepStatusDialog = (step: ContactServiceDetails["followUpSteps"][number]) => {
    setActiveStep(step)
    setStepStatusValue(step.status ?? "PENDING")
    setStepStatusNote("")
    setStepPostponeInput(formatUtcIsoToDateTimeDraft(step.dueAt, "America/Chicago"))
    setIsStepStatusDialogOpen(true)
  }

  const openStepDetailsDialog = (step: ContactServiceDetails["followUpSteps"][number]) => {
    setActiveStep(step)
    setIsStepDetailsDialogOpen(true)
  }

  const updateStepStatus = async (
    step: ContactServiceDetails["followUpSteps"][number],
    nextStatus: FollowUpStepStatus,
    note?: string,
    postponeTo?: string,
  ) => {
    if (!item || !nextStatus) return
    setMutatingStepId(step.id)
    try {
      await api.patch(
        `/api/services/${tenantId}/contact-services/${item.id}/follow-up-steps/${step.id}`,
        {
          status: nextStatus,
          ...(note?.trim() ? { note: note.trim() } : {}),
          ...(postponeTo ? { postponeTo, cascadeFutureSteps: true } : {}),
        },
      )
      toast.success(nextStatus === "COMPLETED" ? "Step marked as completed." : "Step status updated.")
      await loadItem()
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not update this follow-up step.",
        )
      } else {
        toast.error("Could not update this follow-up step.")
      }
    } finally {
      setMutatingStepId(null)
    }
  }

  const saveStepStatus = async () => {
    if (!activeStep || !stepStatusValue) return
    if (
      stepStatusValue === "POSTPONED" &&
      (!isDateTimeDraftComplete(stepPostponeInput) || isDateTimeDraftEmpty(stepPostponeInput))
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
    const postponeToIso =
      stepStatusValue !== "POSTPONED" || isDateTimeDraftEmpty(stepPostponeInput)
        ? undefined
        : dateTimeDraftToUtcIso(stepPostponeInput, "America/Chicago") ?? undefined
    setIsSavingStepStatus(true)
    await updateStepStatus(activeStep, stepStatusValue, stepStatusNote, postponeToIso)
    setIsSavingStepStatus(false)
    setIsStepStatusDialogOpen(false)
    setActiveStep(null)
    setStepStatusNote("")
    setStepPostponeInput({ date: "", time: "" })
  }

  const openStepNoteDialog = (step: ContactServiceDetails["followUpSteps"][number]) => {
    setActiveStep(step)
    setStepNoteTitle(`${item?.service.name ?? "Service"} - ${step.title}`)
    setStepNoteBody("")
    setIsStepNoteDialogOpen(true)
  }

  const saveStepNote = async () => {
    if (!item || !activeStep) return
    if (!stepNoteTitle.trim() || !stepNoteBody.trim()) {
      toast.error("Title and note body are required.")
      return
    }

    setIsSavingStepNote(true)
    try {
      await api.post(`/api/contacts/${tenantId}/${contactId}/notes`, {
        title: stepNoteTitle.trim(),
        body: `Service: ${item.service.name}\nTemplate: ${item.followUpTemplate?.name ?? "No template selected"}\nStep: ${activeStep.title}\n\n${stepNoteBody.trim()}`,
      })
      toast.success("Step note created.")
      setIsStepNoteDialogOpen(false)
      setActiveStep(null)
      setStepNoteTitle("")
      setStepNoteBody("")
      router.refresh()
    } catch {
      toast.error("Could not create a note for this step.")
    } finally {
      setIsSavingStepNote(false)
    }
  }

  const openStepTaskDialog = (step: ContactServiceDetails["followUpSteps"][number]) => {
    setActiveStep(step)
    setStepTaskName(`Follow-up: ${step.title}`)
    setStepTaskDescription(`Service: ${item?.service.name ?? ""}\nStep: ${step.title}`)
    setStepTaskDueAt(formatUtcIsoToDateTimeDraft(step.dueAt, "America/Chicago"))
    setIsStepTaskDialogOpen(true)
  }

  const saveStepTask = async () => {
    if (!item || !activeStep) return
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
        linkedEntityName: `${item.service.name} - ${activeStep.title}`,
        linkedEntityType: "SERVICE",
        dueDate: isDateTimeDraftComplete(stepTaskDueAt)
          ? dateTimeDraftToUtcIso(stepTaskDueAt, "America/Chicago")
          : null,
        startedAt: new Date().toISOString(),
      })
      toast.success("Task created for follow-up step.")
      setIsStepTaskDialogOpen(false)
      setActiveStep(null)
      setStepTaskName("")
      setStepTaskDescription("")
      setStepTaskDueAt({ date: "", time: "" })
      router.refresh()
    } catch {
      toast.error("Could not create task for this step.")
    } finally {
      setIsSavingStepTask(false)
    }
  }

  const historyItems = useMemo<ActivityItem[]>(() => {
    if (!item) return []

    const entries: ActivityItem[] = []

    if (item.purchasedAt) {
      entries.push({
        id: `purchased-${item.id}`,
        createdAt: item.purchasedAt,
        title: "Service purchased",
        description: `Enrollment started for ${item.service.name}.`,
        tone: "border-sky-200 bg-sky-50/80 text-sky-800",
        icon: "status",
      })
    }

    if (item.completedAt) {
      entries.push({
        id: `completed-${item.id}`,
        createdAt: item.completedAt,
        title: "Service completed",
        description: `${item.service.name} was marked as completed.`,
        tone: "border-emerald-200 bg-emerald-50/80 text-emerald-800",
        icon: "status",
      })
    }

    if (item.canceledAt) {
      entries.push({
        id: `canceled-${item.id}`,
        createdAt: item.canceledAt,
        title: "Service canceled",
        description: `${item.service.name} was marked as canceled.`,
        tone: "border-rose-200 bg-rose-50/80 text-rose-800",
        icon: "status",
      })
    }

    checklistItems
      .filter((checklistItem) => Boolean(checklistItem.completedAt))
      .forEach((checklistItem) => {
        entries.push({
          id: `checklist-${checklistItem.id}`,
          createdAt: checklistItem.completedAt as string,
          title: `Checklist completed: ${checklistItem.label}`,
          description: "A required service document was marked as received.",
          tone: "border-emerald-200 bg-emerald-50/80 text-emerald-800",
          icon: "checklist",
        })
      })

    payments.forEach((payment) => {
      entries.push({
        id: `payment-${payment.id}`,
        createdAt: payment.paidAt,
        title: `Payment recorded: ${currencyFormatter(payment.amountCents, item.currency)}`,
        description: payment.paymentMethod
          ? `${formatPaymentMethod(payment.paymentMethod)}${payment.recordedBy?.name ? ` by ${payment.recordedBy.name}` : ""}`
          : payment.recordedBy?.name
            ? `Recorded by ${payment.recordedBy.name}`
            : "Payment recorded for this service.",
        tone: "border-slate-200 bg-slate-50 text-slate-700",
        icon: "payment",
      })
    })

    serviceNotes.forEach((note) => {
      entries.push({
        id: `note-${note.id}`,
        createdAt: note.createdAt,
        title: `Note added: ${note.title}`,
        description: note.createdBy?.name ? `Added by ${note.createdBy.name}` : "Note added to this service.",
        tone: "border-violet-200 bg-violet-50/80 text-violet-800",
        icon: "note",
      })
    })

    return entries.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
  }, [checklistItems, item, payments, serviceNotes])

  if (isLoading) {
    return (
      <section className="rounded-[26px] border border-slate-200 bg-white p-5 text-sm text-slate-500">
        Loading service enrollment...
      </section>
    )
  }

  if (!item) {
    return (
      <section className="rounded-[26px] border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
        This service enrollment could not be found.
      </section>
    )
  }

  return (
    <TooltipProvider>
      <section className="flex flex-col gap-5">
      <div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              <span>Contact Service</span>
              {item.followUpTemplate?.name ? (
                <>
                  <span className="text-slate-300">/</span>
                  <span>{item.followUpTemplate.name}</span>
                </>
              ) : null}
            </div>
            <div className="flex items-start gap-3">
              <Link
                href={backHref}
                aria-label="Back to services"
                className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
                  {item.service.name}
                </h1>
                <p className="text-sm text-slate-500">
                  Professional: {getAssignedProfessionalLabel(item.assignedProfessional)}
                </p>
                {item.service.description ? (
                  <p className="max-w-3xl text-sm leading-6 text-slate-600">
                    {item.service.description}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 self-center md:self-center">
            {canManageSensitiveServiceActions ? (
              <Button
                type="button"
                variant="ghost"
                className="h-8 cursor-pointer rounded-full border border-rose-100 bg-rose-50/60 px-3 py-1 text-xs font-semibold text-rose-600 shadow-sm backdrop-blur hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                onClick={() => void onDeleteService()}
                disabled={isDeleting || isStatusSaving}
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </Button>
            ) : null}
            <Popover
              open={canManageSensitiveServiceActions ? statusOpen : false}
              onOpenChange={(open) => {
                if (!canManageSensitiveServiceActions) return
                setStatusOpen(open)
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className={cn(
                    "h-8 max-w-[220px] rounded-full px-3 py-1 text-xs font-semibold shadow-sm ring-1 ring-black/5",
                    canManageSensitiveServiceActions ? "cursor-pointer" : "cursor-default",
                    currentStatusOption?.bgClassName,
                    currentStatusOption?.textClassName,
                  )}
                  disabled={!canManageSensitiveServiceActions}
                >
                  <span className="truncate">{currentStatusOption?.label ?? toSentence(item.status)}</span>
                  {isStatusSaving ? (
                    <Loader2 className="ml-1 h-3.5 w-3.5 shrink-0 animate-spin" />
                  ) : (
                    <ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0" />
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[280px] p-0">
                <Command>
                  <CommandInput placeholder="Update status..." />
                  <CommandList>
                    <CommandEmpty>No statuses found.</CommandEmpty>
                    {SERVICE_STATUS_OPTIONS.map((option) => (
                      <CommandItem
                        key={option.value}
                        onSelect={() => void updateStatus(option.value)}
                        className="cursor-pointer gap-2 px-3 py-2"
                      >
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2 py-1 text-xs font-semibold shadow-sm ring-1 ring-black/5",
                            option.bgClassName,
                            option.textClassName,
                          )}
                        >
                          {option.label}
                        </span>
                        <span className="min-w-0 flex-1" />
                        <Check
                          className={cn(
                            "h-4 w-4 text-blue-950",
                            item.status === option.value ? "opacity-100" : "opacity-0",
                          )}
                        />
                      </CommandItem>
                    ))}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-[24px] border border-slate-200 bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Total</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
            {currencyFormatter(item.totalPriceCents, item.currency)}
          </p>
        </div>
        <div className="rounded-[24px] border border-slate-200 bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Paid</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-sky-700">
            {currencyFormatter(item.paidCents, item.currency)}
          </p>
        </div>
        <div className="rounded-[24px] border border-slate-200 bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Balance</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-amber-700">
            {currencyFormatter(item.remainingCents, item.currency)}
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-[24px] border border-slate-200 bg-white p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                Checklist Tracking
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Mark documents as received as soon as the contact brings them in.
              </p>
            </div>
            <Badge variant="outline" className="w-fit border-slate-200 bg-slate-50 text-slate-700">
              {checklistCompletedCount}/{checklistItems.length} received
            </Badge>
          </div>
          {checklistItems.length ? (
            <div className="space-y-3">
              {[...checklistItems]
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((checklistItem) => {
                  const isCompleted = Boolean(checklistItem.completedAt)
                  const isSavingChecklist = isChecklistSavingId === checklistItem.id
                  return (
                    <div
                      key={checklistItem.id}
                      className={cn(
                        "flex items-center gap-3 rounded-2xl border px-4 py-3 transition",
                        isCompleted
                          ? "border-emerald-200 bg-emerald-50/70"
                          : "border-slate-200 bg-slate-50",
                        isSavingChecklist && "opacity-70",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className={cn("text-sm font-semibold", isCompleted ? "text-emerald-900" : "text-slate-900")}>
                            {checklistItem.label}
                          </p>
                          {checklistItem.isRequired ? (
                            <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
                              Required
                            </Badge>
                          ) : null}
                          <Badge
                            variant="outline"
                            className={cn(
                              isCompleted
                                ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                                : "border-slate-200 bg-white text-slate-600",
                            )}
                          >
                            {isCompleted ? "Received" : "Pending"}
                          </Badge>
                        </div>
                        {checklistItem.description ? (
                          <p className="mt-1 text-sm leading-6 text-slate-600">
                            {checklistItem.description}
                          </p>
                        ) : null}
                        <p className="mt-2 inline-flex items-center gap-1 text-xs text-slate-500">
                          {isCompleted ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-emerald-600" />
                              Received {formatDateTime(checklistItem.completedAt)}
                            </>
                          ) : (
                            <>
                              <CircleDashed className="h-3.5 w-3.5" />
                              Click the circle to mark as received
                            </>
                          )}
                        </p>
                      </div>
                      <div className="ml-auto flex shrink-0 items-center self-center">
                        <button
                          type="button"
                          className="cursor-pointer rounded-full text-slate-400 transition hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => void toggleChecklistItem(checklistItem)}
                          disabled={isSavingChecklist}
                          aria-label={isCompleted ? `Uncheck ${checklistItem.label}` : `Check ${checklistItem.label}`}
                        >
                          {isCompleted ? (
                            <CircleCheckBig className="h-6 w-6 text-emerald-600" />
                          ) : (
                            <Circle className="h-6 w-6" />
                          )}
                        </button>
                      </div>
                    </div>
                  )
                })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              This service does not have checklist requirements yet.
            </div>
          )}
        </section>

        <section className="rounded-[24px] border border-slate-200 bg-white p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Payments</p>
              <p className="mt-1 text-sm text-slate-600">
                Review payment history and record partial payments when a balance is still open.
              </p>
            </div>
            {canAddPayments && canManageSensitiveServiceActions ? (
              <Button
                type="button"
                variant="ghost"
                className="h-8 cursor-pointer rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm hover:border-slate-300 hover:bg-white hover:text-slate-950"
                onClick={() => setIsPaymentOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                Add payment
              </Button>
            ) : (
              <Badge className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800 hover:bg-emerald-100">
                Paid in full
              </Badge>
            )}
          </div>
          {payments.length ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500">
                  Showing {Math.min(visiblePaymentsCount, payments.length)} of {payments.length} payments
                </p>
                {payments.length > PAYMENTS_PAGE_SIZE ? (
                  <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
                    {payments.length - Math.min(visiblePaymentsCount, payments.length)} more
                  </Badge>
                ) : null}
              </div>
              {visiblePayments.map((payment, index) => (
                <button
                  key={payment.id ?? `${payment.paidAt}-${payment.amountCents}-${index}`}
                  type="button"
                  className={cn(
                    "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition",
                    canManageSensitiveServiceActions
                      ? "cursor-pointer hover:border-slate-300 hover:bg-white"
                      : "cursor-default",
                  )}
                  onClick={() => {
                    if (!canManageSensitiveServiceActions) return
                    openEditPayment(payment)
                  }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-slate-900">
                        {currencyFormatter(payment.amountCents, item.currency)}
                      </p>
                      <p className="text-xs text-slate-500">{formatDateTime(payment.paidAt)}</p>
                    </div>
                    {payment.paymentMethod ? (
                      <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">
                        {formatPaymentMethod(payment.paymentMethod)}
                      </Badge>
                    ) : null}
                  </div>
                  {payment.note ? (
                    <p className="mt-2 text-sm leading-6 text-slate-600">{payment.note}</p>
                  ) : null}
                  {payment.recordedBy?.name ? (
                    <p className="mt-2 text-xs text-slate-500">Recorded by {payment.recordedBy.name}</p>
                  ) : null}
                </button>
              ))}
              {payments.length > visiblePaymentsCount ? (
                <div className="flex justify-center pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    className="cursor-pointer rounded-full border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    onClick={() =>
                      setVisiblePaymentsCount((current) =>
                        Math.min(current + PAYMENTS_PAGE_SIZE, payments.length),
                      )
                    }
                  >
                    Load more payments
                  </Button>
                </div>
              ) : payments.length > PAYMENTS_PAGE_SIZE ? (
                <div className="flex justify-center pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    className="cursor-pointer rounded-full border border-slate-200 bg-slate-50 text-slate-700 hover:bg-white hover:text-slate-950"
                    onClick={() => setVisiblePaymentsCount(PAYMENTS_PAGE_SIZE)}
                  >
                    Show less
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              No payments have been recorded for this service yet.
            </div>
          )}
        </section>
      </div>

      <section className="rounded-[24px] border border-slate-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Service Follow-Up</p>
            <p className="mt-1 text-sm text-slate-600">
              Review the enrolled follow-up path for this service and move each step forward when it becomes active.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
              {followUpCompletionPercentage}% complete
            </Badge>
            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
              {followUpCompletedCount}/{followUpSteps.length} steps
            </Badge>
          </div>
        </div>
        {followUpSteps.length ? (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-2.5 rounded-full bg-emerald-500 transition-all"
                style={{ width: `${followUpCompletionPercentage}%` }}
              />
            </div>
            <div className="space-y-3">
              {followUpSteps.map((step, index) => {
                const timeMeta = getStepTimeMeta(step)
                const isStatusLocked = (step.status ?? "PENDING") !== "ACTIVE"
                const isActive = (step.status ?? "PENDING") === "ACTIVE"
                const isDone = step.status === "COMPLETED" || step.status === "SKIPPED"

                return (
                  <div key={step.id} className="flex gap-3">
                    <div className="flex w-8 shrink-0 flex-col items-center pt-2">
                      <span
                        className={cn(
                          "inline-flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold",
                          isDone
                            ? "border-emerald-200 bg-emerald-100 text-emerald-800"
                            : isActive
                              ? "border-blue-200 bg-blue-50 text-blue-900"
                              : "border-slate-200 bg-slate-50 text-slate-600",
                        )}
                      >
                        {index + 1}
                      </span>
                      {index < followUpSteps.length - 1 ? (
                        <span className="mt-2 h-full min-h-8 w-px bg-slate-200" />
                      ) : null}
                    </div>
                    <article
                      className={cn(
                        "flex-1 rounded-[22px] border px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]",
                        isDone
                          ? "border-emerald-200 bg-emerald-50/50"
                          : isActive
                            ? "border-blue-200 bg-blue-50/40"
                            : "border-slate-200 bg-white",
                      )}
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1 space-y-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className="border-slate-200 bg-white text-slate-600"
                                >
                                  Step {index + 1}
                                </Badge>
                                <Badge className={timeMeta.badgeClassName}>{timeMeta.label}</Badge>
                                {isActive ? (
                                  <Badge className="bg-blue-100 text-blue-900 hover:bg-blue-100">
                                    Current step
                                  </Badge>
                                ) : null}
                              </div>
                              <button
                                type="button"
                                className="cursor-pointer text-left text-base font-semibold tracking-tight text-slate-950 transition hover:text-slate-700"
                                onClick={() => openStepDetailsDialog(step)}
                              >
                                {step.title}
                              </button>
                              <p className="text-xs font-medium text-slate-500">{timeMeta.helper}</p>
                            </div>
                          </div>
                          <p className="max-w-3xl text-sm leading-6 text-slate-600">
                            {step.notesTemplate?.trim() || "No description provided for this step."}
                          </p>
                          {step.note?.trim() ? (
                            <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
                              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                                Latest Step Note
                              </p>
                              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{step.note}</p>
                            </div>
                          ) : null}
                        </div>
                        <div className="flex w-full items-center gap-2 lg:w-auto lg:min-w-[320px] lg:justify-end">
                          {!isStatusLocked ? (
                            <Button
                              type="button"
                              variant="outline"
                              className="h-10 min-w-[150px] cursor-pointer justify-between rounded-full border-slate-200 bg-white text-sm capitalize shadow-sm"
                              disabled={mutatingStepId === step.id}
                              onClick={() => openStepStatusDialog(step)}
                            >
                              <span>{(step.status ?? "PENDING").toLowerCase().replace(/_/g, " ")}</span>
                              {mutatingStepId === step.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                            </Button>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="h-10 min-w-[150px] cursor-not-allowed justify-between rounded-full border-slate-200 bg-white text-sm capitalize shadow-sm"
                                    disabled
                                  >
                                    <span>{(step.status ?? "PENDING").toLowerCase().replace(/_/g, " ")}</span>
                                    <ChevronDown className="h-4 w-4" />
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" sideOffset={6}>
                                Only the current active step can be updated.
                              </TooltipContent>
                            </Tooltip>
                          )}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-10 w-10 cursor-pointer rounded-xl border-slate-200 bg-white text-fuchsia-700 hover:border-fuchsia-200 hover:bg-white hover:text-fuchsia-800"
                                onClick={() => openStepNoteDialog(step)}
                                aria-label={`Add note for ${step.title}`}
                              >
                                <NotebookPen className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top" sideOffset={6}>Add note</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-10 w-10 cursor-pointer rounded-xl border-slate-200 bg-white text-cyan-700 hover:border-cyan-200 hover:bg-white hover:text-cyan-800"
                                onClick={() => openStepTaskDialog(step)}
                                aria-label={`Create task for ${step.title}`}
                              >
                                <ListTodo className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top" sideOffset={6}>Create task</TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    </article>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            No follow-up steps are enrolled for this service yet.
          </div>
        )}
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Service Notes</p>
            <p className="mt-1 text-sm text-slate-600">
              Keep service-specific notes separate from general contact notes.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="h-8 cursor-pointer rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm hover:border-slate-300 hover:bg-white hover:text-slate-950"
            onClick={() => setIsNoteOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Add note
          </Button>
        </div>
        {serviceNotes.length ? (
          <div className="space-y-3">
            {serviceNotes.map((note) => (
              <article key={note.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <Avatar className="h-10 w-10 shrink-0">
                      <AvatarImage
                        src={note.createdBy?.image ?? undefined}
                        alt={note.createdBy?.name ?? "Service note author"}
                      />
                      <AvatarFallback className="bg-blue-950 text-xs font-semibold text-white">
                        {getInitials(note.createdBy?.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-slate-900">{note.title}</h2>
                    <p className="mt-1 text-xs text-slate-500">
                      {note.createdBy?.name ? `Added by ${note.createdBy.name}` : "Added to this service"}
                      {" · "}
                      {formatDateTime(note.createdAt)}
                    </p>
                    </div>
                  </div>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{note.body}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            No service notes have been added yet.
          </div>
        )}
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-5">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Service History</p>
          <p className="mt-1 text-sm text-slate-600">
            Review the service timeline, including payments, checklist receipts, and note activity.
          </p>
        </div>
        {historyItems.length ? (
          <div className="space-y-3">
            {historyItems.map((historyItem) => (
              <div key={historyItem.id} className="flex gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className={cn("mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border", historyItem.tone)}>
                  {historyItem.icon === "payment" ? (
                    <CreditCard className="h-4 w-4" />
                  ) : historyItem.icon === "checklist" ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : historyItem.icon === "note" ? (
                    <NotebookPen className="h-4 w-4" />
                  ) : (
                    <Clock3 className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">{historyItem.title}</p>
                    <p className="text-xs text-slate-500">{formatDateTime(historyItem.createdAt)}</p>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{historyItem.description}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            No service activity is available yet.
          </div>
        )}
      </section>

      <Dialog
        open={isPaymentOpen}
        onOpenChange={(open) => {
          setIsPaymentOpen(open)
          if (!open) resetPaymentForm()
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add payment</DialogTitle>
            <DialogDescription>
              Record an additional payment for this service enrollment.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                <CreditCard className="h-4 w-4 text-slate-500" />
                Remaining balance: {currencyFormatter(item.remainingCents, item.currency)}
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Payment Amount (USD)</Label>
              <Input
                value={paymentAmountUsd}
                onChange={(event) => setPaymentAmountUsd(event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
              />
            </div>
            <div className="grid gap-2">
              <Label>Payment Method</Label>
              <Select value={paymentMethod || "__none__"} onValueChange={(value) => setPaymentMethod(value === "__none__" ? "" : value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select payment method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No method</SelectItem>
                  {PAYMENT_METHOD_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Note</Label>
              <Textarea
                value={paymentNote}
                onChange={(event) => setPaymentNote(event.target.value)}
                rows={4}
                placeholder="Optional payment note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsPaymentOpen(false)}
              disabled={isPaymentSaving}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void onAddPayment()}
              disabled={isPaymentSaving}
              className="cursor-pointer"
            >
              {isPaymentSaving ? "Saving..." : "Add payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isPaymentEditOpen}
        onOpenChange={(open) => {
          setIsPaymentEditOpen(open)
          if (!open) resetEditPaymentForm()
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit payment</DialogTitle>
            <DialogDescription>
              Correct the payment amount, method, or note. You can also delete this payment.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid gap-2">
              <Label>Payment Amount (USD)</Label>
              <Input
                value={editPaymentAmountUsd}
                onChange={(event) => setEditPaymentAmountUsd(event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
              />
            </div>
            <div className="grid gap-2">
              <Label>Payment Method</Label>
              <Select
                value={editPaymentMethod || "__none__"}
                onValueChange={(value) => setEditPaymentMethod(value === "__none__" ? "" : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select payment method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No method</SelectItem>
                  {PAYMENT_METHOD_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Note</Label>
              <Textarea
                value={editPaymentNote}
                onChange={(event) => setEditPaymentNote(event.target.value)}
                rows={4}
                placeholder="Optional payment note"
              />
            </div>
          </div>
          <DialogFooter className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="destructive"
              onClick={() => void onDeletePayment()}
              disabled={isPaymentDeleting || isPaymentSaving}
              className="cursor-pointer"
            >
              {isPaymentDeleting ? "Deleting..." : "Delete payment"}
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsPaymentEditOpen(false)}
                disabled={isPaymentSaving}
                className="cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void onUpdatePayment()}
                disabled={isPaymentSaving || isPaymentDeleting}
                className="cursor-pointer"
              >
                {isPaymentSaving ? "Saving..." : "Save payment"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isNoteOpen}
        onOpenChange={(open) => {
          setIsNoteOpen(open)
          if (!open) resetNoteForm()
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add service note</DialogTitle>
            <DialogDescription>
              Save a note that belongs to this service and stays visible in the service history.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid gap-2">
              <Label>Title</Label>
              <Input
                value={serviceNoteTitle}
                onChange={(event) => setServiceNoteTitle(event.target.value)}
                placeholder="Service note title"
              />
            </div>
            <div className="grid gap-2">
              <Label>Body</Label>
              <Textarea
                value={serviceNoteBody}
                onChange={(event) => setServiceNoteBody(event.target.value)}
                rows={6}
                placeholder="Add context about this service"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsNoteOpen(false)}
              disabled={isNoteSaving}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void onAddServiceNote()}
              disabled={isNoteSaving}
              className="cursor-pointer"
            >
              {isNoteSaving ? "Saving..." : "Add note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isStepStatusDialogOpen} onOpenChange={setIsStepStatusDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Update step status</DialogTitle>
            <DialogDescription>
              Change follow-up step status and add an optional note for completed, skipped, or postponed steps.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            {activeStep ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <p><span className="font-medium text-slate-900">Service:</span> {item.service.name}</p>
                <p><span className="font-medium text-slate-900">Template:</span> {item.followUpTemplate?.name ?? "No template selected"}</p>
                <p><span className="font-medium text-slate-900">Step:</span> {activeStep.title}</p>
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select
                value={stepStatusValue}
                onValueChange={(value) => {
                  const nextValue = value as FollowUpStepStatus
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
                  This step and all upcoming pending or active steps will shift to match the new timing.
                </p>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsStepStatusDialogOpen(false)}
              disabled={isSavingStepStatus}
              className="cursor-pointer border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void saveStepStatus()}
              disabled={isSavingStepStatus}
              className="cursor-pointer bg-blue-950 text-white hover:bg-blue-950/90"
            >
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
          {activeStep ? (
            <div className="space-y-4 py-1">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <p><span className="font-medium text-slate-900">Service:</span> {item.service.name}</p>
                <p><span className="font-medium text-slate-900">Template:</span> {item.followUpTemplate?.name ?? "No template selected"}</p>
                <p><span className="font-medium text-slate-900">Step:</span> {activeStep.title}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Status</p>
                  <p className="mt-1 text-sm capitalize text-slate-900">
                    {(activeStep.status ?? "PENDING").toLowerCase().replace(/_/g, " ")}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Due</p>
                  <p className="mt-1 text-sm text-slate-900">
                    {activeStep.dueAt ? new Date(activeStep.dueAt).toLocaleString() : "No due date"}
                  </p>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Description</p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                  {activeStep.notesTemplate?.trim() || "No description provided for this step."}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Latest step note</p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                  {activeStep.note?.trim() || "No step note recorded yet."}
                </p>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsStepDetailsDialogOpen(false)}
              className="cursor-pointer border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isStepNoteDialogOpen} onOpenChange={setIsStepNoteDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add step note</DialogTitle>
            <DialogDescription>
              This note will be saved in the contact note section with service and step reference.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {activeStep ? (
                <>
                  <p><span className="font-medium text-slate-900">Service:</span> {item.service.name}</p>
                  <p><span className="font-medium text-slate-900">Template:</span> {item.followUpTemplate?.name ?? "No template selected"}</p>
                  <p><span className="font-medium text-slate-900">Step:</span> {activeStep.title}</p>
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
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsStepNoteDialogOpen(false)}
              disabled={isSavingStepNote}
              className="cursor-pointer border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void saveStepNote()}
              disabled={isSavingStepNote}
              className="cursor-pointer bg-blue-950 text-white hover:bg-blue-950/90"
            >
              {isSavingStepNote ? "Saving..." : "Save note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isStepTaskDialogOpen} onOpenChange={setIsStepTaskDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Create step task</DialogTitle>
            <DialogDescription>Create a task linked to this service follow-up step.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {activeStep ? (
                <>
                  <p><span className="font-medium text-slate-900">Service:</span> {item.service.name}</p>
                  <p><span className="font-medium text-slate-900">Template:</span> {item.followUpTemplate?.name ?? "No template selected"}</p>
                  <p><span className="font-medium text-slate-900">Step:</span> {activeStep.title}</p>
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
              <DateTimeInput
                value={stepTaskDueAt}
                onValueChange={setStepTaskDueAt}
                disabledDate={isBeforeToday}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsStepTaskDialogOpen(false)}
              disabled={isSavingStepTask}
              className="cursor-pointer border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void saveStepTask()}
              disabled={isSavingStepTask}
              className="cursor-pointer bg-blue-950 text-white hover:bg-blue-950/90"
            >
              {isSavingStepTask ? "Saving..." : "Create task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </section>
    </TooltipProvider>
  )
}
