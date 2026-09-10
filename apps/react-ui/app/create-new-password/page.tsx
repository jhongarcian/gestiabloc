"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { isAxiosError } from "axios"
import {
  ArrowLeft,
  ArrowRight,
  Box,
  Check,
  CheckCircle2,
  Circle,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  TriangleAlert,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { resetPassword } from "@/lib/api"
import { cn } from "@/lib/utils"

const AUTH_INPUT_CLASS =
  "h-11 rounded-full border-white bg-white px-4 text-sm text-slate-950 shadow-sm focus-visible:border-blue-300 focus-visible:ring-blue-300/40 aria-invalid:border-rose-300 aria-invalid:ring-rose-200/30 disabled:bg-blue-50 disabled:opacity-80"

const AUTH_PRIMARY_BUTTON_CLASS =
  "h-11 w-full cursor-pointer rounded-full bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm ring-1 ring-white/15 transition hover:bg-blue-500 hover:text-white disabled:cursor-not-allowed disabled:bg-blue-900 disabled:text-blue-300"

const AUTH_SECONDARY_BUTTON_CLASS =
  "h-11 w-full cursor-pointer rounded-full border-white/25 bg-white/10 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-white/15 hover:text-white"

export default function CreateNewPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[100svh] items-center justify-center bg-blue-950 text-sm text-blue-100/70">
          Loading password reset…
        </div>
      }
    >
      <CreateNewPasswordContent />
    </Suspense>
  )
}

function CreateNewPasswordContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get("token") || ""
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [status, setStatus] = useState<"idle" | "loading" | "success">("idle")
  const [error, setError] = useState<string | null>(null)

  const checks = useMemo(
    () => ({
      length: newPassword.length >= 8,
      letter: /[A-Za-z]/.test(newPassword),
      number: /[0-9]/.test(newPassword),
      symbol: /[^A-Za-z0-9]/.test(newPassword),
      match: newPassword.length > 0 && newPassword === confirmPassword,
    }),
    [newPassword, confirmPassword],
  )

  const passwordRequirements = [
    { label: "8 or more characters", met: checks.length },
    { label: "At least one letter", met: checks.letter },
    { label: "At least one number", met: checks.number },
    { label: "At least one symbol", met: checks.symbol },
    { label: "Passwords match", met: checks.match },
  ]
  const passwordIsStrong =
    checks.length && checks.letter && checks.number && checks.symbol
  const confirmIsInvalid = confirmPassword.length > 0 && !checks.match
  const isLoading = status === "loading"
  const canSubmit = Boolean(token && passwordIsStrong && checks.match)

  useEffect(() => {
    if (status !== "success") return

    window.history.replaceState(
      window.history.state,
      "",
      "/create-new-password",
    )
  }, [status])

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    if (!token) {
      setError("Reset link is missing or invalid.")
      return
    }
    if (!canSubmit) {
      setError("Please meet all password requirements.")
      return
    }

    setStatus("loading")
    try {
      await resetPassword({ token, newPassword })
      setNewPassword("")
      setConfirmPassword("")
      setShowNewPassword(false)
      setShowConfirmPassword(false)
      setStatus("success")
    } catch (err) {
      setStatus("idle")
      if (isAxiosError(err)) {
        const code = err.response?.data?.error
        switch (code) {
          case "TOKEN_EXPIRED":
            setError("This reset link has expired.")
            return
          case "TOKEN_USED":
            setError("This reset link was already used.")
            return
          case "TOKEN_NOT_FOUND":
          case "INVALID_TOKEN":
            setError("Reset link is invalid.")
            return
          default:
            setError("Something went wrong. Please try again.")
            return
        }
      }
      setError("Something went wrong. Please try again.")
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

      <div className="relative z-10 flex min-h-[100svh] w-full items-start justify-center px-4 py-5 sm:items-center sm:px-8 sm:py-10">
        <section className="w-full max-w-[460px] py-6 sm:py-10">
          <header className="mb-8 text-center">
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

            {status !== "success" ? (
              <>
                <h1 className="mt-8 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                  Create a new password
                </h1>
                <p className="mt-2 text-sm leading-6 text-blue-100/75">
                  Choose a strong password to protect your account.
                </p>
              </>
            ) : null}
          </header>

          {status === "success" ? (
            <div className="flex flex-col gap-5">
              <div
                role="status"
                aria-live="polite"
                className="flex w-full flex-col items-center px-2 py-2 text-center"
              >
                <span className="flex size-11 items-center justify-center rounded-full border border-white/10 bg-white/10">
                  <CheckCircle2
                    className="size-5 text-emerald-300"
                    aria-hidden="true"
                  />
                </span>
                <h1 className="mt-4 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                  Password changed successfully
                </h1>
                <p className="mt-2 text-sm leading-6 text-blue-100/75">
                  Your new password is ready. Sign in to continue.
                </p>
              </div>

              <Button
                type="button"
                className={AUTH_PRIMARY_BUTTON_CLASS}
                onClick={() => router.replace("/login")}
              >
                Continue to sign in
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </Button>
            </div>
          ) : !token ? (
            <div className="flex flex-col gap-5">
              <div
                role="alert"
                className="flex w-full flex-col items-center rounded-2xl border border-white/15 bg-white/[0.06] px-5 py-4 text-center shadow-sm backdrop-blur-sm"
              >
                <span className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/10">
                  <TriangleAlert
                    className="size-4 text-amber-300"
                    aria-hidden="true"
                  />
                </span>
                <p className="mt-3 text-sm font-semibold text-white">
                  This reset link is invalid
                </p>
                <p className="mt-1 text-xs leading-5 text-blue-100/70">
                  Request a new link to continue resetting your password.
                </p>
              </div>

              <Button asChild className={AUTH_PRIMARY_BUTTON_CLASS}>
                <Link href="/reset-password">
                  Request a new link
                  <ArrowRight data-icon="inline-end" aria-hidden="true" />
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className={AUTH_SECONDARY_BUTTON_CLASS}
              >
                <Link href="/login">
                  <ArrowLeft data-icon="inline-start" aria-hidden="true" />
                  Back to sign in
                </Link>
              </Button>
            </div>
          ) : (
            <form
              id="reset-password-form"
              className="flex flex-col gap-5"
              onSubmit={onSubmit}
            >
              <FieldGroup className="gap-5">
                <Field data-disabled={isLoading} className="gap-2">
                  <FieldLabel
                    htmlFor="new-password"
                    className="text-sm font-medium text-blue-50"
                  >
                    New password
                  </FieldLabel>
                  <div className="relative">
                    <Lock
                      className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <Input
                      type={showNewPassword ? "text" : "password"}
                      id="new-password"
                      name="newPassword"
                      autoComplete="new-password"
                      className={cn(AUTH_INPUT_CLASS, "pl-11 pr-11")}
                      placeholder="Create a new password"
                      required
                      disabled={isLoading}
                      aria-describedby="password-requirements"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                    />
                    <button
                      type="button"
                      disabled={isLoading}
                      className="absolute right-2 top-1/2 flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-slate-400 transition hover:bg-blue-50 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => setShowNewPassword((prev) => !prev)}
                      aria-label={
                        showNewPassword ? "Hide password" : "Show password"
                      }
                    >
                      {showNewPassword ? (
                        <EyeOff className="size-4" aria-hidden="true" />
                      ) : (
                        <Eye className="size-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </Field>

                <Field
                  data-invalid={confirmIsInvalid}
                  data-disabled={isLoading}
                  className="gap-2"
                >
                  <FieldLabel
                    htmlFor="confirm-password"
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
                      id="confirm-password"
                      name="confirmPassword"
                      autoComplete="new-password"
                      className={cn(AUTH_INPUT_CLASS, "pl-11 pr-11")}
                      placeholder="Repeat your new password"
                      required
                      disabled={isLoading}
                      aria-invalid={confirmIsInvalid}
                      aria-describedby={
                        confirmIsInvalid
                          ? "confirm-password-error password-requirements"
                          : "password-requirements"
                      }
                      value={confirmPassword}
                      onChange={(event) =>
                        setConfirmPassword(event.target.value)
                      }
                    />
                    <button
                      type="button"
                      disabled={isLoading}
                      className="absolute right-2 top-1/2 flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-slate-400 transition hover:bg-blue-50 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => setShowConfirmPassword((prev) => !prev)}
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
                    {confirmIsInvalid ? "Passwords do not match." : null}
                  </FieldError>
                </Field>
              </FieldGroup>

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

              {error ? (
                <div
                  role="alert"
                  className="flex w-full flex-col items-center rounded-2xl border border-white/15 bg-white/[0.06] px-5 py-4 text-center shadow-sm backdrop-blur-sm"
                >
                  <span className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/10">
                    <TriangleAlert
                      className="size-4 text-rose-300"
                      aria-hidden="true"
                    />
                  </span>
                  <p className="mt-3 text-sm text-rose-100">{error}</p>
                </div>
              ) : null}

              <Button
                type="submit"
                disabled={!canSubmit || isLoading}
                className={AUTH_PRIMARY_BUTTON_CLASS}
              >
                {isLoading ? (
                  <Loader2
                    data-icon="inline-start"
                    className="animate-spin"
                    aria-hidden="true"
                  />
                ) : null}
                {isLoading ? "Updating password" : "Update password"}
                {!isLoading ? (
                  <ArrowRight data-icon="inline-end" aria-hidden="true" />
                ) : null}
              </Button>

              <Button
                asChild
                variant="outline"
                className={AUTH_SECONDARY_BUTTON_CLASS}
              >
                <Link href="/login">
                  <ArrowLeft data-icon="inline-start" aria-hidden="true" />
                  Back to sign in
                </Link>
              </Button>
            </form>
          )}
        </section>
      </div>
    </main>
  )
}
