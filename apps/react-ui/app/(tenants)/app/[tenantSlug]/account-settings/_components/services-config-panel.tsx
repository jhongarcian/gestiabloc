"use client"

import Link from "next/link"
import { isAxiosError } from "axios"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
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
import { ArrowRight, FolderTree, GripVertical, Layers, Plus } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
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

export type ParentService = { id: string; name: string; isActive: boolean }
type ServiceItem = {
  id: string
  kind: "GROUP" | "OFFERING"
  parentServiceId: string | null
  name: string
  description: string | null
  basePriceCents: number
  currency: string
  isActive: boolean
  sortOrder: number
  _count: { subServices: number }
  checklistItems: Array<{ id: string }>
  followUpTemplateSteps: Array<{ id: string }>
  followUpTemplates?: Array<{ id: string }>
  professionals: Array<{ id: string }>
}
type ServicesResponse = {
  items: ServiceItem[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

const errorText = (error: unknown, fallback: string) => {
  const code = isAxiosError(error) ? error.response?.data?.error : null
  return code === "SERVICE_NAME_ALREADY_EXISTS"
    ? "That name is already used in this account."
    : typeof code === "string"
      ? code.replace(/_/g, " ")
      : fallback
}

function ServiceCreateDialog({
  tenantId,
  parentService,
  onCreated,
}: {
  tenantId: string
  parentService?: ParentService
  onCreated: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const saving = useRef(false)
  const label = parentService ? "sub-service" : "service"

  const save = async () => {
    if (saving.current) return
    if (!name.trim()) return toast.error("Enter a name.")
    saving.current = true
    setIsSaving(true)
    try {
      const { data } = await api.post<{ service: { id: string } }>(
        `/api/account-settings/${tenantId}/services`,
        {
          name: name.trim(),
          description: description.trim() || null,
          kind: parentService ? "OFFERING" : "GROUP",
          parentServiceId: parentService?.id ?? null,
          basePriceCents: 0,
          isActive: true,
        },
      )
      toast.success(parentService ? "Sub-service created." : "Service created.")
      setOpen(false)
      onCreated(data.service.id)
    } catch (error) {
      toast.error(errorText(error, `Could not create ${label}.`))
    } finally {
      saving.current = false
      setIsSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (saving.current) return
        setOpen(value)
        if (!value) {
          setName("")
          setDescription("")
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus data-icon="inline-start" />
          Create {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create {label}</DialogTitle>
          <DialogDescription>
            {parentService
              ? `Add an offering under ${parentService.name}. Contacts will enroll into this sub-service.`
              : "Create a parent service such as Medicare, then add the sub-services contacts can enroll into."}
          </DialogDescription>
        </DialogHeader>
        <fieldset disabled={isSaving}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="service-create-name">
                {parentService ? "Sub-service name" : "Service name"}
              </FieldLabel>
              <Input
                id="service-create-name"
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={parentService ? "Medicare Advantage" : "Medicare"}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="service-create-description">Description</FieldLabel>
              <Textarea
                id="service-create-description"
                maxLength={2000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
              />
            </Field>
            {parentService ? (
              <p className="text-sm leading-6 text-muted-foreground">
                Billing, checklist, and professionals start with {parentService.name}’s settings.
                You can customize each section after creating this sub-service.
              </p>
            ) : null}
          </FieldGroup>
        </fieldset>
        <DialogFooter>
          <Button variant="outline" disabled={isSaving} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={isSaving} onClick={save}>
            {isSaving ? "Creating..." : `Create ${label}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ServiceRow({
  service,
  href,
  isBusy,
  canReorder,
}: {
  service: ServiceItem
  href: string
  isBusy: boolean
  canReorder: boolean
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
  const isGroup = service.kind === "GROUP"
  const ready =
    service.checklistItems.length > 0 &&
    service.professionals.length > 0 &&
    ((service.followUpTemplates?.length ?? 0) > 0 || service.followUpTemplateSteps.length > 0)
  return (
    <TableRow
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "bg-muted")}
    >
      <TableCell className="w-12">
        <Button
          ref={setActivatorNodeRef}
          variant="ghost"
          size="icon"
          aria-label={`Reorder ${service.name}`}
          disabled={isBusy || !canReorder}
          {...attributes}
          {...listeners}
        >
          <GripVertical />
        </Button>
      </TableCell>
      <TableCell className="min-w-48">
        <Link href={href} className="flex items-center gap-3 py-2 font-medium hover:underline">
          {isGroup ? (
            <FolderTree aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
          ) : (
            <Layers aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
          )}
          <span>
            {service.name}
            {service.description ? (
              <span className="mt-1 block max-w-md truncate text-sm font-normal text-muted-foreground">
                {service.description}
              </span>
            ) : null}
          </span>
        </Link>
      </TableCell>
      <TableCell>
        {isGroup
          ? `${service._count.subServices} sub-service${service._count.subServices === 1 ? "" : "s"}`
          : (service.basePriceCents / 100).toLocaleString(undefined, {
              style: "currency",
              currency: service.currency,
            })}
      </TableCell>
      <TableCell>
        <Badge variant={service.isActive ? "secondary" : "outline"}>
          {service.isActive ? "Active" : "Inactive"}
        </Badge>
      </TableCell>
      {!isGroup ? (
        <TableCell>
          <Badge variant={ready ? "secondary" : "outline"}>
            {ready ? "Ready" : "Setup needed"}
          </Badge>
        </TableCell>
      ) : null}
      <TableCell className="text-right">
        <Button asChild variant="ghost" size="icon">
          <Link href={href} aria-label={`Open ${service.name}`}>
            <ArrowRight />
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  )
}

export function ServicesConfigPanel({
  tenantId,
  tenantSlug,
  parentService,
}: {
  tenantId: string
  tenantSlug: string
  parentService?: ParentService
}) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("ALL")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [data, setData] = useState<ServicesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)
  const reordering = useRef(false)
  const parentId = parentService?.id
  const title = parentService ? "Sub-services" : "Services"
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  useEffect(() => {
    const id = window.setTimeout(() => {
      setSearch(query.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(id)
  }, [query])
  const load = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const result = await api.get<ServicesResponse>(`/api/account-settings/${tenantId}/services`, {
        params: {
          kind: parentId ? "OFFERING" : "GROUP",
          parentServiceId: parentId,
          page,
          pageSize,
          search: search || undefined,
          isActive: status === "ALL" ? undefined : status,
        },
      })
      if (id !== requestId.current) return
      if (page > result.data.pagination.totalPages) {
        setPage(result.data.pagination.totalPages)
        return
      }
      setData(result.data)
    } catch (error) {
      if (id === requestId.current) setError(errorText(error, "Could not load services."))
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [tenantId, parentId, page, pageSize, search, status])
  useEffect(() => {
    void load()
  }, [load])
  const items = data?.items ?? []
  const total = data?.pagination.total ?? 0
  const totalPages = data?.pagination.totalPages ?? 1
  const canReorder = total <= pageSize && !search && status === "ALL"
  const reorder = async ({ active, over }: DragEndEvent) => {
    if (reordering.current || loading || !canReorder || !over || active.id === over.id) return
    const from = items.findIndex((item) => item.id === active.id)
    const to = items.findIndex((item) => item.id === over.id)
    if (from < 0 || to < 0) return
    reordering.current = true
    setBusy(true)
    const reordered = arrayMove(items, from, to)
    setData((current) => (current ? { ...current, items: reordered } : current))
    try {
      await Promise.all(
        reordered.map((item, index) =>
          api.patch(`/api/account-settings/${tenantId}/services/${item.id}`, {
            sortOrder: (index + 1) * 10,
          }),
        ),
      )
    } catch (error) {
      toast.error(errorText(error, "Could not save service order."))
    } finally {
      await load()
      reordering.current = false
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="flex flex-col gap-2">
          {!parentService ? (
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Service catalog
            </p>
          ) : null}
          <h2
            className={cn("font-semibold tracking-tight", parentService ? "text-xl" : "text-3xl")}
          >
            {title}
          </h2>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">
            {parentService
              ? `Choose an offering under ${parentService.name} to configure its billing, checklist, follow-ups, and professionals.`
              : "Organize your offerings by service. Open a parent service to create and manage the sub-services contacts enroll into."}
          </p>
        </div>
        <ServiceCreateDialog
          tenantId={tenantId}
          parentService={parentService}
          onCreated={(id) => router.push(`/app/${tenantSlug}/account-settings/services/${id}`)}
        />
      </div>
      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>{parentService ? "Offerings" : "Parent services"}</CardTitle>
              <CardDescription>
                {total} {parentService ? "sub-service" : "service"}
                {total === 1 ? "" : "s"}
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                aria-label={`Search ${title.toLowerCase()}`}
                placeholder={
                  parentService ? "Search sub-services" : "Search services or sub-services"
                }
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="sm:w-64"
              />
              <Select
                value={status}
                onValueChange={(value) => {
                  setStatus(value)
                  setPage(1)
                }}
              >
                <SelectTrigger aria-label="Service status filter" className="sm:w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="ALL">All statuses</SelectItem>
                    <SelectItem value="true">Active</SelectItem>
                    <SelectItem value="false">Inactive</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorder}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <span className="sr-only">Order</span>
                  </TableHead>
                  <TableHead>{parentService ? "Sub-service" : "Service"}</TableHead>
                  <TableHead>{parentService ? "Price" : "Offerings"}</TableHead>
                  <TableHead>Status</TableHead>
                  {parentService ? <TableHead>Setup</TableHead> : null}
                  <TableHead>
                    <span className="sr-only">Open</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell
                      colSpan={parentService ? 6 : 5}
                      className="py-12 text-center text-muted-foreground"
                    >
                      Loading {title.toLowerCase()}...
                    </TableCell>
                  </TableRow>
                ) : error ? (
                  <TableRow>
                    <TableCell colSpan={parentService ? 6 : 5} className="py-12 text-center">
                      <p role="alert" className="text-destructive">
                        {error}
                      </p>
                      <Button variant="outline" className="mt-3" onClick={load}>
                        Try again
                      </Button>
                    </TableCell>
                  </TableRow>
                ) : items.length ? (
                  <SortableContext
                    items={items.map((item) => item.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {items.map((service) => (
                      <ServiceRow
                        key={service.id}
                        service={service}
                        href={`/app/${tenantSlug}/account-settings/services/${service.id}`}
                        isBusy={busy || loading}
                        canReorder={canReorder}
                      />
                    ))}
                  </SortableContext>
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={parentService ? 6 : 5}
                      className="py-12 text-center text-muted-foreground"
                    >
                      {search || status !== "ALL"
                        ? "No matching services. Try another search or status."
                        : parentService
                          ? "No sub-services yet. Create the first offering for this service."
                          : "Create your first service to start organizing your offerings."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </DndContext>
          <div className="mt-4 flex flex-col justify-between gap-3 border-t pt-4 text-xs text-muted-foreground sm:flex-row sm:items-center">
            <p>
              {canReorder
                ? "Drag to reorder within this list."
                : "Show all rows and clear filters to reorder."}
            </p>
            <div className="flex items-center gap-2">
              <Select
                value={String(pageSize)}
                onValueChange={(value) => {
                  setPageSize(Number(value))
                  setPage(1)
                }}
              >
                <SelectTrigger aria-label="Rows per page" className="h-8 w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="10">10 rows</SelectItem>
                    <SelectItem value="25">25 rows</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1 || loading || busy}
                onClick={() => setPage((value) => value - 1)}
              >
                Previous
              </Button>
              <span>
                {page} / {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages || loading || busy}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
