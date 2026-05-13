"use client"

import { isAxiosError } from "axios"
import { useEffect, useState } from "react"
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
import { GripVertical, Palette, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"

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
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

export type OpportunityStageRecord = {
  id: string
  name: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type OpportunityPipelineRecord = {
  id: string
  name: string
  color: string
  sortOrder: number
  createdAt: string
  updatedAt: string
  stages: OpportunityStageRecord[]
}

type EditableStage = {
  id: string | null
  clientId: string
  name: string
}

type PipelineFormState = {
  name: string
  themeKey: string
  stages: EditableStage[]
}

type OpportunityPipelineMutationResponse = {
  ok: boolean
  pipeline: OpportunityPipelineRecord
}

type OpportunityPipelineEditorProps = {
  tenantId: string
  initialPipeline?: OpportunityPipelineRecord | null
  onCancel?: () => void
  onSaved?: (pipeline: OpportunityPipelineRecord) => Promise<void> | void
}

const PIPELINE_COLOR_THEMES = [
  { key: "emerald", label: "Emerald", bgColor: "#DCFCE7", color: "#166534" },
  { key: "ocean", label: "Ocean", bgColor: "#DBEAFE", color: "#1E3A8A" },
  { key: "slate", label: "Slate", bgColor: "#E2E8F0", color: "#334155" },
  { key: "amber", label: "Amber", bgColor: "#FEF3C7", color: "#92400E" },
  { key: "rose", label: "Rose", bgColor: "#FFE4E6", color: "#9F1239" },
  { key: "violet", label: "Violet", bgColor: "#EDE9FE", color: "#5B21B6" },
  { key: "indigo", label: "Indigo", bgColor: "#E0E7FF", color: "#3730A3" },
  { key: "cyan", label: "Cyan", bgColor: "#CFFAFE", color: "#155E75" },
  { key: "teal", label: "Teal", bgColor: "#CCFBF1", color: "#115E59" },
  { key: "lime", label: "Lime", bgColor: "#ECFCCB", color: "#3F6212" },
  { key: "orange", label: "Orange", bgColor: "#FFEDD5", color: "#9A3412" },
  { key: "red", label: "Red", bgColor: "#FEE2E2", color: "#991B1B" },
  { key: "pink", label: "Pink", bgColor: "#FCE7F3", color: "#9D174D" },
  { key: "fuchsia", label: "Fuchsia", bgColor: "#FAE8FF", color: "#86198F" },
  { key: "sky", label: "Sky", bgColor: "#E0F2FE", color: "#0C4A6E" },
] as const

const PIPELINE_THEME_KEYS = PIPELINE_COLOR_THEMES.map((theme) => theme.key) as [
  (typeof PIPELINE_COLOR_THEMES)[number]["key"],
  ...(typeof PIPELINE_COLOR_THEMES)[number]["key"][],
]

const pipelineStageFormSchema = z.object({
  id: z.preprocess(
    (value) => {
      if (value == null) return undefined
      if (typeof value !== "string") return value
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : undefined
    },
    z.string().min(1).optional(),
  ),
  clientId: z.string().trim().min(1),
  name: z
    .string()
    .trim()
    .min(1, "Every stage needs a name.")
    .max(80, "Stage names must be 80 characters or fewer.")
    .transform((value) => value.replace(/\s+/g, " ")),
})

const pipelineFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Pipeline name is required.")
      .max(80, "Pipeline names must be 80 characters or fewer.")
      .transform((value) => value.replace(/\s+/g, " ")),
    themeKey: z.enum(PIPELINE_THEME_KEYS),
    stages: z
      .array(pipelineStageFormSchema)
      .min(1, "Add at least one stage.")
      .max(50, "Pipelines can include up to 50 stages."),
  })
  .superRefine((value, ctx) => {
    const normalizedStageNames = value.stages.map((stage) => stage.name.toLocaleLowerCase())

    if (new Set(normalizedStageNames).size !== normalizedStageNames.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stages"],
        message: "Stage names must be unique within a pipeline.",
      })
    }
  })

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
    themeKey: "ocean",
    stages: [createStage()],
  }
}

function buildFormFromPipeline(pipeline: OpportunityPipelineRecord): PipelineFormState {
  const selectedTheme =
    PIPELINE_COLOR_THEMES.find((theme) => theme.color === pipeline.color) ??
    PIPELINE_COLOR_THEMES[0]

  return {
    name: pipeline.name,
    themeKey: selectedTheme.key,
    stages:
      pipeline.stages.length > 0
        ? pipeline.stages.map((stage) => createStage(stage.name, stage.id))
        : [createStage()],
  }
}

function getPipelineTheme(themeKey: string) {
  return PIPELINE_COLOR_THEMES.find((theme) => theme.key === themeKey) ?? PIPELINE_COLOR_THEMES[0]
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

export function OpportunityPipelineEditor({
  tenantId,
  initialPipeline,
  onCancel,
  onSaved,
}: OpportunityPipelineEditorProps) {
  const isEditing = Boolean(initialPipeline)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isColorDialogOpen, setIsColorDialogOpen] = useState(false)
  const [draftThemeKey, setDraftThemeKey] = useState<string>("ocean")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [form, setForm] = useState<PipelineFormState>(() =>
    initialPipeline ? buildFormFromPipeline(initialPipeline) : defaultFormState(),
  )

  useEffect(() => {
    setErrorMessage(null)
    const nextForm = initialPipeline
      ? buildFormFromPipeline(initialPipeline)
      : defaultFormState()
    setForm(nextForm)
    setDraftThemeKey(nextForm.themeKey)
  }, [initialPipeline])

  const selectedTheme = getPipelineTheme(form.themeKey)
  const draftSelectedTheme = getPipelineTheme(draftThemeKey)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

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
    const validationResult = pipelineFormSchema.safeParse(form)

    if (!validationResult.success) {
      const issue = validationResult.error.issues[0]
      const message = issue?.message ?? "Review the pipeline fields and try again."
      setErrorMessage(message)
      toast.error(message)
      return
    }

    const normalizedForm = validationResult.data

    setForm({
      name: normalizedForm.name,
      themeKey: normalizedForm.themeKey,
      stages: normalizedForm.stages.map((stage) => ({
        id: stage.id ?? null,
        clientId: stage.clientId,
        name: stage.name,
      })),
    })

    setIsSubmitting(true)
    setErrorMessage(null)

    try {
      const normalizedTheme = getPipelineTheme(normalizedForm.themeKey)
      const payload = {
        name: normalizedForm.name,
        color: normalizedTheme.color,
        stages: normalizedForm.stages.map((stage) => ({
          ...(stage.id ? { id: stage.id } : {}),
          name: stage.name,
        })),
      }

      const { data } = initialPipeline
        ? await api.patch<OpportunityPipelineMutationResponse>(
            `/api/account-settings/${tenantId}/opportunities/${initialPipeline.id}`,
            payload,
          )
        : await api.post<OpportunityPipelineMutationResponse>(
            `/api/account-settings/${tenantId}/opportunities`,
            payload,
          )

      setForm(buildFormFromPipeline(data.pipeline))
      toast.success(initialPipeline ? "Pipeline updated." : "Pipeline created.")
      await onSaved?.(data.pipeline)
    } catch (error) {
      const message = formatErrorMessage(
        error,
        initialPipeline ? "Could not update pipeline." : "Could not create pipeline.",
      )
      setErrorMessage(message)
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const openColorDialog = () => {
    setDraftThemeKey(form.themeKey)
    setIsColorDialogOpen(true)
  }

  const applyColorTheme = () => {
    setForm((prev) => ({ ...prev, themeKey: draftThemeKey }))
    setIsColorDialogOpen(false)
  }

  return (
    <div className="grid gap-5">
      {errorMessage ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : null}

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
        <Label className="inline-flex items-center gap-1.5">
          <Palette className="h-3.5 w-3.5 text-slate-500" />
          Color Theme
        </Label>

        {isEditing ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex h-10 items-center rounded-md border border-slate-200 bg-white px-3">
              <span
                className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                style={{
                  backgroundColor: selectedTheme.bgColor,
                  color: selectedTheme.color,
                }}
              >
                {form.name.trim() || "Pipeline"}
              </span>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={openColorDialog}
              disabled={isSubmitting}
              className="border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
            >
              Edit color
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 sm:grid-cols-5">
            {PIPELINE_COLOR_THEMES.map((theme) => {
              const isSelected = form.themeKey === theme.key

              return (
                <button
                  key={theme.key}
                  type="button"
                  disabled={isSubmitting}
                  onClick={() =>
                    setForm((prev) => ({ ...prev, themeKey: theme.key }))
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
                      color: theme.color,
                    }}
                  >
                    {theme.label.slice(0, 3)}
                  </span>
                </button>
              )
            })}
          </div>
        )}

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
            className="border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
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

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isSubmitting}
            className="border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
          >
            Cancel
          </Button>
        ) : null}
        <Button
          type="button"
          onClick={handleSave}
          disabled={isSubmitting}
          className="bg-slate-950 text-white hover:bg-slate-800"
        >
          {isSubmitting
            ? initialPipeline
              ? "Saving..."
              : "Creating..."
            : initialPipeline
              ? "Save changes"
              : "Create pipeline"}
        </Button>
      </div>

      <Dialog open={isColorDialogOpen} onOpenChange={setIsColorDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit color theme</DialogTitle>
            <DialogDescription>
              Choose one of the default pipeline themes.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 sm:grid-cols-5">
              {PIPELINE_COLOR_THEMES.map((theme) => {
                const isSelected = draftThemeKey === theme.key

                return (
                  <button
                    key={theme.key}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setDraftThemeKey(theme.key)}
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
                        color: theme.color,
                      }}
                    >
                      {theme.label.slice(0, 3)}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="space-y-2">
              <Label>Preview</Label>
              <div className="flex h-10 items-center rounded-md border border-slate-200 bg-white px-3">
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                  style={{
                    backgroundColor: draftSelectedTheme.bgColor,
                    color: draftSelectedTheme.color,
                  }}
                >
                  {form.name.trim() || "Pipeline"}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDraftThemeKey(form.themeKey)
                setIsColorDialogOpen(false)
              }}
              disabled={isSubmitting}
              className="border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={applyColorTheme}
              disabled={isSubmitting}
              className="bg-slate-950 text-white hover:bg-slate-800"
            >
              Apply color
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
