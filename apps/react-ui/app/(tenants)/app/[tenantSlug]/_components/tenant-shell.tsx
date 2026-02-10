"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useMemo } from "react"

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
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Bell, Search } from "lucide-react"

import { AppSidebar } from "./sidebar"

type TenantShellProps = {
  tenantSlug: string
  children: React.ReactNode
}

const formatSegment = (segment: string) =>
  segment.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())

export function TenantShell({ tenantSlug, children }: TenantShellProps) {
  const pathname = usePathname() ?? ""

  const basePath = useMemo(() => `/app/${tenantSlug}`, [tenantSlug])
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

  return (
    <SidebarProvider className="min-h-screen w-full bg-slate-50">
      <AppSidebar tenantSlug={tenantSlug} className="md:h-full" />

      <SidebarInset className="min-w-0 bg-slate-50">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md supports-backdrop-filter:bg-white/70">
          <div className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between ">
            <div className="flex flex-1 items-center gap-3">
              <SidebarTrigger className="h-9 w-9" />
              <Breadcrumb>
                <BreadcrumbList>
                  {crumbs.map((crumb, index) => {
                    const isLast = index === crumbs.length - 1
                    return (
                      <BreadcrumbItem key={crumb.href}>
                        {isLast ? (
                          <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                        ) : (
                          <BreadcrumbLink asChild>
                            <Link href={crumb.href}>{crumb.label}</Link>
                          </BreadcrumbLink>
                        )}
                        {!isLast && <BreadcrumbSeparator />}
                      </BreadcrumbItem>
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
                className="h-9 w-9"
                aria-label="Notifications"
              >
                <Bell className="h-5 w-5" />
              </Button>

              <Avatar className="h-9 w-9">
                <AvatarFallback>GB</AvatarFallback>
              </Avatar>
            </div>
          </div>
        </header>

        <div className="px-4 py-6 md:px-8">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
