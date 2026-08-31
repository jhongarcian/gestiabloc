"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react"
import { isAxiosError } from "axios"
import {
  ArrowLeft,
  CircleDollarSign,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  CreditCard,
  FileText,
  ImageIcon,
  ListTodo,
  Loader2,
  Logs,
  NotebookPen,
  Paperclip,
  Play,
  SendHorizontal,
  Trash2,
  Upload,
  UserRound,
  X,
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
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import { uploadPrivateFileToSignedUrl } from "@/lib/supabase-storage"
import {
  dateTimeDraftToUtcIso,
  formatDateTimeForDisplay,
  formatUtcIsoToDateTimeDraft,
  isDateTimeDraftComplete,
  isDateTimeDraftEmpty,
  type DateTimeDraft,
} from "@/lib/date-time"
import { cn } from "@/lib/utils"

type ContactServiceStatus =
  | "IN_PROGRESS"
  | "PENDING_PAYMENT"
  | "COMPLETED"
  | "CANCELED"
type ContactServiceChecklistStatus =
  | "NOT_RECEIVED"
  | "INFORMED"
  | "MISSING"
  | "RECEIVED"
type FollowUpStepStatus = "PENDING" | "ACTIVE" | "COMPLETED" | "SKIPPED" | "POSTPONED"
type FollowUpStepAction = "REOPEN"
type NoteAttachment = {
  id: string
  fileId: string
  key: string
  fileName: string
  contentType: string
  size: number | null
}
type PendingUpload = {
  id: string
  file: File
}

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
  timezone?: string | null
  service: {
    id: string
    name: string
    description: string | null
    basePriceCents: number
    isTaxExempt: boolean
    minimumPartialPaymentCents: number | null
    installmentCount: number | null
    installmentFrequency: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | null
  }
  tenantBilling?: {
    taxEnabled: boolean
    taxLabel: string | null
    defaultTaxRatePercent: number | null
  } | null
  followUpTemplate?: {
    id: string
    name: string
  } | null
  followUpTemplateVersion?: {
    id: string
    versionNumber: number
  } | null
  followUpRun?: {
    id: string
    status: "RUNNING" | "WAITING" | "AWAITING_STEP" | "COMPLETED" | "FAILED" | "NEEDS_REVIEW" | "CANCELED"
    resumeAt: string | null
    failureNodeId: string | null
    failureCode: string | null
    failureMessage: string | null
    failedAt: string | null
    canContinueNow?: boolean
    manualWait?: {
      actionId: string
      prompt: string
      scheduledFor: string
      canReschedule: boolean
      canContinueNow: boolean
    } | null
  } | null
  nextFollowUp?: {
    at: string
    stepId: string | null
    source: "USER_SCHEDULED_WAIT" | "STEP_DUE" | "STEP_AVAILABLE"
    projected: boolean
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
    effectiveDueAt?: string | null
    effectiveDueSource?: "USER_SCHEDULED_WAIT" | "STEP_DUE" | "STEP_AVAILABLE" | null
    completedAt: string | null
    resolutionSource?: "USER_COMPLETED" | "USER_SKIPPED" | "CONDITION_SKIPPED" | "FLOW_SKIPPED" | null
    resolutionReason?: string | null
    assignedToUserId: string | null
    assignedTo?: {
      id: string
      name: string | null
      email: string | null
      image?: string | null
    } | null
    note?: string | null
    sortOrder: number
    canCompleteNow?: boolean
    completionRequirement?: {
      type: "NEXT_FOLLOW_UP_AT"
      actionId: string
      prompt: string
      timezone: string
    } | null
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
    kind: "SERVICE_NOTE" | "FOLLOW_UP_NOTE" | "LINKED_CONTACT_NOTE"
    followUpTemplateName?: string | null
    followUpStepTitle?: string | null
    createdBy?: {
      id: string
      name: string
      image?: string | null
    } | null
    attachments: NoteAttachment[]
  }>
  executionLogs: Array<{
    id: string
    eventType: string
    title: string
    details: string | null
    createdAt: string
    actor?: {
      id: string
      name: string | null
    } | null
  }>
  checklistActivityLogs: Array<{
    id: string
    checklistItemId: string | null
    label: string
    previousStatus: ContactServiceChecklistStatus
    status: ContactServiceChecklistStatus
    createdAt: string
    actor?: {
      id: string
      name: string | null
    } | null
  }>
  checklistItems: Array<{
    id: string
    checklistItemId: string
    status: ContactServiceChecklistStatus
    completedAt: string | null
    label: string
    description: string | null
    isRequired: boolean
    sortOrder: number
  }>
}

type ContactServiceOverview = Omit<
  ContactServiceDetails,
  "payments" | "serviceNotes" | "executionLogs" | "checklistActivityLogs"
> & {
  paymentSummary?: {
    latestPaidAt: string | null
    totalPaymentsCount: number
    scheduledPaymentsRecordedCount: number
  }
}

type ContactServiceResponse = {
  ok: boolean
  contactService: ContactServiceDetails
}

type ContactServiceOverviewResponse = {
  ok: boolean
  contactService: ContactServiceOverview
}

type TenantAssigneeOption = {
  value: string
  label: string
  email: string
  image: string | null
}

type TenantAssigneesResponse = {
  ok: boolean
  items: TenantAssigneeOption[]
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

type ChecklistStatusOption = {
  value: ContactServiceChecklistStatus
  label: string
  helper: string
  badgeClassName: string
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

type ContactServiceTab = "overview" | "follow-up" | "payments" | "notes"

const currencyFormatter = (valueCents: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((valueCents || 0) / 100)

const MAX_NOTE_ATTACHMENTS = 10

const centsToUsdInput = (valueCents: number) => ((valueCents || 0) / 100).toFixed(2)

function inferContentType(file: File) {
  if (file.type) return file.type
  const extension = file.name.split(".").pop()?.toLowerCase()
  if (extension === "png") return "image/png"
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg"
  if (extension === "webp") return "image/webp"
  if (extension === "pdf") return "application/pdf"
  return ""
}

function isImageAttachment(contentType: string) {
  return contentType.startsWith("image/")
}

function isPdfAttachment(contentType: string) {
  return contentType === "application/pdf"
}

function attachmentIcon(contentType: string) {
  return isImageAttachment(contentType) ? ImageIcon : FileText
}

function attachmentTone(contentType: string) {
  if (isPdfAttachment(contentType)) {
    return {
      chip:
        "border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100",
      icon: "text-rose-600",
      panel: "border-rose-200/70 bg-rose-50/70",
    }
  }

  if (isImageAttachment(contentType)) {
    return {
      chip:
        "border-sky-200 bg-sky-50 text-sky-700 hover:border-sky-300 hover:bg-sky-100",
      icon: "text-sky-600",
      panel: "border-sky-200/70 bg-sky-50/70",
    }
  }

  return {
    chip:
      "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
    icon: "text-slate-500",
    panel: "border-slate-200 bg-slate-50/70",
  }
}

async function uploadAttachment(tenantId: string, file: File) {
  const contentType = inferContentType(file)
  if (!contentType) {
    throw new Error("UNSUPPORTED_CONTENT_TYPE")
  }

  const { data } = await api.post<{
    bucket: string
    fileId: string
    path: string
    token: string
  }>("/api/files/presign-upload", {
    tenantId,
    filename: file.name,
    contentType,
  })

  await uploadPrivateFileToSignedUrl(data, file, contentType)

  return {
    fileId: data.fileId,
    key: data.path,
    contentType,
    fileName: file.name,
    size: file.size,
  }
}

const DEFAULT_TENANT_BILLING = {
  taxEnabled: false,
  taxLabel: null,
  defaultTaxRatePercent: null,
} satisfies NonNullable<ContactServiceDetails["tenantBilling"]>

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

const getFollowUpAssigneeLabel = (
  assignee:
    | ContactServiceDetails["followUpSteps"][number]["assignedTo"]
    | TenantAssigneeOption
    | null
    | undefined,
) => {
  if (!assignee) return "Unassigned"

  return ("label" in assignee ? assignee.label : assignee.name)?.trim() || assignee.email?.trim() || "Assigned owner"
}

const PAYMENT_METHOD_OPTIONS = [
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card" },
  { value: "CHECK", label: "Check" },
  { value: "TRANSFER", label: "Transfer" },
  { value: "ACH", label: "ACH" },
] as const

const INSTALLMENT_FREQUENCY_LABELS = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Biweekly",
  MONTHLY: "Monthly",
} as const

const PAYMENTS_PAGE_SIZE = 5

const formatPaymentMethod = (value: string | null | undefined) => {
  if (!value) return null

  return PAYMENT_METHOD_OPTIONS.find((option) => option.value === value)?.label ?? value
}

const IN_PROGRESS_STATUS_OPTION: ServiceStatusOption = {
  value: "IN_PROGRESS",
  label: "In Progress",
  bgClassName: "bg-sky-100",
  textClassName: "text-sky-800",
}

const SERVICE_STATUS_OPTIONS: ServiceStatusOption[] = [
  IN_PROGRESS_STATUS_OPTION,
  {
    value: "PENDING_PAYMENT",
    label: "Pending Payment",
    bgClassName: "bg-orange-100",
    textClassName: "text-orange-800",
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

const STATUS_OPTION_BY_VALUE: Record<ContactServiceStatus, ServiceStatusOption> = {
  IN_PROGRESS: IN_PROGRESS_STATUS_OPTION,
  PENDING_PAYMENT: SERVICE_STATUS_OPTIONS[1],
  COMPLETED: SERVICE_STATUS_OPTIONS[2],
  CANCELED: SERVICE_STATUS_OPTIONS[3],
}

const CHECKLIST_STATUS_OPTIONS: ChecklistStatusOption[] = [
  {
    value: "NOT_RECEIVED",
    label: "Not received",
    helper: "Default state",
    badgeClassName: "border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-100",
  },
  {
    value: "INFORMED",
    label: "Informed",
    helper: "Contact informed",
    badgeClassName: "border-blue-200 bg-blue-100 text-blue-800 hover:bg-blue-100",
  },
  {
    value: "MISSING",
    label: "Missing",
    helper: "Item is missing",
    badgeClassName: "border-amber-200 bg-amber-100 text-amber-800 hover:bg-amber-100",
  },
  {
    value: "RECEIVED",
    label: "Received",
    helper: "Counts as complete",
    badgeClassName: "border-emerald-200 bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
  },
]

const CHECKLIST_STATUS_BY_VALUE = Object.fromEntries(
  CHECKLIST_STATUS_OPTIONS.map((option) => [option.value, option]),
) as Record<ContactServiceChecklistStatus, ChecklistStatusOption>

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "-"
  return new Date(value).toLocaleString()
}

const formatDateOnly = (value: string | Date | null | undefined) => {
  if (!value) return "-"
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

const addInstallmentInterval = (
  baseDate: Date,
  frequency: NonNullable<ContactServiceDetails["service"]["installmentFrequency"]>,
  occurrences: number,
) => {
  const nextDate = new Date(baseDate)
  if (frequency === "MONTHLY") {
    nextDate.setMonth(nextDate.getMonth() + occurrences)
    return nextDate
  }

  const daysToAdd = frequency === "WEEKLY" ? 7 * occurrences : 14 * occurrences
  nextDate.setDate(nextDate.getDate() + daysToAdd)
  return nextDate
}

const isBeforeToday = (date: Date) => {
  const candidate = new Date(date)
  candidate.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return candidate < today
}

const getStepTimeMeta = (
  step: ContactServiceDetails["followUpSteps"][number],
  timezone?: string | null,
): StepTimeMeta => {
  if (step.status === "COMPLETED") {
    return {
      label: "Completed",
      helper: step.completedAt ? `Completed ${new Date(step.completedAt).toLocaleString()}` : "Marked as completed",
      badgeClassName: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
    }
  }
  if (step.status === "SKIPPED") {
    return {
      label: "Skipped",
      helper: "Marked as skipped",
      badgeClassName: "bg-slate-200 text-slate-700 hover:bg-slate-200",
    }
  }
  if (step.status === "POSTPONED") {
    return {
      label: "Postponed",
      helper: step.dueAt
        ? `Postponed to ${formatDateTimeForDisplay(step.dueAt, timezone)}`
        : "Postponed",
      badgeClassName: "bg-violet-100 text-violet-800 hover:bg-violet-100",
    }
  }
  const effectiveDueAt = step.effectiveDueAt ?? step.dueAt
  if (!effectiveDueAt) {
    return {
      label: "No due date",
      helper: "No due date configured",
      badgeClassName: "bg-slate-100 text-slate-700 hover:bg-slate-100",
    }
  }

  if (step.effectiveDueSource === "USER_SCHEDULED_WAIT") {
    return {
      label: "Scheduled",
      helper: `Scheduled for ${formatDateTimeForDisplay(effectiveDueAt, timezone)}`,
      badgeClassName: "bg-blue-100 text-blue-800 hover:bg-blue-100",
    }
  }

  const dueDate = new Date(effectiveDueAt)
  const diffMs = dueDate.getTime() - Date.now()
  const diffHours = Math.round(diffMs / (1000 * 60 * 60))

  if (diffMs < 0) {
    return {
      label: "Overdue",
      helper: `Due ${formatDateTimeForDisplay(effectiveDueAt, timezone)}`,
      badgeClassName: "bg-rose-100 text-rose-800 hover:bg-rose-100",
    }
  }

  if (diffHours <= 24) {
    return {
      label: "Due soon",
      helper: `Due ${formatDateTimeForDisplay(effectiveDueAt, timezone)}`,
      badgeClassName: "bg-amber-100 text-amber-800 hover:bg-amber-100",
    }
  }

  return {
    label: "Upcoming",
    helper: `Due ${formatDateTimeForDisplay(effectiveDueAt, timezone)}`,
    badgeClassName: "bg-sky-100 text-sky-800 hover:bg-sky-100",
  }
}

const formatFollowUpStepStatus = (status: FollowUpStepStatus | null | undefined) =>
  (status ?? "PENDING")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())

const getFollowUpStepStatusBadgeClass = (status: FollowUpStepStatus | null | undefined) => {
  switch (status ?? "PENDING") {
    case "ACTIVE":
      return "bg-blue-100 text-blue-900 hover:bg-blue-100"
    case "COMPLETED":
      return "bg-emerald-100 text-emerald-800 hover:bg-emerald-100"
    case "SKIPPED":
      return "bg-slate-200 text-slate-700 hover:bg-slate-200"
    case "POSTPONED":
      return "bg-violet-100 text-violet-800 hover:bg-violet-100"
    default:
      return "bg-slate-100 text-slate-700 hover:bg-slate-100"
  }
}

const getInitials = (value: string | null | undefined) =>
  (value ?? "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "NA"

const normalizeContactServiceDetails = (details: ContactServiceDetails): ContactServiceDetails => ({
  ...details,
  followUpSteps: details.followUpSteps ?? [],
  payments: details.payments ?? [],
  serviceNotes: (details.serviceNotes ?? []).map((note) => ({
    ...note,
    attachments: note.attachments ?? [],
  })),
  executionLogs: details.executionLogs ?? [],
  checklistActivityLogs: details.checklistActivityLogs ?? [],
  checklistItems: (details.checklistItems ?? []).map((checklistItem) => ({
    ...checklistItem,
    status: checklistItem.status ?? (checklistItem.completedAt ? "RECEIVED" : "NOT_RECEIVED"),
  })),
  tenantBilling: {
    ...DEFAULT_TENANT_BILLING,
    ...(details.tenantBilling ?? {}),
  },
})

const normalizeContactServiceOverview = (
  details: ContactServiceOverview,
): ContactServiceOverview => ({
  ...details,
  followUpSteps: details.followUpSteps ?? [],
  checklistItems: (details.checklistItems ?? []).map((checklistItem) => ({
    ...checklistItem,
    status: checklistItem.status ?? (checklistItem.completedAt ? "RECEIVED" : "NOT_RECEIVED"),
  })),
  tenantBilling: {
    ...DEFAULT_TENANT_BILLING,
    ...(details.tenantBilling ?? {}),
  },
  paymentSummary: {
    latestPaidAt: details.paymentSummary?.latestPaidAt ?? null,
    totalPaymentsCount: details.paymentSummary?.totalPaymentsCount ?? 0,
    scheduledPaymentsRecordedCount: details.paymentSummary?.scheduledPaymentsRecordedCount ?? 0,
  },
})

export function ContactServiceDetailsPanel({
  tenantId,
  tenantSlug,
  contactId,
  contactServiceId,
  membershipSecurityLevel,
}: ContactServiceDetailsPanelProps) {
  const serviceNoteFileInputRef = useRef<HTMLInputElement | null>(null)
  const stepNoteFileInputRef = useRef<HTMLInputElement | null>(null)
  const router = useRouter()
  const canManageSensitiveServiceActions = membershipSecurityLevel !== "LOW"
  const encodedTenantId = encodeURIComponent(tenantId)
  const encodedContactId = encodeURIComponent(contactId)
  const encodedContactServiceId = encodeURIComponent(contactServiceId)
  const [activeTab, setActiveTab] = useState<ContactServiceTab>("overview")
  const [overview, setOverview] = useState<ContactServiceOverview | null>(null)
  const [item, setItem] = useState<ContactServiceDetails | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isDetailLoading, setIsDetailLoading] = useState(false)
  const [isLoadingAssignees, setIsLoadingAssignees] = useState(false)
  const [followUpAssigneeOptions, setFollowUpAssigneeOptions] = useState<TenantAssigneeOption[]>([])
  const [isChecklistSavingId, setIsChecklistSavingId] = useState<string | null>(null)
  const [statusOpen, setStatusOpen] = useState(false)
  const [isStatusSaving, setIsStatusSaving] = useState(false)
  const [isChecklistSheetOpen, setIsChecklistSheetOpen] = useState(false)
  const [isActivitySheetOpen, setIsActivitySheetOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isPaymentOpen, setIsPaymentOpen] = useState(false)
  const [isPaymentSaving, setIsPaymentSaving] = useState(false)
  const [isPaymentEditOpen, setIsPaymentEditOpen] = useState(false)
  const [isPaymentDeleting, setIsPaymentDeleting] = useState(false)
  const [isNoteSaving, setIsNoteSaving] = useState(false)
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null)
  const [paymentEntryMode, setPaymentEntryMode] = useState<"FULL" | "PARTIAL">("FULL")
  const [paymentAmountUsd, setPaymentAmountUsd] = useState("")
  const [paymentMethod, setPaymentMethod] = useState<string>("")
  const [paymentNote, setPaymentNote] = useState("")
  const [editPaymentAmountUsd, setEditPaymentAmountUsd] = useState("")
  const [editPaymentMethod, setEditPaymentMethod] = useState<string>("")
  const [editPaymentNote, setEditPaymentNote] = useState("")
  const [serviceNoteTitle, setServiceNoteTitle] = useState("")
  const [serviceNoteBody, setServiceNoteBody] = useState("")
  const [pendingServiceNoteUploads, setPendingServiceNoteUploads] = useState<PendingUpload[]>([])
  const [serviceNoteAttachmentError, setServiceNoteAttachmentError] = useState<string | null>(null)
  const [downloadingServiceNoteKey, setDownloadingServiceNoteKey] = useState<string | null>(null)
  const [visiblePaymentsCount, setVisiblePaymentsCount] = useState(PAYMENTS_PAGE_SIZE)
  const [isStepStatusDialogOpen, setIsStepStatusDialogOpen] = useState(false)
  const [isStepDetailsDialogOpen, setIsStepDetailsDialogOpen] = useState(false)
  const [isStepNoteDialogOpen, setIsStepNoteDialogOpen] = useState(false)
  const [isStepTaskDialogOpen, setIsStepTaskDialogOpen] = useState(false)
  const [followUpOwnerOpen, setFollowUpOwnerOpen] = useState(false)
  const [activeStep, setActiveStep] = useState<ContactServiceDetails["followUpSteps"][number] | null>(
    null,
  )
  const [mutatingStepId, setMutatingStepId] = useState<string | null>(null)
  const [stepStatusValue, setStepStatusValue] = useState<FollowUpStepStatus>("PENDING")
  const [stepStatusNote, setStepStatusNote] = useState("")
  const [stepPostponeInput, setStepPostponeInput] = useState<DateTimeDraft>({ date: "", time: "" })
  const [stepNextFollowUpInput, setStepNextFollowUpInput] = useState<DateTimeDraft>({ date: "", time: "" })
  const [isRescheduleWaitOpen, setIsRescheduleWaitOpen] = useState(false)
  const [rescheduleWaitInput, setRescheduleWaitInput] = useState<DateTimeDraft>({ date: "", time: "" })
  const [isReschedulingWait, setIsReschedulingWait] = useState(false)
  const [isContinuingWait, setIsContinuingWait] = useState(false)
  const [isSavingStepStatus, setIsSavingStepStatus] = useState(false)
  const [isSavingFollowUpOwner, setIsSavingFollowUpOwner] = useState(false)
  const [stepAssignedToUserId, setStepAssignedToUserId] = useState("")
  const [isSavingStepAssignee, setIsSavingStepAssignee] = useState(false)
  const [stepNoteTitle, setStepNoteTitle] = useState("")
  const [stepNoteBody, setStepNoteBody] = useState("")
  const [pendingStepNoteUploads, setPendingStepNoteUploads] = useState<PendingUpload[]>([])
  const [stepNoteAttachmentError, setStepNoteAttachmentError] = useState<string | null>(null)
  const [isSavingStepNote, setIsSavingStepNote] = useState(false)
  const [stepTaskName, setStepTaskName] = useState("")
  const [stepTaskDescription, setStepTaskDescription] = useState("")
  const [stepTaskDueAt, setStepTaskDueAt] = useState<DateTimeDraft>({ date: "", time: "" })
  const [stepTaskAssignedToUserId, setStepTaskAssignedToUserId] = useState("")
  const [isSavingStepTask, setIsSavingStepTask] = useState(false)

  const backHref = `/app/${tenantSlug}/contacts/${contactId}/services`

  const loadOverview = useCallback(async () => {
    setIsLoading(true)
    try {
      const { data } = await api.get<ContactServiceOverviewResponse>(
        `/api/services/${encodedTenantId}/contact-services/${encodedContactServiceId}/overview`,
      )
      setOverview(normalizeContactServiceOverview(data.contactService))
    } catch {
      setOverview(null)
      toast.error("Could not load service enrollment.")
    } finally {
      setIsLoading(false)
    }
  }, [encodedContactServiceId, encodedTenantId])

  const loadItem = useCallback(async () => {
    setIsDetailLoading(true)
    try {
      const { data } = await api.get<ContactServiceResponse>(
        `/api/services/${encodedTenantId}/contact-services/${encodedContactServiceId}`,
      )
      setItem(normalizeContactServiceDetails(data.contactService))
    } catch {
      setItem(null)
      toast.error("Could not load service details.")
    } finally {
      setIsDetailLoading(false)
    }
  }, [encodedContactServiceId, encodedTenantId])

  const loadFollowUpAssignees = useCallback(async () => {
    setIsLoadingAssignees(true)
    try {
      const { data } = await api.get<TenantAssigneesResponse>(
        `/api/tasks/${encodedTenantId}/assignees`,
      )
      setFollowUpAssigneeOptions(data.items ?? [])
    } catch {
      setFollowUpAssigneeOptions([])
      toast.error("Could not load follow-up assignees.")
    } finally {
      setIsLoadingAssignees(false)
    }
  }, [encodedTenantId])

  useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  useEffect(() => {
    void loadFollowUpAssignees()
  }, [loadFollowUpAssignees])

  useEffect(() => {
    setVisiblePaymentsCount(PAYMENTS_PAGE_SIZE)
  }, [item?.id, item?.payments?.length])

  const resetPaymentForm = () => {
    setPaymentEntryMode("FULL")
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
    setPendingServiceNoteUploads([])
    setServiceNoteAttachmentError(null)
    if (serviceNoteFileInputRef.current) {
      serviceNoteFileInputRef.current.value = ""
    }
  }

  const refreshData = useCallback(
    async (includeDetail = Boolean(item)) => {
      await loadOverview()
      if (includeDetail) {
        await loadItem()
      }
    },
    [item, loadItem, loadOverview],
  )

  const ensureDetailLoaded = useCallback(async () => {
    if (item || isDetailLoading) return
    await loadItem()
  }, [isDetailLoading, item, loadItem])

  const openActivitySheet = useCallback(() => {
    setIsActivitySheetOpen(true)
    void ensureDetailLoaded()
  }, [ensureDetailLoaded])

  const openChecklistSheet = useCallback(() => {
    setIsChecklistSheetOpen(true)
    void ensureDetailLoaded()
  }, [ensureDetailLoaded])

  const updateStatus = async (nextStatus: ContactServiceStatus) => {
    const currentService = item ?? overview
    if (!currentService || isStatusSaving || currentService.status === nextStatus) return

    setIsStatusSaving(true)
    try {
      await api.patch(`/api/services/${encodedTenantId}/contact-services/${currentService.id}`, {
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
      await refreshData(Boolean(item))
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
    if (paymentEntryMode === "PARTIAL" && !item.allowPartialPayments) {
      toast.error("This service does not allow partial payments.")
      return
    }

    const amountCents =
      paymentEntryMode === "FULL" ? item.remainingCents : parseUsdToCents(paymentAmountUsd)
    if (amountCents === null || amountCents <= 0) {
      toast.error("Enter a valid payment amount in USD.")
      return
    }
    if (amountCents > item.remainingCents) {
      toast.error("Payment amount cannot be greater than the remaining balance.")
      return
    }

    setIsPaymentSaving(true)
    try {
      await api.post(`/api/services/${encodedTenantId}/contact-services/${item.id}/payments`, {
        amountCents,
        ...(paymentMethod ? { paymentMethod } : {}),
        ...(paymentNote.trim() ? { note: paymentNote.trim() } : {}),
      })
      toast.success("Payment recorded.")
      setIsPaymentOpen(false)
      resetPaymentForm()
      await refreshData(true)
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
    if (!canManageSensitiveServiceActions) {
      toast.error("You do not have permission to delete this service.")
      return
    }

    const currentService = item ?? overview
    if (!currentService) return

    setIsDeleting(true)
    try {
      await api.delete(`/api/services/${encodedTenantId}/contact-services/${currentService.id}`)
      toast.success("Service removed.")
      setIsDeleteDialogOpen(false)
      router.push(backHref)
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        if (backendError === "INSUFFICIENT_SECURITY_LEVEL") {
          toast.error("You do not have permission to delete this service.")
        } else {
          toast.error(
            typeof backendError === "string"
              ? backendError.replace(/_/g, " ")
              : "Could not remove service.",
          )
        }
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
        `/api/services/${encodedTenantId}/contact-services/${item.id}/payments/${selectedPaymentId}`,
        {
          amountCents,
          paymentMethod: editPaymentMethod || null,
          note: editPaymentNote.trim() || null,
        },
      )
      toast.success("Payment updated.")
      setIsPaymentEditOpen(false)
      resetEditPaymentForm()
      await refreshData(true)
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
        `/api/services/${encodedTenantId}/contact-services/${item.id}/payments/${selectedPaymentId}`,
      )
      toast.success("Payment deleted.")
      setIsPaymentEditOpen(false)
      resetEditPaymentForm()
      await refreshData(true)
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

  const handleSelectServiceNoteFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files ?? [])
    if (nextFiles.length === 0) return

    const totalCount = pendingServiceNoteUploads.length + nextFiles.length
    if (totalCount > MAX_NOTE_ATTACHMENTS) {
      setServiceNoteAttachmentError(
        `You can attach up to ${MAX_NOTE_ATTACHMENTS} files.`,
      )
      event.target.value = ""
      return
    }

    setServiceNoteAttachmentError(null)
    setPendingServiceNoteUploads((current) => [
      ...current,
      ...nextFiles.map((file) => ({
        id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
        file,
      })),
    ])
    event.target.value = ""
  }

  const handleOpenServiceNoteAttachment = async (attachment: NoteAttachment) => {
    setDownloadingServiceNoteKey(attachment.key)
    try {
      const { data } = await api.post<{ url: string }>("/api/files/presign-download", {
        tenantId,
        key: attachment.key,
      })

      window.open(data.url, "_blank", "noopener,noreferrer")
    } catch {
      toast.error("Could not open this attachment.")
    } finally {
      setDownloadingServiceNoteKey(null)
    }
  }

  const onAddServiceNote = async () => {
    if (!item) return
    const trimmedTitle = serviceNoteTitle.trim()
    const trimmedBody = serviceNoteBody.trim()
    if (!trimmedTitle || !trimmedBody) {
      toast.error("Enter a title and note before sending.")
      return
    }
    if (pendingServiceNoteUploads.length > MAX_NOTE_ATTACHMENTS) {
      setServiceNoteAttachmentError(
        `You can attach up to ${MAX_NOTE_ATTACHMENTS} files.`,
      )
      return
    }

    setIsNoteSaving(true)
    try {
      const uploadedFiles = []
      for (const pendingUpload of pendingServiceNoteUploads) {
        uploadedFiles.push(await uploadAttachment(tenantId, pendingUpload.file))
      }

      await api.post(`/api/services/${encodedTenantId}/contact-services/${item.id}/notes`, {
        title: trimmedTitle,
        body: trimmedBody,
        attachmentFileIds: uploadedFiles.map((attachment) => attachment.fileId),
      })
      toast.success("Service note added.")
      resetNoteForm()
      await refreshData(true)
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        if (backendError === "UNSUPPORTED_CONTENT_TYPE") {
          toast.error("Only PNG, JPG, WEBP, and PDF files are supported.")
        } else {
          toast.error(
            typeof backendError === "string"
              ? backendError.replace(/_/g, " ")
              : "Could not add service note.",
          )
        }
      } else if (error instanceof Error && error.message === "UNSUPPORTED_CONTENT_TYPE") {
        toast.error("Only PNG, JPG, WEBP, and PDF files are supported.")
      } else {
        toast.error("Could not add service note.")
      }
    } finally {
      setIsNoteSaving(false)
    }
  }

  const updateChecklistStatus = async (
    checklistItem: ContactServiceDetails["checklistItems"][number],
    nextStatus: ContactServiceChecklistStatus,
  ) => {
    if (!item || isChecklistSavingId || checklistItem.status === nextStatus) return
    setIsChecklistSavingId(checklistItem.id)
    try {
      const { data } = await api.patch<{
        ok: boolean
        checklistItem: ContactServiceDetails["checklistItems"][number]
        activity: ContactServiceDetails["checklistActivityLogs"][number] | null
      }>(
        `/api/services/${encodedTenantId}/contact-services/${item.id}/checklist-items/${checklistItem.id}`,
        {
          status: nextStatus,
        },
      )

      setItem((current) =>
        current
          ? {
              ...current,
              checklistItems: current.checklistItems.map((entry) =>
                entry.id === checklistItem.id ? data.checklistItem : entry,
              ),
              checklistActivityLogs:
                data.activity &&
                !current.checklistActivityLogs.some((entry) => entry.id === data.activity?.id)
                  ? [data.activity, ...current.checklistActivityLogs]
                  : current.checklistActivityLogs,
            }
          : current,
      )
      setOverview((current) =>
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

  const serviceData = item ?? overview
  const payments = useMemo(() => item?.payments ?? [], [item?.payments])
  const visiblePayments = useMemo(
    () => payments.slice(0, visiblePaymentsCount),
    [payments, visiblePaymentsCount],
  )
  const serviceNotes = useMemo(() => item?.serviceNotes ?? [], [item?.serviceNotes])
  const checklistItems = useMemo(
    () => item?.checklistItems ?? overview?.checklistItems ?? [],
    [item?.checklistItems, overview?.checklistItems],
  )
  const sortedChecklistItems = useMemo(
    () => [...checklistItems].sort((a, b) => a.sortOrder - b.sortOrder),
    [checklistItems],
  )
  const followUpSteps = useMemo(
    () =>
      [...(item?.followUpSteps ?? overview?.followUpSteps ?? [])]
        .map((step) => ({
          ...step,
          status: step.status ?? (step.completedAt ? "COMPLETED" : "PENDING"),
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [item?.followUpSteps, overview?.followUpSteps],
  )
  const checklistCompletedCount = useMemo(
    () => checklistItems.filter((entry) => entry.status === "RECEIVED").length,
    [checklistItems],
  )
  const checklistCompletionPercentage = useMemo(
    () =>
      checklistItems.length
        ? Math.round((checklistCompletedCount / checklistItems.length) * 100)
        : 0,
    [checklistCompletedCount, checklistItems.length],
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
  const taxAmountCents = useMemo(() => {
    if (!serviceData) return 0
    return Math.max(0, serviceData.totalPriceCents - serviceData.service.basePriceCents)
  }, [serviceData])
  const paymentCollectionState = useMemo(() => {
    if (!serviceData) return "Pay later"
    if (serviceData.paidCents <= 0) return "Pay later"
    if (serviceData.remainingCents > 0) return "Partial payment"
    return "Paid in full"
  }, [serviceData])
  const latestPaymentAt = useMemo(() => {
    if (item && payments.length) {
      return payments.reduce((latest, payment) =>
        new Date(payment.paidAt).getTime() > new Date(latest.paidAt).getTime() ? payment : latest,
      ).paidAt
    }
    return overview?.paymentSummary?.latestPaidAt ?? null
  }, [item, overview?.paymentSummary?.latestPaidAt, payments])
  const completedScheduledPaymentsCount = useMemo(() => {
    if (item) {
      return payments.filter((payment) => payment.note?.trim().toLowerCase() !== "initial payment").length
    }
    return overview?.paymentSummary?.scheduledPaymentsRecordedCount ?? 0
  }, [item, overview?.paymentSummary?.scheduledPaymentsRecordedCount, payments])
  const remainingScheduledInstallments = useMemo(() => {
    if (!serviceData || serviceData.remainingCents <= 0 || !serviceData.service.installmentCount) return 0
    return Math.max(serviceData.service.installmentCount - completedScheduledPaymentsCount, 1)
  }, [completedScheduledPaymentsCount, serviceData])
  const suggestedInstallmentPaymentCents = useMemo(() => {
    if (!serviceData || serviceData.remainingCents <= 0 || remainingScheduledInstallments <= 0) return null
    return Math.ceil(serviceData.remainingCents / remainingScheduledInstallments)
  }, [remainingScheduledInstallments, serviceData])
  const nextScheduledPaymentDate = useMemo(() => {
    if (
      !serviceData?.purchasedAt ||
      serviceData.remainingCents <= 0 ||
      !serviceData.service.installmentCount ||
      !serviceData.service.installmentFrequency
    ) {
      return null
    }

    return addInstallmentInterval(
      new Date(serviceData.purchasedAt),
      serviceData.service.installmentFrequency,
      completedScheduledPaymentsCount + 1,
    )
  }, [completedScheduledPaymentsCount, serviceData])
  const nextScheduledPaymentSummary = useMemo(() => {
    if (!serviceData || !nextScheduledPaymentDate) return null
    return `Next scheduled payment: ${formatDateOnly(nextScheduledPaymentDate)}`
  }, [nextScheduledPaymentDate, serviceData])
  const addPaymentPlanSummary = useMemo(() => {
    if (!serviceData) return ""
    if (serviceData.remainingCents <= 0) return "No balance remains on this service."
    if (!serviceData.allowPartialPayments) {
      return `The remaining balance is ${currencyFormatter(serviceData.remainingCents, serviceData.currency)}.`
    }
    if (suggestedInstallmentPaymentCents !== null && remainingScheduledInstallments > 0) {
      return `${remainingScheduledInstallments} scheduled payment${remainingScheduledInstallments === 1 ? "" : "s"} remaining at about ${currencyFormatter(suggestedInstallmentPaymentCents, serviceData.currency)} each.`
    }
    return `Enter the amount to record against the remaining balance of ${currencyFormatter(serviceData.remainingCents, serviceData.currency)}.`
  }, [remainingScheduledInstallments, serviceData, suggestedInstallmentPaymentCents])
  const canAddPayments = Boolean(serviceData && serviceData.remainingCents > 0)
  const currentStatusOption = serviceData ? STATUS_OPTION_BY_VALUE[serviceData.status] : null
  const tenantBilling = serviceData?.tenantBilling ?? DEFAULT_TENANT_BILLING
  const openFollowUpSteps = useMemo(
    () =>
      followUpSteps.filter(
        (step) => step.status !== "COMPLETED" && step.status !== "SKIPPED",
      ),
    [followUpSteps],
  )
  const currentFollowUpOwner = useMemo(
    () =>
      openFollowUpSteps.find((step) => step.status === "ACTIVE")?.assignedTo ??
      openFollowUpSteps.find((step) => step.status === "POSTPONED")?.assignedTo ??
      openFollowUpSteps.find((step) => step.status === "PENDING")?.assignedTo ??
      openFollowUpSteps[0]?.assignedTo ??
      null,
    [openFollowUpSteps],
  )
  const nextFollowUpStep = useMemo(
    () =>
      followUpSteps.find((step) => step.status === "ACTIVE") ??
      followUpSteps.find((step) => step.status === "POSTPONED") ??
      followUpSteps.find((step) => step.status === "PENDING") ??
      null,
    [followUpSteps],
  )
  const overviewChecklistPreview = useMemo(
    () => sortedChecklistItems.slice(0, 3),
    [sortedChecklistItems],
  )
  const hasMixedOpenStepOwners = useMemo(() => {
    const assignedUserIds = new Set(
      openFollowUpSteps.map((step) => step.assignedToUserId ?? "").filter((value) => value.length > 0),
    )
    const hasUnassignedOpenStep = openFollowUpSteps.some((step) => !step.assignedToUserId)
    return assignedUserIds.size > 1 || (assignedUserIds.size > 0 && hasUnassignedOpenStep)
  }, [openFollowUpSteps])
  const currentFollowUpOwnerUserId = useMemo(() => {
    const uniqueOpenOwnerIds = Array.from(
      new Set(openFollowUpSteps.map((step) => step.assignedToUserId ?? "")),
    )
    return uniqueOpenOwnerIds.length === 1 ? (uniqueOpenOwnerIds[0] ?? "") : ""
  }, [openFollowUpSteps])

  const handleTabChange = useCallback(
    (value: string) => {
      const nextTab = value as ContactServiceTab
      setActiveTab(nextTab)
      if (nextTab !== "overview" && !item && !isDetailLoading) {
        void ensureDetailLoaded()
      }
    },
    [ensureDetailLoaded, isDetailLoading, item],
  )

  const updateFollowUpOwner = async (nextUserId: string) => {
    const currentService = item ?? overview
    if (!currentService) return
    if (!openFollowUpSteps.length) {
      toast.error("There are no open follow-up steps to reassign.")
      return
    }

    const stepsToUpdate = openFollowUpSteps.filter(
      (step) => (step.assignedToUserId ?? "") !== nextUserId,
    )

    if (!stepsToUpdate.length) {
      setFollowUpOwnerOpen(false)
      return
    }

    setIsSavingFollowUpOwner(true)
    try {
      await Promise.all(
        stepsToUpdate.map((step) =>
          api.patch(
            `/api/services/${encodedTenantId}/contact-services/${currentService.id}/follow-up-steps/${step.id}`,
            {
              assignedToUserId: nextUserId || null,
            },
          ),
        ),
      )
      toast.success("Follow-up owner updated.")
      await refreshData(true)
      router.refresh()
      setFollowUpOwnerOpen(false)
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not update follow-up owner.",
        )
      } else {
        toast.error("Could not update follow-up owner.")
      }
    } finally {
      setIsSavingFollowUpOwner(false)
    }
  }

  const openStepStatusDialog = (step: ContactServiceDetails["followUpSteps"][number]) => {
    setActiveStep(step)
    setStepStatusValue("COMPLETED")
    setStepStatusNote("")
    setStepPostponeInput(formatUtcIsoToDateTimeDraft(step.dueAt, item?.timezone))
    setStepNextFollowUpInput({ date: "", time: "" })
    setIsStepStatusDialogOpen(true)
  }

  const prepareStepStatusDialog = async (
    step: ContactServiceDetails["followUpSteps"][number],
  ) => {
    if (!item) return
    if (step.status === "ACTIVE") {
      openStepStatusDialog(step)
      return
    }
    if (step.status !== "PENDING" || !step.canCompleteNow) return

    setMutatingStepId(step.id)
    try {
      if (item.followUpRun) {
        const { data } = await api.post(
          `/api/services/${encodedTenantId}/contact-services/${item.id}/follow-up-run/continue-now`,
        )
        const activeStepId = data?.result?.activeStepId
        await refreshData(true)
        router.refresh()
        if (data?.result?.status === "FAILED") {
          toast.error("The follow-up could not continue because an automation action failed.")
          return
        }
        if (data?.result?.status === "WAITING") {
          toast.success("The follow-up continued to its next scheduled wait.")
          return
        }
        if (activeStepId !== step.id) {
          toast.success("The follow-up continued and selected the next applicable step.")
          return
        }
      } else {
        await api.patch(
          `/api/services/${encodedTenantId}/contact-services/${item.id}/follow-up-steps/${step.id}`,
          { status: "ACTIVE" },
        )
        await refreshData(true)
        router.refresh()
      }

      toast.success("This upcoming step is ready to complete now.")
      openStepStatusDialog({
        ...step,
        status: "ACTIVE",
        availableAt: new Date().toISOString(),
      })
    } catch (error) {
      const backendError = isAxiosError(error) ? error.response?.data?.error : null
      toast.error(
        typeof backendError === "string"
          ? backendError.replace(/_/g, " ")
          : "Could not start this upcoming follow-up early.",
      )
      await refreshData(true)
    } finally {
      setMutatingStepId(null)
    }
  }

  const openStepDetailsDialog = (step: ContactServiceDetails["followUpSteps"][number]) => {
    setActiveStep(step)
    setStepAssignedToUserId(step.assignedToUserId ?? "")
    setIsStepDetailsDialogOpen(true)
  }

  const saveStepAssignee = async () => {
    if (!item || !activeStep) return

    setIsSavingStepAssignee(true)
    try {
      await api.patch(
        `/api/services/${encodedTenantId}/contact-services/${item.id}/follow-up-steps/${activeStep.id}`,
        {
          assignedToUserId: stepAssignedToUserId || null,
        },
      )
      toast.success("Follow-up owner updated.")
      await refreshData(true)
      router.refresh()
      setIsStepDetailsDialogOpen(false)
      setActiveStep(null)
      setStepAssignedToUserId("")
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not update follow-up owner.",
        )
      } else {
        toast.error("Could not update follow-up owner.")
      }
    } finally {
      setIsSavingStepAssignee(false)
    }
  }

  const updateStepStatus = async (
    step: ContactServiceDetails["followUpSteps"][number],
    nextStatus: FollowUpStepStatus,
    note?: string,
    postponeTo?: string,
    nextFollowUpAt?: string,
  ) => {
    if (!item || !nextStatus) return
    setMutatingStepId(step.id)
    try {
      await api.patch(
        `/api/services/${encodedTenantId}/contact-services/${item.id}/follow-up-steps/${step.id}`,
        {
          status: nextStatus,
          ...(note?.trim() ? { note: note.trim() } : {}),
          ...(postponeTo ? { postponeTo, cascadeFutureSteps: true } : {}),
          ...(nextFollowUpAt ? { nextFollowUpAt } : {}),
        },
      )
      toast.success(nextStatus === "COMPLETED" ? "Step marked as completed." : "Step status updated.")
      await refreshData(true)
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

  const reopenStep = async (step: ContactServiceDetails["followUpSteps"][number]) => {
    if (!item) return
    setMutatingStepId(step.id)
    try {
      await api.patch(`/api/services/${encodedTenantId}/contact-services/${item.id}/follow-up-steps/${step.id}`, {
        action: "REOPEN" satisfies FollowUpStepAction,
      })
      toast.success(
        step.status === "POSTPONED" ? "Postponed step moved back to active." : "Step reopened.",
      )
      await refreshData(true)
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not reopen this step.",
        )
      } else {
        toast.error("Could not reopen this step.")
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
        : dateTimeDraftToUtcIso(stepPostponeInput, item?.timezone) ?? undefined
    const needsNextFollowUp =
      stepStatusValue === "COMPLETED" &&
      activeStep.completionRequirement?.type === "NEXT_FOLLOW_UP_AT"
    if (
      needsNextFollowUp &&
      (!isDateTimeDraftComplete(stepNextFollowUpInput) || isDateTimeDraftEmpty(stepNextFollowUpInput))
    ) {
      toast.error("Next follow-up date and time are required.")
      return
    }
    const nextFollowUpAt = needsNextFollowUp
      ? dateTimeDraftToUtcIso(stepNextFollowUpInput, item?.timezone)
      : undefined
    if (needsNextFollowUp && (!nextFollowUpAt || new Date(nextFollowUpAt).getTime() <= Date.now())) {
      toast.error("Select a future next follow-up date and time.")
      return
    }
    const stepToUpdate = activeStep
    const nextStatusValue = stepStatusValue
    const nextStatusNote = stepStatusNote

    setIsSavingStepStatus(true)
    setIsStepStatusDialogOpen(false)
    setActiveStep(null)
    setStepStatusNote("")
    setStepPostponeInput({ date: "", time: "" })
    setStepNextFollowUpInput({ date: "", time: "" })
    await updateStepStatus(
      stepToUpdate,
      nextStatusValue,
      nextStatusNote,
      postponeToIso,
      nextFollowUpAt ?? undefined,
    )
    setIsSavingStepStatus(false)
  }

  const rescheduleManualWait = async () => {
    if (!item || !item.followUpRun?.manualWait) return
    if (!isDateTimeDraftComplete(rescheduleWaitInput) || isDateTimeDraftEmpty(rescheduleWaitInput)) {
      toast.error("Next follow-up date and time are required.")
      return
    }
    const nextFollowUpAt = dateTimeDraftToUtcIso(rescheduleWaitInput, item.timezone)
    if (!nextFollowUpAt || new Date(nextFollowUpAt).getTime() <= Date.now()) {
      toast.error("Select a future next follow-up date and time.")
      return
    }
    setIsReschedulingWait(true)
    try {
      await api.patch(
        `/api/services/${encodedTenantId}/contact-services/${item.id}/follow-up-run/next-follow-up`,
        { nextFollowUpAt },
      )
      toast.success("Next follow-up rescheduled.")
      setIsRescheduleWaitOpen(false)
      await refreshData(true)
      router.refresh()
    } catch (error) {
      const backendError = isAxiosError(error) ? error.response?.data?.error : null
      toast.error(
        typeof backendError === "string"
          ? backendError.replace(/_/g, " ")
          : "Could not reschedule the next follow-up.",
      )
    } finally {
      setIsReschedulingWait(false)
    }
  }

  const continueManualWaitNow = async () => {
    if (!item?.followUpRun?.manualWait) return
    setIsContinuingWait(true)
    try {
      await api.post(
        `/api/services/${encodedTenantId}/contact-services/${item.id}/follow-up-run/continue-now`,
      )
      toast.success("Follow-up continued. The next routed step is ready.")
      await refreshData(true)
      router.refresh()
    } catch (error) {
      const backendError = isAxiosError(error) ? error.response?.data?.error : null
      toast.error(
        typeof backendError === "string"
          ? backendError.replace(/_/g, " ")
          : "Could not continue the follow-up.",
      )
    } finally {
      setIsContinuingWait(false)
    }
  }

  const openStepNoteDialog = (step: ContactServiceDetails["followUpSteps"][number]) => {
    setActiveStep(step)
    setStepNoteTitle("")
    setStepNoteBody("")
    setPendingStepNoteUploads([])
    setStepNoteAttachmentError(null)
    if (stepNoteFileInputRef.current) {
      stepNoteFileInputRef.current.value = ""
    }
    setIsStepNoteDialogOpen(true)
  }

  const handleSelectStepNoteFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files ?? [])
    if (nextFiles.length === 0) return

    const totalCount = pendingStepNoteUploads.length + nextFiles.length
    if (totalCount > MAX_NOTE_ATTACHMENTS) {
      setStepNoteAttachmentError(
        `You can attach up to ${MAX_NOTE_ATTACHMENTS} files.`,
      )
      event.target.value = ""
      return
    }

    setStepNoteAttachmentError(null)
    setPendingStepNoteUploads((current) => [
      ...current,
      ...nextFiles.map((file) => ({
        id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
        file,
      })),
    ])
    event.target.value = ""
  }

  const saveStepNote = async () => {
    if (!item || !activeStep) return
    if (!stepNoteTitle.trim() || !stepNoteBody.trim()) {
      toast.error("Title and note body are required.")
      return
    }
    if (pendingStepNoteUploads.length > MAX_NOTE_ATTACHMENTS) {
      setStepNoteAttachmentError(
        `You can attach up to ${MAX_NOTE_ATTACHMENTS} files.`,
      )
      return
    }

    setIsSavingStepNote(true)
    try {
      const uploadedFiles = []
      for (const pendingUpload of pendingStepNoteUploads) {
        uploadedFiles.push(await uploadAttachment(tenantId, pendingUpload.file))
      }

      await api.post(`/api/contacts/${encodedTenantId}/${encodedContactId}/notes`, {
        title: stepNoteTitle.trim(),
        body: stepNoteBody.trim(),
        contactServiceId: item.id,
        followUpTemplateId: item.followUpTemplate?.id ?? null,
        contactServiceFollowUpStepId: activeStep.id,
        attachmentFileIds: uploadedFiles.map((attachment) => attachment.fileId),
      })
      toast.success("Step note created.")
      setIsStepNoteDialogOpen(false)
      setActiveStep(null)
      setStepNoteTitle("")
      setStepNoteBody("")
      setPendingStepNoteUploads([])
      setStepNoteAttachmentError(null)
      if (stepNoteFileInputRef.current) {
        stepNoteFileInputRef.current.value = ""
      }
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        if (backendError === "UNSUPPORTED_CONTENT_TYPE") {
          toast.error("Only PNG, JPG, WEBP, and PDF files are supported.")
        } else {
          toast.error("Could not create a note for this step.")
        }
      } else if (error instanceof Error && error.message === "UNSUPPORTED_CONTENT_TYPE") {
        toast.error("Only PNG, JPG, WEBP, and PDF files are supported.")
      } else {
        toast.error("Could not create a note for this step.")
      }
    } finally {
      setIsSavingStepNote(false)
    }
  }

  const openStepTaskDialog = (step: ContactServiceDetails["followUpSteps"][number]) => {
    setActiveStep(step)
    setStepTaskName(step.title)
    setStepTaskDescription("")
    setStepTaskDueAt(formatUtcIsoToDateTimeDraft(step.dueAt, item?.timezone))
    setStepTaskAssignedToUserId(step.assignedToUserId ?? "")
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
      await api.post(`/api/tasks/${encodedTenantId}`, {
        name: stepTaskName.trim(),
        contactId,
        description: stepTaskDescription.trim() || null,
        contactServiceId: item.id,
        followUpTemplateId: item.followUpTemplate?.id ?? null,
        contactServiceFollowUpStepId: activeStep.id,
        linkedEntityName: `${item.service.name} - ${activeStep.title}`,
        linkedEntityType: "SERVICE",
        assignedToUserId: stepTaskAssignedToUserId || null,
        dueDate: isDateTimeDraftComplete(stepTaskDueAt)
          ? dateTimeDraftToUtcIso(stepTaskDueAt, item.timezone)
          : null,
        startedAt: new Date().toISOString(),
      })
      toast.success("Task created for follow-up step.")
      setIsStepTaskDialogOpen(false)
      setActiveStep(null)
      setStepTaskName("")
      setStepTaskDescription("")
      setStepTaskDueAt({ date: "", time: "" })
      setStepTaskAssignedToUserId("")
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

    item.checklistActivityLogs.forEach((activity) => {
      const previousStatus = CHECKLIST_STATUS_BY_VALUE[activity.previousStatus]
      const nextStatus = CHECKLIST_STATUS_BY_VALUE[activity.status]
      entries.push({
        id: `checklist-${activity.id}`,
        createdAt: activity.createdAt,
        title: `Checklist updated: ${activity.label}`,
        description: `${previousStatus.label} → ${nextStatus.label}${
          activity.actor?.name ? ` · Updated by ${activity.actor.name}` : ""
        }`,
        tone:
          activity.status === "RECEIVED"
            ? "border-emerald-300 text-emerald-700"
            : activity.status === "MISSING"
              ? "border-amber-300 text-amber-700"
              : activity.status === "INFORMED"
                ? "border-blue-300 text-blue-700"
                : "border-slate-300 text-slate-600",
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

    item.executionLogs.forEach((log) => {
      entries.push({
        id: `execution-${log.id}`,
        createdAt: log.createdAt,
        title: log.title,
        description: log.details ?? (log.actor?.name ? `Updated by ${log.actor.name}` : "Follow-up activity recorded."),
        tone:
          log.eventType === "STEP_STATUS_UPDATED"
            ? "border-blue-200 bg-blue-50/80 text-blue-800"
            : log.eventType === "STEP_ACTIVATED"
              ? "border-amber-200 bg-amber-50/80 text-amber-800"
              : log.eventType === "FLOW_COMPLETED"
                ? "border-emerald-200 bg-emerald-50/80 text-emerald-800"
                : "border-slate-200 bg-slate-50 text-slate-700",
        icon: "status",
      })
    })

    return entries.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
  }, [item, payments, serviceNotes])
  const detailTabState = useMemo(() => {
    if (activeTab === "overview") return "ready" as const
    if (isDetailLoading && !item) return "loading" as const
    if (!item) return "empty" as const
    return "ready" as const
  }, [activeTab, isDetailLoading, item])

  if (isLoading) {
    return (
      <section className="rounded-[26px] border border-slate-200 bg-white p-5 text-sm text-slate-500">
        Loading service enrollment...
      </section>
    )
  }

  if (!serviceData) {
    return (
      <section className="rounded-[26px] border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
        This service enrollment could not be found.
      </section>
    )
  }

  return (
    <TooltipProvider>
      <section className="flex flex-col gap-5">
        <div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-3 shadow-sm md:px-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Link
                href={backHref}
                aria-label="Back to services"
                title="Back to services"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white/85 text-slate-500 shadow-sm transition hover:border-slate-300 hover:bg-white hover:text-slate-900"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </Link>
              <div className="min-w-0 flex-1">
                <h1 className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xl font-semibold leading-tight tracking-tight text-slate-950">
                  <span>{serviceData.service.name}</span>
                  {serviceData.followUpTemplate?.name ? (
                    <>
                      <span className="font-normal text-slate-300" aria-hidden="true">
                        /
                      </span>
                      <span>{serviceData.followUpTemplate.name}</span>
                    </>
                  ) : null}
                </h1>
                <p className="mt-1 text-xs text-slate-500">
                  Professional: {getAssignedProfessionalLabel(serviceData.assignedProfessional)}
                </p>
              </div>
            </div>

            <div className="flex w-full max-w-full shrink-0 flex-nowrap items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] xl:w-auto xl:justify-end xl:overflow-visible xl:pb-0 [&::-webkit-scrollbar]:hidden">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Service checklist"
                  className="h-8 w-8 shrink-0 cursor-pointer rounded-full border border-white/70 bg-blue-950 text-white shadow-sm backdrop-blur transition hover:bg-blue-900 hover:text-white"
                  onClick={openChecklistSheet}
                >
                  <ListTodo aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>
                Service checklist
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Activity log"
                  className="h-8 w-8 shrink-0 cursor-pointer rounded-full border border-white/70 bg-blue-950 text-white shadow-sm backdrop-blur transition hover:bg-blue-900 hover:text-white"
                  onClick={openActivitySheet}
                >
                  <Logs className="h-4 w-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>
                Activity log
              </TooltipContent>
            </Tooltip>

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
                  <span className="truncate">
                    {currentStatusOption?.label ?? toSentence(serviceData.status)}
                  </span>
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
                            serviceData.status === option.value ? "opacity-100" : "opacity-0",
                          )}
                        />
                      </CommandItem>
                    ))}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {canManageSensitiveServiceActions && followUpSteps.length ? (
              <Popover
                open={followUpOwnerOpen}
                onOpenChange={(open) => {
                  if (!canManageSensitiveServiceActions || !followUpSteps.length) return
                  setFollowUpOwnerOpen(open)
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label="Change follow-up assignee"
                    className="h-8 max-w-[260px] cursor-pointer rounded-full border border-white/70 bg-white/70 px-2 py-1 shadow-sm backdrop-blur hover:bg-white/90"
                    disabled={isSavingFollowUpOwner || isLoadingAssignees}
                  >
                    {hasMixedOpenStepOwners ? (
                      <div className="flex min-w-0 max-w-full items-center gap-2">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                          <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                        <span className="truncate text-xs font-medium text-slate-700">
                          Mixed assignees
                        </span>
                      </div>
                    ) : currentFollowUpOwner ? (
                      <div className="flex min-w-0 max-w-full items-center gap-2">
                        <Avatar className="h-5 w-5 shrink-0">
                          <AvatarImage
                            src={currentFollowUpOwner.image ?? undefined}
                            alt={getFollowUpAssigneeLabel(currentFollowUpOwner)}
                          />
                          <AvatarFallback className="bg-blue-950 text-[10px] font-semibold text-white">
                            {getInitials(getFollowUpAssigneeLabel(currentFollowUpOwner))}
                          </AvatarFallback>
                        </Avatar>
                        <span className="truncate text-xs font-medium text-slate-700">
                          {getFollowUpAssigneeLabel(currentFollowUpOwner)}
                        </span>
                      </div>
                    ) : (
                      <div className="flex min-w-0 max-w-full items-center gap-2">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                          <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                        <span className="truncate text-xs font-medium text-slate-600">
                          Unassigned
                        </span>
                      </div>
                    )}
                    {isLoadingAssignees || isSavingFollowUpOwner ? (
                      <Loader2 className="ml-1 h-3.5 w-3.5 shrink-0 animate-spin text-slate-500" />
                    ) : (
                      <ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0 text-slate-500" />
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[320px] p-0">
                  <Command>
                    <CommandInput placeholder="Change follow-up owner..." />
                    <CommandList>
                      <CommandEmpty>No assignees found.</CommandEmpty>
                      <CommandItem
                        onSelect={() => void updateFollowUpOwner("")}
                        className="cursor-pointer gap-2 px-3 py-2"
                        disabled={isSavingFollowUpOwner}
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                          <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                          Unassigned
                        </span>
                        <Check
                          className={cn(
                            "h-4 w-4 text-blue-950",
                            !hasMixedOpenStepOwners && currentFollowUpOwnerUserId === ""
                              ? "opacity-100"
                              : "opacity-0",
                          )}
                        />
                      </CommandItem>
                      {followUpAssigneeOptions.map((assignee) => (
                        <CommandItem
                          key={assignee.value}
                          onSelect={() => void updateFollowUpOwner(assignee.value)}
                          className="cursor-pointer gap-2 px-3 py-2"
                          disabled={isSavingFollowUpOwner}
                        >
                          <Avatar className="h-6 w-6 shrink-0">
                            <AvatarImage src={assignee.image ?? undefined} alt={assignee.label} />
                            <AvatarFallback className="bg-blue-950 text-[10px] font-semibold text-white">
                              {getInitials(assignee.label)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                            {assignee.label}
                          </span>
                          <Check
                            className={cn(
                              "h-4 w-4 text-blue-950",
                              !hasMixedOpenStepOwners &&
                                currentFollowUpOwnerUserId === assignee.value
                                ? "opacity-100"
                                : "opacity-0",
                            )}
                          />
                        </CommandItem>
                      ))}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            ) : hasMixedOpenStepOwners ? (
              <span className="inline-flex h-8 items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-2.5 text-xs font-medium text-slate-700 shadow-sm">
                <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                Mixed assignees
              </span>
            ) : currentFollowUpOwner ? (
              <span className="inline-flex h-8 items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-2.5 text-xs font-medium text-slate-700 shadow-sm">
                <Avatar className="h-5 w-5 shrink-0">
                  <AvatarImage
                    src={currentFollowUpOwner.image ?? undefined}
                    alt={getFollowUpAssigneeLabel(currentFollowUpOwner)}
                  />
                  <AvatarFallback className="bg-blue-950 text-[10px] font-semibold text-white">
                    {getInitials(getFollowUpAssigneeLabel(currentFollowUpOwner))}
                  </AvatarFallback>
                </Avatar>
                {getFollowUpAssigneeLabel(currentFollowUpOwner)}
              </span>
            ) : (
              <span className="inline-flex h-8 items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-2.5 text-xs font-medium text-slate-600 shadow-sm">
                <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                Unassigned
              </span>
            )}

            {canManageSensitiveServiceActions ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Delete service"
                    className="h-8 w-8 shrink-0 cursor-pointer rounded-full border border-rose-100 bg-rose-50/60 text-rose-600 shadow-sm backdrop-blur hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                    onClick={() => setIsDeleteDialogOpen(true)}
                    disabled={isDeleting || isStatusSaving}
                  >
                    {isDeleting ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  Delete service
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
          </div>
        </div>

        <Dialog
          open={isDeleteDialogOpen}
          onOpenChange={(open) => {
            if (isDeleting) return
            setIsDeleteDialogOpen(open)
          }}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Delete service enrollment?</DialogTitle>
              <DialogDescription className="space-y-3">
                <span className="block">
                  This will permanently delete{" "}
                  <span className="font-medium text-slate-900">
                    {serviceData.service.name}
                  </span>{" "}
                  for{" "}
                  <span className="font-medium text-slate-900">
                    {serviceData.contactName?.trim() || "this contact"}
                  </span>, including its payments, checklist progress, service notes, and follow-up
                  history.
                </span>
                <span className="block">
                  Linked CRM tasks will remain, but their service enrollment and follow-up step
                  links will be removed. This action cannot be undone.
                </span>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsDeleteDialogOpen(false)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void onDeleteService()}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                ) : (
                  <Trash2 data-icon="inline-start" />
                )}
                {isDeleting ? "Deleting..." : "Delete service"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="min-w-0 rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-slate-400">
            <CircleDollarSign className="h-4 w-4" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">Total Amount</p>
          </div>
          <p className="mt-2 truncate text-xl font-semibold tracking-tight text-slate-950">
            {currencyFormatter(serviceData.totalPriceCents, serviceData.currency)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {taxAmountCents > 0
              ? `Includes ${currencyFormatter(taxAmountCents, serviceData.currency)} in ${tenantBilling.taxLabel || "tax"}`
              : tenantBilling.taxEnabled && serviceData.service.isTaxExempt
                ? "Tax exempt service"
                : "No tax applied"}
          </p>
        </div>
        <div className="min-w-0 rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-slate-400">
            <CheckCircle2 className="h-4 w-4" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">Paid</p>
          </div>
          <p className="mt-2 truncate text-xl font-semibold tracking-tight text-sky-700">
            {currencyFormatter(serviceData.paidCents, serviceData.currency)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {latestPaymentAt
              ? `Last payment: ${formatDateOnly(latestPaymentAt)}`
              : "No payments recorded yet"}
          </p>
        </div>
        <div className="min-w-0 rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-slate-400">
            <Clock3 className="h-4 w-4" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">Balance Due</p>
          </div>
          <p className="mt-2 truncate text-xl font-semibold tracking-tight text-amber-700">
            {currencyFormatter(serviceData.remainingCents, serviceData.currency)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {serviceData.service.installmentCount
              ? `${remainingScheduledInstallments} installment${remainingScheduledInstallments === 1 ? "" : "s"} left to pay`
              : "No installment schedule configured"}
          </p>
        </div>
        <div className="min-w-0 rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-slate-400">
            <CreditCard className="h-4 w-4" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
              Next Payment
            </p>
          </div>
          <p className="mt-2 truncate text-xl font-semibold tracking-tight text-slate-950">
            {serviceData.remainingCents <= 0
              ? "Paid in full"
              : nextScheduledPaymentDate
                ? formatDateOnly(nextScheduledPaymentDate)
                : "Not scheduled"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {serviceData.remainingCents <= 0
              ? "No remaining balance on this service"
              : serviceData.service.installmentFrequency
                ? `${INSTALLMENT_FREQUENCY_LABELS[serviceData.service.installmentFrequency]} installment schedule`
                : "No installment schedule configured"}
          </p>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-5 shadow-sm md:p-6"
      >
        <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-transparent p-0 md:grid-cols-4">
            <TabsTrigger
              value="overview"
              className="h-10 min-w-0 cursor-pointer rounded-xl bg-slate-50 px-3.5 text-sm font-medium text-slate-600 shadow-none hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 data-[state=active]:border-blue-950 data-[state=active]:bg-blue-950 data-[state=active]:text-white data-[state=active]:shadow-sm"
            >
              Overview
            </TabsTrigger>
            <TabsTrigger
              value="follow-up"
              className="h-10 min-w-0 cursor-pointer rounded-xl bg-slate-50 px-3.5 text-sm font-medium text-slate-600 shadow-none hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 data-[state=active]:border-blue-950 data-[state=active]:bg-blue-950 data-[state=active]:text-white data-[state=active]:shadow-sm"
            >
              Follow up
            </TabsTrigger>
            <TabsTrigger
              value="payments"
              className="h-10 min-w-0 cursor-pointer rounded-xl bg-slate-50 px-3.5 text-sm font-medium text-slate-600 shadow-none hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 data-[state=active]:border-blue-950 data-[state=active]:bg-blue-950 data-[state=active]:text-white data-[state=active]:shadow-sm"
            >
              Payments
            </TabsTrigger>
            <TabsTrigger
              value="notes"
              className="h-10 min-w-0 cursor-pointer rounded-xl bg-slate-50 px-3.5 text-sm font-medium text-slate-600 shadow-none hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 data-[state=active]:border-blue-950 data-[state=active]:bg-blue-950 data-[state=active]:text-white data-[state=active]:shadow-sm"
            >
              Notes
            </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          <div className="grid gap-3 lg:gap-4 2xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
            <section className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-4 shadow-sm sm:p-5">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Enrollment snapshot
                    </p>
                    <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
                      Service overview
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      Key enrollment details, ownership, and progress at a glance.
                    </p>
                  </div>
                  <Badge className="w-fit bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                    {followUpCompletionPercentage}% complete
                  </Badge>
                </div>

                <div className="grid gap-3 min-[520px]:grid-cols-2 2xl:grid-cols-4">
                  <div className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-slate-400">
                      <CircleHelp className="h-4 w-4 text-blue-700" />
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">Status</p>
                    </div>
                    <p className="mt-3 text-base font-semibold text-slate-950">
                      {currentStatusOption?.label ?? toSentence(serviceData.status)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Current enrollment state for this service.
                    </p>
                  </div>

                  <div className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-slate-400">
                      <UserRound className="h-4 w-4 text-blue-700" />
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">Owner</p>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      {hasMixedOpenStepOwners ? (
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                          <UserRound className="h-4 w-4" />
                        </span>
                      ) : currentFollowUpOwner ? (
                        <Avatar className="h-8 w-8 shrink-0 border border-slate-200">
                          <AvatarImage
                            src={currentFollowUpOwner.image ?? undefined}
                            alt={getFollowUpAssigneeLabel(currentFollowUpOwner)}
                          />
                          <AvatarFallback className="bg-blue-950 text-[10px] font-semibold text-white">
                            {getInitials(getFollowUpAssigneeLabel(currentFollowUpOwner))}
                          </AvatarFallback>
                        </Avatar>
                      ) : (
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                          <UserRound className="h-4 w-4" />
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-950">
                          {hasMixedOpenStepOwners
                            ? "Mixed assignees"
                            : getFollowUpAssigneeLabel(currentFollowUpOwner)}
                        </p>
                        <p className="text-xs text-slate-500">
                          Follow-up owner for the open work.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-slate-400">
                      <Clock3 className="h-4 w-4 text-blue-700" />
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">
                        Created
                      </p>
                    </div>
                    <p className="mt-3 text-base font-semibold text-slate-950">
                      {formatDateOnly(serviceData.purchasedAt ?? serviceData.startedAt)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Purchase date for this enrollment.
                    </p>
                  </div>

                  <div className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-slate-400">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">
                        Progress
                      </p>
                    </div>
                    <p className="mt-3 text-base font-semibold text-slate-950">
                      {followUpCompletedCount}/{followUpSteps.length || 0} steps
                    </p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${followUpCompletionPercentage}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section
              className={cn(
                "rounded-[24px] p-4 shadow-sm sm:p-5",
                nextFollowUpStep && getStepTimeMeta(nextFollowUpStep, item?.timezone).label === "Overdue"
                  ? "border border-rose-200 bg-[linear-gradient(135deg,#fff1f2_0%,#fff7ed_45%,#ffffff_100%)]"
                  : "border border-blue-200 bg-[linear-gradient(135deg,#eff6ff_0%,#f8fafc_45%,#ffffff_100%)]",
              )}
            >
              <div className="flex h-full flex-col gap-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "text-xs font-semibold uppercase tracking-[0.14em]",
                        nextFollowUpStep && getStepTimeMeta(nextFollowUpStep, item?.timezone).label === "Overdue"
                          ? "text-rose-700"
                          : "text-blue-700",
                      )}
                    >
                      Next follow-up
                    </p>
                    <h2 className="mt-2 text-lg font-semibold tracking-tight text-slate-950">
                      {nextFollowUpStep?.title ?? "No open follow-up steps"}
                    </h2>
                  </div>
                  {nextFollowUpStep ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={getFollowUpStepStatusBadgeClass(nextFollowUpStep.status)}>
                        {formatFollowUpStepStatus(nextFollowUpStep.status)}
                      </Badge>
                      {getStepTimeMeta(nextFollowUpStep, item?.timezone).label === "Overdue" ? (
                        <Badge className="bg-rose-100 text-rose-800 hover:bg-rose-100">
                          Overdue
                        </Badge>
                      ) : null}
                      <Badge className={getStepTimeMeta(nextFollowUpStep, item?.timezone).badgeClassName}>
                        {getStepTimeMeta(nextFollowUpStep, item?.timezone).label === "Scheduled"
                          ? "Scheduled"
                          : "Due"}
                      </Badge>
                    </div>
                  ) : null}
                </div>

                <p className="text-sm leading-6 text-slate-600">
                  {nextFollowUpStep?.notesTemplate?.trim() ||
                    "This enrollment does not have any remaining follow-up work right now."}
                </p>

                {nextFollowUpStep ? (
                  <div className="grid gap-3 2xl:grid-cols-2">
                    <div className="rounded-[18px] border border-white/80 bg-white/80 px-4 py-3 shadow-sm">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                        Due
                      </p>
                      <p className="mt-2 text-sm font-semibold text-slate-950">
                        {getStepTimeMeta(nextFollowUpStep, item?.timezone).helper}
                      </p>
                    </div>
                    <div className="rounded-[18px] border border-white/80 bg-white/80 px-4 py-3 shadow-sm">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                        Assigned to
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        {nextFollowUpStep.assignedTo ? (
                          <Avatar className="h-7 w-7 shrink-0 border border-slate-200">
                            <AvatarImage
                              src={nextFollowUpStep.assignedTo.image ?? undefined}
                              alt={getFollowUpAssigneeLabel(nextFollowUpStep.assignedTo)}
                            />
                            <AvatarFallback className="bg-blue-950 text-[10px] font-semibold text-white">
                              {getInitials(getFollowUpAssigneeLabel(nextFollowUpStep.assignedTo))}
                            </AvatarFallback>
                          </Avatar>
                        ) : (
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                            <UserRound className="h-3.5 w-3.5" />
                          </span>
                        )}
                        <p className="truncate text-sm font-semibold text-slate-950">
                          {getFollowUpAssigneeLabel(nextFollowUpStep.assignedTo)}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[18px] border border-dashed border-blue-200 bg-white/70 px-4 py-5 text-sm text-slate-500">
                    There is no active, postponed, or pending step waiting right now.
                  </div>
                )}

                {nextFollowUpStep ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full cursor-pointer rounded-full border-blue-200 bg-white text-blue-950 hover:bg-blue-50 sm:w-auto"
                      onClick={() => handleTabChange("follow-up")}
                    >
                      Open follow-up tab
                    </Button>
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          <section className="mt-4 rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Quick checklist preview
                </p>
                <h3 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
                  Required documents snapshot
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  The first items the contact will likely ask about for this service.
                </p>
              </div>
              {checklistItems.length > 3 ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full cursor-pointer rounded-full border-slate-200 bg-white text-slate-700 hover:bg-slate-50 sm:w-auto"
                  onClick={openChecklistSheet}
                >
                  View all checklist items
                </Button>
              ) : null}
            </div>
            {overviewChecklistPreview.length ? (
              <div className="mt-4 grid gap-3 min-[520px]:grid-cols-2 2xl:grid-cols-3">
                {overviewChecklistPreview.map((checklistItem) => (
                  <div
                    key={checklistItem.id}
                    className="rounded-[20px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-sm font-semibold text-slate-900">{checklistItem.label}</p>
                          {checklistItem.isRequired ? (
                            <span className="text-sm font-semibold text-rose-500">*</span>
                          ) : null}
                        </div>
                        <p className="mt-2 text-xs leading-5 text-slate-500">
                          {checklistItem.description?.trim() || "No additional description provided."}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={CHECKLIST_STATUS_BY_VALUE[checklistItem.status].badgeClassName}
                      >
                        {CHECKLIST_STATUS_BY_VALUE[checklistItem.status].label}
                      </Badge>
                    </div>
                    <p className="mt-3 text-xs text-slate-500">
                      {checklistItem.status === "RECEIVED" && checklistItem.completedAt
                        ? `Received ${formatDateTimeForDisplay(
                            checklistItem.completedAt,
                            serviceData.timezone,
                            true,
                          )}`
                        : CHECKLIST_STATUS_BY_VALUE[checklistItem.status].helper}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                This service does not have checklist requirements yet.
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="follow-up" className="pt-4">
          {detailTabState !== "ready" || !item ? (
            <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
              {detailTabState === "loading"
                ? "Loading follow-up details..."
                : "Open this tab to load the service follow-up details."}
            </div>
          ) : (
            <section className="rounded-[24px] border border-slate-200 bg-white p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Service Follow-Up</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Review the enrolled follow-up path for this service and update steps as the contact completes them.
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
              {item.followUpRun?.status === "FAILED" || item.followUpRun?.status === "NEEDS_REVIEW" ? (
                <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                  <p className="font-semibold">
                    {item.followUpRun.status === "FAILED"
                      ? "Workflow paused after an automation error"
                      : "Workflow needs administrator review"}
                  </p>
                  <p className="mt-1 text-xs text-rose-700">
                    {item.followUpRun.failureMessage ??
                      "The existing steps were preserved and new automation is paused."}
                  </p>
                </div>
              ) : null}
              {item.followUpRun?.status === "WAITING" && item.followUpRun.manualWait ? (
                <div className="mb-4 flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold">Next follow-up scheduled</p>
                    <p className="mt-1 text-xs text-blue-800">
                      {item.followUpRun.manualWait.prompt}
                    </p>
                    <p className="mt-1 text-sm font-medium text-blue-950">
                      {formatDateTimeForDisplay(item.followUpRun.manualWait.scheduledFor, item.timezone)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {item.followUpRun.manualWait.canReschedule ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="cursor-pointer border-blue-200 bg-white"
                        disabled={isContinuingWait}
                        onClick={() => {
                          setRescheduleWaitInput(
                            formatUtcIsoToDateTimeDraft(
                              item.followUpRun?.manualWait?.scheduledFor ?? null,
                              item.timezone,
                            ),
                          )
                          setIsRescheduleWaitOpen(true)
                        }}
                      >
                        Change date
                      </Button>
                    ) : null}
                    {item.followUpRun.manualWait.canContinueNow ? (
                      <Button
                        type="button"
                        className="cursor-pointer bg-blue-950 text-white hover:bg-blue-900"
                        disabled={isContinuingWait}
                        onClick={() => void continueManualWaitNow()}
                      >
                        {isContinuingWait ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Play className="mr-2 h-4 w-4" aria-hidden="true" />
                        )}
                        Continue now
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {followUpSteps.length ? (
                <div className="space-y-4">
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${followUpCompletionPercentage}%` }}
                    />
                  </div>
                  <div className="space-y-3">
                    {followUpSteps.map((step, index) => {
                      const currentStatus = step.status ?? "PENDING"
                      const timeMeta = getStepTimeMeta(step, item?.timezone)
                      const isActive = currentStatus === "ACTIVE"
                      const isDone = step.status === "COMPLETED" || step.status === "SKIPPED"
                      const isAutoSkipped =
                        step.resolutionSource === "CONDITION_SKIPPED" ||
                        step.resolutionSource === "FLOW_SKIPPED"
                      const isOverdue = timeMeta.label === "Overdue" && !isDone
                      const showStatusBadge = currentStatus !== "ACTIVE"
                      const showTimeBadge = currentStatus === "PENDING" || currentStatus === "ACTIVE"
                      const canChangeStatus = Boolean(step.canCompleteNow)
                      const isCompletingEarly = currentStatus === "PENDING" && canChangeStatus
                      const canReopen =
                        !isAutoSkipped &&
                        (currentStatus === "COMPLETED" ||
                          currentStatus === "SKIPPED" ||
                          currentStatus === "POSTPONED")

                      return (
                        <div key={step.id} className="flex gap-3">
                          <div className="flex w-8 shrink-0 flex-col items-center pt-2">
                            <span
                              className={cn(
                                "inline-flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold",
                                isOverdue
                                  ? "border-rose-200 bg-rose-50 text-rose-700"
                                  : isAutoSkipped
                                    ? "border-rose-200 bg-rose-100 text-rose-800"
                                  : isDone
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
                              isOverdue
                                ? "border-rose-200 bg-rose-50/40"
                                : isAutoSkipped
                                  ? "border-rose-200 bg-rose-50/60"
                                : isDone
                                ? "border-emerald-200 bg-emerald-50/50"
                                : isActive
                                  ? "border-blue-200 bg-blue-50/40"
                                  : "border-slate-200 bg-white",
                            )}
                          >
                            <div className="flex flex-col gap-3">
                              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                                <div className="min-w-0 flex-1 space-y-2.5">
                                  <div className="flex flex-wrap items-center gap-2">
                                    {showStatusBadge ? (
                                      <Badge className={getFollowUpStepStatusBadgeClass(step.status)}>
                                        {formatFollowUpStepStatus(step.status)}
                                      </Badge>
                                    ) : null}
                                    {showTimeBadge ? (
                                      <Badge className={timeMeta.badgeClassName}>{timeMeta.label}</Badge>
                                    ) : null}
                                    {isActive ? (
                                      <Badge className="bg-blue-100 text-blue-900 hover:bg-blue-100">
                                        Current step
                                      </Badge>
                                    ) : null}
                                    {isAutoSkipped ? (
                                      <Badge className="bg-rose-100 text-rose-800 hover:bg-rose-100">
                                        Skipped by workflow
                                      </Badge>
                                    ) : null}
                                  </div>
                                  <div className="min-w-0 space-y-1.5">
                                    <button
                                      type="button"
                                      className="cursor-pointer text-left text-base font-semibold tracking-tight text-slate-950 transition hover:text-slate-700"
                                      onClick={() => openStepDetailsDialog(step)}
                                    >
                                      {step.title}
                                    </button>
                                    <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-500">
                                      <Clock3 className="h-3.5 w-3.5 text-slate-400" />
                                      <span>{timeMeta.helper}</span>
                                    </div>
                                  </div>
                                  <p className="max-w-3xl text-sm leading-6 text-slate-600">
                                    {step.notesTemplate?.trim() || "No description provided for this step."}
                                  </p>
                                  {step.resolutionReason ? (
                                    <p className="max-w-3xl text-xs font-medium text-rose-700">
                                      {step.resolutionReason}
                                    </p>
                                  ) : null}
                                </div>
                                <div className="flex w-full flex-wrap items-center gap-2 xl:w-auto xl:shrink-0 xl:self-start">
                                  {canChangeStatus ? (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      className="h-9 min-w-[142px] cursor-pointer rounded-full border-slate-200 bg-white text-sm font-medium text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50"
                                      disabled={mutatingStepId === step.id}
                                      onClick={() => void prepareStepStatusDialog(step)}
                                    >
                                      {mutatingStepId === step.id ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <>
                                          {isCompletingEarly ? "Complete early" : "Change status"}
                                          <ChevronDown className="h-4 w-4" />
                                        </>
                                      )}
                                    </Button>
                                  ) : null}
                                  {canReopen ? (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      className="h-9 cursor-pointer rounded-full border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50"
                                      disabled={mutatingStepId === step.id}
                                      onClick={() => void reopenStep(step)}
                                    >
                                      {mutatingStepId === step.id ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : currentStatus === "POSTPONED" ? (
                                        "Undo postpone"
                                      ) : (
                                        "Reopen step"
                                      )}
                                    </Button>
                                  ) : null}
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        className="h-9 w-9 cursor-pointer rounded-xl border-slate-200 bg-white text-fuchsia-700 hover:border-fuchsia-200 hover:bg-white hover:text-fuchsia-800"
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
                                        className="h-9 w-9 cursor-pointer rounded-xl border-slate-200 bg-white text-cyan-700 hover:border-cyan-200 hover:bg-white hover:text-cyan-800"
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
                              {step.note?.trim() ? (
                                <div className="rounded-2xl border border-slate-200/80 bg-white/80 px-3.5 py-3">
                                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                                    Latest Step Note
                                  </p>
                                  <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                                    {step.note}
                                  </p>
                                </div>
                              ) : null}
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
          )}
        </TabsContent>

        <TabsContent value="payments" className="pt-4">
          {detailTabState !== "ready" || !item ? (
            <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
              {detailTabState === "loading"
                ? "Loading payment details..."
                : "Open this tab to load the service payment details."}
            </div>
          ) : (
            <section className="rounded-[24px] border border-slate-200 bg-white p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Payment History</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Review recorded payments and add a new transaction when more balance is collected.
                  </p>
                </div>
                {canManageSensitiveServiceActions ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-9 cursor-pointer rounded-xl border border-blue-100 bg-blue-50/80 px-3.5 text-xs font-semibold text-blue-700 shadow-sm hover:border-blue-200 hover:bg-blue-100/80 hover:text-blue-800"
                    onClick={() => setIsPaymentOpen(true)}
                    disabled={!canAddPayments}
                  >
                    <CircleDollarSign className="h-3.5 w-3.5" />
                    Add transaction
                  </Button>
                ) : null}
              </div>
              <div className="mb-4 grid gap-3 md:grid-cols-3">
                <div className="min-w-0 rounded-[20px] border border-slate-200 bg-slate-50/80 px-4 py-3.5 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Schedule
                  </p>
                  <p className="mt-2 text-base font-semibold text-slate-950">
                    {item.service.installmentCount && item.service.installmentFrequency
                      ? `${item.service.installmentCount} · ${INSTALLMENT_FREQUENCY_LABELS[item.service.installmentFrequency]}`
                      : "Full payment only"}
                  </p>
                </div>
                <div className="min-w-0 rounded-[20px] border border-slate-200 bg-slate-50/80 px-4 py-3.5 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Next Payment Date
                  </p>
                  <p className="mt-2 text-base font-semibold text-slate-950">
                    {item.remainingCents <= 0
                      ? "Paid in full"
                      : nextScheduledPaymentDate
                        ? formatDateOnly(nextScheduledPaymentDate)
                        : "Not scheduled"}
                  </p>
                </div>
                <div className="min-w-0 rounded-[20px] border border-slate-200 bg-slate-50/80 px-4 py-3.5 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Minimum Deposit
                  </p>
                  <p className="mt-2 text-base font-semibold text-slate-950">
                    {item.service.minimumPartialPaymentCents !== null
                      ? currencyFormatter(item.service.minimumPartialPaymentCents, item.currency)
                      : "Not required"}
                  </p>
                </div>
              </div>
              {payments.length ? (
                <div className="overflow-hidden rounded-[22px] border border-slate-200">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/70 px-5 py-3">
                    <p className="text-xs text-slate-500">
                      Showing {Math.min(visiblePaymentsCount, payments.length)} of {payments.length} payments
                    </p>
                    <div className="flex items-center gap-2">
                      <Badge
                        className={cn(
                          "rounded-full px-2.5 py-0.5 hover:bg-inherit",
                          item.remainingCents > 0
                            ? "bg-amber-100 text-amber-800"
                            : "bg-emerald-100 text-emerald-800",
                        )}
                      >
                        {paymentCollectionState}
                      </Badge>
                      {payments.length > PAYMENTS_PAGE_SIZE ? (
                        <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">
                          {payments.length - Math.min(visiblePaymentsCount, payments.length)} more
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] table-fixed">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/40">
                          <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                            Date Paid
                          </th>
                          <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                            Recorded By
                          </th>
                          <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                            Type
                          </th>
                          <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                            Note
                          </th>
                          <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 bg-white">
                        {visiblePayments.map((payment, index) => (
                          <tr
                            key={payment.id ?? `${payment.paidAt}-${payment.amountCents}-${index}`}
                            className={cn(
                              "transition-colors",
                              canManageSensitiveServiceActions
                                ? "cursor-pointer hover:bg-slate-50/60"
                                : "cursor-default",
                            )}
                            onClick={() => {
                              if (!canManageSensitiveServiceActions) return
                              openEditPayment(payment)
                            }}
                          >
                            <td className="px-5 py-3.5 align-top text-sm font-medium text-slate-900">
                              {formatDateTime(payment.paidAt)}
                            </td>
                            <td className="px-5 py-3.5 align-top">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-slate-900">
                                  {payment.recordedBy?.name ?? "System"}
                                </p>
                                <p className="text-xs text-slate-500">Recorded payment</p>
                              </div>
                            </td>
                            <td className="px-5 py-3.5 align-top">
                              {payment.paymentMethod ? (
                                <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                                  {formatPaymentMethod(payment.paymentMethod)}
                                </Badge>
                              ) : (
                                <span className="text-sm text-slate-400">No method</span>
                              )}
                            </td>
                            <td className="px-5 py-3.5 align-top">
                              <p className="line-clamp-2 text-sm leading-6 text-slate-600">
                                {payment.note?.trim() || "Payment recorded for this service."}
                              </p>
                            </td>
                            <td className="px-5 py-3.5 text-right align-top">
                              <p className="text-sm font-semibold text-slate-950">
                                {currencyFormatter(payment.amountCents, item.currency)}
                              </p>
                              <p className="mt-1 text-xs text-emerald-600">Paid</p>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {payments.length > visiblePaymentsCount ? (
                    <div className="flex justify-center border-t border-slate-200 bg-slate-50/60 px-5 py-3">
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
                    <div className="flex justify-center border-t border-slate-200 bg-slate-50/60 px-5 py-3">
                      <Button
                        type="button"
                        variant="ghost"
                        className="cursor-pointer rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-950"
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
          )}
        </TabsContent>

        <TabsContent value="notes" className="pt-4">
          {detailTabState !== "ready" || !item ? (
            <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
              {detailTabState === "loading"
                ? "Loading service notes..."
                : "Open this tab to load the service notes."}
            </div>
          ) : (
            <section className="rounded-[24px] border border-slate-200 bg-white p-5">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Service Notes</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Review all notes tied to this purchased service, including follow-up step notes.
                  </p>
                </div>
                <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                  {serviceNotes.length} note{serviceNotes.length === 1 ? "" : "s"}
                </div>
              </div>
              {serviceNotes.length ? (
                <div className="space-y-3">
                  {serviceNotes.map((note) => (
                    <article key={note.id} className="rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-4 py-4 shadow-sm">
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
                            <h2 className="text-sm font-semibold tracking-tight text-slate-950">{note.title}</h2>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-1">
                                {note.createdBy?.name ? `Added by ${note.createdBy.name}` : "Added to this service"}
                              </span>
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1.5 rounded-full px-2 py-1",
                                  note.kind === "SERVICE_NOTE"
                                    ? "bg-sky-50 text-sky-700"
                                    : note.kind === "FOLLOW_UP_NOTE"
                                      ? "bg-violet-50 text-violet-700"
                                      : "bg-slate-100 text-slate-700",
                                )}
                              >
                                {note.kind === "SERVICE_NOTE"
                                  ? "Service note"
                                  : note.kind === "FOLLOW_UP_NOTE"
                                    ? "Follow-up note"
                                    : "Linked contact note"}
                              </span>
                              {note.followUpTemplateName ? (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-2 py-1 text-violet-700">
                                  Template: {note.followUpTemplateName}
                                </span>
                              ) : null}
                              {note.followUpStepTitle ? (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-1 text-amber-700">
                                  Step: {note.followUpStepTitle}
                                </span>
                              ) : null}
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-1">
                                {formatDateTime(note.createdAt)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 rounded-2xl bg-slate-50/90 px-3.5 py-3">
                        <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{note.body}</p>
                      </div>
                      {note.attachments.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2 border-t border-dashed border-slate-200 pt-3">
                          {note.attachments.map((attachment) => {
                            const AttachmentIcon = attachmentIcon(attachment.contentType)
                            const tone = attachmentTone(attachment.contentType)

                            return (
                              <button
                                key={attachment.id}
                                type="button"
                                onClick={() => void handleOpenServiceNoteAttachment(attachment)}
                                disabled={downloadingServiceNoteKey === attachment.key}
                                className={`inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-60 ${tone.chip}`}
                              >
                                {downloadingServiceNoteKey === attachment.key ? (
                                  <Loader2 className="h-3 w-3 animate-spin text-slate-500" />
                                ) : (
                                  <AttachmentIcon className={`h-3 w-3 ${tone.icon}`} />
                                )}
                                <span className="truncate">{attachment.fileName}</span>
                              </button>
                            )
                          })}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                  No service notes have been added yet.
                </div>
              )}
              <form
                className="mt-5 rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-4 py-4 shadow-sm"
                onSubmit={(event) => {
                  event.preventDefault()
                  void onAddServiceNote()
                }}
              >
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                      New Service Note
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      Capture the service context and attach supporting files in one place.
                    </p>
                  </div>
                  <div className="grid gap-3">
                    <Input
                      value={serviceNoteTitle}
                      onChange={(event) => setServiceNoteTitle(event.target.value)}
                      placeholder="Note title"
                      disabled={isNoteSaving}
                      className="h-11 rounded-[18px] border-slate-200 bg-white px-4 shadow-sm placeholder:text-slate-400 focus-visible:border-blue-200 focus-visible:ring-2 focus-visible:ring-blue-100"
                    />
                    <Textarea
                      value={serviceNoteBody}
                      onChange={(event) => setServiceNoteBody(event.target.value)}
                      rows={4}
                      placeholder="Add a service note..."
                      disabled={isNoteSaving}
                      className="min-h-[132px] resize-none rounded-[18px] border-slate-200 bg-white px-4 py-3 text-sm leading-6 shadow-sm placeholder:text-slate-400 focus-visible:border-blue-200 focus-visible:ring-2 focus-visible:ring-blue-100"
                    />
                  </div>

                  <div className="rounded-[20px] border border-dashed border-slate-200 bg-slate-50/80 px-4 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                          Attachments
                        </p>
                        <p className="mt-1 text-sm text-slate-600">
                          Supported files: PNG, JPG, WEBP, and PDF.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => serviceNoteFileInputRef.current?.click()}
                        disabled={isNoteSaving}
                        className="cursor-pointer border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      >
                        <Upload className="h-4 w-4" />
                        Add files
                      </Button>
                    </div>

                    <input
                      ref={serviceNoteFileInputRef}
                      type="file"
                      accept=".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf"
                      multiple
                      className="hidden"
                      onChange={handleSelectServiceNoteFiles}
                      disabled={isNoteSaving}
                    />

                    {serviceNoteAttachmentError ? (
                      <p className="mt-3 text-sm text-rose-600">{serviceNoteAttachmentError}</p>
                    ) : null}

                    <div className="mt-4 space-y-3">
                      {pendingServiceNoteUploads.map((attachment) => {
                        const contentType = inferContentType(attachment.file)
                        const AttachmentIcon = attachmentIcon(contentType)
                        const tone = attachmentTone(contentType)

                        return (
                          <div
                            key={attachment.id}
                            className={`flex items-center justify-between gap-3 rounded-xl border border-dashed px-3 py-3 ${tone.panel}`}
                          >
                            <div className="min-w-0 flex items-center gap-3">
                              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/90">
                                <AttachmentIcon className={`h-4 w-4 ${tone.icon}`} />
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-slate-900">
                                  {attachment.file.name}
                                </p>
                                <p className="text-xs text-slate-500">
                                  Will upload when you save this note
                                </p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setPendingServiceNoteUploads((current) =>
                                  current.filter((item) => item.id !== attachment.id),
                                )
                              }
                              disabled={isNoteSaving}
                              className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-slate-400 transition hover:bg-white hover:text-rose-600"
                              aria-label={`Remove ${attachment.file.name}`}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        )
                      })}

                      {pendingServiceNoteUploads.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center">
                          <span className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                            <Paperclip className="h-4 w-4" />
                          </span>
                          <p className="mt-3 text-sm font-medium text-slate-700">
                            No files selected yet
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            Attach supporting documents or screenshots to this service note.
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      disabled={isNoteSaving || !serviceNoteTitle.trim() || !serviceNoteBody.trim()}
                      className="cursor-pointer rounded-full bg-blue-950 text-white shadow-sm hover:bg-blue-900"
                    >
                      {isNoteSaving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <SendHorizontal className="h-3.5 w-3.5" />
                      )}
                      Add service note
                    </Button>
                  </div>
                </div>
              </form>
            </section>
          )}
        </TabsContent>

      </Tabs>

      <Sheet
        open={isChecklistSheetOpen}
        onOpenChange={(open) => {
          if (!open && isChecklistSavingId) return
          setIsChecklistSheetOpen(open)
          if (open) void ensureDetailLoaded()
        }}
      >
        <SheetContent
          side="right"
          className="flex h-full w-full flex-col gap-0 overflow-hidden border-l border-slate-200 bg-white p-0 sm:max-w-lg [&>button]:cursor-pointer"
        >
          <SheetHeader className="relative shrink-0 overflow-hidden border-b border-blue-100 bg-[#f1f7ff] px-6 py-6 pr-10 text-left sm:px-7 sm:pr-10">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(30,64,175,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(30,64,175,.08)_1px,transparent_1px)] [background-size:42px_42px]"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-20 -right-12 size-48 rounded-full bg-blue-300/30 blur-3xl"
            />
            <div className="relative">
              <p className="text-xs font-semibold text-blue-700">Service checklist</p>
              <SheetTitle className="mt-1.5 text-xl font-semibold text-slate-950 sm:text-2xl">
                Review checklist
              </SheetTitle>
              <SheetDescription className="mt-1.5 max-w-md text-sm leading-6 text-slate-600">
                Track what is happening with every required item for {serviceData.service.name}.
              </SheetDescription>
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6 [scrollbar-gutter:stable] sm:px-7">
            {isDetailLoading && !item ? (
              <div
                role="status"
                className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-5 text-center"
              >
                <Loader2 className="size-6 animate-spin text-blue-800" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium text-slate-800">
                  Loading service checklist...
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Gathering the latest checklist progress.
                </p>
              </div>
            ) : !item ? (
              <div className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 text-center">
                <span className="inline-flex size-10 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm ring-1 ring-slate-200">
                  <ListTodo className="size-4" aria-hidden="true" />
                </span>
                <p className="mt-3 text-sm font-semibold text-slate-900">Checklist unavailable</p>
                <p className="mt-1 max-w-xs text-sm leading-6 text-slate-500">
                  We could not load this service checklist. Try again to reload its requirements.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4 cursor-pointer rounded-full border-slate-200 bg-white"
                  onClick={() => void ensureDetailLoaded()}
                >
                  Retry
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                <section aria-labelledby="service-checklist-progress" className="flex flex-col gap-3">
                  <div>
                    <h3
                      id="service-checklist-progress"
                      className="text-sm font-semibold text-slate-950"
                    >
                      Checklist progress
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      Only received items count toward completion.
                    </p>
                  </div>
                  <div className="relative">
                    <Progress
                      value={checklistCompletionPercentage}
                      aria-label="Checklist completion"
                      aria-valuetext={`${checklistCompletionPercentage}% complete, ${checklistCompletedCount} of ${checklistItems.length} items`}
                      className="h-7 border border-emerald-100 bg-emerald-100/60 [&_[data-slot=progress-indicator]]:bg-[linear-gradient(90deg,#047857_0%,#10b981_100%)]"
                    />
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-1 left-1 flex items-center rounded-full bg-emerald-950 px-2 text-[10px] font-semibold text-white shadow-sm tabular-nums"
                    >
                      {checklistCompletionPercentage}%
                    </span>
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-1 right-1 flex items-center rounded-full bg-white/90 px-2 text-[11px] font-semibold text-emerald-950 shadow-sm ring-1 ring-emerald-950/5 tabular-nums"
                    >
                      {checklistCompletedCount} of {checklistItems.length} items
                    </span>
                  </div>
                </section>

                {sortedChecklistItems.length ? (
                  <section aria-label="Service checklist items" className="border-t border-slate-200">
                    {sortedChecklistItems.map((checklistItem) => {
                      const isCompleted = checklistItem.status === "RECEIVED"
                      const isSavingChecklist = isChecklistSavingId === checklistItem.id
                      const statusOption = CHECKLIST_STATUS_BY_VALUE[checklistItem.status]

                      return (
                        <div
                          key={checklistItem.id}
                          className={cn(
                            "flex flex-col gap-3 border-b border-slate-200 py-5 last:border-b-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between",
                            isSavingChecklist && "opacity-70",
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold leading-5 text-slate-950">
                                {checklistItem.label}
                              </p>
                              {checklistItem.isRequired ? (
                                <Badge
                                  variant="outline"
                                  className="rounded-full border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-rose-700"
                                >
                                  Required
                                </Badge>
                              ) : null}
                            </div>
                            {checklistItem.description ? (
                              <p className="mt-1.5 text-xs leading-5 text-slate-600">
                                {checklistItem.description}
                              </p>
                            ) : null}
                            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                              {isCompleted ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <Clock3 className="size-3.5 text-slate-400" aria-hidden="true" />
                                  <time dateTime={checklistItem.completedAt ?? undefined}>
                                    {formatDateTimeForDisplay(
                                      checklistItem.completedAt,
                                      item.timezone,
                                      true,
                                    )}
                                  </time>
                                </span>
                              ) : (
                                <span>{statusOption.helper}</span>
                              )}
                            </div>
                          </div>

                          <div className="flex w-full shrink-0 items-center justify-start gap-2 sm:w-auto sm:justify-end">
                            {isSavingChecklist ? (
                              <Loader2
                                className="size-4 animate-spin text-blue-700"
                                aria-label={`Updating ${checklistItem.label}`}
                              />
                            ) : null}
                            <Select
                              value={checklistItem.status}
                              onValueChange={(value) =>
                                void updateChecklistStatus(
                                  checklistItem,
                                  value as ContactServiceChecklistStatus,
                                )
                              }
                              disabled={Boolean(isChecklistSavingId)}
                            >
                              <SelectTrigger
                                size="sm"
                                className={cn(
                                  "h-8 w-fit min-w-0 max-w-full cursor-pointer rounded-full px-3 py-1 text-xs font-semibold shadow-sm ring-1 ring-black/5 [&_[data-slot=select-value]]:truncate sm:max-w-[220px]",
                                  statusOption.badgeClassName,
                                )}
                                aria-label={`Status for ${checklistItem.label}`}
                                aria-busy={isSavingChecklist}
                              >
                                <SelectValue>{statusOption.label}</SelectValue>
                              </SelectTrigger>
                              <SelectContent
                                position="popper"
                                align="end"
                                className="w-[240px] max-w-[calc(100vw-2rem)]"
                              >
                                <SelectGroup>
                                  {CHECKLIST_STATUS_OPTIONS.map((option) => (
                                    <SelectItem
                                      key={option.value}
                                      value={option.value}
                                      className="cursor-pointer gap-2 px-3 py-2"
                                    >
                                      <Badge
                                        variant="outline"
                                        className={cn(
                                          "max-w-[170px] truncate rounded-full px-2 py-1 text-xs font-semibold shadow-sm ring-1 ring-black/5",
                                          option.badgeClassName,
                                        )}
                                      >
                                        {option.label}
                                      </Badge>
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )
                    })}
                  </section>
                ) : (
                  <div className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 text-center">
                    <span className="inline-flex size-10 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm ring-1 ring-slate-200">
                      <ListTodo className="size-4" aria-hidden="true" />
                    </span>
                    <p className="mt-3 text-sm font-semibold text-slate-900">
                      No checklist requirements
                    </p>
                    <p className="mt-1 max-w-xs text-sm leading-6 text-slate-500">
                      This service does not have any checklist items yet.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <SheetFooter className="shrink-0 border-t border-slate-200 bg-slate-50/80 px-6 py-4 sm:flex-row sm:justify-end sm:px-7">
            <SheetClose asChild>
              <Button type="button" variant="outline" disabled={Boolean(isChecklistSavingId)}>
                Close
              </Button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet
        open={isActivitySheetOpen}
        onOpenChange={(open) => {
          setIsActivitySheetOpen(open)
          if (open) void ensureDetailLoaded()
        }}
      >
        <SheetContent
          side="right"
          className="flex h-full w-full flex-col gap-0 overflow-hidden border-l border-slate-200 bg-white p-0 sm:max-w-lg [&>button]:cursor-pointer"
        >
          <SheetHeader className="relative shrink-0 overflow-hidden border-b border-blue-100 bg-[#f1f7ff] px-6 py-6 pr-10 text-left sm:px-7 sm:pr-10">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(rgba(59,130,246,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.08)_1px,transparent_1px)] [background-size:24px_24px]"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-blue-200/50 blur-3xl"
            />
            <div className="relative">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
                Service activity
              </p>
              <SheetTitle className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
                Review activity log
              </SheetTitle>
              <SheetDescription className="mt-2 max-w-md text-sm leading-6 text-slate-600">
                See payments, checklist status changes, notes, and follow-up changes for{" "}
                {serviceData.service.name}.
              </SheetDescription>
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6 [scrollbar-gutter:stable] sm:px-7">
            {isDetailLoading && !item ? (
              <div
                role="status"
                className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-5 text-center"
              >
                <Loader2 className="h-6 w-6 animate-spin text-blue-800" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium text-slate-800">Loading service activity...</p>
                <p className="mt-1 text-xs text-slate-500">Gathering the complete enrollment history.</p>
              </div>
            ) : !item ? (
              <div className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 text-center">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm ring-1 ring-slate-200">
                  <Clock3 className="h-4 w-4" aria-hidden="true" />
                </span>
                <p className="mt-3 text-sm font-semibold text-slate-900">Activity unavailable</p>
                <p className="mt-1 max-w-xs text-sm leading-6 text-slate-500">
                  We could not load this service history. Try again to reload the activity log.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4 cursor-pointer rounded-full border-slate-200 bg-white"
                  onClick={() => void ensureDetailLoaded()}
                >
                  Retry
                </Button>
              </div>
            ) : historyItems.length ? (
              <ol aria-label="Service activity timeline" className="flex flex-col">
                {historyItems.map((historyItem) => (
                  <li
                    key={historyItem.id}
                    className="flex gap-3 border-b border-slate-200 py-5 first:pt-0 last:border-b-0 last:pb-0"
                  >
                    <span
                      className={cn(
                        "mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border",
                        historyItem.tone,
                      )}
                    >
                      {historyItem.icon === "payment" ? (
                        <CreditCard className="h-4 w-4" aria-hidden="true" />
                      ) : historyItem.icon === "checklist" ? (
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      ) : historyItem.icon === "note" ? (
                        <NotebookPen className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Clock3 className="h-4 w-4" aria-hidden="true" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-5 text-slate-900">
                        {historyItem.title}
                      </p>
                      <time
                        dateTime={historyItem.createdAt}
                        className="mt-1 block text-xs font-medium text-slate-500"
                      >
                        {formatDateTimeForDisplay(historyItem.createdAt, item.timezone, true)}
                      </time>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {historyItem.description}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 text-center">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm ring-1 ring-slate-200">
                  <Logs className="h-4 w-4" aria-hidden="true" />
                </span>
                <p className="mt-3 text-sm font-semibold text-slate-900">No activity yet</p>
                <p className="mt-1 max-w-xs text-sm leading-6 text-slate-500">
                  Payments, checklist status changes, notes, and follow-up changes will appear here.
                </p>
              </div>
            )}
          </div>

          <SheetFooter className="shrink-0 border-t border-slate-200 bg-white px-6 py-4 sm:px-7">
            <SheetClose asChild>
              <Button
                type="button"
                variant="outline"
                className="cursor-pointer border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                Close
              </Button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {item ? (
        <>
      <Dialog
        open={isPaymentOpen}
        onOpenChange={(open) => {
          setIsPaymentOpen(open)
          if (!open) resetPaymentForm()
        }}
      >
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader className="gap-1 border-b border-slate-200 pb-4">
            <DialogTitle>Add payment</DialogTitle>
            <DialogDescription>
              Record an additional payment for this service enrollment.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-5 py-4">
            <div className="grid gap-3 rounded-2xl border border-slate-200/90 px-4 py-4 sm:grid-cols-2">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Remaining balance
                </p>
                <div className="mt-2 flex items-center gap-2 text-base font-semibold text-slate-950">
                  <CreditCard className="h-4 w-4 text-slate-500" />
                  {currencyFormatter(item.remainingCents, item.currency)}
                </div>
              </div>
              <div className="min-w-0 sm:text-right">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Status
                </p>
                <div className="mt-2 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                  {paymentCollectionState}
                </div>
                {nextScheduledPaymentSummary ? (
                  <p className="mt-2 text-xs text-slate-500">{nextScheduledPaymentSummary}</p>
                ) : null}
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Payment action</Label>
              <Select
                value={paymentEntryMode}
                onValueChange={(value) => {
                  const nextMode = value as "FULL" | "PARTIAL"
                  setPaymentEntryMode(nextMode)
                  if (nextMode === "FULL") {
                    setPaymentAmountUsd("")
                    return
                  }
                  setPaymentAmountUsd(
                    suggestedInstallmentPaymentCents !== null
                      ? centsToUsdInput(suggestedInstallmentPaymentCents)
                      : "",
                  )
                }}
              >
                <SelectTrigger className="h-11 cursor-pointer rounded-xl border-slate-200 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FULL">Pay remaining in full</SelectItem>
                  <SelectItem value="PARTIAL" disabled={!item.allowPartialPayments}>
                    Record partial payment
                  </SelectItem>
                </SelectContent>
              </Select>
              {paymentEntryMode === "PARTIAL" ? (
                <p className="text-xs leading-5 text-slate-500">
                  {addPaymentPlanSummary} You can record a different amount and the next suggested payment will update automatically.
                </p>
              ) : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Payment Amount (USD)</Label>
                <Input
                  value={
                    paymentEntryMode === "FULL"
                      ? centsToUsdInput(item.remainingCents)
                      : paymentAmountUsd
                  }
                  onChange={(event) => setPaymentAmountUsd(event.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  readOnly={paymentEntryMode === "FULL"}
                  className="h-11 rounded-xl border-slate-200"
                />
                {paymentEntryMode === "PARTIAL" && suggestedInstallmentPaymentCents !== null ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-7 cursor-pointer rounded-full border-slate-200 px-3 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                      onClick={() =>
                        setPaymentAmountUsd(centsToUsdInput(suggestedInstallmentPaymentCents))
                      }
                    >
                      Use {currencyFormatter(suggestedInstallmentPaymentCents, item.currency)}
                    </Button>
                    <p className="text-xs leading-5 text-slate-500">
                      Based on {remainingScheduledInstallments} remaining installment
                      {remainingScheduledInstallments === 1 ? "" : "s"}.
                    </p>
                  </div>
                ) : paymentEntryMode === "PARTIAL" ? (
                  <p className="text-xs leading-5 text-slate-500">
                    Enter any amount up to {currencyFormatter(item.remainingCents, item.currency)}.
                  </p>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label>Payment Method</Label>
                <Select value={paymentMethod || "__none__"} onValueChange={(value) => setPaymentMethod(value === "__none__" ? "" : value)}>
                  <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white">
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
            </div>
            <div className="grid gap-2">
              <Label>Note</Label>
              <Textarea
                value={paymentNote}
                onChange={(event) => setPaymentNote(event.target.value)}
                rows={4}
                placeholder="Optional payment note"
                className="min-h-[112px] rounded-2xl border-slate-200 bg-white px-4 py-3 text-sm leading-6"
              />
            </div>
          </div>
          <DialogFooter className="border-t border-slate-200 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsPaymentOpen(false)}
              disabled={isPaymentSaving}
              className="cursor-pointer rounded-xl"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void onAddPayment()}
              disabled={isPaymentSaving}
              className="cursor-pointer rounded-xl"
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
        open={isStepStatusDialogOpen}
        onOpenChange={(open) => {
          setIsStepStatusDialogOpen(open)
          if (!open) {
            setActiveStep(null)
            setStepStatusNote("")
            setStepPostponeInput({ date: "", time: "" })
            setStepNextFollowUpInput({ date: "", time: "" })
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Update step status</DialogTitle>
            <DialogDescription>
              Move the current step forward and add an optional note. The active step is set automatically by the follow-up flow.
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
            {activeStep?.effectiveDueAt &&
            new Date(activeStep.effectiveDueAt).getTime() > Date.now() ? (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                This step is scheduled for a later time. You can complete it now; its original due
                date will remain in the follow-up history.
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
                  if (nextValue !== "COMPLETED") {
                    setStepNextFollowUpInput({ date: "", time: "" })
                  }
                }}
              >
                <SelectTrigger className="cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
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
            {stepStatusValue === "COMPLETED" &&
            activeStep?.completionRequirement?.type === "NEXT_FOLLOW_UP_AT" ? (
              <div className="grid gap-2 rounded-xl border border-blue-200 bg-blue-50/60 p-3">
                <Label>{activeStep.completionRequirement.prompt}</Label>
                <DateTimeInput
                  value={stepNextFollowUpInput}
                  onValueChange={setStepNextFollowUpInput}
                  disabledDate={isBeforeToday}
                />
                <p className="text-xs text-slate-600">
                  The workflow will pause and activate the next selected step at this time.
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

      <Dialog
        open={isRescheduleWaitOpen}
        onOpenChange={(open) => {
          setIsRescheduleWaitOpen(open)
          if (!open) setRescheduleWaitInput({ date: "", time: "" })
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Change next follow-up</DialogTitle>
            <DialogDescription>
              {item?.followUpRun?.manualWait?.prompt ?? "Select the next follow-up date and time."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-1">
            <Label>Next follow-up date and time</Label>
            <DateTimeInput
              value={rescheduleWaitInput}
              onValueChange={setRescheduleWaitInput}
              disabledDate={isBeforeToday}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer"
              disabled={isReschedulingWait}
              onClick={() => setIsRescheduleWaitOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="cursor-pointer"
              disabled={isReschedulingWait}
              onClick={() => void rescheduleManualWait()}
            >
              {isReschedulingWait ? "Saving..." : "Save date"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isStepDetailsDialogOpen}
        onOpenChange={(open) => {
          setIsStepDetailsDialogOpen(open)
          if (!open) {
            setActiveStep(null)
            setStepAssignedToUserId("")
          }
        }}
      >
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
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Follow-up owner</p>
                <div className="mt-3 flex items-center gap-3">
                  <Avatar className="h-10 w-10 shrink-0 border border-slate-200">
                    <AvatarImage
                      src={activeStep.assignedTo?.image ?? undefined}
                      alt={getFollowUpAssigneeLabel(activeStep.assignedTo)}
                    />
                    <AvatarFallback className="bg-slate-200 text-xs font-semibold text-slate-700">
                      {getInitials(getFollowUpAssigneeLabel(activeStep.assignedTo))}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">
                      {getFollowUpAssigneeLabel(activeStep.assignedTo)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {activeStep.assignedTo?.email || "No owner assigned yet."}
                    </p>
                  </div>
                </div>
                {canManageSensitiveServiceActions ? (
                  <div className="mt-4 grid gap-2">
                    <Label>Change follow-up owner</Label>
                    <Select
                      value={stepAssignedToUserId || "__none__"}
                      onValueChange={(value) =>
                        setStepAssignedToUserId(value === "__none__" ? "" : value)
                      }
                      disabled={isLoadingAssignees || isSavingStepAssignee}
                    >
                      <SelectTrigger className="cursor-pointer">
                        <SelectValue placeholder="Select follow-up owner" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Unassigned</SelectItem>
                        {followUpAssigneeOptions.map((assignee) => (
                          <SelectItem key={assignee.value} value={assignee.value}>
                            {assignee.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-slate-500">
                      Change the owner to rebalance follow-up execution for this service.
                    </p>
                  </div>
                ) : null}
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
            {canManageSensitiveServiceActions ? (
              <Button
                type="button"
                onClick={() => void saveStepAssignee()}
                disabled={
                  isSavingStepAssignee ||
                  (activeStep?.assignedToUserId ?? "") === stepAssignedToUserId
                }
                className="cursor-pointer bg-blue-950 text-white hover:bg-blue-950/90"
              >
                {isSavingStepAssignee ? "Saving..." : "Save owner"}
              </Button>
            ) : null}
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

      <Dialog
        open={isStepNoteDialogOpen}
        onOpenChange={(open) => {
          setIsStepNoteDialogOpen(open)
          if (!open) {
            setStepNoteTitle("")
            setStepNoteBody("")
            setPendingStepNoteUploads([])
            setStepNoteAttachmentError(null)
            if (stepNoteFileInputRef.current) {
              stepNoteFileInputRef.current.value = ""
            }
          }
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add step note</DialogTitle>
            <DialogDescription>
              Add a note for this follow-up step.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            {activeStep ? (
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600">
                  Service: <span className="font-medium text-slate-900">{item.service.name}</span>
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600">
                  Step: <span className="font-medium text-slate-900">{activeStep.title}</span>
                </span>
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label>Title</Label>
              <Input
                value={stepNoteTitle}
                onChange={(event) => setStepNoteTitle(event.target.value)}
                placeholder="Ex: Missing signature"
              />
            </div>
            <div className="grid gap-2">
              <Label>Note</Label>
              <Textarea
                value={stepNoteBody}
                onChange={(event) => setStepNoteBody(event.target.value)}
                rows={5}
                placeholder="Add the details the team should know about this step..."
              />
            </div>
            <div className="rounded-[20px] border border-dashed border-slate-200 bg-slate-50/80 px-4 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                    Attachments
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Add screenshots or documents related to this follow-up step.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => stepNoteFileInputRef.current?.click()}
                  disabled={isSavingStepNote}
                  className="cursor-pointer border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                >
                  <Upload className="h-4 w-4" />
                  Add files
                </Button>
              </div>

              <input
                ref={stepNoteFileInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf"
                multiple
                className="hidden"
                onChange={handleSelectStepNoteFiles}
                disabled={isSavingStepNote}
              />

              {stepNoteAttachmentError ? (
                <p className="mt-3 text-sm text-rose-600">{stepNoteAttachmentError}</p>
              ) : null}

              <div className="mt-4 space-y-3">
                {pendingStepNoteUploads.map((attachment) => {
                  const contentType = inferContentType(attachment.file)
                  const AttachmentIcon = attachmentIcon(contentType)
                  const tone = attachmentTone(contentType)

                  return (
                    <div
                      key={attachment.id}
                      className={`flex items-center justify-between gap-3 rounded-xl border border-dashed px-3 py-3 ${tone.panel}`}
                    >
                      <div className="min-w-0 flex items-center gap-3">
                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/90">
                          <AttachmentIcon className={`h-4 w-4 ${tone.icon}`} />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900">
                            {attachment.file.name}
                          </p>
                          <p className="text-xs text-slate-500">
                            Will upload when you save this step note
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setPendingStepNoteUploads((current) =>
                            current.filter((item) => item.id !== attachment.id),
                          )
                        }
                        disabled={isSavingStepNote}
                        className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-slate-400 transition hover:bg-white hover:text-rose-600"
                        aria-label={`Remove ${attachment.file.name}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )
                })}

                {pendingStepNoteUploads.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center">
                    <span className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                      <Paperclip className="h-4 w-4" />
                    </span>
                    <p className="mt-3 text-sm font-medium text-slate-700">
                      No files selected yet
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Attach supporting files if this step note needs evidence or context.
                    </p>
                  </div>
                ) : null}
              </div>
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
            <DialogDescription>
              Create a task for this follow-up step.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            {activeStep ? (
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600">
                  Service: <span className="font-medium text-slate-900">{item.service.name}</span>
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600">
                  Step: <span className="font-medium text-slate-900">{activeStep.title}</span>
                </span>
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label>Task title</Label>
              <Input
                value={stepTaskName}
                onChange={(event) => setStepTaskName(event.target.value)}
                placeholder="Ex: Follow up on missing document"
              />
            </div>
            <div className="grid gap-2">
              <Label>Description</Label>
              <Textarea
                value={stepTaskDescription}
                onChange={(event) => setStepTaskDescription(event.target.value)}
                rows={4}
                placeholder="Add any details or next actions for this task..."
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Assign to</Label>
                <Select
                  value={stepTaskAssignedToUserId || "__none__"}
                  onValueChange={(value) =>
                    setStepTaskAssignedToUserId(value === "__none__" ? "" : value)
                  }
                >
                  <SelectTrigger className="cursor-pointer">
                    <SelectValue placeholder="Select assignee" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Unassigned</SelectItem>
                    {followUpAssigneeOptions.map((assignee) => (
                      <SelectItem key={assignee.value} value={assignee.value}>
                        {assignee.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
        </>
      ) : null}
      </section>
    </TooltipProvider>
  )
}
