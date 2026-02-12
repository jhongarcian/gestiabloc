"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { isAxiosError } from "axios"

import { verifyEmail } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Box,
  CheckCircle,
  Loader2,
  ShieldCheck,
  UserCheck,
  XCircle,
} from "lucide-react"

type VerifyState = "idle" | "loading" | "success" | "error"

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

  const isLoading = state === "loading"
  const isSuccess = state === "success"
  const isError = state === "error"

  return (
    <div className="min-h-screen bg-white/50 backdrop-blur-sm text-slate-900 px-4 py-6 sm:px-6 sm:py-8 md:px-8 md:py-10 flex items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/5 to-purple-600/5" />
      <div
        id="verification-container"
        className="w-full max-w-[1440px] flex items-center justify-center relative z-10 px-4 sm:px-6"
      >
        <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl p-8 sm:p-10 lg:p-16 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-indigo-500/5 to-purple-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-gradient-to-tr from-blue-500/5 to-cyan-500/5 rounded-full blur-2xl translate-y-1/2 -translate-x-1/2" />

          <div className="relative z-10 text-center space-y-8">
            <div className="flex items-center justify-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center text-white shadow-glow">
                <Box className="h-5 w-5" />
              </div>
              <h1 className="font-bold text-2xl tracking-tight text-slate-900">
                Gestiabloc
              </h1>
            </div>

            <div className="flex justify-center">
              {isLoading ? (
                <div className="w-20 h-20 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : null}
              {isSuccess ? (
                <div className="w-20 h-20 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <CheckCircle className="h-10 w-10" />
                </div>
              ) : null}
              {isError ? (
                <div className="w-20 h-20 rounded-full bg-red-50 text-red-600 flex items-center justify-center">
                  <XCircle className="h-10 w-10" />
                </div>
              ) : null}
            </div>

            <div className="space-y-3">
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
                {isSuccess
                  ? "Email Verified Successfully!"
                  : isError
                    ? "Verification Failed"
                    : "Verifying Your Email"}
              </h2>
              <p className="text-base sm:text-lg text-slate-500 max-w-md mx-auto">
                {isLoading ? "Verifying your email..." : message}
              </p>
            </div>

            {isSuccess ? (
              <>
                <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100 rounded-2xl p-6">
                  <div className="flex items-start gap-4 text-left">
                    <div className="w-12 h-12 bg-indigo-500 rounded-xl flex items-center justify-center text-white flex-shrink-0">
                      <ShieldCheck className="h-6 w-6" />
                    </div>

                    <div className="flex-1">
                      <h3 className="font-bold text-slate-900 mb-1">
                        Your Account is Secure
                      </h3>
                      <p className="text-sm text-slate-600">
                        We&apos;ve verified your email address and your account
                        is now fully activated. You can start managing your
                        workspace with confidence.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-center">
                  <div className="bg-slate-50 rounded-xl p-6 border border-slate-200 max-w-xs w-full">
                    <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600 mx-auto mb-3">
                      <UserCheck className="h-6 w-6" />
                    </div>
                    <h4 className="text-base font-bold text-slate-900 mb-1">
                      Profile Active
                    </h4>
                    <p className="text-sm text-slate-500">
                      Your account is ready to use
                    </p>
                  </div>
                </div>
              </>
            ) : null}

            <div className="space-y-4 pt-2">
              {isSuccess ? (
                <Button
                  asChild
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-xl shadow-lg hover:shadow-indigo-500/30 transition-all duration-300 transform hover:-translate-y-0.5"
                >
                  <Link href="/login">Login Now</Link>
                </Button>
              ) : null}
              {isError ? (
                <Button
                  asChild
                  variant="outline"
                  className="w-full border-slate-200 text-slate-700 hover:bg-slate-50"
                >
                  <Link href="/login">Back to sign in</Link>
                </Button>
              ) : null}
            </div>
          </div>

          <div className="mt-10 text-center text-xs text-slate-400 relative z-10">
            © 2024 Gestiabloc Inc. All rights reserved.
          </div>
        </div>
      </div>
    </div>
  )
}

function VerifyEmailSkeleton() {
  return (
    <div className="min-h-screen bg-white/50 backdrop-blur-sm px-4 py-6 sm:px-6 sm:py-8 md:px-8 md:py-10 flex items-center justify-center">
      <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl p-8 sm:p-10 lg:p-16">
        <div className="space-y-8">
          <div className="flex items-center justify-center gap-3">
            <Skeleton className="h-10 w-10 rounded-xl" />
            <Skeleton className="h-8 w-40" />
          </div>
          <div className="flex justify-center">
            <Skeleton className="h-20 w-20 rounded-full" />
          </div>
          <div className="space-y-3 text-center">
            <Skeleton className="mx-auto h-10 w-80" />
            <Skeleton className="mx-auto h-6 w-72" />
          </div>
          <Skeleton className="h-36 w-full rounded-2xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      </div>
    </div>
  )
}
