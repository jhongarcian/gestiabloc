"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { isAxiosError } from "axios"
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarClock,
  Check,
  CircleDot,
  ContactRound,
  Globe2,
  Layers3,
  Loader2,
  MapPin,
  PartyPopper,
  Phone,
  Route,
  Settings2,
  Sparkles,
  UserPlus,
} from "lucide-react"
import { toast } from "sonner"

import { AppPhoneInput } from "@/components/ui/phone-input"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

import { useOnboarding } from "./onboarding-provider"

const TIMEZONE_GROUPS = [
  {
    label: "North America",
    values: [
      "America/New_York",
      "America/Toronto",
      "America/Chicago",
      "America/Denver",
      "America/Phoenix",
      "America/Los_Angeles",
      "America/Anchorage",
      "Pacific/Honolulu",
      "America/Mexico_City",
    ],
  },
  {
    label: "South America",
    values: [
      "America/Bogota",
      "America/Lima",
      "America/Santiago",
      "America/Sao_Paulo",
      "America/Argentina/Buenos_Aires",
    ],
  },
  {
    label: "Europe",
    values: [
      "Europe/London",
      "Europe/Madrid",
      "Europe/Paris",
      "Europe/Berlin",
      "Europe/Rome",
      "Europe/Amsterdam",
      "Europe/Zurich",
    ],
  },
  {
    label: "Global",
    values: [
      "UTC",
      "Asia/Dubai",
      "Asia/Kolkata",
      "Asia/Singapore",
      "Asia/Tokyo",
      "Australia/Sydney",
      "Africa/Johannesburg",
    ],
  },
] as const

function getErrorMessage(error: unknown, fallback: string) {
  if (!isAxiosError(error)) return fallback
  const details = error.response?.data?.details
  if (Array.isArray(details) && typeof details[0]?.message === "string") {
    return details[0].message
  }
  const code = error.response?.data?.error
  return typeof code === "string"
    ? code.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
    : fallback
}

function StepHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <div className="max-w-2xl">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-700">
        {eyebrow}
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-4xl lg:text-5xl">
        {title}
      </h1>
      <p className="mt-4 text-base leading-7 text-slate-600 sm:text-lg">
        {description}
      </p>
    </div>
  )
}

function NavigationRow({
  backHref,
  nextLabel,
  onNext,
  isPending,
}: {
  backHref?: string
  nextLabel: string
  onNext: () => void
  isPending: boolean
}) {
  return (
    <div className="mt-8 flex flex-col-reverse gap-3 border-t border-slate-900/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
      {backHref ? (
        <Button asChild variant="ghost" className="justify-center gap-2 sm:justify-start">
          <Link href={backHref}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
      ) : (
        <span />
      )}
      <Button
        type="button"
        size="lg"
        className="gap-2 bg-[#0b1730] px-6 text-white shadow-lg shadow-slate-900/10 hover:bg-[#162747]"
        onClick={onNext}
        disabled={isPending}
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {nextLabel}
        {!isPending ? <ArrowRight className="h-4 w-4" /> : null}
      </Button>
    </div>
  )
}

export function WelcomeStep() {
  const router = useRouter()
  const { adminName, tenantSlug, isMutating, changeState } = useOnboarding()
  const firstName = adminName.trim().split(/\s+/)[0] || "there"

  const continueSetup = async () => {
    try {
      await changeState({ action: "advance", step: "business-profile" })
      router.push(`/onboarding/${tenantSlug}/business-profile`)
    } catch {
      toast.error("We could not start the setup guide.")
    }
  }

  const cards = [
    {
      icon: Building2,
      title: "Shape the workspace",
      description: "Add the business details your team will see and use.",
    },
    {
      icon: Route,
      title: "Review the workflow",
      description: "See the statuses and sales stages already prepared for you.",
    },
    {
      icon: Sparkles,
      title: "Start with confidence",
      description: "Leave with a clear next move, without blocking access.",
    },
  ]

  return (
    <div>
      <StepHeading
        eyebrow={`Welcome, ${firstName}`}
        title="Let’s make this workspace feel like yours."
        description="The essentials are already in place. This short guide helps you personalize them now—or you can leave and return whenever it suits you."
      />

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {cards.map((card, index) => (
          <article
            key={card.title}
            className={cn(
              "rounded-2xl border border-slate-900/10 bg-white/80 p-5 shadow-sm backdrop-blur",
              index === 1 && "md:-translate-y-3",
            )}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-800">
              <card.icon className="h-5 w-5" />
            </span>
            <h2 className="mt-5 font-semibold text-slate-950">{card.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {card.description}
            </p>
          </article>
        ))}
      </div>

      <NavigationRow
        nextLabel="Start setup"
        onNext={continueSetup}
        isPending={isMutating}
      />
    </div>
  )
}

type ProfileForm = {
  name: string
  email: string
  phone: string
  website: string
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  postalCode: string
  country: string
  timezone: string
}

export function BusinessProfileStep() {
  const router = useRouter()
  const { data, tenantSlug, isMutating, saveProfile, changeState } = useOnboarding()
  const [form, setForm] = useState<ProfileForm>(() =>
    Object.fromEntries(
      Object.entries(data.profile)
        .filter(([key]) => key !== "id" && key !== "slug")
        .map(([key, value]) => [key, value ?? ""]),
    ) as ProfileForm,
  )
  const [now, setNow] = useState(() => new Date())
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const timezonePreview = useMemo(() => {
    try {
      return new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        ...(form.timezone ? { timeZone: form.timezone } : {}),
      }).format(now)
    } catch {
      return "Choose a supported timezone"
    }
  }, [form.timezone, now])

  const setField = (key: keyof ProfileForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const saveAndContinue = async () => {
    if (!form.name.trim()) {
      setErrorMessage("Business name is required.")
      return
    }

    setErrorMessage(null)
    try {
      await saveProfile({
        name: form.name,
        email: form.email || null,
        phone: form.phone || null,
        website: form.website || null,
        addressLine1: form.addressLine1 || null,
        addressLine2: form.addressLine2 || null,
        city: form.city || null,
        state: form.state || null,
        postalCode: form.postalCode || null,
        country: form.country || null,
        timezone: form.timezone || null,
      })
      await changeState({ action: "advance", step: "workflow" })
      toast.success("Business profile saved.")
      router.push(`/onboarding/${tenantSlug}/workflow`)
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "Could not save the business profile."))
    }
  }

  return (
    <div>
      <StepHeading
        eyebrow="Business profile"
        title="Put your business on the map."
        description="Only the business name is required. Add what is useful now and leave the rest for Account Settings later."
      />

      <div className="mt-8 grid gap-6 rounded-3xl border border-slate-900/10 bg-white/85 p-5 shadow-sm sm:p-7 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="onboarding-name">Business name</Label>
            <div className="relative">
              <Building2 className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <Input
                id="onboarding-name"
                className="pl-10"
                value={form.name}
                onChange={(event) => setField("name", event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="onboarding-email">Business email</Label>
            <Input
              id="onboarding-email"
              type="email"
              value={form.email}
              onChange={(event) => setField("email", event.target.value)}
              placeholder="hello@company.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="onboarding-phone">Phone</Label>
            <AppPhoneInput
              id="onboarding-phone"
              defaultCountry="US"
              international
              countryCallingCodeEditable={false}
              value={form.phone || undefined}
              onChange={(value) => setField("phone", value ?? "")}
              placeholder="+1 000 000 0000"
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="onboarding-website">Website</Label>
            <div className="relative">
              <Globe2 className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <Input
                id="onboarding-website"
                className="pl-10"
                value={form.website}
                onChange={(event) => setField("website", event.target.value)}
                placeholder="yourcompany.com"
              />
            </div>
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="onboarding-address">Street address</Label>
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <Input
                id="onboarding-address"
                className="pl-10"
                value={form.addressLine1}
                onChange={(event) => setField("addressLine1", event.target.value)}
                placeholder="123 Main Street"
              />
            </div>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="onboarding-address-2">Suite or unit</Label>
            <Input
              id="onboarding-address-2"
              value={form.addressLine2}
              onChange={(event) => setField("addressLine2", event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="onboarding-city">City</Label>
            <Input
              id="onboarding-city"
              value={form.city}
              onChange={(event) => setField("city", event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="onboarding-state">State or region</Label>
            <Input
              id="onboarding-state"
              value={form.state}
              onChange={(event) => setField("state", event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="onboarding-postal">Postal code</Label>
            <Input
              id="onboarding-postal"
              value={form.postalCode}
              onChange={(event) => setField("postalCode", event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="onboarding-country">Country</Label>
            <Input
              id="onboarding-country"
              value={form.country}
              onChange={(event) => setField("country", event.target.value)}
            />
          </div>
        </div>

        <aside className="rounded-2xl bg-[#0b1730] p-5 text-white">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-blue-100">
            <CalendarClock className="h-5 w-5" />
          </span>
          <h2 className="mt-5 font-semibold">Local business time</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Dates, reminders, and calendar availability use this timezone.
          </p>

          <div className="mt-5 space-y-2">
            <Label htmlFor="onboarding-timezone" className="text-slate-200">
              Timezone
            </Label>
            <Select
              value={form.timezone || undefined}
              onValueChange={(value) => setField("timezone", value)}
            >
              <SelectTrigger id="onboarding-timezone" className="w-full border-white/15 bg-white/10 text-white">
                <SelectValue placeholder="Select timezone" />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONE_GROUPS.map((group) => (
                  <SelectGroup key={group.label}>
                    <SelectLabel>{group.label}</SelectLabel>
                    {group.values.map((timezone) => (
                      <SelectItem key={timezone} value={timezone}>
                        {timezone}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="mt-5 rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200">
              Preview
            </p>
            <p className="mt-2 text-sm font-medium">{timezonePreview}</p>
          </div>
        </aside>
      </div>

      {errorMessage ? (
        <p className="mt-4 text-sm font-medium text-red-700" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <NavigationRow
        backHref={`/onboarding/${tenantSlug}/welcome`}
        nextLabel="Save and review workflow"
        onNext={saveAndContinue}
        isPending={isMutating}
      />
    </div>
  )
}

export function WorkflowStep() {
  const router = useRouter()
  const { data, tenantSlug, isMutating, saveWorkflow, changeState } = useOnboarding()
  const [pipelineName, setPipelineName] = useState(data.defaults.pipeline.name)
  const [stages, setStages] = useState(() => data.defaults.pipeline.stages)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const saveAndContinue = async () => {
    if (!pipelineName.trim() || stages.some((stage) => !stage.name.trim())) {
      setErrorMessage("Pipeline and stage names cannot be empty.")
      return
    }

    setErrorMessage(null)
    try {
      await saveWorkflow({
        pipelineId: data.defaults.pipeline.id,
        name: pipelineName,
        stages: stages.map(({ id, name }) => ({ id, name })),
      })
      await changeState({ action: "advance", step: "ready" })
      toast.success("Starter workflow saved.")
      router.push(`/onboarding/${tenantSlug}/ready`)
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "Could not save the workflow."))
    }
  }

  return (
    <div>
      <StepHeading
        eyebrow="Workflow defaults"
        title="A practical starting rhythm."
        description="Contacts, tasks, and opportunities already have sensible defaults. Review them here and lightly tailor your opportunity pipeline."
      />

      <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,.9fr)]">
        <section className="rounded-3xl border border-slate-900/10 bg-white/85 p-5 shadow-sm sm:p-7">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800">
              <Layers3 className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-semibold text-slate-950">Prepared statuses</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                These system defaults protect the basic lifecycle. Add custom
                statuses later when your process calls for them.
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-5">
            <StatusPreview
              icon={ContactRound}
              label="Contacts"
              statuses={data.defaults.contactStatuses}
            />
            <StatusPreview
              icon={CircleDot}
              label="Tasks"
              statuses={data.defaults.taskStatuses}
            />
          </div>

          <Button asChild variant="outline" className="mt-6 gap-2 bg-transparent">
            <Link href={`/app/${tenantSlug}/account-settings/status-config`}>
              <Settings2 className="h-4 w-4" />
              Advanced status settings
            </Link>
          </Button>
        </section>

        <section className="rounded-3xl border border-slate-900/10 bg-[#e9edf8] p-5 sm:p-7">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-700">
                Starter pipeline
              </p>
              <h2 className="mt-1 font-semibold text-slate-950">Opportunity flow</h2>
            </div>
            <span
              className="h-4 w-4 rounded-full border-2 border-white shadow-sm"
              style={{ backgroundColor: data.defaults.pipeline.color }}
            />
          </div>

          <div className="mt-5 space-y-2">
            <Label htmlFor="pipeline-name">Pipeline name</Label>
            <Input
              id="pipeline-name"
              value={pipelineName}
              onChange={(event) => setPipelineName(event.target.value)}
              className="border-slate-900/10 bg-white"
            />
          </div>

          <div className="mt-5 space-y-3">
            <Label>Stages</Label>
            {stages.map((stage, index) => (
              <div key={stage.id} className="flex items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0b1730] text-[11px] font-bold text-white">
                  {index + 1}
                </span>
                <Input
                  value={stage.name}
                  aria-label={`Stage ${index + 1} name`}
                  className="border-slate-900/10 bg-white"
                  onChange={(event) => {
                    const name = event.target.value
                    setStages((current) =>
                      current.map((item) =>
                        item.id === stage.id ? { ...item, name } : item,
                      ),
                    )
                  }}
                />
              </div>
            ))}
          </div>
        </section>
      </div>

      {errorMessage ? (
        <p className="mt-4 text-sm font-medium text-red-700" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <NavigationRow
        backHref={`/onboarding/${tenantSlug}/business-profile`}
        nextLabel="Save and see summary"
        onNext={saveAndContinue}
        isPending={isMutating}
      />
    </div>
  )
}

function StatusPreview({
  icon: Icon,
  label,
  statuses,
}: {
  icon: typeof ContactRound
  label: string
  statuses: Array<{
    id: string
    name: string
    bgColor: string
    textColor: string
  }>
}) {
  return (
    <div>
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {statuses.map((status) => (
          <span
            key={status.id}
            className="rounded-full px-3 py-1.5 text-xs font-semibold"
            style={{ backgroundColor: status.bgColor, color: status.textColor }}
          >
            {status.name}
          </span>
        ))}
      </div>
    </div>
  )
}

export function ReadyStep() {
  const router = useRouter()
  const { data, tenantSlug, isMutating, changeState } = useOnboarding()
  const isComplete = data.onboarding.status === "COMPLETED"
  const profileReady = Boolean(data.profile.name && data.profile.timezone)

  const finish = async () => {
    if (isComplete) {
      router.push(`/app/${tenantSlug}`)
      return
    }

    try {
      await changeState({ action: "complete" })
      toast.success("Your workspace is ready.")
      router.push(`/app/${tenantSlug}`)
      router.refresh()
    } catch {
      toast.error("We could not complete workspace setup.")
    }
  }

  const summary = [
    {
      icon: Building2,
      label: "Business profile",
      value: profileReady ? "Core details ready" : "Ready to refine later",
      ready: profileReady,
    },
    {
      icon: Route,
      label: "Workflow",
      value: `${data.defaults.pipeline.stages.length} opportunity stages`,
      ready: true,
    },
    {
      icon: Phone,
      label: "Contact lifecycle",
      value: `${data.defaults.contactStatuses.length} prepared statuses`,
      ready: true,
    },
  ]

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div>
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-200 text-emerald-950 shadow-sm">
          <PartyPopper className="h-7 w-7" />
        </span>
        <StepHeading
          eyebrow={isComplete ? "Setup reviewed" : "Ready to work"}
          title={isComplete ? "Your workspace is in good shape." : "Your foundation is ready."}
          description="The operational basics are in place. You can begin with contacts and tasks now, then deepen the setup as your team settles in."
        />

        <div className="mt-8 space-y-3">
          {summary.map((item) => (
            <div
              key={item.label}
              className="flex items-center gap-4 rounded-2xl border border-slate-900/10 bg-white/80 p-4"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                <item.icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-950">{item.label}</p>
                <p className="mt-0.5 text-sm text-slate-600">{item.value}</p>
              </div>
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full",
                  item.ready
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-amber-100 text-amber-800",
                )}
              >
                <Check className="h-4 w-4" />
              </span>
            </div>
          ))}
        </div>

        <NavigationRow
          backHref={`/onboarding/${tenantSlug}/workflow`}
          nextLabel={isComplete ? "Return to dashboard" : "Complete setup"}
          onNext={finish}
          isPending={isMutating}
        />
      </div>

      <aside className="rounded-3xl bg-[#0b1730] p-6 text-white shadow-xl shadow-slate-900/15 lg:sticky lg:top-8">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200">
          Good next moves
        </p>
        <div className="mt-5 space-y-3">
          <NextMove
            href={`/app/${tenantSlug}/account-settings/services`}
            icon={Sparkles}
            label="Add your first service"
            detail={
              data.readiness.serviceCount > 0
                ? `${data.readiness.serviceCount} already configured`
                : "Define what your team delivers"
            }
          />
          <NextMove
            href={`/app/${tenantSlug}/account-settings/users`}
            icon={UserPlus}
            label="Invite a teammate"
            detail={
              data.readiness.memberCount > 1
                ? `${data.readiness.memberCount} active members`
                : "Bring your team into the workspace"
            }
          />
          <NextMove
            href={`/app/${tenantSlug}/calendar`}
            icon={CalendarClock}
            label="Review the calendar"
            detail="Set availability when you are ready"
          />
        </div>
      </aside>
    </div>
  )
}

function NextMove({
  href,
  icon: Icon,
  label,
  detail,
}: {
  href: string
  icon: typeof Sparkles
  label: string
  detail: string
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3 transition hover:border-white/20 hover:bg-white/10"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-blue-100">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-slate-400">
          {detail}
        </span>
      </span>
      <ArrowRight className="h-4 w-4 text-slate-500 transition group-hover:translate-x-0.5 group-hover:text-white" />
    </Link>
  )
}
