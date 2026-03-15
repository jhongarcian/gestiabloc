"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { isAxiosError } from "axios"
import Link from "next/link"
import { BriefcaseBusiness, CheckCircle2, UserRoundCog } from "lucide-react"
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
    professionals: Array<{
      id: string
      kind: "INTERNAL_USER" | "EXTERNAL"
      userId: string | null
      externalProfessionalName: string | null
      externalContact: string | null
      notes: string | null
      sortOrder: number
    }>
  }
}

type UsersResponse = {
  ok: boolean
  items: Array<{
    id: string
    name: string
    email: string
  }>
}

type ServiceProfessionalsPanelProps = {
  tenantId: string
  tenantSlug: string
  initialServiceId?: string
}

export function ServiceProfessionalsPanel({
  tenantId,
  tenantSlug,
  initialServiceId,
}: ServiceProfessionalsPanelProps) {
  const [serviceOptions, setServiceOptions] = useState<ServiceOptionsResponse["items"]>([])
  const [selectedServiceId, setSelectedServiceId] = useState(initialServiceId ?? "")
  const [serviceName, setServiceName] = useState("")
  const [users, setUsers] = useState<UsersResponse["items"]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [professionals, setProfessionals] = useState<
    Array<{
      kind: "INTERNAL_USER" | "EXTERNAL"
      userId: string
      externalProfessionalName: string
      externalContact: string
      notes: string
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

  const loadUsers = useCallback(async () => {
    try {
      const { data } = await api.get<UsersResponse>(`/api/account-settings/${tenantId}/users`, {
        params: { page: 1, pageSize: 25 },
      })
      setUsers(data.items)
    } catch {
      setUsers([])
    }
  }, [tenantId])

  const loadServiceDetails = useCallback(async () => {
    if (!selectedServiceId) return

    setIsLoading(true)
    try {
      const { data } = await api.get<ServiceDetailsResponse>(
        `/api/account-settings/${tenantId}/services/${selectedServiceId}`,
      )

      setServiceName(data.service.name)
      setProfessionals(
        data.service.professionals.map((entry) => ({
          kind: entry.kind,
          userId: entry.userId ?? "",
          externalProfessionalName: entry.externalProfessionalName ?? "",
          externalContact: entry.externalContact ?? "",
          notes: entry.notes ?? "",
        })),
      )
    } catch {
      setServiceName("")
      setProfessionals([])
    } finally {
      setIsLoading(false)
    }
  }, [tenantId, selectedServiceId])

  useEffect(() => {
    void loadServiceOptions()
    void loadUsers()
  }, [loadServiceOptions, loadUsers])

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

  const internalCount = useMemo(
    () => professionals.filter((entry) => entry.kind === "INTERNAL_USER").length,
    [professionals],
  )

  const externalCount = useMemo(
    () => professionals.filter((entry) => entry.kind === "EXTERNAL").length,
    [professionals],
  )

  const onSave = async () => {
    if (!selectedServiceId) return

    setIsSaving(true)
    try {
      await api.patch(`/api/account-settings/${tenantId}/services/${selectedServiceId}`, {
        professionals: professionals.map((entry, index) => ({
          kind: entry.kind,
          userId: entry.kind === "INTERNAL_USER" ? entry.userId || null : null,
          externalProfessionalName:
            entry.kind === "EXTERNAL" ? entry.externalProfessionalName.trim() || null : null,
          externalContact:
            entry.kind === "EXTERNAL" ? entry.externalContact.trim() || null : null,
          notes: entry.notes.trim() || null,
          sortOrder: (index + 1) * 10,
        })),
      })

      toast.success("Professionals updated.")
      await loadServiceDetails()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not save professionals.",
        )
      } else {
        toast.error("Could not save professionals.")
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
                Professionals Setup
              </p>
              <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-slate-950">
                Assign the people who can execute each service.
              </h2>
              <p className="max-w-2xl text-sm leading-6 text-slate-600">
                Keep internal assignees and external specialists in one record so follow-up work is clear.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Services</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">{serviceOptions.length}</p>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Internal</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">{internalCount}</p>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">External</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">{externalCount}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-[24px] border border-slate-300/60 bg-slate-950 p-5 text-white shadow-sm">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/90">Current service</p>
              <p className="text-lg font-semibold">{serviceName || "Select a service"}</p>
              <p className="text-sm leading-6 text-slate-300">
                Configure professionals here, then continue in Follow Ups.
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
                <Link href={`/app/${tenantSlug}/account-settings/follow-ups?serviceId=${selectedServiceId}`}>
                  Go to follow ups
                </Link>
              </Button>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
                Keep this service aligned by finishing professionals and follow-up templates.
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
            <h3 className="text-lg font-semibold text-slate-900">Assigned professionals</h3>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!selectedServiceId}
              onClick={() =>
                setProfessionals((prev) => [
                  ...prev,
                  {
                    kind: "INTERNAL_USER",
                    userId: "",
                    externalProfessionalName: "",
                    externalContact: "",
                    notes: "",
                  },
                ])
              }
            >
              Add professional
            </Button>
          </div>

          {isLoading ? (
            <p className="text-sm text-slate-500">Loading...</p>
          ) : professionals.length ? (
            <div className="space-y-3">
              {professionals.map((entry, index) => (
                <article key={`${entry.kind}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="grid gap-3">
                    <div className="grid gap-2 md:grid-cols-2">
                      <Select
                        value={entry.kind}
                        onValueChange={(value) =>
                          setProfessionals((prev) => {
                            const next = [...prev]
                            next[index] = {
                              ...next[index],
                              kind: value as "INTERNAL_USER" | "EXTERNAL",
                              userId: value === "INTERNAL_USER" ? next[index].userId : "",
                              externalProfessionalName:
                                value === "EXTERNAL" ? next[index].externalProfessionalName : "",
                              externalContact: value === "EXTERNAL" ? next[index].externalContact : "",
                            }
                            return next
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Professional type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="INTERNAL_USER">Internal user</SelectItem>
                          <SelectItem value="EXTERNAL">External professional</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {entry.kind === "INTERNAL_USER" ? (
                      <Select
                        value={entry.userId || "__none__"}
                        onValueChange={(value) =>
                          setProfessionals((prev) => {
                            const next = [...prev]
                            next[index] = { ...next[index], userId: value === "__none__" ? "" : value }
                            return next
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select user" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Unassigned</SelectItem>
                          {users.map((user) => (
                            <SelectItem key={user.id} value={user.id}>
                              {user.name || user.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="grid gap-2 md:grid-cols-2">
                        <Input
                          placeholder="External professional name"
                          value={entry.externalProfessionalName}
                          onChange={(event) =>
                            setProfessionals((prev) => {
                              const next = [...prev]
                              next[index] = {
                                ...next[index],
                                externalProfessionalName: event.target.value,
                              }
                              return next
                            })
                          }
                        />
                        <Input
                          placeholder="External contact"
                          value={entry.externalContact}
                          onChange={(event) =>
                            setProfessionals((prev) => {
                              const next = [...prev]
                              next[index] = { ...next[index], externalContact: event.target.value }
                              return next
                            })
                          }
                        />
                      </div>
                    )}

                    <Textarea
                      rows={2}
                      placeholder="Notes"
                      value={entry.notes}
                      onChange={(event) =>
                        setProfessionals((prev) => {
                          const next = [...prev]
                          next[index] = { ...next[index], notes: event.target.value }
                          return next
                        })
                      }
                    />

                    <div className="flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() =>
                          setProfessionals((prev) => prev.filter((_, rowIndex) => rowIndex !== index))
                        }
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
              <p className="text-base font-medium text-slate-900">No professionals yet</p>
              <p className="mt-2 text-sm text-slate-500">Add at least one internal or external professional for this service.</p>
            </div>
          )}

          <div className="mt-5 flex justify-end">
            <Button type="button" onClick={onSave} disabled={!selectedServiceId || isSaving}>
              {isSaving ? "Saving..." : "Save professionals"}
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-slate-700">
          <BriefcaseBusiness className="h-4 w-4" />
          <p className="text-sm">
            {professionals.length > 0 ? (
              <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Professionals configured</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-700"><UserRoundCog className="h-4 w-4" /> Add professionals to complete this section</span>
            )}
          </p>
        </div>
      </section>
    </div>
  )
}
