"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { isAxiosError } from "axios"

import { verifyEmail } from "@/lib/api"

type VerifyState = "idle" | "loading" | "success" | "error"

export default function VerifyEmailPage() {
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

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#f5f5f5,_#e4e7eb_45%,_#d7dbe1_100%)] px-6 py-16 text-zinc-900">
      <div className="mx-auto w-full max-w-2xl rounded-3xl border border-black/10 bg-white p-10 shadow-2xl">
        <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
          GestiaBloc
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">
          Verify your email
        </h1>
        <p className="mt-3 text-sm text-zinc-600">
          {state === "loading" ? "Verifying your email..." : message}
        </p>

        {state === "success" ? (
          <div className="mt-6">
            <Link
              href="/login"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-zinc-900 px-5 text-sm font-semibold text-white transition hover:bg-zinc-800"
            >
              Continue to sign in
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  )
}
