"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { isAxiosError } from "axios"

import { verifyEmail } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ArrowLeft,
  ArrowRight,
  Box,
  CheckCircle2,
  Loader2,
  XCircle,
} from "lucide-react"

type VerifyState = "idle" | "loading" | "success" | "error"

const AUTH_PRIMARY_BUTTON_CLASS =
  "h-11 w-full cursor-pointer rounded-full bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm ring-1 ring-white/15 transition hover:bg-blue-500 hover:text-white"

const AUTH_SECONDARY_BUTTON_CLASS =
  "h-11 w-full cursor-pointer rounded-full border-white/25 bg-white/10 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-white/15 hover:text-white"

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<VerifyEmailSkeleton />}>
      <VerifyEmailContent />
    </Suspense>
  )
}

function VerifyEmailContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get("token") || ""
  const [state, setState] = useState<VerifyState>("idle")
  const [message, setMessage] = useState<string>("")

  useEffect(() => {
    let isMounted = true
    const run = async () => {
      if (!token) {
        setState("error")
        setMessage("Verification link is missing or invalid.")
        return
      }
      setState("loading")
      try {
        await verifyEmail(token)
        if (!isMounted) return
        setState("success")
        setMessage("Email verified. Your workspace is active.")
      } catch (err) {
        if (!isMounted) return
        setState("error")
        if (isAxiosError(err)) {
          const code = err.response?.data?.error
          switch (code) {
            case "TOKEN_EXPIRED":
              setMessage("This verification link has expired.")
              return
            case "TOKEN_USED":
              setMessage("This verification link was already used.")
              return
            case "TOKEN_NOT_FOUND":
            case "INVALID_TOKEN":
              setMessage("Verification link is invalid.")
              return
            default:
              setMessage("Something went wrong. Please try again.")
              return
          }
        }
        setMessage("Something went wrong. Please try again.")
      }
    }
    void run()
    return () => {
      isMounted = false
    }
  }, [token])

  const isLoading = state === "idle" || state === "loading"
  const isSuccess = state === "success"
  const isError = state === "error"

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

      <div className="relative z-10 flex min-h-[100svh] w-full items-center justify-center px-4 py-5 sm:px-8 sm:py-10">
        <section
          id="verification-container"
          className="w-full max-w-[460px] py-6 text-center sm:py-10"
          aria-busy={isLoading}
        >
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

          <div
            role={isError ? "alert" : "status"}
            aria-live={isError ? "assertive" : "polite"}
            aria-atomic="true"
            className="mt-10 flex flex-col items-center"
          >
            <span className="flex size-12 items-center justify-center rounded-full border border-white/10 bg-white/10">
              {isLoading ? (
                <Loader2
                  className="size-6 animate-spin text-blue-200 motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : null}
              {isSuccess ? (
                <CheckCircle2
                  className="size-6 text-emerald-300"
                  aria-hidden="true"
                />
              ) : null}
              {isError ? (
                <XCircle
                  className="size-6 text-rose-300"
                  aria-hidden="true"
                />
              ) : null}
            </span>

            <h1 className="mt-5 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              {isSuccess
                ? "Email verified"
                : isError
                  ? "We couldn’t verify your email"
                  : "Verifying your email"}
            </h1>
            <p className="mt-2 max-w-sm text-sm leading-6 text-blue-100/75">
              {isLoading
                ? "Please wait while we securely activate your workspace."
                : message}
            </p>
          </div>

          {isSuccess ? (
            <Button asChild className={`${AUTH_PRIMARY_BUTTON_CLASS} mt-8`}>
              <Link href="/login">
                Continue to sign in
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </Link>
            </Button>
          ) : null}

          {isError ? (
            <Button
              asChild
              variant="outline"
              className={`${AUTH_SECONDARY_BUTTON_CLASS} mt-8`}
            >
              <Link href="/login">
                <ArrowLeft data-icon="inline-start" aria-hidden="true" />
                Back to sign in
              </Link>
            </Button>
          ) : null}

          {isLoading ? (
            <p className="mt-5 text-xs leading-5 text-blue-100/60">
              Keep this page open until verification is complete.
            </p>
          ) : null}
        </section>
      </div>
    </main>
  )
}

function VerifyEmailSkeleton() {
  return (
    <main className="relative min-h-[100svh] overflow-hidden bg-blue-950">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:44px_44px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 left-1/2 size-[32rem] -translate-x-1/2 rounded-full bg-blue-500/25 blur-3xl"
      />

      <div className="relative z-10 flex min-h-[100svh] items-center justify-center px-4 py-5 sm:px-8 sm:py-10">
        <div className="flex w-full max-w-[460px] flex-col items-center py-6 sm:py-10">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-2xl bg-white/10" />
            <Skeleton className="h-6 w-28 bg-white/10" />
          </div>
          <Skeleton className="mt-10 size-12 rounded-full bg-white/10" />
          <div className="mt-5 flex w-full flex-col items-center gap-3">
            <Skeleton className="h-8 w-64 max-w-full bg-white/10" />
            <Skeleton className="h-4 w-80 max-w-full bg-white/10" />
            <Skeleton className="h-4 w-60 max-w-full bg-white/10" />
          </div>
        </div>
      </div>
    </main>
  )
}
