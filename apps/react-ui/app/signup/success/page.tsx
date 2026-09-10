import Link from "next/link"
import { ArrowRight, Box, MailCheck } from "lucide-react"

import { Button } from "@/components/ui/button"

const AUTH_PRIMARY_BUTTON_CLASS =
  "h-11 w-full cursor-pointer rounded-full bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm ring-1 ring-white/15 transition hover:bg-blue-500 hover:text-white"

export default function SignupSuccessPage() {
  return (
    <main className="relative min-h-[100svh] overflow-x-hidden bg-blue-950 text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:44px_44px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 left-1/2 size-[32rem] -translate-x-1/2 rounded-full bg-blue-500/25 blur-3xl"
      />

      <div className="relative z-10 flex min-h-[100svh] w-full items-center justify-center px-4 py-5 sm:px-8 sm:py-10">
        <section className="w-full max-w-[460px] py-6 text-center sm:py-10">
          <Link
            href="/"
            className="inline-flex items-center gap-3 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
            aria-label="Gestiabloc home"
          >
            <span className="flex size-10 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-white shadow-sm">
              <Box className="size-5" aria-hidden="true" />
            </span>
            <span className="text-xl font-semibold tracking-tight text-white">
              Gestiabloc
            </span>
          </Link>

          <div role="status" className="mt-10 flex flex-col items-center">
            <span className="flex size-12 items-center justify-center rounded-full border border-white/10 bg-white/10">
              <MailCheck
                className="size-6 text-emerald-300"
                aria-hidden="true"
              />
            </span>

            <h1 className="mt-5 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Check your email
            </h1>
            <p className="mt-2 max-w-sm text-sm leading-6 text-blue-100/75">
              We sent a secure verification link to your admin email. Open it
              to activate your workspace before signing in.
            </p>
          </div>

          <Button asChild className={`${AUTH_PRIMARY_BUTTON_CLASS} mt-8`}>
            <Link href="/login">
              Continue to sign in
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>

          <p className="mt-5 text-xs leading-5 text-blue-100/60">
            The link may take a few minutes to arrive. Check your spam folder
            if you don&apos;t see it.
          </p>
        </section>
      </div>
    </main>
  )
}
