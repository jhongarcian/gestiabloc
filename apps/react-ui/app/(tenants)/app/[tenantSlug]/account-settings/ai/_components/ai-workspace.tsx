"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { createContext, useContext, useState, type ReactNode } from "react"
import {
  BarChart3,
  Bot,
  Building2,
  ChevronRight,
  Layers3,
  Settings2,
} from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import {
  createSampleWorkspace,
  draftSnapshots,
  type AiSkillDraft,
  type AiWorkspaceDraft,
} from "../_lib/demo-data"

type WorkspaceContext = {
  basePath: string
  draft: AiWorkspaceDraft
  setHelper: (helper: AiWorkspaceDraft["helper"]) => void
  setCompany: (company: AiWorkspaceDraft["company"]) => void
  updateSkill: (
    id: string,
    update: (skill: AiSkillDraft) => AiSkillDraft,
  ) => void
  hasChanges: (key: string, value: unknown) => boolean
  saveDraft: (key: string, value: unknown) => void
}

const AiContext = createContext<WorkspaceContext | null>(null)
const navigation = [
  { key: "skills", label: "Skills", icon: Layers3 },
  { key: "company-info", label: "Company Info", icon: Building2 },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "settings", label: "Settings", icon: Settings2 },
]

export function useAiWorkspace() {
  const context = useContext(AiContext)
  if (!context) throw new Error("AI workspace provider is required")
  return context
}

export function useAiSkill(id: string) {
  const workspace = useAiWorkspace()
  const skill = workspace.draft.skills.find((item) => item.id === id)
  if (!skill) throw new Error("Unknown sample skill")
  return { ...workspace, skill }
}

export function AiWorkspace({
  tenantSlug,
  children,
}: {
  tenantSlug: string
  children: ReactNode
}) {
  const pathname = usePathname()
  const [draft, setDraft] = useState(createSampleWorkspace)
  const [saved, setSaved] = useState(() => draftSnapshots(draft))
  const basePath = `/app/${tenantSlug}/account-settings/ai`
  const helperName = draft.helper.name.trim() || "AI Helper"

  const context: WorkspaceContext = {
    basePath,
    draft,
    setHelper: (helper) => setDraft((current) => ({ ...current, helper })),
    setCompany: (company) => setDraft((current) => ({ ...current, company })),
    updateSkill: (id, update) =>
      setDraft((current) => ({
        ...current,
        skills: current.skills.map((skill) =>
          skill.id === id ? update(skill) : skill,
        ),
      })),
    hasChanges: (key, value) => saved[key] !== JSON.stringify(value),
    saveDraft: (key, value) => {
      const snapshot = JSON.stringify(value)
      if (saved[key] === snapshot) return
      setSaved((current) => ({ ...current, [key]: snapshot }))
      toast.success("Draft saved for this preview.", {
        description:
          "Changes reset when you refresh or leave the AI workspace.",
      })
    },
  }

  return (
    <AiContext value={context}>
      <div className="grid min-h-0 min-w-0 flex-1 items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="min-w-0 rounded-[26px] border border-slate-200 bg-white lg:sticky lg:top-4">
          <div className="flex items-center gap-3 p-4 lg:flex-col lg:items-start lg:gap-4 lg:p-5">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-blue-950 text-white lg:size-12">
              <Bot className="size-6" aria-hidden="true" />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-xs font-medium text-slate-500">
                Your AI helper
              </p>
              <p
                className="truncate text-lg font-semibold text-slate-950"
                title={helperName}
              >
                {helperName}
              </p>
              <Badge
                variant="secondary"
                className="hidden w-fit lg:inline-flex"
              >
                Preview
              </Badge>
            </div>
            <Link
              href={`${basePath}/settings`}
              aria-label="Edit AI helper settings"
              className="ml-auto rounded-full p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 lg:hidden"
            >
              <Settings2 className="size-4" aria-hidden="true" />
            </Link>
          </div>
          <Separator />
          <nav
            aria-label="AI workspace sections"
            className="flex gap-1 overflow-x-auto p-2 lg:flex-col lg:p-3"
          >
            {navigation.map(({ key, label, icon: Icon }) => {
              const href = `${basePath}/${key}`
              const active =
                pathname === href || pathname.startsWith(`${href}/`)
              return (
                <Link
                  key={key}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-xl px-2 py-2.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 sm:px-3 sm:text-sm",
                    active
                      ? "bg-blue-50 text-blue-950"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-950",
                  )}
                >
                  <Icon
                    className="hidden size-4 shrink-0 sm:block"
                    aria-hidden="true"
                  />
                  <span>{label}</span>
                  {active ? (
                    <ChevronRight
                      className="ml-auto hidden size-3.5 lg:block"
                      aria-hidden="true"
                    />
                  ) : null}
                </Link>
              )
            })}
          </nav>
          <div className="hidden flex-col gap-2 px-5 pt-3 pb-5 lg:flex">
            <Separator className="mb-2" />
            <p className="text-xs leading-5 text-slate-500">
              One helper. Shared company knowledge. A skill for every service.
            </p>
          </div>
        </aside>
        <div className="flex min-w-0 flex-col gap-4 pb-6">
          <Alert className="rounded-2xl border-blue-100 bg-blue-50/70">
            <AlertTitle>UI preview — changes are temporary</AlertTitle>
            <AlertDescription>
              All content is sample data. Drafts reset when you refresh or leave
              this workspace.
            </AlertDescription>
          </Alert>
          {children}
        </div>
      </div>
    </AiContext>
  )
}
