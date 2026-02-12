"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useParams, usePathname } from "next/navigation"
import {
  CalendarDays,
  Camera,
  Clock3,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
  UserRoundCheck,
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
import { Separator } from "@/components/ui/separator"
import { api } from "@/lib/api"
import { useTenantUser } from "../_components/tenant-context"

type Membership = {
  role: string
  status: string
  securityLevel?: "LOW" | "MEDIUM" | "MAX"
  tenant: { id: string; slug: string; name: string }
}

type UserProfile = {
  id: string
  name: string
  email: string
  platformRole: string
  emailVerified: boolean
  image?: string | null
  memberships?: Membership[]
  createdAt?: string
  updatedAt?: string
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

const getInitials = (value: string) => {
  const parts = value.trim().split(/\s+/)
  if (!parts.length) return "U"
  const first = parts[0]?.[0] ?? ""
  const second = parts[1]?.[0] ?? ""
  return (first + second).toUpperCase() || "U"
}

const formatDate = (value?: string) => {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(date)
}

export default function ProfilePage() {
  const params = useParams<{ tenantSlug: string }>()
  const pathname = usePathname() ?? ""
  const tenantSlug =
    params?.tenantSlug ?? pathname.match(/^\/app\/([^/]+)/)?.[1] ?? ""

  const user = useTenantUser() as UserProfile | null
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [profileFieldErrors, setProfileFieldErrors] = useState<
    Record<string, string>
  >({})
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)
  const [passwordFieldErrors, setPasswordFieldErrors] = useState<
    Record<string, string>
  >({})

  const membership = useMemo(() => {
    if (!user?.memberships?.length) return null
    return (
      user.memberships.find((item) => item.tenant?.slug === tenantSlug) ??
      user.memberships[0]
    )
  }, [user, tenantSlug])

  const roleLabel = formatRoleLabel(membership?.role)
  const statusLabel = membership?.status
    ? formatSegment(membership.status)
    : "Unknown"

  useEffect(() => {
    setFullName(user?.name ?? "")
    setEmail(user?.email ?? "")
  }, [user?.name, user?.email])

  useEffect(() => {
    if (!user?.image || !membership?.tenant?.id) return

    if (user.image.startsWith("http")) {
      setAvatarUrl(user.image)
      return
    }

    const load = async () => {
      try {
        const { data } = await api.post("/api/files/presign-download", {
          tenantId: membership.tenant.id,
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
  }, [user?.image, membership?.tenant?.id])

  const handleAvatarClick = () => {
    fileInputRef.current?.click()
  }

  const handleAvatarChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0]
    if (!file || !membership?.tenant?.id) return

    const ext = file.name.split(".").pop()?.toLowerCase()
    const inferredType =
      ext === "png"
        ? "image/png"
        : ext === "jpg" || ext === "jpeg"
          ? "image/jpeg"
          : ext === "webp"
            ? "image/webp"
            : ""
    const contentType = file.type || inferredType
    if (!contentType) {
      throw new Error("UNSUPPORTED_CONTENT_TYPE")
    }

    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append("tenantId", membership.tenant.id)
      formData.append("file", file)

      const { data } = await api.post("/api/files/avatar-upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      if (!data?.ok) {
        throw new Error("UPLOAD_FAILED")
      }

      if (data?.imageUrl) {
        setAvatarUrl(data.imageUrl)
        toast.success("Avatar updated.")
        window.dispatchEvent(
          new CustomEvent("avatar-updated", {
            detail: { imageUrl: data.imageUrl },
          }),
        )
      }
    } catch {
      toast.error("Could not update avatar. Please try again.")
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }

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
      await api.patch("/api/auth/me", payload)
      toast.success("Profile updated.")
      window.dispatchEvent(
        new CustomEvent("profile-updated", {
          detail: { name: payload.name, email: payload.email },
        }),
      )
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
        }
        if (code === "EMAIL_IN_USE") {
          setProfileFieldErrors((prev) => ({
            ...prev,
            email: "That email is already in use.",
          }))
        } else if (code && !Array.isArray(details)) {
          toast.error("Could not save changes. Please try again.")
        }
      } else {
        toast.error("Could not save changes. Please try again.")
      }
    } finally {
      setIsSavingProfile(false)
    }
  }

  const handleUpdatePassword = async () => {
    setPasswordFieldErrors({})

    const nextFieldErrors: Record<string, string> = {}
    if (!currentPassword) {
      nextFieldErrors.currentPassword = "Current password is required."
    }
    if (!newPassword) {
      nextFieldErrors.newPassword = "New password is required."
    }
    if (!confirmPassword) {
      nextFieldErrors.confirmPassword = "Confirm your new password."
    }
    if (newPassword && confirmPassword && newPassword !== confirmPassword) {
      nextFieldErrors.confirmPassword = "Passwords do not match."
    }
    if (newPassword && newPassword.length < 8) {
      nextFieldErrors.newPassword = "Password must be at least 8 characters."
    }
    if (newPassword && !/[A-Za-z]/.test(newPassword)) {
      nextFieldErrors.newPassword = "Password must include at least one letter."
    }
    if (newPassword && !/[0-9]/.test(newPassword)) {
      nextFieldErrors.newPassword = "Password must include at least one number."
    }
    if (newPassword && !/[^A-Za-z0-9]/.test(newPassword)) {
      nextFieldErrors.newPassword = "Password must include at least one symbol."
    }

    if (Object.keys(nextFieldErrors).length > 0) {
      setPasswordFieldErrors(nextFieldErrors)
      return
    }

    setIsUpdatingPassword(true)
    try {
      await api.patch("/api/auth/me/password", {
        currentPassword,
        newPassword,
      })
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      toast.success("Password updated.")
    } catch (error) {
      if (isAxiosError(error)) {
        const code = error.response?.data?.error
        const details = error.response?.data?.details
        if (Array.isArray(details)) {
          const zodErrors: Record<string, string> = {}
          for (const item of details) {
            if (item?.path) zodErrors[item.path] = item.message
          }
          setPasswordFieldErrors(zodErrors)
          return
        }
        if (code === "INVALID_CURRENT_PASSWORD") {
          setPasswordFieldErrors({
            currentPassword: "Current password is invalid.",
          })
          return
        }
        if (code === "NEW_PASSWORD_SAME_AS_CURRENT") {
          setPasswordFieldErrors({
            newPassword: "Use a different password than your current one.",
          })
          return
        }
      }
      toast.error("Could not update password. Please try again.")
    } finally {
      setIsUpdatingPassword(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-0.5">
        <h1 className="text-2xl font-semibold text-slate-900">
          Profile Settings
        </h1>
        <p className="text-sm text-slate-500">
          Manage your account information and security preferences.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        <Card className="overflow-hidden border-slate-200 py-0">
          <div className="bg-linear-to-br from-blue-950 to-blue-900 px-6 py-8 text-white">
            <div className="flex flex-col items-center text-center">
              <div className="relative">
                {isUploading ? (
                  <div className="pointer-events-none absolute -inset-1 rounded-full border-3 border-emerald-400/80 border-t-transparent animate-spin" />
                ) : null}
                <Avatar className="h-24 w-24 border-4 border-white/70 bg-white/10 shadow-sm">
                  {avatarUrl || user?.image ? (
                    <AvatarImage
                      src={avatarUrl ?? user?.image ?? ""}
                      alt={user?.name ?? "User"}
                      className=" object-cover"
                    />
                  ) : null}
                  <AvatarFallback className="text-lg font-semibold text-white bg-blue-950">
                    {getInitials(user?.name ?? "User")}
                  </AvatarFallback>
                </Avatar>
                <button
                  type="button"
                  onClick={handleAvatarClick}
                  disabled={isUploading}
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
              {isUploading ? (
                <p className="mt-3 text-xs font-medium text-indigo-100">
                  Uploading and processing your avatar...
                </p>
              ) : null}
              <div className="mt-4 space-y-1">
                <CardTitle className="text-xl text-white">
                  {fullName || "User"}
                </CardTitle>
                <CardDescription className="text-sm text-indigo-100">
                  {email || ""}
                </CardDescription>
              </div>
            </div>
            <div className="mt-6 flex flex-row flex-wrap justify-center items-center border-t border-white/15 pt-4 gap-4">
              <div className="flex flex-row gap-2 items-center text-indigo-100 bg-slate-50/5 px-3 py-2 rounded-2xl">
                <div className="flex items-center gap-2 text-indigo-100">
                  <UserRoundCheck className="h-3.5 w-3.5" />
                  <span className="text-xs uppercase tracking-wide">Role</span>
                </div>
                <p className="text-sm font-semibold text-white sm:text-right">
                  {roleLabel}
                </p>
              </div>
              <div className="flex flex-row gap-2 items-center text-indigo-100 bg-slate-50/5 px-3 py-2 rounded-2xl">
                <div className="flex items-center gap-2 text-indigo-100">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span className="text-xs uppercase tracking-wide">
                    Account Status
                  </span>
                </div>
                <p className="text-sm font-semibold text-white sm:text-right">
                  {statusLabel}
                </p>
              </div>
              <div className="flex flex-row gap-2 items-center text-indigo-100 bg-slate-50/5 px-3 py-2 rounded-2xl">
                <div className="flex items-center gap-2 text-indigo-100">
                  <CalendarDays className="h-3.5 w-3.5" />
                  <span className="text-xs uppercase tracking-wide">
                    Member Since
                  </span>
                </div>
                <p className="text-sm font-semibold text-white sm:text-right">
                  {formatDate(user?.createdAt)}
                </p>
              </div>
              <div className="flex flex-row gap-2 items-center text-indigo-100 bg-slate-50/5 px-3 py-2 rounded-2xl">
                <div className="flex items-center gap-2 text-indigo-100">
                  <Clock3 className="h-3.5 w-3.5" />
                  <span className="text-xs uppercase tracking-wide">
                    Last Updated
                  </span>
                </div>
                <p className="text-sm font-semibold text-white sm:text-right">
                  {formatDate(user?.updatedAt)}
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
                Update your profile details and account status.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full Name</Label>
                  <Input
                    id="fullName"
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
                    <p className="text-xs text-red-600">
                      {profileFieldErrors.name}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
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
                    <p className="text-xs text-red-600">
                      {profileFieldErrors.email}
                    </p>
                  ) : null}
                </div>
              </div>
            </CardContent>
            <CardContent className="pt-0">
              <div className="flex flex-wrap items-center justify-end gap-3">
                <Button
                  className="gap-2 bg-blue-950 hover:bg-blue-900 cursor-pointer"
                  onClick={handleSaveProfile}
                  disabled={isSavingProfile}
                >
                  <ShieldCheck className="h-4 w-4" />
                  {isSavingProfile ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardHeader className="border-b border-slate-200">
              <CardTitle className="text-lg">Security Settings</CardTitle>
              <CardDescription>Change your password.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="currentPassword">Current Password</Label>
                <div className="relative">
                  <Input
                    id="currentPassword"
                    type={showCurrentPassword ? "text" : "password"}
                    placeholder="Enter current password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    className={
                      passwordFieldErrors.currentPassword
                        ? "border-red-300 pr-10 focus-visible:ring-red-200"
                        : "pr-10"
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    aria-label={
                      showCurrentPassword
                        ? "Hide current password"
                        : "Show current password"
                    }
                  >
                    {showCurrentPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {passwordFieldErrors.currentPassword ? (
                  <p className="text-xs text-red-600">
                    {passwordFieldErrors.currentPassword}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="newPassword">New Password</Label>
                  <div className="relative">
                    <Input
                      id="newPassword"
                      type={showNewPassword ? "text" : "password"}
                      placeholder="New password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      className={
                        passwordFieldErrors.newPassword
                          ? "border-red-300 pr-10 focus-visible:ring-red-200"
                          : "pr-10"
                      }
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      aria-label={
                        showNewPassword
                          ? "Hide new password"
                          : "Show new password"
                      }
                    >
                      {showNewPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {passwordFieldErrors.newPassword ? (
                    <p className="text-xs text-red-600">
                      {passwordFieldErrors.newPassword}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm New Password</Label>
                  <div className="relative">
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder="Confirm new password"
                      value={confirmPassword}
                      onChange={(event) =>
                        setConfirmPassword(event.target.value)
                      }
                      className={
                        passwordFieldErrors.confirmPassword
                          ? "border-red-300 pr-10 focus-visible:ring-red-200"
                          : "pr-10"
                      }
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      aria-label={
                        showConfirmPassword
                          ? "Hide confirm password"
                          : "Show confirm password"
                      }
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {passwordFieldErrors.confirmPassword ? (
                    <p className="text-xs text-red-600">
                      {passwordFieldErrors.confirmPassword}
                    </p>
                  ) : null}
                </div>
              </div>
              <Separator className="my-2" />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <KeyRound className="h-3.5 w-3.5" />
                  Use at least 8 characters, including 1 letter, 1 number and 1 symbol.
                </div>
                <Button
                  className="gap-2 bg-blue-950 hover:bg-blue-900 cursor-pointer"
                  onClick={handleUpdatePassword}
                  disabled={isUpdatingPassword}
                >
                  <ShieldCheck className="h-4 w-4" />
                  {isUpdatingPassword ? "Updating..." : "Update Password"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
