"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useParams, usePathname } from "next/navigation"
import {
  CalendarDays,
  Camera,
  Clock3,
  KeyRound,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react"

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
        window.dispatchEvent(
          new CustomEvent("avatar-updated", {
            detail: { imageUrl: data.imageUrl },
          }),
        )
      }
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="space-y-1">
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
                  className="absolute bottom-0 right-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-blue-900 bg-white text-blue-950 shadow-sm transition hover:scale-105 disabled:opacity-60"
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
                  {user?.name ?? "User"}
                </CardTitle>
                <CardDescription className="text-sm text-indigo-100">
                  {user?.email ?? ""}
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
                    defaultValue={user?.name ?? ""}
                    placeholder="Full name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    defaultValue={user?.email ?? ""}
                    placeholder="Email address"
                  />
                </div>
              </div>
            </CardContent>
            <CardContent className="pt-0">
              <div className="flex flex-wrap items-center justify-end gap-3">
                <Button className="gap-2 bg-blue-950 hover:bg-blue-900">
                  <ShieldCheck className="h-4 w-4" />
                  Save Changes
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
                <Input
                  id="currentPassword"
                  type="password"
                  placeholder="Enter current password"
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="newPassword">New Password</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    placeholder="New password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm New Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="Confirm new password"
                  />
                </div>
              </div>
              <Separator className="my-2" />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <KeyRound className="h-3.5 w-3.5" />
                  Use at least 8 characters, including a number.
                </div>
                <Button className="gap-2 bg-blue-950 hover:bg-blue-900">
                  <ShieldCheck className="h-4 w-4" />
                  Update Password
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
