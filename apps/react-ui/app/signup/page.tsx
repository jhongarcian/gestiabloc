"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { isAxiosError } from "axios"
import {
  ArrowRight,
  Box,
  Building2,
  Check,
  CheckCircle2,
  Circle,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  User,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { tenantSignup } from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  isPlanKey,
  subscriptionPlans,
  type PlanKey,
} from "@/lib/subscription-plans"

const AUTH_INPUT_CLASS =
  "h-11 rounded-full border-white bg-white px-4 text-sm text-slate-950 shadow-sm focus-visible:border-blue-300 focus-visible:ring-blue-300/40 aria-invalid:border-rose-300 aria-invalid:ring-rose-200/30 disabled:bg-blue-50 disabled:opacity-80"

const AUTH_PRIMARY_BUTTON_CLASS =
  "h-11 w-full cursor-pointer rounded-full bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm ring-1 ring-white/15 transition hover:bg-blue-500 hover:text-white disabled:cursor-not-allowed disabled:bg-blue-900 disabled:text-blue-300"

export default function SignUpPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[100svh] items-center justify-center bg-blue-950 text-sm text-blue-100/70">
          Loading signup…
        </div>
      }
    >
      <SignUpContent />
    </Suspense>
  )
}

function SignUpContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const requestedPlan = searchParams.get("plan")
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle")
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [planKey, setPlanKey] = useState<PlanKey>(
    isPlanKey(requestedPlan) ? requestedPlan : "STARTER",
  )
  const [adminPassword, setAdminPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const passwordsMatch =
    confirmPassword.length > 0 && adminPassword === confirmPassword
  const passwordRequirements = [
    { label: "8 or more characters", met: adminPassword.length >= 8 },
    { label: "At least one letter", met: /[A-Za-z]/.test(adminPassword) },
    { label: "At least one number", met: /[0-9]/.test(adminPassword) },
    { label: "At least one symbol", met: /[^A-Za-z0-9]/.test(adminPassword) },
    { label: "Passwords match", met: passwordsMatch },
  ]

  const isLoading = status === "loading"

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus("loading")
    setError(null)
    setFieldErrors({})

    const form = event.currentTarget
    const formData = new FormData(form)
    const payload = {
      adminName: String(formData.get("adminName") || "").trim(),
      adminEmail: String(formData.get("adminEmail") || "").trim(),
      adminPassword,
      tenantName: String(formData.get("tenantName") || "").trim(),
      planKey,
      paidNow: false,
    }

    const clientErrors: Record<string, string> = {}
    if (!payload.adminName) clientErrors.adminName = "Full name is required."
    if (!payload.adminEmail) clientErrors.adminEmail = "Email is required."
    if (!payload.adminPassword) {
      clientErrors.adminPassword = "Password is required."
    }
    if (!payload.tenantName) {
      clientErrors.tenantName = "Workspace name is required."
    }

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
    <main className="relative min-h-[100svh] overflow-x-hidden bg-blue-950 text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:44px_44px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 left-1/2 size-[32rem] -translate-x-1/2 rounded-full bg-blue-500/25 blur-3xl"
      />

      <div
        id="signup-container"
        className="relative z-10 flex min-h-[100svh] w-full justify-center px-4 py-8 sm:px-8 sm:py-12"
      >
        <section className="w-full max-w-[680px]">
          <header className="mb-9 text-center">
            <Link
              href="/"
              className="inline-flex items-center gap-3 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
              aria-label="Gestiabloc home"
            >
              <span className="flex size-10 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-white shadow-sm">
                <Box className="size-5" aria-hidden="true" />
              </span>
              <span className="text-xl font-semibold tracking-tight text-white">
                Gestiabloc
              </span>
            </Link>
            <h1 className="mt-7 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Create your workspace
            </h1>
            <p className="mt-2 text-sm leading-6 text-blue-100/75">
              Start your 7-day free trial. No card required.
            </p>
          </header>

          <form
            id="create-account-form"
            className="flex flex-col gap-8"
            onSubmit={onSubmit}
          >
            <FieldGroup className="gap-5">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field
                  data-invalid={Boolean(fieldErrors.adminName)}
                  data-disabled={isLoading}
                  className="gap-2"
                >
                  <FieldLabel
                    htmlFor="adminName"
                    className="text-sm font-medium text-blue-50"
                  >
                    Full name
                  </FieldLabel>
                  <div className="relative">
                    <User
                      className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <Input
                      type="text"
                      id="adminName"
                      name="adminName"
                      autoComplete="name"
                      placeholder="John Doe"
                      required
                      disabled={isLoading}
                      aria-invalid={Boolean(fieldErrors.adminName)}
                      aria-describedby={
                        fieldErrors.adminName ? "admin-name-error" : undefined
                      }
                      className={cn(AUTH_INPUT_CLASS, "pl-11")}
                    />
                  </div>
                  <FieldError
                    id="admin-name-error"
                    className="text-xs text-rose-200"
                  >
                    {fieldErrors.adminName}
                  </FieldError>
                </Field>

                <Field
                  data-invalid={Boolean(fieldErrors.adminEmail)}
                  data-disabled={isLoading}
                  className="gap-2"
                >
                  <FieldLabel
                    htmlFor="adminEmail"
                    className="text-sm font-medium text-blue-50"
                  >
                    Work email
                  </FieldLabel>
                  <div className="relative">
                    <Mail
                      className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <Input
                      type="email"
                      id="adminEmail"
                      name="adminEmail"
                      autoComplete="email"
                      placeholder="name@company.com"
                      required
                      disabled={isLoading}
                      aria-invalid={Boolean(fieldErrors.adminEmail)}
                      aria-describedby={
                        fieldErrors.adminEmail ? "admin-email-error" : undefined
                      }
                      className={cn(AUTH_INPUT_CLASS, "pl-11")}
                    />
                  </div>
                  <FieldError
                    id="admin-email-error"
                    className="text-xs text-rose-200"
                  >
                    {fieldErrors.adminEmail}
                  </FieldError>
                </Field>
              </div>

              <Field
                data-invalid={Boolean(fieldErrors.tenantName)}
                data-disabled={isLoading}
                className="gap-2"
              >
                <FieldLabel
                  htmlFor="tenantName"
                  className="text-sm font-medium text-blue-50"
                >
                  Workspace name
                </FieldLabel>
                <div className="relative">
                  <Building2
                    className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <Input
                    type="text"
                    id="tenantName"
                    name="tenantName"
                    autoComplete="organization"
                    placeholder="Acme Agency"
                    required
                    disabled={isLoading}
                    aria-invalid={Boolean(fieldErrors.tenantName)}
                    aria-describedby={
                      fieldErrors.tenantName ? "tenant-name-error" : undefined
                    }
                    className={cn(AUTH_INPUT_CLASS, "pl-11")}
                  />
                </div>
                <FieldError
                  id="tenant-name-error"
                  className="text-xs text-rose-200"
                >
                  {fieldErrors.tenantName}
                </FieldError>
              </Field>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field
                  data-invalid={Boolean(fieldErrors.adminPassword)}
                  data-disabled={isLoading}
                  className="gap-2"
                >
                  <FieldLabel
                    htmlFor="adminPassword"
                    className="text-sm font-medium text-blue-50"
                  >
                    Password
                  </FieldLabel>
                  <div className="relative">
                    <Lock
                      className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <Input
                      type={showPassword ? "text" : "password"}
                      id="adminPassword"
                      name="adminPassword"
                      autoComplete="new-password"
                      placeholder="Create a password"
                      value={adminPassword}
                      required
                      disabled={isLoading}
                      onChange={(event) => setAdminPassword(event.target.value)}
                      aria-invalid={Boolean(fieldErrors.adminPassword)}
                      aria-describedby={
                        fieldErrors.adminPassword
                          ? "admin-password-error"
                          : "password-requirements"
                      }
                      className={cn(AUTH_INPUT_CLASS, "pl-11 pr-11")}
                    />
                    <button
                      type="button"
                      disabled={isLoading}
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute right-2 top-1/2 flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-slate-400 transition hover:bg-blue-50 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                    >
                      {showPassword ? (
                        <EyeOff className="size-4" aria-hidden="true" />
                      ) : (
                        <Eye className="size-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  <FieldError
                    id="admin-password-error"
                    className="text-xs text-rose-200"
                  >
                    {fieldErrors.adminPassword}
                  </FieldError>
                </Field>

                <Field
                  data-invalid={Boolean(fieldErrors.confirmPassword)}
                  data-disabled={isLoading}
                  className="gap-2"
                >
                  <FieldLabel
                    htmlFor="confirmPassword"
                    className="text-sm font-medium text-blue-50"
                  >
                    Confirm password
                  </FieldLabel>
                  <div className="relative">
                    <Lock
                      className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <Input
                      type={showConfirmPassword ? "text" : "password"}
                      id="confirmPassword"
                      name="confirmPassword"
                      autoComplete="new-password"
                      placeholder="Repeat your password"
                      value={confirmPassword}
                      required
                      disabled={isLoading}
                      onChange={(event) =>
                        setConfirmPassword(event.target.value)
                      }
                      aria-invalid={Boolean(fieldErrors.confirmPassword)}
                      aria-describedby={
                        fieldErrors.confirmPassword
                          ? "confirm-password-error"
                          : "password-requirements"
                      }
                      className={cn(AUTH_INPUT_CLASS, "pl-11 pr-11")}
                    />
                    <button
                      type="button"
                      disabled={isLoading}
                      onClick={() =>
                        setShowConfirmPassword((prev) => !prev)
                      }
                      className="absolute right-2 top-1/2 flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-slate-400 transition hover:bg-blue-50 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={
                        showConfirmPassword
                          ? "Hide confirm password"
                          : "Show confirm password"
                      }
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="size-4" aria-hidden="true" />
                      ) : (
                        <Eye className="size-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  <FieldError
                    id="confirm-password-error"
                    className="text-xs text-rose-200"
                  >
                    {fieldErrors.confirmPassword}
                  </FieldError>
                </Field>
              </div>

              <div
                id="password-requirements"
                className="grid grid-cols-1 gap-x-5 gap-y-2 rounded-2xl border border-white/15 bg-white/[0.06] px-4 py-4 text-xs text-blue-100/75 sm:grid-cols-2"
              >
                {passwordRequirements.map((requirement) => (
                  <div
                    key={requirement.label}
                    className="flex items-center gap-2"
                  >
                    {requirement.met ? (
                      <Check
                        className="size-3.5 text-emerald-300"
                        aria-hidden="true"
                      />
                    ) : (
                      <Circle
                        className="size-3.5 text-blue-200/50"
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className={requirement.met ? "text-blue-50" : undefined}
                    >
                      {requirement.label}
                    </span>
                  </div>
                ))}
              </div>
            </FieldGroup>

            <FieldSet className="gap-1" disabled={isLoading}>
              <FieldLegend className="mb-0 text-sm font-medium text-blue-50">
                Choose your plan
              </FieldLegend>
              <FieldDescription className="!mt-0 text-xs text-blue-100/65">
                You can change plans later. Billing starts after your trial.
              </FieldDescription>
              <ToggleGroup
                type="single"
                value={planKey}
                onValueChange={(value) => {
                  if (isPlanKey(value)) setPlanKey(value)
                }}
                disabled={isLoading}
                aria-label="Subscription plan"
                className="mt-2 grid w-full grid-cols-1 gap-3 sm:grid-cols-3"
              >
                {subscriptionPlans.map((plan) => {
                  const isSelected = plan.key === planKey

                  return (
                    <ToggleGroupItem
                      key={plan.key}
                      value={plan.key}
                      aria-label={`Choose ${plan.name} plan for ${plan.monthlyPrice} per month`}
                      className="h-auto min-h-24 w-full cursor-pointer flex-col items-stretch justify-between gap-3 rounded-2xl border border-white/15 bg-white/[0.06] p-4 text-left text-white shadow-sm transition hover:border-white/30 hover:bg-white/10 hover:text-white data-[state=on]:border-blue-300 data-[state=on]:bg-white/15 data-[state=on]:text-white focus-visible:border-blue-300 focus-visible:ring-blue-300/40"
                    >
                      <span className="flex w-full items-center justify-between gap-2">
                        <span className="font-semibold">{plan.name}</span>
                        {isSelected ? (
                          <CheckCircle2
                            className="size-4 text-blue-200"
                            aria-hidden="true"
                          />
                        ) : null}
                      </span>
                      <span className="flex w-full items-end justify-between gap-2">
                        <span>
                          <span className="text-lg font-semibold">
                            {plan.monthlyPrice}
                          </span>
                          <span className="text-xs text-blue-100/60">/mo</span>
                        </span>
                        <span className="text-xs text-blue-100/70">
                          {plan.seatLimit} seats
                        </span>
                      </span>
                    </ToggleGroupItem>
                  )
                })}
              </ToggleGroup>
            </FieldSet>

            {error ? (
              <p
                role="alert"
                className="rounded-2xl border border-rose-200/40 bg-rose-50/10 px-4 py-3 text-sm text-rose-100"
              >
                {error}
              </p>
            ) : null}

            <div className="flex flex-col gap-4">
              <Button
                type="submit"
                disabled={isLoading}
                className={AUTH_PRIMARY_BUTTON_CLASS}
              >
                {isLoading ? (
                  <Loader2
                    data-icon="inline-start"
                    className="animate-spin"
                    aria-hidden="true"
                  />
                ) : null}
                {isLoading ? "Creating workspace" : "Create workspace"}
                {!isLoading ? (
                  <ArrowRight data-icon="inline-end" aria-hidden="true" />
                ) : null}
              </Button>

              <p className="text-center text-xs leading-5 text-blue-100/55">
                By creating a workspace, you agree to the Terms of Service and
                Privacy Policy.
              </p>
              <p className="text-center text-sm text-blue-100/70">
                Already have a workspace?{" "}
                <Link
                  className="font-semibold text-white underline-offset-4 hover:underline"
                  href="/login"
                >
                  Sign in
                </Link>
              </p>
            </div>
          </form>
        </section>
      </div>
    </main>
  )
}
