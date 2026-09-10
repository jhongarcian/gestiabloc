"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { isAxiosError } from "axios"
import {
  ArrowLeft,
  ArrowRight,
  Box,
  CheckCircle2,
  Loader2,
  Mail,
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
import { forgotPassword } from "@/lib/api"

const AUTH_PRIMARY_BUTTON_CLASS =
  "h-11 w-full cursor-pointer rounded-full bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm ring-1 ring-white/15 transition hover:bg-blue-500 hover:text-white disabled:cursor-not-allowed disabled:bg-blue-900 disabled:text-blue-300"

const AUTH_SECONDARY_BUTTON_CLASS =
  "h-11 w-full cursor-pointer rounded-full border-white/25 bg-white/10 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-white/15 hover:text-white"

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[100svh] items-center justify-center bg-blue-950 text-sm text-blue-100/70">
          Loading password reset…
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  )
}

function ResetPasswordContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<"idle" | "loading" | "success">("idle")
  const [error, setError] = useState<string | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)

  const isLoading = status === "loading"

  useEffect(() => {
    const token = searchParams.get("token")
    if (token) {
      router.replace(`/create-new-password?token=${encodeURIComponent(token)}`)
    }
  }, [router, searchParams])

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setEmailError(null)
    setStatus("loading")

    if (!email.trim()) {
      setEmailError("Email is required.")
      setStatus("idle")
      return
    }

    try {
      await forgotPassword(email.trim())
      setStatus("success")
    } catch (err) {
      if (isAxiosError(err)) {
        setError("Something went wrong. Please try again.")
      } else {
        setError("Something went wrong. Please try again.")
      }
      setStatus("idle")
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

            <h1 className="mt-8 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Reset your password
            </h1>
            <p className="mt-2 text-sm leading-6 text-blue-100/75">
              Enter your email and we&apos;ll send you a secure reset link.
            </p>
          </header>

          <form
            id="forgot-password-form"
            className="flex flex-col gap-5"
            onSubmit={onSubmit}
          >
            <FieldGroup className="gap-5">
              <Field
                data-invalid={Boolean(emailError)}
                data-disabled={isLoading}
                className="gap-2"
              >
                <FieldLabel
                  htmlFor="email"
                  className="text-sm font-medium text-blue-50"
                >
                  Email address
                </FieldLabel>
                <div className="relative">
                  <Mail
                    className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <Input
                    type="email"
                    id="email"
                    name="email"
                    autoComplete="email"
                    className="h-11 rounded-full border-white bg-white pl-11 pr-4 text-sm text-slate-950 shadow-sm focus-visible:border-blue-300 focus-visible:ring-blue-300/40 aria-invalid:border-rose-300 aria-invalid:ring-rose-200/30 disabled:bg-blue-50 disabled:opacity-80"
                    placeholder="name@company.com"
                    required
                    disabled={isLoading}
                    aria-invalid={Boolean(emailError)}
                    aria-describedby={emailError ? "email-error" : undefined}
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value)
                      if (emailError) setEmailError(null)
                    }}
                  />
                </div>
                <FieldError id="email-error" className="text-xs text-rose-200">
                  {emailError}
                </FieldError>
              </Field>
            </FieldGroup>

            {status === "success" ? (
              <div
                role="status"
                aria-live="polite"
                className="flex w-full flex-col items-center rounded-2xl border border-white/15 bg-white/[0.06] px-5 py-4 text-center shadow-sm backdrop-blur-sm"
              >
                <span className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/10">
                  <CheckCircle2
                    className="size-4 text-emerald-300"
                    aria-hidden="true"
                  />
                </span>
                <p className="mt-3 text-sm font-semibold text-white">
                  Check your inbox
                </p>
                <p className="mt-1 text-xs leading-5 text-blue-100/70">
                  If an account exists for that email, we sent a password reset
                  link.
                </p>
              </div>
            ) : null}

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
              {isLoading
                ? "Sending reset link"
                : status === "success"
                  ? "Send another link"
                  : "Send reset link"}
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
        </section>
      </div>
    </main>
  )
}
