"use client"

import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Box, MailCheck, ShieldCheck } from "lucide-react"

export default function SignupSuccessPage() {
  return (
    <div className="min-h-screen bg-white/50 backdrop-blur-sm text-slate-900 px-4 py-6 sm:px-6 sm:py-8 md:px-8 md:py-10 flex items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/5 to-purple-600/5" />
      <div className="w-full max-w-[1440px] flex items-center justify-center relative z-10 px-4 sm:px-6">
        <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl p-8 sm:p-10 lg:p-16 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-indigo-500/5 to-purple-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-gradient-to-tr from-blue-500/5 to-cyan-500/5 rounded-full blur-2xl translate-y-1/2 -translate-x-1/2" />

          <div className="relative z-10 text-center space-y-8">
            <div className="flex items-center justify-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center text-white shadow-glow">
                <Box className="h-5 w-5" />
              </div>
              <h1 className="font-bold text-2xl tracking-tight text-slate-900">
                Gestiabloc
              </h1>
            </div>

            <div className="flex justify-center">
              <div className="w-20 h-20 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <MailCheck className="h-10 w-10" />
              </div>
            </div>

            <div className="space-y-3">
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
                Check your email to verify
              </h2>
              <p className="text-base sm:text-lg text-slate-500 max-w-md mx-auto">
                We sent a verification link to your admin email. Click it to
                activate your workspace.
              </p>
            </div>

            <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100 rounded-2xl p-6 text-left">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-indigo-500 rounded-xl flex items-center justify-center text-white flex-shrink-0">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-slate-900 mb-1">
                    Once verified, you&apos;re ready
                  </h3>
                  <p className="text-sm text-slate-600">
                    After verification you can sign in and start inviting your
                    team right away.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4 pt-2">
              <Button
                asChild
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-xl shadow-lg hover:shadow-indigo-500/30 transition-all duration-300 transform hover:-translate-y-0.5"
              >
                <Link href="/login">Go to sign in</Link>
              </Button>
            </div>
          </div>

          <div className="mt-10 text-center text-xs text-slate-400 relative z-10">
            © 2024 Gestiabloc Inc. All rights reserved.
          </div>
        </div>
      </div>
    </div>
  )
}
