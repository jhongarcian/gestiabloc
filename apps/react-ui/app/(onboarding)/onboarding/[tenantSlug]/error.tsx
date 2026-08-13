"use client"

import { RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"

export default function OnboardingError({ reset }: { reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f3f1ea] px-6">
      <div className="max-w-md rounded-3xl border border-slate-900/10 bg-white p-8 text-center shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">
          Workspace setup
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
          We could not load your setup guide
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Your workspace is still available. Try loading the guide again or
          return to it later from Account Settings.
        </p>
        <Button className="mt-6 gap-2 bg-[#0b1730] hover:bg-[#162747]" onClick={reset}>
          <RotateCcw className="h-4 w-4" />
          Try again
        </Button>
      </div>
    </main>
  )
}
