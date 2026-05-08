"use client"

import { isAxiosError } from "axios"
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
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { GripVertical, Pencil, Plus, Target, Trash2 } from "lucide-react"
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

type OpportunitiesConfigPanelProps = {
  tenantId: string
}

type OpportunityStage = {
  id: string
  name: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

type OpportunityPipeline = {
  id: string
  name: string
  color: string
  sortOrder: number
  createdAt: string
  updatedAt: string
  stages: OpportunityStage[]
}

type OpportunitiesResponse = {
  ok: boolean
  pipelines: OpportunityPipeline[]
}

type EditableStage = {
  id: string | null
  clientId: string
  name: string
}

type PipelineFormState = {
  name: string
  color: string
  stages: EditableStage[]
}

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/

const PIPELINE_COLOR_PRESETS = [
  "#1D4ED8",
  "#0F766E",
  "#7C3AED",
  "#BE123C",
  "#C2410C",
  "#0F172A",
  "#047857",
  "#B45309",
  "#4F46E5",
  "#0369A1",
] as const

function createStage(name = "", id: string | null = null): EditableStage {
  return {
    id,
    clientId:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `stage-${Math.random().toString(36).slice(2)}`,
    name,
  }
}

function defaultFormState(): PipelineFormState {
  return {
    name: "",
    color: PIPELINE_COLOR_PRESETS[0],
    stages: [createStage()],
  }
}

function buildFormFromPipeline(pipeline: OpportunityPipeline): PipelineFormState {
  return {
    name: pipeline.name,
    color: pipeline.color,
    stages:
      pipeline.stages.length > 0
        ? pipeline.stages.map((stage) => createStage(stage.name, stage.id))
        : [createStage()],
  }
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function formatErrorMessage(error: unknown, fallback: string) {
  if (!isAxiosError(error)) {
    return fallback
  }

  const backendError = error.response?.data?.error
  if (typeof backendError !== "string") {
    return fallback
  }

  return backendError
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function toTranslateString(transform: { x: number; y: number } | null) {
  if (!transform) return undefined
  return `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`
}

function SortableStageRow({
  disabled,
  isOnlyStage,
  onChange,
  onRemove,
  stage,
}: {
  disabled: boolean
  isOnlyStage: boolean
  onChange: (clientId: string, name: string) => void
  onRemove: (clientId: string) => void
  stage: EditableStage
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stage.clientId, disabled })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: toTranslateString(transform), transition }}
      className={cn(
        "flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3",
        isDragging && "z-10 shadow-sm",
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={`Reorder ${stage.name || "stage"}`}
        disabled={disabled}
        className={cn(
          "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500",
          disabled
            ? "cursor-not-allowed opacity-50"
            : "cursor-grab hover:bg-slate-100 active:cursor-grabbing",
        )}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <Input
        value={stage.name}
        onChange={(event) => onChange(stage.clientId, event.target.value)}
        placeholder="Stage name"
        disabled={disabled}
      />

      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={disabled || isOnlyStage}
        onClick={() => onRemove(stage.clientId)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  )
}

export function OpportunitiesConfigPanel({
  tenantId,
}: OpportunitiesConfigPanelProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [pipelines, setPipelines] = useState<OpportunityPipeline[]>([])
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingPipeline, setEditingPipeline] = useState<OpportunityPipeline | null>(null)
  const [form, setForm] = useState<PipelineFormState>(defaultFormState)

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
      const { data } = await api.get<OpportunitiesResponse>(
        `/api/account-settings/${tenantId}/opportunities`,
      )
      const sorted = [...data.pipelines].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
      )
      setPipelines(sorted)
    } catch (error) {
      setErrorMessage(formatErrorMessage(error, "Could not load opportunity pipelines."))
    } finally {
      setIsLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    void load()
  }, [load])

  const stageCount = useMemo(
    () => pipelines.reduce((total, pipeline) => total + pipeline.stages.length, 0),
    [pipelines],
  )

  const openCreateDialog = () => {
    setEditingPipeline(null)
    setForm(defaultFormState())
    setIsDialogOpen(true)
  }

  const openEditDialog = (pipeline: OpportunityPipeline) => {
    setEditingPipeline(pipeline)
    setForm(buildFormFromPipeline(pipeline))
    setIsDialogOpen(true)
  }

  const closeDialog = (open: boolean) => {
    setIsDialogOpen(open)
    if (!open) {
      setEditingPipeline(null)
      setForm(defaultFormState())
    }
  }

  const handleStageChange = (clientId: string, name: string) => {
    setForm((prev) => ({
      ...prev,
      stages: prev.stages.map((stage) =>
        stage.clientId === clientId ? { ...stage, name } : stage,
      ),
    }))
  }

  const handleStageRemove = (clientId: string) => {
    setForm((prev) => {
      if (prev.stages.length === 1) {
        toast.error("At least one stage is required.")
        return prev
      }

      return {
        ...prev,
        stages: prev.stages.filter((stage) => stage.clientId !== clientId),
      }
    })
  }

  const handleStageDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (!over || active.id === over.id) {
      return
    }

    setForm((prev) => {
      const oldIndex = prev.stages.findIndex((stage) => stage.clientId === active.id)
      const newIndex = prev.stages.findIndex((stage) => stage.clientId === over.id)

      if (oldIndex === -1 || newIndex === -1) {
        return prev
      }

      return {
        ...prev,
        stages: arrayMove(prev.stages, oldIndex, newIndex),
      }
    })
  }

  const handleSave = async () => {
    const trimmedName = form.name.trim()
    const trimmedStages = form.stages.map((stage) => ({
      ...stage,
      name: stage.name.trim(),
    }))

    if (!trimmedName) {
      toast.error("Pipeline name is required.")
      return
    }

    if (!HEX_COLOR_REGEX.test(form.color)) {
      toast.error("Pipeline color must be a valid hex value.")
      return
    }

    if (trimmedStages.length === 0) {
      toast.error("Add at least one stage.")
      return
    }

    if (trimmedStages.some((stage) => !stage.name)) {
      toast.error("Every stage needs a name.")
      return
    }

    const normalizedStageNames = trimmedStages.map((stage) => stage.name.toLocaleLowerCase())
    if (new Set(normalizedStageNames).size !== normalizedStageNames.length) {
      toast.error("Stage names must be unique within a pipeline.")
      return
    }

    setIsSubmitting(true)
    setErrorMessage(null)

    try {
      const payload = {
        name: trimmedName,
        color: form.color.toUpperCase(),
        stages: trimmedStages.map((stage) => ({
          ...(stage.id ? { id: stage.id } : {}),
          name: stage.name,
        })),
      }

      if (editingPipeline) {
        await api.patch(
          `/api/account-settings/${tenantId}/opportunities/${editingPipeline.id}`,
          payload,
        )
        toast.success("Pipeline updated.")
      } else {
        await api.post(`/api/account-settings/${tenantId}/opportunities`, payload)
        toast.success("Pipeline created.")
      }

      closeDialog(false)
      await load()
    } catch (error) {
      const message = formatErrorMessage(
        error,
        editingPipeline ? "Could not update pipeline." : "Could not create pipeline.",
      )
      setErrorMessage(message)
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <section className="flex h-full min-h-0 flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-slate-500" />
              <h2 className="text-base font-semibold text-slate-950">
                Opportunity Pipelines
              </h2>
            </div>
            <p className="text-sm text-slate-600">
              Create tenant-specific pipelines, assign a color to each one, and manage
              stage order by dragging stages inside the editor.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline">{pipelines.length} pipelines</Badge>
            <Badge variant="outline">{stageCount} stages</Badge>
            <Button type="button" onClick={openCreateDialog}>
              <Plus className="h-4 w-4" />
              Create pipeline
            </Button>
          </div>
        </div>

        {errorMessage ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pipeline</TableHead>
                <TableHead>Color</TableHead>
                <TableHead>Stages</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-slate-500">
                    Loading opportunity pipelines...
                  </TableCell>
                </TableRow>
              ) : pipelines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-slate-500">
                    No pipelines configured yet.
                  </TableCell>
                </TableRow>
              ) : (
                pipelines.map((pipeline) => (
                  <TableRow key={pipeline.id}>
                    <TableCell className="font-medium text-slate-900">
                      {pipeline.name}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 rounded-full border border-slate-200"
                          style={{ backgroundColor: pipeline.color }}
                        />
                        <span className="font-mono text-xs text-slate-600">
                          {pipeline.color}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[26rem] whitespace-normal">
                      <div className="flex flex-wrap gap-1.5">
                        {pipeline.stages.map((stage) => (
                          <Badge key={stage.id} variant="secondary">
                            {stage.name}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">
                      {formatDateTime(pipeline.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openEditDialog(pipeline)}
                      >
                        <Pencil className="h-4 w-4" />
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <Dialog open={isDialogOpen} onOpenChange={closeDialog}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingPipeline ? "Edit pipeline" : "Create pipeline"}
            </DialogTitle>
            <DialogDescription>
              Each pipeline needs at least one stage. Drag the handle to reorder stages.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="pipeline-name">Pipeline name</Label>
              <Input
                id="pipeline-name"
                value={form.name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
                placeholder="New lead intake"
                disabled={isSubmitting}
              />
            </div>

            <div className="grid gap-3">
              <Label htmlFor="pipeline-color">Pipeline color</Label>

              <div className="flex flex-wrap gap-2">
                {PIPELINE_COLOR_PRESETS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Use ${color} for pipeline color`}
                    disabled={isSubmitting}
                    onClick={() => setForm((prev) => ({ ...prev, color }))}
                    className={cn(
                      "h-9 w-9 rounded-full border-2 transition",
                      form.color === color
                        ? "border-slate-950 ring-2 ring-slate-200"
                        : "border-transparent hover:border-slate-300",
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>

              <div className="flex items-center gap-3">
                <input
                  id="pipeline-color"
                  type="color"
                  value={HEX_COLOR_REGEX.test(form.color) ? form.color : "#1D4ED8"}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, color: event.target.value.toUpperCase() }))
                  }
                  disabled={isSubmitting}
                  className="h-11 w-14 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
                />
                <Input
                  value={form.color}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, color: event.target.value.toUpperCase() }))
                  }
                  placeholder="#1D4ED8"
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>Stages</Label>
                  <p className="mt-1 text-sm text-slate-500">
                    Drag stages into the order your team should see in the pipeline.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      stages: [...prev.stages, createStage()],
                    }))
                  }
                  disabled={isSubmitting}
                >
                  <Plus className="h-4 w-4" />
                  Add stage
                </Button>
              </div>

              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleStageDragEnd}
              >
                <SortableContext
                  items={form.stages.map((stage) => stage.clientId)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    {form.stages.map((stage) => (
                      <SortableStageRow
                        key={stage.clientId}
                        stage={stage}
                        disabled={isSubmitting}
                        isOnlyStage={form.stages.length === 1}
                        onChange={handleStageChange}
                        onRemove={handleStageRemove}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => closeDialog(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={isSubmitting}>
              {isSubmitting
                ? editingPipeline
                  ? "Saving..."
                  : "Creating..."
                : editingPipeline
                  ? "Save changes"
                  : "Create pipeline"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
