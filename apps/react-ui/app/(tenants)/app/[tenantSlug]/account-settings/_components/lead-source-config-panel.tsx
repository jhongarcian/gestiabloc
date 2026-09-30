"use client"

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { isAxiosError } from "axios"
import { GripVertical, Plus, ShieldCheck, Trash2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
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

type LeadSource = {
  id: string
  name: string
  sortOrder: number
  isSystemDefault: boolean
}

type LeadSourceConfigResponse = {
  ok: boolean
  configKey: "lead-sources"
  items: LeadSource[]
}

const formatSegment = (segment: string) =>
  segment.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())

function toTranslateString(transform: { x: number; y: number } | null) {
  if (!transform) return undefined
  return `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`
}

function ProtectedLeadSourceRow({ source }: { source: LeadSource }) {
  return (
    <TableRow>
      <TableCell className="w-10">
        <span className="inline-flex h-7 w-7 items-center justify-center text-slate-300">
          <GripVertical className="h-3.5 w-3.5" />
        </span>
      </TableCell>
      <TableCell className="font-medium text-slate-900">{source.name}</TableCell>
      <TableCell>
        <Badge variant="secondary" className="text-indigo-700">
          Default
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
          Protected
        </span>
      </TableCell>
    </TableRow>
  )
}

function SortableLeadSourceRow({
  source,
  disabled,
  onDelete,
}: {
  source: LeadSource
  disabled: boolean
  onDelete: (source: LeadSource) => Promise<void>
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: source.id, disabled })

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
          aria-label={`Reorder ${source.name}`}
          disabled={disabled}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      </TableCell>
      <TableCell className="font-medium text-slate-900">{source.name}</TableCell>
      <TableCell>
        <Badge variant="outline">Custom</Badge>
      </TableCell>
      <TableCell className="text-right">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className="cursor-pointer text-rose-700 hover:bg-rose-50 hover:text-rose-800"
          onClick={() => void onDelete(source)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      </TableCell>
    </TableRow>
  )
}

export function LeadSourceConfigPanel({ tenantId }: { tenantId: string }) {
  const [items, setItems] = useState<LeadSource[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [newSourceName, setNewSourceName] = useState("")

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const load = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const { data } = await api.get<LeadSourceConfigResponse>(
        `/api/account-settings/${tenantId}/status-config/lead-sources`,
      )
      setItems(
        [...data.items].sort(
          (left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
        ),
      )
    } catch (error) {
      const backendError = isAxiosError(error) ? error.response?.data?.error : undefined
      setErrorMessage(
        typeof backendError === "string"
          ? formatSegment(backendError)
          : "Could not load lead sources.",
      )
    } finally {
      setIsLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    void load()
  }, [load])

  const defaultSources = useMemo(
    () => items.filter((item) => item.isSystemDefault),
    [items],
  )
  const customSources = useMemo(
    () => items.filter((item) => !item.isSystemDefault),
    [items],
  )

  const createSource = async () => {
    const name = newSourceName.replace(/\s+/g, " ").trim()
    if (!name) {
      toast.error("Lead source name is required.")
      return
    }

    setIsBusy(true)
    setErrorMessage(null)
    try {
      await api.post(
        `/api/account-settings/${tenantId}/status-config/lead-sources`,
        { name },
      )
      setNewSourceName("")
      setIsCreateDialogOpen(false)
      toast.success("Lead source added.")
      await load()
    } catch (error) {
      const backendError = isAxiosError(error) ? error.response?.data?.error : undefined
      const message =
        typeof backendError === "string"
          ? formatSegment(backendError)
          : "Could not add lead source."
      setErrorMessage(message)
      toast.error(message)
    } finally {
      setIsBusy(false)
    }
  }

  const deleteSource = async (source: LeadSource) => {
    setIsBusy(true)
    setErrorMessage(null)
    try {
      await api.delete(
        `/api/account-settings/${tenantId}/status-config/lead-sources/${source.id}`,
      )
      toast.success("Lead source deleted.")
      await load()
    } catch (error) {
      const backendError = isAxiosError(error) ? error.response?.data?.error : undefined
      const contactCount = isAxiosError(error)
        ? error.response?.data?.details?.contactCount
        : undefined
      const message =
        backendError === "LEAD_SOURCE_IN_USE" && typeof contactCount === "number"
          ? `This lead source is used by ${contactCount} contact${contactCount === 1 ? "" : "s"}.`
          : typeof backendError === "string"
            ? formatSegment(backendError)
            : "Could not delete lead source."
      setErrorMessage(message)
      toast.error(message)
    } finally {
      setIsBusy(false)
    }
  }

  const persistCustomOrder = async (reordered: LeadSource[]) => {
    const nextCustomSources = reordered.map((item, index) => ({
      ...item,
      sortOrder: (index + 3) * 10,
    }))
    setItems([...defaultSources, ...nextCustomSources])
    setIsBusy(true)

    try {
      await Promise.all(
        nextCustomSources.map((item) =>
          api.patch(
            `/api/account-settings/${tenantId}/status-config/lead-sources/${item.id}`,
            { sortOrder: item.sortOrder },
          ),
        ),
      )
      await load()
    } catch {
      toast.error("Could not save the lead source order.")
      await load()
    } finally {
      setIsBusy(false)
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id || isBusy) return

    const oldIndex = customSources.findIndex((item) => item.id === active.id)
    const newIndex = customSources.findIndex((item) => item.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return

    void persistCustomOrder(arrayMove(customSources, oldIndex, newIndex))
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-900">Lead Sources</h2>
        <p className="text-sm text-slate-500">
          Control the choices available when recording how a contact became a lead.
        </p>
        <div className="pt-1">
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            Marketing and Referral are protected
          </span>
        </div>
      </div>

      {errorMessage ? (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Sources</p>
          <p className="mt-1 text-3xl font-semibold text-slate-900">{items.length}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Custom Sources</p>
          <p className="mt-1 text-3xl font-semibold text-slate-900">{customSources.length}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="font-semibold text-slate-900">Available Sources</h3>
            <p className="text-sm text-slate-500">
              Drag custom sources to reorder them. Defaults always stay first.
            </p>
          </div>
          <Button
            type="button"
            onClick={() => setIsCreateDialogOpen(true)}
            className="cursor-pointer bg-blue-950 text-white hover:bg-blue-950/90"
          >
            <Plus className="h-4 w-4" />
            Add Lead Source
          </Button>
        </div>

        <div className="overflow-x-auto p-5">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-slate-500">
                      Loading lead sources...
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {defaultSources.map((source) => (
                      <ProtectedLeadSourceRow key={source.id} source={source} />
                    ))}
                    <SortableContext
                      items={customSources.map((source) => source.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {customSources.map((source) => (
                        <SortableLeadSourceRow
                          key={source.id}
                          source={source}
                          disabled={isBusy}
                          onDelete={deleteSource}
                        />
                      ))}
                    </SortableContext>
                  </>
                )}
              </TableBody>
            </Table>
          </DndContext>
        </div>
      </div>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Lead Source</DialogTitle>
            <DialogDescription>
              Add another source that users can select on contact records.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-lead-source-name">Lead Source Name</Label>
            <Input
              id="new-lead-source-name"
              value={newSourceName}
              onChange={(event) => setNewSourceName(event.target.value)}
              placeholder="Community Event"
              maxLength={80}
            />
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
              disabled={isBusy}
              onClick={() => void createSource()}
              className="cursor-pointer bg-blue-950 text-white hover:bg-blue-950/90"
            >
              {isBusy ? "Adding..." : "Add Source"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
