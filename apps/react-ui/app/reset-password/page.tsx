"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { isAxiosError } from "axios"

import { forgotPassword } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ArrowLeft,
  Box,
  CheckCircle2,
  KeyRound,
  Lightbulb,
  Mail,
  Send,
} from "lucide-react"

export default function ResetPasswordPanel() {
  return (
    <Suspense fallback={<ResetPasswordSkeleton />}>
      <ResetPasswordPanelContent />
    </Suspense>
  )
}

function ResetPasswordPanelContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<"idle" | "loading" | "success">("idle")
  const [error, setError] = useState<string | null>(null)

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
    setStatus("loading")

    if (!email.trim()) {
      setError("Email is required.")
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
    <div className="min-h-screen bg-slate-100 text-slate-900 flex items-center justify-center px-4 py-6 sm:px-6 sm:py-8">
      <div className="w-full max-w-xl gradient-border rounded-3xl shadow-2xl p-6 sm:p-8 flex flex-col justify-center bg-white">
        <div className="w-full max-w-lg mx-auto space-y-6 animate-slide-up">
        <div className="text-center">
          <div className="flex flex-col items-center justify-center gap-3 mb-4">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-2xl flex items-center justify-center text-white shadow-lg">
              <Box className="h-5 w-5" />
            </div>
            <h1 className="font-bold text-2xl tracking-tight text-slate-900">
              Gestiabloc
            </h1>
          </div>

          <h2 className="text-3xl font-bold text-slate-900 mb-2">
            Reset Your Password
          </h2>
          <p className="text-slate-500 text-sm sm:text-base">
            Enter your email and we&apos;ll send you instructions to reset your
            password
          </p>
        </div>

        <form
          id="forgot-password-form"
          className="space-y-4"
          onSubmit={onSubmit}
        >
          <div className="space-y-2">
            <Label
              htmlFor="email"
              className="text-sm font-semibold text-slate-700 flex items-center gap-2"
            >
              <Mail className="h-4 w-4 text-indigo-600" />
              Email Address
            </Label>

            <div className="relative group">
              <Input
                type="email"
                id="email"
                className="block w-full px-4 py-3 bg-slate-50 border-2 border-slate-200 rounded-2xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm sm:text-base group-hover:border-slate-300"
                placeholder="your.email@example.com"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none text-slate-300 group-focus-within:text-indigo-500 transition-colors">
                <CheckCircle2 className="h-5 w-5" />
              </div>
            </div>
          </div>

          <Button
            type="submit"
            disabled={isLoading}
            className="w-full flex justify-center items-center gap-2 py-3.5 px-5 border-2 border-transparent rounded-2xl text-sm sm:text-base font-bold text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 focus:outline-none focus:ring-4 focus:ring-indigo-500/30 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
          >
            <Send className="h-4 w-4" />
            {isLoading ? "Sending..." : "Send Reset Instructions"}
          </Button>

          {status === "success" ? (
            <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              If an account exists for that email, we&apos;ve sent a reset link.
            </p>
          ) : null}

          {error ? (
            <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <div className="relative flex items-center justify-center gap-3">
            <div className="h-px bg-slate-200 flex-1" />
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Or
            </span>
            <div className="h-px bg-slate-200 flex-1" />
          </div>

          <Link
            href="/login"
            className="flex items-center justify-center gap-2 py-3.5 text-sm font-semibold text-slate-700 hover:text-indigo-600 transition-colors group"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
            Return to Sign In
          </Link>
        </form>

        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl p-5 space-y-3 border border-indigo-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm">
              <Lightbulb className="h-5 w-5 text-indigo-600" />
            </div>
            <h3 className="text-base font-bold text-slate-800">
              What happens next?
            </h3>
          </div>

          <div className="space-y-2 pl-13">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-indigo-600 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                1
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Check your email inbox for our message
              </p>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-indigo-600 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                2
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Click the secure reset link (valid for 1 hour)
              </p>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-indigo-600 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                3
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Create your new password and sign in
              </p>
            </div>
          </div>
        </div>

        <div className="text-center pt-2">
          <p className="text-sm text-slate-500">
            Need assistance?
            <a
              href="#"
              className="font-bold text-indigo-600 hover:text-indigo-700 hover:underline transition-all ml-1"
            >
              Contact Support Team
            </a>
          </p>
        </div>
        </div>
      </div>
    </div>
  )
}

function ResetPasswordSkeleton() {
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4 py-6 sm:px-6 sm:py-8">
      <div className="w-full max-w-xl rounded-3xl shadow-2xl p-6 sm:p-8 bg-white">
        <div className="w-full max-w-lg mx-auto space-y-6">
          <div className="space-y-4">
            <div className="flex flex-col items-center justify-center gap-3">
              <Skeleton className="h-12 w-12 rounded-2xl" />
              <Skeleton className="h-8 w-36" />
            </div>
            <div className="space-y-2 text-center">
              <Skeleton className="mx-auto h-8 w-64" />
              <Skeleton className="mx-auto h-4 w-72" />
            </div>
          </div>
          <div className="space-y-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-12 w-full rounded-2xl" />
            <Skeleton className="h-12 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </div>
        </div>
      </div>
    </div>
  )
}
