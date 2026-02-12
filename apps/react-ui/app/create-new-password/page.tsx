"use client"

import { Suspense, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams, useRouter } from "next/navigation"
import { isAxiosError } from "axios"

import { resetPassword } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ArrowLeft,
  Box,
  CheckCircle2,
  Circle,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
} from "lucide-react"

export default function CreateNewPassword() {
  return (
    <Suspense fallback={<CreateNewPasswordSkeleton />}>
      <CreateNewPasswordContent />
    </Suspense>
  )
}

function CreateNewPasswordSkeleton() {
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4 py-6 sm:px-6 sm:py-8">
      <div className="w-full max-w-xl rounded-3xl shadow-2xl p-6 sm:p-8 bg-white">
        <div className="w-full max-w-lg mx-auto space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-3">
              <Skeleton className="h-12 w-12 rounded-2xl" />
              <Skeleton className="h-8 w-36" />
            </div>
            <div className="flex justify-center">
              <Skeleton className="h-16 w-16 rounded-2xl" />
            </div>
            <div className="space-y-2 text-center">
              <Skeleton className="mx-auto h-8 w-64" />
              <Skeleton className="mx-auto h-4 w-72" />
            </div>
          </div>

          <div className="space-y-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-12 w-full rounded-2xl" />
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-12 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-2xl" />
          </div>
        </div>
      </div>
    </div>
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

  const checks = useMemo(() => {
    return {
      length: newPassword.length >= 8,
      letter: /[A-Za-z]/.test(newPassword),
      number: /[0-9]/.test(newPassword),
      symbol: /[^A-Za-z0-9]/.test(newPassword),
      match: newPassword.length > 0 && newPassword === confirmPassword,
    }
  }, [newPassword, confirmPassword])

  const isLoading = status === "loading"
  const canSubmit =
    token &&
    checks.length &&
    checks.letter &&
    checks.number &&
    checks.symbol &&
    checks.match

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
      setStatus("success")
      router.push("/login")
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
    <div className="min-h-screen bg-slate-100 text-slate-900 flex items-center justify-center px-4 py-6 sm:px-6 sm:py-8">
      <div className="w-full max-w-xl gradient-border rounded-3xl shadow-2xl p-6 sm:p-8 flex flex-col justify-center bg-white">
        <div className="w-full max-w-lg mx-auto space-y-6 animate-slide-up">
          <div className="text-center">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="w-12 h-12 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-2xl flex items-center justify-center text-white shadow-lg">
                <Box className="h-5 w-5" />
              </div>
              <h1 className="font-bold text-2xl tracking-tight text-slate-900">
                Gestiabloc
              </h1>
            </div>

            <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl mb-4 shadow-glow">
              <KeyRound className="h-7 w-7 text-white" />
            </div>

            <h2 className="text-3xl font-bold text-slate-900 mb-2">
              Create New Password
            </h2>
            <p className="text-slate-500 text-sm sm:text-base">
              Set a strong password to secure your account
            </p>
          </div>

          <form id="resetPasswordForm" className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label
                  htmlFor="new-password"
                  className="text-sm font-semibold text-slate-700 flex items-center gap-2"
                >
                  <Lock className="h-4 w-4 text-indigo-600" />
                  New Password
                </Label>

                <div className="relative group">
                  <Input
                    type={showNewPassword ? "text" : "password"}
                    id="new-password"
                    className="block w-full px-4 py-3 bg-slate-50 border-2 border-slate-200 rounded-2xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm sm:text-base group-hover:border-slate-300"
                    placeholder="Enter new password"
                    required
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                    onClick={() => setShowNewPassword((prev) => !prev)}
                    aria-label={
                      showNewPassword ? "Hide password" : "Show password"
                    }
                  >
                    {showNewPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="confirm-password"
                  className="text-sm font-semibold text-slate-700 flex items-center gap-2"
                >
                  <Lock className="h-4 w-4 text-indigo-600" />
                  Confirm Password
                </Label>

                <div className="relative group">
                  <Input
                    type={showConfirmPassword ? "text" : "password"}
                    id="confirm-password"
                    className="block w-full px-4 py-3 bg-slate-50 border-2 border-slate-200 rounded-2xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm sm:text-base group-hover:border-slate-300"
                    placeholder="Re-enter password"
                    required
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                    aria-label={
                      showConfirmPassword
                        ? "Hide password"
                        : "Show password"
                    }
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div id="password-strength" className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-slate-600">
                  Password Strength:
                </span>
                <span className="text-xs font-bold text-slate-400">
                  {checks.length && checks.letter && checks.number && checks.symbol
                    ? "Strong"
                    : checks.length
                      ? "Medium"
                      : "Not Set"}
                </span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-slate-300 rounded-full transition-all duration-300"
                  style={{
                    width: `${
                      (Number(checks.length) +
                        Number(checks.letter) +
                        Number(checks.number) +
                        Number(checks.symbol)) *
                      25
                    }%`,
                  }}
                />
              </div>
            </div>

            <div className="bg-indigo-50/70 rounded-xl p-4 border border-indigo-100">
              <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
                Password Requirements
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-600">
                <div
                  className={`validation-item flex items-center gap-2 ${
                    checks.length ? "text-emerald-600" : ""
                  }`}
                >
                  <Circle className="h-2.5 w-2.5" />
                  <span>At least 8 characters</span>
                </div>

                <div
                  className={`validation-item flex items-center gap-2 ${
                    checks.letter ? "text-emerald-600" : ""
                  }`}
                >
                  <Circle className="h-2.5 w-2.5" />
                  <span>At least 1 letter</span>
                </div>

                <div
                  className={`validation-item flex items-center gap-2 ${
                    checks.number ? "text-emerald-600" : ""
                  }`}
                >
                  <Circle className="h-2.5 w-2.5" />
                  <span>At least 1 number</span>
                </div>

                <div
                  className={`validation-item flex items-center gap-2 ${
                    checks.symbol ? "text-emerald-600" : ""
                  }`}
                >
                  <Circle className="h-2.5 w-2.5" />
                  <span>At least 1 symbol</span>
                </div>

                <div
                  className={`validation-item flex items-center gap-2 col-span-1 sm:col-span-2 ${
                    checks.match ? "text-emerald-600" : ""
                  }`}
                >
                  <Circle className="h-2.5 w-2.5" />
                  <span>Passwords match</span>
                </div>
              </div>
            </div>

            <Button
              type="submit"
              disabled={!canSubmit || isLoading}
              className={`w-full flex justify-center items-center gap-2 py-3.5 px-5 border-2 border-transparent rounded-2xl text-sm sm:text-base font-bold text-white bg-slate-900 transition-all duration-300 shadow-lg disabled:bg-slate-300 disabled:cursor-not-allowed ${
                isLoading ? "opacity-70" : ""
              }`}
            >
              <CheckCircle2 className="h-4 w-4" />
              {isLoading ? "Resetting..." : "Reset Password"}
            </Button>

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
        </div>
      </div>
    </div>
  )
}
