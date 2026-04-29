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
import {
  BadgeCheck,
  GripVertical,
  Palette,
  Pencil,
  Plus,
  Sparkles,
  Tag,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

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

type TagsConfigPanelProps = {
  tenantId: string
  tenantSlug: string
}

type TenantTag = {
  id: string
  name: string
  bgColor: string
  textColor: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

type TagsResponse = {
  ok: boolean
  tags: TenantTag[]
}

type TagFormState = {
  name: string
  themeKey: string
}

const TAG_THEMES = [
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
  { key: "mint", label: "Mint", bgColor: "#D1FAE5", textColor: "#065F46" },
  { key: "navy", label: "Navy", bgColor: "#DBE4FF", textColor: "#1E2A78" },
  { key: "sand", label: "Sand", bgColor: "#F5E6C8", textColor: "#8A5A13" },
  { key: "peach", label: "Peach", bgColor: "#FFE2D1", textColor: "#9A3412" },
  { key: "coral", label: "Coral", bgColor: "#FFD6D6", textColor: "#B42318" },
  { key: "lavender", label: "Lavender", bgColor: "#EEE1FF", textColor: "#6D28D9" },
  { key: "orchid", label: "Orchid", bgColor: "#F5D0FE", textColor: "#A21CAF" },
  { key: "steel", label: "Steel", bgColor: "#DCE3EA", textColor: "#334155" },
  { key: "sage", label: "Sage", bgColor: "#E7F3D8", textColor: "#3F6212" },
  { key: "mustard", label: "Mustard", bgColor: "#FDE68A", textColor: "#92400E" },
] as const

const CORE_TAG_THEME_KEYS = [
  "ocean",
  "emerald",
  "slate",
  "amber",
  "rose",
  "violet",
  "teal",
  "orange",
  "red",
  "sky",
] as const

const CORE_TAG_THEMES = TAG_THEMES.filter((theme) =>
  CORE_TAG_THEME_KEYS.includes(theme.key as (typeof CORE_TAG_THEME_KEYS)[number]),
)

const EXTENDED_TAG_THEMES = TAG_THEMES.filter(
  (theme) => !CORE_TAG_THEME_KEYS.includes(theme.key as (typeof CORE_TAG_THEME_KEYS)[number]),
)

const DEFAULT_FORM: TagFormState = {
  name: "",
  themeKey: "ocean",
}

function formatSegment(segment: string) {
  return segment.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

function toTranslateString(transform: { x: number; y: number } | null) {
  if (!transform) return undefined
  return `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`
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

function findThemeForTag(tag: Pick<TenantTag, "bgColor" | "textColor">) {
  return (
    TAG_THEMES.find(
      (theme) => theme.bgColor === tag.bgColor && theme.textColor === tag.textColor,
    ) ?? TAG_THEMES[0]
  )
}

function formatTagNameInput(name: string) {
  return name
    .toLocaleLowerCase()
    .replace(/[^a-z0-9-\s]+/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
}

function normalizeTagName(name: string) {
  return formatTagNameInput(name)
    .trim()
    .replace(/^-+|-+$/g, "")
}

function SortableTagRow({
  tag,
  index,
  disabled,
  onEdit,
  onDelete,
}: {
  tag: TenantTag
  index: number
  disabled: boolean
  onEdit: (tag: TenantTag) => void
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
  } = useSortable({ id: tag.id, disabled })

  return (
    <article
      ref={setNodeRef}
      style={{ transform: toTranslateString(transform), transition }}
      className={cn(
        "rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-4 transition-colors md:p-5",
        isDragging && "z-10 bg-slate-50/90 shadow-sm",
      )}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-500">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800">
              Tag
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-500">
              Updated {formatDateTime(tag.updatedAt)}
            </span>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <p className="text-lg font-semibold text-slate-950">{tag.name}</p>
              <span
                className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                style={{
                  backgroundColor: tag.bgColor,
                  color: tag.textColor,
                }}
              >
                {tag.name}
              </span>
            </div>

            <p className="max-w-2xl text-sm leading-6 text-slate-500">
              Stored as <span className="font-medium text-slate-700">{tag.name}</span> and
              available to reuse anywhere tag assignment is supported.
            </p>
          </div>
        </div>

        <div className="flex flex-col items-start gap-3 lg:items-end">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              className="cursor-pointer"
              onClick={() => onEdit(tag)}
            >
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={disabled}
              className="cursor-pointer bg-slate-900 text-white hover:bg-slate-800"
              onClick={() => void onDelete(tag.id)}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500">
              Drag to reorder
            </span>
            <button
              ref={setActivatorNodeRef}
              type="button"
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500",
                disabled
                  ? "cursor-not-allowed opacity-50"
                  : "cursor-grab hover:bg-slate-100 active:cursor-grabbing",
              )}
              aria-label={`Reorder ${tag.name}`}
              disabled={disabled}
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}

export function TagsConfigPanel({ tenantId, tenantSlug }: TagsConfigPanelProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [tags, setTags] = useState<TenantTag[]>([])
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingTag, setEditingTag] = useState<TenantTag | null>(null)
  const [form, setForm] = useState<TagFormState>(DEFAULT_FORM)
  const [showExtendedThemes, setShowExtendedThemes] = useState(false)

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
      const { data } = await api.get<TagsResponse>(`/api/account-settings/${tenantId}/tags`)
      const sorted = [...data.tags].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
      )
      setTags(sorted)
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        setErrorMessage(
          typeof backendError === "string"
            ? formatSegment(backendError)
            : "Could not load tags.",
        )
      } else {
        setErrorMessage("Could not load tags.")
      }
    } finally {
      setIsLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    void load()
  }, [load])

  const selectedTheme = useMemo(
    () => TAG_THEMES.find((theme) => theme.key === form.themeKey) ?? TAG_THEMES[0],
    [form.themeKey],
  )
  const normalizedPreviewName = useMemo(() => normalizeTagName(form.name), [form.name])
  const lastUpdatedAt = useMemo(() => {
    if (!tags.length) return null

    return tags.reduce((latest, tag) =>
      new Date(tag.updatedAt).getTime() > new Date(latest.updatedAt).getTime()
        ? tag
        : latest,
    ).updatedAt
  }, [tags])
  const hyphenatedCount = useMemo(
    () => tags.filter((tag) => tag.name.includes("-")).length,
    [tags],
  )

  const openCreateDialog = () => {
    setEditingTag(null)
    setForm(DEFAULT_FORM)
    setShowExtendedThemes(false)
    setIsDialogOpen(true)
  }

  const openEditDialog = (tag: TenantTag) => {
    const theme = findThemeForTag(tag)
    setEditingTag(tag)
    setForm({
      name: tag.name,
      themeKey: theme.key,
    })
    setShowExtendedThemes(
      EXTENDED_TAG_THEMES.some((extendedTheme) => extendedTheme.key === theme.key),
    )
    setIsDialogOpen(true)
  }

  const closeDialog = (force = false) => {
    if (isBusy && !force) return
    setIsDialogOpen(false)
    setEditingTag(null)
    setForm(DEFAULT_FORM)
    setShowExtendedThemes(false)
  }

  const saveTag = async () => {
    const normalizedName = normalizeTagName(form.name)
    if (!normalizedName) {
      const message =
        "Tag name must include at least one letter or number. Spaces are converted to hyphens."
      setErrorMessage(message)
      toast.error(message)
      return
    }

    const duplicateExists = tags.some((tag) => {
      if (editingTag && tag.id === editingTag.id) {
        return false
      }

      return normalizeTagName(tag.name) === normalizedName
    })

    if (duplicateExists) {
      const message = "A tag with this name already exists."
      setErrorMessage(message)
      toast.error(message)
      return
    }

    setIsBusy(true)
    setErrorMessage(null)

    try {
      const payload = {
        name: normalizedName,
        bgColor: selectedTheme.bgColor,
        textColor: selectedTheme.textColor,
      }

      if (editingTag) {
        await api.patch(`/api/account-settings/${tenantId}/tags/${editingTag.id}`, payload)
        toast.success("Tag updated.")
      } else {
        await api.post(`/api/account-settings/${tenantId}/tags`, payload)
        toast.success("Tag created.")
      }

      closeDialog(true)
      await load()
    } catch (error) {
      const backendError = isAxiosError(error)
        ? error.response?.data?.error
        : undefined
      const message =
        backendError === "UNIQUE_CONSTRAINT" ||
        backendError === "TAG_NAME_ALREADY_EXISTS"
          ? "A tag with this name already exists."
          : typeof backendError === "string"
          ? formatSegment(backendError)
          : editingTag
            ? "Could not update tag."
            : "Could not create tag."
      setErrorMessage(message)
      toast.error(message)
    } finally {
      setIsBusy(false)
    }
  }

  const deleteTag = async (id: string) => {
    setIsBusy(true)
    setErrorMessage(null)

    try {
      await api.delete(`/api/account-settings/${tenantId}/tags/${id}`)
      toast.success("Tag deleted.")
      await load()
    } catch (error) {
      const backendError = isAxiosError(error)
        ? error.response?.data?.error
        : undefined
      const message =
        typeof backendError === "string"
          ? formatSegment(backendError)
          : "Could not delete tag."
      setErrorMessage(message)
      toast.error(message)
    } finally {
      setIsBusy(false)
    }
  }

  const persistReorder = async (reordered: TenantTag[]) => {
    const nextTags = reordered.map((tag, index) => ({
      ...tag,
      sortOrder: (index + 1) * 10,
    }))

    setTags(nextTags)
    setIsBusy(true)

    try {
      await Promise.all(
        nextTags.map((tag) =>
          api.patch(`/api/account-settings/${tenantId}/tags/${tag.id}`, {
            sortOrder: tag.sortOrder,
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

    const oldIndex = tags.findIndex((tag) => tag.id === active.id)
    const newIndex = tags.findIndex((tag) => tag.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return

    void persistReorder(arrayMove(tags, oldIndex, newIndex))
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_45%,#f0fdf4_100%)]">
        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1.3fr)_360px] lg:p-7">
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                Tenant Tag Builder
              </p>
              <div className="space-y-3">
                <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-slate-950">
                  Build a consistent tag system for your tenant workspace.
                </h2>
                <p className="max-w-2xl text-sm leading-6 text-slate-600">
                  Keep reusable labels organized, normalized, and easy to scan. Tags are
                  stored in lowercase slug format and can be reordered to control how they
                  appear across the app.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                  Tag library
                </p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">{tags.length}</p>
                <p className="mt-1 text-sm text-slate-500">Total reusable tags configured.</p>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                  Hyphenated
                </p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">{hyphenatedCount}</p>
                <p className="mt-1 text-sm text-slate-500">Tags using multiple words.</p>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                  Last updated
                </p>
                <p className="mt-2 text-base font-semibold text-slate-950">
                  {lastUpdatedAt ? formatDateTime(lastUpdatedAt) : "No tags yet"}
                </p>
                <p className="mt-1 text-sm text-slate-500">Most recent tag change.</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-[24px] border border-slate-300/60 bg-slate-950 p-5 text-white shadow-sm">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200/90">
                Workspace
              </p>
              <div>
                <p className="text-lg font-semibold">{tenantSlug}</p>
                <p className="mt-1 text-sm leading-6 text-slate-300">
                  Use concise tags, avoid duplicates, and prefer stable naming so the same
                  label can be reused across future contact and task flows.
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <Button
                type="button"
                onClick={openCreateDialog}
                className="w-full cursor-pointer bg-white text-slate-950 hover:bg-slate-100"
              >
                <Plus className="h-4 w-4" />
                Create Tag
              </Button>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
                {tags.length} configured tag{tags.length === 1 ? "" : "s"} ready for reuse.
              </div>
            </div>
          </div>
        </div>
      </section>

      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Loading tags...
        </div>
      ) : errorMessage ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : tags.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-base font-medium text-slate-900">No tags yet</p>
          <p className="mt-2 text-sm text-slate-500">
            Add the first tag to start building a reusable tenant naming system.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-5 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                  Tag Library
                </p>
                <h3 className="text-xl font-semibold text-slate-950">Configured tags</h3>
                <p className="text-sm text-slate-500">
                  Review names, colors, and ordering before reusing these tags elsewhere in
                  the workspace.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
                  lowercase only
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
                  drag to reorder
                </span>
              </div>
            </div>

            <div className="p-4 md:p-5">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <div className="grid gap-4">
                  <SortableContext
                    items={tags.map((tag) => tag.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {tags.map((tag, index) => (
                      <SortableTagRow
                        key={tag.id}
                        tag={tag}
                        index={index}
                        disabled={isBusy}
                        onEdit={openEditDialog}
                        onDelete={deleteTag}
                      />
                    ))}
                  </SortableContext>
                </div>
              </DndContext>
            </div>
          </section>

          <aside className="space-y-4">
            <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-500" />
                <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">
                  Guidelines
                </h3>
              </div>
              <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                <p>Use short names that stay meaningful across multiple workflows.</p>
                <p>Spaces are converted to hyphens automatically before save.</p>
                <p>Duplicate names are blocked even when the only difference is casing.</p>
              </div>
            </section>

            <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <BadgeCheck className="h-4 w-4 text-emerald-600" />
                <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">
                  Summary
                </h3>
              </div>
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                    Preview style
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag.id}
                        className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                        style={{
                          backgroundColor: tag.bgColor,
                          color: tag.textColor,
                        }}
                      >
                        {tag.name}
                      </span>
                    ))}
                    {tags.length === 0 ? (
                      <span className="text-sm text-slate-500">No preview available yet.</span>
                    ) : null}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  <div className="flex items-center gap-2">
                    <Tag className="h-4 w-4 text-slate-500" />
                    <span>{tags.length} total configured tags</span>
                  </div>
                </div>
              </div>
            </section>
          </aside>
        </div>
      )}

      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => (open ? setIsDialogOpen(true) : closeDialog())}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTag ? "Edit Tag" : "Add Tag"}</DialogTitle>
            <DialogDescription>
              Choose a label and color theme for this tenant tag.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tag-name">Tag Name</Label>
              <Input
                id="tag-name"
                value={form.name}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    name: formatTagNameInput(event.target.value),
                  }))
                }
                placeholder="vip-client"
              />
              <p className="text-xs text-slate-500">
                Saved in lowercase without spaces. Spaces and separators become `-`.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label className="inline-flex items-center gap-1.5">
                  <Palette className="h-3.5 w-3.5 text-slate-500" />
                  Color Theme
                </Label>
                {EXTENDED_TAG_THEMES.length ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto cursor-pointer px-2 py-1 text-xs text-slate-500 hover:text-slate-900"
                    onClick={() => setShowExtendedThemes((prev) => !prev)}
                  >
                    {showExtendedThemes ? "Fewer colors" : "More colors"}
                  </Button>
                ) : null}
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 sm:grid-cols-5">
                {CORE_TAG_THEMES.map((theme) => {
                  const isSelected = form.themeKey === theme.key
                  return (
                    <button
                      key={theme.key}
                      type="button"
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
                          color: theme.textColor,
                        }}
                      >
                        {theme.label.slice(0, 3)}
                      </span>
                    </button>
                  )
                })}
              </div>
              {showExtendedThemes ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                    Extended Palette
                  </p>
                  <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 sm:grid-cols-5">
                    {EXTENDED_TAG_THEMES.map((theme) => {
                      const isSelected = form.themeKey === theme.key
                      return (
                        <button
                          key={theme.key}
                          type="button"
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
              ) : null}
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
                  {normalizedPreviewName || "tag"}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isBusy}
              className="cursor-pointer"
              onClick={() => closeDialog()}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isBusy}
              className="cursor-pointer bg-blue-950 text-white hover:bg-blue-950/90"
              onClick={() => void saveTag()}
            >
              {editingTag ? "Save Changes" : "Create Tag"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
