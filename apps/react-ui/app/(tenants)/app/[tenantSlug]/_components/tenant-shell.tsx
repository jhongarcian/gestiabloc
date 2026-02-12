"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import {
  Bell,
  ChevronRight,
  LogOut,
  Search,
  Settings,
  UserCog,
  WalletCards,
  X,
} from "lucide-react"

import { AppSidebar } from "./sidebar"
import { TenantUserProvider, type TenantUser } from "./tenant-context"
import { api } from "@/lib/api"

type TenantShellProps = {
  tenantSlug: string
  children: React.ReactNode
  user: TenantUser & { role?: string | null }
}

const formatSegment = (segment: string) =>
  segment.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())

const formatRole = (role?: string | null) =>
  role ? formatSegment(role.toLowerCase()) : null

const getInitials = (value: string) => {
  const parts = value.trim().split(/\s+/)
  if (!parts.length) return "U"
  const first = parts[0]?.[0] ?? ""
  const second = parts[1]?.[0] ?? ""
  return (first + second).toUpperCase() || "U"
}

export function TenantShell({ tenantSlug, children, user }: TenantShellProps) {
  const pathname = usePathname() ?? ""
  const [profileOpen, setProfileOpen] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)

  const resolvedTenantSlug = useMemo(() => {
    if (tenantSlug) return tenantSlug
    const match = pathname.match(/^\/app\/([^/]+)/)
    return match?.[1] ?? ""
  }, [tenantSlug, pathname])

  const basePath = useMemo(
    () => `/app/${resolvedTenantSlug}`,
    [resolvedTenantSlug],
  )
  const segments = useMemo(() => {
    if (!pathname.startsWith(basePath)) {
      return []
    }
    const rest = pathname.slice(basePath.length)
    return rest.split("/").filter(Boolean)
  }, [pathname, basePath])

  const crumbs = useMemo(() => {
    const items = [
      {
        label: "Dashboard",
        href: basePath,
      },
    ]
    if (segments.length === 0) {
      return items
    }
    let acc = basePath
    segments.forEach((segment) => {
      acc += `/${segment}`
      items.push({
        label: formatSegment(segment),
        href: acc,
      })
    })
    return items
  }, [segments, basePath])

  useEffect(() => {
    if (!user.image) {
      setAvatarUrl(null)
      return
    }

    if (user.image.startsWith("http")) {
      setAvatarUrl(user.image)
      return
    }

    const tenantId = user.memberships?.find(
      (item) => item.tenant?.slug === resolvedTenantSlug,
    )?.tenant?.id

    if (!tenantId) return

    const load = async () => {
      try {
        const { data } = await api.post("/api/files/presign-download", {
          tenantId,
          key: user.image,
        })
        if (data?.url) {
          setAvatarUrl(data.url)
        }
      } catch {
        // ignore
      }
    }

    void load()
  }, [user.image, user.memberships, resolvedTenantSlug])

  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{ imageUrl?: string }>
      if (customEvent.detail?.imageUrl) {
        setAvatarUrl(customEvent.detail.imageUrl)
      }
    }

    window.addEventListener("avatar-updated", handler as EventListener)
    return () => {
      window.removeEventListener("avatar-updated", handler as EventListener)
    }
  }, [])

  return (
    <SidebarProvider className="min-h-screen w-full bg-slate-50">
      <AppSidebar tenantSlug={tenantSlug} className="md:h-full" />

      <SidebarInset className="min-w-0 bg-slate-50">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md supports-backdrop-filter:bg-white/70">
          <div className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between ">
            <div className="flex flex-1 items-center gap-3">
              <SidebarTrigger className="h-9 w-9 cursor-pointer" />
              <Breadcrumb>
                <BreadcrumbList>
                  {crumbs.map((crumb, index) => {
                    const isLast = index === crumbs.length - 1
                    return (
                      <div key={crumb.href} className="contents">
                        <BreadcrumbItem>
                          {isLast ? (
                            <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                          ) : (
                            <BreadcrumbLink asChild>
                              <Link href={crumb.href}>{crumb.label}</Link>
                            </BreadcrumbLink>
                          )}
                        </BreadcrumbItem>
                        {!isLast && <BreadcrumbSeparator />}
                      </div>
                    )
                  })}
                </BreadcrumbList>
              </Breadcrumb>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-md min-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search..."
                  className="pl-9"
                  aria-label="Search"
                />
              </div>

              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 cursor-pointer text-slate-500 transition hover:text-slate-700"
                aria-label="Notifications"
              >
                <Bell className="h-5 w-5" />
              </Button>

              <button
                type="button"
                onClick={() => setProfileOpen(true)}
                className="rounded-full cursor-pointer transition focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-slate-100"
                aria-label="Open profile"
              >
                <Avatar className="h-9 w-9">
                  {avatarUrl || user.image ? (
                    <AvatarImage
                      src={avatarUrl ?? user.image ?? ""}
                      alt={user.name}
                      className="object-cover"
                    />
                  ) : null}
                  <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                </Avatar>
              </button>
            </div>
          </div>
        </header>

        <div className="px-4 py-4 md:py-6 md:px-6 bg-slate-100 ">
          <TenantUserProvider user={user}>{children}</TenantUserProvider>
        </div>
      </SidebarInset>

      <Sheet open={profileOpen} onOpenChange={setProfileOpen}>
        <SheetContent
          side="right"
          className="w-sm border-none p-0"
          showCloseButton={false}
        >
          <SheetClose className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-sm transition-all hover:bg-white/30 cursor-pointer">
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </SheetClose>
          <div className="flex h-full flex-col">
            <SheetTitle className="sr-only">Profile</SheetTitle>
            <div className="relative flex flex-col items-center gap-4 bg-linear-to-br from-blue-950 to-blue-900 px-6 py-14 text-center text-white">
              <Avatar className="h-20 w-20 border-4 border-white/70 bg-white/10">
                {avatarUrl || user.image ? (
                  <AvatarImage
                    src={avatarUrl ?? user.image ?? ""}
                    alt={user.name}
                    className="object-cover"
                  />
                ) : null}
                <AvatarFallback className="text-white font-bold text-lg bg-transparent ">
                  {getInitials(user.name)}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="text-xl font-semibold">{user.name}</p>
                {formatRole(user.role) ? (
                  <p className="text-sm text-indigo-100">
                    {formatRole(user.role)}
                  </p>
                ) : null}
              </div>
              <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-1 text-xs font-medium">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Active Now
              </span>
            </div>

            <div className="flex-1 px-6 py-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Menu
              </p>
              <div className="mt-4 space-y-2">
                <Link
                  href={`${basePath}/profile`}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                  onClick={() => setProfileOpen(false)}
                >
                  <div className="flex items-center gap-3">
                    <UserCog className="h-4 w-4 text-slate-500" />
                    <span>Profile</span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </Link>

                <Link
                  href={`${basePath}/account-settings`}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                  onClick={() => setProfileOpen(false)}
                >
                  <div className="flex items-center gap-3">
                    <Settings className="h-4 w-4 text-slate-500" />
                    <span>Account Settings</span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </Link>

                <Link
                  href={`${basePath}/subscription`}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                  onClick={() => setProfileOpen(false)}
                >
                  <div className="flex items-center gap-3">
                    <WalletCards className="h-4 w-4 text-slate-500" />
                    <span>Subscription</span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </Link>
              </div>
            </div>

            <div className="mt-auto border-t border-slate-200 px-6 py-4">
              <button
                type="button"
                className="flex w-full items-center gap-3 px-1 py-2 text-left text-sm font-semibold text-rose-600 transition hover:text-rose-700"
              >
                <LogOut className="h-4 w-4" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </SidebarProvider>
  )
}
