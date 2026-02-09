"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { tenantSignup } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { isAxiosError } from "axios"
import { Eye, EyeOff } from "lucide-react"

export default function SignUpPage() {
  const router = useRouter()
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">(
    "idle",
  )
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [planKey, setPlanKey] = useState<"STARTER" | "PRO" | "BUSINESS">(
    "STARTER",
  )
  const [paidNow, setPaidNow] = useState(false)
  const [adminPassword, setAdminPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const passwordsMatch =
    confirmPassword.length > 0 && adminPassword === confirmPassword

  const isLoading = status === "loading"

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus("loading")
    setError(null)
    setFieldErrors({})

    const form = event.currentTarget
    const formData = new FormData(event.currentTarget)
    const payload = {
      adminName: String(formData.get("adminName") || "").trim(),
      adminEmail: String(formData.get("adminEmail") || "").trim(),
      adminPassword,
      tenantName: String(formData.get("tenantName") || "").trim(),
      planKey,
      paidNow,
    }

    const clientErrors: Record<string, string> = {}
    if (!payload.adminName) clientErrors.adminName = "Full name is required."
    if (!payload.adminEmail) clientErrors.adminEmail = "Email is required."
    if (!payload.adminPassword)
      clientErrors.adminPassword = "Password is required."
    if (!payload.tenantName)
      clientErrors.tenantName = "Workspace name is required."

    if (confirmPassword && confirmPassword !== payload.adminPassword) {
      clientErrors.adminPassword = "Passwords do not match."
      clientErrors.confirmPassword = "Passwords do not match."
    }

    if (Object.keys(clientErrors).length > 0) {
      setStatus("error")
      setFieldErrors(clientErrors)
      return
    }

    try {
      await tenantSignup(payload)

      setStatus("success")
      setFieldErrors({})
      setAdminPassword("")
      setConfirmPassword("")
      form.reset()
      router.push("/signup/success")
    } catch (err) {
      setStatus("error")
      let message: string | null = "Something went wrong. Please try again."
      if (isAxiosError(err)) {
        const code = err.response?.data?.error
        const details = err.response?.data?.details
        if (Array.isArray(details)) {
          const nextErrors: Record<string, string> = {}
          for (const item of details) {
            if (item?.path) nextErrors[item.path] = item.message
          }
          setFieldErrors(nextErrors)
          message = null
        }
        switch (code) {
          case "EMAIL_IN_USE":
            setFieldErrors((prev) => ({
              ...prev,
              adminEmail: "That email is already in use.",
            }))
            message = null
            break
          case "TENANT_EMAIL_IN_USE":
            setFieldErrors((prev) => ({
              ...prev,
              adminEmail: "That email is already in use.",
            }))
            message = null
            break
          case "TENANT_SLUG_IN_USE":
            setFieldErrors((prev) => ({
              ...prev,
              tenantName: "That workspace name is taken.",
            }))
            message = null
            break
          case "INVALID_TENANT_NAME":
            setFieldErrors((prev) => ({
              ...prev,
              tenantName: "Workspace name is invalid.",
            }))
            message = null
            break
          default:
            message =
              typeof code === "string" && code.length > 0
                ? "Something went wrong. Please try again."
                : err.message || message
        }
      } else if (err instanceof Error) {
        message = err.message
      }
      setError(message)
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#f5f5f5,_#e4e7eb_45%,_#d7dbe1_100%)] px-6 py-16 text-zinc-900">
      <div className="mx-auto w-full max-w-2xl">
        <section className="rounded-3xl border border-black/10 bg-white p-10 shadow-2xl">
          <div className="mb-8">
            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
              GestiaBloc
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight">
              Create your workspace
            </h1>
            <p className="mt-2 text-sm text-zinc-500">
              Already have a workspace?{" "}
              <a className="font-medium text-zinc-900" href="/login">
                Sign in
              </a>
            </p>
          </div>

          <form className="space-y-8" onSubmit={onSubmit}>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">
                      Admin account
                    </p>
                    <p className="text-xs text-zinc-500">
                      This person manages billing and invites.
                    </p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="adminName">Full name</Label>
                      <Input
                        className={
                          fieldErrors.adminName
                            ? "border-red-300 focus-visible:ring-red-200"
                            : undefined
                        }
                        id="adminName"
                        name="adminName"
                        placeholder="Ada Lovelace"
                        required
                        type="text"
                      />
                      {fieldErrors.adminName ? (
                        <p className="text-xs text-red-600">
                          {fieldErrors.adminName}
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="adminEmail">Work email</Label>
                      <Input
                        className={
                          fieldErrors.adminEmail
                            ? "border-red-300 focus-visible:ring-red-200"
                            : undefined
                        }
                        id="adminEmail"
                        name="adminEmail"
                        placeholder="you@company.com"
                        required
                        type="email"
                      />
                      {fieldErrors.adminEmail ? (
                        <p className="text-xs text-red-600">
                          {fieldErrors.adminEmail}
                        </p>
                      ) : null}
                    </div>
                  </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="adminPassword">Password</Label>
                    <div className="relative">
                      <Input
                        className={
                          fieldErrors.adminPassword
                            ? "border-red-300 pr-10 focus-visible:ring-red-200"
                            : "pr-10"
                        }
                        id="adminPassword"
                        name="adminPassword"
                        placeholder="At least 8 characters"
                        required
                        type={showPassword ? "text" : "password"}
                        value={adminPassword}
                        onChange={(event) => setAdminPassword(event.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700"
                          aria-label={
                            showPassword ? "Hide password" : "Show password"
                          }
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                      </button>
                    </div>
                    <div className="grid gap-1 text-xs text-zinc-500">
                      <p
                        className={
                          adminPassword.length >= 8
                            ? "text-emerald-600"
                            : undefined
                        }
                      >
                        {adminPassword.length >= 8 ? "✓" : "•"} 8+ characters
                      </p>
                      <p
                        className={
                          /[A-Za-z]/.test(adminPassword)
                            ? "text-emerald-600"
                            : undefined
                        }
                      >
                        {/[A-Za-z]/.test(adminPassword) ? "✓" : "•"} At least 1
                        letter
                      </p>
                      <p
                        className={
                          /[0-9]/.test(adminPassword)
                            ? "text-emerald-600"
                            : undefined
                        }
                      >
                        {/[0-9]/.test(adminPassword) ? "✓" : "•"} At least 1
                        number
                      </p>
                      <p
                        className={
                          /[^A-Za-z0-9]/.test(adminPassword)
                            ? "text-emerald-600"
                            : undefined
                        }
                      >
                        { /[^A-Za-z0-9]/.test(adminPassword) ? "✓" : "•"} At
                        least 1 symbol
                      </p>
                    </div>
                    {fieldErrors.adminPassword ? (
                      <p className="text-xs text-red-600">
                        {fieldErrors.adminPassword}
                      </p>
                    ) : null}
                    </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm password</Label>
                  <div className="relative">
                    <Input
                          className={
                            fieldErrors.confirmPassword
                              ? "border-red-300 pr-10 focus-visible:ring-red-200"
                              : "pr-10"
                          }
                          id="confirmPassword"
                          name="confirmPassword"
                          placeholder="Repeat your password"
                          required
                          type={showConfirmPassword ? "text" : "password"}
                          value={confirmPassword}
                          onChange={(event) =>
                        setConfirmPassword(event.target.value)
                      }
                    />
                    <button
                      type="button"
                          onClick={() =>
                            setShowConfirmPassword((prev) => !prev)
                          }
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700"
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
                  {confirmPassword.length > 0 ? (
                    <p
                      className={
                        passwordsMatch
                          ? "text-xs text-emerald-600"
                          : "text-xs text-red-600"
                      }
                    >
                      {passwordsMatch
                        ? "✓ Passwords match"
                        : "Passwords do not match"}
                    </p>
                  ) : null}
                  {fieldErrors.confirmPassword ? (
                    <p className="text-xs text-red-600">
                      {fieldErrors.confirmPassword}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="h-px w-full bg-zinc-100" />

                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">
                      Workspace details
                    </p>
                    <p className="text-xs text-zinc-500">
                      We use this to create your tenant and plan.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tenantName">Workspace name</Label>
                    <Input
                      className={
                        fieldErrors.tenantName
                          ? "border-red-300 focus-visible:ring-red-200"
                          : undefined
                      }
                      id="tenantName"
                      name="tenantName"
                      placeholder="Acme Studio"
                      required
                      type="text"
                    />
                    {fieldErrors.tenantName ? (
                      <p className="text-xs text-red-600">
                        {fieldErrors.tenantName}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="planKey">Plan</Label>
                    <Select
                      value={planKey}
                      onValueChange={(value) =>
                        setPlanKey(
                          value as "STARTER" | "PRO" | "BUSINESS",
                        )
                      }
                    >
                      <SelectTrigger id="planKey">
                        <SelectValue placeholder="Select a plan" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="STARTER">
                          Starter (3 seats)
                        </SelectItem>
                        <SelectItem value="PRO">Pro (10 seats)</SelectItem>
                        <SelectItem value="BUSINESS">
                          Business (25 seats)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-zinc-500">
                      You can change your plan anytime after signup.
                    </p>
                  </div>

                  <label className="flex items-center gap-3 text-sm text-zinc-600">
                    <Checkbox
                      checked={paidNow}
                      onCheckedChange={(value) => setPaidNow(Boolean(value))}
                    />
                    Pay now (skip 7-day trial)
                  </label>
                </div>

                <Button className="w-full" disabled={isLoading} type="submit">
                  {isLoading ? "Creating account..." : "Create account"}
                </Button>

                {status === "success" ? (
                  <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    Account created. Check your email for verification steps.
                  </p>
                ) : null}

                {status === "error" && error ? (
                  <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                  </p>
                ) : null}

                <p className="text-xs text-zinc-500">
                  By creating an account you agree to our Terms and Privacy
                  Policy.
                </p>
          </form>
        </section>
      </div>
    </div>
  )
}
