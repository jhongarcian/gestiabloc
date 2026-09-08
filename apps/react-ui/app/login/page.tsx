"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { isAxiosError } from "axios"
import Link from "next/link"

import { getMe, login, sendOtp, verifyOtp } from "@/lib/api"
import { getTenantEntryPath } from "@/lib/onboarding"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { Label } from "@/components/ui/label"
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
  TriangleAlert,
} from "lucide-react"

type Step = "login" | "otp"
type RequestStatus = "idle" | "loading"
type DeliveryStatus = "idle" | "sending" | "sent" | "unconfirmed" | "failed"

const AUTH_PRIMARY_BUTTON_CLASS =
  "h-11 w-full cursor-pointer rounded-full bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm ring-1 ring-white/15 transition hover:bg-blue-500 hover:text-white disabled:cursor-not-allowed disabled:bg-blue-900 disabled:text-blue-300"

const AUTH_SECONDARY_BUTTON_CLASS =
  "h-11 w-full cursor-pointer rounded-full border-white/25 bg-white/10 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-white/15 hover:text-white disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-blue-300"

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
    <main className="relative min-h-[100svh] overflow-x-hidden bg-blue-950 text-slate-950">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:44px_44px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 left-1/2 size-[32rem] -translate-x-1/2 rounded-full bg-blue-500/25 blur-3xl"
      />

      <div
        id="login-container"
        className="relative z-10 flex min-h-[100svh] w-full items-start justify-center px-4 py-5 sm:items-center sm:px-8 sm:py-10"
      >
        <section className="w-full max-w-[460px] py-6 sm:py-10">
            <div className={step === "login" ? "mb-8" : "mb-8 text-center"}>
              <div className="flex items-center justify-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-white shadow-sm">
                  <Box className="size-5" aria-hidden="true" />
                </div>
                <h1 className="text-xl font-semibold tracking-tight text-white">
                  Gestiabloc
                </h1>
              </div>

              {step === "otp" ? (
                <>
                  <h2 className="mt-8 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                    Verify your login
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-blue-100/80">
                    {deliveryStatus === "sending"
                    ? `Sending a secure code to ${maskedEmail}…`
                    : deliveryStatus === "sent"
                      ? `Enter the 6-digit code sent to ${maskedEmail}.`
                      : deliveryStatus === "unconfirmed"
                        ? `Watch ${maskedEmail} for your secure code.`
                        : `Request a secure code for ${maskedEmail}.`}
                  </p>
                </>
              ) : null}
            </div>

              {step === "login" ? (
                <form className="flex flex-col gap-5" onSubmit={onLogin}>
                  <div className="flex flex-col gap-2">
                    <Label
                      htmlFor="email"
                      className="text-sm font-medium text-blue-50"
                    >
                      Email Address
                    </Label>
                    <div className="relative">
                      <Mail
                        className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                        aria-hidden="true"
                      />
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        aria-invalid={Boolean(fieldErrors.email)}
                        aria-describedby={
                          fieldErrors.email ? "email-error" : undefined
                        }
                        placeholder="name@company.com"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className={`h-11 rounded-full bg-white pl-11 pr-4 text-sm text-slate-950 shadow-sm focus-visible:border-blue-300 focus-visible:ring-blue-300/40 ${
                          fieldErrors.email
                            ? "border-rose-300 focus-visible:border-rose-400 focus-visible:ring-rose-100"
                            : "border-white"
                        }`}
                      />
                    </div>
                    {fieldErrors.email ? (
                      <p id="email-error" className="text-xs text-rose-200">
                        {fieldErrors.email}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <Label
                        htmlFor="password"
                        className="text-sm font-medium text-blue-50"
                      >
                        Password
                      </Label>
                      <Link
                        href="/reset-password"
                        className="text-xs font-semibold text-blue-100 underline-offset-4 hover:text-white hover:underline sm:text-sm"
                      >
                        Forgot password?
                      </Link>
                    </div>
                    <div className="relative">
                      <Lock
                        className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                        aria-hidden="true"
                      />
                      <Input
                        id="password"
                        name="password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        aria-invalid={Boolean(fieldErrors.password)}
                        aria-describedby={
                          fieldErrors.password ? "password-error" : undefined
                        }
                        placeholder="••••••••"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className={`h-11 rounded-full bg-white pl-11 pr-11 text-sm text-slate-950 shadow-sm focus-visible:border-blue-300 focus-visible:ring-blue-300/40 ${
                          fieldErrors.password
                            ? "border-rose-300 focus-visible:border-rose-400 focus-visible:ring-rose-100"
                            : "border-white"
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        className="absolute right-2 top-1/2 flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-slate-400 transition hover:bg-blue-50 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
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
                      <p id="password-error" className="text-xs text-rose-200">
                        {fieldErrors.password}
                      </p>
                    ) : null}
                  </div>

                  {error ? (
                    <p
                      role="alert"
                      className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
                    >
                      {error}
                    </p>
                  ) : null}

                  <Button
                    className={AUTH_PRIMARY_BUTTON_CLASS}
                    disabled={isLoginLoading}
                    type="submit"
                  >
                    {isLoginLoading ? (
                      <Loader2
                        data-icon="inline-start"
                        className="animate-spin"
                        aria-hidden="true"
                      />
                    ) : null}
                    {isLoginLoading ? "Checking credentials" : "Sign in"}
                  </Button>

                  <p className="text-center text-sm text-blue-100/70">
                    New to Gestiabloc?{" "}
                    <Link
                      className="font-semibold text-white underline-offset-4 hover:underline"
                      href="/signup"
                    >
                      Create a workspace
                    </Link>
                  </p>
                </form>
              ) : (
                <form
                  className="flex flex-col items-center gap-5"
                  onSubmit={onVerifyOtp}
                >
                  <div className="flex w-full flex-col items-center gap-4">
                    <Label className="text-center text-sm font-medium text-blue-50">
                      Enter your 6-digit code
                    </Label>
                    <InputOTP
                      maxLength={6}
                      pattern={REGEXP_ONLY_DIGITS}
                      inputMode="numeric"
                      aria-label="6-digit verification code"
                      aria-invalid={Boolean(fieldErrors.otp)}
                      value={otp}
                      onChange={(value) => setOtp(value.replace(/\D/g, ""))}
                      disabled={!canEnterCode || isVerifying}
                      containerClassName="flex w-full justify-center"
                      className={fieldErrors.otp ? "text-rose-200" : undefined}
                    >
                      <InputOTPGroup className="gap-1.5 min-[360px]:gap-2">
                        {Array.from({ length: 6 }).map((_, index) => (
                          <InputOTPSlot
                            key={`otp-slot-${index}`}
                            index={index}
                            className={`size-10 rounded-xl border bg-white/95 text-lg font-semibold tabular-nums text-slate-950 shadow-sm min-[360px]:size-11 sm:size-12 ${
                              fieldErrors.otp
                                ? "border-rose-300 aria-invalid:ring-rose-300/30"
                                : "border-white/60 data-[active=true]:border-blue-300 data-[active=true]:ring-blue-300/30"
                            }`}
                          />
                        ))}
                      </InputOTPGroup>
                    </InputOTP>
                    {fieldErrors.otp ? (
                      <p className="text-center text-xs text-rose-200">
                        {fieldErrors.otp}
                      </p>
                    ) : null}

                    {otpExpiresAt ? (
                      <div className="flex items-center justify-center gap-2 text-sm text-blue-100/80">
                        <Clock
                          className="size-4 text-blue-200"
                          aria-hidden="true"
                        />
                        <span>
                          {otpCountdown > 0 ? "Code expires in " : "Code expired "}
                          <span className="font-semibold text-white">
                            {formatCountdown(otpCountdown)}
                          </span>
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <div
                    role="status"
                    aria-live="polite"
                    className="flex w-full flex-col items-center rounded-2xl border border-white/15 bg-white/[0.06] px-5 py-4 text-center shadow-sm backdrop-blur-sm"
                  >
                    <div
                      className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/10"
                    >
                      {deliveryStatus === "sending" ? (
                        <Loader2
                          className="size-4 animate-spin text-blue-200"
                          aria-hidden="true"
                        />
                      ) : deliveryStatus === "sent" ? (
                        <CheckCircle2
                          className="size-4 text-emerald-300"
                          aria-hidden="true"
                        />
                      ) : deliveryStatus === "failed" ||
                        deliveryStatus === "unconfirmed" ? (
                        <TriangleAlert
                          aria-hidden="true"
                          className={`size-4 ${
                            deliveryStatus === "failed"
                              ? "text-rose-300"
                              : "text-amber-300"
                          }`}
                        />
                      ) : (
                        <Info
                          className="size-4 text-blue-200"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                    <div className="mt-2 min-w-0 text-sm">
                      <p className="font-semibold text-white">
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
                      <p className="mt-1 text-xs leading-5 text-blue-100/70">
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
                          className="mt-3 inline-flex cursor-pointer items-center justify-center gap-1.5 font-semibold text-blue-100 underline-offset-4 transition hover:text-white hover:underline disabled:cursor-not-allowed disabled:text-blue-300/50 disabled:no-underline"
                          disabled={!canResend}
                          onClick={() => void requestOtpDelivery(challengeToken)}
                        >
                          <RotateCw className="size-3.5" aria-hidden="true" />
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
                    <p
                      role="alert"
                      className="w-full rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-center text-sm text-rose-100"
                    >
                      {error}
                    </p>
                  ) : null}

                  <div className="flex w-full flex-col gap-3">
                    <Button
                      className={AUTH_PRIMARY_BUTTON_CLASS}
                      disabled={!canEnterCode || otp.length !== 6 || isVerifying}
                      type="submit"
                    >
                      {isVerifying ? (
                        <Loader2
                          data-icon="inline-start"
                          className="animate-spin"
                          aria-hidden="true"
                        />
                      ) : null}
                      <span>
                        {isVerifying ? "Verifying" : "Verify and continue"}
                      </span>
                      {!isVerifying ? (
                        <ArrowRight data-icon="inline-end" aria-hidden="true" />
                      ) : null}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className={AUTH_SECONDARY_BUTTON_CLASS}
                      onClick={() => returnToLogin()}
                    >
                      <ArrowLeft data-icon="inline-start" aria-hidden="true" />
                      Back to sign in
                    </Button>
                  </div>

                </form>
              )}
        </section>
      </div>
    </main>
  )
}
