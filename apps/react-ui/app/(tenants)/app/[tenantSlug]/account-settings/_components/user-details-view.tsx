"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Camera,
  CalendarDays,
  Clock3,
  MailCheck,
  ShieldCheck,
  UserRoundCheck,
  Wifi,
  WifiOff,
} from "lucide-react"
import { isAxiosError } from "axios"
import { toast } from "sonner"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { UserSecurityLevelControl } from "./user-security-level-control"

type SecurityLevel = "LOW" | "MEDIUM" | "MAX"

type UserDetailsPayload = {
  id: string
  name: string
  email: string
  avatar: string | null
  emailVerified: boolean
  isOnline: boolean
  sessionCreatedAt: string | null
  role: string
  accountStatus: string
  securityLevel: SecurityLevel
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
  timezone: string | null
  activity: {
    recentSessions: Array<{
      id: string
      createdAt: string
      expiresAt: string
      ipAddress: string | null
      userAgent: string | null
      isActive: boolean
    }>
  }
  auditHistory: Array<{
    id: string
    type: string
    title: string
    detail: string
    at: string
  }>
}

type UserDetailsResponse = {
  ok: boolean
  user: UserDetailsPayload
}

type UserPatchResponse = {
  ok: boolean
  user: {
    id: string
    name: string
    email: string
    avatar: string | null
    emailVerified: boolean
    role: string
    createdAt: string
    updatedAt: string
  }
}

type UserDetailsViewProps = {
  tenantId: string
  tenantSlug: string
  userId: string
  initialUser: UserDetailsPayload
}

const formatSegment = (segment: string) =>
  segment.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())

const formatRoleLabel = (role?: string | null) => {
  if (!role) return "—"
  const normalized = role.toUpperCase()
  if (normalized === "TENANT_ADMIN" || normalized === "ADMIN") return "Admin"
  if (normalized === "TENANT_USER" || normalized === "USER") return "User"
  return formatSegment(role)
}

const formatSecurityLevelLabel = (level: SecurityLevel) =>
  level === "LOW" ? "Low" : level === "MEDIUM" ? "Medium" : "Max"

const formatDateTime = (value: string | null, timezone?: string | null) => {
  if (!value) return "Never"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Never"

  const baseOptions: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }

  if (timezone) {
    try {
      return new Intl.DateTimeFormat("en-US", {
        ...baseOptions,
        timeZone: timezone,
      }).format(date)
    } catch {
      return new Intl.DateTimeFormat("en-US", baseOptions).format(date)
    }
  }

  return new Intl.DateTimeFormat("en-US", baseOptions).format(date)
}

const formatDate = (value?: string | null, timezone?: string | null) => {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"

  const baseOptions: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }

  if (timezone) {
    try {
      return new Intl.DateTimeFormat("en-US", {
        ...baseOptions,
        timeZone: timezone,
      }).format(date)
    } catch {
      return new Intl.DateTimeFormat("en-US", baseOptions).format(date)
    }
  }

  return new Intl.DateTimeFormat("en-US", baseOptions).format(date)
}

const getInitials = (value: string) => {
  const parts = value.trim().split(/\s+/)
  if (!parts.length) return "U"
  const first = parts[0]?.[0] ?? ""
  const second = parts[1]?.[0] ?? ""
  return (first + second).toUpperCase() || "U"
}

function InlineBadge({
  label,
  tone,
}: {
  label: string
  tone: "neutral" | "info" | "accent" | "warning"
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide",
        tone === "neutral" && "bg-slate-100 text-slate-700",
        tone === "info" && "bg-sky-100 text-sky-700",
        tone === "accent" && "bg-indigo-100 text-indigo-700",
        tone === "warning" && "bg-amber-100 text-amber-700",
      )}
    >
      {label}
    </span>
  )
}

export function UserDetailsView({
  tenantId,
  tenantSlug,
  userId,
  initialUser,
}: UserDetailsViewProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [user, setUser] = useState(initialUser)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
  const [fullName, setFullName] = useState(initialUser.name)
  const [email, setEmail] = useState(initialUser.email)
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isSendingVerification, setIsSendingVerification] = useState(false)
  const [isDeletingUser, setIsDeletingUser] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const [profileFieldErrors, setProfileFieldErrors] = useState<
    Record<string, string>
  >({})

  const roleLabel = useMemo(() => formatRoleLabel(user.role), [user.role])
  const statusLabel = useMemo(
    () => formatSegment(user.accountStatus),
    [user.accountStatus],
  )

  useEffect(() => {
    if (!user.avatar) {
      setAvatarUrl(null)
      return
    }

    if (user.avatar.startsWith("http")) {
      setAvatarUrl(user.avatar)
      return
    }

    const load = async () => {
      try {
        const { data } = await api.post("/api/files/presign-download", {
          tenantId,
          key: user.avatar,
        })
        if (data?.url) {
          setAvatarUrl(data.url)
        }
      } catch {
        setAvatarUrl(null)
      }
    }

    void load()
  }, [tenantId, user.avatar])

  const refreshUser = useCallback(async () => {
    setIsRefreshing(true)
    try {
      const { data } = await api.get<UserDetailsResponse>(
        `/api/account-settings/${tenantId}/users/${userId}`,
      )
      if (data?.user) {
        setUser(data.user)
        setFullName(data.user.name)
        setEmail(data.user.email)
      }
    } catch {
      toast.error("Could not refresh user details.")
    } finally {
      setIsRefreshing(false)
    }
  }, [tenantId, userId])

  const handleSaveProfile = async () => {
    setProfileFieldErrors({})

    const payload = {
      name: fullName.trim(),
      email: email.trim(),
    }

    const nextFieldErrors: Record<string, string> = {}
    if (!payload.name) nextFieldErrors.name = "Full name is required."
    if (!payload.email) nextFieldErrors.email = "Email is required."

    if (Object.keys(nextFieldErrors).length > 0) {
      setProfileFieldErrors(nextFieldErrors)
      return
    }

    setIsSavingProfile(true)
    try {
      const { data } = await api.patch<UserPatchResponse>(
        `/api/account-settings/${tenantId}/users/${userId}`,
        payload,
      )
      if (data?.user) {
        setUser((prev) => ({
          ...prev,
          name: data.user.name,
          email: data.user.email,
          emailVerified: data.user.emailVerified,
          updatedAt: data.user.updatedAt,
        }))
      }
      toast.success("User profile updated.")
      await refreshUser()
    } catch (error) {
      if (isAxiosError(error)) {
        const code = error.response?.data?.error
        const details = error.response?.data?.details
        if (Array.isArray(details)) {
          const zodErrors: Record<string, string> = {}
          for (const item of details) {
            if (item?.path) zodErrors[item.path] = item.message
          }
          setProfileFieldErrors(zodErrors)
          return
        }
        if (code === "EMAIL_IN_USE") {
          setProfileFieldErrors((prev) => ({
            ...prev,
            email: "That email is already in use.",
          }))
          return
        }
      }
      toast.error("Could not update user profile.")
    } finally {
      setIsSavingProfile(false)
    }
  }

  const handleRequestVerification = async () => {
    setIsSendingVerification(true)
    try {
      await api.post(
        `/api/account-settings/${tenantId}/users/${userId}/request-email-verification`,
      )
      toast.success("Verification email sent.")
      await refreshUser()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        if (backendError === "EMAIL_ALREADY_VERIFIED") {
          toast.info("Email is already verified.")
          return
        }
      }
      toast.error("Could not send verification email.")
    } finally {
      setIsSendingVerification(false)
    }
  }

  const handleAvatarClick = () => {
    fileInputRef.current?.click()
  }

  const handleAvatarChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0]
    if (!file) return

    setIsUploadingAvatar(true)
    try {
      const formData = new FormData()
      formData.append("file", file)

      const { data } = await api.post(
        `/api/account-settings/${tenantId}/users/${userId}/avatar-upload`,
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" },
        },
      )

      if (data?.imageUrl) {
        setAvatarUrl(data.imageUrl)
        setUser((prev) => ({ ...prev, avatar: data.imageUrl }))
      }

      toast.success("Avatar updated.")
    } catch {
      toast.error("Could not update avatar. Please try again.")
    } finally {
      setIsUploadingAvatar(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }

  const handleDeleteUser = async () => {
    setIsDeletingUser(true)
    try {
      await api.delete(`/api/account-settings/${tenantId}/users/${userId}`)
      toast.success("User deleted.")
      router.push(`/app/${tenantSlug}/account-settings/users`)
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        if (backendError === "CANNOT_DELETE_SELF") {
          toast.error("You cannot delete your own account.")
          return
        }
        if (backendError === "LAST_TENANT_ADMIN") {
          toast.error("Cannot delete the last active tenant admin.")
          return
        }
      }
      toast.error("Could not delete user.")
    } finally {
      setIsDeletingUser(false)
      setIsConfirmingDelete(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h1 className="text-2xl font-semibold text-slate-900">User Profile</h1>
          <p className="text-sm text-slate-500">
            Manage member profile, activity, security access and audit history.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/app/${tenantSlug}/account-settings/users`}>Back to Users</Link>
        </Button>
      </div>

      <Card className="overflow-hidden border-slate-200 py-0">
        <div className="bg-linear-to-br from-blue-950 to-blue-900 px-6 py-8 text-white">
          <div className="flex flex-col items-center text-center">
            <div
              className={cn(
                "relative rounded-full",
                user.isOnline && "ring-2 ring-emerald-400 ring-offset-2 ring-offset-blue-950",
              )}
            >
              {isUploadingAvatar ? (
                <div className="pointer-events-none absolute -inset-1 rounded-full border-3 border-emerald-400/80 border-t-transparent animate-spin" />
              ) : null}
              <Avatar className="h-24 w-24 border-4 border-white/70 bg-white/10 shadow-sm">
                {avatarUrl || user.avatar ? (
                  <AvatarImage
                    src={avatarUrl ?? user.avatar ?? ""}
                    alt={user.name}
                    className="object-cover"
                  />
                ) : null}
                <AvatarFallback className="text-lg font-semibold text-white bg-blue-950">
                  {getInitials(user.name)}
                </AvatarFallback>
              </Avatar>
              <button
                type="button"
                onClick={handleAvatarClick}
                disabled={isUploadingAvatar}
                className="absolute bottom-0 right-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-blue-900 bg-white text-blue-950 shadow-sm transition hover:scale-105 disabled:opacity-60 cursor-pointer"
                aria-label="Upload avatar"
              >
                <Camera className="h-4 w-4" />
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp"
              className="sr-only"
              onChange={handleAvatarChange}
            />
            <div className="mt-4 space-y-1">
              <CardTitle className="text-xl text-white">{user.name}</CardTitle>
              <CardDescription className="text-sm text-indigo-100">
                {user.email}
              </CardDescription>
            </div>
          </div>

          <div className="mt-6 flex flex-row flex-wrap justify-center items-center border-t border-white/15 pt-4 gap-4">
            <div className="flex flex-row gap-2 items-center text-indigo-100 bg-slate-50/5 px-3 py-2 rounded-2xl">
              <UserRoundCheck className="h-3.5 w-3.5" />
              <span className="text-xs uppercase tracking-wide">Role</span>
              <p className="text-sm font-semibold text-white">{roleLabel}</p>
            </div>
            <div className="flex flex-row gap-2 items-center text-indigo-100 bg-slate-50/5 px-3 py-2 rounded-2xl">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span className="text-xs uppercase tracking-wide">Status</span>
              <p className="text-sm font-semibold text-white">{statusLabel}</p>
            </div>
            <div className="flex flex-row gap-2 items-center text-indigo-100 bg-slate-50/5 px-3 py-2 rounded-2xl">
              <CalendarDays className="h-3.5 w-3.5" />
              <span className="text-xs uppercase tracking-wide">Member Since</span>
              <p className="text-sm font-semibold text-white">
                {formatDate(user.createdAt, user.timezone)}
              </p>
            </div>
            <div className="flex flex-row gap-2 items-center text-indigo-100 bg-slate-50/5 px-3 py-2 rounded-2xl">
              <Clock3 className="h-3.5 w-3.5" />
              <span className="text-xs uppercase tracking-wide">Updated</span>
              <p className="text-sm font-semibold text-white">
                {formatDate(user.updatedAt, user.timezone)}
              </p>
            </div>
          </div>
        </div>
      </Card>

      <div className="space-y-6">
        <Card className="border-slate-200">
          <CardHeader className="border-b border-slate-200">
            <CardTitle className="text-lg">Personal Information</CardTitle>
            <CardDescription>
              Update this member&apos;s name and email.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-2">
            <div className="space-y-4 flex flex-row gap-4">
              <div className="space-y-2 w-full">
                <Label htmlFor="memberFullName">Full Name</Label>
                <Input
                  id="memberFullName"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Full name"
                  className={
                    profileFieldErrors.name
                      ? "border-red-300 focus-visible:ring-red-200"
                      : undefined
                  }
                />
                {profileFieldErrors.name ? (
                  <p className="text-xs text-red-600">{profileFieldErrors.name}</p>
                ) : null}
              </div>
              <div className="space-y-2 w-full">
                <Label htmlFor="memberEmail">Email Address</Label>
                <Input
                  id="memberEmail"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Email address"
                  className={
                    profileFieldErrors.email
                      ? "border-red-300 focus-visible:ring-red-200"
                      : undefined
                  }
                />
                {profileFieldErrors.email ? (
                  <p className="text-xs text-red-600">{profileFieldErrors.email}</p>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              {!user.emailVerified ? (
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  onClick={() => {
                    void handleRequestVerification()
                  }}
                  disabled={isSendingVerification}
                >
                  <MailCheck className="h-4 w-4" />
                  {isSendingVerification ? "Sending..." : "Request Verification"}
                </Button>
              ) : null}
              <Button
                className="gap-2 bg-blue-950 hover:bg-blue-900"
                onClick={() => {
                  void handleSaveProfile()
                }}
                disabled={isSavingProfile}
              >
                <ShieldCheck className="h-4 w-4" />
                {isSavingProfile ? "Saving..." : "Save Changes"}
              </Button>
            </div>
            <div className="border-t border-slate-200 pt-4">
              <p className="text-xs font-medium text-rose-700">Danger Zone</p>
              <p className="mt-1 text-xs text-slate-500">
                Delete this user account and remove access.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {isConfirmingDelete ? (
                  <>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        void handleDeleteUser()
                      }}
                      disabled={isDeletingUser}
                    >
                      {isDeletingUser ? "Deleting..." : "Confirm Delete"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setIsConfirmingDelete(false)}
                      disabled={isDeletingUser}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => setIsConfirmingDelete(true)}
                  >
                    Delete User
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader className="border-b border-slate-200">
            <CardTitle className="text-lg">Access & Security</CardTitle>
            <CardDescription>
              Membership role, status and security posture.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            <div className="flex flex-wrap gap-2">
              <InlineBadge label={`Role: ${roleLabel}`} tone="accent" />
              <InlineBadge label={`Status: ${statusLabel}`} tone="info" />
              <InlineBadge
                label={`Security: ${formatSecurityLevelLabel(user.securityLevel)}`}
                tone={
                  user.securityLevel === "MAX"
                    ? "accent"
                    : user.securityLevel === "MEDIUM"
                      ? "warning"
                      : "neutral"
                }
              />
              <InlineBadge
                label={user.emailVerified ? "Email Verified" : "Email Not Verified"}
                tone={user.emailVerified ? "info" : "warning"}
              />
            </div>
            <UserSecurityLevelControl
              tenantId={tenantId}
              userId={user.id}
              role={user.role}
              initialSecurityLevel={user.securityLevel}
              onSaved={(next) => {
                setUser((prev) => ({ ...prev, securityLevel: next }))
              }}
            />
          </CardContent>
        </Card>

        <Card className="border-slate-200">
            <CardHeader className="border-b border-slate-200">
              <CardTitle className="text-lg">Activity</CardTitle>
              <CardDescription>
                Recent session and sign-in activity.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-2">
              <div className="flex flex-wrap gap-2">
                <InlineBadge
                  label={user.isOnline ? "Online" : "Offline"}
                  tone={user.isOnline ? "accent" : "neutral"}
                />
                <InlineBadge
                  label={`Last login: ${formatDateTime(user.lastLoginAt, user.timezone)}`}
                  tone="neutral"
                />
                <InlineBadge
                  label={`Session started: ${formatDateTime(user.sessionCreatedAt, user.timezone)}`}
                  tone="neutral"
                />
              </div>

              {user.activity.recentSessions.length ? (
                <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
                  {user.activity.recentSessions.map((session) => (
                    <div key={session.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-slate-900">
                          {session.isActive ? (
                            <span className="inline-flex items-center gap-1">
                              <Wifi className="h-3.5 w-3.5 text-emerald-600" />
                              Active session
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <WifiOff className="h-3.5 w-3.5 text-slate-500" />
                              Ended session
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatDateTime(session.createdAt, user.timezone)}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {session.ipAddress ? `IP ${session.ipAddress}` : "IP unavailable"}
                      </p>
                      <p className="text-xs text-slate-500">
                        {session.userAgent ?? "Unknown device"}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">No session activity available.</p>
              )}
            </CardContent>
          </Card>

        <Card className="border-slate-200">
          <CardHeader className="border-b border-slate-200">
            <CardTitle className="text-lg">Audit History</CardTitle>
            <CardDescription>
              Recent account-level timeline events.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {user.auditHistory.length ? (
              <div className="divide-y divide-slate-200">
                {user.auditHistory.map((item) => (
                  <div key={item.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-slate-900">{item.title}</p>
                      <p className="text-xs text-slate-500">
                        {formatDateTime(item.at, user.timezone)}
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">{item.detail}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No audit entries available.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {isRefreshing ? (
        <p className="text-xs text-slate-500">Refreshing user details...</p>
      ) : null}
    </div>
  )
}
