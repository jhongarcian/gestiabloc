"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { isAxiosError } from "axios"
import Link from "next/link"

import { login, verifyOtp } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Step = "login" | "otp"

export default function LoginPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>("login")
  const [status, setStatus] = useState<"idle" | "loading">("idle")
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [challengeToken, setChallengeToken] = useState<string>("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [otp, setOtp] = useState("")
  const [showPassword, setShowPassword] = useState(false)

  const isLoading = status === "loading"

  const onLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus("loading")
    setError(null)
    setFieldErrors({})

    const clientErrors: Record<string, string> = {}
    if (!email.trim()) clientErrors.email = "Email is required."
    if (!password) clientErrors.password = "Password is required."
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors)
      setStatus("idle")
      return
    }

    try {
      const result = await login({ email: email.trim(), password })
      if (result.requiresOtp && result.challengeToken) {
        setChallengeToken(result.challengeToken)
        setStep("otp")
      } else {
        router.push("/")
      }
    } catch (err) {
      if (isAxiosError(err)) {
        const code = err.response?.data?.error
        if (code === "INVALID_CREDENTIALS") {
          setFieldErrors({
            email: "Invalid email or password.",
            password: "Invalid email or password.",
          })
        } else {
          setError("Something went wrong. Please try again.")
        }
      } else {
        setError("Something went wrong. Please try again.")
      }
    } finally {
      setStatus("idle")
    }
  }

  const onVerifyOtp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus("loading")
    setError(null)
    setFieldErrors({})

    if (!otp.trim()) {
      setFieldErrors({ otp: "Verification code is required." })
      setStatus("idle")
      return
    }

    try {
      await verifyOtp({ challengeToken, code: otp.trim() })
      router.push("/")
    } catch (err) {
      if (isAxiosError(err)) {
        const code = err.response?.data?.error
        switch (code) {
          case "INVALID_OTP":
            setFieldErrors({ otp: "Invalid verification code." })
            break
          case "OTP_EXPIRED":
            setError("Your code has expired. Please log in again.")
            setStep("login")
            break
          case "TOO_MANY_ATTEMPTS":
            setError("Too many attempts. Please log in again.")
            setStep("login")
            break
          case "INVALID_CHALLENGE":
          case "CHALLENGE_EXPIRED":
            setError("Session expired. Please log in again.")
            setStep("login")
            break
          default:
            setError("Something went wrong. Please try again.")
        }
      } else {
        setError("Something went wrong. Please try again.")
      }
    } finally {
      setStatus("idle")
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#f5f5f5,#e4e7eb_45%,#d7dbe1_100%)] px-6 py-16 text-zinc-900">
      <div className="mx-auto w-full max-w-2xl rounded-3xl border border-black/10 bg-white p-10 shadow-2xl">
        <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
          GestiaBloc
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">
          {step === "login" ? "Welcome back" : "Verify your login"}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          {step === "login" ? (
            <>
              Don&apos;t have a workspace?{" "}
              <Link className="font-medium text-zinc-900" href="/signup">
                Create one
              </Link>
            </>
          ) : (
            "Enter the 6-digit code we emailed you."
          )}
        </p>

        {step === "login" ? (
          <form className="mt-8 space-y-6" onSubmit={onLogin}>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={
                  fieldErrors.email
                    ? "border-red-300 focus-visible:ring-red-200"
                    : undefined
                }
              />
              {fieldErrors.email ? (
                <p className="text-xs text-red-600">{fieldErrors.email}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={
                    fieldErrors.password
                      ? "border-red-300 pr-10 focus-visible:ring-red-200"
                      : "pr-10"
                  }
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              {fieldErrors.password ? (
                <p className="text-xs text-red-600">{fieldErrors.password}</p>
              ) : null}
            </div>

            {error ? (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            ) : null}

            <Button className="w-full" disabled={isLoading} type="submit">
              {isLoading ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        ) : (
          <form className="mt-8 space-y-6" onSubmit={onVerifyOtp}>
            <div className="space-y-2">
              <Label htmlFor="otp">Verification code</Label>
              <Input
                id="otp"
                name="otp"
                type="text"
                inputMode="numeric"
                placeholder="123456"
                value={otp}
                onChange={(event) =>
                  setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                className={
                  fieldErrors.otp
                    ? "border-red-300 focus-visible:ring-red-200"
                    : undefined
                }
              />
              {fieldErrors.otp ? (
                <p className="text-xs text-red-600">{fieldErrors.otp}</p>
              ) : null}
            </div>

            {error ? (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            ) : null}

            <Button className="w-full" disabled={isLoading} type="submit">
              {isLoading ? "Verifying..." : "Verify and continue"}
            </Button>
            <button
              type="button"
              className="text-sm text-zinc-600 hover:text-zinc-900"
              onClick={() => {
                setStep("login")
                setOtp("")
                setChallengeToken("")
              }}
            >
              Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
