"use client"

import { isAxiosError } from "axios"
import Link from "next/link"
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
import { AlertTriangle, CheckCircle2, GripVertical, Wrench } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type ServiceItem = {
  id: string
  name: string
  description: string | null
  basePriceCents: number
  currency: string
  allowPartialPayments: boolean
  minimumPartialPaymentCents: number | null
  isActive: boolean
  sortOrder: number
  checklistItems: Array<{ id: string }>
  followUpTemplateSteps: Array<{ id: string }>
  followUpTemplates?: Array<{ id: string }>
  professionals: Array<{ id: string }>
}

type ServicesResponse = {
  ok: boolean
  items: ServiceItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

type ServicesConfigPanelProps = {
  tenantId: string
  tenantSlug: string
}

type ServiceForm = {
  name: string
  description: string
  basePrice: string
  currency: string
  allowPartialPayments: boolean
  minimumPartialPayment: string
  isActive: boolean
}

const PAGE_SIZE_OPTIONS = [10, 25] as const

function toTranslateString(transform: { x: number; y: number } | null) {
  if (!transform) return undefined
  return `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`
}

function dollarsToCents(value: string) {
  const numericValue = Number.parseFloat(value)
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return null
  }

  return Math.round(numericValue * 100)
}

function defaultServiceForm(): ServiceForm {
  return {
    name: "",
    description: "",
    basePrice: "0.00",
    currency: "USD",
    allowPartialPayments: false,
    minimumPartialPayment: "",
    isActive: true,
  }
}

function ServiceCreateDialog({
  tenantId,
  onSaved,
}: {
  tenantId: string
  onSaved: () => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [form, setForm] = useState<ServiceForm>(defaultServiceForm())

  useEffect(() => {
    if (!open) {
      setForm(defaultServiceForm())
    }
  }, [open])

  const onSubmit = async () => {
    const basePriceCents = dollarsToCents(form.basePrice)
    if (!form.name.trim()) {
      toast.error("Service name is required.")
      return
    }

    if (basePriceCents === null) {
      toast.error("Base price must be a valid positive number.")
      return
    }

    const minimumPartialPaymentCents = form.allowPartialPayments
      ? dollarsToCents(form.minimumPartialPayment)
      : null

    if (form.allowPartialPayments && minimumPartialPaymentCents === null) {
      toast.error("Minimum partial payment must be a valid number.")
      return
    }

    if (
      form.allowPartialPayments &&
      minimumPartialPaymentCents !== null &&
      minimumPartialPaymentCents > basePriceCents
    ) {
      toast.error("Minimum partial payment cannot exceed base price.")
      return
    }

    setIsSubmitting(true)

    try {
      await api.post(`/api/account-settings/${tenantId}/services`, {
        name: form.name.trim(),
        description: form.description.trim() || null,
        basePriceCents,
        currency: form.currency.trim().toUpperCase() || "USD",
        allowPartialPayments: form.allowPartialPayments,
        minimumPartialPaymentCents,
        isActive: form.isActive,
      })

      toast.success("Service created.")
      setOpen(false)
      await onSaved()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not create service.",
        )
      } else {
        toast.error("Could not create service.")
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button">Create service</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create service</DialogTitle>
          <DialogDescription>
            Start with core billing data. Then open the service to finish checklist, follow-ups, and professionals.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Service name</Label>
            <Input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Medicare application"
            />
          </div>

          <div className="grid gap-2">
            <Label>Description</Label>
            <Textarea
              rows={3}
              value={form.description}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, description: event.target.value }))
              }
            />
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <div className="grid gap-2 md:col-span-2">
              <Label>Base price</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.basePrice}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, basePrice: event.target.value }))
                }
              />
            </div>
            <div className="grid gap-2 md:col-span-1">
              <Label>Currency</Label>
              <Input
                maxLength={3}
                value={form.currency}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, currency: event.target.value.toUpperCase() }))
                }
              />
            </div>
            <div className="grid gap-2 md:col-span-1">
              <Label>Status</Label>
              <Select
                value={form.isActive ? "active" : "inactive"}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, isActive: value === "active" }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[auto_1fr] md:items-end">
            <div className="flex items-center gap-2 pb-2">
              <input
                id="allow-partials"
                type="checkbox"
                checked={form.allowPartialPayments}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, allowPartialPayments: event.target.checked }))
                }
              />
              <Label htmlFor="allow-partials">Allow partial payments</Label>
            </div>
            <div className="grid gap-2">
              <Label>Minimum partial payment</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                disabled={!form.allowPartialPayments}
                value={form.minimumPartialPayment}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, minimumPartialPayment: event.target.value }))
                }
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={onSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create service"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SortableServiceRow({
  tenantSlug,
  service,
  isBusy,
  canReorder,
  onDelete,
}: {
  tenantSlug: string
  service: ServiceItem
  isBusy: boolean
  canReorder: boolean
  onDelete: (serviceId: string) => Promise<void>
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: service.id, disabled: isBusy || !canReorder })

  const isConfigured =
    service.checklistItems.length > 0 &&
    ((service.followUpTemplates?.length ?? 0) > 0 ||
      service.followUpTemplateSteps.length > 0) &&
    service.professionals.length > 0

  return (
    <TableRow
      ref={setNodeRef}
      style={{ transform: toTranslateString(transform), transition }}
      className={cn(isDragging && "bg-slate-50")}
    >
      <TableCell className="w-10">
        <button
          ref={setActivatorNodeRef}
          type="button"
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500",
            canReorder && !isBusy
              ? "cursor-grab hover:bg-slate-100 active:cursor-grabbing"
              : "cursor-not-allowed opacity-50",
          )}
          aria-label={`Reorder ${service.name}`}
          disabled={isBusy || !canReorder}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </TableCell>
      <TableCell className="font-medium text-slate-900">{service.name}</TableCell>
      <TableCell>
        {(service.basePriceCents / 100).toLocaleString(undefined, {
          style: "currency",
          currency: service.currency,
          minimumFractionDigits: 2,
        })}
      </TableCell>
      <TableCell>
        {service.allowPartialPayments
          ? `Partial${service.minimumPartialPaymentCents !== null ? ` (min ${(service.minimumPartialPaymentCents / 100).toFixed(2)})` : ""}`
          : "Full only"}
      </TableCell>
      <TableCell>
        {isConfigured ? (
          <span className="inline-flex items-center gap-1 text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            Complete
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-amber-700">
            <AlertTriangle className="h-4 w-4" />
            Incomplete
          </span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-2">
          <Button asChild type="button" variant="outline" size="sm">
            <Link href={`/app/${tenantSlug}/account-settings/services/${service.id}`}>
              <Wrench className="h-4 w-4" />
              Configure
            </Link>
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => {
              void onDelete(service.id)
            }}
          >
            Delete
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

export function ServicesConfigPanel({ tenantId, tenantSlug }: ServicesConfigPanelProps) {
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [isActiveFilter, setIsActiveFilter] = useState<"ALL" | "true" | "false">("ALL")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(10)
  const [isLoading, setIsLoading] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [servicesData, setServicesData] = useState<ServicesResponse | null>(null)
  const [services, setServices] = useState<ServiceItem[]>([])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query.trim())
      setPage(1)
    }, 300)

    return () => window.clearTimeout(timeout)
  }, [query])

  const loadServices = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const { data } = await api.get<ServicesResponse>(`/api/account-settings/${tenantId}/services`, {
        params: {
          page,
          pageSize,
          search: debouncedQuery || undefined,
          isActive: isActiveFilter === "ALL" ? undefined : isActiveFilter,
        },
      })
      setServicesData(data)
      setServices(
        [...data.items].sort(
          (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
        ),
      )
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        setErrorMessage(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not load services.",
        )
      } else {
        setErrorMessage("Could not load services.")
      }
    } finally {
      setIsLoading(false)
    }
  }, [tenantId, page, pageSize, debouncedQuery, isActiveFilter])

  useEffect(() => {
    void loadServices()
  }, [loadServices])

  const total = servicesData?.pagination.total ?? 0
  const totalPages = servicesData?.pagination.totalPages ?? 1
  const canReorder = page === 1 && debouncedQuery.length === 0 && isActiveFilter === "ALL"

  const summary = useMemo(() => {
    if (!total) return "No services found"
    const start = (page - 1) * pageSize + 1
    const end = start + services.length - 1
    return `Showing ${start}-${end} of ${total} services`
  }, [page, pageSize, services.length, total])

  const onDelete = async (serviceId: string) => {
    const confirmed = window.confirm(
      "Delete this service? Existing process records remain but this template will be removed.",
    )
    if (!confirmed) return

    try {
      await api.delete(`/api/account-settings/${tenantId}/services/${serviceId}`)
      toast.success("Service deleted.")
      await loadServices()
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
    }
  }

  const persistReorder = async (reordered: ServiceItem[]) => {
    const nextServices = reordered.map((service, index) => ({
      ...service,
      sortOrder: (index + 1) * 10,
    }))

    setServices(nextServices)
    setIsBusy(true)

    try {
      await Promise.all(
        nextServices.map((service) =>
          api.patch(`/api/account-settings/${tenantId}/services/${service.id}`, {
            sortOrder: service.sortOrder,
          }),
        ),
      )
      await loadServices()
    } catch {
      toast.error("Could not save service order.")
      await loadServices()
    } finally {
      setIsBusy(false)
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!canReorder || !over || active.id === over.id || isBusy) return

    const oldIndex = services.findIndex((service) => service.id === active.id)
    const newIndex = services.findIndex((service) => service.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return

    void persistReorder(arrayMove(services, oldIndex, newIndex))
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_45%,#fff7ed_100%)]">
        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1.3fr)_360px] lg:p-7">
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                Service Builder
              </p>
              <div className="space-y-3">
                <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-slate-950">
                  Create services, then finish setup across checklist, follow-ups, and professionals.
                </h2>
                <p className="max-w-2xl text-sm leading-6 text-slate-600">
                  A service starts as incomplete. Open Configure to complete each section from the dedicated tabs.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-[24px] border border-slate-300/60 bg-slate-950 p-5 text-white shadow-sm">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-200/90">
                Actions
              </p>
              <div>
                <p className="text-lg font-semibold">Services library</p>
                <p className="mt-1 text-sm leading-6 text-slate-300">
                  Keep order meaningful and use Configure to finish each service setup.
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <ServiceCreateDialog tenantId={tenantId} onSaved={loadServices} />
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
                {total} configured service{total === 1 ? "" : "s"}.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h3 className="text-xl font-semibold text-slate-950">Configured services</h3>
            <p className="text-sm text-slate-500">{summary}</p>
          </div>

          <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-[minmax(220px,1fr)_180px_auto]">
            <Input
              placeholder="Search services"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
            />
            <Select
              value={isActiveFilter}
              onValueChange={(value) => {
                setIsActiveFilter(value as "ALL" | "true" | "false")
                setPage(1)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="true">Active</SelectItem>
                <SelectItem value="false">Inactive</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setQuery("")
                setDebouncedQuery("")
                setIsActiveFilter("ALL")
                setPage(1)
              }}
            >
              Clear
            </Button>
          </div>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <div className="min-h-0 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Name</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Billing</TableHead>
                  <TableHead>Setup status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-slate-500">
                      Loading services...
                    </TableCell>
                  </TableRow>
                ) : errorMessage ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-rose-600">
                      {errorMessage}
                    </TableCell>
                  </TableRow>
                ) : services.length ? (
                  <SortableContext
                    items={services.map((service) => service.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {services.map((service) => (
                      <SortableServiceRow
                        key={service.id}
                        tenantSlug={tenantSlug}
                        service={service}
                        isBusy={isBusy}
                        canReorder={canReorder}
                        onDelete={onDelete}
                      />
                    ))}
                  </SortableContext>
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-slate-500">
                      No services configured yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </DndContext>

        <div className="flex flex-col gap-2 border-t border-slate-200 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            {canReorder ? "Drag rows to reorder." : "Clear filters and go to page 1 to reorder."}
          </p>
          <div className="flex items-center gap-2">
            <Select
              value={String(pageSize)}
              onValueChange={(value) => {
                setPageSize(Number(value) as (typeof PAGE_SIZE_OPTIONS)[number])
                setPage(1)
              }}
            >
              <SelectTrigger className="h-8 w-[96px]">
                <SelectValue placeholder="Rows" />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option} rows
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((prev) => prev - 1)}>
              Previous
            </Button>
            <span className="text-xs text-slate-500">Page {page} / {totalPages}</span>
            <Button type="button" variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((prev) => prev + 1)}>
              Next
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
