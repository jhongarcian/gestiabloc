import type { Metadata } from "next"
import Link from "next/link"
import { Fraunces, Manrope } from "next/font/google"
import {
  ArrowRight,
  BadgeCheck,
  CalendarRange,
  ChartColumnIncreasing,
  CircleCheckBig,
  ShieldCheck,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { subscriptionPlans } from "@/lib/subscription-plans"

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-public-display",
})

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-public-body",
})

const operationalPillars = [
  {
    title: "One record per client, not one record per app",
    description:
      "Bring contacts, conversations, services, follow-ups, and tasks into a single operating view for your agency team.",
    icon: BadgeCheck,
  },
  {
    title: "Follow-up systems that do not rely on memory",
    description:
      "Build repeatable flows for renewals, onboarding, and service delivery without chasing spreadsheets or loose reminders.",
    icon: CalendarRange,
  },
  {
    title: "Subscription plans matched to real team size",
    description:
      "Start on the right plan, onboard your staff, and expand seat capacity as your CRM operation becomes more structured.",
    icon: ChartColumnIncreasing,
  },
]

const trustMarkers = [
  "Multi-tenant by design",
  "Role and security-level controls",
  "Pipelines, calendars, and follow-up automation",
  "Built for service and agency operations",
]

const compactFeatureGroups: Record<string, string[]> = {
  STARTER: [
    "Tasks, calendar, notifications, and assignments",
    "Comments, attachments, and basic reporting",
    "Mobile-friendly workspace with AI assistance",
  ],
  PRO: [
    "Everything in Basic, plus advanced task control",
    "Department organization, live updates, and audit history",
    "Advanced reporting with exports and stronger AI capacity",
  ],
  BUSINESS: [
    "Everything in Pro, plus multi-team management",
    "Advanced permissions, analytics, API access, and webhooks",
    "Priority infrastructure, onboarding, and custom workflow support",
  ],
}

export const metadata: Metadata = {
  title: "CRM For Agencies",
  description:
    "A clean CRM for agencies that need contact history, team workflows, and subscription-based onboarding in one place.",
}

export default function HomePage() {
  return (
    <main
      className={`${fraunces.variable} ${manrope.variable} min-h-screen bg-[linear-gradient(180deg,#f8f5ee_0%,#f3efe7_48%,#fcfbf8_100%)] text-stone-900`}
    >
      <div className="relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,_rgba(180,140,60,0.16),_transparent_62%)]" />
        <div className="absolute left-[-8rem] top-28 h-56 w-56 rounded-full border border-amber-500/20" />
        <div className="absolute right-[-5rem] top-40 h-40 w-40 rounded-full bg-stone-900/4 blur-3xl" />

        <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-6 md:px-10 lg:px-12">
          <header className="flex items-center justify-between rounded-full border border-stone-900/10 bg-white/70 px-4 py-3 backdrop-blur md:px-6">
            <Link href="/" className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-stone-900 text-sm font-semibold text-stone-50">
                G
              </div>
              <div>
                <p className="text-sm font-semibold tracking-[0.2em] text-stone-500 uppercase">
                  Gestiabloc
                </p>
                <p className="text-xs text-stone-500">CRM for agencies</p>
              </div>
            </Link>

            <nav className="hidden items-center gap-8 text-sm text-stone-600 md:flex">
              <a href="#product" className="transition hover:text-stone-900">
                Product
              </a>
              <a href="#pricing" className="transition hover:text-stone-900">
                Pricing
              </a>
              <Link href="/login" className="transition hover:text-stone-900">
                Sign in
              </Link>
            </nav>

            <div className="flex items-center gap-2">
              <Button
                asChild
                variant="ghost"
                className="hidden rounded-full px-5 text-stone-700 hover:bg-stone-900/5 hover:text-stone-900 md:inline-flex"
              >
                <Link href="/login">Sign in</Link>
              </Button>
              <Button
                asChild
                className="rounded-full bg-stone-900 px-5 text-stone-50 hover:bg-stone-800"
              >
                <Link href="/signup">Start free trial</Link>
              </Button>
            </div>
          </header>

          <section className="grid flex-1 items-center gap-14 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:py-20">
            <div className="max-w-3xl">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-700/15 bg-white/75 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-stone-600 backdrop-blur">
                <ShieldCheck className="h-4 w-4 text-amber-700" />
                Built for service-led growth
              </div>

              <h1 className="font-[family:var(--font-public-display)] text-5xl leading-[0.95] tracking-tight text-stone-950 md:text-6xl lg:text-7xl">
                The CRM for agencies that run on follow-up, not friction.
              </h1>

              <p className="mt-6 max-w-2xl font-[family:var(--font-public-body)] text-lg leading-8 text-stone-600 md:text-xl">
                Gestiabloc gives service-driven teams a clean public entry
                point, a structured signup flow, and subscription plans aligned
                with how many people actually need to work inside the CRM.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button
                  asChild
                  className="h-12 rounded-full bg-stone-900 px-6 text-base text-stone-50 hover:bg-stone-800"
                >
                  <Link href="/signup">
                    Start free trial
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="h-12 rounded-full border-stone-300 bg-white/75 px-6 text-base text-stone-900 hover:bg-white"
                >
                  <Link href="/login">Sign in to your workspace</Link>
                </Button>
              </div>

              <div className="mt-10 grid gap-3 sm:grid-cols-2">
                {trustMarkers.map((marker) => (
                  <div
                    key={marker}
                    className="flex items-center gap-3 rounded-2xl border border-stone-900/8 bg-white/60 px-4 py-3 text-sm text-stone-700"
                  >
                    <CircleCheckBig className="h-4 w-4 text-amber-700" />
                    <span>{marker}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative">
              <div className="absolute inset-x-12 top-10 h-24 rounded-full bg-amber-300/25 blur-3xl" />
              <div className="relative overflow-hidden rounded-[2rem] border border-stone-900/10 bg-white/85 p-5 shadow-[0_24px_80px_rgba(55,46,32,0.12)] backdrop-blur">
                <div className="rounded-[1.75rem] bg-stone-950 p-6 text-stone-50">
                  <p className="text-xs uppercase tracking-[0.24em] text-stone-400">
                    What Gestiabloc Covers
                  </p>
                  <h2 className="mt-3 font-[family:var(--font-public-display)] text-3xl leading-tight">
                    A cleaner operating system for agencies and service teams.
                  </h2>

                  <div className="mt-8 space-y-6">
                    <div className="border-t border-white/10 pt-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
                        Operations
                      </p>
                      <p className="mt-2 text-sm leading-7 text-stone-300">
                        Manage contacts, tasks, scheduling, follow-ups, and day-to-day
                        execution from one workspace instead of spreading work across
                        disconnected tools.
                      </p>
                    </div>

                    <div className="border-t border-white/10 pt-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
                        Team Collaboration
                      </p>
                      <p className="mt-2 text-sm leading-7 text-stone-300">
                        Keep assignments, comments, files, permissions, and visibility
                        aligned so teams can coordinate without losing context.
                      </p>
                    </div>

                    <div className="border-t border-white/10 pt-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
                        Plans
                      </p>
                      <div className="mt-3 space-y-2 text-sm text-stone-300">
                        {subscriptionPlans.map((plan) => (
                          <div
                            key={plan.key}
                            className="flex items-center justify-between gap-4"
                          >
                            <span>
                              {plan.name} · {plan.seatLimit} seats
                            </span>
                            <span className="text-stone-400">{plan.monthlyPrice}/mo</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="border-t border-white/10 pt-5">
                      <p className="text-sm leading-7 text-stone-300">
                        Start with the plan that fits your team, create the workspace,
                        verify the admin account, and move into the CRM without a noisy
                        onboarding experience.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      <section id="product" className="mx-auto max-w-7xl px-6 pb-10 md:px-10 lg:px-12">
        <div className="grid gap-5 lg:grid-cols-3">
          {operationalPillars.map((pillar) => {
            const Icon = pillar.icon
            return (
              <article
                key={pillar.title}
                className="rounded-[2rem] border border-stone-900/8 bg-white/75 p-7 shadow-[0_10px_30px_rgba(55,46,32,0.05)]"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-800">
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="mt-6 font-[family:var(--font-public-display)] text-3xl leading-tight text-stone-950">
                  {pillar.title}
                </h2>
                <p className="mt-4 font-[family:var(--font-public-body)] text-base leading-7 text-stone-600">
                  {pillar.description}
                </p>
              </article>
            )
          })}
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-7xl px-6 py-16 md:px-10 lg:px-12">
        <div className="mb-10 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-stone-500">
              Pricing
            </p>
            <h2 className="mt-3 font-[family:var(--font-public-display)] text-4xl leading-tight text-stone-950 md:text-5xl">
              Three plans. Clear seat limits. One signup path.
            </h2>
          </div>
          <p className="max-w-xl font-[family:var(--font-public-body)] text-base leading-7 text-stone-600">
            Pick the plan that fits the size of your agency today, then create
            a workspace with the right operating capacity from the first login.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {subscriptionPlans.map((plan) => (
            <article
              key={plan.key}
              className={`rounded-[2rem] border p-7 ${
                plan.featured
                  ? "border-stone-900 bg-stone-900 text-stone-50 shadow-[0_20px_50px_rgba(38,33,23,0.22)]"
                  : "border-stone-900/10 bg-white/80 text-stone-900"
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-stone-500">
                    {plan.key}
                  </p>
                  <h3 className="mt-3 font-[family:var(--font-public-display)] text-4xl">
                    {plan.name}
                  </h3>
                </div>
                {plan.featured ? (
                  <span className="rounded-full border border-white/15 px-3 py-1 text-xs uppercase tracking-[0.2em] text-stone-300">
                    Most chosen
                  </span>
                ) : null}
              </div>

              <p
                className={`mt-4 text-sm leading-6 ${
                  plan.featured ? "text-stone-300" : "text-stone-600"
                }`}
              >
                {plan.audience}
              </p>

              <div className="mt-7 flex items-end gap-2">
                <span className="text-5xl font-semibold">{plan.monthlyPrice}</span>
                <span
                  className={`pb-2 text-sm ${
                    plan.featured ? "text-stone-300" : "text-stone-500"
                  }`}
                >
                  / month
                </span>
              </div>

              <p
                className={`mt-3 text-sm leading-6 ${
                  plan.featured ? "text-stone-300" : "text-stone-600"
                }`}
              >
                {plan.description}
              </p>

              <div className="mt-7 grid grid-cols-3 gap-3">
                {[
                  ["Seats", String(plan.seatLimit)],
                  ["AI", plan.aiUsage.replace("Up to ", "").replace(" per month", "")],
                  ["Storage", plan.storage.replace(" included", "")],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="border-t border-current/10 pt-3"
                  >
                    <p
                      className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${
                        plan.featured ? "text-stone-400" : "text-stone-500"
                      }`}
                    >
                      {label}
                    </p>
                    <p className="mt-2 text-sm font-semibold">{value}</p>
                  </div>
                ))}
              </div>

              <div className={`mt-7 border-t ${plan.featured ? "border-white/10" : "border-stone-900/10"} pt-6`}>
                <p
                  className={`text-xs font-semibold uppercase tracking-[0.18em] ${
                    plan.featured ? "text-stone-300" : "text-stone-500"
                  }`}
                >
                  Includes
                </p>
              </div>

              <ul className="mt-4 space-y-3">
                {compactFeatureGroups[plan.key].map((feature) => (
                  <li key={feature} className="flex items-start gap-3 text-sm">
                    <CircleCheckBig
                      className={`mt-0.5 h-4 w-4 shrink-0 ${
                        plan.featured ? "text-amber-300" : "text-amber-700"
                      }`}
                    />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <div className={`mt-8 border-t ${plan.featured ? "border-white/10" : "border-stone-900/10"} pt-6`}>
                <div className="space-y-3 text-sm">
                  <p className={plan.featured ? "text-stone-300" : "text-stone-600"}>
                    <span className="font-semibold text-current">AI Usage:</span>{" "}
                    {plan.aiUsage}
                  </p>
                  <p className={plan.featured ? "text-stone-300" : "text-stone-600"}>
                    <span className="font-semibold text-current">Storage:</span>{" "}
                    {plan.storage}
                  </p>
                  <p className={plan.featured ? "text-stone-300" : "text-stone-600"}>
                    <span className="font-semibold text-current">Support:</span>{" "}
                    {plan.support}
                  </p>
                </div>
              </div>

              <div className={`mt-8 border-t ${plan.featured ? "border-white/10" : "border-stone-900/10"} pt-6`}>
                <p
                  className={`text-xs font-semibold uppercase tracking-[0.18em] ${
                    plan.featured ? "text-stone-300" : "text-stone-500"
                  }`}
                >
                  Ideal For
                </p>
                <ul className="mt-3 space-y-2">
                  {plan.idealFor.slice(0, 3).map((item) => (
                    <li
                      key={item}
                      className={`text-sm ${
                        plan.featured ? "text-stone-300" : "text-stone-600"
                      }`}
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <Button
                asChild
                className={`mt-8 h-12 w-full rounded-full text-base ${
                  plan.featured
                    ? "bg-[#efe8da] text-stone-900 hover:bg-[#e6ddcc]"
                    : "bg-stone-900 text-stone-50 hover:bg-stone-800"
                }`}
              >
                <Link href={`/signup?plan=${plan.key}`}>
                  Choose {plan.name}
                </Link>
              </Button>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16 md:px-10 lg:px-12">
        <div className="rounded-[2.5rem] bg-stone-900 px-8 py-10 text-stone-50 md:px-12 md:py-14">
          <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="max-w-2xl">
              <p className="text-sm uppercase tracking-[0.24em] text-stone-400">
                Start the public funnel
              </p>
              <h2 className="mt-4 font-[family:var(--font-public-display)] text-4xl leading-tight md:text-5xl">
                Let visitors choose a plan, create a workspace, and move into
                your CRM with less friction.
              </h2>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                asChild
                className="h-12 rounded-full bg-[#efe8da] px-6 text-base text-stone-900 hover:bg-[#ddd2be]"
              >
                <Link href="/signup">Create workspace</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="h-12 rounded-full border-white/20 bg-transparent px-6 text-base text-stone-50 hover:bg-white/10"
              >
                <Link href="/login">Open existing account</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
