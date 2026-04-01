"use client"

import Link from "next/link"
import {
  ChevronDown,
  Clock3,
  ListTodo,
  NotebookPen,
  PanelRightClose,
  PanelRightOpen,
  Tags,
  Users,
} from "lucide-react"
import { useSyncExternalStore } from "react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { ContactTagsSection } from "./contact-tags-section"

type RelationshipType =
  | "FATHER"
  | "MOTHER"
  | "PARENT"
  | "SON"
  | "DAUGHTER"
  | "CHILD"
  | "HUSBAND"
  | "WIFE"
  | "SPOUSE"
  | "PARTNER"
  | "BROTHER"
  | "SISTER"
  | "SIBLING"
  | "GRANDFATHER"
  | "GRANDMOTHER"
  | "GRANDPARENT"
  | "GRANDSON"
  | "GRANDDAUGHTER"
  | "GRANDCHILD"
  | "UNCLE"
  | "AUNT"
  | "AUNT_OR_UNCLE"
  | "NEPHEW"
  | "NIECE"
  | "NIECE_OR_NEPHEW"
  | "COUSIN"
  | "GUARDIAN"
  | "WARD"
  | "CAREGIVER"
  | "DEPENDENT"
  | "FRIEND"
  | "OTHER"

type RelationshipRecord = {
  id: string
  relatedContactId: string
  relationshipType: RelationshipType
  relationshipLabel: string
  relatedContact: {
    id: string
    fullName: string
    phoneNumber: string | null
    email: string | null
  }
}

type ContactTag = {
  id: string
  name: string
  bgColor: string
  textColor: string
  sortOrder: number
}

type ContactSupportingSidebarProps = {
  tenantId: string
  tenantSlug: string
  contactId: string
  initialRelationships: RelationshipRecord[]
  initialTags: ContactTag[]
  canManageTags: boolean
  activeFollowUpCount: number
}

const COLLAPSED_ITEMS = [
  {
    key: "relationships",
    label: "Relationships",
    icon: Users,
    className:
      "border-blue-100 bg-slate-50 text-slate-700 hover:border-blue-200 hover:bg-slate-100 hover:text-slate-900",
  },
  {
    key: "tags",
    label: "Tags",
    icon: Tags,
    className:
      "border-orange-100 bg-slate-50 text-slate-700 hover:border-orange-200 hover:bg-slate-100 hover:text-slate-900",
  },
  {
    key: "followups",
    label: "Follow Ups",
    icon: Clock3,
    className:
      "border-amber-100 bg-slate-50 text-slate-700 hover:border-amber-200 hover:bg-slate-100 hover:text-amber-800",
  },
] as const

const COLLAPSED_SHORTCUTS = [
  {
    key: "task",
    label: "Add Task",
    icon: ListTodo,
    href: "tasks",
    className:
      "border-cyan-200 bg-cyan-50 text-cyan-700 hover:border-cyan-300 hover:bg-cyan-100 hover:text-cyan-800",
  },
  {
    key: "note",
    label: "Add Note",
    icon: NotebookPen,
    href: "notes",
    className:
      "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 hover:border-fuchsia-300 hover:bg-fuchsia-100 hover:text-fuchsia-800",
  },
] as const

const SIDEBAR_STORAGE_KEY = "contact-supporting-sidebar-open"
const SIDEBAR_STORAGE_EVENT = "contact-supporting-sidebar:change"

function subscribeToSidebarPreference(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {}
  }

  const handleChange = () => onStoreChange()

  window.addEventListener("storage", handleChange)
  window.addEventListener(SIDEBAR_STORAGE_EVENT, handleChange)

  return () => {
    window.removeEventListener("storage", handleChange)
    window.removeEventListener(SIDEBAR_STORAGE_EVENT, handleChange)
  }
}

function getSidebarPreferenceSnapshot() {
  if (typeof window === "undefined") return true
  return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) !== "false"
}

function getSidebarPreferenceServerSnapshot() {
  return true
}

export function ContactSupportingSidebar({
  tenantId,
  tenantSlug,
  contactId,
  initialRelationships,
  initialTags,
  canManageTags,
  activeFollowUpCount,
}: ContactSupportingSidebarProps) {
  const open = useSyncExternalStore(
    subscribeToSidebarPreference,
    getSidebarPreferenceSnapshot,
    getSidebarPreferenceServerSnapshot,
  )

  const setOpen = (nextOpen: boolean) => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(nextOpen))
    window.dispatchEvent(new Event(SIDEBAR_STORAGE_EVENT))
  }

  return (
    <TooltipProvider delayDuration={120}>
      <aside
        className={cn(
          "flex h-full min-h-0 flex-col rounded-2xl border border-white/60 bg-white/45 shadow-[0_18px_48px_rgba(15,23,42,0.10)] backdrop-blur-xl transition-all duration-200 lg:sticky lg:top-20 lg:self-stretch lg:max-h-[calc(100vh-6rem)]",
          open ? "w-full lg:w-[340px]" : "w-full lg:w-[64px]",
        )}
      >
      <div
        className={cn(
          "flex items-center border-b border-white/60 bg-white/20 backdrop-blur-md",
          open ? "justify-between px-4 py-4" : "justify-center px-2 py-4",
        )}
      >
        {open ? (
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              Quick View
            </p>
            <p className="text-sm font-semibold text-slate-950">Supporting sections</p>
          </div>
        ) : null}
        {open ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="cursor-pointer rounded-xl border border-white/40 bg-white/35 text-slate-500 shadow-sm backdrop-blur-md hover:bg-white/55 hover:text-slate-900"
            onClick={() => setOpen(!open)}
            aria-label="Collapse supporting sidebar"
          >
            <PanelRightClose className="h-4 w-4" />
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="cursor-pointer rounded-xl border border-white/40 bg-white/35 text-slate-500 shadow-sm backdrop-blur-md hover:bg-white/55 hover:text-slate-900"
                onClick={() => setOpen(!open)}
                aria-label="Expand supporting sidebar"
              >
                <PanelRightOpen className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Open quick view</TooltipContent>
          </Tooltip>
        )}
      </div>

      {open ? (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pt-3 pb-4">
          <Link
            href={`/app/${tenantSlug}/contacts/${contactId}/relationships`}
            className="flex items-start justify-between gap-3 rounded-xl border border-white/60 bg-white/40 px-3.5 py-3 text-sm text-slate-700 shadow-sm backdrop-blur-md transition hover:bg-white/60 hover:text-slate-900"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-slate-500" />
                <span className="font-medium text-slate-900">Relationships</span>
              </div>
              <p className="text-xs leading-5 text-slate-500">
                {initialRelationships.length > 0
                  ? `${initialRelationships.length} connected contact${initialRelationships.length === 1 ? "" : "s"}`
                  : "View and manage connected contacts"}
              </p>
            </div>
            <span className="rounded-full border border-slate-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-950">
              {initialRelationships.length}
            </span>
          </Link>

          <ContactTagsSection
            tenantId={tenantId}
            contactId={contactId}
            initialTags={initialTags}
            canManageTags={canManageTags}
          />

          <details className="group rounded-lg py-1">
            <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl border border-transparent px-2.5 py-2.5 text-sm font-medium text-slate-900 transition hover:border-white/50 hover:bg-white/35">
              <span className="flex items-center gap-2">
                <ChevronDown className="h-4 w-4 text-slate-400 transition group-open:rotate-180" />
                Follow Ups
                <span className="rounded-full border border-slate-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-950">
                  {activeFollowUpCount}
                </span>
              </span>
            </summary>
            <p className="mt-1 pl-8 text-sm leading-6 text-slate-500">
              No follow-up activity available yet.
            </p>
          </details>

          <div className="mx-1 h-px bg-white/70" />

          <div className="grid gap-2">
            <Link
              href={`/app/${tenantSlug}/contacts/${contactId}/tasks`}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/60 bg-white/40 px-3 text-sm font-medium text-slate-700 shadow-sm backdrop-blur-md transition hover:bg-white/60 hover:text-slate-900"
            >
              <ListTodo className="h-4 w-4" />
              Add Task
            </Link>
            <Link
              href={`/app/${tenantSlug}/contacts/${contactId}/notes`}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/60 bg-white/40 px-3 text-sm font-medium text-slate-700 shadow-sm backdrop-blur-md transition hover:bg-white/60 hover:text-slate-900"
            >
              <NotebookPen className="h-4 w-4" />
              Add Note
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center gap-3 px-2 pt-4 pb-5">
          {COLLAPSED_ITEMS.map((item) => {
            const Icon = item.icon
            if (item.key === "relationships") {
              return (
                <Tooltip key={item.key}>
                  <TooltipTrigger asChild>
                    <Link
                      href={`/app/${tenantSlug}/contacts/${contactId}/relationships`}
                      className={cn(
                        "flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border transition",
                        item.className,
                      )}
                      aria-label={item.label}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    {item.label} ({initialRelationships.length})
                  </TooltipContent>
                </Tooltip>
              )
            }
            return (
              <Tooltip key={item.key}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border transition",
                      item.className,
                    )}
                    aria-label={`Open ${item.label}`}
                    onClick={() => setOpen(true)}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">
                  {item.key === "followups"
                    ? `${item.label} (${activeFollowUpCount})`
                    : item.label}
                </TooltipContent>
              </Tooltip>
            )
          })}

          <div className="mt-2 h-px w-8 bg-white/70" />

          {COLLAPSED_SHORTCUTS.map((item) => {
            const Icon = item.icon
            return (
              <Tooltip key={item.key}>
                <TooltipTrigger asChild>
                  <Link
                    href={`/app/${tenantSlug}/contacts/${contactId}/${item.href}`}
                    className={cn(
                      "flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border transition",
                      item.className,
                    )}
                    aria-label={item.label}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="left">{item.label}</TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      )}
      </aside>
    </TooltipProvider>
  )
}
