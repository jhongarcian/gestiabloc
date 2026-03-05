"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { isAxiosError } from "axios"
import { AlertTriangle, CheckCircle2, Route, Save, Users } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"

type ServiceDetailsPanelProps = {
  tenantId: string
  tenantSlug: string
  service: {
    id: string
    name: string
    description: string | null
    basePriceCents: number
    currency: string
    allowPartialPayments: boolean
    minimumPartialPaymentCents: number | null
    isActive: boolean
    checklistItems: Array<{
      id: string
      label: string
      isRequired: boolean
      sortOrder: number
    }>
    configStatus: {
      checklistComplete: boolean
      followUpsComplete: boolean
      professionalsComplete: boolean
      isComplete: boolean
    }
  }
}

function centsToDollars(value: number) {
  return (value / 100).toFixed(2)
}

function dollarsToCents(value: string) {
  const numericValue = Number.parseFloat(value)
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return null
  }

  return Math.round(numericValue * 100)
}

export function ServiceDetailsPanel({ tenantId, tenantSlug, service }: ServiceDetailsPanelProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [name, setName] = useState(service.name)
  const [description, setDescription] = useState(service.description ?? "")
  const [basePrice, setBasePrice] = useState(centsToDollars(service.basePriceCents))
  const [currency, setCurrency] = useState(service.currency)
  const [allowPartialPayments, setAllowPartialPayments] = useState(service.allowPartialPayments)
  const [minimumPartialPayment, setMinimumPartialPayment] = useState(
    service.minimumPartialPaymentCents !== null
      ? centsToDollars(service.minimumPartialPaymentCents)
      : "",
  )
  const [isActive, setIsActive] = useState(service.isActive)
  const [checklistItems, setChecklistItems] = useState(
    service.checklistItems.map((item) => ({
      id: item.id,
      label: item.label,
      isRequired: item.isRequired,
    })),
  )

  const checklistComplete = checklistItems.some((item) => item.label.trim())
  const isComplete = useMemo(
    () => checklistComplete && service.configStatus.followUpsComplete && service.configStatus.professionalsComplete,
    [checklistComplete, service.configStatus.followUpsComplete, service.configStatus.professionalsComplete],
  )

  const onSubmit = async () => {
    const basePriceCents = dollarsToCents(basePrice)
    if (!name.trim()) {
      toast.error("Service name is required.")
      return
    }

    if (basePriceCents === null) {
      toast.error("Base price must be a valid positive number.")
      return
    }

    const minimumPartialPaymentCents = allowPartialPayments
      ? dollarsToCents(minimumPartialPayment)
      : null

    if (allowPartialPayments && minimumPartialPaymentCents === null) {
      toast.error("Minimum partial payment must be a valid number.")
      return
    }

    if (
      allowPartialPayments &&
      minimumPartialPaymentCents !== null &&
      minimumPartialPaymentCents > basePriceCents
    ) {
      toast.error("Minimum partial payment cannot exceed base price.")
      return
    }

    setIsSubmitting(true)

    try {
      await api.patch(`/api/account-settings/${tenantId}/services/${service.id}`, {
        name: name.trim(),
        description: description.trim() || null,
        basePriceCents,
        currency: currency.trim().toUpperCase() || "USD",
        allowPartialPayments,
        minimumPartialPaymentCents,
        isActive,
        checklistItems: checklistItems
          .filter((item) => item.label.trim())
          .map((item, index) => ({
            label: item.label.trim(),
            isRequired: item.isRequired,
            sortOrder: (index + 1) * 10,
          })),
      })

      toast.success("Service updated.")
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not update service.",
        )
      } else {
        toast.error("Could not update service.")
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_45%,#fff7ed_100%)] p-5 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Service Setup</p>
            <h2 className="text-2xl font-semibold text-slate-950">{service.name}</h2>
            <p className="text-sm text-slate-600">Configure service core details and checklist here.</p>
          </div>
          <div className="flex items-center gap-2">
            {isComplete ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                Complete
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                <AlertTriangle className="h-4 w-4" />
                Incomplete
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-[20px] border border-slate-200 bg-white p-5">
        <h3 className="text-lg font-semibold text-slate-900">Core Settings</h3>
        <div className="mt-4 grid gap-4">
          <div className="grid gap-2">
            <Label>Service name</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Description</Label>
            <Textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <div className="grid gap-2 md:col-span-2">
              <Label>Base price</Label>
              <Input type="number" min={0} step="0.01" value={basePrice} onChange={(event) => setBasePrice(event.target.value)} />
            </div>
            <div className="grid gap-2 md:col-span-1">
              <Label>Currency</Label>
              <Input maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
            </div>
            <div className="grid gap-2 md:col-span-1">
              <Label>Status</Label>
              <select
                className="h-10 rounded-md border border-slate-200 px-3"
                value={isActive ? "active" : "inactive"}
                onChange={(event) => setIsActive(event.target.value === "active")}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[auto_1fr] md:items-end">
            <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={allowPartialPayments}
                onChange={(event) => setAllowPartialPayments(event.target.checked)}
              />
              Allow partial payments
            </label>
            <div className="grid gap-2">
              <Label>Minimum partial payment</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                disabled={!allowPartialPayments}
                value={minimumPartialPayment}
                onChange={(event) => setMinimumPartialPayment(event.target.value)}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[20px] border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">Checklist</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setChecklistItems((prev) => [...prev, { id: `new-${Date.now()}`, label: "", isRequired: true }])
            }
          >
            Add item
          </Button>
        </div>

        <div className="mt-4 space-y-2">
          {checklistItems.length ? (
            checklistItems.map((item, index) => (
              <div key={item.id} className="grid gap-2 rounded-md border border-slate-200 p-2 md:grid-cols-[minmax(0,1fr)_120px_auto]">
                <Input
                  placeholder="Checklist item"
                  value={item.label}
                  onChange={(event) =>
                    setChecklistItems((prev) => {
                      const next = [...prev]
                      next[index] = { ...next[index], label: event.target.value }
                      return next
                    })
                  }
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={item.isRequired}
                    onChange={(event) =>
                      setChecklistItems((prev) => {
                        const next = [...prev]
                        next[index] = { ...next[index], isRequired: event.target.checked }
                        return next
                      })
                    }
                  />
                  Required
                </label>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() =>
                    setChecklistItems((prev) => prev.filter((_, rowIndex) => rowIndex !== index))
                  }
                >
                  Remove
                </Button>
              </div>
            ))
          ) : (
            <p className="text-sm text-amber-700">No checklist items yet. Add at least one to complete this section.</p>
          )}
        </div>
      </section>

      <section className="rounded-[20px] border border-slate-200 bg-white p-5">
        <h3 className="text-lg font-semibold text-slate-900">Configuration Progress</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className={cn("rounded-lg border p-3", checklistComplete ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50")}>
            <p className="text-sm font-medium">Checklist</p>
            <p className="text-xs text-slate-600 mt-1">{checklistComplete ? "Complete" : "Incomplete"}</p>
          </div>
          <div className={cn("rounded-lg border p-3", service.configStatus.followUpsComplete ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50")}>
            <p className="text-sm font-medium inline-flex items-center gap-1"><Route className="h-4 w-4" /> Follow Ups</p>
            <p className="text-xs text-slate-600 mt-1">{service.configStatus.followUpsComplete ? "Complete" : "Incomplete"}</p>
            <Button asChild type="button" size="sm" variant="outline" className="mt-2">
              <Link href={`/app/${tenantSlug}/account-settings/follow-ups?serviceId=${service.id}`}>
                Configure follow ups
              </Link>
            </Button>
          </div>
          <div className={cn("rounded-lg border p-3", service.configStatus.professionalsComplete ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50")}>
            <p className="text-sm font-medium inline-flex items-center gap-1"><Users className="h-4 w-4" /> Professionals</p>
            <p className="text-xs text-slate-600 mt-1">{service.configStatus.professionalsComplete ? "Complete" : "Incomplete"}</p>
            <Button asChild type="button" size="sm" variant="outline" className="mt-2">
              <Link href={`/app/${tenantSlug}/account-settings/professionals?serviceId=${service.id}`}>
                Configure professionals
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <div className="flex items-center justify-end">
        <Button type="button" onClick={onSubmit} disabled={isSubmitting}>
          <Save className="h-4 w-4" />
          {isSubmitting ? "Saving..." : "Save service"}
        </Button>
      </div>
    </div>
  )
}
