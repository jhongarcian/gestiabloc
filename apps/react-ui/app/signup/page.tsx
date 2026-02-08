"use client"

import { useMemo, useState } from "react"

const SIGNUP_ENDPOINT =
  (process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000") +
  "/api/auth/sign-up/email"

export default function SignUpPage() {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">(
    "idle",
  )
  const [error, setError] = useState<string | null>(null)

  const isLoading = status === "loading"

  const benefits = useMemo(
    () => [
      "Create your workspace in under a minute.",
      "Invite teammates and assign roles.",
      "Manage subscriptions from one place.",
    ],
    [],
  )

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus("loading")
    setError(null)

    const formData = new FormData(event.currentTarget)
    const payload = {
      name: formData.get("name"),
      email: formData.get("email"),
      password: formData.get("password"),
      tenantName: formData.get("tenantName"),
    }

    try {
      const response = await fetch(SIGNUP_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || "Sign up failed.")
      }

      setStatus("success")
      event.currentTarget.reset()
    } catch (err) {
      setStatus("error")
      setError(err instanceof Error ? err.message : "Sign up failed.")
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#f5f5f5,_#e4e7eb_45%,_#d7dbe1_100%)] px-6 py-16 text-zinc-900">
      <div className="mx-auto grid w-full max-w-5xl gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="flex flex-col justify-between rounded-3xl border border-black/5 bg-white/80 p-10 shadow-xl backdrop-blur">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
              GestiaBloc
            </p>
            <h1 className="mt-6 text-4xl font-semibold leading-tight tracking-tight">
              Launch your client workspace in minutes.
            </h1>
            <p className="mt-4 text-lg text-zinc-600">
              Start with a clean tenant, invite your team, and manage every
              subscription from one place.
            </p>
          </div>
          <div className="mt-10 space-y-3 text-sm text-zinc-600">
            {benefits.map((benefit) => (
              <div
                key={benefit}
                className="flex items-center gap-3 rounded-2xl border border-zinc-100 bg-white/90 px-4 py-3"
              >
                <span className="h-2 w-2 rounded-full bg-zinc-900" />
                <span>{benefit}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-black/10 bg-white p-10 shadow-2xl">
          <div className="mb-8">
            <h2 className="text-2xl font-semibold tracking-tight">
              Create your account
            </h2>
            <p className="mt-2 text-sm text-zinc-500">
              Already have a workspace?{" "}
              <a className="font-medium text-zinc-900" href="/login">
                Sign in
              </a>
            </p>
          </div>

          <form className="space-y-6" onSubmit={onSubmit}>
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700" htmlFor="name">
                Full name
              </label>
              <input
                className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200"
                id="name"
                name="name"
                placeholder="Ada Lovelace"
                required
                type="text"
              />
            </div>

            <div className="space-y-2">
              <label
                className="text-sm font-medium text-zinc-700"
                htmlFor="email"
              >
                Work email
              </label>
              <input
                className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200"
                id="email"
                name="email"
                placeholder="you@company.com"
                required
                type="email"
              />
            </div>

            <div className="space-y-2">
              <label
                className="text-sm font-medium text-zinc-700"
                htmlFor="password"
              >
                Password
              </label>
              <input
                className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200"
                id="password"
                name="password"
                placeholder="At least 8 characters"
                required
                type="password"
              />
            </div>

            <div className="space-y-2">
              <label
                className="text-sm font-medium text-zinc-700"
                htmlFor="tenantName"
              >
                Workspace name (optional)
              </label>
              <input
                className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200"
                id="tenantName"
                name="tenantName"
                placeholder="Acme Studio"
                type="text"
              />
            </div>

            <button
              className="flex h-12 w-full items-center justify-center rounded-xl bg-zinc-900 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
              disabled={isLoading}
              type="submit"
            >
              {isLoading ? "Creating account..." : "Create account"}
            </button>

            {status === "success" ? (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                Account created. Check your email for verification steps.
              </p>
            ) : null}

            {status === "error" && error ? (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            ) : null}

            <p className="text-xs text-zinc-500">
              By creating an account you agree to our Terms and Privacy Policy.
            </p>
          </form>
        </section>
      </div>
    </div>
  )
}
