"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { isAxiosError } from "axios"
import Link from "next/link"
import Image from "next/image"

import { login, verifyOtp } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { Label } from "@/components/ui/label"
import loginImage from "@/public/illustrations/login.png"
import { REGEXP_ONLY_DIGITS } from "input-otp"
import {
  ArrowLeft,
  ArrowRight,
  Box,
  Clock,
  Eye,
  EyeOff,
  Info,
  Lock,
  Mail,
  Shield,
  Star,
} from "lucide-react"

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
  const [otpExpiresAt, setOtpExpiresAt] = useState<number | null>(null)
  const [otpCountdown, setOtpCountdown] = useState(0)

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
        setOtpExpiresAt(Date.now() + 5 * 60 * 1000)
      } else {
        router.push("/")
      }
    } catch (err) {
      if (isAxiosError(err)) {
        const code = err.response?.data?.error
        if (code === "INVALID_CREDENTIALS") {
          setError("Invalid email or password.")
          setFieldErrors({})
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

  useEffect(() => {
    if (step !== "otp" || !otpExpiresAt) {
      setOtpCountdown(0)
      return
    }

    const tick = () => {
      const remaining = Math.max(0, Math.floor((otpExpiresAt - Date.now()) / 1000))
      setOtpCountdown(remaining)
    }

    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [step, otpExpiresAt])

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 md:h-screen md:overflow-hidden overflow-x-hidden">
      <div className="mx-auto flex w-full  items-stretch justify-center md:h-full">
        <div
          id="login-container"
          className="w-full  flex flex-col md:flex-row relative z-10 md:h-full md:min-h-0"
        >
          <div className="hidden md:flex md:w-1/2 bg-white/50 backdrop-blur-sm relative items-center justify-center p-12 lg:p-20 overflow-hidden md:sticky md:top-0 md:self-start md:h-full">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/5 to-purple-600/5" />

            <div className="relative z-20 max-w-lg">
              <div className="mb-12 flex justify-center">
                <div className="w-full max-w-md h-64 sm:h-72 lg:h-80 relative flex items-center justify-center">
                  <Image
                    src={loginImage}
                    alt="Login illustration"
                    fill
                    sizes="(min-width: 1024px) 420px, (min-width: 640px) 360px, 280px"
                    className="object-contain"
                    priority
                  />
                </div>
              </div>

              <div className="space-y-6 text-center">
                <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 leading-tight">
                  Manage your workspace with{" "}
                  <span className="text-indigo-600">confidence</span>
                </h2>
                <p className="text-slate-500 text-lg">
                  Streamline your workflow, track analytics, and collaborate
                  seamlessly with your team in one unified platform.
                </p>

                
              </div>
            </div>
          </div>

          <div className="w-full md:w-1/2 flex flex-col justify-start md:justify-center items-center p-4 sm:p-6 lg:p-8 bg-white shadow-2xl md:shadow-none md:h-full md:overflow-y-auto">
            <div className="max-w-2xl mx-auto px-0 sm:px-2 md:px-6 py-8 sm:py-10 lg:py-16 w-full">
              <div className="mb-10">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center text-white shadow-glow">
                    <Box className="h-5 w-5" />
                  </div>
                  <h1 className="font-bold text-2xl tracking-tight text-slate-900">
                    Gestiabloc
                  </h1>
                </div>

                <h2 className="text-3xl font-bold text-slate-900">
                  {step === "login" ? "Welcome back" : "Verify your login"}
                </h2>
                <p className="mt-2 text-slate-500">
                  {step === "login"
                    ? "Please enter your details to sign in."
                    : "Enter the 6-digit code we emailed you."}
                </p>
                {step === "login" ? (
                  <p className="mt-3 text-sm text-slate-500">
                    Don&apos;t have a workspace?{" "}
                    <Link
                      className="text-indigo-600 hover:underline"
                      href="/signup"
                    >
                      Create one
                    </Link>
                  </p>
                ) : null}
              </div>

              {step === "login" ? (
                <form className="space-y-6" onSubmit={onLogin}>
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-sm text-slate-700">
                      Email Address
                    </Label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        placeholder="name@company.com"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className={`w-full pl-10 pr-4 py-2.5 bg-white border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all shadow-sm ${
                          fieldErrors.email
                            ? "border-red-300 focus:ring-red-200/60 focus:border-red-400"
                            : "border-slate-200 focus:ring-indigo-500/20 focus:border-indigo-500"
                        }`}
                      />
                    </div>
                    {fieldErrors.email ? (
                      <p className="text-xs text-red-600">
                        {fieldErrors.email}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password" className="text-sm text-slate-700">
                        Password
                      </Label>
                      <Link
                        href="#"
                        className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
                      >
                        Forgot password?
                      </Link>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        id="password"
                        name="password"
                        type={showPassword ? "text" : "password"}
                        placeholder="••••••••"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className={`w-full pl-10 pr-10 py-2.5 bg-white border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all shadow-sm ${
                          fieldErrors.password
                            ? "border-red-300 focus:ring-red-200/60 focus:border-red-400"
                            : "border-slate-200 focus:ring-indigo-500/20 focus:border-indigo-500"
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
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
                    {fieldErrors.password ? (
                      <p className="text-xs text-red-600">
                        {fieldErrors.password}
                      </p>
                    ) : null}
                  </div>

                  {error ? (
                    <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {error}
                    </p>
                  ) : null}

                  <Button
                    className={`w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-xl shadow-lg hover:shadow-indigo-500/30 transition-all duration-300 transform hover:-translate-y-0.5 ${
                      isLoading ? "opacity-70 cursor-not-allowed" : ""
                    }`}
                    disabled={isLoading}
                    type="submit"
                  >
                    {isLoading ? "Signing in..." : "Sign in"}
                  </Button>
                </form>
              ) : (
                <form className="space-y-6" onSubmit={onVerifyOtp}>
                  <div className="space-y-4">
                    <Label className="text-sm font-medium text-slate-700 text-center md:text-left">
                      Enter OTP Code
                    </Label>
                    <InputOTP
                      maxLength={6}
                      pattern={REGEXP_ONLY_DIGITS}
                      value={otp}
                      onChange={(value) => setOtp(value.replace(/\D/g, ""))}
                      containerClassName="flex justify-center md:justify-start gap-3"
                      className={fieldErrors.otp ? "text-red-600" : undefined}
                    >
                      <InputOTPGroup>
                        {Array.from({ length: 3 }).map((_, index) => (
                          <InputOTPSlot
                            key={`otp-slot-${index}`}
                            index={index}
                            className={`h-12 w-12 rounded-xl border text-base ${
                              fieldErrors.otp
                                ? "border-red-300 aria-invalid:ring-red-200"
                                : "border-slate-200"
                            }`}
                          />
                        ))}
                      </InputOTPGroup>
                      <InputOTPSeparator />
                      <InputOTPGroup>
                        {Array.from({ length: 3 }).map((_, index) => (
                          <InputOTPSlot
                            key={`otp-slot-${index + 3}`}
                            index={index + 3}
                            className={`h-12 w-12 rounded-xl border text-base ${
                              fieldErrors.otp
                                ? "border-red-300 aria-invalid:ring-red-200"
                                : "border-slate-200"
                            }`}
                          />
                        ))}
                      </InputOTPGroup>
                    </InputOTP>
                    {fieldErrors.otp ? (
                      <p className="text-xs text-red-600 text-center md:text-left">
                        {fieldErrors.otp}
                      </p>
                    ) : null}

                    <div className="flex items-center justify-center md:justify-start gap-2 text-sm text-slate-500">
                      <Clock className="h-4 w-4 text-slate-400" />
                      <span>
                        Code expires in{" "}
                        <span className="font-semibold text-slate-700">
                          {`${Math.floor(otpCountdown / 60)
                            .toString()
                            .padStart(2, "0")}:${(otpCountdown % 60)
                            .toString()
                            .padStart(2, "0")}`}
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-4 flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 mt-0.5">
                      <Info className="h-3.5 w-3.5 text-indigo-600" />
                    </div>
                    <div className="text-sm text-slate-600">
                      <p className="font-medium text-slate-700">
                        Didn&apos;t receive the code?
                      </p>
                      <p className="text-slate-500 mt-1">
                        Check your spam folder or try signing in again.
                      </p>
                    </div>
                  </div>

                  {error ? (
                    <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {error}
                    </p>
                  ) : null}

                  <div className="space-y-3">
                    <Button
                      className={`w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-xl shadow-lg hover:shadow-indigo-500/30 transition-all duration-300 transform hover:-translate-y-0.5 ${
                        isLoading ? "opacity-70 cursor-not-allowed" : ""
                      }`}
                      disabled={isLoading}
                      type="submit"
                    >
                      <span>
                        {isLoading ? "Verifying..." : "Verify & Continue"}
                      </span>
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full border-slate-200 text-slate-700 hover:bg-slate-50"
                      onClick={() => {
                        setStep("login")
                        setOtp("")
                        setChallengeToken("")
                      }}
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Back to sign in
                    </Button>
                  </div>

                  <div className="pt-2 text-center">
                    <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-full text-xs font-medium text-green-700">
                      <Shield className="h-3.5 w-3.5" />
                      <span>Secure verification powered by Gestiabloc</span>
                    </div>
                  </div>
                </form>
              )}

              <p className="text-center text-xs text-slate-400 mt-10">
                © 2024 Gestiabloc Inc. All rights reserved.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
