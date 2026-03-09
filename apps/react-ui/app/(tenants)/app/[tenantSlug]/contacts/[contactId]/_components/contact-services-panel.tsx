"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { isAxiosError } from "axios"
import { Plus, Settings2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
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
  }
  followUpSteps: Array<{ id: string }>
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
  contactId: string
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

export function ContactServicesPanel({ tenantId, contactId }: ContactServicesPanelProps) {
  const [items, setItems] = useState<ContactServiceItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [serviceOptions, setServiceOptions] = useState<Array<{ id: string; name: string }>>([])
  const [templateOptions, setTemplateOptions] = useState<Array<{ id: string; name: string }>>([])
  const [createServiceDetails, setCreateServiceDetails] = useState<ServiceDetailsResponse["service"] | null>(null)

  const [selectedItem, setSelectedItem] = useState<ContactServiceItem | null>(null)

  const [createServiceId, setCreateServiceId] = useState("")
  const [createTemplateId, setCreateTemplateId] = useState("")
  const [createPaymentMode, setCreatePaymentMode] = useState<"FULL" | "PARTIAL">("FULL")
  const [createTotalAmountUsd, setCreateTotalAmountUsd] = useState("")
  const [createInitialPaymentUsd, setCreateInitialPaymentUsd] = useState("")
  const [createNotes, setCreateNotes] = useState("")

  const [editStatus, setEditStatus] = useState<ContactServiceItem["status"]>("IN_PROGRESS")
  const [editTotalAmountUsd, setEditTotalAmountUsd] = useState("")
  const [editNotes, setEditNotes] = useState("")

  const hasItems = items.length > 0

  const resetCreate = () => {
    setCreateServiceId("")
    setCreateTemplateId("")
    setCreatePaymentMode("FULL")
    setCreateTotalAmountUsd("")
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
      setCreatePaymentMode((prev) => (data.service.allowPartialPayments ? prev : "FULL"))
      setCreateTotalAmountUsd((prev) => (prev.trim() ? prev : centsToUsdInput(data.service.basePriceCents)))
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
    return { enrolled, completed }
  }, [items])

  const onCreate = async () => {
    if (!createServiceId) {
      toast.error("Select a service.")
      return
    }
    const totalPriceCents = parseUsdToCents(createTotalAmountUsd)
    if (totalPriceCents === null) {
      toast.error("Enter a valid total amount in USD.")
      return
    }
    if (createPaymentMode === "PARTIAL" && !createServiceDetails?.allowPartialPayments) {
      toast.error("This service does not allow partial payments.")
      return
    }

    const initialPaymentCents =
      createPaymentMode === "FULL" ? totalPriceCents : parseUsdToCents(createInitialPaymentUsd)

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
        totalPriceCents,
        ...(initialPaymentCents !== null ? { initialPaymentCents } : {}),
        ...(createNotes.trim() ? { notes: createNotes.trim() } : {}),
      })
      toast.success("Service purchased and enrolled.")
      setIsCreateOpen(false)
      resetCreate()
      await loadServices()
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

  const openEdit = (item: ContactServiceItem) => {
    setSelectedItem(item)
    setEditStatus(item.status)
    setEditTotalAmountUsd(centsToUsdInput(item.totalPriceCents))
    setEditNotes(item.notes ?? "")
    setIsEditOpen(true)
  }

  const onUpdate = async () => {
    if (!selectedItem) return
    const totalPriceCents = parseUsdToCents(editTotalAmountUsd)
    if (totalPriceCents === null) {
      toast.error("Enter a valid total amount in USD.")
      return
    }

    setIsSaving(true)
    try {
      await api.patch(`/api/services/${tenantId}/contact-services/${selectedItem.id}`, {
        status: editStatus,
        totalPriceCents,
        notes: editNotes.trim() || null,
      })
      toast.success("Service updated.")
      setIsEditOpen(false)
      setSelectedItem(null)
      await loadServices()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(typeof backendError === "string" ? backendError.replace(/_/g, " ") : "Could not update service.")
      } else {
        toast.error("Could not update service.")
      }
    } finally {
      setIsSaving(false)
    }
  }

  const onDelete = async () => {
    if (!selectedItem) return

    setIsDeleting(true)
    try {
      await api.delete(`/api/services/${tenantId}/contact-services/${selectedItem.id}`)
      toast.success("Service removed.")
      setIsEditOpen(false)
      setSelectedItem(null)
      await loadServices()
    } catch {
      toast.error("Could not remove service.")
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Contact Services</p>
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Services and enrollments</h1>
              <p className="text-sm text-slate-600">Enroll purchased services and manage their follow-up enrollment records.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-sm text-slate-600 shadow-sm">
              <span className="font-semibold text-slate-950">{totals.enrolled}</span> enrolled
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-sm text-slate-600 shadow-sm">
              <span className="font-semibold text-slate-950">{totals.completed}</span> completed
            </div>
            <Button type="button" onClick={() => setIsCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              Purchase service
            </Button>
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
              <TableHead>Follow-Ups</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-slate-500">Loading services...</TableCell>
              </TableRow>
            ) : hasItems ? (
              items.map((item) => (
                <TableRow
                  key={item.id}
                  className="cursor-pointer"
                  onClick={() => openEdit(item)}
                >
                  <TableCell className="font-medium text-slate-900">{item.service.name}</TableCell>
                  <TableCell className="capitalize text-slate-700">{toSentence(item.status)}</TableCell>
                  <TableCell>{currencyFormatter(item.totalPriceCents, item.currency)}</TableCell>
                  <TableCell>{currencyFormatter(item.paidCents, item.currency)}</TableCell>
                  <TableCell>{currencyFormatter(item.remainingCents, item.currency)}</TableCell>
                  <TableCell>{item.followUpSteps.length}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-slate-500">No services enrolled yet.</TableCell>
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
                    onValueChange={(value) => setCreatePaymentMode(value as "FULL" | "PARTIAL")}
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
                    </SelectContent>
                  </Select>
                  {!createServiceDetails?.allowPartialPayments ? (
                    <p className="text-xs text-slate-500">This service only supports full payment.</p>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label>Total Amount (USD)</Label>
                    <Input
                      value={createTotalAmountUsd}
                      onChange={(event) => setCreateTotalAmountUsd(event.target.value)}
                      inputMode="decimal"
                      placeholder="0.00"
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
                      <Label>Payment Now (USD)</Label>
                      <Input
                        value={createTotalAmountUsd}
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

      <Dialog open={isEditOpen} onOpenChange={(open) => {
        setIsEditOpen(open)
        if (!open) setSelectedItem(null)
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit service enrollment</DialogTitle>
            <DialogDescription>Update status, price, or notes for this enrolled service.</DialogDescription>
          </DialogHeader>
          {selectedItem ? (
            <div className="grid gap-4 py-1">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <span className="font-medium text-slate-900">{selectedItem.service.name}</span>
              </div>
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select value={editStatus} onValueChange={(value) => setEditStatus(value as ContactServiceItem["status"])}>
                  <SelectTrigger className="cursor-pointer">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELED"] as const).map((status) => (
                      <SelectItem key={status} value={status} className="cursor-pointer capitalize">
                        {toSentence(status)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Total Amount (USD)</Label>
                <Input
                  value={editTotalAmountUsd}
                  onChange={(event) => setEditTotalAmountUsd(event.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                />
              </div>
              <div className="grid gap-2">
                <Label>Notes</Label>
                <Textarea value={editNotes} onChange={(event) => setEditNotes(event.target.value)} rows={3} />
              </div>
            </div>
          ) : null}
          <DialogFooter className="flex items-center justify-between">
            <Button type="button" variant="destructive" onClick={() => void onDelete()} disabled={isDeleting || isSaving}>
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => setIsEditOpen(false)} disabled={isSaving}>Cancel</Button>
              <Button type="button" onClick={() => void onUpdate()} disabled={isSaving}>
                {isSaving ? "Saving..." : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-2">
          <Settings2 className="h-3.5 w-3.5" />
          Click any enrolled service row to edit or delete it.
        </span>
      </div>
    </section>
  )
}
