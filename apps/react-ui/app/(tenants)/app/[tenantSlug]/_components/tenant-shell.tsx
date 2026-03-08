"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

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
  SheetDescription,
  SheetHeader,
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
  Clock3,
  LoaderCircle,
  LogOut,
  Search,
  Settings,
  Sparkles,
  UserCog,
  WalletCards,
  X,
} from "lucide-react"

import { AppSidebar } from "./sidebar"
import { TenantUserProvider, type TenantUser } from "./tenant-context"
import { api } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"

type TenantShellProps = {
  tenantSlug: string
  children: React.ReactNode
  user: TenantUser & { role?: string | null }
}

type NotificationItem = {
  id: string
  type:
    | "TASK_REMINDER"
    | "TASK_ASSIGNED"
    | "TASK_DUE"
    | "CUSTOM_FIELD_ACCESS_REQUEST"
    | "CUSTOM_FIELD_ACCESS_GRANTED"
  title: string
  body: string | null
  readAt: string | null
  createdAt: string
  taskId: string | null
  taskReminderId: string | null
}

type NotificationsResponse = {
  ok: boolean
  items: NotificationItem[]
  unreadCount: number
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

type RealtimeNotificationItem = NotificationItem & {
  tenantId: string
  userId: string
}

type SocketClient = {
  on: (event: string, callback: (payload: RealtimeNotificationItem) => void) => void
  off: (event: string, callback: (payload: RealtimeNotificationItem) => void) => void
  disconnect: () => void
}

declare global {
  interface Window {
    io?: (
      url: string,
      options: { withCredentials: boolean; transports: string[] },
    ) => SocketClient
  }
}

const formatSegment = (segment: string) =>
  segment.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())

const formatRole = (role?: string | null) =>
  role ? formatSegment(role.toLowerCase()) : null

const isTenantAdmin = (role?: string | null) => role === "TENANT_ADMIN"

const getInitials = (value: string) => {
  const parts = value.trim().split(/\s+/)
  if (!parts.length) return "U"
  const first = parts[0]?.[0] ?? ""
  const second = parts[1]?.[0] ?? ""
  return (first + second).toUpperCase() || "U"
}

const formatNotificationDate = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"

  const now = Date.now()
  const diff = now - date.getTime()
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < hour) {
    const minutes = Math.max(1, Math.round(diff / minute))
    return `${minutes}m ago`
  }

  if (diff < day) {
    const hours = Math.round(diff / hour)
    return `${hours}h ago`
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

const notificationMeta = (
  type: NotificationItem["type"],
): {
  label: string
  chipClassName: string
} => {
  switch (type) {
    case "TASK_ASSIGNED":
      return {
        label: "Assigned",
        chipClassName:
          "border border-sky-200/80 bg-sky-100/80 text-sky-700",
      }
    case "TASK_DUE":
      return {
        label: "Due now",
        chipClassName:
          "border border-amber-200/80 bg-amber-100/80 text-amber-700",
      }
    case "CUSTOM_FIELD_ACCESS_REQUEST":
      return {
        label: "Access request",
        chipClassName:
          "border border-indigo-200/80 bg-indigo-100/80 text-indigo-700",
      }
    case "CUSTOM_FIELD_ACCESS_GRANTED":
      return {
        label: "Access granted",
        chipClassName:
          "border border-emerald-200/80 bg-emerald-100/80 text-emerald-700",
      }
    default:
      return {
        label: "Reminder",
        chipClassName:
          "border border-violet-200/80 bg-violet-100/80 text-violet-700",
      }
  }
}

export function TenantShell({ tenantSlug, children, user }: TenantShellProps) {
  const router = useRouter()
  const pathname = usePathname() ?? ""
  const socketRef = useRef<SocketClient | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState(user)
  const [contactCrumbLabel, setContactCrumbLabel] = useState<string | null>(null)
  const [serviceCrumbLabel, setServiceCrumbLabel] = useState<string | null>(null)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isNotificationsLoading, setIsNotificationsLoading] = useState(false)
  const [isNotificationsActionPending, setIsNotificationsActionPending] = useState<
    "read-all" | "clear" | null
  >(null)
  const [deletingNotificationId, setDeletingNotificationId] = useState<string | null>(
    null,
  )
  const canAccessAccountSettings = isTenantAdmin(currentUser.role)
  const backendUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"

  const resolvedTenantSlug = useMemo(() => {
    if (tenantSlug) return tenantSlug
    const match = pathname.match(/^\/app\/([^/]+)/)
    return match?.[1] ?? ""
  }, [tenantSlug, pathname])

  const tenantId = useMemo(
    () =>
      currentUser.memberships?.find(
        (item) => item.tenant?.slug === resolvedTenantSlug,
      )?.tenant?.id ?? null,
    [currentUser.memberships, resolvedTenantSlug],
  )

  const basePath = useMemo(
    () => `/app/${resolvedTenantSlug}`,
    [resolvedTenantSlug],
  )
  const isFlowBuilderRoute = useMemo(
    () =>
      pathname.includes("/account-settings/services/") &&
      pathname.includes("/follow-up-templates/"),
    [pathname],
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
    segments.forEach((segment, index) => {
      acc += `/${segment}`
      const isContactIdSegment = segments[0] === "contacts" && index === 1
      const isServiceIdSegment =
        segments[0] === "account-settings" &&
        segments[1] === "services" &&
        index === 2

      if (isContactIdSegment && !contactCrumbLabel) {
        return
      }
      if (isServiceIdSegment && !serviceCrumbLabel) {
        return
      }

      items.push({
        label: isContactIdSegment
          ? (contactCrumbLabel ?? "")
          : isServiceIdSegment
            ? (serviceCrumbLabel ?? "")
            : formatSegment(segment),
        href: acc,
      })
    })
    return items
  }, [segments, basePath, contactCrumbLabel, serviceCrumbLabel])

  useEffect(() => {
    if (!currentUser.image) {
      setAvatarUrl(null)
      return
    }

    if (currentUser.image.startsWith("http")) {
      setAvatarUrl(currentUser.image)
      return
    }

    const tenantId = currentUser.memberships?.find(
      (item) => item.tenant?.slug === resolvedTenantSlug,
    )?.tenant?.id

    if (!tenantId) return

    const load = async () => {
      try {
        const { data } = await api.post("/api/files/presign-download", {
          tenantId,
          key: currentUser.image,
        })
        if (data?.url) {
          setAvatarUrl(data.url)
        }
      } catch {
        // ignore
      }
    }

    void load()
  }, [currentUser.image, currentUser.memberships, resolvedTenantSlug])

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

  useEffect(() => {
    const contactId = segments[0] === "contacts" ? segments[1] : null
    if (!contactId) {
      setContactCrumbLabel(null)
    }
  }, [segments])

  useEffect(() => {
    const serviceId =
      segments[0] === "account-settings" && segments[1] === "services"
        ? segments[2]
        : null
    if (!serviceId) {
      setServiceCrumbLabel(null)
    }
  }, [segments])

  useEffect(() => {
    const handler = (
      event: Event,
    ) => {
      const customEvent = event as CustomEvent<{ label?: string | null }>
      setContactCrumbLabel(customEvent.detail?.label ?? null)
    }

    window.addEventListener(
      "contact-breadcrumb-updated",
      handler as EventListener,
    )
    return () => {
      window.removeEventListener(
        "contact-breadcrumb-updated",
        handler as EventListener,
      )
    }
  }, [])

  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{ label?: string | null }>
      setServiceCrumbLabel(customEvent.detail?.label ?? null)
    }

    window.addEventListener("service-breadcrumb-updated", handler as EventListener)
    return () => {
      window.removeEventListener("service-breadcrumb-updated", handler as EventListener)
    }
  }, [])

  const handleLogout = useCallback(async () => {
    try {
      await api.post("/api/auth/logout")
    } catch {
      // Even if logout request fails, clear UI state by forcing login route.
    } finally {
      setProfileOpen(false)
      router.replace("/login")
      router.refresh()
    }
  }, [router])

  const handleSidebarNavigate = useCallback(
    (key: string) => {
      if (key === "logout") {
        void handleLogout()
      }
    },
    [handleLogout],
  )

  useEffect(() => {
    setCurrentUser(user)
  }, [user])

  const loadNotifications = useCallback(async () => {
    if (!tenantId) return

    setIsNotificationsLoading(true)
    try {
      const { data } = await api.get<NotificationsResponse>(
        `/api/notifications/${tenantId}`,
        {
          params: {
            page: 1,
            pageSize: 10,
          },
        },
      )

      setNotifications(data.items)
      setUnreadCount(data.unreadCount)
    } catch {
      // Keep the shell usable even if notifications fail.
    } finally {
      setIsNotificationsLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    if (!tenantId) return
    void loadNotifications()

    const intervalId = window.setInterval(() => {
      void loadNotifications()
    }, 60_000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [tenantId, loadNotifications])

  useEffect(() => {
    if (notificationsOpen) {
      void loadNotifications()
    }
  }, [notificationsOpen, loadNotifications])

  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{
        name?: string
        email?: string
      }>
      if (!customEvent.detail) return
      setCurrentUser((prev) => ({
        ...prev,
        name: customEvent.detail.name ?? prev.name,
        email: customEvent.detail.email ?? prev.email,
      }))
    }

    window.addEventListener("profile-updated", handler as EventListener)
    return () => {
      window.removeEventListener("profile-updated", handler as EventListener)
    }
  }, [])

  const handleNotificationClick = useCallback(
    async (notification: NotificationItem) => {
      if (!tenantId) return

      if (!notification.readAt) {
        try {
          await api.patch(
            `/api/notifications/${tenantId}/${notification.id}/read`,
          )
          setNotifications((current) =>
            current.map((item) =>
              item.id === notification.id
                ? { ...item, readAt: new Date().toISOString() }
                : item,
            ),
          )
          setUnreadCount((current) => Math.max(0, current - 1))
        } catch {
          // Navigate even if read-state update fails.
        }
      }

      setNotificationsOpen(false)

      if (notification.taskId) {
        router.push(`${basePath}/tasks/${notification.taskId}`)
        return
      }

      router.refresh()
    },
    [tenantId, router, basePath],
  )

  const handleMarkAllNotificationsRead = useCallback(async () => {
    if (!tenantId || unreadCount === 0) return

    setIsNotificationsActionPending("read-all")
    try {
      const { data } = await api.patch<{
        ok: boolean
        updatedCount: number
        readAt: string
      }>(`/api/notifications/${tenantId}/read-all`)

      setNotifications((current) =>
        current.map((item) => ({
          ...item,
          readAt: item.readAt ?? data.readAt,
        })),
      )
      setUnreadCount(0)
    } catch {
      toast.error("Could not mark all notifications as read.")
    } finally {
      setIsNotificationsActionPending(null)
    }
  }, [tenantId, unreadCount])

  const handleClearNotifications = useCallback(async () => {
    if (!tenantId || notifications.length === 0) return

    setIsNotificationsActionPending("clear")
    try {
      await api.delete(`/api/notifications/${tenantId}`)
      setNotifications([])
      setUnreadCount(0)
    } catch {
      toast.error("Could not clear notifications.")
    } finally {
      setIsNotificationsActionPending(null)
    }
  }, [tenantId, notifications.length])

  const handleDeleteNotification = useCallback(
    async (notification: NotificationItem) => {
      if (!tenantId) return

      setDeletingNotificationId(notification.id)
      try {
        await api.delete(`/api/notifications/${tenantId}/${notification.id}`)
        setNotifications((current) =>
          current.filter((item) => item.id !== notification.id),
        )
        if (!notification.readAt) {
          setUnreadCount((current) => Math.max(0, current - 1))
        }
      } catch {
        toast.error("Could not remove notification.")
      } finally {
        setDeletingNotificationId(null)
      }
    },
    [tenantId],
  )

  useEffect(() => {
    if (!tenantId) return

    let isCancelled = false
    let notificationHandler:
      | ((payload: RealtimeNotificationItem) => void)
      | null = null

    const loadSocketScript = async () => {
      if (window.io) return

      await new Promise<void>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(
          'script[data-socket-io-client="true"]',
        )

        if (existing) {
          if (existing.dataset.loaded === "true") {
            resolve()
            return
          }

          existing.addEventListener("load", () => resolve(), { once: true })
          existing.addEventListener(
            "error",
            () => reject(new Error("SOCKET_CLIENT_LOAD_FAILED")),
            { once: true },
          )
          return
        }

        const script = document.createElement("script")
        script.src = `${backendUrl}/socket.io/socket.io.js`
        script.async = true
        script.dataset.socketIoClient = "true"
        script.addEventListener("load", () => {
          script.dataset.loaded = "true"
          resolve()
        })
        script.addEventListener(
          "error",
          () => reject(new Error("SOCKET_CLIENT_LOAD_FAILED")),
          { once: true },
        )
        document.head.appendChild(script)
      })
    }

    const connectSocket = async () => {
      try {
        await loadSocketScript()
        if (isCancelled || !window.io) return

        const socket = window.io(backendUrl, {
          withCredentials: true,
          transports: ["websocket", "polling"],
        })
        socketRef.current = socket

        notificationHandler = (payload) => {
          if (payload.tenantId !== tenantId) {
            return
          }

          setNotifications((current) => {
            const nextItem: NotificationItem = {
              id: payload.id,
              type: payload.type,
              title: payload.title,
              body: payload.body,
              readAt: payload.readAt,
              createdAt: payload.createdAt,
              taskId: payload.taskId,
              taskReminderId: payload.taskReminderId,
            }

            return [nextItem, ...current.filter((item) => item.id !== payload.id)].slice(
              0,
              10,
            )
          })
          setUnreadCount((current) => current + (payload.readAt ? 0 : 1))
        }

        socket.on("notification:created", notificationHandler)
      } catch {
        // Polling remains as a fallback when realtime setup fails.
      }
    }

    void connectSocket()

    return () => {
      isCancelled = true
      if (socketRef.current && notificationHandler) {
        socketRef.current.off("notification:created", notificationHandler)
      }
      socketRef.current?.disconnect()
      socketRef.current = null
    }
  }, [backendUrl, tenantId])

  return (
    <SidebarProvider className="min-h-screen w-full bg-slate-50">
      {!isFlowBuilderRoute ? (
        <AppSidebar
          tenantSlug={tenantSlug}
          className="md:h-full"
          onNavigate={handleSidebarNavigate}
        />
      ) : null}

      <SidebarInset className="min-w-0 bg-slate-50 flex min-h-screen flex-col">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md supports-backdrop-filter:bg-white/70">
          <div
            className={`flex flex-col px-4 ${
              isFlowBuilderRoute
                ? "gap-2 py-2 md:flex-row md:items-center md:justify-between"
                : "gap-3 py-3 md:flex-row md:items-center md:justify-between"
            }`}
          >
            <div className="flex flex-1 items-center gap-3">
              {!isFlowBuilderRoute ? (
                <SidebarTrigger className="h-9 w-9 cursor-pointer" />
              ) : null}
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
              {!isFlowBuilderRoute ? (
              <div className="relative flex-1 max-w-md min-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search..."
                  className="pl-9"
                  aria-label="Search"
                />
              </div>
              ) : null}

              <Button
                variant="ghost"
                size="icon"
                type="button"
                className={`relative shrink-0 rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm cursor-pointer transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 ${
                  isFlowBuilderRoute ? "h-9 w-9" : "h-10 w-10"
                }`}
                aria-label="Notifications"
                onClick={() => setNotificationsOpen(true)}
              >
                <Bell className="h-5 w-5" />
                {unreadCount > 0 ? (
                  <span className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-rose-500 px-1.5 text-[10px] font-bold leading-none text-white shadow-sm">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                ) : null}
              </Button>

              <button
                type="button"
                onClick={() => setProfileOpen(true)}
                className="rounded-full cursor-pointer transition focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-slate-100"
                aria-label="Open profile"
              >
                <Avatar
                  className={`border-2 border-blue-950 bg-slate-100 ${
                    isFlowBuilderRoute ? "h-8 w-8" : "h-9 w-9"
                  }`}
                >
                  {avatarUrl || currentUser.image ? (
                    <AvatarImage
                      src={avatarUrl ?? currentUser.image ?? ""}
                      alt={currentUser.name}
                      className="object-cover"
                    />
                  ) : null}
                  <AvatarFallback>
                    {getInitials(currentUser.name)}
                  </AvatarFallback>
                </Avatar>
              </button>
            </div>
          </div>
        </header>

        <div
          className={`flex flex-1 min-h-0 ${
            isFlowBuilderRoute
              ? "bg-slate-50 px-0 py-0"
              : "bg-slate-100 px-4 py-4 md:px-6 md:py-6"
          }`}
        >
          <TenantUserProvider user={currentUser}>
            <div className="flex h-full w-full min-h-0 flex-col">{children}</div>
          </TenantUserProvider>
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
                {avatarUrl || currentUser.image ? (
                  <AvatarImage
                    src={avatarUrl ?? currentUser.image ?? ""}
                    alt={currentUser.name}
                    className="object-cover"
                  />
                ) : null}
                <AvatarFallback className="text-white font-bold text-lg bg-transparent ">
                  {getInitials(currentUser.name)}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="text-xl font-semibold">{currentUser.name}</p>
                {formatRole(currentUser.role) ? (
                  <p className="text-sm text-indigo-100">
                    {formatRole(currentUser.role)}
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

                {canAccessAccountSettings ? (
                  <Link
                    href={`${basePath}/account-settings/account`}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                    onClick={() => setProfileOpen(false)}
                  >
                    <div className="flex items-center gap-3">
                      <Settings className="h-4 w-4 text-slate-500" />
                      <span>Account Settings</span>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </Link>
                ) : null}

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
                onClick={() => void handleLogout()}
                className="flex w-full items-center gap-3 px-1 py-2 text-left text-sm font-semibold text-rose-600 transition hover:text-rose-700"
              >
                <LogOut className="h-4 w-4" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={notificationsOpen} onOpenChange={setNotificationsOpen}>
        <SheetContent
          side="right"
          className="w-full gap-0 border-none p-0 sm:max-w-md"
          showCloseButton={false}
        >
          <SheetClose className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-sm transition-all hover:bg-white/30 cursor-pointer">
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </SheetClose>

          <div className="flex h-full flex-col">
            <SheetHeader className="border-b border-white/10 bg-linear-to-br from-blue-950 to-blue-900 px-5 py-6 text-left">
              <div className="flex items-start justify-between gap-3 pr-12">
                <div className="space-y-1">
                  <SheetTitle className="text-base text-white">Notifications</SheetTitle>
                  <SheetDescription className="text-blue-100/80">
                    Assignment, due date, and reminder activity for your tasks.
                  </SheetDescription>
                </div>
                <Badge className="border border-white/15 bg-white/10 text-white hover:bg-white/10">
                  {unreadCount} unread
                </Badge>
              </div>
            </SheetHeader>

            <div className="border-b border-white/10 bg-white/70 px-5 py-3 backdrop-blur-xl">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                  <Sparkles className="h-3.5 w-3.5 text-blue-700" />
                  <span>Live activity</span>
                </div>
                <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="cursor-pointer rounded-full text-slate-600 hover:bg-white/80"
                  onClick={() => void handleMarkAllNotificationsRead()}
                  disabled={isNotificationsActionPending !== null || unreadCount === 0}
                >
                  {isNotificationsActionPending === "read-all"
                    ? "Marking..."
                    : "Mark all as read"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="cursor-pointer rounded-full text-slate-600 hover:bg-white/80"
                  onClick={() => void handleClearNotifications()}
                  disabled={isNotificationsActionPending !== null || notifications.length === 0}
                >
                  {isNotificationsActionPending === "clear" ? "Clearing..." : "Clear all"}
                </Button>
                </div>
              </div>
            </div>

            <ScrollArea className="flex-1 bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.45),_rgba(248,250,252,0.92)_28%,_rgba(255,255,255,0.92)_100%)]">
              <div className="flex flex-col gap-4 p-4">
                {isNotificationsLoading ? (
                  <div className="flex min-h-40 items-center justify-center text-sm text-slate-500">
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                    Loading notifications...
                  </div>
                ) : notifications.length ? (
                  notifications.map((notification) => {
                    const meta = notificationMeta(notification.type)
                    const isDeleting = deletingNotificationId === notification.id

                    return (
                      <div
                        key={notification.id}
                        className="group relative overflow-hidden rounded-[24px] border border-white/70 bg-white/55 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.45)] backdrop-blur-2xl transition hover:border-white hover:bg-white/72"
                      >
                        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.28),rgba(255,255,255,0.05))]" />
                        <button
                          type="button"
                          aria-label="Delete notification"
                          className="absolute right-4 top-4 z-10 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-slate-200/80 bg-white/80 text-slate-500 opacity-100 backdrop-blur transition hover:border-slate-300 hover:bg-white hover:text-slate-700 md:opacity-0 md:group-hover:opacity-100"
                          onClick={() => void handleDeleteNotification(notification)}
                          disabled={isDeleting}
                        >
                          {isDeleting ? (
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                          ) : (
                            <X className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleNotificationClick(notification)}
                          className="relative flex w-full cursor-pointer flex-col gap-4 px-4 py-4 pr-14 text-left"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${meta.chipClassName}`}
                                >
                                  {meta.label}
                                </span>
                                {!notification.readAt ? (
                                  <span className="inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
                                ) : null}
                              </div>
                              <p className="text-sm font-semibold text-slate-950">
                                {notification.title}
                              </p>
                              <div className="flex items-center gap-2 text-xs text-slate-500">
                                <Clock3 className="h-3.5 w-3.5" />
                                <span>{formatNotificationDate(notification.createdAt)}</span>
                              </div>
                            </div>
                            <div className="flex items-start gap-2">
                              {notification.readAt ? (
                                <Badge variant="secondary" className="bg-slate-100/80">
                                  Read
                                </Badge>
                              ) : (
                                <Badge className="bg-rose-500 text-white hover:bg-rose-500">
                                  New
                                </Badge>
                              )}
                            </div>
                          </div>
                          <p className="text-sm leading-6 text-slate-600">
                            {notification.body ?? "Open notification"}
                          </p>
                        </button>
                      </div>
                    )
                  })
                ) : (
                  <div className="flex min-h-40 items-center justify-center rounded-[24px] border border-dashed border-white/80 bg-white/55 px-6 text-center text-sm text-slate-500 backdrop-blur-2xl">
                    No notifications yet.
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </SheetContent>
      </Sheet>
    </SidebarProvider>
  )
}
