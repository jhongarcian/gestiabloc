"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { isAxiosError } from "axios"
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  ClipboardList,
  GripVertical,
  Route,
  Save,
  UserRoundCog,
  Users,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
  EMPTY_SERVICE_FIT_PROFILE,
  type ServiceFitProfileDraft,
  ServiceFitRulesTab,
} from "./service-fit-rules-tab"

export type ServiceDetailsPanelProps = {
  tenantId: string
  tenantSlug: string
  service: {
    id: string
    name: string
    description: string | null
    fitProfile?: ServiceFitProfileDraft | null
    basePriceCents: number
    currency: string
    isTaxExempt: boolean
    allowPartialPayments: boolean
    minimumPartialPaymentCents: number | null
    installmentCount: number | null
    installmentFrequency: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | null
    isActive: boolean
    checklistItems: Array<{
      id: string
      label: string
      description: string | null
      isRequired: boolean
      sortOrder: number
    }>
    followUpTemplateSteps: Array<{
      id: string
      title: string
      notesTemplate: string | null
      dueDaysFromStart: number
      sortOrder: number
    }>
    followUpTemplates: Array<{
      id: string
      name: string
      sortOrder: number
      flowNodes: unknown[] | null
      flowEdges: unknown[] | null
    }>
    professionals: Array<{
      id: string
      kind: "INTERNAL_USER" | "EXTERNAL"
      userId: string | null
      externalProfessionalName: string | null
      externalContact: string | null
      notes: string | null
      sortOrder: number
      user: {
        name: string | null
        email: string
      } | null
    }>
    tenantBilling: {
      taxEnabled: boolean
      taxLabel: string | null
      defaultTaxRatePercent: number | null
    }
    configStatus: {
      overviewComplete: boolean
      checklistComplete: boolean
      followUpsComplete: boolean
      professionalsComplete: boolean
      isComplete: boolean
    }
  }
}

type UsersResponse = {
  ok: boolean
  items: Array<{
    id: string
    name: string
    email: string
  }>
}

type ChecklistItemDraft = {
  id: string
  label: string
  description: string
  isRequired: boolean
}

type ChecklistCreateDraft = {
  label: string
  description: string
  isRequired: boolean
}

type ProfessionalDraft = {
  id: string
  kind: "INTERNAL_USER" | "EXTERNAL"
  userId: string
  externalProfessionalName: string
  externalContact: string
  notes: string
}

function createDraftId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1000)}`
}

function SortableChecklistItem({
  item,
  index,
  onOpen,
}: {
  item: ChecklistItemDraft
  index: number
  onOpen: (item: ChecklistItemDraft) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: item.id,
  })

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50/30"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 active:cursor-grabbing"
          aria-label={`Reorder ${item.label || "checklist item"}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onOpen(item)}
          className="flex min-w-0 flex-1 cursor-pointer items-center justify-between rounded-xl border border-transparent px-2 py-2 text-left transition-colors hover:border-blue-200 hover:bg-blue-50/60"
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-7 min-w-7 items-center justify-center self-center rounded-full border border-blue-200 bg-blue-50 px-2 text-xs font-semibold text-blue-700">
              {index + 1}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-sm font-medium text-slate-900">{item.label}</p>
                {item.description.trim() ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className="inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <CircleHelp className="h-3.5 w-3.5" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-sm leading-5">
                      {item.description}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <span className="inline-flex h-5 w-5 items-center justify-center opacity-0">
                    <CircleHelp className="h-3.5 w-3.5" />
                  </span>
                )}
              </div>
              {item.description.trim() ? (
                <p className="mt-1 truncate text-sm text-slate-500">{item.description}</p>
              ) : (
                <p className="mt-1 text-sm text-slate-400">No description added</p>
              )}
            </div>
          </div>
          <span
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium",
              item.isRequired
                ? "border-blue-200 bg-blue-50 text-blue-700"
                : "border-slate-200 bg-slate-50 text-slate-600",
            )}
          >
            {item.isRequired ? "Required" : "Optional"}
          </span>
        </button>
      </div>
    </article>
  )
}

function SortableProfessionalRow({
  entry,
  index,
  displayName,
  onOpen,
}: {
  entry: ProfessionalDraft
  index: number
  displayName: string
  onOpen: (professionalId: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.id,
  })

  return (
    <TableRow
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "cursor-pointer transition-colors hover:bg-blue-50/50 focus-visible:bg-blue-50/50",
        isDragging && "bg-blue-50/50",
      )}
      onClick={() => onOpen(entry.id)}
    >
      <TableCell className="w-10">
        <button
          type="button"
          className="inline-flex h-8 w-8 cursor-grab items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 active:cursor-grabbing"
          aria-label={`Reorder ${displayName}`}
          onClick={(event) => event.stopPropagation()}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </TableCell>
      <TableCell>
        <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-blue-200 bg-blue-50 px-2 text-xs font-semibold text-blue-700">
          {index + 1}
        </span>
      </TableCell>
      <TableCell>
        <span
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs font-medium",
            entry.kind === "INTERNAL_USER"
              ? "border-blue-200 bg-blue-50 text-blue-700"
              : "border-orange-200 bg-orange-50 text-orange-700",
          )}
        >
          {entry.kind === "INTERNAL_USER" ? "Internal user" : "External professional"}
        </span>
      </TableCell>
      <TableCell>
        <div className="space-y-0.5">
          <p className="font-medium text-slate-900">{displayName}</p>
          <p className="text-sm text-slate-500">
            {entry.kind === "INTERNAL_USER" ? "Assigned from tenant users" : "External specialist"}
          </p>
        </div>
      </TableCell>
      <TableCell className="text-slate-600">
        {entry.kind === "INTERNAL_USER" ? (
          <span className="text-slate-400">No external contact</span>
        ) : entry.externalContact ? (
          entry.externalContact
        ) : (
          <span className="text-slate-400">No contact added</span>
        )}
      </TableCell>
    </TableRow>
  )
}

function centsToDollars(value: number) {
  return (value / 100).toFixed(2)
}

function dollarsToCents(value: string) {
  const numericValue = Number.parseFloat(value)
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return null
  }

  return Math.round(numericValue * 100)
}

const INSTALLMENT_FREQUENCY_OPTIONS = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "BIWEEKLY", label: "Biweekly" },
  { value: "MONTHLY", label: "Monthly" },
] as const

function formatInstallmentFrequency(
  value: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | null | undefined,
) {
  return INSTALLMENT_FREQUENCY_OPTIONS.find((option) => option.value === value)?.label ?? null
}

function formatCurrency(valueCents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((valueCents || 0) / 100)
}

export function ServiceDetailsPanel({ tenantId, tenantSlug, service }: ServiceDetailsPanelProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<
    "overview" | "fit-rules" | "checklists" | "follow-up-templates" | "professionals"
  >("overview")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isChecklistSaving, setIsChecklistSaving] = useState(false)
  const [isProfessionalsSaving, setIsProfessionalsSaving] = useState(false)
  const [isDeletingService, setIsDeletingService] = useState(false)
  const [isChecklistDialogOpen, setIsChecklistDialogOpen] = useState(false)
  const [editingChecklistItemId, setEditingChecklistItemId] = useState<string | null>(null)
  const [checklistDraft, setChecklistDraft] = useState<ChecklistCreateDraft>({
    label: "",
    description: "",
    isRequired: true,
  })
  const [editingChecklistDraft, setEditingChecklistDraft] = useState<ChecklistCreateDraft>({
    label: "",
    description: "",
    isRequired: true,
  })
  const [name, setName] = useState(service.name)
  const [description, setDescription] = useState(service.description ?? "")
  const [fitProfile, setFitProfile] = useState<ServiceFitProfileDraft>(
    service.fitProfile ?? EMPTY_SERVICE_FIT_PROFILE,
  )
  const [basePrice, setBasePrice] = useState(centsToDollars(service.basePriceCents))
  const [currency] = useState(service.currency)
  const [isTaxExempt, setIsTaxExempt] = useState(service.isTaxExempt)
  const [allowPartialPayments, setAllowPartialPayments] = useState(service.allowPartialPayments)
  const [minimumPartialPayment, setMinimumPartialPayment] = useState(
    service.minimumPartialPaymentCents !== null
      ? centsToDollars(service.minimumPartialPaymentCents)
      : "",
  )
  const [installmentCount, setInstallmentCount] = useState(
    service.installmentCount !== null ? String(service.installmentCount) : "",
  )
  const [installmentFrequency, setInstallmentFrequency] = useState<
    "WEEKLY" | "BIWEEKLY" | "MONTHLY" | ""
  >(service.installmentFrequency ?? "")
  const [isActive, setIsActive] = useState(service.isActive)
  const [users, setUsers] = useState<UsersResponse["items"]>([])
  const [checklistItems, setChecklistItems] = useState<ChecklistItemDraft[]>(
    service.checklistItems.map((item) => ({
      id: item.id,
      label: item.label,
      description: item.description ?? "",
      isRequired: item.isRequired,
    })),
  )
  const [professionals, setProfessionals] = useState(
    service.professionals.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      userId: entry.userId ?? "",
      externalProfessionalName: entry.externalProfessionalName ?? "",
      externalContact: entry.externalContact ?? "",
      notes: entry.notes ?? "",
    })),
  )
  const [editingProfessionalId, setEditingProfessionalId] = useState<string | null>(null)
  const [isProfessionalDialogOpen, setIsProfessionalDialogOpen] = useState(false)
  const [professionalDraft, setProfessionalDraft] = useState<ProfessionalDraft>({
    id: createDraftId("professional"),
    kind: "INTERNAL_USER",
    userId: "",
    externalProfessionalName: "",
    externalContact: "",
    notes: "",
  })

  const loadUsers = useCallback(async () => {
    try {
      const { data } = await api.get<UsersResponse>(`/api/account-settings/${tenantId}/users`, {
        params: { page: 1, pageSize: 25 },
      })
      setUsers(data.items)
    } catch {
      setUsers([])
    }
  }, [tenantId])

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("service-breadcrumb-updated", {
        detail: { label: service.name },
      }),
    )

    return () => {
      window.dispatchEvent(
        new CustomEvent("service-breadcrumb-updated", {
          detail: { label: null },
        }),
      )
    }
  }, [service.name])

  const checklistSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const checklistComplete = checklistItems.some((item) => item.label.trim())
  const requiredChecklistCount = checklistItems.filter((item) => item.isRequired).length
  const optionalChecklistCount = checklistItems.length - requiredChecklistCount
  const followUpsComplete =
    service.followUpTemplates.length > 0 || service.followUpTemplateSteps.length > 0
  const totalTemplateNodes = useMemo(
    () =>
      service.followUpTemplates.reduce(
        (total, template) => total + (Array.isArray(template.flowNodes) ? template.flowNodes.length : 0),
        0,
      ),
    [service.followUpTemplates],
  )
  const totalTemplateEdges = useMemo(
    () =>
      service.followUpTemplates.reduce(
        (total, template) => total + (Array.isArray(template.flowEdges) ? template.flowEdges.length : 0),
        0,
      ),
    [service.followUpTemplates],
  )
  const internalProfessionalsCount = useMemo(
    () => professionals.filter((entry) => entry.kind === "INTERNAL_USER").length,
    [professionals],
  )
  const externalProfessionalsCount = professionals.length - internalProfessionalsCount
  const professionalsComplete = professionals.length > 0
  const basePriceCentsPreview = useMemo(() => dollarsToCents(basePrice), [basePrice])
  const minimumDepositCentsPreview = useMemo(
    () => (allowPartialPayments ? dollarsToCents(minimumPartialPayment) : null),
    [allowPartialPayments, minimumPartialPayment],
  )
  const installmentCountNumber = useMemo(() => {
    if (!allowPartialPayments) return null
    const parsed = Number.parseInt(installmentCount, 10)
    if (!Number.isInteger(parsed) || parsed < 2) return null
    return parsed
  }, [allowPartialPayments, installmentCount])
  const tenantTaxRatePercent = service.tenantBilling.defaultTaxRatePercent
  const tenantTaxLabel = service.tenantBilling.taxLabel?.trim() || "Tax"
  const taxApplies =
    service.tenantBilling.taxEnabled &&
    !isTaxExempt &&
    tenantTaxRatePercent !== null &&
    tenantTaxRatePercent !== undefined
  const estimatedTaxCents = useMemo(() => {
    if (!taxApplies || basePriceCentsPreview === null) return 0
    return Math.round(basePriceCentsPreview * (tenantTaxRatePercent! / 100))
  }, [basePriceCentsPreview, taxApplies, tenantTaxRatePercent])
  const totalWithTaxCents = useMemo(() => {
    if (basePriceCentsPreview === null) return null
    return basePriceCentsPreview + estimatedTaxCents
  }, [basePriceCentsPreview, estimatedTaxCents])
  const maxAllowedDepositCents = totalWithTaxCents ?? basePriceCentsPreview
  const estimatedInstallmentCents = useMemo(() => {
    if (
      !allowPartialPayments ||
      installmentCountNumber === null ||
      totalWithTaxCents === null
    ) {
      return null
    }

    const deposit = minimumDepositCentsPreview ?? 0
    const remainingBalance = Math.max(0, totalWithTaxCents - deposit)
    return Math.round(remainingBalance / installmentCountNumber)
  }, [
    allowPartialPayments,
    installmentCountNumber,
    minimumDepositCentsPreview,
    totalWithTaxCents,
  ])
  const overviewComplete = useMemo(() => {
    if (!name.trim()) return false
    if (basePriceCentsPreview === null) return false
    if (currency.trim().length !== 3) return false
    if (service.tenantBilling.taxEnabled && !isTaxExempt && tenantTaxRatePercent == null) {
      return false
    }
    if (!allowPartialPayments) return true
    if (minimumDepositCentsPreview === null) return false
    if (
      maxAllowedDepositCents !== null &&
      minimumDepositCentsPreview > maxAllowedDepositCents
    ) {
      return false
    }
    if (installmentCountNumber === null) return false
    if (!installmentFrequency) return false
    return true
  }, [
    allowPartialPayments,
    basePriceCentsPreview,
    currency,
    installmentCountNumber,
    installmentFrequency,
    isTaxExempt,
    maxAllowedDepositCents,
    minimumDepositCentsPreview,
    name,
    service.tenantBilling.taxEnabled,
    tenantTaxRatePercent,
  ])
  const usersById = useMemo(
    () => new Map(users.map((user) => [user.id, user])),
    [users],
  )

  const isComplete = useMemo(
    () => overviewComplete && checklistComplete && followUpsComplete && professionalsComplete,
    [overviewComplete, checklistComplete, followUpsComplete, professionalsComplete],
  )
  const summaryItems = useMemo(
    () => [
      {
        key: "overview" as const,
        label: "Overview",
        value: allowPartialPayments
          ? installmentCountNumber
            ? `${installmentCountNumber} ${installmentCountNumber === 1 ? "installment" : "installments"}`
            : "Billing setup needed"
          : "Full payment",
        hint: overviewComplete
          ? "Billing rules configured"
          : service.tenantBilling.taxEnabled && !isTaxExempt && tenantTaxRatePercent == null
            ? "Tenant tax settings are incomplete"
            : "Finish billing and tax rules",
        icon: CircleHelp,
        isComplete: overviewComplete,
      },
      {
        key: "checklists" as const,
        label: "Checklist",
        value: checklistItems.length,
        hint: checklistComplete ? "Configured" : "Needs at least one item",
        icon: ClipboardList,
        isComplete: checklistComplete,
      },
      {
        key: "follow-up-templates" as const,
        label: "Follow-Up Templates",
        value: service.followUpTemplates.length,
        hint: followUpsComplete ? "Ready to enroll" : "No template yet",
        icon: Route,
        isComplete: followUpsComplete,
      },
      {
        key: "professionals" as const,
        label: "Professionals",
        value: professionals.length,
        hint: professionalsComplete ? "Coverage configured" : "No professionals assigned",
        icon: UserRoundCog,
        isComplete: professionalsComplete,
      },
    ],
    [
      allowPartialPayments,
      checklistComplete,
      checklistItems.length,
      followUpsComplete,
      installmentCountNumber,
      isTaxExempt,
      overviewComplete,
      professionals.length,
      professionalsComplete,
      service.followUpTemplates.length,
      service.tenantBilling.taxEnabled,
      tenantTaxRatePercent,
    ],
  )

  const persistChecklistItems = useCallback(
    async (nextItems: ChecklistItemDraft[]) => {
      setIsChecklistSaving(true)
      try {
        await api.patch(`/api/account-settings/${tenantId}/services/${service.id}`, {
          checklistItems: nextItems
            .filter((item) => item.label.trim())
            .map((item, index) => ({
              label: item.label.trim(),
              description: item.description.trim() || null,
              isRequired: item.isRequired,
              sortOrder: (index + 1) * 10,
            })),
        })
      } catch (error) {
        if (isAxiosError(error)) {
          const backendError = error.response?.data?.error
          toast.error(
            typeof backendError === "string"
              ? backendError.replace(/_/g, " ")
              : "Could not save checklist.",
          )
        } else {
          toast.error("Could not save checklist.")
        }
      } finally {
        setIsChecklistSaving(false)
      }
    },
    [tenantId, service.id],
  )

  const persistProfessionals = useCallback(
    async (nextItems: ProfessionalDraft[]) => {
      setIsProfessionalsSaving(true)
      try {
        await api.patch(`/api/account-settings/${tenantId}/services/${service.id}`, {
          professionals: nextItems.map((entry, index) => ({
            kind: entry.kind,
            userId: entry.kind === "INTERNAL_USER" ? entry.userId || null : null,
            externalProfessionalName:
              entry.kind === "EXTERNAL" ? entry.externalProfessionalName.trim() || null : null,
            externalContact:
              entry.kind === "EXTERNAL" ? entry.externalContact.trim() || null : null,
            notes: entry.notes.trim() || null,
            sortOrder: (index + 1) * 10,
          })),
        })
      } catch (error) {
        if (isAxiosError(error)) {
          const backendError = error.response?.data?.error
          toast.error(
            typeof backendError === "string"
              ? backendError.replace(/_/g, " ")
              : "Could not save professionals.",
          )
        } else {
          toast.error("Could not save professionals.")
        }
      } finally {
        setIsProfessionalsSaving(false)
      }
    },
    [tenantId, service.id],
  )

  const handleChecklistDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return

      const oldIndex = checklistItems.findIndex((item) => item.id === active.id)
      const newIndex = checklistItems.findIndex((item) => item.id === over.id)
      if (oldIndex < 0 || newIndex < 0) return
      const next = arrayMove(checklistItems, oldIndex, newIndex)
      setChecklistItems(next)
      void persistChecklistItems(next)
    },
    [checklistItems, persistChecklistItems],
  )

  const handleProfessionalsDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return

      const oldIndex = professionals.findIndex((item) => item.id === active.id)
      const newIndex = professionals.findIndex((item) => item.id === over.id)
      if (oldIndex < 0 || newIndex < 0) return

      const next = arrayMove(professionals, oldIndex, newIndex)
      setProfessionals(next)
      void persistProfessionals(next)
    },
    [persistProfessionals, professionals],
  )

  const addChecklistItemFromDialog = () => {
    if (!checklistDraft.label.trim()) {
      toast.error("Checklist item label is required.")
      return
    }

    const next = [
      ...checklistItems,
      {
        id: createDraftId("checklist"),
        label: checklistDraft.label.trim(),
        description: checklistDraft.description.trim(),
        isRequired: checklistDraft.isRequired,
      },
    ]
    setChecklistItems(next)
    void persistChecklistItems(next)

    setChecklistDraft({ label: "", description: "", isRequired: true })
    setIsChecklistDialogOpen(false)
  }

  const openCreateProfessionalDialog = () => {
    setEditingProfessionalId(null)
    setProfessionalDraft({
      id: createDraftId("professional"),
      kind: "INTERNAL_USER",
      userId: "",
      externalProfessionalName: "",
      externalContact: "",
      notes: "",
    })
    setIsProfessionalDialogOpen(true)
  }

  const openEditProfessionalDialog = (professionalId: string) => {
    const entry = professionals.find((item) => item.id === professionalId)
    if (!entry) return
    setEditingProfessionalId(professionalId)
    setProfessionalDraft({ ...entry })
    setIsProfessionalDialogOpen(true)
  }

  const saveProfessionalDialog = () => {
    if (professionalDraft.kind === "INTERNAL_USER" && !professionalDraft.userId) {
      toast.error("Select an internal user.")
      return
    }
    if (
      professionalDraft.kind === "EXTERNAL" &&
      !professionalDraft.externalProfessionalName.trim()
    ) {
      toast.error("External professional name is required.")
      return
    }

    if (editingProfessionalId === null) {
      const next = [...professionals, { ...professionalDraft }]
      setProfessionals(next)
      void persistProfessionals(next)
    } else {
      const next = professionals.map((entry) =>
        entry.id === editingProfessionalId ? { ...professionalDraft } : entry,
      )
      setProfessionals(next)
      void persistProfessionals(next)
    }

    setIsProfessionalDialogOpen(false)
    setEditingProfessionalId(null)
  }

  const deleteProfessionalFromDialog = () => {
    if (editingProfessionalId === null) return
    const next = professionals.filter((entry) => entry.id !== editingProfessionalId)
    setProfessionals(next)
    void persistProfessionals(next)
    setIsProfessionalDialogOpen(false)
    setEditingProfessionalId(null)
  }

  const openChecklistEditDialog = (item: ChecklistItemDraft) => {
    setEditingChecklistItemId(item.id)
    setEditingChecklistDraft({
      label: item.label,
      description: item.description,
      isRequired: item.isRequired,
    })
  }

  const saveChecklistEdit = () => {
    if (!editingChecklistItemId) return
    if (!editingChecklistDraft.label.trim()) {
      toast.error("Checklist item label is required.")
      return
    }

    const next = checklistItems.map((item) =>
      item.id === editingChecklistItemId
        ? {
            ...item,
            label: editingChecklistDraft.label.trim(),
            description: editingChecklistDraft.description.trim(),
            isRequired: editingChecklistDraft.isRequired,
          }
        : item,
    )
    setChecklistItems(next)
    void persistChecklistItems(next)
    setEditingChecklistItemId(null)
  }

  const deleteChecklistItem = () => {
    if (!editingChecklistItemId) return
    const next = checklistItems.filter((item) => item.id !== editingChecklistItemId)
    setChecklistItems(next)
    void persistChecklistItems(next)
    setEditingChecklistItemId(null)
  }

  const onSubmit = async () => {
    const basePriceCents = dollarsToCents(basePrice)
    if (!name.trim()) {
      toast.error("Service name is required.")
      return
    }

    if (basePriceCents === null) {
      toast.error("Base price must be a valid positive number.")
      return
    }

    const minimumPartialPaymentCents = allowPartialPayments
      ? dollarsToCents(minimumPartialPayment)
      : null
    const nextInstallmentCount = allowPartialPayments
      ? Number.parseInt(installmentCount, 10)
      : null

    if (allowPartialPayments && minimumPartialPaymentCents === null) {
      toast.error("Minimum deposit must be a valid number.")
      return
    }

    if (
      allowPartialPayments &&
      minimumPartialPaymentCents !== null &&
      maxAllowedDepositCents !== null &&
      minimumPartialPaymentCents > maxAllowedDepositCents
    ) {
      toast.error("Minimum deposit cannot exceed the service total.")
      return
    }

    if (
      service.tenantBilling.taxEnabled &&
      !isTaxExempt &&
      (tenantTaxRatePercent === null || tenantTaxRatePercent === undefined)
    ) {
      toast.error("This tenant must configure a default tax rate first.")
      return
    }

    if (
      allowPartialPayments &&
      (nextInstallmentCount === null ||
        !Number.isInteger(nextInstallmentCount) ||
        nextInstallmentCount < 2)
    ) {
      toast.error("Number of installments must be at least 2.")
      return
    }

    if (allowPartialPayments && !installmentFrequency) {
      toast.error("Select an installment frequency.")
      return
    }

    setIsSubmitting(true)

    try {
      await api.patch(`/api/account-settings/${tenantId}/services/${service.id}`, {
        name: name.trim(),
        description: description.trim() || null,
        fitProfile,
        basePriceCents,
        currency: currency.trim().toUpperCase() || "USD",
        isTaxExempt,
        allowPartialPayments,
        minimumPartialPaymentCents,
        installmentCount: allowPartialPayments ? nextInstallmentCount : null,
        installmentFrequency: allowPartialPayments ? installmentFrequency : null,
        isActive,
        checklistItems: checklistItems
          .filter((item) => item.label.trim())
          .map((item, index) => ({
            label: item.label.trim(),
            description: item.description.trim() || null,
            isRequired: item.isRequired,
            sortOrder: (index + 1) * 10,
          })),
        professionals: professionals.map((entry, index) => ({
          kind: entry.kind,
          userId: entry.kind === "INTERNAL_USER" ? entry.userId || null : null,
          externalProfessionalName:
            entry.kind === "EXTERNAL" ? entry.externalProfessionalName.trim() || null : null,
          externalContact: entry.kind === "EXTERNAL" ? entry.externalContact.trim() || null : null,
          notes: entry.notes.trim() || null,
          sortOrder: (index + 1) * 10,
        })),
      })

      toast.success("Service updated.")
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not update service.",
        )
      } else {
        toast.error("Could not update service.")
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const onDeleteService = async () => {
    const confirmed = window.confirm(
      "Delete this service? Existing process records remain but this service configuration will be removed.",
    )
    if (!confirmed) return

    setIsDeletingService(true)

    try {
      await api.delete(`/api/account-settings/${tenantId}/services/${service.id}`)
      toast.success("Service deleted.")
      router.push(`/app/${tenantSlug}/account-settings/services`)
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not delete service.",
        )
      } else {
        toast.error("Could not delete service.")
      }
    } finally {
      setIsDeletingService(false)
    }
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_45%,#fff7ed_100%)] p-5 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Service Setup</p>
            <h2 className="text-2xl font-semibold text-slate-950">{name}</h2>
            <p className="text-sm text-slate-600">
              Configure overview, checklist, follow-up templates, and professionals from one workspace.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isComplete ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                Ready
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">
                <AlertTriangle className="h-4 w-4" />
                Configuration incomplete
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer border-rose-200 text-rose-700 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800"
              onClick={onDeleteService}
              disabled={isDeletingService}
            >
              {isDeletingService ? "Deleting..." : "Delete service"}
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-[20px] border border-slate-200 bg-white p-4 md:p-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {summaryItems.map((item) => {
            const Icon = item.icon

            return (
              <article
                key={item.label}
                className={cn(
                  "rounded-2xl border px-4 py-3",
                  item.isComplete
                    ? "border-emerald-200 bg-emerald-50/70"
                    : "border-rose-200 bg-rose-50/80",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "h-2.5 w-2.5 rounded-full",
                          item.isComplete ? "bg-emerald-500" : "bg-rose-500",
                        )}
                      />
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                        {item.label}
                      </p>
                    </div>
                    <p className="text-xl font-semibold text-slate-950">{item.value}</p>
                    <p className="text-sm text-slate-600">{item.hint}</p>
                  </div>
                  <span
                    className={cn(
                      "inline-flex h-10 w-10 items-center justify-center rounded-2xl border bg-white",
                      item.isComplete
                        ? "border-emerald-200 text-emerald-700"
                        : "border-rose-200 text-rose-700",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <Tabs
        value={activeTab}
        onValueChange={(value) =>
          setActiveTab(
            value as "overview" | "fit-rules" | "checklists" | "follow-up-templates" | "professionals",
          )
        }
        className="space-y-5"
      >
        <div className="overflow-x-auto">
          <TabsList className="inline-flex h-auto min-w-max items-center gap-2 rounded-none bg-transparent p-0">
            <TabsTrigger
              value="overview"
              className="inline-flex h-8 cursor-pointer rounded-md px-2.5 text-xs font-medium whitespace-nowrap text-slate-600 shadow-none transition hover:bg-blue-900/10 hover:text-slate-900 data-[state=active]:bg-blue-950 data-[state=active]:text-white data-[state=active]:shadow-none md:text-sm"
            >
              Overview
            </TabsTrigger>
            <TabsTrigger
              value="fit-rules"
              className="inline-flex h-8 cursor-pointer rounded-md px-2.5 text-xs font-medium whitespace-nowrap text-slate-600 shadow-none transition hover:bg-blue-900/10 hover:text-slate-900 data-[state=active]:bg-blue-950 data-[state=active]:text-white data-[state=active]:shadow-none md:text-sm"
            >
              Fit Rules
            </TabsTrigger>
            <TabsTrigger
              value="checklists"
              className="inline-flex h-8 cursor-pointer rounded-md px-2.5 text-xs font-medium whitespace-nowrap text-slate-600 shadow-none transition hover:bg-blue-900/10 hover:text-slate-900 data-[state=active]:bg-blue-950 data-[state=active]:text-white data-[state=active]:shadow-none md:text-sm"
            >
              Checklists
            </TabsTrigger>
            <TabsTrigger
              value="follow-up-templates"
              className="inline-flex h-8 cursor-pointer rounded-md px-2.5 text-xs font-medium whitespace-nowrap text-slate-600 shadow-none transition hover:bg-blue-900/10 hover:text-slate-900 data-[state=active]:bg-blue-950 data-[state=active]:text-white data-[state=active]:shadow-none md:text-sm"
            >
              Follow-Up Templates
            </TabsTrigger>
            <TabsTrigger
              value="professionals"
              className="inline-flex h-8 cursor-pointer rounded-md px-2.5 text-xs font-medium whitespace-nowrap text-slate-600 shadow-none transition hover:bg-blue-900/10 hover:text-slate-900 data-[state=active]:bg-blue-950 data-[state=active]:text-white data-[state=active]:shadow-none md:text-sm"
            >
              Professionals
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="mt-0 space-y-5">
          <section className="rounded-[20px] border border-slate-200 bg-white p-5">
            <div className="space-y-1">
              <h3 className="text-lg font-semibold text-slate-900">Overview</h3>
              <p className="text-sm text-slate-500">
                Configure the core details, billing rules, and tax behavior for this service.
              </p>
            </div>
            <div className="mt-4 grid gap-4">
              <div className="grid gap-2">
                <Label>Service name</Label>
                <Input value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>Description</Label>
                <Textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
              </div>

              <div className="grid gap-4 md:grid-cols-4">
                <div className="grid gap-2 md:col-span-2">
                  <Label>Base price</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={basePrice}
                    onChange={(event) => setBasePrice(event.target.value)}
                  />
                </div>
                <div className="grid gap-2 md:col-span-1">
                  <Label>Currency</Label>
                  <Input maxLength={3} value={currency} disabled readOnly className="cursor-not-allowed uppercase" />
                </div>
                <div className="grid gap-2 md:col-span-1">
                  <Label>Status</Label>
                  <Select
                    value={isActive ? "active" : "inactive"}
                    onValueChange={(value) => setIsActive(value === "active")}
                  >
                    <SelectTrigger className="cursor-pointer">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold text-slate-900">Billing Rules</h4>
                  <p className="text-sm text-slate-500">
                    Configure tax exemption, deposit rules, and the fixed installment schedule.
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-slate-900">Tax behavior</p>
                    <p className="text-sm text-slate-500">
                      Use the tenant default tax unless this service should always be tax exempt.
                    </p>
                  </div>
                  <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-700">
                    <Checkbox
                      checked={isTaxExempt}
                      onCheckedChange={(checked) => setIsTaxExempt(checked === true)}
                    />
                    Tax exempt service
                  </label>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-slate-900">Payment plan</p>
                    <p className="text-sm text-slate-500">
                      Decide whether the contact can pay over time and define the installment structure.
                    </p>
                  </div>
                  <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-700">
                    <Checkbox
                      checked={allowPartialPayments}
                      onCheckedChange={(checked) => setAllowPartialPayments(checked === true)}
                    />
                    Allow partial payments
                  </label>
                  <div className="mt-4 grid gap-4 border-t border-slate-200 pt-4 md:grid-cols-3">
                    <div className="grid gap-2">
                      <Label>Minimum deposit</Label>
                      <div className="relative">
                        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-slate-500">
                          $
                        </span>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          inputMode="decimal"
                          disabled={!allowPartialPayments}
                          value={minimumPartialPayment}
                          onChange={(event) => {
                            const nextValue = event.target.value
                            if (nextValue.startsWith("-")) return

                            const parsed = Number.parseFloat(nextValue)
                            if (Number.isFinite(parsed) && parsed < 0) return

                            setMinimumPartialPayment(nextValue)
                          }}
                          className="pl-7"
                        />
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label>Number of installments</Label>
                      <Input
                        type="number"
                        min={2}
                        step={1}
                        inputMode="numeric"
                        disabled={!allowPartialPayments}
                        value={installmentCount}
                        onChange={(event) => {
                          const nextValue = event.target.value
                          if (nextValue.startsWith("-")) return

                          const parsed = Number.parseInt(nextValue, 10)
                          if (Number.isInteger(parsed) && parsed < 0) return

                          setInstallmentCount(nextValue)
                        }}
                        placeholder="4"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Installment frequency</Label>
                      <Select
                        value={installmentFrequency || "__none__"}
                        onValueChange={(value) =>
                          setInstallmentFrequency(
                            value === "__none__" ? "" : (value as "WEEKLY" | "BIWEEKLY" | "MONTHLY"),
                          )
                        }
                        disabled={!allowPartialPayments}
                      >
                        <SelectTrigger className="cursor-pointer">
                          <SelectValue placeholder="Select frequency" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">No frequency selected</SelectItem>
                          {INSTALLMENT_FREQUENCY_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Tax Summary
                  </p>
                  {service.tenantBilling.taxEnabled ? (
                    <div className="mt-2 space-y-1 text-sm text-slate-600">
                      {isTaxExempt ? (
                        <p>This service is marked tax exempt.</p>
                      ) : tenantTaxRatePercent != null ? (
                        <>
                          <p>
                            {tenantTaxLabel}:{" "}
                            <span className="font-medium text-slate-900">
                              {tenantTaxRatePercent.toFixed(2).replace(/\.00$/, "")}%
                            </span>
                          </p>
                          <p>
                            Estimated tax on current price:{" "}
                            <span className="font-medium text-slate-900">
                              {basePriceCentsPreview !== null
                                ? formatCurrency(estimatedTaxCents, currency)
                                : "Enter a valid price"}
                            </span>
                          </p>
                        </>
                      ) : (
                        <p className="text-rose-700">
                          Tenant tax settings are incomplete. Configure the tax rate in account settings.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-slate-600">
                      This tenant does not charge tax by default.
                    </p>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Payment Plan Preview
                  </p>
                  <div className="mt-2 space-y-1 text-sm text-slate-600">
                    <p>
                      Total:{" "}
                      <span className="font-medium text-slate-900">
                        {totalWithTaxCents !== null
                          ? formatCurrency(totalWithTaxCents, currency)
                          : "Enter a valid price"}
                      </span>
                    </p>
                    <p>
                      {allowPartialPayments
                        ? installmentCountNumber && installmentFrequency && estimatedInstallmentCents !== null
                          ? `${installmentCountNumber} ${formatInstallmentFrequency(installmentFrequency)?.toLowerCase()} installments after first payment`
                          : "Complete installment fields to preview the schedule"
                        : "Full amount only"}
                    </p>
                    {allowPartialPayments ? (
                      <>
                        <p>
                          Minimum deposit:{" "}
                          <span className="font-medium text-slate-900">
                            {minimumDepositCentsPreview !== null
                              ? formatCurrency(minimumDepositCentsPreview, currency)
                              : "Required"}
                          </span>
                        </p>
                        {estimatedInstallmentCents !== null ? (
                          <p>
                            Estimated installment:{" "}
                            <span className="font-medium text-slate-900">
                              {formatCurrency(estimatedInstallmentCents, currency)}
                            </span>
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <p>Contacts can still pay the full amount at any time.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="fit-rules" className="mt-0">
          <ServiceFitRulesTab
            tenantId={tenantId}
            profile={fitProfile}
            onChange={setFitProfile}
          />
        </TabsContent>

        <TabsContent value="checklists" className="mt-0">
          <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <h3 className="inline-flex items-center gap-2 text-lg font-semibold text-slate-900">
                <ClipboardList className="h-4 w-4 text-blue-700" />
                Checklist
              </h3>
              <p className="text-sm text-slate-500">
                Documents and requirements the contact needs before the service can move forward.
              </p>
            </div>
            <Dialog
              open={isChecklistDialogOpen}
              onOpenChange={(open) => {
                setIsChecklistDialogOpen(open)
                if (!open) {
                  setChecklistDraft({ label: "", description: "", isRequired: true })
                }
              }}
            >
              <DialogTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  className="cursor-pointer bg-blue-950 text-white hover:bg-blue-900"
                  disabled={isChecklistSaving}
                >
                  Add item
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Create checklist item</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label>Label</Label>
                    <Input
                      placeholder="Document ID"
                      value={checklistDraft.label}
                      onChange={(event) =>
                        setChecklistDraft((prev) => ({ ...prev, label: event.target.value }))
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Description</Label>
                    <Textarea
                      rows={3}
                      placeholder="What this item is and why it is needed"
                      value={checklistDraft.description}
                      onChange={(event) =>
                        setChecklistDraft((prev) => ({
                          ...prev,
                          description: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <Checkbox
                      checked={checklistDraft.isRequired}
                      onCheckedChange={(checked) =>
                        setChecklistDraft((prev) => ({
                          ...prev,
                          isRequired: checked === true,
                        }))
                      }
                    />
                    Required
                  </label>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    className="cursor-pointer border-slate-200 text-slate-700 hover:bg-slate-50"
                    onClick={() => {
                      setIsChecklistDialogOpen(false)
                      setChecklistDraft({ label: "", description: "", isRequired: true })
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    className="cursor-pointer bg-blue-950 text-white hover:bg-blue-900"
                    onClick={addChecklistItemFromDialog}
                    disabled={isChecklistSaving}
                  >
                    {isChecklistSaving ? "Saving..." : "Add checklist item"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="p-5">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-[linear-gradient(135deg,#eff6ff_0%,#f8fafc_100%)] px-4 py-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900">Checklist workflow</p>
              <p className="text-sm text-slate-600">
                {checklistItems.length > 1
                  ? "Drag items to reorder the requirements for this service."
                  : "Add the requirements this contact must complete for the service."}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-xs font-medium text-blue-700">
                {checklistItems.length} item{checklistItems.length === 1 ? "" : "s"}
              </span>
              {checklistItems.length ? (
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                  {requiredChecklistCount} required · {optionalChecklistCount} optional
                </span>
              ) : null}
            </div>
          </div>

          <div className="mt-4">
            {checklistItems.length ? (
              <TooltipProvider delayDuration={120}>
                <DndContext
                  sensors={checklistSensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleChecklistDragEnd}
                >
                  <SortableContext
                    items={checklistItems.map((item) => item.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-3">
                      {checklistItems.map((item, index) => (
                        <SortableChecklistItem
                          key={item.id}
                          item={item}
                          index={index}
                          onOpen={openChecklistEditDialog}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              </TooltipProvider>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center">
                <p className="text-base font-medium text-slate-900">No checklist items yet</p>
                <p className="mt-2 text-sm text-slate-500">
                  Add at least one requirement so the service is ready for enrollment.
                </p>
                <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-400">
                  Example items
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  ID document · Consent form · Proof of address
                </p>
              </div>
            )}
          </div>
        </div>

        <Dialog
          open={Boolean(editingChecklistItemId)}
          onOpenChange={(open) => {
            if (!open) {
              setEditingChecklistItemId(null)
            }
          }}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit checklist item</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Label</Label>
                <Input
                  value={editingChecklistDraft.label}
                  onChange={(event) =>
                    setEditingChecklistDraft((prev) => ({ ...prev, label: event.target.value }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>Description</Label>
                <Textarea
                  rows={3}
                  value={editingChecklistDraft.description}
                  onChange={(event) =>
                    setEditingChecklistDraft((prev) => ({
                      ...prev,
                      description: event.target.value,
                    }))
                  }
                />
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <Checkbox
                  checked={editingChecklistDraft.isRequired}
                  onCheckedChange={(checked) =>
                    setEditingChecklistDraft((prev) => ({
                      ...prev,
                      isRequired: checked === true,
                    }))
                  }
                />
                Required
              </label>
            </div>
            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                type="button"
                variant="destructive"
                className="cursor-pointer bg-rose-600 text-white hover:bg-rose-700"
                onClick={deleteChecklistItem}
                disabled={isChecklistSaving}
              >
                Delete item
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="cursor-pointer border-slate-200 text-slate-700 hover:bg-slate-50"
                  onClick={() => setEditingChecklistItemId(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="cursor-pointer bg-blue-950 text-white hover:bg-blue-900"
                  onClick={saveChecklistEdit}
                  disabled={isChecklistSaving}
                >
                  {isChecklistSaving ? "Saving..." : "Save changes"}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
        </TabsContent>

        <TabsContent value="follow-up-templates" className="mt-0">
      <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <h3 className="inline-flex items-center gap-2 text-lg font-semibold text-slate-900">
                <Route className="h-4 w-4 text-blue-700" />
                Follow-Up Templates
              </h3>
              <p className="text-sm text-slate-500">
                Each template defines the flow a contact will follow after purchasing this service.
              </p>
            </div>
            <Button
              asChild
              type="button"
              size="sm"
              className="bg-blue-950 text-white hover:bg-blue-900"
            >
              <Link href={`/app/${tenantSlug}/account-settings/services/${service.id}/follow-up-templates/new`}>
                Add template
              </Link>
            </Button>
          </div>
        </div>

        <div className="p-5">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-[linear-gradient(135deg,#eff6ff_0%,#f8fafc_100%)] px-4 py-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900">Template coverage</p>
              <p className="text-sm text-slate-600">
                Open any row to edit the flow builder, nodes, and path logic for this service.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-xs font-medium text-blue-700">
                {service.followUpTemplates.length} template{service.followUpTemplates.length === 1 ? "" : "s"}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                {totalTemplateNodes} nodes
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                {totalTemplateEdges} connections
              </span>
            </div>
          </div>

          <div className="mt-4">
          {service.followUpTemplates.length ? (
            <div className="overflow-auto rounded-2xl border border-slate-200">
              <Table className="[&_td]:py-3 [&_th]:h-10">
                <TableHeader className="bg-slate-50/80">
                  <TableRow>
                    <TableHead className="min-w-12 text-xs">#</TableHead>
                    <TableHead className="min-w-56 text-xs">Template</TableHead>
                    <TableHead className="min-w-36 text-xs">Nodes</TableHead>
                    <TableHead className="min-w-36 text-xs">Edges</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {service.followUpTemplates.map((template, index) => (
                    <TableRow
                      key={template.id}
                      tabIndex={0}
                      role="link"
                      aria-label={`Open ${template.name}`}
                      className="cursor-pointer transition-colors hover:bg-blue-50/50 focus-visible:bg-blue-50/50"
                      onClick={() =>
                        router.push(
                          `/app/${tenantSlug}/account-settings/services/${service.id}/follow-up-templates/${template.id}`,
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          router.push(
                            `/app/${tenantSlug}/account-settings/services/${service.id}/follow-up-templates/${template.id}`,
                          )
                        }
                      }}
                    >
                      <TableCell>
                        <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-blue-200 bg-blue-50 px-2 text-xs font-semibold text-blue-700">
                          {index + 1}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          <p className="font-medium text-slate-900">{template.name}</p>
                          <p className="text-sm text-slate-500">Open flow builder</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                          {Array.isArray(template.flowNodes) ? template.flowNodes.length : 0}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                          {Array.isArray(template.flowEdges) ? template.flowEdges.length : 0}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center">
              <p className="text-base font-medium text-slate-900">No follow-up templates yet</p>
              <p className="mt-2 text-sm text-slate-500">
                Create a template and build its workflow with React Flow.
              </p>
              <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-400">
                Common templates
              </p>
              <p className="mt-2 text-sm text-slate-500">
                Welcome sequence · Payment reminders · Post-service check-in
              </p>
              <Button
                asChild
                type="button"
                size="sm"
                className="mt-5 bg-blue-950 text-white hover:bg-blue-900"
              >
                <Link href={`/app/${tenantSlug}/account-settings/services/${service.id}/follow-up-templates/new`}>
                  Create first template
                </Link>
              </Button>
            </div>
          )}
          </div>
        </div>
      </section>
        </TabsContent>

        <TabsContent value="professionals" className="mt-0">
      <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <h3 className="inline-flex items-center gap-2 text-lg font-semibold text-slate-900">
                <Users className="h-4 w-4 text-blue-700" />
                Professionals
              </h3>
              <p className="text-sm text-slate-500">
                Internal users or external professionals that can handle this service.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              className="cursor-pointer bg-blue-950 text-white hover:bg-blue-900"
              onClick={openCreateProfessionalDialog}
              disabled={isProfessionalsSaving}
            >
              Add professional
            </Button>
          </div>
        </div>

        <div className="p-5">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-[linear-gradient(135deg,#eff6ff_0%,#f8fafc_100%)] px-4 py-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900">Service coverage</p>
              <p className="text-sm text-slate-600">
                Keep the service assignable by defining internal team members and external specialists.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-xs font-medium text-blue-700">
                {professionals.length} professional{professionals.length === 1 ? "" : "s"}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                {internalProfessionalsCount} internal
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                {externalProfessionalsCount} external
              </span>
            </div>
          </div>

          <div className="mt-4">
          {professionals.length ? (
            <TooltipProvider delayDuration={120}>
              <DndContext
                sensors={checklistSensors}
                collisionDetection={closestCenter}
                onDragEnd={handleProfessionalsDragEnd}
              >
                <SortableContext
                  items={professionals.map((entry) => entry.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ScrollArea className="min-h-[320px] max-h-[520px] rounded-2xl border border-slate-200">
                    <div className="px-4 py-4 md:px-5">
                      <Table className="[&_td]:py-3 [&_th]:h-9">
                        <TableHeader className="sticky top-0 z-10 bg-slate-50/90">
                          <TableRow>
                            <TableHead className="w-10 text-xs" />
                            <TableHead className="min-w-12 text-xs">#</TableHead>
                            <TableHead className="min-w-36 text-xs">Type</TableHead>
                            <TableHead className="min-w-48 text-xs">Name</TableHead>
                            <TableHead className="min-w-40 text-xs">Contact Number</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {professionals.map((entry, index) => {
                            const internalUser = entry.userId ? usersById.get(entry.userId) : null
                            const displayName =
                              entry.kind === "INTERNAL_USER"
                                ? internalUser?.name || internalUser?.email || "Unassigned"
                                : entry.externalProfessionalName || "Unnamed professional"

                            return (
                              <SortableProfessionalRow
                                key={entry.id}
                                entry={entry}
                                index={index}
                                displayName={displayName}
                                onOpen={openEditProfessionalDialog}
                              />
                            )
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </ScrollArea>
                </SortableContext>
              </DndContext>
            </TooltipProvider>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center">
              <p className="text-base font-medium text-slate-900">No professionals yet</p>
              <p className="mt-2 text-sm text-slate-500">Add at least one internal or external professional for this service.</p>
              <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-400">
                Common roles
              </p>
              <p className="mt-2 text-sm text-slate-500">
                Therapist · Coordinator · Technician · External consultant
              </p>
              <Button
                type="button"
                size="sm"
                className="mt-5 bg-blue-950 text-white hover:bg-blue-900"
                onClick={openCreateProfessionalDialog}
              >
                Add first professional
              </Button>
            </div>
          )}
          </div>

          {professionals.length ? (
            <div className="mt-3 border-t border-slate-200 pt-4">
              <p className="text-sm text-slate-600">
                Drag rows to control the professional order for this service.
              </p>
            </div>
          ) : null}
        </div>

        <Dialog
          open={isProfessionalDialogOpen}
          onOpenChange={(open) => {
            setIsProfessionalDialogOpen(open)
            if (!open) {
              setEditingProfessionalId(null)
            }
          }}
        >
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>
                {editingProfessionalId === null ? "Add professional" : "Edit professional"}
              </DialogTitle>
            </DialogHeader>

            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Professional type</Label>
                <Select
                  value={professionalDraft.kind}
                  onValueChange={(value) =>
                    setProfessionalDraft((prev) => ({
                      ...prev,
                      kind: value as "INTERNAL_USER" | "EXTERNAL",
                      userId: value === "INTERNAL_USER" ? prev.userId : "",
                      externalProfessionalName:
                        value === "EXTERNAL" ? prev.externalProfessionalName : "",
                      externalContact: value === "EXTERNAL" ? prev.externalContact : "",
                    }))
                  }
                >
                  <SelectTrigger className="cursor-pointer">
                    <SelectValue placeholder="Professional type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INTERNAL_USER">Internal user</SelectItem>
                    <SelectItem value="EXTERNAL">External professional</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {professionalDraft.kind === "INTERNAL_USER" ? (
                <div className="grid gap-2">
                  <Label>User</Label>
                  <Select
                    value={professionalDraft.userId || "__none__"}
                    onValueChange={(value) =>
                      setProfessionalDraft((prev) => ({
                        ...prev,
                        userId: value === "__none__" ? "" : value,
                      }))
                    }
                  >
                    <SelectTrigger className="cursor-pointer">
                      <SelectValue placeholder="Select user" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Unassigned</SelectItem>
                      {users.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.name || user.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>External professional name</Label>
                    <Input
                      value={professionalDraft.externalProfessionalName}
                      onChange={(event) =>
                        setProfessionalDraft((prev) => ({
                          ...prev,
                          externalProfessionalName: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>External contact</Label>
                    <Input
                      value={professionalDraft.externalContact}
                      onChange={(event) =>
                        setProfessionalDraft((prev) => ({
                          ...prev,
                          externalContact: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
              )}

              <div className="grid gap-2">
                <Label>Notes</Label>
                <Textarea
                  rows={3}
                  value={professionalDraft.notes}
                  onChange={(event) =>
                    setProfessionalDraft((prev) => ({ ...prev, notes: event.target.value }))
                  }
                />
              </div>
            </div>

            <DialogFooter className="gap-2 sm:justify-between">
              <div>
                {editingProfessionalId !== null ? (
                  <Button
                    type="button"
                    variant="destructive"
                    className="cursor-pointer bg-rose-600 text-white hover:bg-rose-700"
                    onClick={deleteProfessionalFromDialog}
                    disabled={isProfessionalsSaving}
                  >
                    Delete professional
                  </Button>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="cursor-pointer border-slate-200 text-slate-700 hover:bg-slate-50"
                  onClick={() => {
                    setIsProfessionalDialogOpen(false)
                    setEditingProfessionalId(null)
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="cursor-pointer bg-blue-950 text-white hover:bg-blue-900"
                  onClick={saveProfessionalDialog}
                  disabled={isProfessionalsSaving}
                >
                  {isProfessionalsSaving ? "Saving..." : "Save professional"}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
        </TabsContent>
      </Tabs>

      <div className="sticky bottom-4 z-10 flex justify-end">
        <div className="rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-lg backdrop-blur">
          <Button type="button" className="cursor-pointer" onClick={onSubmit} disabled={isSubmitting}>
          <Save className="h-4 w-4" />
          {isSubmitting ? "Saving..." : "Save service"}
          </Button>
        </div>
      </div>
    </div>
  )
}
