"use client"

import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import { isAxiosError } from "axios"
import { z } from "zod"
import {
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  CircleHelp,
  Clock3,
  Plus,
  Settings2,
  UserRound,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { Bar, BarChart, Cell, Pie, PieChart, XAxis, YAxis } from "recharts"
import { toast } from "sonner"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
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
import { cn } from "@/lib/utils"

type ContactServiceItem = {
  id: string
  status: "PENDING" | "IN_PROGRESS" | "PENDING_PAYMENT" | "COMPLETED" | "CANCELED"
  purchasedAt?: string | null
  totalPriceCents: number
  paidCents: number
  remainingCents: number
  currency: string
  notes: string | null
  service: {
    id: string
    name: string
    description?: string | null
    basePriceCents?: number
    checklistItems?: Array<{
      id: string
      label: string
      description: string | null
      isRequired: boolean
      sortOrder: number
    }>
  }
  followUpTemplate?: {
    id: string
    name: string
  } | null
  checklistItems: Array<{
    id: string
    checklistItemId: string
    completedAt: string | null
    label: string
    description: string | null
    isRequired: boolean
    sortOrder: number
  }>
  followUpSteps: Array<{
    id: string
    status?: "PENDING" | "ACTIVE" | "COMPLETED" | "SKIPPED" | "POSTPONED"
    availableAt?: string | null
    dueAt?: string | null
    completedAt?: string | null
    assignedTo?: {
      id: string
      name: string | null
      email: string | null
      image: string | null
    } | null
  }>
}

type ContactServicesResponse = {
  ok: boolean
  items: ContactServiceItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

type ServiceOptionsResponse = {
  ok: boolean
  items: Array<{
    id: string
    name: string
  }>
}

type ServiceProfessional = {
  id: string
  kind: "INTERNAL_USER" | "EXTERNAL"
  userId: string | null
  externalProfessionalName: string | null
  externalContact: string | null
  sortOrder: number
  user: {
    name: string | null
    email: string | null
    image: string | null
  } | null
}

type ServiceDetailsResponse = {
  ok: boolean
  service: {
    id: string
    name: string
    description: string | null
    basePriceCents: number
    currency: string
    isTaxExempt: boolean
    allowPartialPayments: boolean
    minimumPartialPaymentCents: number | null
    installmentCount: number | null
    installmentFrequency: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | null
    checklistItems: Array<{
      id: string
      label: string
      description: string | null
      isRequired: boolean
      sortOrder: number
    }>
    followUpTemplates: Array<{
      id: string
      name: string
      isPublished: boolean
      sortOrder: number
    }>
    professionals: ServiceProfessional[]
    tenantBilling: {
      taxEnabled: boolean
      taxLabel: string | null
      defaultTaxRatePercent: number | null
    }
  }
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

type ContactServicesPanelProps = {
  tenantId: string
  tenantSlug: string
  contactId: string
  membershipSecurityLevel: "LOW" | "MEDIUM" | "MAX"
}

const currencyFormatter = (valueCents: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((valueCents || 0) / 100)

const toSentence = (value: string) => value.toLowerCase().replace(/_/g, " ")
const centsToUsdInput = (valueCents: number) => ((valueCents || 0) / 100).toFixed(2)
const parseUsdToCents = (value: string) => {
  const normalized = value.replace(/\$/g, "").replace(/,/g, "").trim()
  if (!normalized) return null
  const parsed = Number.parseFloat(normalized)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.round(parsed * 100)
}

const formatDate = (value: string | null | undefined) => {
  if (!value) return "-"

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

const formatCurrencyValue = (value: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0)

const getServiceTotalWithTaxCents = ({
  basePriceCents,
  isTaxExempt,
  taxEnabled,
  defaultTaxRatePercent,
}: {
  basePriceCents: number
  isTaxExempt: boolean
  taxEnabled: boolean
  defaultTaxRatePercent: number | null
}) => {
  if (!taxEnabled || isTaxExempt || defaultTaxRatePercent === null) {
    return basePriceCents
  }

  return basePriceCents + Math.round(basePriceCents * (defaultTaxRatePercent / 100))
}

const INSTALLMENT_FREQUENCY_LABELS = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Biweekly",
  MONTHLY: "Monthly",
} as const

const PROFESSIONAL_TONE_STYLES = {
  internal: {
    surfaceClassName: "border-sky-200 bg-sky-50 text-sky-900",
    fallbackClassName: "bg-sky-100 text-sky-900",
  },
  external: {
    surfaceClassName: "border-orange-200 bg-orange-50 text-orange-900",
    fallbackClassName: "bg-orange-100 text-orange-900",
  },
} as const

const optionalStringIdSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value
    const trimmed = value.trim()
    return trimmed.length ? trimmed : undefined
  },
  z.string().trim().min(1).optional(),
)

const SERVICE_STATUS_STYLES: Record<ContactServiceItem["status"], string> = {
  PENDING: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  IN_PROGRESS: "bg-sky-100 text-sky-800 hover:bg-sky-100",
  PENDING_PAYMENT: "bg-orange-100 text-orange-800 hover:bg-orange-100",
  COMPLETED: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
  CANCELED: "bg-rose-100 text-rose-800 hover:bg-rose-100",
}

const STATUS_CHART_COLORS: Record<ContactServiceItem["status"], string> = {
  PENDING: "#f59e0b",
  IN_PROGRESS: "#0ea5e9",
  PENDING_PAYMENT: "#f97316",
  COMPLETED: "#22c55e",
  CANCELED: "#ef4444",
}

const spendingChartConfig = {
  paid: { label: "Paid", color: "#22c55e" },
  total: { label: "Total", color: "#f59e0b" },
} satisfies ChartConfig

const statusChartConfig = {
  value: { label: "Services", color: "#64748b" },
} satisfies ChartConfig

function getInitials(value: string) {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)

  if (parts.length === 0) return "?"

  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("")
}

function getProfessionalLabel(professional: ServiceProfessional) {
  return (
    professional.externalProfessionalName?.trim() ||
    professional.user?.name?.trim() ||
    professional.user?.email?.trim() ||
    professional.externalContact?.trim() ||
    "Assigned professional"
  )
}

function getProfessionalMeta(professional: ServiceProfessional) {
  if (professional.kind === "INTERNAL_USER") {
    return professional.user?.email?.trim() || "Internal user"
  }

  return professional.externalContact?.trim() || "External professional"
}

function getProfessionalTone(professional: ServiceProfessional) {
  return professional.kind === "INTERNAL_USER" ? "internal" : "external"
}

function FlowStepCard({
  stepNumber,
  title,
  description,
  disabled = false,
  children,
}: {
  stepNumber: string
  title: string
  description: string
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-slate-200 bg-white p-4",
        disabled ? "opacity-60" : undefined,
      )}
    >
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-950 text-xs font-semibold text-white">
          {stepNumber}
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          <p className="text-xs leading-5 text-slate-500">{description}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

function AssignedProfessionalPicker({
  professionals,
  value,
  onValueChange,
  disabled,
}: {
  professionals: ServiceProfessional[]
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)

  const selectedProfessional = useMemo(
    () => professionals.find((professional) => professional.id === value) ?? null,
    [professionals, value],
  )

  const selectedLabel = selectedProfessional
    ? getProfessionalLabel(selectedProfessional)
    : "No assigned professional"

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className="h-10 w-full justify-between rounded-xl border-slate-200 bg-white px-3 text-left font-normal shadow-sm hover:bg-slate-50"
        >
          <div className="flex min-w-0 items-center gap-2">
            {selectedProfessional ? (
              <>
                <Avatar className="h-6 w-6 shrink-0 border border-white shadow-sm">
                  {selectedProfessional.user?.image ? (
                    <AvatarImage
                      src={selectedProfessional.user.image}
                      alt={selectedLabel}
                      className="object-cover"
                    />
                  ) : null}
                  <AvatarFallback
                    className={cn(
                      "text-[11px] font-semibold",
                      PROFESSIONAL_TONE_STYLES[getProfessionalTone(selectedProfessional)]
                        .fallbackClassName,
                    )}
                  >
                    {getInitials(selectedLabel)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate text-[13px] font-medium text-slate-900">
                  {selectedLabel}
                </span>
              </>
            ) : (
              <>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                  <UserRound className="h-3.5 w-3.5" />
                </span>
                <span className="truncate text-[13px] text-slate-500">Unassigned</span>
              </>
            )}
          </div>
          <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 text-slate-500" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[360px] p-0">
        <Command>
          <CommandInput placeholder="Assign professional..." />
          <CommandList>
            <CommandEmpty>No professionals found.</CommandEmpty>
            <CommandItem
              onSelect={() => {
                onValueChange("")
                setOpen(false)
              }}
              className="cursor-pointer gap-2.5 px-3 py-2"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <UserRound className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-slate-900">
                  No assigned professional
                </p>
                <p className="truncate text-[11px] text-slate-500">
                  Create the transaction without assigning anyone yet.
                </p>
              </div>
              <Check
                className={cn(
                  "h-3.5 w-3.5 text-blue-950",
                  selectedProfessional ? "opacity-0" : "opacity-100",
                )}
              />
            </CommandItem>

            {professionals.map((professional) => {
              const label = getProfessionalLabel(professional)
              const meta = getProfessionalMeta(professional)
              const toneStyles =
                PROFESSIONAL_TONE_STYLES[getProfessionalTone(professional)]

              return (
                <CommandItem
                  key={professional.id}
                  onSelect={() => {
                    onValueChange(professional.id)
                    setOpen(false)
                  }}
                  className="cursor-pointer gap-2.5 px-3 py-2"
                >
                  <Avatar
                    className={cn(
                      "h-8 w-8 border shadow-sm",
                      toneStyles.surfaceClassName,
                    )}
                  >
                    {professional.user?.image ? (
                      <AvatarImage
                        src={professional.user.image}
                        alt={label}
                        className="object-cover"
                      />
                    ) : null}
                    <AvatarFallback
                      className={cn("text-xs font-semibold", toneStyles.fallbackClassName)}
                    >
                      {getInitials(label)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-slate-900">
                      {label}
                    </p>
                    <p className="truncate text-[11px] text-slate-500">{meta}</p>
                  </div>
                  <Check
                    className={cn(
                      "h-3.5 w-3.5 text-blue-950",
                      selectedProfessional?.id === professional.id
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                </CommandItem>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function FollowUpAssigneePicker({
  assignees,
  value,
  disabled,
  onValueChange,
}: {
  assignees: TenantAssigneeOption[]
  value: string
  disabled?: boolean
  onValueChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)

  const selectedAssignee = useMemo(
    () => assignees.find((assignee) => assignee.value === value) ?? null,
    [assignees, value],
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full justify-between rounded-xl border-slate-200 bg-white px-3 text-left font-normal shadow-sm hover:bg-slate-50"
          disabled={disabled}
        >
          <div className="flex min-w-0 items-center gap-2">
            {selectedAssignee ? (
              <>
                <Avatar className="h-6 w-6 shrink-0 border border-white shadow-sm">
                  {selectedAssignee.image ? (
                    <AvatarImage
                      src={selectedAssignee.image}
                      alt={selectedAssignee.label}
                      className="object-cover"
                    />
                  ) : null}
                  <AvatarFallback className="bg-blue-100 text-[11px] font-semibold text-blue-900">
                    {getInitials(selectedAssignee.label)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate text-[13px] font-medium text-slate-900">
                  {selectedAssignee.label}
                </span>
              </>
            ) : (
              <>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                  <UserRound className="h-3.5 w-3.5" />
                </span>
                <span className="truncate text-[13px] text-slate-500">Unassigned</span>
              </>
            )}
          </div>
          <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 text-slate-500" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[360px] p-0">
        <Command>
          <CommandInput placeholder="Assign follow-up to..." />
          <CommandList>
            <CommandEmpty>No users found.</CommandEmpty>
            <CommandItem
              onSelect={() => {
                onValueChange("")
                setOpen(false)
              }}
              className="cursor-pointer gap-2.5 px-3 py-2"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <UserRound className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-slate-900">
                  No follow-up owner
                </p>
                <p className="truncate text-[11px] text-slate-500">
                  Leave the enrolled follow-up steps unassigned.
                </p>
              </div>
              <Check
                className={cn(
                  "h-3.5 w-3.5 text-blue-950",
                  selectedAssignee ? "opacity-0" : "opacity-100",
                )}
              />
            </CommandItem>

            {assignees.map((assignee) => (
              <CommandItem
                key={assignee.value}
                onSelect={() => {
                  onValueChange(assignee.value)
                  setOpen(false)
                }}
                className="cursor-pointer gap-2.5 px-3 py-2"
              >
                <Avatar className="h-8 w-8 border border-blue-200 bg-blue-50 shadow-sm">
                  {assignee.image ? (
                    <AvatarImage
                      src={assignee.image}
                      alt={assignee.label}
                      className="object-cover"
                    />
                  ) : null}
                  <AvatarFallback className="bg-blue-100 text-xs font-semibold text-blue-900">
                    {getInitials(assignee.label)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-slate-900">
                    {assignee.label}
                  </p>
                  <p className="truncate text-[11px] text-slate-500">{assignee.email}</p>
                </div>
                <Check
                  className={cn(
                    "h-3.5 w-3.5 text-blue-950",
                    selectedAssignee?.value === assignee.value
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
  )
}

export function ContactServicesPanel({
  tenantId,
  tenantSlug,
  contactId,
}: ContactServicesPanelProps) {
  const router = useRouter()
  const [items, setItems] = useState<ContactServiceItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [createStep, setCreateStep] = useState<1 | 2 | 3 | 4>(1)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoadingServiceOptions, setIsLoadingServiceOptions] = useState(false)
  const [isLoadingServiceDetails, setIsLoadingServiceDetails] = useState(false)
  const [isLoadingAssignees, setIsLoadingAssignees] = useState(false)
  const [serviceOptions, setServiceOptions] = useState<Array<{ id: string; name: string }>>([])
  const [followUpAssigneeOptions, setFollowUpAssigneeOptions] = useState<TenantAssigneeOption[]>([])
  const [createServiceDetails, setCreateServiceDetails] = useState<ServiceDetailsResponse["service"] | null>(null)
  const [createServiceId, setCreateServiceId] = useState("")
  const [createTemplateId, setCreateTemplateId] = useState("")
  const [createAssignedProfessionalId, setCreateAssignedProfessionalId] = useState("")
  const [createFollowUpAssignedToUserId, setCreateFollowUpAssignedToUserId] = useState("")
  const [createPaymentMode, setCreatePaymentMode] = useState<"FULL" | "PARTIAL" | "LATER">("FULL")
  const [createInitialPaymentUsd, setCreateInitialPaymentUsd] = useState("")
  const [createNotes, setCreateNotes] = useState("")
  const [createErrors, setCreateErrors] = useState<
    Partial<
      Record<
        | "serviceId"
        | "templateId"
        | "assignedProfessionalId"
        | "followUpAssignedToUserId"
        | "paymentMode"
        | "initialPaymentUsd"
        | "notes",
        string
      >
    >
  >({})

  const hasItems = items.length > 0

  const resetCreate = () => {
    setCreateStep(1)
    setCreateServiceId("")
    setCreateTemplateId("")
    setCreateAssignedProfessionalId("")
    setCreateFollowUpAssignedToUserId("")
    setCreatePaymentMode("FULL")
    setCreateInitialPaymentUsd("")
    setCreateNotes("")
    setCreateServiceDetails(null)
    setCreateErrors({})
  }

  const loadServices = useCallback(async () => {
    setIsLoading(true)
    try {
      const { data } = await api.get<ContactServicesResponse>(`/api/services/${tenantId}/contact-services`, {
        params: {
          page: 1,
          pageSize: 25,
          contactId,
        },
      })
      setItems(data.items)
    } catch {
      setItems([])
      toast.error("Could not load enrolled services.")
    } finally {
      setIsLoading(false)
    }
  }, [tenantId, contactId])

  const loadServiceOptions = useCallback(async () => {
    setIsLoadingServiceOptions(true)
    try {
      const { data } = await api.get<ServiceOptionsResponse>(
        `/api/account-settings/${encodeURIComponent(tenantId)}/services/options`,
      )
      setServiceOptions(data.items)
    } catch {
      setServiceOptions([])
      toast.error("Could not load services.")
    } finally {
      setIsLoadingServiceOptions(false)
    }
  }, [tenantId])

  const loadFollowUpAssignees = useCallback(async () => {
    setIsLoadingAssignees(true)
    try {
      const { data } = await api.get<TenantAssigneesResponse>(
        `/api/tasks/${encodeURIComponent(tenantId)}/assignees`,
      )
      setFollowUpAssigneeOptions(data.items ?? [])
    } catch {
      setFollowUpAssigneeOptions([])
      toast.error("Could not load follow-up users.")
    } finally {
      setIsLoadingAssignees(false)
    }
  }, [tenantId])

  const loadServiceDetails = useCallback(async (serviceId: string) => {
    if (!serviceId) {
      setCreateServiceDetails(null)
      return
    }
    setIsLoadingServiceDetails(true)
    setCreateServiceDetails(null)
    try {
      const { data } = await api.get<ServiceDetailsResponse>(
        `/api/account-settings/${encodeURIComponent(tenantId)}/services/${encodeURIComponent(serviceId)}`,
      )
      setCreateServiceDetails(data.service)
      setCreateAssignedProfessionalId((current) =>
        data.service.professionals.some((item) => item.id === current) ? current : "",
      )
      setCreateTemplateId((current) =>
        data.service.followUpTemplates.some((item) => item.id === current) ? current : "",
      )
      setCreatePaymentMode((prev) => {
        if (prev === "PARTIAL" && !data.service.allowPartialPayments) {
          return "FULL"
        }
        return prev
      })
    } catch {
      setCreateServiceDetails(null)
      toast.error("Could not load service details.")
    } finally {
      setIsLoadingServiceDetails(false)
    }
  }, [tenantId])

  useEffect(() => {
    void loadServices()
  }, [loadServices])

  useEffect(() => {
    if (!isCreateOpen) return
    if (serviceOptions.length === 0) {
      void loadServiceOptions()
    }
    if (followUpAssigneeOptions.length === 0) {
      void loadFollowUpAssignees()
    }
  }, [
    followUpAssigneeOptions.length,
    isCreateOpen,
    loadFollowUpAssignees,
    loadServiceOptions,
    serviceOptions.length,
  ])

  useEffect(() => {
    if (!isCreateOpen || !createServiceId) return
    void loadServiceDetails(createServiceId)
  }, [createServiceId, isCreateOpen, loadServiceDetails])

  useEffect(() => {
    if (!createServiceDetails) {
      setCreateAssignedProfessionalId("")
      setCreateTemplateId("")
      return
    }

    if (
      !createServiceDetails.professionals.some(
        (item) => item.id === createAssignedProfessionalId,
      )
    ) {
      setCreateAssignedProfessionalId("")
    }

    if (
      !createServiceDetails.followUpTemplates.some((item) => item.id === createTemplateId)
    ) {
      setCreateTemplateId("")
    }
  }, [createAssignedProfessionalId, createServiceDetails, createTemplateId])

  const clearCreateError = (
    field:
      | "serviceId"
      | "templateId"
      | "assignedProfessionalId"
      | "followUpAssignedToUserId"
      | "paymentMode"
      | "initialPaymentUsd"
      | "notes",
  ) => {
    setCreateErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  const serviceStepSchema = useMemo(
    () =>
      z
        .object({
          serviceId: z.string().trim().min(1, "Select a service."),
          assignedProfessionalId: optionalStringIdSchema,
        })
        .superRefine((value, ctx) => {
          if (
            value.assignedProfessionalId &&
            !createServiceDetails?.professionals.some(
              (professional) => professional.id === value.assignedProfessionalId,
            )
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["assignedProfessionalId"],
              message: "Select a valid professional.",
            })
          }
        }),
    [createServiceDetails],
  )

  const followUpStepSchema = useMemo(
    () =>
      z
        .object({
          templateId: optionalStringIdSchema,
          followUpAssignedToUserId: optionalStringIdSchema,
        })
        .superRefine((value, ctx) => {
          if (
            value.templateId &&
            !createServiceDetails?.followUpTemplates.some(
              (template) => template.id === value.templateId,
            )
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["templateId"],
              message: "Select a valid follow-up template.",
            })
          }

          if (
            value.followUpAssignedToUserId &&
            !followUpAssigneeOptions.some(
              (assignee) => assignee.value === value.followUpAssignedToUserId,
            )
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["followUpAssignedToUserId"],
              message: "Select a valid follow-up owner.",
            })
          }
        }),
    [createServiceDetails, followUpAssigneeOptions],
  )

  const paymentStepSchema = useMemo(
    () =>
      z
        .object({
          paymentMode: z.enum(["FULL", "PARTIAL", "LATER"]),
          initialPaymentUsd: z.string(),
          notes: z.string().trim().max(4000, "Notes must be 4,000 characters or less."),
        })
        .superRefine((value, ctx) => {
          if (value.paymentMode === "PARTIAL" && !createServiceDetails?.allowPartialPayments) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["paymentMode"],
              message: "This service does not allow partial payments.",
            })
          }

          if (value.paymentMode !== "PARTIAL" || !createServiceDetails) {
            return
          }

          const initialPaymentCents = parseUsdToCents(value.initialPaymentUsd)
          const maxAllowedTotalCents = createServiceDetails
            ? getServiceTotalWithTaxCents({
                basePriceCents: createServiceDetails.basePriceCents,
                isTaxExempt: createServiceDetails.isTaxExempt,
                taxEnabled: createServiceDetails.tenantBilling.taxEnabled,
                defaultTaxRatePercent: createServiceDetails.tenantBilling.defaultTaxRatePercent,
              })
            : null

          if (initialPaymentCents === null || initialPaymentCents <= 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["initialPaymentUsd"],
              message: "Enter a valid partial payment amount in USD.",
            })
            return
          }

          if (maxAllowedTotalCents !== null && initialPaymentCents > maxAllowedTotalCents) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["initialPaymentUsd"],
              message: "Partial payment cannot be greater than total amount.",
            })
          }

          if (
            createServiceDetails.minimumPartialPaymentCents !== null &&
            initialPaymentCents < createServiceDetails.minimumPartialPaymentCents
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["initialPaymentUsd"],
              message: "Partial payment is below the minimum allowed for this service.",
            })
          }
        }),
    [createServiceDetails],
  )

  const applyCreateSchemaErrors = <
    T extends
      | "serviceId"
      | "templateId"
      | "assignedProfessionalId"
      | "followUpAssignedToUserId"
      | "paymentMode"
      | "initialPaymentUsd"
      | "notes",
  >(
    result: { error: z.ZodError },
    fields: T[],
  ) => {
    const nextFieldErrors: typeof createErrors = {}

    for (const field of fields) {
      const issue = result.error.issues.find((entry) => entry.path[0] === field)
      if (issue?.message) {
        nextFieldErrors[field] = issue.message
      }
    }

    setCreateErrors((current) => ({
      ...current,
      ...Object.fromEntries(fields.map((field) => [field, undefined])),
      ...nextFieldErrors,
    }))
  }

  const validateCreateServiceStep = () => {
    const result = serviceStepSchema.safeParse({
      serviceId: createServiceId,
      assignedProfessionalId: createAssignedProfessionalId,
    })

    if (result.success) {
      setCreateErrors((current) => ({
        ...current,
        serviceId: undefined,
        assignedProfessionalId: undefined,
      }))
      return true
    }

    applyCreateSchemaErrors(result, ["serviceId", "assignedProfessionalId"])
    return false
  }

  const validateCreateFollowUpStep = () => {
    const result = followUpStepSchema.safeParse({
      templateId: createTemplateId,
      followUpAssignedToUserId: createFollowUpAssignedToUserId,
    })

    if (result.success) {
      setCreateErrors((current) => ({
        ...current,
        templateId: undefined,
        followUpAssignedToUserId: undefined,
      }))
      return true
    }

    applyCreateSchemaErrors(result, ["templateId", "followUpAssignedToUserId"])
    return false
  }

  const validateCreatePaymentStep = () => {
    const result = paymentStepSchema.safeParse({
      paymentMode: createPaymentMode,
      initialPaymentUsd: createInitialPaymentUsd,
      notes: createNotes,
    })

    if (result.success) {
      setCreateErrors((current) => ({
        ...current,
        paymentMode: undefined,
        initialPaymentUsd: undefined,
        notes: undefined,
      }))
      return true
    }

    applyCreateSchemaErrors(result, ["paymentMode", "initialPaymentUsd", "notes"])
    return false
  }

  const onNextCreateStep = () => {
    if (createStep === 1) {
      if (!validateCreateServiceStep()) {
        toast.error("Select a service and review the assignment.")
        return
      }

      if (!createServiceDetails || isLoadingServiceDetails) {
        toast.error("Wait for the service details to finish loading.")
        return
      }

      setCreateStep(2)
      return
    }

    if (createStep === 2) {
      if (!validateCreateFollowUpStep()) {
        toast.error("Review the follow-up selections.")
        return
      }

      setCreateStep(3)
      return
    }

    setCreateStep(4)
  }

  const onPreviousCreateStep = () => {
    setCreateStep((current) => (current === 1 ? 1 : ((current - 1) as 1 | 2 | 3 | 4)))
  }

  const totals = useMemo(() => {
    const enrolled = items.length
    const completed = items.filter((item) => item.status === "COMPLETED").length
    const totalPaidCents = items.reduce((sum, item) => sum + item.paidCents, 0)
    const totalRemainingCents = items.reduce((sum, item) => sum + item.remainingCents, 0)
    return {
      enrolled,
      completed,
      totalPaidCents,
      totalRemainingCents,
    }
  }, [items])

  const spendingBreakdownData = useMemo(() => {
    return items.map((item) => ({
      id: item.id,
      serviceName: item.service.name,
      paid: Number((item.paidCents / 100).toFixed(2)),
      total: Number((item.totalPriceCents / 100).toFixed(2)),
      balance: Number((item.remainingCents / 100).toFixed(2)),
      currency: item.currency,
    }))
  }, [items])

  const statusBreakdownData = useMemo(
    () =>
      (["PENDING", "IN_PROGRESS", "PENDING_PAYMENT", "COMPLETED", "CANCELED"] as const).map((status) => ({
        status,
        label: toSentence(status),
        value: items.filter((item) => item.status === status).length,
        fill: STATUS_CHART_COLORS[status],
      })),
    [items],
  )

  const getServiceProgress = (item: ContactServiceItem) => {
    const total = item.followUpSteps.length
    const completed = item.followUpSteps.filter(
      (step) =>
        step.status === "COMPLETED" ||
        step.status === "SKIPPED" ||
        Boolean(step.completedAt),
    ).length
    const remaining = Math.max(0, total - completed)
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0
    return { total, completed, remaining, percentage }
  }

  const getNextFollowUpDate = (item: ContactServiceItem) => {
    const nextStep =
      item.followUpSteps.find((step) => step.status === "ACTIVE") ??
      item.followUpSteps.find((step) => step.status === "POSTPONED") ??
      item.followUpSteps.find((step) => step.status === "PENDING") ??
      null

    return nextStep?.dueAt ?? nextStep?.availableAt ?? null
  }

  const getCurrentFollowUpAssignee = (item: ContactServiceItem) => {
    const nextStep =
      item.followUpSteps.find((step) => step.status === "ACTIVE") ??
      item.followUpSteps.find((step) => step.status === "POSTPONED") ??
      item.followUpSteps.find((step) => step.status === "PENDING") ??
      null

    return nextStep?.assignedTo ?? null
  }

  const createServiceTotalCents = useMemo(() => {
    if (!createServiceDetails) return null

    return getServiceTotalWithTaxCents({
      basePriceCents: createServiceDetails.basePriceCents,
      isTaxExempt: createServiceDetails.isTaxExempt,
      taxEnabled: createServiceDetails.tenantBilling.taxEnabled,
      defaultTaxRatePercent: createServiceDetails.tenantBilling.defaultTaxRatePercent,
    })
  }, [createServiceDetails])

  const onCreate = async () => {
    if (!validateCreateServiceStep()) {
      setCreateStep(1)
      toast.error("Select a service and review the assignment.")
      return
    }

    if (!validateCreateFollowUpStep()) {
      setCreateStep(2)
      toast.error("Review the follow-up selections.")
      return
    }

    const totalPriceCents = createServiceTotalCents
    if (totalPriceCents === null) {
      setCreateStep(1)
      toast.error("Select a valid service.")
      return
    }

    if (!validateCreatePaymentStep()) {
      setCreateStep(4)
      toast.error("Review the payment details.")
      return
    }

    const initialPaymentCents =
      createPaymentMode === "FULL"
        ? totalPriceCents
        : createPaymentMode === "LATER"
          ? 0
          : parseUsdToCents(createInitialPaymentUsd)

    setIsSaving(true)
    try {
      const { data } = await api.post<{ contactService: { id: string } }>(
        `/api/services/${encodeURIComponent(tenantId)}/contact-services`,
        {
        contactId,
        serviceId: createServiceId,
        ...(createTemplateId ? { followUpTemplateId: createTemplateId } : {}),
        ...(createFollowUpAssignedToUserId
          ? { followUpAssignedToUserId: createFollowUpAssignedToUserId }
          : {}),
        ...(createAssignedProfessionalId
          ? { assignedProfessionalId: createAssignedProfessionalId }
          : {}),
        ...(initialPaymentCents !== null ? { initialPaymentCents } : {}),
        ...(createNotes.trim() ? { notes: createNotes.trim() } : {}),
        },
      )
      toast.success("Service transaction created.")
      setIsCreateOpen(false)
      resetCreate()
      await loadServices()
      router.push(`/app/${tenantSlug}/contacts/${contactId}/services/${data.contactService.id}`)
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not create service transaction.",
        )
      } else {
        toast.error("Could not create service transaction.")
      }
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Contact Services</p>
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Services and enrollments</h1>
              <p className="text-sm text-slate-600">Enroll purchased services and manage their follow-up enrollment records.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 md:self-center">
            <Button type="button" onClick={() => setIsCreateOpen(true)} className="cursor-pointer bg-blue-950 text-white hover:bg-blue-950/90">
              <Plus className="h-4 w-4" />
              Purchase service
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="min-w-0 rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-slate-400">
            <BriefcaseBusiness className="h-4 w-4" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
              Enrolled Services
            </p>
          </div>
          <p className="mt-2 truncate text-xl font-semibold tracking-tight text-slate-950">
            {totals.enrolled}
          </p>
          <p className="mt-1 text-xs text-slate-500">Active and historical service enrollments for this contact.</p>
        </div>
        <div className="min-w-0 rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-slate-400">
            <CheckCircle2 className="h-4 w-4" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
              Completed Services
            </p>
          </div>
          <p className="mt-2 truncate text-xl font-semibold tracking-tight text-emerald-700">
            {totals.completed}
          </p>
          <p className="mt-1 text-xs text-slate-500">Enrollments already finished or fully closed out.</p>
        </div>
        <div className="min-w-0 rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-slate-400">
            <CircleDollarSign className="h-4 w-4" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
              Current Spending
            </p>
          </div>
          <p className="mt-2 truncate text-xl font-semibold tracking-tight text-slate-950">
            {currencyFormatter(totals.totalPaidCents, "USD")}
          </p>
          <p className="mt-1 text-xs text-slate-500">Amount already collected across purchased services.</p>
        </div>
        <div className="min-w-0 rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-slate-400">
            <Clock3 className="h-4 w-4" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
              Remaining Balance
            </p>
          </div>
          <p className="mt-2 truncate text-xl font-semibold tracking-tight text-amber-700">
            {currencyFormatter(totals.totalRemainingCents, "USD")}
          </p>
          <p className="mt-1 text-xs text-slate-500">Open balance that still needs to be collected.</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-[20px] border border-slate-200 bg-white p-4 xl:col-span-2">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-slate-900">Balance Overview</h3>
            <p className="text-xs text-slate-500">Total amount versus paid amount for each purchased service.</p>
          </div>
          <ChartContainer config={spendingChartConfig} className="h-[260px] w-full">
            <BarChart
              accessibilityLayer
              data={spendingBreakdownData}
              barCategoryGap={items.length <= 1 ? "80%" : "35%"}
              margin={{ top: 8, right: 12, left: 12, bottom: 0 }}
            >
              <XAxis
                dataKey="serviceName"
                tickLine={false}
                tickMargin={10}
                axisLine={false}
                tickFormatter={(value) => {
                  const label = String(value)
                  return label.length > 18 ? `${label.slice(0, 18)}...` : label
                }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={10}
                width={72}
                tickFormatter={(value) => formatCurrencyValue(Number(value), "USD")}
              />
              <Bar
                dataKey="total"
                fill="var(--color-total)"
                radius={[4, 4, 0, 0]}
                barSize={56}
                maxBarSize={56}
              />
              <Bar
                dataKey="paid"
                fill="var(--color-paid)"
                radius={[4, 4, 0, 0]}
                barSize={36}
                maxBarSize={36}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    className="w-[210px]"
                    labelFormatter={(value) => String(value)}
                    formatter={(value, name, item, index) => (
                      <>
                        <div
                          className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-(--color-bg)"
                          style={
                            {
                              "--color-bg": `var(--color-${name})`,
                            } as CSSProperties
                          }
                        />
                        {spendingChartConfig[name as keyof typeof spendingChartConfig]?.label || name}
                        <div className="ml-auto font-mono font-medium text-foreground tabular-nums">
                          {formatCurrencyValue(
                            Number(value),
                            String(item.payload.currency ?? "USD"),
                          )}
                        </div>
                        {index === 1 ? (
                          <div className="mt-1.5 flex basis-full items-center border-t pt-1.5 text-xs font-medium text-foreground">
                            Balance
                            <div className="ml-auto font-mono font-medium text-foreground tabular-nums">
                              {formatCurrencyValue(
                                Number(item.payload.total ?? 0) - Number(item.payload.paid ?? 0),
                                String(item.payload.currency ?? "USD"),
                              )}
                            </div>
                          </div>
                        ) : null}
                      </>
                    )}
                  />
                }
              />
            </BarChart>
          </ChartContainer>
        </div>
        <div className="rounded-[20px] border border-slate-200 bg-white p-4">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-slate-900">Service Status Mix</h3>
            <p className="text-xs text-slate-500">How enrolled services are distributed by status.</p>
          </div>
          <ChartContainer config={statusChartConfig} className="h-[220px] w-full">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent nameKey="label" />} />
              <Pie data={statusBreakdownData} dataKey="value" nameKey="label" innerRadius={45} outerRadius={76} paddingAngle={2}>
                {statusBreakdownData.map((entry) => (
                  <Cell key={entry.status} fill={entry.fill} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
          <div className="mt-2 flex flex-wrap gap-2">
            {statusBreakdownData.map((entry) => (
              <Badge key={entry.status} variant="outline" className="capitalize">
                {entry.label}: {entry.value}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white">
        <TooltipProvider>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created At</TableHead>
                <TableHead>Next Follow-up</TableHead>
                <TableHead>
                  <div className="flex items-center gap-1">
                    <span>Owner</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex h-4 w-4 items-center justify-center text-slate-400 transition hover:text-slate-600"
                          onClick={(event) => event.stopPropagation()}
                          aria-label="Owner column help"
                        >
                          <CircleHelp className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Assigned person to the follow up.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </TableHead>
                <TableHead>Paid</TableHead>
                <TableHead>Balance</TableHead>
                <TableHead>Progress</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-slate-500">Loading services...</TableCell>
              </TableRow>
            ) : hasItems ? (
              items.map((item) => (
                <TableRow
                  key={item.id}
                  className="cursor-pointer"
                  onClick={() =>
                    router.push(`/app/${tenantSlug}/contacts/${contactId}/services/${item.id}`)
                  }
                >
                  <TableCell className="font-medium text-slate-900">{item.service.name}</TableCell>
                  <TableCell>
                    <Badge className={`capitalize ${SERVICE_STATUS_STYLES[item.status]}`}>
                      {toSentence(item.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-600">{formatDate(item.purchasedAt)}</TableCell>
                  <TableCell className="text-slate-600">{formatDate(getNextFollowUpDate(item))}</TableCell>
                  <TableCell>
                    {(() => {
                      const assignee = getCurrentFollowUpAssignee(item)
                      const label = assignee?.name?.trim() || assignee?.email?.trim() || "Unassigned"

                      return (
                        <div className="flex items-center gap-2">
                          {assignee ? (
                            <Avatar className="h-7 w-7 shrink-0 border border-slate-200">
                              <AvatarImage src={assignee.image ?? undefined} alt={label} />
                              <AvatarFallback className="bg-blue-100 text-[10px] font-semibold text-blue-900">
                                {getInitials(label)}
                              </AvatarFallback>
                            </Avatar>
                          ) : (
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                              <UserRound className="h-3.5 w-3.5" />
                            </span>
                          )}
                          <span className="truncate text-sm text-slate-600">{label}</span>
                        </div>
                      )
                    })()}
                  </TableCell>
                  <TableCell>{currencyFormatter(item.paidCents, item.currency)}</TableCell>
                  <TableCell>{currencyFormatter(item.remainingCents, item.currency)}</TableCell>
                  <TableCell>
                    {(() => {
                      const progress = getServiceProgress(item)
                      return (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className="w-[190px] cursor-pointer"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <div className="flex items-center gap-3">
                                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                                  <div
                                    className="h-full rounded-full bg-emerald-500 transition-all"
                                    style={{ width: `${progress.percentage}%` }}
                                  />
                                </div>
                                <span className="w-10 text-right text-xs font-medium text-slate-600">
                                  {progress.percentage}%
                                </span>
                              </div>
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            className="w-56"
                            align="start"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <div className="space-y-1">
                              <p className="text-sm font-semibold text-slate-900">
                                {progress.percentage}% Completed
                              </p>
                              <p className="text-xs text-slate-600">
                                {progress.completed} completed, {progress.remaining} remaining out of{" "}
                                {progress.total} follow-ups.
                              </p>
                            </div>
                          </PopoverContent>
                        </Popover>
                      )
                    })()}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-slate-500">No services enrolled yet.</TableCell>
              </TableRow>
            )}
            </TableBody>
          </Table>
        </TooltipProvider>
      </div>

      <Dialog open={isCreateOpen} onOpenChange={(open) => {
        setIsCreateOpen(open)
        if (!open) resetCreate()
      }}>
        <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Create service transaction</DialogTitle>
            <DialogDescription>
              This transaction is already tied to the current contact.
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto py-1 pr-1">
            <div className="flex items-center gap-2">
              {[
                { value: 1, label: "Service" },
                { value: 2, label: "Follow up" },
                { value: 3, label: "Checklist" },
                { value: 4, label: "Payment" },
              ].map((item) => {
                const isActive = createStep === item.value
                const isComplete = createStep > item.value

                return (
                  <div key={item.value} className="flex items-center gap-2">
                    <div
                      className={
                        isActive
                          ? "flex h-8 min-w-8 items-center justify-center rounded-full bg-blue-950 px-3 text-xs font-semibold text-white"
                          : isComplete
                            ? "flex h-8 min-w-8 items-center justify-center rounded-full bg-blue-100 px-3 text-xs font-semibold text-blue-900"
                            : "flex h-8 min-w-8 items-center justify-center rounded-full bg-slate-100 px-3 text-xs font-semibold text-slate-500"
                      }
                    >
                      {item.value}
                    </div>
                    <span
                      className={
                        isActive
                          ? "text-sm font-medium text-slate-900"
                          : "text-sm text-slate-500"
                      }
                    >
                      {item.label}
                    </span>
                    {item.value < 4 ? <div className="mx-1 h-px w-6 bg-slate-200" /> : null}
                  </div>
                )
              })}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Current transaction
                </p>
                <p className="text-sm text-slate-600">
                  Contact: <span className="font-medium text-slate-900">Current contact</span>
                </p>
                {createServiceDetails ? (
                  <p className="text-sm text-slate-600">
                    Service:{" "}
                    <span className="font-medium text-slate-900">
                      {createServiceDetails.name}
                    </span>
                  </p>
                ) : null}
              </div>
            </div>

            {createStep === 1 ? (
              <section className="space-y-3">
                <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-3.5">
                  <p className="text-sm font-semibold text-blue-950">
                    Start by choosing the service
                  </p>
                  <p className="mt-1 text-sm leading-5 text-blue-900/80">
                    This decides the price, payment rules, checklist items, and the professionals available for this transaction.
                  </p>
                </div>

                <FlowStepCard
                  stepNumber="1"
                  title="Which service is this contact buying?"
                  description="Pick the service first. Then review its payment setup and optionally assign the professional delivering it."
                >
                  <div className="grid gap-2">
                    <Label htmlFor="contact-service-transaction-service">Service</Label>
                    <Select
                      value={createServiceId}
                      onValueChange={(value) => {
                        clearCreateError("serviceId")
                        setCreateServiceId(value)
                        setCreateTemplateId("")
                        setCreateAssignedProfessionalId("")
                      }}
                      disabled={isLoadingServiceOptions}
                    >
                      <SelectTrigger id="contact-service-transaction-service" className="cursor-pointer">
                        <SelectValue
                          placeholder={
                            isLoadingServiceOptions ? "Loading services..." : "Select a service"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {serviceOptions.map((service) => (
                          <SelectItem key={service.id} value={service.id} className="cursor-pointer">
                            {service.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {createErrors.serviceId ? (
                      <p className="text-xs text-rose-600">{createErrors.serviceId}</p>
                    ) : null}
                  </div>
                </FlowStepCard>

                <FlowStepCard
                  stepNumber="2"
                  title="Assign a professional?"
                  description="Optional. Use this when someone should own or deliver the service from the start."
                  disabled={!createServiceId}
                >
                  <div className="grid gap-2">
                    <Label htmlFor="contact-service-transaction-professional">Professional</Label>
                    <AssignedProfessionalPicker
                      professionals={createServiceDetails?.professionals ?? []}
                      value={createAssignedProfessionalId}
                      onValueChange={(value) => {
                        clearCreateError("assignedProfessionalId")
                        setCreateAssignedProfessionalId(value)
                      }}
                      disabled={!createServiceDetails}
                    />
                    {!createServiceId ? (
                      <p className="text-xs text-slate-500">
                        Choose a service first to load the professionals linked to it.
                      </p>
                    ) : createServiceDetails && createServiceDetails.professionals.length === 0 ? (
                      <p className="text-xs text-slate-500">
                        This service does not have professionals configured yet.
                      </p>
                    ) : (
                      <p className="text-xs text-slate-500">
                        You can leave this unassigned and decide later.
                      </p>
                    )}
                    {createErrors.assignedProfessionalId ? (
                      <p className="text-xs text-rose-600">
                        {createErrors.assignedProfessionalId}
                      </p>
                    ) : null}
                  </div>
                </FlowStepCard>

                {createServiceDetails ? (
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                      Service snapshot
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-900">
                      {createServiceDetails.name}
                    </p>
                    <p className="mt-2 text-sm text-slate-600">
                      {currencyFormatter(createServiceTotalCents ?? createServiceDetails.basePriceCents, createServiceDetails.currency)}
                    </p>
                    {createServiceTotalCents !== null &&
                    createServiceTotalCents !== createServiceDetails.basePriceCents ? (
                      <p className="mt-1 text-xs text-slate-500">
                        Includes {createServiceDetails.tenantBilling.taxLabel || "tax"} at{" "}
                        {(createServiceDetails.tenantBilling.defaultTaxRatePercent ?? 0)
                          .toFixed(2)
                          .replace(/\.00$/, "")}
                        %.
                      </p>
                    ) : null}
                    <p className="mt-1 text-sm text-slate-500">
                      {createServiceDetails.allowPartialPayments
                        ? createServiceDetails.installmentCount && createServiceDetails.installmentFrequency
                          ? `Minimum deposit ${currencyFormatter(createServiceDetails.minimumPartialPaymentCents ?? 0, createServiceDetails.currency)} · ${createServiceDetails.installmentCount} ${INSTALLMENT_FREQUENCY_LABELS[createServiceDetails.installmentFrequency].toLowerCase()} installments`
                          : "Partial payments allowed"
                        : "Full payment only"}
                    </p>
                  </div>
                ) : null}
              </section>
            ) : null}

            {createStep === 2 ? (
              <section className="space-y-3">
                <div className="rounded-2xl border border-violet-100 bg-violet-50/70 p-3.5">
                  <p className="text-sm font-semibold text-violet-950">
                    Set up the follow-up workflow
                  </p>
                  <p className="mt-1 text-sm leading-5 text-violet-900/80">
                    Choose which follow-up template should start and who should be in charge of the follow-up work.
                  </p>
                </div>

                <FlowStepCard
                  stepNumber="1"
                  title="Which follow-up plan should start?"
                  description="Use the default published template or choose a different published template for this transaction."
                  disabled={!createServiceId}
                >
                  <div className="grid gap-2">
                    <Label htmlFor="contact-service-transaction-template">Follow-Up Template</Label>
                    <Select
                      value={createTemplateId || "default"}
                      onValueChange={(value) => {
                        clearCreateError("templateId")
                        setCreateTemplateId(value === "default" ? "" : value)
                      }}
                      disabled={!createServiceDetails}
                    >
                      <SelectTrigger id="contact-service-transaction-template" className="cursor-pointer">
                        <SelectValue placeholder="Use default template selection" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default" className="cursor-pointer">
                          Use default published template
                        </SelectItem>
                        {(createServiceDetails?.followUpTemplates ?? []).map((template) => (
                          <SelectItem key={template.id} value={template.id} className="cursor-pointer">
                            {template.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!createServiceId ? (
                      <p className="text-xs text-slate-500">
                        Choose a service first to load its available follow-up templates.
                      </p>
                    ) : (createServiceDetails?.followUpTemplates.length ?? 0) === 0 ? (
                      <p className="text-xs text-slate-500">
                        No published templates are available for this service. The transaction can still proceed if the service has default follow-up steps.
                      </p>
                    ) : (
                      <p className="text-xs text-slate-500">
                        Leaving this on default uses the service&apos;s standard published template.
                      </p>
                    )}
                    {createErrors.templateId ? (
                      <p className="text-xs text-rose-600">{createErrors.templateId}</p>
                    ) : null}
                  </div>
                </FlowStepCard>

                <FlowStepCard
                  stepNumber="2"
                  title="Who should be in charge of the follow up?"
                  description="Optional. This user will be assigned to the follow-up steps created from the selected template."
                  disabled={!createServiceId}
                >
                  <div className="grid gap-2">
                    <Label htmlFor="contact-service-transaction-follow-up-owner">Follow-Up Owner</Label>
                    <FollowUpAssigneePicker
                      assignees={followUpAssigneeOptions}
                      value={createFollowUpAssignedToUserId}
                      onValueChange={(value) => {
                        clearCreateError("followUpAssignedToUserId")
                        setCreateFollowUpAssignedToUserId(value)
                      }}
                      disabled={!createServiceId || isLoadingAssignees}
                    />
                    {!createServiceId ? (
                      <p className="text-xs text-slate-500">
                        Choose a service first before assigning follow-up ownership.
                      </p>
                    ) : isLoadingAssignees ? (
                      <p className="text-xs text-slate-500">Loading tenant users...</p>
                    ) : (
                      <p className="text-xs text-slate-500">
                        You can leave this unassigned and route follow-up later.
                      </p>
                    )}
                    {createErrors.followUpAssignedToUserId ? (
                      <p className="text-xs text-rose-600">
                        {createErrors.followUpAssignedToUserId}
                      </p>
                    ) : null}
                  </div>
                </FlowStepCard>
              </section>
            ) : null}

            {createStep === 3 ? (
              <section className="grid gap-4">
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
                  <p className="text-sm font-semibold text-emerald-950">
                    Review what needs to be completed for this service
                  </p>
                  <p className="mt-1 text-sm leading-6 text-emerald-900/80">
                    These checklist items will be attached to the current contact when the transaction is created.
                  </p>
                </div>

                {createServiceDetails && createServiceDetails.checklistItems.length > 0 ? (
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-sm font-semibold text-slate-900">
                        Checklist for {createServiceDetails.name}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        Required items should be completed before the service is considered finished.
                      </p>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-14">#</TableHead>
                          <TableHead>Checklist Item</TableHead>
                          <TableHead className="w-36">Requirement</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {createServiceDetails.checklistItems.map((item, index) => (
                          <TableRow key={item.id}>
                            <TableCell className="align-middle text-sm text-slate-500">
                              {index + 1}
                            </TableCell>
                            <TableCell className="align-middle">
                              <div className="space-y-0.5">
                                <p className="text-sm font-medium text-slate-900">{item.label}</p>
                                {item.description ? (
                                  <p className="text-sm text-slate-500">{item.description}</p>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell className="align-middle">
                              <Badge
                                variant="secondary"
                                className={
                                  item.isRequired
                                    ? "border border-rose-200 bg-rose-50 text-rose-700"
                                    : "border border-slate-200 bg-slate-100 text-slate-600"
                                }
                              >
                                {item.isRequired ? "Required" : "Optional"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5">
                    <p className="text-sm font-medium text-slate-900">
                      No checklist items for this service
                    </p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">
                      This transaction will not create any checklist requirements.
                    </p>
                  </div>
                )}
              </section>
            ) : null}

            {createStep === 4 ? (
              <section className="grid gap-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="contact-service-transaction-payment-type">Payment Type</Label>
                    <Select
                      value={createPaymentMode}
                      onValueChange={(value) => {
                        clearCreateError("paymentMode")
                        clearCreateError("initialPaymentUsd")
                        setCreatePaymentMode(value as "FULL" | "PARTIAL" | "LATER")
                      }}
                    >
                      <SelectTrigger id="contact-service-transaction-payment-type" className="cursor-pointer">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="FULL" className="cursor-pointer">Pay in Full</SelectItem>
                        <SelectItem
                          value="PARTIAL"
                          disabled={!createServiceDetails?.allowPartialPayments}
                          className="cursor-pointer"
                        >
                          Partial Payment
                        </SelectItem>
                        <SelectItem value="LATER" className="cursor-pointer">Pay Later</SelectItem>
                      </SelectContent>
                    </Select>
                    {!createServiceDetails?.allowPartialPayments ? (
                      <p className="text-xs text-slate-500">
                        This service supports full payment or pay later only.
                      </p>
                    ) : null}
                    {createErrors.paymentMode ? (
                      <p className="text-xs text-rose-600">{createErrors.paymentMode}</p>
                    ) : null}
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="contact-service-transaction-cost">Service Cost</Label>
                    <Input
                      id="contact-service-transaction-cost"
                      value={
                        createServiceTotalCents !== null
                          ? centsToUsdInput(createServiceTotalCents)
                          : ""
                      }
                      readOnly
                      className="bg-slate-50 text-slate-600"
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  {createServiceDetails?.allowPartialPayments ? (
                    <span>
                      Payment plan:{" "}
                      <span className="font-medium text-slate-900">
                        {createServiceDetails.minimumPartialPaymentCents !== null
                          ? `Minimum deposit ${currencyFormatter(createServiceDetails.minimumPartialPaymentCents, createServiceDetails.currency)}`
                          : "Partial payments allowed"}
                        {createServiceDetails.installmentCount && createServiceDetails.installmentFrequency
                          ? ` · ${createServiceDetails.installmentCount} ${INSTALLMENT_FREQUENCY_LABELS[createServiceDetails.installmentFrequency].toLowerCase()} installments`
                          : ""}
                      </span>
                    </span>
                  ) : (
                    <span>
                      Payment plan: <span className="font-medium text-slate-900">Full payment only</span>
                    </span>
                  )}
                </div>

                {createAssignedProfessionalId && createServiceDetails ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    Assigned professional:{" "}
                    <span className="font-medium text-slate-900">
                      {getProfessionalLabel(
                        createServiceDetails.professionals.find(
                          (item) => item.id === createAssignedProfessionalId,
                        )!,
                      )}
                    </span>
                  </div>
                ) : null}

                {createFollowUpAssignedToUserId ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    Follow-up owner:{" "}
                    <span className="font-medium text-slate-900">
                      {followUpAssigneeOptions.find(
                        (item) => item.value === createFollowUpAssignedToUserId,
                      )?.label ?? "Assigned user"}
                    </span>
                  </div>
                ) : null}

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="contact-service-transaction-payment-now">
                      {createPaymentMode === "PARTIAL" ? "Partial Payment Amount" : "Payment Now"}
                    </Label>
                    <Input
                      id="contact-service-transaction-payment-now"
                      value={
                        createPaymentMode === "PARTIAL"
                          ? createInitialPaymentUsd
                          : createPaymentMode === "LATER"
                            ? "0.00"
                            : createServiceTotalCents !== null
                              ? centsToUsdInput(createServiceTotalCents)
                              : ""
                      }
                      onChange={(event) => {
                        clearCreateError("initialPaymentUsd")
                        setCreateInitialPaymentUsd(event.target.value)
                      }}
                      readOnly={createPaymentMode !== "PARTIAL"}
                      inputMode="decimal"
                      placeholder="0.00"
                      className={createPaymentMode === "PARTIAL" ? undefined : "bg-slate-50 text-slate-600"}
                    />
                    {createPaymentMode === "PARTIAL" &&
                    createServiceDetails?.minimumPartialPaymentCents ? (
                      <p className="text-xs text-slate-500">
                        Minimum partial payment:{" "}
                        {currencyFormatter(
                          createServiceDetails.minimumPartialPaymentCents,
                          createServiceDetails.currency,
                        )}
                      </p>
                    ) : null}
                    {createErrors.initialPaymentUsd ? (
                      <p className="text-xs text-rose-600">{createErrors.initialPaymentUsd}</p>
                    ) : null}
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="contact-service-transaction-notes">Notes</Label>
                    <Textarea
                      id="contact-service-transaction-notes"
                      value={createNotes}
                      onChange={(event) => {
                        clearCreateError("notes")
                        setCreateNotes(event.target.value)
                      }}
                      rows={3}
                      placeholder="Add context for this service purchase"
                    />
                    {createErrors.notes ? (
                      <p className="text-xs text-rose-600">{createErrors.notes}</p>
                    ) : null}
                  </div>
                </div>
              </section>
            ) : null}
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-slate-200 pt-4 sm:justify-between">
            <div className="text-sm text-slate-500">
              {createStep === 1 ? "Choose the service first." : "Review the details before continuing."}
            </div>
            <div className="flex items-center gap-2">
              {createStep > 1 ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onPreviousCreateStep}
                  className="cursor-pointer border-slate-200 text-slate-700 hover:bg-slate-50"
                >
                  Back
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateOpen(false)}
                disabled={isSaving}
                className="cursor-pointer border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </Button>
              {createStep < 4 ? (
                <Button
                  type="button"
                  onClick={onNextCreateStep}
                  className="cursor-pointer bg-blue-950 text-white hover:bg-blue-950/90"
                >
                  Next
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={() => void onCreate()}
                  disabled={isSaving}
                  className="cursor-pointer bg-blue-950 text-white hover:bg-blue-950/90"
                >
                  {isSaving ? "Creating..." : "Create transaction"}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-2">
          <Settings2 className="h-3.5 w-3.5" />
          Click any enrolled service row to review the service details and mark checklist items as received.
        </span>
      </div>
    </section>
  )
}
