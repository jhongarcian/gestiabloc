"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { createContext, useContext, type ReactNode } from "react"
import {
  BarChart3,
  Building2,
  ChevronRight,
  Layers3,
  Settings2,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { type AiSkillDraft, type AiWorkspaceDraft } from "../_lib/demo-data"
import type { AiHelperSettings } from "../_lib/helper-settings"
import { useHelperSettings } from "./use-helper-settings"
import { AiHelperAvatar } from "./ai-helper-avatar"
import { AiTestChat } from "./ai-test-chat"
import type { AccountProfileResponse } from "@/lib/account-profile"
import { useAccountProfile } from "../../_components/use-account-profile"
import { useAiSkills } from "./use-ai-skills"
import { useAiFaqs } from "./use-ai-faqs"
import { useAiSources } from "./use-ai-sources"
import {
  toSkillDraft,
  type AiSkillResponse,
  type AiSkillsResponse,
} from "../_lib/skills"

type WorkspaceContext = ReturnType<typeof useHelperSettings> &
  ReturnType<typeof useAiSources> &
  ReturnType<typeof useAiFaqs> &
  ReturnType<typeof useAiSkills> & {
    basePath: string
    companyName: string
    companyProfile: ReturnType<typeof useAccountProfile>
    draft: AiWorkspaceDraft
    setHelper: (helper: AiWorkspaceDraft["helper"]) => void
  }

const AiContext = createContext<WorkspaceContext | null>(null)
const AiSkillRouteContext = createContext<AiSkillResponse | null>(null)
export function AiSkillRouteProvider({
  detail,
  children,
}: {
  detail: AiSkillResponse
  children: ReactNode
}) {
  return <AiSkillRouteContext value={detail}>{children}</AiSkillRouteContext>
}
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
  const route = useContext(AiSkillRouteContext)
  const skill =
    workspace.draft.skills.find((item) => item.id === id) ??
    (route?.skill.id === id ? toSkillDraft(route.skill) : undefined)
  if (!skill) throw new Error("Skill data is required")
  return {
    ...workspace,
    skill,
    fieldCatalog:
      workspace.fieldsBySkill[id] ?? route?.fields ?? workspace.fields,
    updateSkill: (
      skillId: string,
      update: (current: AiSkillDraft) => AiSkillDraft,
    ) => workspace.updateSkill(skillId, update, skill),
  }
}

export function AiWorkspace({
  tenantSlug,
  tenantId,
  companyName,
  initialCompany,
  initialSettings,
  initialCatalog,
  children,
}: {
  tenantSlug: string
  tenantId: string
  companyName: string
  initialCompany: AccountProfileResponse["tenant"] | null
  initialSettings: AiHelperSettings | null
  initialCatalog: AiSkillsResponse | null
  children: ReactNode
}) {
  const pathname = usePathname()
  const skillState = useAiSkills(tenantId, initialCatalog)
  const faqState = useAiFaqs(tenantId)
  const sourceState = useAiSources(tenantId)
  const helperState = useHelperSettings(tenantId, initialSettings)
  const companyProfile = useAccountProfile(tenantId, initialCompany, "company")
  const draft = { skills: skillState.skills, helper: helperState.helper }
  const basePath = `/app/${tenantSlug}/account-settings/ai`
  const helperName = draft.helper.name.trim() || "AI Helper"

  const context: WorkspaceContext = {
    ...helperState,
    ...skillState,
    ...faqState,
    ...sourceState,
    basePath,
    companyName: companyProfile.savedProfile?.name ?? companyName,
    companyProfile,
    draft,
  }

  return (
    <AiContext value={context}>
      <div className="grid min-h-0 min-w-0 flex-1 items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="min-w-0 rounded-[26px] border border-slate-200 bg-white lg:sticky lg:top-4">
          <div className="flex items-center gap-3 p-4 lg:flex-col lg:items-start lg:gap-4 lg:p-5">
            <AiHelperAvatar
              avatar={helperState.savedHelper?.avatar}
              name={helperName}
              className="lg:size-12"
            />
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
                {helperState.helperReady ? "Account helper" : "Unavailable"}
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
          <div className="px-3 pb-3">
            <AiTestChat
              tenantId={tenantId}
              basePath={basePath}
              helper={helperState.savedHelper}
            />
          </div>
          <div className="hidden flex-col gap-2 px-5 pt-3 pb-5 lg:flex">
            <Separator className="mb-2" />
            <p className="text-xs leading-5 text-slate-500">
              One helper. Shared company knowledge. A skill for every service.
            </p>
          </div>
        </aside>
        <div className="flex min-w-0 flex-col gap-4 pb-6">
          <Alert className="rounded-2xl border-blue-100 bg-blue-50/70">
            <AlertTitle>
              {pathname.endsWith("/company-info")
                ? "Company information is shared with your account"
                : pathname.endsWith("/settings")
                  ? "Helper settings are saved to your account"
                  : pathname.endsWith("/qualification-rules")
                    ? "Qualification rules are connected"
                    : pathname.endsWith("/faq") ||
                        pathname.endsWith("/knowledge-base")
                      ? "Service knowledge is connected"
                      : pathname.endsWith("/analytics")
                        ? "Analytics preview — sample data"
                        : "Your account’s service skills"}
            </AlertTitle>
            <AlertDescription>
              {pathname.endsWith("/company-info")
                ? "Save changes to update Company Info and Account Settings together. Use Test helper to try the saved company context."
                : pathname.endsWith("/settings")
                  ? "Avatar changes save immediately. Save your helper’s name and preferences, then use Test helper to try them in a conversation."
                  : pathname.endsWith("/qualification-rules")
                    ? "Save changes to update the deterministic fit scan. Knowledge, verification, and other service settings are preserved."
                    : pathname.endsWith("/faq") ||
                        pathname.endsWith("/knowledge-base")
                      ? "Saved FAQs, guidance, and ready sources are available to Test helper. Files are stored privately for your account."
                      : pathname.endsWith("/analytics")
                        ? "These metrics use sample data. Real activity tracking will be connected in a later chunk."
                        : "Sub-services and linked notes come from your service catalog. Saved FAQs, knowledge, sources, and qualification rules are connected."}
            </AlertDescription>
          </Alert>
          {children}
        </div>
      </div>
    </AiContext>
  )
}
