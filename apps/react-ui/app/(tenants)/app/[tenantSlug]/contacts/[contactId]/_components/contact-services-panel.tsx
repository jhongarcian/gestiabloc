"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { isAxiosError } from "axios"
import { Plus, Settings2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis } from "recharts"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"

type ContactServiceItem = {
  id: string
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELED"
  totalPriceCents: number
  paidCents: number
  remainingCents: number
  currency: string
  notes: string | null
  service: {
    id: string
    name: string
    description?: string | null
    basePriceCents?: number
    checklistItems?: Array<{
      id: string
      label: string
      description: string | null
      isRequired: boolean
      sortOrder: number
    }>
  }
  followUpTemplate?: {
    id: string
    name: string
  } | null
  checklistItems: Array<{
    id: string
    checklistItemId: string
    completedAt: string | null
    label: string
    description: string | null
    isRequired: boolean
    sortOrder: number
  }>
  followUpSteps: Array<{
    id: string
    status?: "PENDING" | "ACTIVE" | "COMPLETED" | "SKIPPED" | "POSTPONED"
    completedAt?: string | null
  }>
}

type ContactServicesResponse = {
  ok: boolean
  items: ContactServiceItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

type ServiceOptionsResponse = {
  ok: boolean
  items: Array<{
    id: string
    name: string
  }>
}

type FollowUpTemplatesResponse = {
  ok: boolean
  items: Array<{
    id: string
    name: string
    isPublished?: boolean
  }>
}

type ServiceDetailsResponse = {
  ok: boolean
  service: {
    id: string
    name: string
    description: string | null
    basePriceCents: number
    currency: string
    allowPartialPayments: boolean
    minimumPartialPaymentCents: number | null
    checklistItems: Array<{
      id: string
      label: string
      description: string | null
      isRequired: boolean
      sortOrder: number
    }>
  }
}

type ContactServicesPanelProps = {
  tenantId: string
  tenantSlug: string
  contactId: string
  membershipSecurityLevel: "LOW" | "MEDIUM" | "MAX"
}

const currencyFormatter = (valueCents: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((valueCents || 0) / 100)

const toSentence = (value: string) => value.toLowerCase().replace(/_/g, " ")
const centsToUsdInput = (valueCents: number) => ((valueCents || 0) / 100).toFixed(2)
const parseUsdToCents = (value: string) => {
  const normalized = value.replace(/\$/g, "").replace(/,/g, "").trim()
  if (!normalized) return null
  const parsed = Number.parseFloat(normalized)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.round(parsed * 100)
}

const SERVICE_STATUS_STYLES: Record<ContactServiceItem["status"], string> = {
  PENDING: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  IN_PROGRESS: "bg-sky-100 text-sky-800 hover:bg-sky-100",
  COMPLETED: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
  CANCELED: "bg-rose-100 text-rose-800 hover:bg-rose-100",
}

const STATUS_CHART_COLORS: Record<ContactServiceItem["status"], string> = {
  PENDING: "#f59e0b",
  IN_PROGRESS: "#0ea5e9",
  COMPLETED: "#22c55e",
  CANCELED: "#ef4444",
}

const spendingChartConfig = {
  paid: { label: "Paid", color: "#0ea5e9" },
  remaining: { label: "Remaining", color: "#f59e0b" },
} satisfies ChartConfig

const statusChartConfig = {
  value: { label: "Services", color: "#64748b" },
} satisfies ChartConfig

export function ContactServicesPanel({
  tenantId,
  tenantSlug,
  contactId,
  membershipSecurityLevel,
}: ContactServicesPanelProps) {
  const router = useRouter()
  const canManageSensitiveServiceActions = membershipSecurityLevel !== "LOW"
  const [items, setItems] = useState<ContactServiceItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [serviceOptions, setServiceOptions] = useState<Array<{ id: string; name: string }>>([])
  const [templateOptions, setTemplateOptions] = useState<Array<{ id: string; name: string }>>([])
  const [createServiceDetails, setCreateServiceDetails] = useState<ServiceDetailsResponse["service"] | null>(null)

  const [createServiceId, setCreateServiceId] = useState("")
  const [createTemplateId, setCreateTemplateId] = useState("")
  const [createPaymentMode, setCreatePaymentMode] = useState<"FULL" | "PARTIAL" | "LATER">("FULL")
  const [createInitialPaymentUsd, setCreateInitialPaymentUsd] = useState("")
  const [createNotes, setCreateNotes] = useState("")

  const hasItems = items.length > 0

  const resetCreate = () => {
    setCreateServiceId("")
    setCreateTemplateId("")
    setCreatePaymentMode("FULL")
    setCreateInitialPaymentUsd("")
    setCreateNotes("")
    setTemplateOptions([])
    setCreateServiceDetails(null)
  }

  const loadServices = useCallback(async () => {
    setIsLoading(true)
    try {
      const { data } = await api.get<ContactServicesResponse>(`/api/services/${tenantId}/contact-services`, {
        params: {
          page: 1,
          pageSize: 25,
          contactId,
        },
      })
      setItems(data.items)
    } catch {
      setItems([])
      toast.error("Could not load enrolled services.")
    } finally {
      setIsLoading(false)
    }
  }, [tenantId, contactId])

  const loadServiceOptions = useCallback(async () => {
    try {
      const { data } = await api.get<ServiceOptionsResponse>(`/api/account-settings/${tenantId}/services/options`)
      setServiceOptions(data.items)
    } catch {
      setServiceOptions([])
    }
  }, [tenantId])

  const loadTemplateOptions = useCallback(async (serviceId: string) => {
    if (!serviceId) {
      setTemplateOptions([])
      return
    }
    try {
      const { data } = await api.get<FollowUpTemplatesResponse>(
        `/api/account-settings/${tenantId}/services/${serviceId}/follow-up-templates`,
      )
      setTemplateOptions(
        (data.items ?? [])
          .filter((item) => item.isPublished !== false)
          .map((item) => ({ id: item.id, name: item.name })),
      )
    } catch {
      setTemplateOptions([])
    }
  }, [tenantId])

  const loadServiceDetails = useCallback(async (serviceId: string) => {
    if (!serviceId) {
      setCreateServiceDetails(null)
      return
    }
    try {
      const { data } = await api.get<ServiceDetailsResponse>(`/api/account-settings/${tenantId}/services/${serviceId}`)
      setCreateServiceDetails(data.service)
      setCreatePaymentMode((prev) => {
        if (prev === "PARTIAL" && !data.service.allowPartialPayments) {
          return "FULL"
        }
        return prev
      })
    } catch {
      setCreateServiceDetails(null)
    }
  }, [tenantId])

  useEffect(() => {
    void loadServices()
    void loadServiceOptions()
  }, [loadServices, loadServiceOptions])

  useEffect(() => {
    void loadTemplateOptions(createServiceId)
    void loadServiceDetails(createServiceId)
  }, [createServiceId, loadTemplateOptions, loadServiceDetails])

  const totals = useMemo(() => {
    const enrolled = items.length
    const completed = items.filter((item) => item.status === "COMPLETED").length
    const inProgress = items.filter((item) => item.status === "IN_PROGRESS").length
    const totalBilledCents = items.reduce((sum, item) => sum + item.totalPriceCents, 0)
    const totalPaidCents = items.reduce((sum, item) => sum + item.paidCents, 0)
    const totalRemainingCents = items.reduce((sum, item) => sum + item.remainingCents, 0)
    return {
      enrolled,
      completed,
      inProgress,
      totalBilledCents,
      totalPaidCents,
      totalRemainingCents,
    }
  }, [items])

  const spendingBreakdownData = useMemo(
    () => [
      {
        name: "Balance",
        paid: Number((totals.totalPaidCents / 100).toFixed(2)),
        remaining: Number((totals.totalRemainingCents / 100).toFixed(2)),
      },
    ],
    [totals.totalPaidCents, totals.totalRemainingCents],
  )

  const statusBreakdownData = useMemo(
    () =>
      (["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELED"] as const).map((status) => ({
        status,
        label: toSentence(status),
        value: items.filter((item) => item.status === status).length,
        fill: STATUS_CHART_COLORS[status],
      })),
    [items],
  )

  const getServiceProgress = (item: ContactServiceItem) => {
    const total = item.followUpSteps.length
    const completed = item.followUpSteps.filter(
      (step) =>
        step.status === "COMPLETED" ||
        step.status === "SKIPPED" ||
        Boolean(step.completedAt),
    ).length
    const remaining = Math.max(0, total - completed)
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0
    return { total, completed, remaining, percentage }
  }

  const onCreate = async () => {
    if (!createServiceId) {
      toast.error("Select a service.")
      return
    }
    const totalPriceCents = createServiceDetails?.basePriceCents ?? null
    if (totalPriceCents === null) {
      toast.error("Select a valid service.")
      return
    }
    if (createPaymentMode === "PARTIAL" && !createServiceDetails?.allowPartialPayments) {
      toast.error("This service does not allow partial payments.")
      return
    }

    const initialPaymentCents =
      createPaymentMode === "FULL"
        ? totalPriceCents
        : createPaymentMode === "LATER"
          ? 0
          : parseUsdToCents(createInitialPaymentUsd)

    if (createPaymentMode === "PARTIAL") {
      if (initialPaymentCents === null || initialPaymentCents <= 0) {
        toast.error("Enter a valid partial payment amount in USD.")
        return
      }
      if (initialPaymentCents > totalPriceCents) {
        toast.error("Partial payment cannot be greater than total amount.")
        return
      }
      if (
        createServiceDetails?.minimumPartialPaymentCents !== null &&
        createServiceDetails?.minimumPartialPaymentCents !== undefined &&
        initialPaymentCents < createServiceDetails.minimumPartialPaymentCents
      ) {
        toast.error("Partial payment is below the minimum allowed for this service.")
        return
      }
    }

    setIsSaving(true)
    try {
      await api.post(`/api/services/${tenantId}/contact-services`, {
        contactId,
        serviceId: createServiceId,
        ...(createTemplateId ? { followUpTemplateId: createTemplateId } : {}),
        ...(initialPaymentCents !== null ? { initialPaymentCents } : {}),
        ...(createNotes.trim() ? { notes: createNotes.trim() } : {}),
      })
      toast.success("Service purchased and enrolled.")
      setIsCreateOpen(false)
      resetCreate()
      await loadServices()
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(typeof backendError === "string" ? backendError.replace(/_/g, " ") : "Could not enroll service.")
      } else {
        toast.error("Could not enroll service.")
      }
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Contact Services</p>
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Services and enrollments</h1>
              <p className="text-sm text-slate-600">Enroll purchased services and manage their follow-up enrollment records.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 md:self-center">
            <Button type="button" onClick={() => setIsCreateOpen(true)} className="cursor-pointer">
              <Plus className="h-4 w-4" />
              Purchase service
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[24px] border border-slate-200 bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Enrolled Services</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">{totals.enrolled}</p>
        </div>
        <div className="rounded-[24px] border border-slate-200 bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Completed Services</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-emerald-700">{totals.completed}</p>
        </div>
        <div className="rounded-[24px] border border-slate-200 bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Current Spending</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">{currencyFormatter(totals.totalPaidCents, "USD")}</p>
        </div>
        <div className="rounded-[24px] border border-slate-200 bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Remaining Balance</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-amber-700">{currencyFormatter(totals.totalRemainingCents, "USD")}</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-[20px] border border-slate-200 bg-white p-4 xl:col-span-2">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-slate-900">Balance Overview</h3>
            <p className="text-xs text-slate-500">Paid vs remaining amount for this contact.</p>
          </div>
          <ChartContainer config={spendingChartConfig} className="mx-auto h-[220px] w-full max-w-[520px]">
            <BarChart data={spendingBreakdownData}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="name" tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="paid" stackId="a" fill="var(--color-paid)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="remaining" stackId="a" fill="var(--color-remaining)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </div>
        <div className="rounded-[20px] border border-slate-200 bg-white p-4">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-slate-900">Service Status Mix</h3>
            <p className="text-xs text-slate-500">How enrolled services are distributed by status.</p>
          </div>
          <ChartContainer config={statusChartConfig} className="h-[220px] w-full">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent nameKey="label" />} />
              <Pie data={statusBreakdownData} dataKey="value" nameKey="label" innerRadius={45} outerRadius={76} paddingAngle={2}>
                {statusBreakdownData.map((entry) => (
                  <Cell key={entry.status} fill={entry.fill} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
          <div className="mt-2 flex flex-wrap gap-2">
            {statusBreakdownData.map((entry) => (
              <Badge key={entry.status} variant="outline" className="capitalize">
                {entry.label}: {entry.value}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Service</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Paid</TableHead>
              <TableHead>Remaining</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Follow-Ups</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-slate-500">Loading services...</TableCell>
              </TableRow>
            ) : hasItems ? (
              items.map((item) => (
                <TableRow
                  key={item.id}
                  className="cursor-pointer"
                  onClick={() =>
                    router.push(`/app/${tenantSlug}/contacts/${contactId}/services/${item.id}`)
                  }
                >
                  <TableCell className="font-medium text-slate-900">{item.service.name}</TableCell>
                  <TableCell>
                    <Badge className={`capitalize ${SERVICE_STATUS_STYLES[item.status]}`}>
                      {toSentence(item.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>{currencyFormatter(item.totalPriceCents, item.currency)}</TableCell>
                  <TableCell>{currencyFormatter(item.paidCents, item.currency)}</TableCell>
                  <TableCell>{currencyFormatter(item.remainingCents, item.currency)}</TableCell>
                  <TableCell>
                    {(() => {
                      const progress = getServiceProgress(item)
                      return (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className="w-[150px] cursor-pointer"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                                <div
                                  className="h-full rounded-full bg-emerald-500 transition-all"
                                  style={{ width: `${progress.percentage}%` }}
                                />
                              </div>
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            className="w-56"
                            align="start"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <div className="space-y-1">
                              <p className="text-sm font-semibold text-slate-900">
                                {progress.percentage}% Completed
                              </p>
                              <p className="text-xs text-slate-600">
                                {progress.completed} completed, {progress.remaining} remaining out of{" "}
                                {progress.total} follow-ups.
                              </p>
                            </div>
                          </PopoverContent>
                        </Popover>
                      )
                    })()}
                  </TableCell>
                  <TableCell>{item.followUpSteps.length}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-slate-500">No services enrolled yet.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isCreateOpen} onOpenChange={(open) => {
        setIsCreateOpen(open)
        if (!open) resetCreate()
      }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Purchase service</DialogTitle>
            <DialogDescription>
              Review service details, cost, and checklist before confirming this contact purchase.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid gap-2">
              <Label>Service</Label>
              <Select value={createServiceId} onValueChange={setCreateServiceId}>
                <SelectTrigger className="cursor-pointer">
                  <SelectValue placeholder="Select service" />
                </SelectTrigger>
                <SelectContent>
                  {serviceOptions.map((service) => (
                    <SelectItem key={service.id} value={service.id} className="cursor-pointer">
                      {service.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Tabs defaultValue="form" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="form" className="cursor-pointer">Purchase Form</TabsTrigger>
                <TabsTrigger value="information" className="cursor-pointer">Service Information</TabsTrigger>
              </TabsList>
              <TabsContent value="form" className="mt-4 space-y-4">
                <div className="grid gap-2">
                  <Label>Published Follow-Up Template (Optional)</Label>
                  <Select value={createTemplateId || "none"} onValueChange={(value) => setCreateTemplateId(value === "none" ? "" : value)}>
                    <SelectTrigger className="cursor-pointer">
                      <SelectValue placeholder="Use default published template" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" className="cursor-pointer">Use default published template</SelectItem>
                      {templateOptions.map((template) => (
                        <SelectItem key={template.id} value={template.id} className="cursor-pointer">
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Payment Type</Label>
                  <Select
                    value={createPaymentMode}
                    onValueChange={(value) => setCreatePaymentMode(value as "FULL" | "PARTIAL" | "LATER")}
                  >
                    <SelectTrigger className="cursor-pointer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FULL" className="cursor-pointer">Pay in Full</SelectItem>
                      <SelectItem
                        value="PARTIAL"
                        disabled={!createServiceDetails?.allowPartialPayments}
                        className="cursor-pointer"
                      >
                        Partial Payment
                      </SelectItem>
                      <SelectItem value="LATER" className="cursor-pointer">Pay Later</SelectItem>
                    </SelectContent>
                  </Select>
                  {!createServiceDetails?.allowPartialPayments ? (
                    <p className="text-xs text-slate-500">This service supports full payment or pay later.</p>
                  ) : createPaymentMode === "LATER" && !canManageSensitiveServiceActions ? (
                    <p className="text-xs text-slate-500">You can start the service now and record payment later.</p>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label>Service Cost (USD)</Label>
                    <Input
                      value={
                        createServiceDetails
                          ? centsToUsdInput(createServiceDetails.basePriceCents)
                          : ""
                      }
                      readOnly
                      className="bg-slate-50 text-slate-600"
                    />
                  </div>
                  {createPaymentMode === "PARTIAL" ? (
                    <div className="grid gap-2">
                      <Label>Partial Payment Amount (USD)</Label>
                      <Input
                        value={createInitialPaymentUsd}
                        onChange={(event) => setCreateInitialPaymentUsd(event.target.value)}
                        inputMode="decimal"
                        placeholder="0.00"
                      />
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      <Label>{createPaymentMode === "LATER" ? "Payment Now (USD)" : "Payment Now (USD)"}</Label>
                      <Input
                        value={
                          createPaymentMode === "LATER"
                            ? "0.00"
                            : createServiceDetails
                              ? centsToUsdInput(createServiceDetails.basePriceCents)
                              : ""
                        }
                        readOnly
                        className="bg-slate-50 text-slate-600"
                      />
                    </div>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label>Notes</Label>
                  <Textarea value={createNotes} onChange={(event) => setCreateNotes(event.target.value)} rows={3} />
                </div>
              </TabsContent>
              <TabsContent value="information" className="mt-4">
                {createServiceDetails ? (
                  <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Service Summary</p>
                      <p className="text-sm font-semibold text-slate-900">{createServiceDetails.name}</p>
                      <div className="space-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Billing</p>
                        <p className="text-sm text-slate-700">
                          Cost: {currencyFormatter(createServiceDetails.basePriceCents, createServiceDetails.currency)}
                        </p>
                        <p className="text-sm text-slate-700">
                          Partial payments: {createServiceDetails.allowPartialPayments ? "Allowed" : "Not allowed"}
                        </p>
                        {createServiceDetails.allowPartialPayments && createServiceDetails.minimumPartialPaymentCents !== null ? (
                          <p className="text-sm text-slate-700">
                            Minimum partial payment:{" "}
                            {currencyFormatter(
                              createServiceDetails.minimumPartialPaymentCents,
                              createServiceDetails.currency,
                            )}
                          </p>
                        ) : null}
                      </div>
                      {createServiceDetails.description ? (
                        <p className="text-sm text-slate-600">{createServiceDetails.description}</p>
                      ) : null}
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Checklist</p>
                      {createServiceDetails.checklistItems.length ? (
                        <ul className="space-y-1 text-sm text-slate-700">
                          {[...createServiceDetails.checklistItems]
                            .sort((a, b) => a.sortOrder - b.sortOrder)
                            .map((item) => (
                              <li key={item.id} className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5">
                                <span className="font-medium text-slate-900">{item.label}</span>
                                {item.isRequired ? <span className="ml-2 text-xs text-rose-600">Required</span> : null}
                                {item.description ? <p className="mt-1 text-xs text-slate-500">{item.description}</p> : null}
                              </li>
                            ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-slate-500">No checklist requirements for this service.</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                    Select a service to preview its details.
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)} disabled={isSaving}>Cancel</Button>
            <Button type="button" onClick={() => void onCreate()} disabled={isSaving}>
              {isSaving ? "Purchasing..." : "Purchase service"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-2">
          <Settings2 className="h-3.5 w-3.5" />
          Click any enrolled service row to review the service details and mark checklist items as received.
        </span>
      </div>
    </section>
  )
}
