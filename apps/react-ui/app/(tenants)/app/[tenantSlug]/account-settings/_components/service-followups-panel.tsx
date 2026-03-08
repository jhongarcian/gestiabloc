"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { isAxiosError } from "axios"
import Link from "next/link"
import { CheckCircle2, Clock3, Route, Users } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"

type ServiceOptionsResponse = {
  ok: boolean
  items: Array<{
    id: string
    name: string
    isActive: boolean
  }>
}

type ServiceDetailsResponse = {
  ok: boolean
  service: {
    id: string
    name: string
    followUpTemplateSteps: Array<{
      id: string
      title: string
      notesTemplate: string | null
      dueDaysFromStart: number
      sortOrder: number
    }>
  }
}

type ServiceFollowUpsPanelProps = {
  tenantId: string
  tenantSlug: string
  initialServiceId?: string
}

export function ServiceFollowUpsPanel({
  tenantId,
  tenantSlug,
  initialServiceId,
}: ServiceFollowUpsPanelProps) {
  const [serviceOptions, setServiceOptions] = useState<ServiceOptionsResponse["items"]>([])
  const [selectedServiceId, setSelectedServiceId] = useState(initialServiceId ?? "")
  const [serviceName, setServiceName] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [steps, setSteps] = useState<
    Array<{
      title: string
      notesTemplate: string
      dueDaysFromStart: string
    }>
  >([])

  const loadServiceOptions = useCallback(async () => {
    try {
      const { data } = await api.get<ServiceOptionsResponse>(
        `/api/account-settings/${tenantId}/services/options`,
        {
          params: { includeInactive: "true" },
        },
      )
      setServiceOptions(data.items)

      if (!data.items.length) {
        setSelectedServiceId("")
        return
      }

      const hasSelectedService = data.items.some((service) => service.id === selectedServiceId)
      if (!selectedServiceId || !hasSelectedService) {
        setSelectedServiceId(data.items[0].id)
      }
    } catch {
      setServiceOptions([])
    }
  }, [tenantId, selectedServiceId])

  const loadServiceDetails = useCallback(async () => {
    if (!selectedServiceId) return

    setIsLoading(true)
    try {
      const { data } = await api.get<ServiceDetailsResponse>(
        `/api/account-settings/${tenantId}/services/${selectedServiceId}`,
      )

      setServiceName(data.service.name)
      setSteps(
        data.service.followUpTemplateSteps.map((entry) => ({
          title: entry.title,
          notesTemplate: entry.notesTemplate ?? "",
          dueDaysFromStart: String(entry.dueDaysFromStart),
        })),
      )
    } catch {
      setServiceName("")
      setSteps([])
    } finally {
      setIsLoading(false)
    }
  }, [tenantId, selectedServiceId])

  useEffect(() => {
    void loadServiceOptions()
  }, [loadServiceOptions])

  useEffect(() => {
    void loadServiceDetails()
  }, [loadServiceDetails])

  const selectedServiceHref = useMemo(
    () =>
      selectedServiceId
        ? `/app/${tenantSlug}/account-settings/services/${selectedServiceId}`
        : `/app/${tenantSlug}/account-settings/services`,
    [tenantSlug, selectedServiceId],
  )

  const onSave = async () => {
    if (!selectedServiceId) return

    setIsSaving(true)
    try {
      await api.patch(`/api/account-settings/${tenantId}/services/${selectedServiceId}`, {
        followUpTemplateSteps: steps
          .filter((entry) => entry.title.trim())
          .map((entry, index) => ({
            title: entry.title.trim(),
            notesTemplate: entry.notesTemplate.trim() || null,
            dueDaysFromStart: Math.max(0, Number.parseInt(entry.dueDaysFromStart, 10) || 0),
            sortOrder: (index + 1) * 10,
          })),
      })

      toast.success("Follow-up template updated.")
      await loadServiceDetails()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not save follow-up template.",
        )
      } else {
        toast.error("Could not save follow-up template.")
      }
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_45%,#fff7ed_100%)]">
        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1.3fr)_360px] lg:p-7">
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                Follow-Up Builder
              </p>
              <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-slate-950">
                Define reusable steps your team follows after a service starts.
              </h2>
              <p className="max-w-2xl text-sm leading-6 text-slate-600">
                Each contact gets a copy of this template and can then be managed independently.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Services</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">{serviceOptions.length}</p>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Template steps</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">{steps.length}</p>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Current service</p>
                <p className="mt-2 text-sm font-semibold text-slate-950">{serviceName || "Not selected"}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-[24px] border border-slate-300/60 bg-slate-950 p-5 text-white shadow-sm">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200/90">Workflow links</p>
              <p className="text-sm leading-6 text-slate-300">
                Keep service setup aligned by moving between service detail and professionals.
              </p>
            </div>
            <div className="mt-6 space-y-2">
              <Button
                asChild
                type="button"
                className="w-full bg-white text-slate-950 hover:bg-slate-100"
              >
                <Link href={selectedServiceHref}>Open service detail</Link>
              </Button>
              <Button
                asChild
                type="button"
                variant="outline"
                className="w-full border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
              >
                <Link href={`/app/${tenantSlug}/account-settings/professionals?serviceId=${selectedServiceId}`}>
                  Go to professionals
                </Link>
              </Button>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
                Keep this service aligned by finishing follow-up templates and professional assignments.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-5">
          <div className="grid gap-2 md:max-w-md">
            <Label>Service</Label>
            <Select
              value={selectedServiceId || "__none__"}
              onValueChange={(value) => setSelectedServiceId(value === "__none__" ? "" : value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select service" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Select service</SelectItem>
                {serviceOptions.map((service) => (
                  <SelectItem key={service.id} value={service.id}>
                    {service.name}
                    {service.isActive ? "" : " (inactive)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">Follow-up template steps</h3>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!selectedServiceId}
              onClick={() =>
                setSteps((prev) => [
                  ...prev,
                  {
                    title: "",
                    notesTemplate: "",
                    dueDaysFromStart: "0",
                  },
                ])
              }
            >
              Add step
            </Button>
          </div>

          {isLoading ? (
            <p className="text-sm text-slate-500">Loading...</p>
          ) : steps.length ? (
            <div className="space-y-3">
              {steps.map((entry, index) => (
                <article key={`step-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="grid gap-3">
                    <div className="grid gap-2 md:grid-cols-2">
                      <Input
                        placeholder="Step title"
                        value={entry.title}
                        onChange={(event) =>
                          setSteps((prev) => {
                            const next = [...prev]
                            next[index] = { ...next[index], title: event.target.value }
                            return next
                          })
                        }
                      />
                      <Input
                        type="number"
                        min={0}
                        placeholder="Days from service start"
                        value={entry.dueDaysFromStart}
                        onChange={(event) =>
                          setSteps((prev) => {
                            const next = [...prev]
                            next[index] = { ...next[index], dueDaysFromStart: event.target.value }
                            return next
                          })
                        }
                      />
                    </div>
                    <Textarea
                      rows={2}
                      placeholder="Notes template"
                      value={entry.notesTemplate}
                      onChange={(event) =>
                        setSteps((prev) => {
                          const next = [...prev]
                          next[index] = { ...next[index], notesTemplate: event.target.value }
                          return next
                        })
                      }
                    />
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => setSteps((prev) => prev.filter((_, rowIndex) => rowIndex !== index))}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <p className="text-base font-medium text-slate-900">No steps yet</p>
              <p className="mt-2 text-sm text-slate-500">Add at least one follow-up template step for this service.</p>
            </div>
          )}

          <div className="mt-5 flex justify-end">
            <Button type="button" onClick={onSave} disabled={!selectedServiceId || isSaving}>
              {isSaving ? "Saving..." : "Save follow-up template"}
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3 text-sm text-slate-700">
          <Route className="h-4 w-4" />
          <span>{steps.length > 0 ? "Template ready to materialize per-contact follow-ups." : "Add template steps so each contact service process starts with a workflow."}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5"><Clock3 className="h-3.5 w-3.5" /> Due offsets</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5"><Users className="h-3.5 w-3.5" /> Per-contact copies</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5"><CheckCircle2 className="h-3.5 w-3.5" /> Editable after start</span>
        </div>
      </section>
    </div>
  )
}
