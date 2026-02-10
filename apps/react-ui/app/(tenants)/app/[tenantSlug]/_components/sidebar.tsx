
"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
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
  Heart,
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
  Sparkles,
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
  { key: "task", label: "Task", path: "/task", icon: ListChecks },
]

const SUPPORT_ITEMS: SidebarItem[] = [
  { key: "help", label: "Help", path: "/help", icon: HelpCircle },
]

type SidebarContentProps = {
  activeKey: string
  onNavigate?: (key: string, href: string) => void
  menuItems: SidebarLink[]
  supportItems: SidebarLink[]
}

function AppSidebarContent({
  activeKey,
  onNavigate,
  menuItems,
  supportItems,
}: SidebarContentProps) {
  return (
    <>
      <SidebarHeader className="px-4 py-3">
        <div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 text-white shadow-lg px-2">
            <Heart className="h-4 w-4" />
          </div>
          <div className="group-data-[collapsible=icon]:hidden">
            <h1 className="text-xl font-bold tracking-tight text-white">
              Gestiabloc
            </h1>
            <p className="text-xs font-medium text-indigo-200">
              Management Panel
            </p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 group-data-[collapsible=icon]:px-0">
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-indigo-200">
            Menu
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
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
                        "text-indigo-100 hover:bg-white/10 hover:text-white data-[active=true]:bg-white/20 data-[active=true]:text-white",
                        "group-data-[collapsible=icon]:size-10 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:[&>span]:hidden"
                      )}
                      onClick={() => onNavigate?.(item.key, item.href)}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <Link href={item.href}>
                        <Icon className="h-4 w-4 opacity-95" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="group-data-[collapsible=icon]:mt-auto">
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-indigo-200">
            Support
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
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
                        "text-indigo-100 hover:bg-white/10 hover:text-white data-[active=true]:bg-white/20 data-[active=true]:text-white",
                        "group-data-[collapsible=icon]:size-10 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:[&>span]:hidden"
                      )}
                      onClick={() => onNavigate?.(item.key, item.href)}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <Link href={item.href}>
                        <Icon className="h-4 w-4 opacity-95" />
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

      <SidebarFooter className="p-4 group-data-[collapsible=icon]:px-0">
        <div className="group-data-[collapsible=icon]:hidden">
          <div className="relative overflow-hidden rounded-2xl border border-white/20 bg-white/10 p-4 text-white shadow-lg">
            <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-white/10 blur-2xl transition-all group-hover:bg-white/20" />

            <div className="relative z-10 flex items-start gap-3">
              <div className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-white/15">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h4 className="mb-1 text-sm font-bold">Trial Plan</h4>
                <p className="mb-3 text-xs text-indigo-100/90">
                  Upgrade to unlock all features
                </p>

                <Button
                  type="button"
                  variant="secondary"
                  className="h-9 w-full border-0 bg-white/20 text-white hover:bg-white/30"
                  onClick={() => onNavigate?.("upgrade", "#")}
                >
                  Upgrade to Pro
                </Button>
              </div>
            </div>
          </div>
        </div>

        <SidebarMenu className="mt-2  group-data-[collapsible=icon]:flex  group-data-[collapsible=icon]:justify-center  group-data-[collapsible=icon]:items-center">
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => onNavigate?.("logout", "#")}
              tooltip="Logout"
              className={cn(
                "text-indigo-100 hover:bg-white/10 hover:text-white",
                "group-data-[collapsible=icon]:size-10 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:[&>span]:hidden"
              )}
            >
              <LogOut className="h-4 w-4 opacity-95" />
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
  activeKey?: string
  onNavigate?: (key: string, href: string) => void
  className?: string
}

export function AppSidebar({
  tenantSlug,
  activeKey,
  onNavigate,
  className,
}: AppSidebarProps) {
  const pathname = usePathname() ?? ""
  const { isMobile, setOpenMobile } = useSidebar()

  const resolvedTenantSlug = useMemo(() => {
    if (tenantSlug) {
      return tenantSlug
    }
    const match = pathname.match(/^\/app\/([^/]+)/)
    return match?.[1] ?? ""
  }, [tenantSlug, pathname])

  const basePath = useMemo(
    () => `/app/${resolvedTenantSlug}`,
    [resolvedTenantSlug],
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
    if (!pathname.startsWith(basePath)) {
      return "dashboard"
    }
    const rest = pathname.slice(basePath.length)
    if (!rest || rest === "/") {
      return "dashboard"
    }
    const match = [...menuItems, ...supportItems].find(
      (item) => item.path && rest.startsWith(item.path),
    )
    return match?.key ?? "dashboard"
  }, [pathname, basePath, menuItems, supportItems])

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
        "bg-transparent [&_[data-sidebar=sidebar]]:!bg-transparent",
        className,
      )}
    >
      <div className="flex h-full flex-col bg-gradient-to-b from-indigo-600 to-purple-700 text-white shadow-xl">
        <AppSidebarContent
          activeKey={activeKey ?? derivedActiveKey}
          onNavigate={handleNavigate}
          menuItems={menuItems}
          supportItems={supportItems}
        />
      </div>
    </Sidebar>
  )
}
