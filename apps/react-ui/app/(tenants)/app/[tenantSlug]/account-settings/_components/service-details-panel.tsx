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
  GripVertical,
  Route,
  Save,
  UserRoundCog,
  Users,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
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

export type ServiceDetailsPanelProps = {
  tenantId: string
  tenantSlug: string
  service: {
    id: string
    name: string
    description: string | null
    basePriceCents: number
    currency: string
    allowPartialPayments: boolean
    minimumPartialPaymentCents: number | null
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
    configStatus: {
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
  kind: "INTERNAL_USER" | "EXTERNAL"
  userId: string
  externalProfessionalName: string
  externalContact: string
  notes: string
}

const PROFESSIONALS_PAGE_SIZE_OPTIONS = [10, 25] as const

function SortableChecklistItem({
  item,
  onOpen,
}: {
  item: ChecklistItemDraft
  onOpen: (item: ChecklistItemDraft) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: item.id,
  })

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 active:cursor-grabbing"
          aria-label={`Reorder ${item.label || "checklist item"}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onOpen(item)}
          className="flex min-w-0 flex-1 cursor-pointer items-center justify-between rounded-lg border border-transparent px-2 py-2 text-left hover:border-slate-200 hover:bg-white"
        >
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
          </div>
          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600">
            {item.isRequired ? "Required" : "Optional"}
          </span>
        </button>
      </div>
    </article>
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

export function ServiceDetailsPanel({ tenantId, tenantSlug, service }: ServiceDetailsPanelProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
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
  const [basePrice, setBasePrice] = useState(centsToDollars(service.basePriceCents))
  const [currency, setCurrency] = useState(service.currency)
  const [allowPartialPayments, setAllowPartialPayments] = useState(service.allowPartialPayments)
  const [minimumPartialPayment, setMinimumPartialPayment] = useState(
    service.minimumPartialPaymentCents !== null
      ? centsToDollars(service.minimumPartialPaymentCents)
      : "",
  )
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
      kind: entry.kind,
      userId: entry.userId ?? "",
      externalProfessionalName: entry.externalProfessionalName ?? "",
      externalContact: entry.externalContact ?? "",
      notes: entry.notes ?? "",
    })),
  )
  const [editingProfessionalIndex, setEditingProfessionalIndex] = useState<number | null>(null)
  const [isProfessionalDialogOpen, setIsProfessionalDialogOpen] = useState(false)
  const [professionalsPage, setProfessionalsPage] = useState(1)
  const [professionalsPageSize, setProfessionalsPageSize] = useState<
    (typeof PROFESSIONALS_PAGE_SIZE_OPTIONS)[number]
  >(10)
  const [professionalDraft, setProfessionalDraft] = useState<ProfessionalDraft>({
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
  const followUpsComplete =
    service.followUpTemplates.length > 0 || service.followUpTemplateSteps.length > 0
  const professionalsComplete = professionals.length > 0
  const professionalsTotalPages = Math.max(
    1,
    Math.ceil(professionals.length / professionalsPageSize),
  )
  const professionalsPageStart = (professionalsPage - 1) * professionalsPageSize
  const paginatedProfessionals = professionals.slice(
    professionalsPageStart,
    professionalsPageStart + professionalsPageSize,
  )
  const usersById = useMemo(
    () => new Map(users.map((user) => [user.id, user])),
    [users],
  )

  const isComplete = useMemo(
    () => checklistComplete && followUpsComplete && professionalsComplete,
    [checklistComplete, followUpsComplete, professionalsComplete],
  )

  useEffect(() => {
    if (professionalsPage > professionalsTotalPages) {
      setProfessionalsPage(professionalsTotalPages)
    }
  }, [professionalsPage, professionalsTotalPages])

  const persistChecklistItems = useCallback(
    async (nextItems: ChecklistItemDraft[]) => {
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
      }
    },
    [tenantId, service.id],
  )

  const handleChecklistDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return

      setChecklistItems((prev) => {
        const oldIndex = prev.findIndex((item) => item.id === active.id)
        const newIndex = prev.findIndex((item) => item.id === over.id)
        if (oldIndex < 0 || newIndex < 0) return prev
        const next = arrayMove(prev, oldIndex, newIndex)
        void persistChecklistItems(next)
        return next
      })
    },
    [persistChecklistItems],
  )

  const addChecklistItemFromDialog = () => {
    if (!checklistDraft.label.trim()) {
      toast.error("Checklist item label is required.")
      return
    }

    setChecklistItems((prev) => {
      const next = [
        ...prev,
        {
          id: `new-${Date.now()}-${Math.round(Math.random() * 1000)}`,
          label: checklistDraft.label.trim(),
          description: checklistDraft.description.trim(),
          isRequired: checklistDraft.isRequired,
        },
      ]
      void persistChecklistItems(next)
      return next
    })

    setChecklistDraft({ label: "", description: "", isRequired: true })
    setIsChecklistDialogOpen(false)
  }

  const openCreateProfessionalDialog = () => {
    setEditingProfessionalIndex(null)
    setProfessionalDraft({
      kind: "INTERNAL_USER",
      userId: "",
      externalProfessionalName: "",
      externalContact: "",
      notes: "",
    })
    setIsProfessionalDialogOpen(true)
  }

  const openEditProfessionalDialog = (index: number) => {
    const entry = professionals[index]
    if (!entry) return
    setEditingProfessionalIndex(index)
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

    if (editingProfessionalIndex === null) {
      setProfessionals((prev) => [...prev, { ...professionalDraft }])
    } else {
      setProfessionals((prev) => {
        const next = [...prev]
        next[editingProfessionalIndex] = { ...professionalDraft }
        return next
      })
    }

    setIsProfessionalDialogOpen(false)
    setEditingProfessionalIndex(null)
  }

  const deleteProfessionalFromDialog = () => {
    if (editingProfessionalIndex === null) return
    setProfessionals((prev) => prev.filter((_, rowIndex) => rowIndex !== editingProfessionalIndex))
    setIsProfessionalDialogOpen(false)
    setEditingProfessionalIndex(null)
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

    setChecklistItems((prev) => {
      const next = prev.map((item) =>
        item.id === editingChecklistItemId
          ? {
              ...item,
              label: editingChecklistDraft.label.trim(),
              description: editingChecklistDraft.description.trim(),
              isRequired: editingChecklistDraft.isRequired,
            }
          : item,
      )
      void persistChecklistItems(next)
      return next
    })
    setEditingChecklistItemId(null)
  }

  const deleteChecklistItem = () => {
    if (!editingChecklistItemId) return
    setChecklistItems((prev) => {
      const next = prev.filter((item) => item.id !== editingChecklistItemId)
      void persistChecklistItems(next)
      return next
    })
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

    if (allowPartialPayments && minimumPartialPaymentCents === null) {
      toast.error("Minimum partial payment must be a valid number.")
      return
    }

    if (
      allowPartialPayments &&
      minimumPartialPaymentCents !== null &&
      minimumPartialPaymentCents > basePriceCents
    ) {
      toast.error("Minimum partial payment cannot exceed base price.")
      return
    }

    setIsSubmitting(true)

    try {
      await api.patch(`/api/account-settings/${tenantId}/services/${service.id}`, {
        name: name.trim(),
        description: description.trim() || null,
        basePriceCents,
        currency: currency.trim().toUpperCase() || "USD",
        allowPartialPayments,
        minimumPartialPaymentCents,
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

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_45%,#fff7ed_100%)] p-5 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Service Setup</p>
            <h2 className="text-2xl font-semibold text-slate-950">{service.name}</h2>
            <p className="text-sm text-slate-600">
              Configure core details, checklist, professionals, and follow-up template from one place.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isComplete ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                Complete
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                <AlertTriangle className="h-4 w-4" />
                Incomplete
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-[20px] border border-slate-200 bg-white p-5">
        <h3 className="text-lg font-semibold text-slate-900">Core Settings</h3>
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
              <Input type="number" min={0} step="0.01" value={basePrice} onChange={(event) => setBasePrice(event.target.value)} />
            </div>
            <div className="grid gap-2 md:col-span-1">
              <Label>Currency</Label>
              <Input maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
            </div>
            <div className="grid gap-2 md:col-span-1">
              <Label>Status</Label>
              <select
                className="h-10 rounded-md border border-slate-200 px-3"
                value={isActive ? "active" : "inactive"}
                onChange={(event) => setIsActive(event.target.value === "active")}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[auto_1fr] md:items-end">
            <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={allowPartialPayments}
                onChange={(event) => setAllowPartialPayments(event.target.checked)}
              />
              Allow partial payments
            </label>
            <div className="grid gap-2">
              <Label>Minimum partial payment</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                disabled={!allowPartialPayments}
                value={minimumPartialPayment}
                onChange={(event) => setMinimumPartialPayment(event.target.value)}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[20px] border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">Checklist</h3>
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
              <Button type="button" variant="outline" size="sm">
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
                  <input
                    type="checkbox"
                    checked={checklistDraft.isRequired}
                    onChange={(event) =>
                      setChecklistDraft((prev) => ({
                        ...prev,
                        isRequired: event.target.checked,
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
                  onClick={() => {
                    setIsChecklistDialogOpen(false)
                    setChecklistDraft({ label: "", description: "", isRequired: true })
                  }}
                >
                  Cancel
                </Button>
                <Button type="button" onClick={addChecklistItemFromDialog}>
                  Add checklist item
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="mt-4 space-y-2">
          <p className="text-xs text-slate-500">Drag items to reorder the checklist workflow.</p>
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
                  <div className="space-y-2">
                    {checklistItems.map((item) => (
                      <SortableChecklistItem
                        key={item.id}
                        item={item}
                        onOpen={openChecklistEditDialog}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </TooltipProvider>
          ) : (
            <p className="text-sm text-amber-700">No checklist items yet. Add at least one to complete this section.</p>
          )}
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
                <input
                  type="checkbox"
                  checked={editingChecklistDraft.isRequired}
                  onChange={(event) =>
                    setEditingChecklistDraft((prev) => ({
                      ...prev,
                      isRequired: event.target.checked,
                    }))
                  }
                />
                Required
              </label>
            </div>
            <DialogFooter className="gap-2 sm:justify-between">
              <Button type="button" variant="destructive" onClick={deleteChecklistItem}>
                Delete item
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingChecklistItemId(null)}
                >
                  Cancel
                </Button>
                <Button type="button" onClick={saveChecklistEdit}>
                  Save changes
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>

      <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900 inline-flex items-center gap-2">
              <Route className="h-4 w-4" />
              Follow-Up Templates
            </h3>
            <Button asChild type="button" size="sm" variant="outline">
              <Link href={`/app/${tenantSlug}/account-settings/services/${service.id}/follow-up-templates/new`}>
                Add template
              </Link>
            </Button>
          </div>
        </div>

        <div className="p-5">
          {service.followUpTemplates.length ? (
            <div className="overflow-auto">
              <Table className="[&_td]:py-2 [&_th]:h-8">
                <TableHeader>
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
                      className="cursor-pointer transition-colors hover:bg-slate-50 focus-visible:bg-slate-50"
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
                      <TableCell>{index + 1}</TableCell>
                      <TableCell className="font-medium text-slate-900">{template.name}</TableCell>
                      <TableCell>{Array.isArray(template.flowNodes) ? template.flowNodes.length : 0}</TableCell>
                      <TableCell>{Array.isArray(template.flowEdges) ? template.flowEdges.length : 0}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <p className="text-base font-medium text-slate-900">No follow-up templates yet</p>
              <p className="mt-2 text-sm text-slate-500">
                Create a template and build its workflow with React Flow.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900 inline-flex items-center gap-2">
              <Users className="h-4 w-4" />
              Professionals
            </h3>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={openCreateProfessionalDialog}
            >
              Add professional
            </Button>
          </div>
        </div>

        <div className="p-5">
          {professionals.length ? (
            <TooltipProvider delayDuration={120}>
            <div className="min-h-[360px] max-h-[480px] overflow-auto px-4 py-4 md:px-5">
              <Table className="[&_td]:py-2 [&_th]:h-8">
                <TableHeader className="sticky top-0 z-10 bg-white">
                  <TableRow>
                    <TableHead className="min-w-12 text-xs">#</TableHead>
                    <TableHead className="min-w-36 text-xs">Type</TableHead>
                    <TableHead className="min-w-48 text-xs">Professional</TableHead>
                    <TableHead className="min-w-48 text-xs">Contact</TableHead>
                    <TableHead className="min-w-56 text-xs">Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedProfessionals.map((entry, rowIndex) => {
                    const absoluteIndex = professionalsPageStart + rowIndex
                    const internalUser = entry.userId ? usersById.get(entry.userId) : null

                    return (
                    <TableRow
                      key={`${entry.kind}-${absoluteIndex}`}
                      className="cursor-pointer transition-colors hover:bg-slate-50"
                      tabIndex={0}
                      role="button"
                      aria-label="Edit professional"
                      onClick={() => openEditProfessionalDialog(absoluteIndex)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          openEditProfessionalDialog(absoluteIndex)
                        }
                      }}
                    >
                      <TableCell>{absoluteIndex + 1}</TableCell>
                      <TableCell>{entry.kind === "INTERNAL_USER" ? "Internal user" : "External professional"}</TableCell>
                      <TableCell>
                        {entry.kind === "INTERNAL_USER"
                          ? internalUser?.name || internalUser?.email || "Unassigned"
                          : entry.externalProfessionalName || "Unnamed professional"}
                      </TableCell>
                      <TableCell>
                        {entry.kind === "INTERNAL_USER"
                          ? internalUser?.email || "-"
                          : entry.externalContact || "-"}
                      </TableCell>
                      <TableCell className="max-w-[320px] truncate text-slate-600">
                        {entry.notes ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-block max-w-[320px] truncate">{entry.notes}</span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-sm leading-5">
                              {entry.notes}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                    </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            </TooltipProvider>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <p className="text-base font-medium text-slate-900">No professionals yet</p>
              <p className="mt-2 text-sm text-slate-500">Add at least one internal or external professional for this service.</p>
            </div>
          )}

          {professionals.length ? (
            <div className="mt-3 flex flex-col gap-3 border-t border-slate-200 px-5 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-600">
                Showing {professionalsPageStart + 1}-
                {Math.min(professionalsPageStart + professionalsPageSize, professionals.length)} of{" "}
                {professionals.length} professionals
              </p>
              <div className="flex items-center gap-2">
                <Select
                  value={String(professionalsPageSize)}
                  onValueChange={(value) => {
                    const next = Number(value)
                    if (next === 10 || next === 25) {
                      setProfessionalsPageSize(next)
                      setProfessionalsPage(1)
                    }
                  }}
                >
                  <SelectTrigger className="h-8 w-[96px]">
                    <SelectValue placeholder="Rows" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROFESSIONALS_PAGE_SIZE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={String(option)}>
                        {option} rows
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={professionalsPage <= 1}
                  onClick={() => setProfessionalsPage((prev) => prev - 1)}
                >
                  Previous
                </Button>
                <span className="text-xs text-slate-500">
                  Page {professionalsPage} / {professionalsTotalPages}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={professionalsPage >= professionalsTotalPages}
                  onClick={() => setProfessionalsPage((prev) => prev + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <Dialog
          open={isProfessionalDialogOpen}
          onOpenChange={(open) => {
            setIsProfessionalDialogOpen(open)
            if (!open) {
              setEditingProfessionalIndex(null)
            }
          }}
        >
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>
                {editingProfessionalIndex === null ? "Add professional" : "Edit professional"}
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
                  <SelectTrigger>
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
                    <SelectTrigger>
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
                {editingProfessionalIndex !== null ? (
                  <Button type="button" variant="destructive" onClick={deleteProfessionalFromDialog}>
                    Delete professional
                  </Button>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsProfessionalDialogOpen(false)
                    setEditingProfessionalIndex(null)
                  }}
                >
                  Cancel
                </Button>
                <Button type="button" onClick={saveProfessionalDialog}>
                  Save professional
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>

      <section className="rounded-[20px] border border-slate-200 bg-white p-5">
        <h3 className="text-lg font-semibold text-slate-900">Configuration Progress</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className={cn("rounded-lg border p-3", checklistComplete ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50")}>
            <p className="text-sm font-medium">Checklist</p>
            <p className="mt-1 text-xs text-slate-600">{checklistComplete ? "Complete" : "Incomplete"}</p>
          </div>
          <div className={cn("rounded-lg border p-3", followUpsComplete ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50")}>
            <p className="inline-flex items-center gap-1 text-sm font-medium"><Route className="h-4 w-4" /> Follow Ups</p>
            <p className="mt-1 text-xs text-slate-600">{followUpsComplete ? "Complete" : "Incomplete"}</p>
          </div>
          <div className={cn("rounded-lg border p-3", professionalsComplete ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50")}>
            <p className="inline-flex items-center gap-1 text-sm font-medium"><UserRoundCog className="h-4 w-4" /> Professionals</p>
            <p className="mt-1 text-xs text-slate-600">{professionalsComplete ? "Complete" : "Incomplete"}</p>
          </div>
        </div>

        <p className="mt-4 text-sm text-slate-600">
          Professionals tab is a summary view. Configuration happens in this service detail page.
          {" "}
          <Link href={`/app/${tenantSlug}/account-settings/professionals`} className="text-blue-700 hover:underline">
            Open professionals summary
          </Link>
          .
        </p>
      </section>

      <div className="flex items-center justify-end">
        <Button type="button" onClick={onSubmit} disabled={isSubmitting}>
          <Save className="h-4 w-4" />
          {isSubmitting ? "Saving..." : "Save service"}
        </Button>
      </div>
    </div>
  )
}
