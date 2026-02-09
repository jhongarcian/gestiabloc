"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { tenantSignup } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { isAxiosError } from "axios"
import {
  ArrowRight,
  Bolt,
  Building2,
  Check,
  Circle,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Rocket,
  User,
} from "lucide-react"

export default function SignUpPage() {
  const router = useRouter()
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle")
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [planKey, setPlanKey] = useState<"STARTER" | "PRO" | "BUSINESS">(
    "STARTER",
  )
  const [paidNow, setPaidNow] = useState(false)
  const [adminPassword, setAdminPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const passwordsMatch =
    confirmPassword.length > 0 && adminPassword === confirmPassword
  const hasLength = adminPassword.length >= 8
  const hasLetter = /[A-Za-z]/.test(adminPassword)
  const hasNumber = /[0-9]/.test(adminPassword)
  const hasSymbol = /[^A-Za-z0-9]/.test(adminPassword)

  const isLoading = status === "loading"

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus("loading")
    setError(null)
    setFieldErrors({})

    const form = event.currentTarget
    const formData = new FormData(event.currentTarget)
    const payload = {
      adminName: String(formData.get("adminName") || "").trim(),
      adminEmail: String(formData.get("adminEmail") || "").trim(),
      adminPassword,
      tenantName: String(formData.get("tenantName") || "").trim(),
      planKey,
      paidNow,
    }

    const clientErrors: Record<string, string> = {}
    if (!payload.adminName) clientErrors.adminName = "Full name is required."
    if (!payload.adminEmail) clientErrors.adminEmail = "Email is required."
    if (!payload.adminPassword)
      clientErrors.adminPassword = "Password is required."
    if (!payload.tenantName)
      clientErrors.tenantName = "Workspace name is required."

    if (confirmPassword && confirmPassword !== payload.adminPassword) {
      clientErrors.adminPassword = "Passwords do not match."
      clientErrors.confirmPassword = "Passwords do not match."
    }

    if (Object.keys(clientErrors).length > 0) {
      setStatus("error")
      setFieldErrors(clientErrors)
      return
    }

    try {
      await tenantSignup(payload)

      setStatus("success")
      setFieldErrors({})
      setAdminPassword("")
      setConfirmPassword("")
      form.reset()
      router.push("/signup/success")
    } catch (err) {
      setStatus("error")
      let message: string | null = "Something went wrong. Please try again."
      if (isAxiosError(err)) {
        const code = err.response?.data?.error
        const details = err.response?.data?.details
        if (Array.isArray(details)) {
          const nextErrors: Record<string, string> = {}
          for (const item of details) {
            if (item?.path) nextErrors[item.path] = item.message
          }
          setFieldErrors(nextErrors)
          message = null
        }
        switch (code) {
          case "EMAIL_IN_USE":
            setFieldErrors((prev) => ({
              ...prev,
              adminEmail: "That email is already in use.",
            }))
            message = null
            break
          case "TENANT_EMAIL_IN_USE":
            setFieldErrors((prev) => ({
              ...prev,
              adminEmail: "That email is already in use.",
            }))
            message = null
            break
          case "TENANT_SLUG_IN_USE":
            setFieldErrors((prev) => ({
              ...prev,
              tenantName: "That workspace name is taken.",
            }))
            message = null
            break
          case "INVALID_TENANT_NAME":
            setFieldErrors((prev) => ({
              ...prev,
              tenantName: "Workspace name is invalid.",
            }))
            message = null
            break
          default:
            message =
              typeof code === "string" && code.length > 0
                ? "Something went wrong. Please try again."
                : err.message || message
        }
      } else if (err instanceof Error) {
        message = err.message
      }
      setError(message)
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900  md:h-screen md:overflow-hidden overflow-x-hidden">
      <div className="mx-auto flex w-full  items-stretch justify-center md:h-full">
        <div
          id="signup-container"
          className="w-full  flex flex-col md:flex-row relative z-10 md:h-full md:min-h-0"
        >
          <div className="hidden md:flex md:w-1/2 bg-white/50 backdrop-blur-sm relative items-center justify-center p-12 lg:p-20 overflow-hidden md:sticky md:top-0 md:self-start md:h-full">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/5 to-purple-600/5" />

            <div className="relative z-20 max-w-lg">
              <div className="mb-12">
                <div className="w-full h-80 relative">
                  <img
                    src="https://storage.googleapis.com/uxpilot-auth.appspot.com/22ea104277-9d0d4b32f30ca58e8409.png"
                    className="w-full h-full object-contain drop-shadow-2xl animate-float"
                    alt="Create Account Illustration"
                  />
                </div>
              </div>

              <div className="space-y-6 text-center">
                <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 leading-tight">
                  Join thousands of teams{" "}
                  <span className="text-indigo-600">already using</span>{" "}
                  Gestiabloc
                </h2>
                <p className="text-slate-500 text-lg">
                  Start your journey today with a flexible plan that grows with
                  your business needs.
                </p>
              </div>
            </div>
          </div>

          <div className="w-full md:w-1/2 flex flex-col justify-start items-center p-4 sm:p-6 lg:p-8 bg-white shadow-2xl md:shadow-none md:h-full md:overflow-y-auto">
            <div className="max-w-2xl mx-auto px-0 sm:px-2 md:px-6 py-8 sm:py-10 lg:py-16">
              <div className="mb-10">
                <h2 className="text-3xl font-bold text-slate-900 mb-2">
                  Create your account
                </h2>
                <p className="text-slate-500">
                  Start your 7-day free trial. No credit card required.
                </p>
                <p className="mt-3 text-sm text-slate-500">
                  Already have a workspace?{" "}
                  <a className="text-indigo-600 hover:underline" href="/login">
                    Sign in
                  </a>
                </p>
              </div>

              <form
                id="create-account-form"
                className="space-y-6"
                onSubmit={onSubmit}
              >
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">
                    Personal Information
                  </h3>

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="adminName"
                        className="text-sm font-semibold text-slate-700"
                      >
                        Full Name
                      </Label>
                      <div className="relative">
                        <User className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                          type="text"
                          id="adminName"
                          name="adminName"
                          placeholder="John Doe"
                          required
                          className={`w-full pl-10 pr-4 py-2.5 bg-white border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all shadow-sm ${
                            fieldErrors.adminName
                              ? "border-red-300 focus:ring-red-200/60 focus:border-red-400"
                              : "border-slate-200 focus:ring-indigo-500/20 focus:border-indigo-500"
                          }`}
                        />
                      </div>
                      {fieldErrors.adminName ? (
                        <p className="text-xs text-red-600">
                          {fieldErrors.adminName}
                        </p>
                      ) : null}
                    </div>

                    <div className="space-y-1.5">
                      <Label
                        htmlFor="adminEmail"
                        className="text-sm font-semibold text-slate-700"
                      >
                        Work Email
                      </Label>
                      <div className="relative">
                        <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                          type="email"
                          id="adminEmail"
                          name="adminEmail"
                          placeholder="name@company.com"
                          required
                          className={`w-full pl-10 pr-4 py-2.5 bg-white border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all shadow-sm ${
                            fieldErrors.adminEmail
                              ? "border-red-300 focus:ring-red-200/60 focus:border-red-400"
                              : "border-slate-200 focus:ring-indigo-500/20 focus:border-indigo-500"
                          }`}
                        />
                      </div>
                      {fieldErrors.adminEmail ? (
                        <p className="text-xs text-red-600">
                          {fieldErrors.adminEmail}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">
                    Workspace Information
                  </h3>

                  <div className="space-y-1.5">
                    <Label
                      htmlFor="tenantName"
                      className="text-sm font-semibold text-slate-700"
                    >
                      Workspace Name
                    </Label>
                    <div className="relative">
                      <Building2 className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        type="text"
                        id="tenantName"
                        name="tenantName"
                        placeholder="Acme Inc."
                        required
                        className={`w-full pl-10 pr-4 py-2.5 bg-white border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all shadow-sm ${
                          fieldErrors.tenantName
                            ? "border-red-300 focus:ring-red-200/60 focus:border-red-400"
                            : "border-slate-200 focus:ring-indigo-500/20 focus:border-indigo-500"
                        }`}
                      />
                    </div>
                    <p className="text-xs text-slate-400 pl-1">
                      Your workspace URL will be: gestiabloc.com/workspaces/
                      <span className="font-medium text-indigo-500">
                        acme-inc
                      </span>
                    </p>
                    {fieldErrors.tenantName ? (
                      <p className="text-xs text-red-600">
                        {fieldErrors.tenantName}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">
                    Security
                  </h3>

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="adminPassword"
                        className="text-sm font-semibold text-slate-700"
                      >
                        Password
                      </Label>
                      <div className="relative">
                        <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                          type={showPassword ? "text" : "password"}
                          id="adminPassword"
                          name="adminPassword"
                          placeholder="Create a password"
                          value={adminPassword}
                          required
                          onChange={(event) =>
                            setAdminPassword(event.target.value)
                          }
                          className={`w-full pl-10 pr-10 py-2.5 bg-white border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all shadow-sm ${
                            fieldErrors.adminPassword
                              ? "border-red-300 focus:ring-red-200/60 focus:border-red-400"
                              : "border-slate-200 focus:ring-indigo-500/20 focus:border-indigo-500"
                          }`}
                        />
                        <button
                          type="button"
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                          aria-label={
                            showPassword ? "Hide password" : "Show password"
                          }
                          onClick={() => setShowPassword((prev) => !prev)}
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                      {fieldErrors.adminPassword ? (
                        <p className="text-xs text-red-600">
                          {fieldErrors.adminPassword}
                        </p>
                      ) : null}
                    </div>

                    <div className="space-y-1.5">
                      <Label
                        htmlFor="confirmPassword"
                        className="text-sm font-semibold text-slate-700"
                      >
                        Confirm Password
                      </Label>
                      <div className="relative">
                        <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                          type={showConfirmPassword ? "text" : "password"}
                          id="confirmPassword"
                          name="confirmPassword"
                          placeholder="Confirm password"
                          value={confirmPassword}
                          required
                          onChange={(event) =>
                            setConfirmPassword(event.target.value)
                          }
                          className={`w-full pl-10 pr-10 py-2.5 bg-white border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all shadow-sm ${
                            fieldErrors.confirmPassword
                              ? "border-red-300 focus:ring-red-200/60 focus:border-red-400"
                              : "border-slate-200 focus:ring-indigo-500/20 focus:border-indigo-500"
                          }`}
                        />
                        <button
                          type="button"
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                          aria-label={
                            showConfirmPassword
                              ? "Hide confirm password"
                              : "Show confirm password"
                          }
                          onClick={() =>
                            setShowConfirmPassword((prev) => !prev)
                          }
                        >
                          {showConfirmPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                      {confirmPassword.length > 0 ? (
                        <p
                          className={
                            passwordsMatch
                              ? "text-xs text-emerald-600"
                              : "text-xs text-red-600"
                          }
                        >
                          {passwordsMatch
                            ? "✓ Passwords match"
                            : "Passwords do not match"}
                        </p>
                      ) : null}
                      {fieldErrors.confirmPassword ? (
                        <p className="text-xs text-red-600">
                          {fieldErrors.confirmPassword}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-200 shadow-sm">
                    <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                      Password Requirements
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-600">
                      <div className="validation-item flex items-center gap-2">
                        <Circle
                          className={`h-2.5 w-2.5 ${
                            hasLength ? "text-emerald-500" : "text-slate-400"
                          }`}
                        />
                        <span
                          className={hasLength ? "text-emerald-700" : undefined}
                        >
                          At least 8 characters
                        </span>
                      </div>

                      <div className="validation-item flex items-center gap-2">
                        <Circle
                          className={`h-2.5 w-2.5 ${
                            hasLetter ? "text-emerald-500" : "text-slate-400"
                          }`}
                        />
                        <span
                          className={hasLetter ? "text-emerald-700" : undefined}
                        >
                          At least 1 letter
                        </span>
                      </div>

                      <div className="validation-item flex items-center gap-2">
                        <Circle
                          className={`h-2.5 w-2.5 ${
                            hasNumber ? "text-emerald-500" : "text-slate-400"
                          }`}
                        />
                        <span
                          className={hasNumber ? "text-emerald-700" : undefined}
                        >
                          At least 1 number
                        </span>
                      </div>

                      <div className="validation-item flex items-center gap-2">
                        <Circle
                          className={`h-2.5 w-2.5 ${
                            hasSymbol ? "text-emerald-500" : "text-slate-400"
                          }`}
                        />
                        <span
                          className={hasSymbol ? "text-emerald-700" : undefined}
                        >
                          At least 1 symbol
                        </span>
                      </div>

                      <div className="validation-item flex items-center gap-2 col-span-1 sm:col-span-2">
                        <Circle
                          className={`h-2.5 w-2.5 ${
                            passwordsMatch
                              ? "text-emerald-500"
                              : "text-slate-400"
                          }`}
                        />
                        <span
                          className={
                            passwordsMatch ? "text-emerald-700" : undefined
                          }
                        >
                          Passwords match
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">
                    Select Plan
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <label className="cursor-pointer relative group">
                      <input
                        type="radio"
                        name="planKey"
                        value="STARTER"
                        checked={planKey === "STARTER"}
                        onChange={() => setPlanKey("STARTER")}
                        className="peer sr-only"
                      />
                      <div className="p-4 rounded-xl bg-white border border-slate-200 hover:border-indigo-300 transition-all h-full flex flex-col justify-between peer-checked:border-indigo-500 peer-checked:ring-2 peer-checked:ring-indigo-200">
                        <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs opacity-0 scale-50 transition-all duration-300 peer-checked:opacity-100 peer-checked:scale-100">
                          <Check className="h-3 w-3" />
                        </div>

                        <div>
                          <div className="w-10 h-10 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center mb-3">
                            <Rocket className="h-5 w-5" />
                          </div>
                          <h3 className="font-bold text-slate-800">Starter</h3>
                          <p className="text-xs text-slate-500 mt-1">
                            For small teams getting started.
                          </p>
                        </div>

                        <div className="mt-4 pt-4 border-t border-slate-100">
                          <span className="text-lg font-bold text-slate-900">
                            $0
                          </span>
                          <span className="text-xs text-slate-500">
                            /mo per user
                          </span>
                        </div>
                      </div>
                    </label>

                    <label className="cursor-pointer relative group">
                      <input
                        type="radio"
                        name="planKey"
                        value="PRO"
                        checked={planKey === "PRO"}
                        onChange={() => setPlanKey("PRO")}
                        className="peer sr-only"
                      />
                      <div className="p-4 rounded-xl bg-white border border-slate-200 hover:border-indigo-300 transition-all h-full flex flex-col justify-between relative overflow-hidden peer-checked:border-indigo-500 peer-checked:ring-2 peer-checked:ring-indigo-200">
                        <div className="absolute top-0 right-0 bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-bl-lg z-10">
                          POPULAR
                        </div>

                        <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs opacity-0 scale-50 transition-all duration-300 peer-checked:opacity-100 peer-checked:scale-100">
                          <Check className="h-3 w-3" />
                        </div>

                        <div>
                          <div className="w-10 h-10 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center mb-3">
                            <Bolt className="h-5 w-5" />
                          </div>
                          <h3 className="font-bold text-slate-800">
                            Pro Business
                          </h3>
                          <p className="text-xs text-slate-500 mt-1">
                            For growing teams needing power.
                          </p>
                        </div>

                        <div className="mt-4 pt-4 border-t border-slate-100">
                          <span className="text-lg font-bold text-slate-900">
                            $29
                          </span>
                          <span className="text-xs text-slate-500">
                            /mo per user
                          </span>
                        </div>
                      </div>
                    </label>

                    <label className="cursor-pointer relative group">
                      <input
                        type="radio"
                        name="planKey"
                        value="BUSINESS"
                        checked={planKey === "BUSINESS"}
                        onChange={() => setPlanKey("BUSINESS")}
                        className="peer sr-only"
                      />
                      <div className="p-4 rounded-xl bg-white border border-slate-200 hover:border-indigo-300 transition-all h-full flex flex-col justify-between peer-checked:border-indigo-500 peer-checked:ring-2 peer-checked:ring-indigo-200">
                        <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs opacity-0 scale-50 transition-all duration-300 peer-checked:opacity-100 peer-checked:scale-100">
                          <Check className="h-3 w-3" />
                        </div>

                        <div>
                          <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center mb-3">
                            <Building2 className="h-5 w-5" />
                          </div>
                          <h3 className="font-bold text-slate-800">
                            Enterprise
                          </h3>
                          <p className="text-xs text-slate-500 mt-1">
                            Custom solutions for large orgs.
                          </p>
                        </div>

                        <div className="mt-4 pt-4 border-t border-slate-100">
                          <span className="text-lg font-bold text-slate-900">
                            $99
                          </span>
                          <span className="text-xs text-slate-500">
                            /mo per user
                          </span>
                        </div>
                      </div>
                    </label>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-start gap-3 shadow-sm">
                    <Checkbox
                      id="pay-now"
                      checked={paidNow}
                      onCheckedChange={(value) => setPaidNow(Boolean(value))}
                      className="mt-0.5 h-5 w-5 rounded border-2 border-slate-300 data-[state=checked]:bg-indigo-600 data-[state=checked]:border-indigo-600"
                    />

                    <div className="flex-1">
                      <Label
                        htmlFor="pay-now"
                        className="text-sm font-bold text-slate-800 cursor-pointer select-none"
                      >
                        Pay now &amp; Skip Trial
                      </Label>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Get an immediate 20% discount on your first year by
                        skipping the 7-day trial period.
                      </p>
                    </div>

                    <div className="text-green-600 bg-green-50 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide">
                      Save 20%
                    </div>
                  </div>
                </div>

                <div className="pt-2">
                  <Button
                    type="submit"
                    disabled={isLoading}
                    className={`w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-xl shadow-lg hover:shadow-indigo-500/30 transition-all duration-300 transform hover:-translate-y-0.5 flex items-center justify-center gap-2 group ${
                      isLoading ? "opacity-70 cursor-not-allowed" : ""
                    }`}
                  >
                    <span>
                      {isLoading ? "Creating account..." : "Create Account"}
                    </span>
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </Button>

                  {status === "success" ? (
                    <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                      Account created. Check your email for verification steps.
                    </p>
                  ) : null}

                  {status === "error" && error ? (
                    <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {error}
                    </p>
                  ) : null}

                  <p className="text-xs text-center text-slate-400 mt-4">
                    By clicking "Create Account", you agree to our{" "}
                    <a href="#" className="text-indigo-600 hover:underline">
                      Terms of Service
                    </a>{" "}
                    and{" "}
                    <a href="#" className="text-indigo-600 hover:underline">
                      Privacy Policy
                    </a>
                    .
                  </p>
                </div>
              </form>
            </div>

            <div className="mt-12 text-center text-xs text-slate-400">
              © 2024 Gestiabloc Inc. All rights reserved.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
