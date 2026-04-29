"use client"

import { useMemo, useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { isAxiosError } from "axios"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { api } from "@/lib/api"

type TenantRole = "TENANT_ADMIN" | "TENANT_USER"
type SecurityLevel = "LOW" | "MEDIUM" | "MAX"

type CreateUserDialogProps = {
  tenantId: string
  onCreated: () => Promise<void> | void
  disabled?: boolean
  disabledReason?: string
}

type FieldErrors = Partial<
  Record<"name" | "email" | "password" | "confirmPassword", string>
>

const passwordRequirements = {
  minLength: 8,
  letter: /[A-Za-z]/,
  number: /[0-9]/,
  symbol: /[^A-Za-z0-9]/,
}

export function CreateUserDialog({
  tenantId,
  onCreated,
  disabled = false,
  disabledReason,
}: CreateUserDialogProps) {
  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [role, setRole] = useState<TenantRole>("TENANT_USER")
  const [securityLevel, setSecurityLevel] = useState<SecurityLevel>("LOW")
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const passwordHint = useMemo(
    () => "At least 8 chars, with 1 letter, 1 number, and 1 symbol.",
    [],
  )

  const resetForm = () => {
    setName("")
    setEmail("")
    setPassword("")
    setConfirmPassword("")
    setShowPassword(false)
    setShowConfirmPassword(false)
    setRole("TENANT_USER")
    setSecurityLevel("LOW")
    setFieldErrors({})
  }

  const validate = () => {
    const nextErrors: FieldErrors = {}

    if (!name.trim()) {
      nextErrors.name = "Name is required."
    }

    if (!email.trim()) {
      nextErrors.email = "Email is required."
    }

    if (!password) {
      nextErrors.password = "Password is required."
    } else {
      const valid =
        password.length >= passwordRequirements.minLength &&
        passwordRequirements.letter.test(password) &&
        passwordRequirements.number.test(password) &&
        passwordRequirements.symbol.test(password)

      if (!valid) {
        nextErrors.password = passwordHint
      }
    }

    if (!confirmPassword) {
      nextErrors.confirmPassword = "Please confirm the password."
    } else if (confirmPassword !== password) {
      nextErrors.confirmPassword = "Passwords do not match."
    }

    setFieldErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const onSubmit = async () => {
    if (!validate()) return

    setIsSubmitting(true)
    try {
      await api.post(`/api/account-settings/${tenantId}/users`, {
        name: name.trim(),
        email: email.trim(),
        password,
        role,
        securityLevel,
      })

      toast.success("User created. Verification email sent.")
      await onCreated()
      setOpen(false)
      resetForm()
    } catch (error) {
      if (isAxiosError(error)) {
        const responseData = error.response?.data as
          | { error?: string; details?: Array<{ path?: string; message?: string }> }
          | undefined

        if (Array.isArray(responseData?.details)) {
          const mappedErrors: FieldErrors = {}
          for (const detail of responseData.details) {
            if (detail.path === "name" && detail.message) mappedErrors.name = detail.message
            if (detail.path === "email" && detail.message) mappedErrors.email = detail.message
            if (detail.path === "password" && detail.message) {
              mappedErrors.password = detail.message
            }
          }
          if (Object.keys(mappedErrors).length) {
            setFieldErrors(mappedErrors)
          }
        }

        const backendError = responseData?.error
        if (backendError === "SEAT_LIMIT_REACHED") {
          toast.error("Seat limit reached for your current subscription.")
        } else if (backendError === "EMAIL_IN_USE") {
          setFieldErrors((prev) => ({ ...prev, email: "Email is already in use." }))
          toast.error("Email is already in use.")
        } else if (typeof backendError === "string") {
          toast.error(backendError.replace(/_/g, " "))
        } else {
          toast.error("Could not create user.")
        }
      } else {
        toast.error("Could not create user.")
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) {
          resetForm()
        }
      }}
    >
      <div className="flex flex-col items-end gap-1">
        <DialogTrigger asChild>
          <Button
            type="button"
            className="w-full cursor-pointer bg-white text-slate-950 hover:bg-slate-100 sm:self-start"
            disabled={disabled}
          >
            Add User
          </Button>
        </DialogTrigger>
        {disabledReason ? (
          <p className="max-w-56 text-right text-xs text-amber-600">{disabledReason}</p>
        ) : null}
      </div>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create User</DialogTitle>
          <DialogDescription>
            Create a tenant member account and send a verification email.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="rounded-lg border border-slate-200 p-3 sm:p-4">
            <p className="text-sm font-medium text-slate-900">Identity</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Basic information for the new member.
            </p>

            <div className="mt-3 grid gap-3">
              <div className="grid gap-2">
                <Label htmlFor="create-user-name">Name</Label>
                <Input
                  id="create-user-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="John Doe"
                />
                {fieldErrors.name ? (
                  <p className="text-xs text-rose-600">{fieldErrors.name}</p>
                ) : null}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="create-user-email">Email</Label>
                <Input
                  id="create-user-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="john@company.com"
                />
                {fieldErrors.email ? (
                  <p className="text-xs text-rose-600">{fieldErrors.email}</p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-3 sm:p-4">
            <p className="text-sm font-medium text-slate-900">Access & Security</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Set role, security level, and initial password.
            </p>

            <div className="mt-3 grid gap-3">
              <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
                <div className="grid gap-2">
                  <Label>Role</Label>
                  <Select
                    value={role}
                    onValueChange={(nextRole) => {
                      if (nextRole === "TENANT_ADMIN" || nextRole === "TENANT_USER") {
                        setRole(nextRole)
                        setSecurityLevel(nextRole === "TENANT_ADMIN" ? "MAX" : "LOW")
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TENANT_USER">User</SelectItem>
                      <SelectItem value="TENANT_ADMIN">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>Security Level</Label>
                  <Select
                    value={securityLevel}
                    onValueChange={(nextLevel) => {
                      if (nextLevel === "LOW" || nextLevel === "MEDIUM" || nextLevel === "MAX") {
                        setSecurityLevel(nextLevel)
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LOW">Low</SelectItem>
                      <SelectItem value="MEDIUM">Medium</SelectItem>
                      <SelectItem value="MAX">Max</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="create-user-password">Password</Label>
                <div className="relative">
                  <Input
                    id="create-user-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Create a secure password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center text-slate-500 hover:text-slate-700"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {fieldErrors.password ? (
                  <p className="text-xs text-rose-600">{fieldErrors.password}</p>
                ) : (
                  <p className="text-xs text-slate-500">{passwordHint}</p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="create-user-confirm-password">Confirm Password</Label>
                <div className="relative">
                  <Input
                    id="create-user-confirm-password"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="Repeat the password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    aria-label={
                      showConfirmPassword
                        ? "Hide confirmation password"
                        : "Show confirmation password"
                    }
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                    className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center text-slate-500 hover:text-slate-700"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {fieldErrors.confirmPassword ? (
                  <p className="text-xs text-rose-600">{fieldErrors.confirmPassword}</p>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              void onSubmit()
            }}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Creating..." : "Create User"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
