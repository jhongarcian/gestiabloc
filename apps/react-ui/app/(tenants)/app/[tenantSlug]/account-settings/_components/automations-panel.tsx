"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { isAxiosError } from "axios"
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  GripVertical,
  Grid2X2,
  History,
  List,
  Loader2,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Workflow,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { EmptyDocument } from "@/components/ui/empty-document"
import { EmptyFolder } from "@/components/ui/empty-folder"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { api } from "@/lib/api"
import {
  groupAutomations,
  parseLibraryLocation,
  serializeLibraryLocation,
  validFolderId,
  type LibraryLocation,
} from "@/lib/automation-library"
import { serializeAutomationAction } from "@/lib/automation-action-payload"
import { cn } from "@/lib/utils"
import type { AutomationFolder, AutomationRecord } from "./automation-types"

type Props = { tenantId: string; tenantSlug: string }
const primary =
  "h-8 cursor-pointer rounded-full bg-blue-950 px-3 py-1 text-xs font-semibold text-white shadow-sm hover:bg-blue-900 hover:text-white disabled:opacity-50"
const secondary =
  "h-8 cursor-pointer rounded-full border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
const iconButton =
  "size-8 cursor-pointer rounded-full border-slate-200 bg-white p-0 text-slate-600 shadow-sm hover:bg-slate-50"
const dialogClass =
  "max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[28px] border-slate-200 bg-white p-0 shadow-2xl sm:max-w-lg [&>button]:cursor-pointer"

type SortableKind = "folder" | "automation"
const folderDragId = (id: string) => "folder:" + id
const automationDragId = (id: string) => "automation:" + id

const libraryCollisionDetection: CollisionDetection = (args) => {
  const { kind, folderId } = args.active.data.current ?? {}
  return closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter((container) => {
      const data = container.data.current
      return data?.kind === kind &&
        (kind === "folder" || data?.folderId === folderId)
    }),
  })
}

function SortableLibraryItem({
  id,
  kind,
  folderId = null,
  name,
  disabled,
  className,
  children,
}: {
  id: string
  kind: SortableKind
  folderId?: string | null
  name: string
  disabled: boolean
  className?: string
  children: (handle: ReactNode) => ReactNode
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id: kind === "folder" ? folderDragId(id) : automationDragId(id),
    data: { kind, folderId, itemId: id },
    disabled,
  })

  const handle = (
    <button
      ref={setActivatorNodeRef}
      type="button"
      disabled={disabled}
      className="inline-flex size-8 shrink-0 touch-none items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-500 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40 enabled:cursor-grab"
      {...attributes}
      {...listeners}
      aria-label={`Drag to reorder ${kind} ${name}`}
    >
      <GripVertical className="size-4" aria-hidden="true" />
    </button>
  )

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "relative min-w-0",
        isDragging && "z-20 opacity-70",
        isOver && !isDragging && "rounded-[22px] ring-2 ring-blue-400 ring-offset-2",
        className,
      )}
    >
      {children(handle)}
    </div>
  )
}

function errorMessage(error: unknown, fallback: string) {
  if (!isAxiosError(error)) return fallback
  const code = error.response?.data?.error
  if (code === "FOLDER_NAME_TAKEN")
    return "A folder with that name already exists."
  return typeof error.response?.data?.message === "string"
    ? error.response.data.message
    : fallback
}

function payloadFor(record: AutomationRecord, enabled: boolean) {
  return {
    name: record.name,
    isEnabled: enabled,
    trigger: record.trigger,
    conditions: record.conditions.map(
      ({
        source,
        operator,
        customFieldId,
        statusConfigId,
        assignedUserId,
        tagId,
        compareValue,
      }) => ({
        source,
        operator,
        customFieldId,
        statusConfigId,
        assignedUserId,
        tagId,
        compareValue,
      }),
    ),
    actions: record.actions.map(serializeAutomationAction),
  }
}

export function AutomationsPanel({ tenantId, tenantSlug }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const location = parseLibraryLocation(
    new URLSearchParams(searchParams.toString()),
  )
  const base = "/app/" + tenantSlug + "/account-settings/automations"
  const endpoint = "/api/account-settings/" + tenantId
  const [items, setItems] = useState<AutomationRecord[]>([])
  const [folders, setFolders] = useState<AutomationFolder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [folderDialog, setFolderDialog] = useState<
    AutomationFolder | "create" | null
  >(null)
  const [folderName, setFolderName] = useState("")
  const [folderError, setFolderError] = useState("")
  const [deleteFolder, setDeleteFolder] = useState<AutomationFolder | null>(
    null,
  )
  const [orderOpen, setOrderOpen] = useState(false)
  const [draftOrder, setDraftOrder] = useState<string[]>([])
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get<{
        items: AutomationRecord[]
        folders: AutomationFolder[]
      }>(endpoint + "/automations")
      setItems(data.items)
      setFolders(data.folders)
    } catch (cause) {
      setError(errorMessage(cause, "Could not load the automation library."))
    } finally {
      setLoading(false)
    }
  }, [endpoint])
  useEffect(() => {
    void load()
  }, [load])

  const orderedFolders = useMemo(
    () =>
      [...folders].sort(
        (a, b) =>
          a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt),
      ),
    [folders],
  )
  const groups = useMemo(() => groupAutomations(items), [items])
  const requestedFolder = location.view === "grid" ? location.folderId : null
  const activeId = validFolderId(
    requestedFolder,
    folders.map((folder) => folder.id),
  )
  const activeFolder = folders.find((folder) => folder.id === activeId)
  const invalidFolder = Boolean(
    requestedFolder && !activeFolder && !loading && !error,
  )
  const visibleItems = groups.get(activeId) ?? []
  const executionItems = useMemo(
    () =>
      [...items].sort(
        (a, b) =>
          a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt),
      ),
    [items],
  )
  const query = serializeLibraryLocation(location)
  const builderHref = (id: string) => base + "/" + id + "?" + query

  function navigate(next: LibraryLocation) {
    router.push(base + "?" + serializeLibraryLocation(next), { scroll: false })
  }
  function setView(view: "grid" | "list") {
    navigate({
      view,
      folderId: view === "grid" ? activeId : null,
      openIds: location.openIds,
    })
  }
  function toggleOpen(id: string) {
    const openIds = location.openIds.includes(id)
      ? location.openIds.filter((value) => value !== id)
      : [...location.openIds, id]
    navigate({ view: "list", folderId: null, openIds })
  }
  function openFolder(folder: AutomationFolder) {
    navigate({ view: "grid", folderId: folder.id, openIds: location.openIds })
  }
  function openFolderDialog(folder: AutomationFolder | "create") {
    setFolderName(folder === "create" ? "" : folder.name)
    setFolderError("")
    setFolderDialog(folder)
  }
  async function saveFolder() {
    const name = folderName.trim()
    if (!name) return setFolderError("Enter a folder name.")
    if (name.length > 80) return setFolderError("Use 80 characters or fewer.")
    setBusy(true)
    try {
      if (folderDialog === "create") {
        await api.post(endpoint + "/automation-folders", { name })
        toast.success("Folder created.")
      } else if (folderDialog) {
        await api.patch(endpoint + "/automation-folders/" + folderDialog.id, {
          name,
        })
        toast.success("Folder renamed.")
      }
      setFolderDialog(null)
      await load()
    } catch (cause) {
      setFolderError(errorMessage(cause, "Could not save this folder."))
    } finally {
      setBusy(false)
    }
  }
  async function removeFolder() {
    if (!deleteFolder) return
    setBusy(true)
    try {
      await api.delete(endpoint + "/automation-folders/" + deleteFolder.id)
      toast.success("Folder deleted. Its automations were moved to the root.")
      if (activeId === deleteFolder.id)
        navigate({ ...location, folderId: null })
      setDeleteFolder(null)
      await load()
    } catch (cause) {
      toast.error(errorMessage(cause, "Could not delete the folder."))
    } finally {
      setBusy(false)
    }
  }
  async function saveFolderOrder(folderIds: string[]) {
    const previous = folders
    setFolders((current) => current.map((folder) => ({
      ...folder,
      sortOrder: (folderIds.indexOf(folder.id) + 1) * 10,
    })))
    setBusy(true)
    try {
      await api.patch(endpoint + "/automation-folders/reorder", { folderIds })
    } catch (cause) {
      setFolders(previous)
      toast.error(errorMessage(cause, "Could not reorder folders."))
    } finally {
      setBusy(false)
    }
  }
  async function moveAutomation(
    record: AutomationRecord,
    folderId: string | null,
  ) {
    setBusy(true)
    try {
      await api.patch(endpoint + "/automations/" + record.id + "/folder", {
        folderId,
      })
      toast.success(
        folderId
          ? "Automation moved to folder."
          : "Automation moved to the root.",
      )
      await load()
    } catch (cause) {
      toast.error(errorMessage(cause, "Could not move the automation."))
    } finally {
      setBusy(false)
    }
  }
  async function saveLibraryOrder(folderId: string | null, automationIds: string[]) {
    const previous = items
    setItems((current) => current.map((item) => item.folderId === folderId
      ? { ...item, librarySortOrder: (automationIds.indexOf(item.id) + 1) * 10 }
      : item))
    setBusy(true)
    try {
      await api.patch(endpoint + "/automations/library-order", {
        folderId,
        automationIds,
      })
    } catch (cause) {
      setItems(previous)
      toast.error(errorMessage(cause, "Could not reorder the library."))
    } finally {
      setBusy(false)
    }
  }
  function handleLibraryDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id || busy) return
    const activeData = active.data.current
    const overData = over.data.current
    if (!activeData || !overData || activeData.kind !== overData.kind) return
    if (activeData.kind === "folder") {
      const from = orderedFolders.findIndex((folder) => folder.id === activeData.itemId)
      const to = orderedFolders.findIndex((folder) => folder.id === overData.itemId)
      if (from < 0 || to < 0) return
      void saveFolderOrder(arrayMove(orderedFolders, from, to).map((folder) => folder.id))
      return
    }
    if (activeData.kind !== "automation" || activeData.folderId !== overData.folderId) return
    const folderId = typeof activeData.folderId === "string" ? activeData.folderId : null
    const siblings = groups.get(folderId) ?? []
    const from = siblings.findIndex((item) => item.id === activeData.itemId)
    const to = siblings.findIndex((item) => item.id === overData.itemId)
    if (from < 0 || to < 0) return
    void saveLibraryOrder(folderId, arrayMove(siblings, from, to).map((item) => item.id))
  }
  async function togglePublish(record: AutomationRecord) {
    setBusy(true)
    try {
      await api.patch(
        endpoint + "/automations/" + record.id,
        payloadFor(record, !record.isEnabled),
      )
      toast.success(
        record.isEnabled
          ? "Automation moved to draft."
          : "Automation published.",
      )
      await load()
    } catch (cause) {
      toast.error(errorMessage(cause, "Could not update this automation."))
    } finally {
      setBusy(false)
    }
  }
  async function removeAutomation(record: AutomationRecord) {
    if (
      !window.confirm(
        "Delete “" + record.name + "”? Execution history will be preserved.",
      )
    )
      return
    setBusy(true)
    try {
      await api.delete(endpoint + "/automations/" + record.id)
      toast.success("Automation deleted.")
      await load()
    } catch (cause) {
      toast.error(errorMessage(cause, "Could not delete the automation."))
    } finally {
      setBusy(false)
    }
  }
  function startOrder() {
    setDraftOrder(executionItems.map((item) => item.id))
    setOrderOpen(true)
  }
  function shiftExecution(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= draftOrder.length) return
    const next = [...draftOrder]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    setDraftOrder(next)
  }
  async function saveOrder() {
    setBusy(true)
    try {
      await api.patch(endpoint + "/automations/reorder", {
        automationIds: draftOrder,
      })
      setOrderOpen(false)
      toast.success("Execution order saved.")
      await load()
    } catch (cause) {
      toast.error(errorMessage(cause, "Could not save execution order."))
    } finally {
      setBusy(false)
    }
  }

  function folderMenu(folder: AutomationFolder) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            className={iconButton}
            aria-label={"Options for " + folder.name}
            disabled={busy}
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => openFolderDialog(folder)}>
              Rename folder
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setDeleteFolder(folder)}
            >
              Delete folder
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }
  function automationMenu(record: AutomationRecord) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            className={iconButton}
            aria-label={"Options for " + record.name}
            disabled={busy}
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => void togglePublish(record)}>
              {record.isEnabled ? "Move to draft" : "Publish"}
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={builderHref(record.id)}>Edit automation</Link>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          {(record.folderId || orderedFolders.length > 0) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel className="pb-0">Move to folder</DropdownMenuLabel>
                <p className="px-2 pb-1 text-xs leading-4 text-muted-foreground">
                  Does not change draft or published status.
                </p>
                {record.folderId && (
                  <DropdownMenuItem
                    onSelect={() => void moveAutomation(record, null)}
                  >
                    Move to root
                  </DropdownMenuItem>
                )}
                {orderedFolders
                  .filter((folder) => folder.id !== record.folderId)
                  .map((folder) => (
                    <DropdownMenuItem
                      key={folder.id}
                      onSelect={() => void moveAutomation(record, folder.id)}
                    >
                      Move to {folder.name}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuGroup>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => void removeAutomation(record)}
            >
              Delete automation
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }
  function automationCard(record: AutomationRecord, compact = false) {
    const siblingCount = groups.get(record.folderId)?.length ?? 0
    return (
      <SortableLibraryItem
        key={record.id}
        id={record.id}
        kind="automation"
        folderId={record.folderId}
        name={record.name}
        disabled={busy || siblingCount < 2}
        className={compact ? "min-w-0" : "xl:max-w-64"}
      >
        {(handle) => (
          <article
            className={cn(
              "group relative min-w-0 transition",
              compact
                ? "flex items-center gap-3 px-2 py-2"
                : "rounded-[22px] border border-slate-200 bg-white p-3 shadow-sm hover:border-blue-200 hover:shadow-md xl:aspect-square xl:max-w-64",
            )}
          >
            <div className={compact ? "" : "absolute left-5 top-5"}>{handle}</div>
            <div
              className={cn(
                "min-w-0",
                compact
                  ? "flex flex-1 items-center gap-3"
                  : "rounded-xl xl:flex xl:h-full xl:flex-col",
              )}
            >
              <div
                className={cn(
                  "flex items-center justify-center overflow-hidden rounded-xl",
                  compact
                    ? cn(
                        "size-9 shrink-0",
                        record.isEnabled ? "bg-emerald-200" : "bg-slate-200",
                      )
                    : "h-32 w-full bg-slate-50 xl:min-h-0 xl:flex-1 xl:h-auto",
                )}
              >
                <EmptyDocument variant={compact ? "row" : "card"} />
              </div>
              <div
                className={cn(
                  "min-w-0",
                  compact ? "flex-1" : "px-1 pb-1 pt-3 pr-10",
                )}
              >
                <Link
                  href={builderHref(record.id)}
                  className="block truncate text-sm font-semibold text-slate-950 hover:text-blue-800 focus-visible:rounded focus-visible:outline-2 focus-visible:outline-blue-700"
                >
                  {record.name}
                </Link>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {record.isEnabled ? "Published" : "Draft"}
                </p>
              </div>
            </div>
            {compact ? (
              automationMenu(record)
            ) : (
              <div className="absolute right-4 top-[9.25rem] xl:bottom-4 xl:top-auto">
                {automationMenu(record)}
              </div>
            )}
          </article>
        )}
      </SortableLibraryItem>
    )
  }
  function folderCard(folder: AutomationFolder) {
    const count = groups.get(folder.id)?.length ?? 0
    return (
      <SortableLibraryItem
        key={folder.id}
        id={folder.id}
        kind="folder"
        name={folder.name}
        disabled={busy || orderedFolders.length < 2}
        className="xl:max-w-64"
      >
        {(handle) => (
          <article className="group relative min-w-0 rounded-[22px] border border-slate-200 bg-white p-3 shadow-sm transition hover:border-blue-200 hover:shadow-md xl:aspect-square xl:max-w-64">
            <div className="absolute left-5 top-5 z-10">{handle}</div>
            <div
              role="button"
              tabIndex={0}
              aria-label={"Open " + folder.name}
              onClick={() => openFolder(folder)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  openFolder(folder)
                }
              }}
              className="cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-blue-700 xl:flex xl:h-full xl:flex-col"
            >
              <div className="flex h-32 items-center justify-center rounded-xl bg-slate-50 xl:min-h-0 xl:flex-1 xl:h-auto">
                <EmptyFolder
                  variant="card"
                  documentCount={count}
                  heading=""
                  description={null}
                  className="pointer-events-none"
                />
              </div>
              <div className="px-1 pb-1 pt-3 pr-10 text-left">
                <h4 className="truncate text-sm font-semibold text-slate-950">
                  {folder.name}
                </h4>
                <p className="mt-0.5 text-xs text-slate-500">
                  {count} automation{count === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            <div className="absolute right-4 top-[9.25rem] xl:bottom-4 xl:top-auto">
              {folderMenu(folder)}
            </div>
          </article>
        )}
      </SortableLibraryItem>
    )
  }

  return (
    <section
      aria-labelledby="automation-settings-title"
      className="flex min-h-0 flex-1 flex-col gap-5"
    >
      <header className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-4 sm:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-col gap-1">
              <h2
                id="automation-settings-title"
                className="text-2xl font-semibold text-slate-950"
              >
                Build reliable workflows
              </h2>
              <p className="max-w-2xl text-sm text-slate-600">
                Organize your automations into folders without changing when
                they run.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              className={secondary}
              onClick={startOrder}
            >
              <Workflow data-icon="inline-start" aria-hidden="true" />
              Execution order
            </Button>
            <Button asChild variant="ghost" className={secondary}>
              <Link href={"/app/" + tenantSlug + "/automation-processes"}>
                <History data-icon="inline-start" aria-hidden="true" />
                Process history
              </Link>
            </Button>
            <Button asChild variant="ghost" className={primary}>
              <Link href={builderHref("new")}>
                <Plus data-icon="inline-start" aria-hidden="true" />
                New automation
              </Link>
            </Button>
          </div>
        </div>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {activeFolder ? (
            <Button
              type="button"
              variant="outline"
              className={secondary}
              onClick={() => navigate({ ...location, folderId: null })}
            >
              <ArrowLeft data-icon="inline-start" aria-hidden="true" />
              Back to library
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              className={secondary}
              onClick={() => openFolderDialog("create")}
            >
              <FolderPlus data-icon="inline-start" aria-hidden="true" />
              Create folder
            </Button>
          )}
          {activeFolder && (
            <span className="text-sm font-semibold text-slate-800">
              {activeFolder.name}
            </span>
          )}
        </div>
        <div
          role="group"
          aria-label="Library view"
          className="inline-flex rounded-full border border-slate-200 bg-slate-100 p-1"
        >
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={location.view === "grid"}
            onClick={() => setView("grid")}
            className={cn(
              "h-7 rounded-full px-3 text-xs",
              location.view === "grid" && "bg-white text-blue-950 shadow-sm",
            )}
          >
            <Grid2X2 aria-hidden="true" />
            Grid
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={location.view === "list"}
            onClick={() => setView("list")}
            className={cn(
              "h-7 rounded-full px-3 text-xs",
              location.view === "list" && "bg-white text-blue-950 shadow-sm",
            )}
          >
            <List aria-hidden="true" />
            List
          </Button>
        </div>
      </div>
      <div aria-busy={loading} aria-live="polite">
        <DndContext
          sensors={sensors}
          collisionDetection={libraryCollisionDetection}
          onDragEnd={handleLibraryDragEnd}
        >
        {loading ? (
          <div
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-[repeat(auto-fill,16rem)]"
            aria-label="Loading library"
          >
            {[0, 1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-52 animate-pulse rounded-[22px] border border-slate-200 bg-slate-100 xl:aspect-square xl:h-auto xl:max-w-64"
              />
            ))}
          </div>
        ) : error ? (
          <div
            role="alert"
            className="rounded-[24px] border border-rose-200 bg-rose-50 p-8 text-center"
          >
            <AlertCircle className="mx-auto text-rose-600" aria-hidden="true" />
            <h3 className="mt-3 font-semibold">
              Automations could not be loaded
            </h3>
            <p className="mt-1 text-sm text-slate-600">{error}</p>
            <Button
              type="button"
              variant="outline"
              className={cn(secondary, "mt-4")}
              onClick={() => void load()}
            >
              <RotateCcw />
              Try again
            </Button>
          </div>
        ) : invalidFolder ? (
          <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
            <h3 className="font-semibold">Folder not found</h3>
            <p className="mt-1 text-sm text-slate-600">
              It may have been deleted or moved.
            </p>
            <Button
              type="button"
              className={cn(primary, "mt-4")}
              onClick={() => navigate({ ...location, folderId: null })}
            >
              Back to library
            </Button>
          </div>
        ) : location.view === "grid" ? (
          (activeFolder && visibleItems.length === 0) ||
          (!activeFolder && folders.length === 0 && items.length === 0) ? (
            <EmptyFolder
              compact={Boolean(activeFolder)}
              heading={
                activeFolder
                  ? "This folder is empty"
                  : "Your automation library is empty"
              }
              description={
                activeFolder
                  ? "Move an automation here or create one in this folder."
                  : "Create a folder or your first automation to get started."
              }
              className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50/70 py-40"
              action={
                <Button asChild className={primary}>
                  <Link href={builderHref("new")}>
                    <Plus />
                    New automation
                  </Link>
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-[repeat(auto-fill,16rem)]">
              {!activeFolder && (
                <SortableContext
                  items={orderedFolders.map((folder) => folderDragId(folder.id))}
                  strategy={rectSortingStrategy}
                >
                  {orderedFolders.map(folderCard)}
                </SortableContext>
              )}
              <SortableContext
                items={visibleItems.map((item) => automationDragId(item.id))}
                strategy={rectSortingStrategy}
              >
                {visibleItems.map((item) => automationCard(item))}
              </SortableContext>
            </div>
          )
        ) : (
          <div className="overflow-hidden rounded-[22px] border border-slate-200 bg-white">
            {orderedFolders.length === 0 && items.length === 0 ? (
              <EmptyFolder
                heading="Your automation library is empty"
                description="Create a folder or your first automation to get started."
              />
            ) : null}
            <SortableContext
              items={orderedFolders.map((folder) => folderDragId(folder.id))}
              strategy={verticalListSortingStrategy}
            >
              {orderedFolders.map((folder) => {
                const expanded = location.openIds.includes(folder.id)
                const children = groups.get(folder.id) ?? []
                return (
                  <SortableLibraryItem
                    key={folder.id}
                    id={folder.id}
                    kind="folder"
                    name={folder.name}
                    disabled={busy || orderedFolders.length < 2}
                    className="border-b border-slate-100 last:border-b-0"
                  >
                    {(handle) => (
                      <>
                        <div className="group flex items-center gap-2 bg-slate-50/70 px-3 py-2 hover:bg-blue-50/60">
                          {handle}
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            className="size-7 shrink-0"
                            aria-label={(expanded ? "Collapse " : "Expand ") + folder.name}
                            aria-expanded={expanded}
                            onClick={(event) => {
                              if (event.detail < 2) toggleOpen(folder.id)
                            }}
                          >
                            {expanded ? <ChevronDown /> : <ChevronRight />}
                          </Button>
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            onClick={(event) => {
                              if (event.detail < 2) toggleOpen(folder.id)
                            }}
                            aria-expanded={expanded}
                          >
                            <EmptyFolder
                              variant="row"
                              documentCount={children.length}
                              heading=""
                              description={null}
                              className="pointer-events-none"
                            />
                            <span className="block truncate text-sm font-semibold text-slate-900">
                              {folder.name}{" "}
                              <span className="font-normal text-slate-500">
                                ({children.length})
                              </span>
                            </span>
                          </button>
                          {folderMenu(folder)}
                        </div>
                        {expanded && (
                          <div className="ml-7 border-l border-slate-200 pl-3">
                            {children.length ? (
                              <SortableContext
                                items={children.map((item) => automationDragId(item.id))}
                                strategy={verticalListSortingStrategy}
                              >
                                {children.map((item) => (
                                  <div
                                    key={item.id}
                                    className="relative border-b border-slate-100 py-1 last:border-b-0 before:absolute before:-left-3 before:top-1/2 before:w-3 before:border-t before:border-slate-200"
                                  >
                                    {automationCard(item, true)}
                                  </div>
                                ))}
                              </SortableContext>
                            ) : (
                              <p className="py-4 text-xs text-slate-500">
                                No automations in this folder.
                              </p>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </SortableLibraryItem>
                )
              })}
            </SortableContext>
            <SortableContext
              items={(groups.get(null) ?? []).map((item) => automationDragId(item.id))}
              strategy={verticalListSortingStrategy}
            >
              {(groups.get(null) ?? []).map((item) => (
                <div
                  key={item.id}
                  className="border-t border-slate-100 px-3 py-1 first:border-t-0"
                >
                  {automationCard(item, true)}
                </div>
              ))}
            </SortableContext>
          </div>
        )}
        </DndContext>
      </div>

      <Dialog
        open={folderDialog !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setFolderDialog(null)
        }}
      >
        <DialogContent
          className={dialogClass}
          showCloseButton={!busy}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault()
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault()
          }}
        >
          <DialogHeader className="relative overflow-hidden border-b border-blue-100 bg-[#f1f7ff] px-6 py-6 text-left sm:px-7">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(30,64,175,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(30,64,175,.08)_1px,transparent_1px)] [background-size:42px_42px]"
            />
            <div className="relative pr-10">
              <p className="text-xs font-semibold text-blue-700">
                Automation library
              </p>
              <DialogTitle className="mt-1 text-xl font-semibold text-slate-950">
                {folderDialog === "create"
                  ? "Create a folder"
                  : "Rename folder"}
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm leading-6 text-slate-600">
                Keep related automations easy to find. Folder names must be
                unique in this workspace.
              </DialogDescription>
            </div>
          </DialogHeader>
          <form
            id="folder-form"
            onSubmit={(event) => {
              event.preventDefault()
              void saveFolder()
            }}
            className="min-h-0 overflow-y-auto overscroll-contain px-6 py-6 [scrollbar-gutter:stable] sm:px-7"
          >
            <Label
              htmlFor="folder-name"
              className="text-sm font-semibold text-slate-800"
            >
              Folder name <span className="text-rose-600">*</span>
            </Label>
            <Input
              id="folder-name"
              autoFocus
              required
              maxLength={81}
              value={folderName}
              onChange={(event) => {
                setFolderName(event.target.value)
                setFolderError("")
              }}
              aria-invalid={Boolean(folderError)}
              aria-describedby={folderError ? "folder-error" : undefined}
              className="mt-2 h-11 rounded-xl border-slate-200 bg-white"
            />
            {folderError && (
              <p
                id="folder-error"
                role="alert"
                className="mt-2 text-sm text-rose-700"
              >
                {folderError}
              </p>
            )}
          </form>
          <DialogFooter className="flex-row justify-end gap-2 border-t border-slate-100 bg-white px-6 py-4 sm:px-7">
            <Button
              type="button"
              variant="outline"
              className={secondary}
              disabled={busy}
              onClick={() => setFolderDialog(null)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="folder-form"
              className={primary}
              disabled={busy}
            >
              {busy && <Loader2 className="animate-spin" />}
              {folderDialog === "create" ? "Create folder" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteFolder !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleteFolder(null)
        }}
      >
        <DialogContent
          className={dialogClass}
          showCloseButton={!busy}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault()
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault()
          }}
        >
          <DialogHeader className="border-b border-rose-100 bg-rose-50 px-6 py-6 text-left">
            <p className="text-xs font-semibold text-rose-700">
              Automation library
            </p>
            <DialogTitle className="text-xl font-semibold text-slate-950">
              Delete folder
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-600">
              Delete “{deleteFolder?.name}”? Its{" "}
              {groups.get(deleteFolder?.id ?? "")?.length ?? 0} automations will
              move to the root. No automations or execution history will be
              deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto px-6 py-4 text-sm text-slate-600">
            This action cannot be undone.
          </div>
          <DialogFooter className="flex-row justify-end gap-2 border-t border-slate-100 px-6 py-4">
            <Button
              type="button"
              variant="outline"
              className={secondary}
              disabled={busy}
              onClick={() => setDeleteFolder(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-8 rounded-full px-3 text-xs font-semibold"
              disabled={busy}
              onClick={() => void removeFolder()}
            >
              {busy && <Loader2 className="animate-spin" />}Delete folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet
        open={orderOpen}
        onOpenChange={(open) => {
          if (!busy) setOrderOpen(open)
        }}
      >
        <SheetContent
          side="right"
          showCloseButton={!busy}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault()
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault()
          }}
          className="w-full gap-0 border-slate-200 bg-white p-0 sm:max-w-xl"
        >
          <SheetHeader className="border-b border-blue-100 bg-[#f1f7ff] px-6 py-6 text-left">
            <p className="text-xs font-semibold text-blue-700">
              Automation settings
            </p>
            <SheetTitle className="text-xl font-semibold text-slate-950">
              Execution order
            </SheetTitle>
            <SheetDescription className="text-sm leading-6 text-slate-600">
              This global priority is independent of folders and library order.
              Move an automation, then save the sequence.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 [scrollbar-gutter:stable]">
            {draftOrder.length === 0 ? (
              <p className="text-sm text-slate-500">No automations yet.</p>
            ) : (
              <ol className="space-y-2">
                {draftOrder.map((id, index) => {
                  const item = items.find((entry) => entry.id === id)
                  if (!item) return null
                  return (
                    <li
                      key={id}
                      className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3"
                    >
                      <span className="w-7 text-center text-xs font-bold tabular-nums text-blue-900">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">
                        {item.name}
                      </span>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        className={iconButton}
                        disabled={index === 0 || busy}
                        aria-label={"Move " + item.name + " up"}
                        onClick={() => shiftExecution(index, -1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        className={iconButton}
                        disabled={index === draftOrder.length - 1 || busy}
                        aria-label={"Move " + item.name + " down"}
                        onClick={() => shiftExecution(index, 1)}
                      >
                        <ArrowDown />
                      </Button>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
          <SheetFooter className="flex-row justify-end gap-2 border-t border-slate-100 px-6 py-4">
            <Button
              type="button"
              variant="outline"
              className={secondary}
              disabled={busy}
              onClick={() => setOrderOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className={primary}
              disabled={busy || draftOrder.length === 0}
              onClick={() => void saveOrder()}
            >
              {busy && <Loader2 className="animate-spin" />}Save order
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </section>
  )
}
