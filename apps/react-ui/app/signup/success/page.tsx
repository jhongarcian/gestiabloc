"use client"

import Link from "next/link"

export default function SignupSuccessPage() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#f5f5f5,_#e4e7eb_45%,_#d7dbe1_100%)] px-6 py-16 text-zinc-900">
      <div className="mx-auto w-full max-w-2xl rounded-3xl border border-black/10 bg-white p-10 shadow-2xl">
        <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
          GestiaBloc
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">
          Check your email to verify
        </h1>
        <p className="mt-3 text-sm text-zinc-600">
          We sent a verification link to your admin email. Click it to activate
          your workspace.
        </p>
        <div className="mt-6 rounded-2xl border border-zinc-100 bg-zinc-50 p-4 text-sm text-zinc-600">
          Once verified, you can sign in and start inviting your team.
        </div>
        <div className="mt-6">
          <Link
            href="/login"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-zinc-900 px-5 text-sm font-semibold text-white transition hover:bg-zinc-800"
          >
            Go to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
