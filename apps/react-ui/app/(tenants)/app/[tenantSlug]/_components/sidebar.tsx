
"use client"

import Link from "next/link"
import { useSelectedLayoutSegments } from "next/navigation"
import type { ComponentType } from "react"
import { useCallback, useMemo } from "react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar"

import {
  PanelsTopLeft,
  LayoutGrid,
  Contact2,
  CreditCard,
  RotateCw,
  Calendar,
  Target,
  Briefcase,
  ListChecks,
  HelpCircle,
  LogOut,
  ArrowUpCircle,
} from "lucide-react"

type SidebarItem = {
  key: string
  label: string
  path: string
  icon: ComponentType<{ className?: string }>
}

type SidebarLink = SidebarItem & { href: string }

const MENU_ITEMS: SidebarItem[] = [
  { key: "dashboard", label: "Dashboard", path: "", icon: LayoutGrid },
  { key: "contacts", label: "Contacts", path: "/contacts", icon: Contact2 },
  { key: "billing", label: "Billing", path: "/billing", icon: CreditCard },
  { key: "followups", label: "Followups", path: "/followups", icon: RotateCw },
  { key: "calendar", label: "Calendar", path: "/calendar", icon: Calendar },
  { key: "opportunities", label: "Opportunities", path: "/opportunities", icon: Target },
  { key: "services", label: "Services", path: "/services", icon: Briefcase },
  { key: "tasks", label: "Tasks", path: "/tasks", icon: ListChecks },
]

const SUPPORT_ITEMS: SidebarItem[] = [
  { key: "help", label: "Help", path: "/help", icon: HelpCircle },
]

type SidebarContentProps = {
  activeKey: string
  tenantName: string
  onNavigate?: (key: string, href: string) => void
  menuItems: SidebarLink[]
  supportItems: SidebarLink[]
  planKey?: string
  isAdmin?: boolean
  basePath: string
}

function AppSidebarContent({
  activeKey,
  tenantName,
  onNavigate,
  menuItems,
  supportItems,
  planKey,
  isAdmin,
  basePath,
}: SidebarContentProps) {
  return (
    <>
      <SidebarHeader className="px-4 pt-5 pb-3 group-data-[collapsible=icon]:px-1">
        <Link
          href={basePath}
          className="flex items-center gap-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-white/60 group-data-[collapsible=icon]:justify-center"
          onClick={() => onNavigate?.("dashboard", basePath)}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-white">
            <PanelsTopLeft className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 group-data-[collapsible=icon]:hidden">
            <span className="block truncate text-base font-semibold tracking-tight text-white">
              Gestiabloc
            </span>
            <span className="mt-0.5 block truncate text-xs leading-5 text-slate-300">
              {tenantName}
            </span>
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-3 group-data-[collapsible=icon]:px-0">
        <SidebarGroup className="px-0 py-3">
          <SidebarGroupLabel className="px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-100/80">
            Workspace
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {menuItems.map((item) => {
                const Icon = item.icon
                const isActive = item.key === activeKey
                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.label}
                      className={cn(
                        "min-h-11 gap-3 rounded-xl px-2.5 text-sm text-slate-300 hover:bg-white/10 hover:text-white focus-visible:ring-white/60 data-[active=true]:bg-white/10 data-[active=true]:font-semibold data-[active=true]:text-white",
                        "group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-11! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0! group-data-[collapsible=icon]:[&>span:last-child]:hidden",
                      )}
                      onClick={() => onNavigate?.(item.key, item.href)}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <Link href={item.href}>
                        <span
                          className={cn(
                            "flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors",
                            isActive
                              ? "border-white bg-white text-slate-950"
                              : "border-white/15 bg-white/5 text-slate-300",
                          )}
                        >
                          <Icon className="size-3.5" aria-hidden="true" />
                        </span>
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-auto px-0 py-3">
          <SidebarGroupLabel className="px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-100/80">
            Support
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {supportItems.map((item) => {
                const Icon = item.icon
                const isActive = item.key === activeKey
                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.label}
                      className={cn(
                        "min-h-11 gap-3 rounded-xl px-2.5 text-sm text-slate-300 hover:bg-white/10 hover:text-white focus-visible:ring-white/60 data-[active=true]:bg-white/10 data-[active=true]:font-semibold data-[active=true]:text-white",
                        "group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-11! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0! group-data-[collapsible=icon]:[&>span:last-child]:hidden",
                      )}
                      onClick={() => onNavigate?.(item.key, item.href)}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <Link href={item.href}>
                        <span
                          className={cn(
                            "flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors",
                            isActive
                              ? "border-white bg-white text-slate-950"
                              : "border-white/15 bg-white/5 text-slate-300",
                          )}
                        >
                          <Icon className="size-3.5" aria-hidden="true" />
                        </span>
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator className="mx-4 bg-white/10" />

      <SidebarFooter className="p-4 pt-3 group-data-[collapsible=icon]:px-0">
        <div className="group-data-[collapsible=icon]:hidden">
          {isAdmin && planKey && planKey !== "BUSINESS" ? (
            <div className="rounded-xl border border-white/15 bg-white/5 p-4 text-white">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-semibold">
                    {planKey === "STARTER" ? "Basic Plan" : "Pro Plan"}
                  </h4>
                  <p className="mt-1 mb-3 text-xs leading-5 text-slate-300">
                    Upgrade to unlock more features
                  </p>

                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    onClick={() => onNavigate?.("subscription", `${basePath}/account-settings/subscription`)}
                  >
                    <ArrowUpCircle data-icon="inline-start" />
                    {planKey === "STARTER" ? "Upgrade to Pro" : "Upgrade to Business"}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <SidebarMenu className="mt-2 group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:justify-center">
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => onNavigate?.("logout", "#")}
              tooltip="Logout"
              className={cn(
                "min-h-11 cursor-pointer gap-3 rounded-xl px-2.5 text-sm text-slate-300 hover:bg-white/10 hover:text-white focus-visible:ring-white/60",
                "group-data-[collapsible=icon]:size-11! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0! group-data-[collapsible=icon]:[&>span:last-child]:hidden",
              )}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-slate-300">
                <LogOut className="size-3.5" aria-hidden="true" />
              </span>
              <span>Logout</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  )
}

/**
 * Responsive Sidebar:
 * - Desktop (md+): static sidebar
 * - Mobile: shadcn Sheet
 */
type AppSidebarProps = {
  tenantSlug: string
  tenantName: string
  activeKey?: string
  onNavigate?: (key: string, href: string) => void
  className?: string
  planKey?: string
  isAdmin?: boolean
}

export function AppSidebar({
  tenantSlug,
  tenantName,
  activeKey,
  onNavigate,
  className,
  planKey,
  isAdmin,
}: AppSidebarProps) {
  const selectedSegments = useSelectedLayoutSegments()
  const { isMobile, setOpenMobile } = useSidebar()
  const segments = useMemo(
    () => selectedSegments.filter((segment) => !segment.startsWith("(")),
    [selectedSegments],
  )

  const basePath = useMemo(
    () => `/app/${tenantSlug}`,
    [tenantSlug],
  )
  const resolveHref = useCallback(
    (path: string) => (path ? `${basePath}${path}` : basePath),
    [basePath],
  )

  const menuItems = useMemo(
    () => MENU_ITEMS.map((item) => ({ ...item, href: resolveHref(item.path) })),
    [resolveHref],
  )
  const supportItems = useMemo(
    () =>
      SUPPORT_ITEMS.map((item) => ({ ...item, href: resolveHref(item.path) })),
    [resolveHref],
  )

  const derivedActiveKey = useMemo(() => {
    const firstSegment = segments[0]

    if (!firstSegment) {
      return "dashboard"
    }
    const match = [...menuItems, ...supportItems].find(
      (item) => item.path.replace(/^\//, "") === firstSegment,
    )
    return match?.key ?? "dashboard"
  }, [segments, menuItems, supportItems])

  const handleNavigate = useCallback(
    (key: string, href: string) => {
      onNavigate?.(key, href)
      if (isMobile) {
        setOpenMobile(false)
      }
    },
    [onNavigate, isMobile, setOpenMobile],
  )

  return (
    <Sidebar
      collapsible="icon"
      className={cn(
        "bg-transparent **:data-[sidebar=sidebar]:bg-transparent!",
        className,
      )}
    >
      <div className="relative isolate flex h-full flex-col overflow-hidden bg-[#0b1730] text-white">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:42px_42px]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 bottom-10 size-64 rounded-full bg-[#2f68ff]/25 blur-3xl"
        />

        <div className="relative flex min-h-0 flex-1 flex-col">
          <AppSidebarContent
            activeKey={activeKey ?? derivedActiveKey}
            tenantName={tenantName}
            onNavigate={handleNavigate}
            menuItems={menuItems}
            supportItems={supportItems}
            planKey={planKey}
            isAdmin={isAdmin}
            basePath={basePath}
          />
        </div>
      </div>
    </Sidebar>
  )
}
