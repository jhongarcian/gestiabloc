"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { isAxiosError } from "axios"
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
import { GripVertical, Palette, Plus, ShieldCheck, Tag } from "lucide-react"
import { toast } from "sonner"

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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type ContactStatusConfigPanelProps = {
  tenantId: string
  configKey: "contacts" | "tasks" | "services"
}

type ContactStatus = {
  id: string
  name: string
  bgColor: string
  textColor: string
  sortOrder: number
  isActive: boolean
  isSystemDefault: boolean
}

type StatusConfigResponse = {
  ok: boolean
  configKey: "contacts" | "tasks" | "services"
  statuses: ContactStatus[]
}

const CREATE_FORM_INITIAL = {
  name: "",
  themeKey: "ocean",
}

const STATUS_THEMES = [
  { key: "emerald", label: "Emerald", bgColor: "#DCFCE7", textColor: "#166534" },
  { key: "ocean", label: "Ocean", bgColor: "#DBEAFE", textColor: "#1E3A8A" },
  { key: "slate", label: "Slate", bgColor: "#E2E8F0", textColor: "#334155" },
  { key: "amber", label: "Amber", bgColor: "#FEF3C7", textColor: "#92400E" },
  { key: "rose", label: "Rose", bgColor: "#FFE4E6", textColor: "#9F1239" },
  { key: "violet", label: "Violet", bgColor: "#EDE9FE", textColor: "#5B21B6" },
  { key: "indigo", label: "Indigo", bgColor: "#E0E7FF", textColor: "#3730A3" },
  { key: "cyan", label: "Cyan", bgColor: "#CFFAFE", textColor: "#155E75" },
  { key: "teal", label: "Teal", bgColor: "#CCFBF1", textColor: "#115E59" },
  { key: "lime", label: "Lime", bgColor: "#ECFCCB", textColor: "#3F6212" },
  { key: "orange", label: "Orange", bgColor: "#FFEDD5", textColor: "#9A3412" },
  { key: "red", label: "Red", bgColor: "#FEE2E2", textColor: "#991B1B" },
  { key: "pink", label: "Pink", bgColor: "#FCE7F3", textColor: "#9D174D" },
  { key: "fuchsia", label: "Fuchsia", bgColor: "#FAE8FF", textColor: "#86198F" },
  { key: "sky", label: "Sky", bgColor: "#E0F2FE", textColor: "#0C4A6E" },
] as const

const formatSegment = (segment: string) =>
  segment.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())

function toTranslateString(transform: { x: number; y: number } | null) {
  if (!transform) return undefined
  return `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`
}

function SortableStatusRow({
  status,
  disabled,
  isBusy,
  onToggle,
  onDelete,
}: {
  status: ContactStatus
  disabled: boolean
  isBusy: boolean
  onToggle: (id: string, isActive: boolean) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: status.id, disabled })

  return (
    <TableRow
      ref={setNodeRef}
      style={{ transform: toTranslateString(transform), transition }}
      className={cn(isDragging && "z-10 bg-slate-50/90 shadow-sm")}
    >
      <TableCell className="w-10">
        <button
          ref={setActivatorNodeRef}
          type="button"
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500",
            disabled
              ? "cursor-not-allowed opacity-50"
              : "cursor-grab hover:bg-slate-100 active:cursor-grabbing",
          )}
          aria-label={`Reorder ${status.name}`}
          disabled={disabled}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      </TableCell>
      <TableCell className="font-medium text-slate-900">{status.name}</TableCell>
      <TableCell>
        <span
          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
          style={{
            backgroundColor: status.bgColor,
            color: status.textColor,
          }}
        >
          {status.name}
        </span>
      </TableCell>
      <TableCell>
        <Badge
          variant={status.isActive ? "secondary" : "outline"}
          className={status.isActive ? "text-emerald-700" : "text-slate-500"}
        >
          {status.isActive ? "Active" : "Inactive"}
        </Badge>
      </TableCell>
      <TableCell>
        {status.isSystemDefault ? (
          <Badge variant="secondary" className="text-indigo-700">
            Default
          </Badge>
        ) : (
          <Badge variant="outline">Custom</Badge>
        )}
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={isBusy}
            className="cursor-pointer bg-blue-950 text-white hover:bg-blue-950/90"
            onClick={() => void onToggle(status.id, status.isActive)}
          >
            {status.isActive ? "Set Inactive" : "Set Active"}
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={status.isSystemDefault || isBusy}
            className="cursor-pointer bg-slate-800 text-white hover:bg-slate-900"
            onClick={() => void onDelete(status.id)}
          >
            Delete
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

export function ContactStatusConfigPanel({
  tenantId,
  configKey,
}: ContactStatusConfigPanelProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statuses, setStatuses] = useState<ContactStatus[]>([])
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [createForm, setCreateForm] = useState(CREATE_FORM_INITIAL)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const load = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const { data: response } = await api.get<StatusConfigResponse>(
        `/api/account-settings/${tenantId}/status-config/${configKey}`,
      )
      const sorted = [...response.statuses].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
      )
      setStatuses(sorted)
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        setErrorMessage(
          typeof backendError === "string"
            ? formatSegment(backendError)
            : "Could not load status configurations.",
        )
      } else {
        setErrorMessage("Could not load status configurations.")
      }
    } finally {
      setIsLoading(false)
    }
  }, [configKey, tenantId])

  useEffect(() => {
    void load()
  }, [load])

  const selectedTheme = useMemo(
    () => STATUS_THEMES.find((item) => item.key === createForm.themeKey) ?? STATUS_THEMES[0],
    [createForm.themeKey],
  )
  const activeCount = statuses.filter((item) => item.isActive).length
  const defaultCount = statuses.filter((item) => item.isSystemDefault).length
  const configLabel = configKey === "contacts" ? "Contact" : "Task"
  const configLabelPlural =
    configKey === "contacts" ? "Contact Statuses" : "Task Statuses"
  const protectedStatusesLabel =
    configKey === "contacts"
      ? "Active, Inactive, and Pending cannot be deleted."
      : "To Do, In Progress, and Completed cannot be deleted."

  const createStatus = async () => {
    const trimmedName = createForm.name.trim()
    if (!trimmedName) {
      toast.error("Status name is required.")
      return
    }

    setIsBusy(true)
    setErrorMessage(null)

    try {
      await api.post(`/api/account-settings/${tenantId}/status-config/${configKey}`, {
        name: trimmedName,
        bgColor: selectedTheme.bgColor,
        textColor: selectedTheme.textColor,
        isActive: true,
      })

      setCreateForm(CREATE_FORM_INITIAL)
      setIsCreateDialogOpen(false)
      toast.success("Status added.")
      await load()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        setErrorMessage(
          typeof backendError === "string"
            ? formatSegment(backendError)
            : "Could not add status.",
        )
      } else {
        setErrorMessage("Could not add status.")
      }
      toast.error("Could not add status.")
    } finally {
      setIsBusy(false)
    }
  }

  const toggleStatusActive = async (id: string, isActive: boolean) => {
    setIsBusy(true)
    try {
      await api.patch(`/api/account-settings/${tenantId}/status-config/${configKey}/${id}`, {
        isActive: !isActive,
      })
      await load()
    } catch (error) {
      const backendError = isAxiosError(error)
        ? error.response?.data?.error
        : undefined
      const message =
        typeof backendError === "string"
          ? formatSegment(backendError)
          : "Could not update status."
      setErrorMessage(message)
      toast.error(message)
    } finally {
      setIsBusy(false)
    }
  }

  const deleteStatus = async (id: string) => {
    setIsBusy(true)
    try {
      await api.delete(`/api/account-settings/${tenantId}/status-config/${configKey}/${id}`)
      toast.success("Status deleted.")
      await load()
    } catch (error) {
      const backendError = isAxiosError(error)
        ? error.response?.data?.error
        : undefined
      const message =
        typeof backendError === "string"
          ? formatSegment(backendError)
          : "Could not delete status."
      setErrorMessage(message)
      toast.error(message)
    } finally {
      setIsBusy(false)
    }
  }

  const persistReorder = async (reordered: ContactStatus[]) => {
    const withNewOrder = reordered.map((item, index) => ({
      ...item,
      sortOrder: (index + 1) * 10,
    }))

    setStatuses(withNewOrder)
    setIsBusy(true)
    try {
      await Promise.all(
        withNewOrder.map((item) =>
          api.patch(`/api/account-settings/${tenantId}/status-config/${configKey}/${item.id}`, {
            sortOrder: item.sortOrder,
          }),
        ),
      )
      await load()
    } catch {
      toast.error("Could not save new order.")
      await load()
    } finally {
      setIsBusy(false)
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id || isBusy) return

    const oldIndex = statuses.findIndex((item) => item.id === active.id)
    const newIndex = statuses.findIndex((item) => item.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return

    const reordered = arrayMove(statuses, oldIndex, newIndex)
    void persistReorder(reordered)
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-900">{configLabelPlural}</h2>
        <p className="text-sm text-slate-500">
          Drag and drop to reorder statuses. New statuses are added to the end of
          the list by default.
        </p>
        <div className="pt-1">
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            Defaults are protected
          </span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Total Statuses
          </p>
          <p className="mt-1 text-3xl font-semibold text-slate-900">
            {statuses.length}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Active
          </p>
          <p className="mt-1 text-3xl font-semibold text-slate-900">{activeCount}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            System Defaults
          </p>
          <p className="mt-1 text-3xl font-semibold text-slate-900">{defaultCount}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-slate-600" />
              <p className="text-base font-semibold text-slate-900">Status List</p>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {protectedStatusesLabel}
            </p>
          </div>
          <Button
            type="button"
            onClick={() => setIsCreateDialogOpen(true)}
            className="inline-flex cursor-pointer items-center gap-1.5 bg-blue-950 text-white hover:bg-blue-950/90"
          >
            <Plus className="h-4 w-4" />
            Add Status
          </Button>
        </div>

        <div className="overflow-x-auto p-5">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Preview</TableHead>
                  <TableHead>Availability</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-slate-500">
                      Loading statuses...
                    </TableCell>
                  </TableRow>
                ) : errorMessage ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-rose-600">
                      {errorMessage}
                    </TableCell>
                  </TableRow>
                ) : statuses.length ? (
                  <SortableContext
                    items={statuses.map((item) => item.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {statuses.map((status) => (
                      <SortableStatusRow
                        key={status.id}
                        status={status}
                        disabled={isBusy}
                        isBusy={isBusy}
                        onToggle={toggleStatusActive}
                        onDelete={deleteStatus}
                      />
                    ))}
                  </SortableContext>
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-slate-500">
                      No statuses found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </DndContext>
        </div>
      </div>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {configLabel} Status</DialogTitle>
            <DialogDescription>
              Choose a status name and color theme. The new status will be added to the
              end of the list.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-status-name">Status Name</Label>
              <Input
                id="new-status-name"
                value={createForm.name}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, name: event.target.value }))
                }
                placeholder="Needs Review"
              />
            </div>

            <div className="space-y-2">
              <Label className="inline-flex items-center gap-1.5">
                <Palette className="h-3.5 w-3.5 text-slate-500" />
                Color Theme
              </Label>
              <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 sm:grid-cols-5">
                {STATUS_THEMES.map((theme) => {
                  const isSelected = createForm.themeKey === theme.key
                  return (
                    <button
                      key={theme.key}
                      type="button"
                      onClick={() =>
                        setCreateForm((prev) => ({ ...prev, themeKey: theme.key }))
                      }
                      className={cn(
                        "cursor-pointer rounded-md border p-1 text-left transition",
                        isSelected
                          ? "border-slate-900 bg-white shadow-sm ring-2 ring-slate-200"
                          : "border-slate-200 bg-white hover:border-slate-400",
                      )}
                      aria-label={`Use ${theme.label} theme`}
                      title={theme.label}
                    >
                      <span
                        className="inline-flex w-full items-center justify-center rounded px-2 py-1 text-xs font-semibold"
                        style={{
                          backgroundColor: theme.bgColor,
                          color: theme.textColor,
                        }}
                      >
                        {theme.label.slice(0, 3)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Preview</Label>
              <div className="flex h-10 items-center rounded-md border border-slate-200 bg-white px-3">
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                  style={{
                    backgroundColor: selectedTheme.bgColor,
                    color: selectedTheme.textColor,
                  }}
                >
                  {createForm.name.trim() || "Status"}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void createStatus()}
              disabled={isBusy}
              className="cursor-pointer bg-blue-950 text-white hover:bg-blue-950/90"
            >
              Create Status
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
