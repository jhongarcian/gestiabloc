"use client"

import { isAxiosError } from "axios"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { startTransition, useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"

type ServiceProfessional = {
  id: string
  kind: "INTERNAL_USER" | "EXTERNAL"
  userId: string | null
  externalProfessionalName: string | null
  externalContact: string | null
  notes: string | null
  sortOrder: number
  user: {
    name: string | null
    email: string | null
  } | null
}

type ServiceChecklistItem = {
  id: string
  label: string
  description: string | null
  isRequired: boolean
  sortOrder: number
}

type ServiceFollowUpTemplate = {
  id: string
  name: string
  isPublished: boolean
}

type ServiceListItem = {
  id: string
  name: string
  description: string | null
  basePriceCents: number
  currency: string
  allowPartialPayments: boolean
  minimumPartialPaymentCents: number | null
  isActive: boolean
  sortOrder: number
  checklistItems: ServiceChecklistItem[]
  followUpTemplates: ServiceFollowUpTemplate[]
  professionals: ServiceProfessional[]
}

type ServicesResponse = {
  ok: boolean
  items: ServiceListItem[]
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
    checklistItems: ServiceChecklistItem[]
  }
}

type FollowUpTemplatesResponse = {
  ok: boolean
  items: Array<{
    id: string
    name: string
    isPublished: boolean
  }>
}

type ContactSearchResult = {
  id: string
  fullName: string
  phoneNumber: string | null
  email: string | null
}

type ContactSearchResponse = {
  ok: boolean
  items: ContactSearchResult[]
}

type CreateContactServiceResponse = {
  ok: boolean
  contactService: {
    id: string
  }
}

type ServicesRegistryPanelProps = {
  tenantId: string
  tenantSlug: string
}

const PAGE_SIZE_OPTIONS = [10, 25] as const

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return parsed
}

function formatCurrency(valueCents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((valueCents || 0) / 100)
}

function centsToUsdInput(valueCents: number) {
  return ((valueCents || 0) / 100).toFixed(2)
}

function parseUsdToCents(value: string) {
  const normalized = value.replace(/\$/g, "").replace(/,/g, "").trim()
  if (!normalized) return null

  const parsed = Number.parseFloat(normalized)
  if (!Number.isFinite(parsed) || parsed < 0) return null

  return Math.round(parsed * 100)
}

function getProfessionalLabel(professional: ServiceProfessional) {
  return (
    professional.externalProfessionalName?.trim() ||
    professional.user?.name?.trim() ||
    professional.user?.email?.trim() ||
    professional.externalContact?.trim() ||
    "Assigned professional"
  )
}

function PurchaseTransactionDialog({
  tenantId,
  tenantSlug,
}: {
  tenantId: string
  tenantSlug: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoadingServiceOptions, setIsLoadingServiceOptions] = useState(false)
  const [isLoadingServiceDetails, setIsLoadingServiceDetails] = useState(false)
  const [isSearchingContacts, setIsSearchingContacts] = useState(false)
  const [serviceOptions, setServiceOptions] = useState<Array<{ id: string; name: string }>>([])
  const [templateOptions, setTemplateOptions] = useState<Array<{ id: string; name: string }>>([])
  const [selectedContact, setSelectedContact] = useState<ContactSearchResult | null>(null)
  const [contactResults, setContactResults] = useState<ContactSearchResult[]>([])
  const [contactSearchQuery, setContactSearchQuery] = useState("")
  const [debouncedContactSearchQuery, setDebouncedContactSearchQuery] = useState("")
  const [serviceId, setServiceId] = useState("")
  const [templateId, setTemplateId] = useState("")
  const [paymentMode, setPaymentMode] = useState<"FULL" | "PARTIAL" | "LATER">("FULL")
  const [initialPaymentUsd, setInitialPaymentUsd] = useState("")
  const [notes, setNotes] = useState("")
  const [serviceDetails, setServiceDetails] = useState<ServiceDetailsResponse["service"] | null>(
    null,
  )

  const resetForm = useCallback(() => {
    setIsSaving(false)
    setSelectedContact(null)
    setContactResults([])
    setContactSearchQuery("")
    setDebouncedContactSearchQuery("")
    setServiceId("")
    setTemplateId("")
    setPaymentMode("FULL")
    setInitialPaymentUsd("")
    setNotes("")
    setTemplateOptions([])
    setServiceDetails(null)
  }, [])

  const loadServiceOptions = useCallback(async () => {
    setIsLoadingServiceOptions(true)

    try {
      const { data } = await api.get<ServiceOptionsResponse>(
        `/api/account-settings/${tenantId}/services/options`,
      )
      setServiceOptions(data.items ?? [])
    } catch {
      setServiceOptions([])
      toast.error("Could not load services.")
    } finally {
      setIsLoadingServiceOptions(false)
    }
  }, [tenantId])

  const loadTemplateOptions = useCallback(
    async (nextServiceId: string) => {
      if (!nextServiceId) {
        setTemplateOptions([])
        return
      }

      try {
        const { data } = await api.get<FollowUpTemplatesResponse>(
          `/api/account-settings/${tenantId}/services/${nextServiceId}/follow-up-templates`,
        )

        setTemplateOptions(
          (data.items ?? [])
            .filter((item) => item.isPublished !== false)
            .map((item) => ({ id: item.id, name: item.name })),
        )
      } catch {
        setTemplateOptions([])
      }
    },
    [tenantId],
  )

  const loadServiceDetails = useCallback(
    async (nextServiceId: string) => {
      if (!nextServiceId) {
        setServiceDetails(null)
        return
      }

      setIsLoadingServiceDetails(true)

      try {
        const { data } = await api.get<ServiceDetailsResponse>(
          `/api/account-settings/${tenantId}/services/${nextServiceId}`,
        )
        setServiceDetails(data.service)
        setPaymentMode((current) => {
          if (current === "PARTIAL" && !data.service.allowPartialPayments) {
            return "FULL"
          }
          return current
        })
      } catch {
        setServiceDetails(null)
        toast.error("Could not load service details.")
      } finally {
        setIsLoadingServiceDetails(false)
      }
    },
    [tenantId],
  )

  useEffect(() => {
    if (!open) return
    if (serviceOptions.length > 0) return
    void loadServiceOptions()
  }, [open, serviceOptions.length, loadServiceOptions])

  useEffect(() => {
    if (!open) return

    const timeout = window.setTimeout(() => {
      setDebouncedContactSearchQuery(contactSearchQuery.trim())
    }, 350)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [contactSearchQuery, open])

  useEffect(() => {
    if (!open || serviceId.length === 0) return
    void loadTemplateOptions(serviceId)
    void loadServiceDetails(serviceId)
  }, [open, serviceId, loadTemplateOptions, loadServiceDetails])

  useEffect(() => {
    if (!templateOptions.some((item) => item.id === templateId)) {
      setTemplateId("")
    }
  }, [templateId, templateOptions])

  useEffect(() => {
    if (!open) return
    if (selectedContact) return

    if (debouncedContactSearchQuery.length < 2) {
      setContactResults([])
      setIsSearchingContacts(false)
      return
    }

    let cancelled = false

    const searchContacts = async () => {
      setIsSearchingContacts(true)

      try {
        const { data } = await api.get<ContactSearchResponse>(`/api/contacts/${tenantId}/search`, {
          params: {
            q: debouncedContactSearchQuery,
          },
        })

        if (cancelled) return
        setContactResults(data.items ?? [])
      } catch {
        if (cancelled) return
        setContactResults([])
      } finally {
        if (cancelled) return
        setIsSearchingContacts(false)
      }
    }

    void searchContacts()

    return () => {
      cancelled = true
    }
  }, [debouncedContactSearchQuery, open, selectedContact, tenantId])

  const onSubmit = async () => {
    if (!selectedContact) {
      toast.error("Select a contact.")
      return
    }

    if (!serviceId) {
      toast.error("Select a service.")
      return
    }

    const totalPriceCents = serviceDetails?.basePriceCents ?? null
    if (totalPriceCents === null) {
      toast.error("Select a valid service.")
      return
    }

    if (paymentMode === "PARTIAL" && !serviceDetails?.allowPartialPayments) {
      toast.error("This service does not allow partial payments.")
      return
    }

    const initialPaymentCents =
      paymentMode === "FULL"
        ? totalPriceCents
        : paymentMode === "LATER"
          ? 0
          : parseUsdToCents(initialPaymentUsd)

    if (paymentMode === "PARTIAL") {
      if (initialPaymentCents === null || initialPaymentCents <= 0) {
        toast.error("Enter a valid partial payment amount in USD.")
        return
      }

      if (initialPaymentCents > totalPriceCents) {
        toast.error("Partial payment cannot be greater than total amount.")
        return
      }

      if (
        serviceDetails?.minimumPartialPaymentCents !== null &&
        serviceDetails?.minimumPartialPaymentCents !== undefined &&
        initialPaymentCents < serviceDetails.minimumPartialPaymentCents
      ) {
        toast.error("Partial payment is below the minimum allowed for this service.")
        return
      }
    }

    setIsSaving(true)

    try {
      const { data } = await api.post<CreateContactServiceResponse>(
        `/api/services/${tenantId}/contact-services`,
        {
          contactId: selectedContact.id,
          serviceId,
          ...(templateId ? { followUpTemplateId: templateId } : {}),
          ...(initialPaymentCents !== null ? { initialPaymentCents } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
      )

      toast.success("Service transaction created.")
      setOpen(false)
      resetForm()
      router.push(
        `/app/${tenantSlug}/contacts/${selectedContact.id}/services/${data.contactService.id}`,
      )
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not create service transaction.",
        )
      } else {
        toast.error("Could not create service transaction.")
      }
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) resetForm()
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" className="bg-blue-950 text-white hover:bg-blue-950/90">
          Create transaction
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Create service transaction</DialogTitle>
          <DialogDescription>
            Select a service, choose the purchasing contact, and attach a follow-up template.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-1">
          <section className="grid gap-4 lg:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="service-transaction-contact-search">Contact</Label>
              {selectedContact ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-slate-900">{selectedContact.fullName}</p>
                      <p className="text-xs text-slate-500">
                        {selectedContact.email || selectedContact.phoneNumber || "No email or phone"}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedContact(null)
                        setContactSearchQuery("")
                        setDebouncedContactSearchQuery("")
                        setContactResults([])
                      }}
                    >
                      Change
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Input
                    id="service-transaction-contact-search"
                    value={contactSearchQuery}
                    onChange={(event) => setContactSearchQuery(event.target.value)}
                    placeholder="Search contacts by name, email, or phone"
                  />
                  <div className="rounded-xl border border-slate-200 bg-white">
                    {contactSearchQuery.trim().length < 2 ? (
                      <p className="px-3 py-3 text-sm text-slate-500">
                        Type at least 2 characters to search contacts.
                      </p>
                    ) : isSearchingContacts ? (
                      <p className="px-3 py-3 text-sm text-slate-500">Searching contacts...</p>
                    ) : contactResults.length ? (
                      <div className="max-h-44 overflow-auto">
                        {contactResults.map((contact) => (
                          <button
                            key={contact.id}
                            type="button"
                            className="flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-slate-50"
                            onClick={() => {
                              setSelectedContact(contact)
                              setContactResults([])
                            }}
                          >
                            <span className="text-sm font-medium text-slate-900">
                              {contact.fullName}
                            </span>
                            <span className="text-xs text-slate-500">
                              {contact.email || contact.phoneNumber || "No email or phone"}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="px-3 py-3 text-sm text-slate-500">No contacts found.</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="service-transaction-service">Service</Label>
              <Select
                value={serviceId}
                onValueChange={(value) => {
                  setServiceId(value)
                  setTemplateId("")
                }}
                disabled={isLoadingServiceOptions}
              >
                <SelectTrigger id="service-transaction-service">
                  <SelectValue
                    placeholder={
                      isLoadingServiceOptions ? "Loading services..." : "Select service"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {serviceOptions.map((service) => (
                    <SelectItem key={service.id} value={service.id}>
                      {service.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="service-transaction-template">Follow-Up Template</Label>
              <Select
                value={templateId || "default"}
                onValueChange={(value) => setTemplateId(value === "default" ? "" : value)}
                disabled={!serviceId}
              >
                <SelectTrigger id="service-transaction-template">
                  <SelectValue placeholder="Use default template selection" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Use default published template</SelectItem>
                  {templateOptions.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {serviceId && templateOptions.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No published templates are available for this service. The transaction can
                  still proceed if the service has default follow-up steps.
                </p>
              ) : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="service-transaction-payment-type">Payment Type</Label>
              <Select
                value={paymentMode}
                onValueChange={(value) =>
                  setPaymentMode(value as "FULL" | "PARTIAL" | "LATER")
                }
                disabled={!serviceDetails}
              >
                <SelectTrigger id="service-transaction-payment-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FULL">Pay in Full</SelectItem>
                  <SelectItem
                    value="PARTIAL"
                    disabled={!serviceDetails?.allowPartialPayments}
                  >
                    Partial Payment
                  </SelectItem>
                  <SelectItem value="LATER">Pay Later</SelectItem>
                </SelectContent>
              </Select>
              {!serviceDetails?.allowPartialPayments && serviceId ? (
                <p className="text-xs text-slate-500">
                  This service supports full payment or pay later only.
                </p>
              ) : null}
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="service-transaction-cost">Service Cost</Label>
              <Input
                id="service-transaction-cost"
                readOnly
                value={serviceDetails ? centsToUsdInput(serviceDetails.basePriceCents) : ""}
                className="bg-slate-50 text-slate-600"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="service-transaction-payment-now">
                {paymentMode === "PARTIAL" ? "Partial Payment Amount" : "Payment Now"}
              </Label>
              <Input
                id="service-transaction-payment-now"
                value={
                  paymentMode === "PARTIAL"
                    ? initialPaymentUsd
                    : paymentMode === "LATER"
                      ? "0.00"
                      : serviceDetails
                        ? centsToUsdInput(serviceDetails.basePriceCents)
                        : ""
                }
                onChange={(event) => setInitialPaymentUsd(event.target.value)}
                readOnly={paymentMode !== "PARTIAL"}
                inputMode="decimal"
                placeholder="0.00"
                className={paymentMode === "PARTIAL" ? undefined : "bg-slate-50 text-slate-600"}
              />
              {paymentMode === "PARTIAL" && serviceDetails?.minimumPartialPaymentCents ? (
                <p className="text-xs text-slate-500">
                  Minimum partial payment:{" "}
                  {formatCurrency(
                    serviceDetails.minimumPartialPaymentCents,
                    serviceDetails.currency,
                  )}
                </p>
              ) : null}
            </div>
          </section>

          <div className="grid gap-2">
            <Label htmlFor="service-transaction-notes">Notes</Label>
            <Textarea
              id="service-transaction-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              placeholder="Add context for this service purchase"
            />
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            {isLoadingServiceDetails ? (
              <p className="text-sm text-slate-500">Loading service details...</p>
            ) : serviceDetails ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Service Summary
                  </p>
                  <p className="text-sm font-semibold text-slate-900">{serviceDetails.name}</p>
                  {serviceDetails.description ? (
                    <p className="text-sm text-slate-600">{serviceDetails.description}</p>
                  ) : null}
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                      Cost
                    </p>
                    <p className="text-sm text-slate-900">
                      {formatCurrency(serviceDetails.basePriceCents, serviceDetails.currency)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                      Partial Payments
                    </p>
                    <p className="text-sm text-slate-900">
                      {serviceDetails.allowPartialPayments ? "Allowed" : "Not allowed"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                      Checklist
                    </p>
                    <p className="text-sm text-slate-900">
                      {serviceDetails.checklistItems.length} item
                      {serviceDetails.checklistItems.length === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                Select a service to review pricing, partial payment, and checklist details.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void onSubmit()}
            disabled={isSaving}
            className="bg-blue-950 text-white hover:bg-blue-950/90"
          >
            {isSaving ? "Creating..." : "Create transaction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ServicesRegistryPanel({
  tenantId,
  tenantSlug,
}: ServicesRegistryPanelProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [query, setQuery] = useState(() => searchParams.get("search") ?? "")
  const [debouncedQuery, setDebouncedQuery] = useState(
    () => (searchParams.get("search") ?? "").trim(),
  )
  const [page, setPage] = useState(() => parsePositiveInt(searchParams.get("page"), 1))
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(() => {
    const parsed = parsePositiveInt(searchParams.get("pageSize"), 10)
    return parsed === 25 ? 25 : 10
  })
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [data, setData] = useState<ServicesResponse | null>(null)

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query.trim())
      setPage(1)
    }, 350)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [query])

  useEffect(() => {
    const nextParams = new URLSearchParams()

    if (debouncedQuery) nextParams.set("search", debouncedQuery)
    if (page > 1) nextParams.set("page", String(page))
    if (pageSize !== 10) nextParams.set("pageSize", String(pageSize))

    const nextQuery = nextParams.toString()
    const currentQuery = searchParams.toString()
    if (nextQuery === currentQuery) return

    startTransition(() => {
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
        scroll: false,
      })
    })
  }, [debouncedQuery, page, pageSize, pathname, router, searchParams])

  const loadServices = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const { data: response } = await api.get<ServicesResponse>(
        `/api/account-settings/${tenantId}/services`,
        {
          params: {
            page,
            pageSize,
            search: debouncedQuery || undefined,
            isActive: true,
          },
        },
      )

      if (page > response.pagination.totalPages) {
        setPage(response.pagination.totalPages)
        return
      }

      setData(response)
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        setErrorMessage(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not load services.",
        )
      } else {
        setErrorMessage("Could not load services.")
      }
    } finally {
      setIsLoading(false)
    }
  }, [debouncedQuery, page, pageSize, tenantId])

  useEffect(() => {
    void loadServices()
  }, [loadServices])

  const services = data?.items ?? []
  const total = data?.pagination.total ?? 0
  const totalPages = data?.pagination.totalPages ?? 1
  const startIndex = (page - 1) * pageSize
  const canGoPrevious = page > 1
  const canGoNext = page < totalPages

  const summaryLabel = useMemo(() => {
    if (!total) return "No active services found"
    const start = startIndex + 1
    const end = start + services.length - 1
    return `Showing ${start}-${end} of ${total} services`
  }, [services.length, startIndex, total])

  return (
    <div className="flex h-full w-full min-h-0 flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Services</h2>
          <p className="text-sm text-slate-500">{summaryLabel}</p>
        </div>

        <PurchaseTransactionDialog tenantId={tenantId} tenantSlug={tenantSlug} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="grid gap-2 md:grid-cols-[minmax(320px,1fr)_auto]">
          <Input
            placeholder="Search by service name"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(1)
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
            onClick={() => {
              setQuery("")
              setDebouncedQuery("")
              setPage(1)
            }}
          >
            Clear Filters
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 w-full flex-1 flex-col rounded-lg bg-white">
        <div className="min-h-0 flex-1 overflow-auto">
          <Table className="[&_td]:py-3 [&_th]:h-8">
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-56 text-xs">Name</TableHead>
                <TableHead className="min-w-28 text-xs">Cost</TableHead>
                <TableHead className="min-w-36 text-xs">Min Partial Payment</TableHead>
                <TableHead className="min-w-28 text-xs">Has Checklist</TableHead>
                <TableHead className="min-w-72 text-xs">Professionals</TableHead>
                <TableHead className="min-w-32 text-xs">Templates Available</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-slate-500">
                    Loading services...
                  </TableCell>
                </TableRow>
              ) : errorMessage ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-rose-600">
                    {errorMessage}
                  </TableCell>
                </TableRow>
              ) : services.length ? (
                services.map((service) => {
                  const checklistCount = service.checklistItems.length
                  const professionalLabels = service.professionals.map(getProfessionalLabel)
                  const visibleProfessionalLabels = professionalLabels.slice(0, 2)
                  const extraProfessionalCount = Math.max(
                    0,
                    professionalLabels.length - visibleProfessionalLabels.length,
                  )
                  const publishedTemplateCount = service.followUpTemplates.filter(
                    (template) => template.isPublished,
                  ).length

                  return (
                    <TableRow key={service.id}>
                      <TableCell className="align-top">
                        <div className="space-y-1">
                          <p className="font-medium text-slate-900">{service.name}</p>
                          {service.description ? (
                            <p className="text-sm text-slate-500">{service.description}</p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="align-top text-slate-700">
                        {formatCurrency(service.basePriceCents, service.currency)}
                      </TableCell>
                      <TableCell className="align-top text-slate-700">
                        {service.allowPartialPayments
                          ? service.minimumPartialPaymentCents !== null
                            ? formatCurrency(
                                service.minimumPartialPaymentCents,
                                service.currency,
                              )
                            : "No minimum"
                          : "Full only"}
                      </TableCell>
                      <TableCell className="align-top">
                        <span
                          className={
                            checklistCount > 0
                              ? "inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-emerald-700"
                              : "inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-slate-700"
                          }
                        >
                          {checklistCount > 0 ? "Yes" : "No"}
                        </span>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="space-y-2">
                          <p className="text-sm text-slate-700">
                            {service.professionals.length} professional
                            {service.professionals.length === 1 ? "" : "s"}
                          </p>
                          {visibleProfessionalLabels.length ? (
                            <div className="flex flex-wrap gap-1.5">
                              {visibleProfessionalLabels.map((label) => (
                                <span
                                  key={`${service.id}-${label}`}
                                  className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-slate-700"
                                >
                                  {label}
                                </span>
                              ))}
                              {extraProfessionalCount > 0 ? (
                                <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-slate-700">
                                  +{extraProfessionalCount} more
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <p className="text-xs text-slate-500">No professionals assigned.</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="space-y-1">
                          <p className="font-medium text-slate-900">{publishedTemplateCount}</p>
                          <p className="text-xs text-slate-500">
                            published template
                            {publishedTemplateCount === 1 ? "" : "s"}
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-slate-500">
                    No active services are available yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <span>Rows per page</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => {
              const next = Number(value)
              if (next === 10 || next === 25) {
                setPageSize(next)
                setPage(1)
              }
            }}
          >
            <SelectTrigger size="sm" className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
            disabled={!canGoPrevious || isLoading}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            Previous
          </Button>
          <span className="px-1 text-sm text-slate-600">
            Page {page} of {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
            disabled={!canGoNext || isLoading}
            onClick={() => setPage((prev) => prev + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
