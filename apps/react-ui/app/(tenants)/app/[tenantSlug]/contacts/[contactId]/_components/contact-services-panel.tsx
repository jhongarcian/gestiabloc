"use client"

import Link from "next/link"
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import { isAxiosError } from "axios"
import { z } from "zod"
import {
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  CircleHelp,
  Clock3,
  Loader2,
  Plus,
  Sparkles,
  Settings2,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Command,
  CommandEmpty,
  CommandGroup,
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
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
import {
  FIT_STATUS_STYLES,
  type ServiceFitScanItem,
  type ServiceFitScanResponse,
  toSentence,
} from "../_lib/service-fit"

type ContactServiceItem = {
  id: string
  status: "IN_PROGRESS" | "PENDING_PAYMENT" | "COMPLETED" | "CANCELED"
  purchasedAt?: string | null
  totalPriceCents: number
  paidCents: number
  remainingCents: number
  currency: string
  service: {
    id: string
    name: string
    checklistItems?: Array<{
      id: string
    }>
  }
  followUpSteps: Array<{
    id: string
    status?: "PENDING" | "ACTIVE" | "COMPLETED" | "SKIPPED" | "POSTPONED"
    availableAt?: string | null
    dueAt?: string | null
    completedAt?: string | null
    assignedTo?: {
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
  summary: {
    enrolled: number
    completed: number
    totalPaidCents: number
    totalRemainingCents: number
  }
}

const PAGE_SIZE_OPTIONS = [10, 25] as const

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
  initialCreateServiceId?: string | null
  initialCreateOpen?: boolean
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
  IN_PROGRESS: "border-sky-100 bg-sky-50 text-sky-700 hover:bg-sky-50",
  PENDING_PAYMENT: "border-orange-100 bg-orange-50 text-orange-700 hover:bg-orange-50",
  COMPLETED: "border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-50",
  CANCELED: "border-rose-100 bg-rose-50 text-rose-700 hover:bg-rose-50",
}

function EmptyServiceRows({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => (
    <TableRow
      key={`empty-service-row-${index}`}
      aria-hidden="true"
      className="h-14 hover:bg-transparent"
    >
      <TableCell colSpan={8} className="px-4 py-0" />
    </TableRow>
  ))
}

function LoadingServiceRows({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => (
    <TableRow
      key={`loading-service-row-${index}`}
      className="h-14 hover:bg-transparent"
    >
      <TableCell className="px-4 py-0">
        <Skeleton className="h-4 w-4/5" />
      </TableCell>
      <TableCell className="px-4 py-0">
        <Skeleton className="h-5 w-24 rounded-full" />
      </TableCell>
      <TableCell className="px-4 py-0">
        <Skeleton className="h-4 w-20" />
      </TableCell>
      <TableCell className="px-4 py-0">
        <Skeleton className="h-4 w-20" />
      </TableCell>
      <TableCell className="px-4 py-0">
        <div className="flex items-center gap-2.5">
          <Skeleton className="size-7 rounded-full" />
          <Skeleton className="h-4 w-24" />
        </div>
      </TableCell>
      <TableCell className="px-4 py-0">
        <Skeleton className="h-4 w-20" />
      </TableCell>
      <TableCell className="px-4 py-0">
        <Skeleton className="h-4 w-20" />
      </TableCell>
      <TableCell className="px-4 py-0">
        <Skeleton className="h-2.5 w-28 rounded-full" />
      </TableCell>
    </TableRow>
  ))
}

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
        "flex flex-col gap-4 border-t border-slate-200 pt-5",
        disabled ? "opacity-60" : undefined,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-950 text-xs font-semibold text-white">
          {stepNumber}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          <p className="text-xs leading-5 text-slate-500">{description}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

function ServicePicker({
  services,
  value,
  onValueChange,
  disabled,
  isLoading,
  ariaInvalid,
}: {
  services: Array<{ id: string; name: string }>
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
  isLoading?: boolean
  ariaInvalid?: boolean
}) {
  const [open, setOpen] = useState(false)
  const selectedService = useMemo(
    () => services.find((service) => service.id === value) ?? null,
    [services, value],
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id="contact-service-transaction-service"
          type="button"
          variant="outline"
          disabled={disabled}
          aria-invalid={ariaInvalid}
          aria-expanded={open}
          className="h-11 w-full justify-between rounded-xl border-blue-100 bg-white px-3 shadow-none hover:bg-white focus-visible:border-blue-400 focus-visible:ring-blue-100"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <Avatar size="sm" className="ring-2 ring-blue-50">
              <AvatarFallback className="bg-blue-50 font-semibold text-blue-950">
                {selectedService ? getInitials(selectedService.name) : "—"}
              </AvatarFallback>
            </Avatar>
            <span className="truncate font-medium text-slate-800">
              {selectedService?.name ?? (isLoading ? "Loading services..." : "Select a service")}
            </span>
          </span>
          {isLoading ? (
            <Loader2 data-icon="inline-end" className="ml-auto animate-spin text-slate-400" />
          ) : (
            <ChevronDown data-icon="inline-end" className="ml-auto text-slate-400" />
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command>
          <CommandInput placeholder="Search services..." />
          <CommandList>
            <CommandEmpty>No services found.</CommandEmpty>
            <CommandGroup heading="Services">
              {services.map((service) => (
                <CommandItem
                  key={service.id}
                  value={`${service.name} ${service.id}`}
                  onSelect={() => {
                    onValueChange(service.id)
                    setOpen(false)
                  }}
                  className="cursor-pointer gap-3 py-2.5"
                >
                  <Avatar size="sm" className="ring-2 ring-blue-50">
                    <AvatarFallback className="bg-blue-50 font-semibold text-blue-950">
                      {getInitials(service.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-900">
                    {service.name}
                  </span>
                  <Check
                    className={cn(
                      "text-blue-800",
                      selectedService?.id === service.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function AssignedProfessionalPicker({
  professionals,
  value,
  onValueChange,
  disabled,
  id,
  ariaInvalid,
}: {
  professionals: ServiceProfessional[]
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
  id?: string
  ariaInvalid?: boolean
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
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-invalid={ariaInvalid}
          aria-expanded={open}
          className="h-11 w-full justify-between rounded-xl border-blue-100 bg-white px-3 shadow-none hover:bg-white focus-visible:border-blue-400 focus-visible:ring-blue-100"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <Avatar size="sm" className="ring-2 ring-blue-50">
              {selectedProfessional?.user?.image ? (
                <AvatarImage
                  src={selectedProfessional.user.image}
                  alt={`${selectedLabel} profile photo`}
                  className="object-cover"
                />
              ) : null}
              <AvatarFallback
                className={cn(
                  "font-semibold",
                  selectedProfessional
                    ? PROFESSIONAL_TONE_STYLES[getProfessionalTone(selectedProfessional)]
                        .fallbackClassName
                    : "bg-slate-100 text-slate-500",
                )}
              >
                {selectedProfessional ? getInitials(selectedLabel) : "—"}
              </AvatarFallback>
            </Avatar>
            <span className="truncate font-medium text-slate-800">
              {selectedProfessional ? selectedLabel : "No assigned professional"}
            </span>
          </span>
          <ChevronDown data-icon="inline-end" className="ml-auto text-slate-400" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command>
          <CommandInput placeholder="Search professionals..." />
          <CommandList>
            <CommandEmpty>No professionals found.</CommandEmpty>
            <CommandGroup heading="Assignment">
              <CommandItem
                value="No assigned professional unassigned"
                onSelect={() => {
                  onValueChange("")
                  setOpen(false)
                }}
                className="cursor-pointer gap-3 py-2.5"
              >
                <Avatar size="sm">
                  <AvatarFallback className="bg-slate-100 font-semibold text-slate-500">
                    —
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 font-medium text-slate-700">
                  No assigned professional
                </span>
                <Check
                  className={cn(
                    "text-blue-800",
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
                  value={`${label} ${meta} ${professional.id}`}
                  onSelect={() => {
                    onValueChange(professional.id)
                    setOpen(false)
                  }}
                  className="cursor-pointer gap-3 py-2.5"
                >
                  <Avatar
                    className={cn(
                      "size-8 border shadow-sm",
                      toneStyles.surfaceClassName,
                    )}
                  >
                    {professional.user?.image ? (
                      <AvatarImage
                        src={professional.user.image}
                        alt={`${label} profile photo`}
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
                    <p className="truncate text-sm font-medium text-slate-900">
                      {label}
                    </p>
                    <p className="truncate text-xs text-slate-500">{meta}</p>
                  </div>
                  <Check
                    className={cn(
                      "text-blue-800",
                      selectedProfessional?.id === professional.id
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                </CommandItem>
              )
              })}
            </CommandGroup>
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
  id,
  ariaInvalid,
}: {
  assignees: TenantAssigneeOption[]
  value: string
  disabled?: boolean
  onValueChange: (value: string) => void
  id?: string
  ariaInvalid?: boolean
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
          id={id}
          type="button"
          variant="outline"
          aria-invalid={ariaInvalid}
          aria-expanded={open}
          className="h-11 w-full justify-between rounded-xl border-blue-100 bg-white px-3 shadow-none hover:bg-white focus-visible:border-blue-400 focus-visible:ring-blue-100"
          disabled={disabled}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            {selectedAssignee ? (
              <>
                <Avatar size="sm" className="ring-2 ring-blue-50">
                  {selectedAssignee.image ? (
                    <AvatarImage
                      src={selectedAssignee.image}
                      alt={`${selectedAssignee.label} profile photo`}
                      className="object-cover"
                    />
                  ) : null}
                  <AvatarFallback className="bg-blue-950 font-semibold text-white">
                    {getInitials(selectedAssignee.label)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate font-medium text-slate-800">
                  {selectedAssignee.label}
                </span>
              </>
            ) : (
              <>
                <Avatar size="sm">
                  <AvatarFallback className="bg-slate-100 font-semibold text-slate-500">
                    —
                  </AvatarFallback>
                </Avatar>
                <span className="truncate font-medium text-slate-700">No follow-up owner</span>
              </>
            )}
          </div>
          <ChevronDown data-icon="inline-end" className="ml-auto text-slate-400" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command>
          <CommandInput placeholder="Search team members..." />
          <CommandList>
            <CommandEmpty>No users found.</CommandEmpty>
            <CommandGroup heading="Assignment">
              <CommandItem
                value="No follow-up owner unassigned"
                onSelect={() => {
                  onValueChange("")
                  setOpen(false)
                }}
                className="cursor-pointer gap-3 py-2.5"
              >
                <Avatar size="sm">
                  <AvatarFallback className="bg-slate-100 font-semibold text-slate-500">
                    —
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 font-medium text-slate-700">
                  No follow-up owner
                </span>
                <Check
                  className={cn(
                    "text-blue-800",
                    selectedAssignee ? "opacity-0" : "opacity-100",
                  )}
                />
              </CommandItem>

              {assignees.map((assignee) => (
                <CommandItem
                  key={assignee.value}
                  value={`${assignee.label} ${assignee.email} ${assignee.value}`}
                  onSelect={() => {
                    onValueChange(assignee.value)
                    setOpen(false)
                  }}
                  className="cursor-pointer gap-3 py-2.5"
                >
                  <Avatar size="sm" className="ring-2 ring-blue-50">
                    {assignee.image ? (
                      <AvatarImage
                        src={assignee.image}
                        alt={`${assignee.label} profile photo`}
                        className="object-cover"
                      />
                    ) : null}
                    <AvatarFallback className="bg-blue-950 font-semibold text-white">
                      {getInitials(assignee.label)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium text-slate-900">
                      {assignee.label}
                    </span>
                    <span className="truncate text-xs text-slate-500">
                      {assignee.email}
                    </span>
                  </span>
                  <Check
                    className={cn(
                      "text-blue-800",
                      selectedAssignee?.value === assignee.value
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
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
  initialCreateServiceId,
  initialCreateOpen,
}: ContactServicesPanelProps) {
  const router = useRouter()
  const [items, setItems] = useState<ContactServiceItem[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(10)
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1,
  })
  const [isLoading, setIsLoading] = useState(false)
  const [summary, setSummary] = useState<ContactServicesResponse["summary"] | null>(null)
  const [fitRecommendations, setFitRecommendations] = useState<ServiceFitScanItem[]>([])
  const [isLoadingFitRecommendations, setIsLoadingFitRecommendations] = useState(false)
  const [hasRunFitScan, setHasRunFitScan] = useState(false)
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

  const resetCreate = useCallback(() => {
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
  }, [])

  const openCreateDialog = useCallback((serviceId?: string) => {
    resetCreate()
    setIsCreateOpen(true)
    if (serviceId) {
      setCreateServiceId(serviceId)
    }
  }, [resetCreate])

  const closeCreateDialog = useCallback(() => {
    setIsCreateOpen(false)
    resetCreate()
    if (initialCreateOpen) {
      router.replace(`/app/${tenantSlug}/contacts/${contactId}/services`)
    }
  }, [contactId, initialCreateOpen, resetCreate, router, tenantSlug])

  const loadServices = useCallback(async () => {
    setIsLoading(true)
    try {
      const { data } = await api.get<ContactServicesResponse>(`/api/services/${tenantId}/contact-services`, {
        params: {
          page,
          pageSize,
          contactId,
        },
      })
      setItems(data.items)
      setPagination(data.pagination)
      setSummary(data.summary)
    } catch {
      setItems([])
      setSummary(null)
      setPagination({
        page,
        pageSize,
        total: 0,
        totalPages: 1,
      })
      toast.error("Could not load enrolled services.")
    } finally {
      setIsLoading(false)
    }
  }, [tenantId, contactId, page, pageSize])

  const loadFitRecommendations = useCallback(async () => {
    setIsLoadingFitRecommendations(true)
    try {
      const { data } = await api.get<ServiceFitScanResponse>(
        `/api/services/${encodeURIComponent(tenantId)}/fit-scan`,
        {
          params: {
            contactId,
          },
        },
      )
      setFitRecommendations(data.items ?? [])
      setHasRunFitScan(true)
    } catch {
      setFitRecommendations([])
      setHasRunFitScan(true)
      toast.error("Could not load service recommendations.")
    } finally {
      setIsLoadingFitRecommendations(false)
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
    if (!hasRunFitScan && !isLoadingFitRecommendations) {
      void loadFitRecommendations()
    }
  }, [
    followUpAssigneeOptions.length,
    hasRunFitScan,
    isCreateOpen,
    isLoadingFitRecommendations,
    loadFitRecommendations,
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

  useEffect(() => {
    if (!initialCreateOpen) return

    openCreateDialog(initialCreateServiceId ?? undefined)
  }, [
    initialCreateOpen,
    initialCreateServiceId,
    openCreateDialog,
  ])

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

  const totals = summary ?? {
    enrolled: 0,
    completed: 0,
    totalPaidCents: 0,
    totalRemainingCents: 0,
  }

  const showingLabel = useMemo(() => {
    if (!pagination.total) return "Showing 0 services"
    const start = (pagination.page - 1) * pagination.pageSize + 1
    const end = Math.min(pagination.total, start + items.length - 1)
    return `Showing ${start}-${end} of ${pagination.total} services`
  }, [items.length, pagination.page, pagination.pageSize, pagination.total])

  const canGoPrevious = page > 1
  const canGoNext = page < pagination.totalPages
  const placeholderRowCount =
    items.length === 0 ? pageSize - 1 : Math.max(0, pageSize - items.length)
  const visiblePages = useMemo(() => {
    const count = Math.min(5, pagination.totalPages)
    const first = Math.max(
      1,
      Math.min(page - 2, pagination.totalPages - count + 1),
    )
    return Array.from({ length: count }, (_, index) => first + index)
  }, [page, pagination.totalPages])

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
      if (hasRunFitScan) {
        await loadFitRecommendations()
      }
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

  const shortlistedFitRecommendations = fitRecommendations.filter(
    (item) => item.eligibilityStatus === "ELIGIBLE" || item.eligibilityStatus === "NEEDS_INFO",
  )
  return (
    <section className="flex flex-col gap-5">
      <div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <p className="text-xs font-semibold text-blue-700">Contact services</p>
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold text-slate-950">
                Services and enrollments
              </h1>
              <p className="text-sm text-slate-600">
                Enroll purchased services and manage their follow-up records.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center md:self-center">
            <Button asChild variant="outline" className="bg-white/80 hover:bg-white">
              <Link href={`/app/${tenantSlug}/contacts/${contactId}/ai-qualification`}>
                <Sparkles data-icon="inline-start" />
                Open AI Qualification
              </Link>
            </Button>
            <Button
              type="button"
              onClick={() => openCreateDialog()}
              className="bg-blue-950 text-white hover:bg-blue-900"
            >
              <Plus data-icon="inline-start" />
              Purchase service
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="min-w-0 gap-0 rounded-[22px] border-white/80 bg-white/70 py-0 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:border-slate-200 hover:bg-white hover:shadow-md">
            <CardHeader className="gap-0 px-4 pt-4 pb-0">
              <CardTitle className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                <BriefcaseBusiness className="size-4 text-slate-400" />
                Enrolled services
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pt-2 pb-4">
              {isLoading ? (
                <Skeleton className="h-7 w-16" />
              ) : (
                <p className="truncate text-xl font-semibold tracking-tight text-slate-950">
                  {totals.enrolled}
                </p>
              )}
              <CardDescription className="mt-1 text-xs">
                Active and historical enrollments for this contact.
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="min-w-0 gap-0 rounded-[22px] border-white/80 bg-white/70 py-0 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:border-slate-200 hover:bg-white hover:shadow-md">
            <CardHeader className="gap-0 px-4 pt-4 pb-0">
              <CardTitle className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                <CheckCircle2 className="size-4 text-slate-400" />
                Completed services
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pt-2 pb-4">
              {isLoading ? (
                <Skeleton className="h-7 w-16" />
              ) : (
                <p className="truncate text-xl font-semibold tracking-tight text-emerald-700">
                  {totals.completed}
                </p>
              )}
              <CardDescription className="mt-1 text-xs">
                Enrollments that are fully completed.
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="min-w-0 gap-0 rounded-[22px] border-white/80 bg-white/70 py-0 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:border-slate-200 hover:bg-white hover:shadow-md">
            <CardHeader className="gap-0 px-4 pt-4 pb-0">
              <CardTitle className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                <CircleDollarSign className="size-4 text-slate-400" />
                Current spending
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pt-2 pb-4">
              {isLoading ? (
                <Skeleton className="h-7 w-28" />
              ) : (
                <p className="truncate text-xl font-semibold tracking-tight text-slate-950">
                  {currencyFormatter(totals.totalPaidCents, "USD")}
                </p>
              )}
              <CardDescription className="mt-1 text-xs">
                Total collected across purchased services.
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="min-w-0 gap-0 rounded-[22px] border-white/80 bg-white/70 py-0 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:border-slate-200 hover:bg-white hover:shadow-md">
            <CardHeader className="gap-0 px-4 pt-4 pb-0">
              <CardTitle className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                <Clock3 className="size-4 text-slate-400" />
                Remaining balance
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pt-2 pb-4">
              {isLoading ? (
                <Skeleton className="h-7 w-28" />
              ) : (
                <p className="truncate text-xl font-semibold tracking-tight text-amber-700">
                  {currencyFormatter(totals.totalRemainingCents, "USD")}
                </p>
              )}
              <CardDescription className="mt-1 text-xs">
                Open balance that still needs to be collected.
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="flex min-h-[660px] w-full flex-col gap-4 rounded-xl bg-white p-3 md:p-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-semibold text-foreground">Enrolled services</h2>
          <p className="text-sm text-muted-foreground">{showingLabel}</p>
        </div>

        <TooltipProvider>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-auto">
              <Table
                className="min-w-[1120px] table-fixed border-separate border-spacing-0"
                aria-label="Enrolled services"
                aria-busy={isLoading}
              >
                <TableHeader className="drop-shadow-sm [&_tr]:border-0">
                  <TableRow className="h-14 border-0 hover:bg-transparent">
                    <TableHead className="w-[20%] rounded-l-xl border-y border-l bg-background px-4">
                      Service
                    </TableHead>
                    <TableHead className="w-[12%] border-y bg-background px-4">
                      Status
                    </TableHead>
                    <TableHead className="w-[11%] border-y bg-background px-4">
                      Purchased
                    </TableHead>
                    <TableHead className="w-[13%] border-y bg-background px-4">
                      Next follow-up
                    </TableHead>
                    <TableHead className="w-[15%] border-y bg-background px-4">
                    <div className="flex items-center gap-1">
                      <span>Owner</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex size-4 cursor-pointer items-center justify-center text-slate-400 transition hover:text-slate-600"
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
                    <TableHead className="w-[9%] border-y bg-background px-4">Paid</TableHead>
                    <TableHead className="w-[9%] border-y bg-background px-4">Balance</TableHead>
                    <TableHead className="w-[11%] rounded-r-xl border-y border-r bg-background px-4">
                      Progress
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow aria-hidden="true" className="h-2 border-0 hover:bg-transparent">
                    <TableCell colSpan={8} className="p-0" />
                  </TableRow>

                  {isLoading ? (
                    <LoadingServiceRows count={pageSize} />
                  ) : (
                    <>
                      {items.map((item) => {
                        const assignee = getCurrentFollowUpAssignee(item)
                        const assigneeLabel =
                          assignee?.name?.trim() || assignee?.email?.trim() || "Unassigned"
                        const progress = getServiceProgress(item)

                        return (
                          <TableRow
                            key={item.id}
                            className="relative h-14 cursor-pointer hover:bg-blue-50/50 focus-within:bg-blue-50/50"
                          >
                            <TableCell className="px-4 py-0">
                              <Link
                                href={`/app/${tenantSlug}/contacts/${contactId}/services/${item.id}`}
                                className="block truncate font-medium text-foreground transition-colors before:absolute before:inset-0 before:z-10 before:rounded-md hover:text-blue-800 focus-visible:outline-none focus-visible:before:ring-2 focus-visible:before:ring-ring focus-visible:before:ring-offset-1"
                                title={item.service.name}
                                aria-label={`Open ${item.service.name}`}
                              >
                                {item.service.name}
                              </Link>
                            </TableCell>
                            <TableCell className="px-4 py-0">
                              <Badge
                                variant="outline"
                                className={cn("capitalize", SERVICE_STATUS_STYLES[item.status])}
                              >
                                {toSentence(item.status)}
                              </Badge>
                            </TableCell>
                            <TableCell className="px-4 py-0 text-foreground">
                              {formatDate(item.purchasedAt)}
                            </TableCell>
                            <TableCell className="px-4 py-0 text-foreground">
                              {formatDate(getNextFollowUpDate(item))}
                            </TableCell>
                            <TableCell className="px-4 py-0">
                              <div className="flex min-w-0 items-center gap-2.5">
                                <Avatar size="sm">
                                  {assignee?.image ? (
                                    <AvatarImage
                                      src={assignee.image}
                                      alt={`${assigneeLabel} profile photo`}
                                    />
                                  ) : null}
                                  <AvatarFallback>
                                    {assignee ? getInitials(assigneeLabel) : "—"}
                                  </AvatarFallback>
                                </Avatar>
                                <span
                                  className="truncate text-foreground"
                                  title={assigneeLabel}
                                >
                                  {assigneeLabel}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="px-4 py-0 text-foreground">
                              {currencyFormatter(item.paidCents, item.currency)}
                            </TableCell>
                            <TableCell className="px-4 py-0 text-foreground">
                              {currencyFormatter(item.remainingCents, item.currency)}
                            </TableCell>
                            <TableCell className="relative z-20 px-4 py-0">
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button
                                    type="button"
                                    className="flex w-full cursor-pointer items-center gap-2"
                                    onClick={(event) => event.stopPropagation()}
                                    aria-label={`${progress.percentage}% of follow-ups completed`}
                                  >
                                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
                                      <span
                                        className="block h-full rounded-full bg-emerald-500 transition-all"
                                        style={{ width: `${progress.percentage}%` }}
                                      />
                                    </span>
                                    <span className="w-9 text-right text-xs font-medium tabular-nums text-slate-600">
                                      {progress.percentage}%
                                    </span>
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent
                                  className="w-56"
                                  align="start"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <div className="flex flex-col gap-1">
                                    <p className="text-sm font-semibold text-slate-900">
                                      {progress.percentage}% completed
                                    </p>
                                    <p className="text-xs text-slate-600">
                                      {progress.completed} completed and {progress.remaining} remaining
                                      out of {progress.total} follow-ups.
                                    </p>
                                  </div>
                                </PopoverContent>
                              </Popover>
                            </TableCell>
                          </TableRow>
                        )
                      })}

                      {!hasItems ? (
                        <TableRow className="h-14 hover:bg-transparent">
                          <TableCell colSpan={8} className="px-4 py-0 text-center">
                            <span className="text-sm text-muted-foreground">
                              No services enrolled yet.
                            </span>
                          </TableCell>
                        </TableRow>
                      ) : null}

                      <EmptyServiceRows count={placeholderRowCount} />
                    </>
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-col items-center gap-3 px-1 py-4 sm:flex-row sm:justify-between">
              <div className="flex items-center gap-3">
                <p className="text-sm text-muted-foreground">{showingLabel}</p>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Rows</span>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(value) => {
                      const nextPageSize = Number(value)
                      if (nextPageSize === 10 || nextPageSize === 25) {
                        setPageSize(nextPageSize)
                        setPage(1)
                      }
                    }}
                  >
                    <SelectTrigger size="sm" className="w-20" aria-label="Rows per page">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {PAGE_SIZE_OPTIONS.map((option) => (
                          <SelectItem key={option} value={String(option)}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <nav
                className="flex items-center gap-2 self-end sm:self-auto"
                aria-label="Enrolled services pagination"
              >
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Previous page"
                  disabled={!canGoPrevious || isLoading}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <ChevronLeft />
                </Button>

                {visiblePages.map((pageNumber) => (
                  <Button
                    key={pageNumber}
                    type="button"
                    variant={pageNumber === page ? "default" : "outline"}
                    size="icon-sm"
                    aria-label={
                      pageNumber === page
                        ? `Current page, page ${pageNumber}`
                        : `Go to page ${pageNumber}`
                    }
                    aria-current={pageNumber === page ? "page" : undefined}
                    disabled={isLoading}
                    onClick={() => setPage(pageNumber)}
                  >
                    {pageNumber}
                  </Button>
                ))}

                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Next page"
                  disabled={!canGoNext || isLoading}
                  onClick={() => setPage((current) => current + 1)}
                >
                  <ChevronRight />
                </Button>
              </nav>
            </div>
          </div>
        </TooltipProvider>
      </div>

      <Dialog
        open={isCreateOpen}
        onOpenChange={(open) => {
          if (!open && isSaving) return
          if (open) {
            setIsCreateOpen(true)
          } else {
            closeCreateDialog()
          }
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[28px] border-slate-200 bg-white p-0 shadow-2xl sm:max-w-3xl [&>button]:cursor-pointer">
          <DialogHeader className="relative overflow-hidden border-b border-blue-100 bg-[#f1f7ff] px-6 py-6 text-left sm:px-7">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(30,64,175,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(30,64,175,.08)_1px,transparent_1px)] [background-size:42px_42px]"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-12 -bottom-20 size-48 rounded-full bg-blue-300/30 blur-3xl"
            />
            <div className="relative pr-10">
              <div className="flex max-w-2xl min-w-0 flex-col gap-1.5">
                <p className="text-xs font-semibold text-blue-700">Service purchase</p>
                <DialogTitle className="text-xl font-semibold text-slate-950 sm:text-2xl">
                  Purchase a service
                </DialogTitle>
                <DialogDescription className="max-w-xl text-sm leading-6 text-slate-600">
                  Choose the service, assign delivery and follow-up ownership, then confirm payment.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-6 py-6 [scrollbar-gutter:stable] sm:px-7">
            <div className="grid grid-cols-4 gap-2" aria-label={`Step ${createStep} of 4`}>
              {[
                { value: 1, label: "Service" },
                { value: 2, label: "Follow up" },
                { value: 3, label: "Checklist" },
                { value: 4, label: "Payment" },
              ].map((item) => {
                const isActive = createStep === item.value
                const isComplete = createStep > item.value

                return (
                  <div key={item.value} className="flex min-w-0 flex-col gap-1.5">
                    <div
                      className={cn(
                        "h-1.5 rounded-full",
                        isActive
                          ? "bg-blue-950"
                          : isComplete
                            ? "bg-blue-300"
                            : "bg-slate-200",
                      )}
                      aria-hidden="true"
                    />
                    <span
                      className={cn(
                        "truncate text-xs font-medium",
                        isActive ? "text-slate-950" : "text-slate-500",
                      )}
                    >
                      {item.value}. {item.label}
                    </span>
                  </div>
                )
              })}
            </div>

            <div className="mt-5 flex items-center justify-between gap-4 border-b border-slate-200 pb-4">
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="text-xs font-medium text-slate-500">Selected service</p>
                <p className="truncate text-sm font-semibold text-slate-950">
                  {createServiceDetails?.name ?? "Choose a service to continue"}
                </p>
              </div>
              <span className="shrink-0 text-xs font-medium tabular-nums text-slate-500">
                Step {createStep} of 4
              </span>
            </div>

            {createStep === 1 ? (
              <section className="mt-6 flex flex-col gap-5">
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-semibold text-blue-700">Service and delivery</p>
                  <h3 className="text-base font-semibold text-slate-950">
                    Choose what this contact is purchasing
                  </h3>
                  <p className="text-sm leading-6 text-slate-600">
                    This decides the price, payment rules, checklist items, and the professionals available for this transaction.
                  </p>
                </div>

                {hasRunFitScan && shortlistedFitRecommendations.length ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-col gap-1">
                      <p className="text-sm font-semibold text-slate-900">
                        Recommended for this contact
                      </p>
                      <p className="text-sm text-slate-500">
                        Pick one of the ranked matches or use the full selector below.
                      </p>
                    </div>
                    <div className="mt-3 grid gap-3 lg:grid-cols-2">
                      {shortlistedFitRecommendations.slice(0, 4).map((item) => (
                        <button
                          key={item.serviceId}
                          type="button"
                          className={cn(
                            "rounded-2xl border p-3 text-left transition",
                            createServiceId === item.serviceId
                              ? "border-blue-300 bg-blue-50"
                              : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white",
                          )}
                          onClick={() => {
                            clearCreateError("serviceId")
                            setCreateServiceId(item.serviceId)
                            setCreateTemplateId("")
                            setCreateAssignedProfessionalId("")
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 flex-col gap-1">
                              <p className="text-sm font-semibold text-slate-900">
                                {item.serviceName}
                              </p>
                              <p className="text-xs text-slate-500">
                                {item.explanation ||
                                  item.summary ||
                                  item.description ||
                                  "No explanation available."}
                              </p>
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              <Badge className={FIT_STATUS_STYLES[item.eligibilityStatus]}>
                                {toSentence(item.eligibilityStatus)}
                              </Badge>
                              <span className="text-xs font-semibold text-slate-600">
                                Score {item.fitScore}
                              </span>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <FlowStepCard
                  stepNumber="1"
                  title="Which service is this contact buying?"
                  description="Pick the service first. Then review its payment setup and optionally assign the professional delivering it."
                >
                  <Field
                    data-invalid={Boolean(createErrors.serviceId)}
                    data-disabled={isLoadingServiceOptions || isSaving}
                    className="gap-2"
                  >
                    <FieldLabel htmlFor="contact-service-transaction-service">
                      Service
                    </FieldLabel>
                    <ServicePicker
                      services={serviceOptions}
                      value={createServiceId}
                      onValueChange={(value) => {
                        clearCreateError("serviceId")
                        setCreateServiceId(value)
                        setCreateTemplateId("")
                        setCreateAssignedProfessionalId("")
                      }}
                      disabled={isLoadingServiceOptions || isSaving}
                      isLoading={isLoadingServiceOptions}
                      ariaInvalid={Boolean(createErrors.serviceId)}
                    />
                    <FieldDescription>
                      Search by service name. Selecting a service loads its price, workflow, and professionals.
                    </FieldDescription>
                    <FieldError>{createErrors.serviceId}</FieldError>
                  </Field>
                </FlowStepCard>

                <FlowStepCard
                  stepNumber="2"
                  title="Assign a professional?"
                  description="Optional. Use this when someone should own or deliver the service from the start."
                  disabled={!createServiceId}
                >
                  <Field
                    data-invalid={Boolean(createErrors.assignedProfessionalId)}
                    data-disabled={!createServiceDetails || isLoadingServiceDetails || isSaving}
                    className="gap-2"
                  >
                    <FieldLabel htmlFor="contact-service-transaction-professional">
                      Professional <span className="font-normal text-slate-500">(optional)</span>
                    </FieldLabel>
                    <AssignedProfessionalPicker
                      id="contact-service-transaction-professional"
                      professionals={createServiceDetails?.professionals ?? []}
                      value={createAssignedProfessionalId}
                      onValueChange={(value) => {
                        clearCreateError("assignedProfessionalId")
                        setCreateAssignedProfessionalId(value)
                      }}
                      disabled={!createServiceDetails || isLoadingServiceDetails || isSaving}
                      ariaInvalid={Boolean(createErrors.assignedProfessionalId)}
                    />
                    {!createServiceId ? (
                      <FieldDescription>
                        Choose a service first to load the professionals linked to it.
                      </FieldDescription>
                    ) : isLoadingServiceDetails ? (
                      <FieldDescription>Loading service professionals...</FieldDescription>
                    ) : createServiceDetails && createServiceDetails.professionals.length === 0 ? (
                      <FieldDescription>
                        This service does not have professionals configured yet.
                      </FieldDescription>
                    ) : (
                      <FieldDescription>
                        You can leave this unassigned and decide later.
                      </FieldDescription>
                    )}
                    <FieldError>{createErrors.assignedProfessionalId}</FieldError>
                  </Field>
                </FlowStepCard>

                {createServiceDetails ? (
                  <div className="flex flex-col gap-1 border-l-2 border-blue-200 py-1 pl-4">
                    <p className="text-xs font-semibold text-blue-700">Service summary</p>
                    <p className="text-sm font-medium text-slate-900">
                      {createServiceDetails.name}
                    </p>
                    <p className="text-sm text-slate-600">
                      {currencyFormatter(createServiceTotalCents ?? createServiceDetails.basePriceCents, createServiceDetails.currency)}
                    </p>
                    {createServiceTotalCents !== null &&
                    createServiceTotalCents !== createServiceDetails.basePriceCents ? (
                      <p className="text-xs text-slate-500">
                        Includes {createServiceDetails.tenantBilling.taxLabel || "tax"} at{" "}
                        {(createServiceDetails.tenantBilling.defaultTaxRatePercent ?? 0)
                          .toFixed(2)
                          .replace(/\.00$/, "")}
                        %.
                      </p>
                    ) : null}
                    <p className="text-sm text-slate-500">
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
              <section className="mt-6 flex flex-col gap-5">
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-semibold text-blue-700">Follow-up workflow</p>
                  <h3 className="text-base font-semibold text-slate-950">
                    Set up the service follow-up
                  </h3>
                  <p className="text-sm leading-6 text-slate-600">
                    Choose which follow-up template should start and who should be in charge of the follow-up work.
                  </p>
                </div>

                <FlowStepCard
                  stepNumber="1"
                  title="Which follow-up plan should start?"
                  description="Use the default published template or choose a different published template for this transaction."
                  disabled={!createServiceId}
                >
                  <Field
                    data-invalid={Boolean(createErrors.templateId)}
                    data-disabled={!createServiceDetails || isSaving}
                    className="gap-2"
                  >
                    <FieldLabel htmlFor="contact-service-transaction-template">
                      Follow-up template
                    </FieldLabel>
                    <Select
                      value={createTemplateId || "default"}
                      onValueChange={(value) => {
                        clearCreateError("templateId")
                        setCreateTemplateId(value === "default" ? "" : value)
                      }}
                      disabled={!createServiceDetails || isSaving}
                    >
                      <SelectTrigger
                        id="contact-service-transaction-template"
                        aria-invalid={Boolean(createErrors.templateId)}
                        className="h-11 w-full rounded-xl border-slate-200 bg-slate-50/60 px-3 shadow-none data-[size=default]:h-11"
                      >
                        <SelectValue placeholder="Use default template selection" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="default" className="cursor-pointer">
                            Use default published template
                          </SelectItem>
                          {(createServiceDetails?.followUpTemplates ?? []).map((template) => (
                            <SelectItem key={template.id} value={template.id} className="cursor-pointer">
                              {template.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {!createServiceId ? (
                      <FieldDescription>
                        Choose a service first to load its available follow-up templates.
                      </FieldDescription>
                    ) : (createServiceDetails?.followUpTemplates.length ?? 0) === 0 ? (
                      <FieldDescription>
                        No published templates are available for this service. The transaction can still proceed if the service has default follow-up steps.
                      </FieldDescription>
                    ) : (
                      <FieldDescription>
                        Leaving this on default uses the service&apos;s standard published template.
                      </FieldDescription>
                    )}
                    <FieldError>{createErrors.templateId}</FieldError>
                  </Field>
                </FlowStepCard>

                <FlowStepCard
                  stepNumber="2"
                  title="Who should be in charge of the follow up?"
                  description="Optional. This user will be assigned to the follow-up steps created from the selected template."
                  disabled={!createServiceId}
                >
                  <Field
                    data-invalid={Boolean(createErrors.followUpAssignedToUserId)}
                    data-disabled={!createServiceId || isLoadingAssignees || isSaving}
                    className="gap-2"
                  >
                    <FieldLabel htmlFor="contact-service-transaction-follow-up-owner">
                      Follow-up owner <span className="font-normal text-slate-500">(optional)</span>
                    </FieldLabel>
                    <FollowUpAssigneePicker
                      id="contact-service-transaction-follow-up-owner"
                      assignees={followUpAssigneeOptions}
                      value={createFollowUpAssignedToUserId}
                      onValueChange={(value) => {
                        clearCreateError("followUpAssignedToUserId")
                        setCreateFollowUpAssignedToUserId(value)
                      }}
                      disabled={!createServiceId || isLoadingAssignees || isSaving}
                      ariaInvalid={Boolean(createErrors.followUpAssignedToUserId)}
                    />
                    {!createServiceId ? (
                      <FieldDescription>
                        Choose a service first before assigning follow-up ownership.
                      </FieldDescription>
                    ) : isLoadingAssignees ? (
                      <FieldDescription>Loading tenant users...</FieldDescription>
                    ) : (
                      <FieldDescription>
                        You can leave this unassigned and route follow-up later.
                      </FieldDescription>
                    )}
                    <FieldError>{createErrors.followUpAssignedToUserId}</FieldError>
                  </Field>
                </FlowStepCard>
              </section>
            ) : null}

            {createStep === 3 ? (
              <section className="mt-6 grid gap-4">
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-semibold text-blue-700">Service checklist</p>
                  <h3 className="text-base font-semibold text-slate-950">
                    Review what needs to be completed for this service
                  </h3>
                  <p className="text-sm leading-6 text-slate-600">
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
                              <div className="flex flex-col gap-0.5">
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
              <section className="mt-6 grid gap-5">
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-semibold text-blue-700">Payment</p>
                  <h3 className="text-base font-semibold text-slate-950">
                    Confirm the purchase details
                  </h3>
                  <p className="text-sm leading-6 text-slate-600">
                    Review the service cost, choose how payment will be handled, and add any final context.
                  </p>
                </div>
                <FieldGroup className="grid gap-4 sm:grid-cols-2">
                  <Field
                    data-invalid={Boolean(createErrors.paymentMode)}
                    data-disabled={isSaving}
                    className="gap-2"
                  >
                    <FieldLabel htmlFor="contact-service-transaction-payment-type">
                      Payment type
                    </FieldLabel>
                    <Select
                      value={createPaymentMode}
                      onValueChange={(value) => {
                        clearCreateError("paymentMode")
                        clearCreateError("initialPaymentUsd")
                        setCreatePaymentMode(value as "FULL" | "PARTIAL" | "LATER")
                      }}
                      disabled={isSaving}
                    >
                      <SelectTrigger
                        id="contact-service-transaction-payment-type"
                        aria-invalid={Boolean(createErrors.paymentMode)}
                        className="h-11 w-full rounded-xl border-slate-200 bg-slate-50/60 px-3 shadow-none data-[size=default]:h-11"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="FULL" className="cursor-pointer">Pay in full</SelectItem>
                          <SelectItem
                            value="PARTIAL"
                            disabled={!createServiceDetails?.allowPartialPayments}
                            className="cursor-pointer"
                          >
                            Partial payment
                          </SelectItem>
                          <SelectItem value="LATER" className="cursor-pointer">Pay later</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {!createServiceDetails?.allowPartialPayments ? (
                      <FieldDescription>
                        This service supports full payment or pay later only.
                      </FieldDescription>
                    ) : null}
                    <FieldError>{createErrors.paymentMode}</FieldError>
                  </Field>

                  <Field className="gap-2">
                    <FieldLabel htmlFor="contact-service-transaction-cost">
                      Service cost
                    </FieldLabel>
                    <Input
                      id="contact-service-transaction-cost"
                      value={
                        createServiceTotalCents !== null
                          ? centsToUsdInput(createServiceTotalCents)
                          : ""
                      }
                      readOnly
                      className="h-11 rounded-xl border-slate-200 bg-slate-50/60 px-4 text-slate-600 shadow-none"
                    />
                  </Field>
                </FieldGroup>

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

                <FieldGroup className="grid gap-4 sm:grid-cols-2">
                  <Field
                    data-invalid={Boolean(createErrors.initialPaymentUsd)}
                    data-disabled={isSaving}
                    className="gap-2"
                  >
                    <FieldLabel htmlFor="contact-service-transaction-payment-now">
                      {createPaymentMode === "PARTIAL" ? "Partial Payment Amount" : "Payment Now"}
                    </FieldLabel>
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
                      disabled={isSaving}
                      aria-invalid={Boolean(createErrors.initialPaymentUsd)}
                      inputMode="decimal"
                      placeholder="0.00"
                      className={cn(
                        "h-11 rounded-xl border-slate-200 px-4 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100",
                        createPaymentMode === "PARTIAL"
                          ? "bg-slate-50/60"
                          : "bg-slate-50 text-slate-600",
                      )}
                    />
                    {createPaymentMode === "PARTIAL" &&
                    createServiceDetails?.minimumPartialPaymentCents ? (
                      <FieldDescription>
                        Minimum partial payment:{" "}
                        {currencyFormatter(
                          createServiceDetails.minimumPartialPaymentCents,
                          createServiceDetails.currency,
                        )}
                      </FieldDescription>
                    ) : null}
                    <FieldError>{createErrors.initialPaymentUsd}</FieldError>
                  </Field>

                  <Field
                    data-invalid={Boolean(createErrors.notes)}
                    data-disabled={isSaving}
                    className="gap-2"
                  >
                    <FieldLabel htmlFor="contact-service-transaction-notes">Notes</FieldLabel>
                    <Textarea
                      id="contact-service-transaction-notes"
                      value={createNotes}
                      onChange={(event) => {
                        clearCreateError("notes")
                        setCreateNotes(event.target.value)
                      }}
                      rows={3}
                      disabled={isSaving}
                      aria-invalid={Boolean(createErrors.notes)}
                      placeholder="Add context for this service purchase"
                      className="min-h-28 resize-y rounded-xl border-slate-200 bg-slate-50/60 px-4 py-3 leading-6 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
                    />
                    <FieldError>{createErrors.notes}</FieldError>
                  </Field>
                </FieldGroup>
              </section>
            ) : null}
          </div>
          <DialogFooter className="border-t border-slate-200 bg-slate-50/80 px-6 py-4 sm:items-center sm:px-7">
            <div className="text-sm text-slate-500 sm:mr-auto">
              {createStep === 1 ? "Choose the service first." : "Review the details before continuing."}
            </div>
            {createStep > 1 ? (
              <Button
                type="button"
                variant="outline"
                onClick={onPreviousCreateStep}
                disabled={isSaving}
              >
                Back
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={closeCreateDialog}
              disabled={isSaving}
            >
              Cancel
            </Button>
            {createStep < 4 ? (
              <Button
                type="button"
                onClick={onNextCreateStep}
                disabled={isSaving}
                className="min-w-28 bg-blue-950 text-white shadow-sm hover:bg-blue-900"
              >
                Next
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => void onCreate()}
                disabled={isSaving}
                className="min-w-40 bg-blue-950 text-white shadow-sm hover:bg-blue-900"
              >
                {isSaving ? (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                ) : null}
                {isSaving ? "Creating..." : "Purchase service"}
              </Button>
            )}
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
