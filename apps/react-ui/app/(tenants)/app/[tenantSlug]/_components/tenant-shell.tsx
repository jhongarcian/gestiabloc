"use client"

import Link from "next/link"
import { useRouter, useSelectedLayoutSegments } from "next/navigation"
import {
  type UIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
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
  SheetFooter,
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
  UserCog,
  WalletCards,
  X,
} from "lucide-react"

import { AppSidebar, SidebarEdgeToggle } from "./sidebar"
import { TenantUserProvider, type TenantUser } from "./tenant-context"
import { api } from "@/lib/api"
import { registerRealtimeNotification } from "@/lib/realtime-notifications"

type TenantShellProps = {
  tenantSlug: string
  tenantName: string
  children: React.ReactNode
  user: TenantUser & { role?: string | null }
  subscription?: {
    planKey: string
    seatLimit: number
    status: string
    currentPeriodEnd: string | null
    seatUsage: { used: number; limit: number; available: number }
    storageUsedBytes: number
    storageLimitBytes: number
    aiActionsPerMonth: number
    memberCount: number
    activeMemberCount: number
  } | null
}

type NotificationItem = {
  id: string
  type:
    | "TASK_REMINDER"
    | "TASK_ASSIGNED"
    | "TASK_DUE"
    | "AUTOMATION_NOTIFICATION"
    | "FOLLOW_UP_OVERDUE"
    | "FOLLOW_UP_FAILED"
    | "CUSTOM_FIELD_ACCESS_REQUEST"
    | "CUSTOM_FIELD_ACCESS_GRANTED"
  title: string
  body: string | null
  readAt: string | null
  createdAt: string
  contactId: string | null
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

type RealtimeAutomationEvent = {
  eventId: string
  tenantId: string
  status: string
  completed: number
  skipped: number
  failed: number
  contactDeleted: boolean
}

type SocketClient = {
  on: (event: string, callback: (payload: never) => void) => void
  off: (event: string, callback: (payload: never) => void) => void
  disconnect: () => void
}

const NOTIFICATIONS_PAGE_SIZE = 10

declare global {
  interface Window {
    io?: (
      url: string,
      options: { withCredentials: boolean; transports: string[] },
    ) => SocketClient
    __tenantShellServiceBreadcrumbLabel?: string | null
  }
}

const formatSegment = (segment: string) => {
  if (segment === "follow-ups") return "Follow-ups"
  if (segment === "follow-up") return "Follow-up"
  return segment.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

const COMPACT_LOCATION_LABELS: Readonly<Record<string, string>> = {
  account: "Account",
  "account-settings": "Account Settings",
  "ai-qualification": "AI Qualification",
  appointments: "Appointments",
  automations: "Automations",
  "automation-processes": "Automation Processes",
  billing: "Billing",
  calendar: "Calendar",
  contacts: "Contacts",
  "custom-fields": "Custom Fields",
  enrollments: "Enrollments",
  "follow-up": "Follow-up",
  "follow-ups": "Follow-ups",
  followups: "Follow-ups",
  help: "Help",
  notes: "Notes",
  opportunities: "Opportunities",
  overview: "Overview",
  payments: "Payments",
  professionals: "Professionals",
  profile: "Profile",
  relationships: "Relationships",
  services: "Services",
  "status-config": "Status Configuration",
  subscription: "Subscription",
  tags: "Tags",
  tasks: "Tasks",
  "tenant-info": "Tenant Information",
  transaction: "Transaction",
  transactions: "Transactions",
  upgrade: "Upgrade",
  users: "Users",
}

const getCompactLocationLabel = (segments: string[]) => {
  if (segments.length === 0) return "Dashboard"

  const isEnrollmentOverview =
    segments[0] === "services" &&
    segments[1] === "enrollments" &&
    (!segments[3] || segments[3] === "overview")

  if (isEnrollmentOverview) return "Enrollments"

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const label = COMPACT_LOCATION_LABELS[segments[index]]
    if (label) return label
  }

  return formatSegment(segments[0])
}

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
          "border border-blue-100 bg-[#f1f7ff] text-blue-700",
      }
    case "TASK_DUE":
      return {
        label: "Due now",
        chipClassName:
          "border border-amber-200/80 bg-amber-100/80 text-amber-700",
      }
    case "AUTOMATION_NOTIFICATION":
      return {
        label: "Automation",
        chipClassName:
          "border border-blue-100 bg-[#f1f7ff] text-blue-700",
      }
    case "FOLLOW_UP_OVERDUE":
      return {
        label: "Follow-up overdue",
        chipClassName:
          "border border-rose-200/80 bg-rose-100/80 text-rose-700",
      }
    case "FOLLOW_UP_FAILED":
      return {
        label: "Follow-up paused",
        chipClassName:
          "border border-rose-200 bg-rose-50 text-rose-700",
      }
    case "CUSTOM_FIELD_ACCESS_REQUEST":
      return {
        label: "Access request",
        chipClassName:
          "border border-blue-100 bg-[#f1f7ff] text-blue-700",
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
          "border border-blue-100 bg-[#f1f7ff] text-blue-700",
      }
  }
}

const mergeLatestNotifications = (
  current: NotificationItem[],
  incoming: NotificationItem[],
) => {
  const seen = new Set<string>()

  return [...incoming, ...current].filter((notification) => {
    if (seen.has(notification.id)) return false
    seen.add(notification.id)
    return true
  })
}

const appendOlderNotifications = (
  current: NotificationItem[],
  incoming: NotificationItem[],
) => {
  const existingIds = new Set(current.map((notification) => notification.id))
  return [
    ...current,
    ...incoming.filter((notification) => !existingIds.has(notification.id)),
  ]
}

export function TenantShell({
  tenantSlug,
  tenantName,
  children,
  user,
  subscription,
}: TenantShellProps) {
  const router = useRouter()
  const selectedSegments = useSelectedLayoutSegments()
  const tenantShellHeaderRef = useRef<HTMLElement>(null)
  const compactSearchInputRef = useRef<HTMLInputElement>(null)
  const compactSearchTriggerRef = useRef<HTMLButtonElement>(null)
  const socketRef = useRef<SocketClient | null>(null)
  const knownNotificationIdsRef = useRef(new Set<string>())
  const notificationsVersionRef = useRef(0)
  const isLoadingNotificationsRef = useRef(false)
  const isLoadingMoreNotificationsRef = useRef(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [isCompactSearchOpen, setIsCompactSearchOpen] = useState(false)
  const [headerSearchQuery, setHeaderSearchQuery] = useState("")
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState(user)
  const [contactCrumbLabel, setContactCrumbLabel] = useState<string | null>(null)
  const [serviceCrumbLabel, setServiceCrumbLabel] = useState<string | null>(null)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [notificationsPage, setNotificationsPage] = useState(0)
  const [notificationsTotalPages, setNotificationsTotalPages] = useState(1)
  const [isNotificationsLoading, setIsNotificationsLoading] = useState(false)
  const [isMoreNotificationsLoading, setIsMoreNotificationsLoading] =
    useState(false)
  const [isNotificationsActionPending, setIsNotificationsActionPending] = useState<
    "read-all" | "clear" | null
  >(null)
  const [deletingNotificationId, setDeletingNotificationId] = useState<string | null>(
    null,
  )
  const canAccessAccountSettings = isTenantAdmin(currentUser.role)
  const backendUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"

  const segments = useMemo(
    () => selectedSegments.filter((segment) => !segment.startsWith("(")),
    [selectedSegments],
  )

  const tenantId = useMemo(
    () =>
      currentUser.memberships?.find(
        (item) => item.tenant?.slug === tenantSlug,
      )?.tenant?.id ?? null,
    [currentUser.memberships, tenantSlug],
  )

  const basePath = useMemo(
    () => `/app/${tenantSlug}`,
    [tenantSlug],
  )
  const hasMoreNotifications = notificationsPage < notificationsTotalPages
  const isFlowBuilderRoute = useMemo(
    () =>
      segments[0] === "account-settings" &&
      segments[1] === "services" &&
      segments[3] === "follow-up-templates",
    [segments],
  )
  const isCompactSearchActive = !isFlowBuilderRoute && isCompactSearchOpen
  const compactLocationLabel = useMemo(
    () => getCompactLocationLabel(segments),
    [segments],
  )

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
      const isServiceEnrollmentRoute =
        segments[0] === "services" && segments[1] === "enrollments"
      const isServiceEnrollmentsSegment = isServiceEnrollmentRoute && index === 1
      const isServiceEnrollmentViewSegment = isServiceEnrollmentRoute && index >= 3
      const isServicesWorkspaceSegment =
        segments[0] === "services" &&
        index === 1 &&
        (segment === "enrollments" || segment === "transactions" || segment === "follow-ups")
      const isServiceIdSegment =
        (segments[0] === "account-settings" &&
          segments[1] === "services" &&
          index === 2) ||
        (segments[0] === "services" &&
          index === (isServiceEnrollmentRoute ? 2 : 1) &&
          !isServicesWorkspaceSegment)
      const isServiceFollowUpsSegment =
        segments[0] === "account-settings" &&
        segments[1] === "services" &&
        index === 3 &&
        segment === "follow-up-templates"

      if (isContactIdSegment && !contactCrumbLabel) {
        return
      }
      if (isServiceEnrollmentsSegment) {
        items.push({
          label: "Enrollments",
          href: `${basePath}/services/enrollments`,
        })
        return
      }
      if (isServiceEnrollmentViewSegment && segment === "overview") {
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
        href: isServiceFollowUpsSegment
          ? `${basePath}/account-settings/follow-ups?serviceId=${segments[2]}`
          : acc,
      })
    })
    return items
  }, [segments, basePath, contactCrumbLabel, serviceCrumbLabel])

  useEffect(() => {
    const header = tenantShellHeaderRef.current
    const shell = header?.parentElement

    if (!header || !shell) return

    const updateHeaderHeight = () => {
      shell.style.setProperty(
        "--tenant-shell-header-height",
        `${Math.ceil(header.getBoundingClientRect().height)}px`,
      )
    }

    updateHeaderHeight()

    const observer = new ResizeObserver(updateHeaderHeight)
    observer.observe(header)

    return () => {
      observer.disconnect()
      shell.style.removeProperty("--tenant-shell-header-height")
    }
  }, [])

  useEffect(() => {
    if (!isCompactSearchActive) return

    const frameId = window.requestAnimationFrame(() => {
      compactSearchInputRef.current?.focus()
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [isCompactSearchActive])

  const closeCompactSearch = useCallback(() => {
    setIsCompactSearchOpen(false)
    window.requestAnimationFrame(() => {
      compactSearchTriggerRef.current?.focus()
    })
  }, [])

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
      (item) => item.tenant?.slug === tenantSlug,
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
  }, [currentUser.image, currentUser.memberships, tenantSlug])

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
        : segments[0] === "services"
          ? segments[1] === "enrollments"
            ? segments[2]
            : segments[1] === "transactions" || segments[1] === "follow-ups"
              ? null
              : segments[1]
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
    if (window.__tenantShellServiceBreadcrumbLabel) {
      setServiceCrumbLabel(window.__tenantShellServiceBreadcrumbLabel)
    }

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

  const loadNotifications = useCallback(async ({
    mode = "replace",
    page = 1,
  }: {
    mode?: "replace" | "merge" | "append"
    page?: number
  } = {}) => {
    if (!tenantId) return

    const requestVersion = notificationsVersionRef.current
    const isAppending = mode === "append"
    if (
      isLoadingNotificationsRef.current ||
      isLoadingMoreNotificationsRef.current
    ) {
      return
    }

    if (isAppending) {
      isLoadingMoreNotificationsRef.current = true
      setIsMoreNotificationsLoading(true)
    } else {
      isLoadingNotificationsRef.current = true
      if (mode === "replace") {
        setIsNotificationsLoading(true)
      }
    }

    try {
      const { data } = await api.get<NotificationsResponse>(
        `/api/notifications/${tenantId}`,
        {
          params: {
            page,
            pageSize: NOTIFICATIONS_PAGE_SIZE,
          },
        },
      )

      if (requestVersion !== notificationsVersionRef.current) return

      for (const notification of data.items) {
        knownNotificationIdsRef.current.add(notification.id)
      }

      setNotifications((current) => {
        if (mode === "append") {
          return appendOlderNotifications(current, data.items)
        }

        if (mode === "merge") {
          return mergeLatestNotifications(current, data.items)
        }

        return data.items
      })
      setUnreadCount(data.unreadCount)
      setNotificationsPage((current) =>
        mode === "append" ? Math.max(current, data.pagination.page) : data.pagination.page,
      )
      setNotificationsTotalPages(data.pagination.totalPages)
    } catch {
      // Keep the shell usable even if notifications fail.
    } finally {
      if (isAppending) {
        isLoadingMoreNotificationsRef.current = false
        setIsMoreNotificationsLoading(false)
      } else {
        isLoadingNotificationsRef.current = false
        setIsNotificationsLoading(false)
      }
    }
  }, [tenantId])

  const loadMoreNotifications = useCallback(async () => {
    if (!tenantId || !hasMoreNotifications) return

    await loadNotifications({
      mode: "append",
      page: notificationsPage + 1,
    })
  }, [tenantId, hasMoreNotifications, loadNotifications, notificationsPage])

  useEffect(() => {
    knownNotificationIdsRef.current.clear()
  }, [tenantId])

  const handleNotificationsScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const target = event.currentTarget
      const remainingScroll =
        target.scrollHeight - target.scrollTop - target.clientHeight

      if (remainingScroll <= 96) {
        void loadMoreNotifications()
      }
    },
    [loadMoreNotifications],
  )

  useEffect(() => {
    if (!tenantId) return
    void loadNotifications()

    const intervalId = window.setInterval(() => {
      void loadNotifications({
        mode: notificationsOpen ? "merge" : "replace",
      })
    }, 60_000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [tenantId, loadNotifications, notificationsOpen])

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

      if (notification.contactId) {
        router.push(`${basePath}/contacts/${notification.contactId}`)
        return
      }

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

      notificationsVersionRef.current += 1
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
      notificationsVersionRef.current += 1
      setNotifications([])
      setUnreadCount(0)
      setNotificationsPage(0)
      setNotificationsTotalPages(1)
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
        notificationsVersionRef.current += 1
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
    let automationHandler:
      | ((payload: RealtimeAutomationEvent) => void)
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

          if (!registerRealtimeNotification(knownNotificationIdsRef.current, payload.id)) return

          setNotifications((current) => {
            const nextItem: NotificationItem = {
              id: payload.id,
              type: payload.type,
              title: payload.title,
              body: payload.body,
              readAt: payload.readAt,
              createdAt: payload.createdAt,
              contactId: payload.contactId,
              taskId: payload.taskId,
              taskReminderId: payload.taskReminderId,
            }

            return [nextItem, ...current.filter((item) => item.id !== payload.id)]
          })
          setUnreadCount((current) => current + (payload.readAt ? 0 : 1))
          if (payload.type === "AUTOMATION_NOTIFICATION") {
            toast(payload.title, payload.body ? { description: payload.body } : undefined)
          }
        }

        automationHandler = (payload) => {
          if (payload.tenantId !== tenantId) return
          if (payload.failed > 0) {
            toast.error("Automation finished with errors. Review the execution logs.")
          }
          if (payload.contactDeleted) router.refresh()
        }

        socket.on("notification:created", notificationHandler as (payload: never) => void)
        socket.on("automation:event-completed", automationHandler as (payload: never) => void)
      } catch {
        // Polling remains as a fallback when realtime setup fails.
      }
    }

    void connectSocket()

    return () => {
      isCancelled = true
      if (socketRef.current && notificationHandler) {
        socketRef.current.off("notification:created", notificationHandler as (payload: never) => void)
      }
      if (socketRef.current && automationHandler) {
        socketRef.current.off("automation:event-completed", automationHandler as (payload: never) => void)
      }
      socketRef.current?.disconnect()
      socketRef.current = null
    }
  }, [backendUrl, router, tenantId])

  return (
    <SidebarProvider className="min-h-screen w-full bg-slate-50">
      {!isFlowBuilderRoute ? (
        <>
          <AppSidebar
            tenantSlug={tenantSlug}
            tenantName={tenantName}
            className="md:h-full"
            onNavigate={handleSidebarNavigate}
            planKey={subscription?.planKey}
            isAdmin={canAccessAccountSettings}
          />
          <SidebarEdgeToggle />
        </>
      ) : null}

      <SidebarInset className="min-w-0 bg-slate-50 flex min-h-screen flex-col [--tenant-shell-header-height:65px]">
        <header
          ref={tenantShellHeaderRef}
          className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md supports-backdrop-filter:bg-white/70"
        >
          <div
            className={`flex items-center gap-2 px-3 sm:px-4 ${
              isFlowBuilderRoute ? "py-2" : "py-3"
            }`}
          >
            {!isFlowBuilderRoute ? (
              <SidebarTrigger className="size-10 shrink-0 cursor-pointer rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 lg:hidden" />
            ) : null}

            {!isFlowBuilderRoute && !isCompactSearchActive ? (
              <div className="min-w-0 flex-1 lg:hidden">
                <span
                  className="block truncate text-sm font-semibold tracking-[-0.01em] text-slate-800 sm:text-base"
                  title={compactLocationLabel}
                >
                  {compactLocationLabel}
                </span>
              </div>
            ) : null}

            <div className="hidden min-w-0 flex-1 overflow-hidden lg:block">
              <Breadcrumb className="min-w-0 overflow-hidden">
                <BreadcrumbList className="flex-nowrap overflow-hidden whitespace-nowrap">
                  {crumbs.map((crumb, index) => {
                    const isLast = index === crumbs.length - 1
                    return (
                      <div key={crumb.href} className="contents">
                        <BreadcrumbItem className="min-w-0">
                          {isLast ? (
                            <BreadcrumbPage className="block max-w-[min(24rem,32vw)] truncate">
                              {crumb.label}
                            </BreadcrumbPage>
                          ) : (
                            <BreadcrumbLink
                              asChild
                              className="block max-w-36 truncate xl:max-w-56"
                            >
                              <Link href={crumb.href}>{crumb.label}</Link>
                            </BreadcrumbLink>
                          )}
                        </BreadcrumbItem>
                        {!isLast && <BreadcrumbSeparator className="shrink-0" />}
                      </div>
                    )
                  })}
                </BreadcrumbList>
              </Breadcrumb>
            </div>

            {isCompactSearchActive ? (
              <div className="relative flex min-w-0 flex-1 items-center lg:hidden">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  ref={compactSearchInputRef}
                  id="tenant-header-search-compact"
                  placeholder="Search..."
                  value={headerSearchQuery}
                  onChange={(event) => setHeaderSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return
                    event.preventDefault()
                    closeCompactSearch()
                  }}
                  className="h-10 min-w-0 rounded-xl border-slate-200 bg-white pl-9 pr-10 shadow-sm"
                  aria-label="Search"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  className="absolute right-1 size-8 cursor-pointer rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close search"
                  onClick={closeCompactSearch}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ) : null}

            <div
              className={`ml-auto flex min-w-0 items-center gap-2 sm:gap-3 ${
                isCompactSearchActive ? "hidden lg:flex" : "flex"
              }`}
            >
              {!isFlowBuilderRoute ? (
                <>
                  <Button
                    ref={compactSearchTriggerRef}
                    variant="ghost"
                    size="icon"
                    type="button"
                    className="size-10 shrink-0 cursor-pointer rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 lg:hidden"
                    aria-label="Open search"
                    aria-expanded={isCompactSearchActive}
                    aria-controls="tenant-header-search-compact"
                    onClick={() => setIsCompactSearchOpen(true)}
                  >
                    <Search className="size-5" />
                  </Button>

                  <div className="relative hidden w-[clamp(12rem,24vw,28rem)] min-w-0 lg:block">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      id="tenant-header-search-desktop"
                      placeholder="Search..."
                      value={headerSearchQuery}
                      onChange={(event) => setHeaderSearchQuery(event.target.value)}
                      className="pl-9"
                      aria-label="Search"
                    />
                  </div>
                </>
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
                className="shrink-0 rounded-full cursor-pointer transition focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-slate-100"
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

      <Sheet
        open={notificationsOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && (isNotificationsActionPending || deletingNotificationId)) return
          setNotificationsOpen(nextOpen)
        }}
      >
        <SheetContent
          side="right"
          className="h-full w-full gap-0 overflow-hidden border-l border-slate-200 bg-white p-0 sm:max-w-lg [&>button]:cursor-pointer"
        >
          <SheetHeader className="relative overflow-hidden border-b border-blue-100 bg-[#f1f7ff] px-6 py-6 text-left sm:px-7">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(30,64,175,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(30,64,175,.08)_1px,transparent_1px)] [background-size:42px_42px]"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-12 -bottom-20 size-48 rounded-full bg-blue-300/30 blur-3xl"
            />
            <div className="relative flex flex-col gap-3 pr-10">
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-semibold text-blue-700">Your activity</p>
                <SheetTitle className="text-xl font-semibold text-slate-950 sm:text-2xl">
                  Notifications
                </SheetTitle>
                <SheetDescription className="text-sm leading-6 text-slate-600">
                  Review updates about tasks, follow-ups, and account activity.
                </SheetDescription>
              </div>
              <span className="w-fit rounded-full border border-blue-200 bg-white/80 px-3 py-1 text-xs font-semibold tabular-nums text-blue-900" aria-live="polite">
                {unreadCount} unread
              </span>
            </div>
          </SheetHeader>

          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-2 [scrollbar-gutter:stable] sm:px-7"
            onScroll={handleNotificationsScroll}
          >
            <div className="flex flex-col">
                {isNotificationsLoading ? (
                  <div className="flex min-h-40 items-center justify-center text-sm text-slate-500">
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                    Loading notifications...
                  </div>
                ) : notifications.length ? (
                  <>
                    {notifications.map((notification) => {
                      const meta = notificationMeta(notification.type)
                      const isDeleting = deletingNotificationId === notification.id

                      return (
                        <div
                          key={notification.id}
                          className="relative border-b border-slate-200 py-3 last:border-b-0"
                        >
                          <button
                            type="button"
                            aria-label={`Dismiss notification: ${notification.title}`}
                            className="absolute right-1 top-5 z-10 flex size-8 cursor-pointer items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-700"
                            onClick={() => void handleDeleteNotification(notification)}
                            disabled={isDeleting || isNotificationsActionPending !== null}
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
                            className="flex w-full cursor-pointer flex-col gap-2 rounded-xl px-3 py-3 pr-12 text-left transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-700"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex min-w-0 flex-col gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span
                                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${meta.chipClassName}`}
                                  >
                                    {meta.label}
                                  </span>
                                  {!notification.readAt ? (
                                    <span className="inline-flex size-2 rounded-full bg-blue-700" aria-label="Unread" />
                                  ) : null}
                                </div>
                                <p className="text-sm font-semibold leading-5 text-slate-950">
                                  {notification.title}
                                </p>
                              </div>
                            </div>
                            <p className="text-sm leading-6 text-slate-600">
                              {notification.body ?? "Open notification"}
                            </p>
                            <span className="flex items-center gap-1.5 text-xs text-slate-500">
                              <Clock3 className="size-3.5" aria-hidden="true" />
                              {formatNotificationDate(notification.createdAt)}
                            </span>
                          </button>
                        </div>
                      )
                    })}
                    <div className="py-5">
                      {isMoreNotificationsLoading ? (
                        <div className="flex h-12 items-center justify-center text-sm text-slate-500">
                          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                          Loading more...
                        </div>
                      ) : hasMoreNotifications ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="h-10 w-full cursor-pointer rounded-xl border-slate-200 bg-white text-slate-700 shadow-none hover:bg-slate-50"
                          onClick={() => void loadMoreNotifications()}
                        >
                          Load older notifications
                        </Button>
                      ) : (
                        <div className="flex h-10 items-center justify-center text-xs font-medium text-slate-400">
                          You’re up to date.
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="my-6 flex min-h-40 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-6 text-center text-sm text-slate-500">
                    You’re all caught up.
                  </div>
                )}
            </div>
          </div>
          <SheetFooter className="border-t border-slate-200 bg-slate-50/80 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-700"
              onClick={() => void handleClearNotifications()}
              disabled={isNotificationsActionPending !== null || notifications.length === 0}
            >
              {isNotificationsActionPending === "clear" ? "Clearing..." : "Clear all"}
            </Button>
            <Button
              type="button"
              className="min-w-36 cursor-pointer bg-blue-950 text-white shadow-sm hover:bg-blue-900"
              onClick={() => void handleMarkAllNotificationsRead()}
              disabled={isNotificationsActionPending !== null || unreadCount === 0}
            >
              {isNotificationsActionPending === "read-all" ? "Marking..." : "Mark all as read"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </SidebarProvider>
  )
}
