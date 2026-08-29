"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { isAxiosError } from "axios"
import Link from "next/link"
import Image from "next/image"

import { getMe, login, sendOtp, verifyOtp } from "@/lib/api"
import { getTenantEntryPath } from "@/lib/onboarding"
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
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Info,
  Loader2,
  Lock,
  Mail,
  RotateCw,
  Shield,
  TriangleAlert,
} from "lucide-react"

type Step = "login" | "otp"
type RequestStatus = "idle" | "loading"
type DeliveryStatus = "idle" | "sending" | "sent" | "unconfirmed" | "failed"

function formatCountdown(seconds: number) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`
}

function maskEmail(value: string) {
  const [localPart, domain] = value.trim().split("@")
  if (!localPart || !domain) return value
  const visible = localPart.slice(0, Math.min(2, localPart.length))
  return `${visible}${"•".repeat(Math.max(3, localPart.length - visible.length))}@${domain}`
}

export default function LoginPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>("login")
  const [loginStatus, setLoginStatus] = useState<RequestStatus>("idle")
  const [verifyStatus, setVerifyStatus] = useState<RequestStatus>("idle")
  const [deliveryStatus, setDeliveryStatus] =
    useState<DeliveryStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [challengeToken, setChallengeToken] = useState<string>("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [otp, setOtp] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [otpExpiresAt, setOtpExpiresAt] = useState<number | null>(null)
  const [otpCountdown, setOtpCountdown] = useState(0)
  const [resendAvailableAt, setResendAvailableAt] = useState<number | null>(null)
  const [resendCountdown, setResendCountdown] = useState(0)
  const [sendsRemaining, setSendsRemaining] = useState(3)
  const deliveryRequestId = useRef(0)

  const isLoginLoading = loginStatus === "loading"
  const isVerifying = verifyStatus === "loading"
  const isSending = deliveryStatus === "sending"
  const canEnterCode =
    (deliveryStatus === "sent" || deliveryStatus === "unconfirmed") &&
    otpCountdown > 0
  const canResend =
    !isSending && sendsRemaining > 0 && resendCountdown === 0
  const maskedEmail = maskEmail(email)

  const applyDeliveryTiming = (input: {
    expiresAt: string | number
    resendAvailableAt: string | number
    sendsRemaining: number
  }) => {
    const expiresAt = new Date(input.expiresAt).getTime()
    const resendAt = new Date(input.resendAvailableAt).getTime()
    setOtpExpiresAt(expiresAt)
    setResendAvailableAt(resendAt)
    setOtpCountdown(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)))
    setResendCountdown(
      Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)),
    )
    setSendsRemaining(input.sendsRemaining)
  }

  const returnToLogin = (message?: string) => {
    deliveryRequestId.current += 1
    setStep("login")
    setChallengeToken("")
    setOtp("")
    setOtpExpiresAt(null)
    setResendAvailableAt(null)
    setOtpCountdown(0)
    setResendCountdown(0)
    setSendsRemaining(3)
    setDeliveryStatus("idle")
    setVerifyStatus("idle")
    setFieldErrors({})
    setError(message ?? null)
  }

  const requestOtpDelivery = async (token: string) => {
    const requestId = ++deliveryRequestId.current
    setDeliveryStatus("sending")
    setError(null)
    setFieldErrors({})

    try {
      const result = await sendOtp(token)
      if (requestId !== deliveryRequestId.current) return
      applyDeliveryTiming(result)
      setDeliveryStatus(
        result.deliveryStatus === "SENT" ? "sent" : "unconfirmed",
      )
    } catch (err) {
      if (requestId !== deliveryRequestId.current) return
      if (isAxiosError(err)) {
        const code = err.response?.data?.error
        const retryAfterSeconds = Number(
          err.response?.data?.retryAfterSeconds ?? 30,
        )
        const remaining = Number(err.response?.data?.sendsRemaining)

        if (Number.isFinite(remaining)) setSendsRemaining(remaining)
        if (retryAfterSeconds > 0) {
          const resendAt = Date.now() + retryAfterSeconds * 1000
          setResendAvailableAt(resendAt)
          setResendCountdown(retryAfterSeconds)
        }

        switch (code) {
          case "INVALID_CHALLENGE":
          case "CHALLENGE_EXPIRED":
            returnToLogin(
              "Your secure login session expired. Please sign in again.",
            )
            return
          case "OTP_SEND_LIMIT":
            setSendsRemaining(0)
            setDeliveryStatus("failed")
            setError(
              "You have used all code delivery attempts. Please sign in again.",
            )
            return
          case "OTP_RESEND_TOO_SOON":
            setDeliveryStatus(canEnterCode ? deliveryStatus : "failed")
            setError(`Please wait ${retryAfterSeconds} seconds before resending.`)
            return
          case "OTP_DELIVERY_FAILED":
            setDeliveryStatus("failed")
            setError(
              "We couldn't send the code. Please wait a moment and try again.",
            )
            return
        }

        if (err.code === "ECONNABORTED") {
          // Be conservative because the server timer began before this client timeout.
          const expiresAt = Date.now() + 4.5 * 60 * 1000
          const resendAt = Date.now() + 30 * 1000
          applyDeliveryTiming({
            expiresAt,
            resendAvailableAt: resendAt,
            sendsRemaining: Math.max(0, sendsRemaining - 1),
          })
          setDeliveryStatus("unconfirmed")
          return
        }
      }

      setDeliveryStatus("failed")
      setError("We couldn't send the code. Please try again.")
    }
  }

  const onLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoginStatus("loading")
    setError(null)
    setFieldErrors({})

    const clientErrors: Record<string, string> = {}
    if (!email.trim()) clientErrors.email = "Email is required."
    if (!password) clientErrors.password = "Password is required."
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors)
      setLoginStatus("idle")
      return
    }

    try {
      const result = await login({
        email: email.trim(),
        password,
        otpDeliveryMode: "DEFERRED",
      })
      if (result.requiresOtp && result.challengeToken) {
        setChallengeToken(result.challengeToken)
        setOtp("")
        setOtpExpiresAt(null)
        setResendAvailableAt(null)
        setOtpCountdown(0)
        setResendCountdown(0)
        setSendsRemaining(result.sendsRemaining ?? 3)
        setDeliveryStatus("idle")
        setStep("otp")
        setLoginStatus("idle")

        if (result.otpDeliveryStatus === "PENDING") {
          void requestOtpDelivery(result.challengeToken)
        } else {
          const expiresAt = result.expiresAt
            ? new Date(result.expiresAt).getTime()
            : Date.now() + 5 * 60 * 1000
          const resendAt = result.resendAvailableAt
            ? new Date(result.resendAvailableAt).getTime()
            : Date.now() + 30 * 1000
          applyDeliveryTiming({
            expiresAt,
            resendAvailableAt: resendAt,
            sendsRemaining: result.sendsRemaining ?? 2,
          })
          setDeliveryStatus(
            result.otpDeliveryStatus === "UNCONFIRMED"
              ? "unconfirmed"
              : "sent",
          )
        }
      } else {
        const me = await getMe()
        const membership = me.user.memberships[0]
        if (membership?.tenant?.slug) {
          router.push(getTenantEntryPath(membership))
        } else {
          setError("No tenant workspace found for this account.")
        }
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
      setLoginStatus("idle")
    }
  }

  const onVerifyOtp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setVerifyStatus("loading")
    setError(null)
    setFieldErrors({})

    if (otp.trim().length !== 6) {
      setFieldErrors({ otp: "Enter the complete 6-digit verification code." })
      setVerifyStatus("idle")
      return
    }

    if (!canEnterCode) {
      setError("Request a current verification code before continuing.")
      setVerifyStatus("idle")
      return
    }

    try {
      await verifyOtp({ challengeToken, code: otp.trim() })
      const me = await getMe()
      const membership = me.user.memberships[0]
      if (membership?.tenant?.slug) {
        router.push(getTenantEntryPath(membership))
      } else {
        setError("No tenant workspace found for this account.")
      }
    } catch (err) {
      if (isAxiosError(err)) {
        const code = err.response?.data?.error
        switch (code) {
          case "INVALID_OTP":
            setFieldErrors({ otp: "Invalid verification code." })
            break
          case "OTP_EXPIRED":
            setError("Your code expired. Request a new code to continue.")
            setOtpExpiresAt(null)
            setOtpCountdown(0)
            setDeliveryStatus("failed")
            break
          case "TOO_MANY_ATTEMPTS":
            returnToLogin("Too many incorrect attempts. Please sign in again.")
            break
          case "INVALID_CHALLENGE":
          case "CHALLENGE_EXPIRED":
            returnToLogin(
              "Your secure login session expired. Please sign in again.",
            )
            break
          default:
            setError("Something went wrong. Please try again.")
        }
      } else {
        setError("Something went wrong. Please try again.")
      }
    } finally {
      setVerifyStatus("idle")
    }
  }

  useEffect(() => {
    if (step !== "otp") {
      setOtpCountdown(0)
      setResendCountdown(0)
      return
    }

    const tick = () => {
      setOtpCountdown(
        otpExpiresAt
          ? Math.max(0, Math.floor((otpExpiresAt - Date.now()) / 1000))
          : 0,
      )
      setResendCountdown(
        resendAvailableAt
          ? Math.max(
              0,
              Math.ceil((resendAvailableAt - Date.now()) / 1000),
            )
          : 0,
      )
    }

    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [step, otpExpiresAt, resendAvailableAt])

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
                    : deliveryStatus === "sending"
                      ? `Sending a secure code to ${maskedEmail}…`
                      : deliveryStatus === "sent"
                        ? `Enter the 6-digit code sent to ${maskedEmail}.`
                        : deliveryStatus === "unconfirmed"
                          ? `Watch ${maskedEmail} for your secure code.`
                          : `Request a secure code for ${maskedEmail}.`}
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
                        href="/reset-password"
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
                      isLoginLoading ? "opacity-70 cursor-not-allowed" : ""
                    }`}
                    disabled={isLoginLoading}
                    type="submit"
                  >
                    {isLoginLoading ? "Checking credentials..." : "Sign in"}
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
                      disabled={!canEnterCode || isVerifying}
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

                    {otpExpiresAt ? (
                      <div className="flex items-center justify-center md:justify-start gap-2 text-sm text-slate-500">
                        <Clock className="h-4 w-4 text-slate-400" />
                        <span>
                          {otpCountdown > 0 ? "Code expires in " : "Code expired "}
                          <span className="font-semibold text-slate-700">
                            {formatCountdown(otpCountdown)}
                          </span>
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <div
                    className={`rounded-xl border p-4 flex items-start gap-3 ${
                      deliveryStatus === "sent"
                        ? "border-emerald-200 bg-emerald-50/70"
                        : deliveryStatus === "failed"
                          ? "border-red-200 bg-red-50/70"
                          : deliveryStatus === "unconfirmed"
                            ? "border-amber-200 bg-amber-50/70"
                            : "border-indigo-100 bg-indigo-50/70"
                    }`}
                  >
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                        deliveryStatus === "sent"
                          ? "bg-emerald-100"
                          : deliveryStatus === "failed"
                            ? "bg-red-100"
                            : deliveryStatus === "unconfirmed"
                              ? "bg-amber-100"
                              : "bg-indigo-100"
                      }`}
                    >
                      {deliveryStatus === "sending" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" />
                      ) : deliveryStatus === "sent" ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      ) : deliveryStatus === "failed" ||
                        deliveryStatus === "unconfirmed" ? (
                        <TriangleAlert
                          className={`h-3.5 w-3.5 ${
                            deliveryStatus === "failed"
                              ? "text-red-600"
                              : "text-amber-600"
                          }`}
                        />
                      ) : (
                        <Info className="h-3.5 w-3.5 text-indigo-600" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 text-sm text-slate-600">
                      <p className="font-medium text-slate-700">
                        {deliveryStatus === "sending"
                          ? "Sending your verification code"
                          : deliveryStatus === "sent"
                            ? "Verification code sent"
                            : deliveryStatus === "unconfirmed"
                              ? "Delivery is taking longer"
                              : deliveryStatus === "failed"
                                ? "Code delivery needs another try"
                                : "Secure email verification"}
                      </p>
                      <p className="text-slate-500 mt-1">
                        {deliveryStatus === "sending"
                          ? "This usually takes only a few seconds."
                          : deliveryStatus === "sent"
                            ? "Check your inbox and spam folder."
                            : deliveryStatus === "unconfirmed"
                              ? "If the email arrives, the code is safe to use."
                              : "You can request another code after the secure wait."}
                      </p>
                      {deliveryStatus !== "sending" ? (
                        <button
                          type="button"
                          className="mt-3 inline-flex items-center gap-1.5 font-semibold text-indigo-600 transition hover:text-indigo-500 disabled:cursor-not-allowed disabled:text-slate-400"
                          disabled={!canResend}
                          onClick={() => void requestOtpDelivery(challengeToken)}
                        >
                          <RotateCw className="h-3.5 w-3.5" />
                          {sendsRemaining === 0
                            ? "No sends remaining"
                            : resendCountdown > 0
                              ? `Resend in ${resendCountdown}s`
                              : `Resend code (${sendsRemaining} left)`}
                        </button>
                      ) : null}
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
                        isVerifying ? "opacity-70 cursor-not-allowed" : ""
                      }`}
                      disabled={!canEnterCode || otp.length !== 6 || isVerifying}
                      type="submit"
                    >
                      <span>
                        {isVerifying ? "Verifying..." : "Verify & Continue"}
                      </span>
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full border-slate-200 text-slate-700 hover:bg-slate-50"
                      onClick={() => returnToLogin()}
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
