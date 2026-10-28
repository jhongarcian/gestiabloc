"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import {
  billingDate,
  billingError,
  billingMoney,
  PAYMENT_TYPE_LABELS,
  type BillingAccount,
  type PaymentTerms,
  type ServicePayment,
} from "@/lib/service-billing"
import { RecordServicePaymentDialog } from "@/components/record-service-payment-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

function PriorSchedule({
  value,
  currency,
  label = "View saved schedule",
}: {
  value: unknown
  currency: string
  label?: string
}) {
  const schedule =
    value &&
    typeof value === "object" &&
    "schedule" in value &&
    Array.isArray(value.schedule)
      ? value.schedule
      : []
  if (!schedule.length) return null
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-sm text-muted-foreground">
        {label}
      </summary>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {schedule.map(
          (
            row: { label: string; amountCents: number; dueDate: string | null },
            index: number,
          ) => (
            <li key={index}>
              {row.label}: {billingMoney(row.amountCents, currency)} ·{" "}
              {billingDate(row.dueDate)}
            </li>
          ),
        )}
      </ul>
    </details>
  )
}
export function ServicePaymentAccount({
  tenantId,
  contactServiceId,
  onChanged,
}: {
  tenantId: string
  contactServiceId: string
  onChanged?: () => void | Promise<void>
}) {
  const id = useId()
  const [data, setData] = useState<BillingAccount | null>(null)
  const [page, setPage] = useState(1)
  const [error, setError] = useState("")
  const [open, setOpen] = useState(false)
  const [selectedPayment, setSelectedPayment] = useState<ServicePayment | null>(
    null,
  )
  const [reviseOpen, setReviseOpen] = useState(false)
  const [terms, setTerms] = useState<PaymentTerms>({
    type: "INSTALLMENTS",
    installmentCount: 4,
  })
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const revisionInFlight = useRef(false)
  const revisionRequest = useRef<{ signature: string; key: string } | null>(
    null,
  )
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await api.get<BillingAccount>(
          `/api/services/${encodeURIComponent(tenantId)}/contact-services/${encodeURIComponent(contactServiceId)}/billing`,
          { params: { page }, signal },
        )
        setData(response.data)
        setError("")
      } catch (failure) {
        if (!signal?.aborted) setError(billingError(failure))
      }
    },
    [tenantId, contactServiceId, page],
  )
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])
  async function changed() {
    await load()
    void onChanged?.()
  }
  async function revise() {
    if (!data || revisionInFlight.current) return
    const payload = {
      paymentTerms: terms,
      expectedRevision: data.summary.financialRevision,
      reason: reason.trim(),
    }
    const signature = JSON.stringify(payload)
    if (revisionRequest.current?.signature !== signature)
      revisionRequest.current = { signature, key: crypto.randomUUID() }
    revisionInFlight.current = true
    setSaving(true)
    try {
      await api.patch(
        `/api/services/${encodeURIComponent(tenantId)}/contact-services/${encodeURIComponent(contactServiceId)}/billing-plan`,
        { ...payload, requestKey: revisionRequest.current.key },
      )
      setReviseOpen(false)
      toast.success(
        "Payment arrangement saved. Previous terms preserved in history.",
      )
      await changed()
    } catch (failure) {
      toast.error(billingError(failure))
      await load()
    } finally {
      revisionInFlight.current = false
      setSaving(false)
    }
  }
  if (!data)
    return (
      <Card>
        <CardHeader>
          <CardTitle>Service account</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <>
              <p role="alert">{error}</p>
              <Button variant="outline" onClick={() => void load()}>
                Retry
              </Button>
            </>
          ) : (
            <Skeleton className="h-48 w-full" />
          )}
        </CardContent>
      </Card>
    )
  const summary = data.summary
  const workLabel = {
    IN_PROGRESS: "Work in progress",
    FINISHED: "Work finished",
    CANCELED: "Service canceled",
  }[summary.workState]
  function openRevision() {
    if (!data) return
    setTerms({
      type: data.summary.paymentType ?? data.settings.defaultType,
      installmentCount: Math.min(
        data.summary.remainingCents,
        data.summary.schedule.filter(
          (due) => due.remainingCents > 0 && due.dueDate,
        ).length || data.settings.installmentCount,
      ),
      firstDueDate: data.summary.nextDueDate ?? data.summary.today,
      monthlyAnchorDay: data.plan?.monthlyAnchorDay ?? undefined,
    })
    setReason("")
    revisionRequest.current = null
    setReviseOpen(true)
  }
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <CardTitle>Service account</CardTitle>
            <CardDescription>
              {summary.paymentType
                ? PAYMENT_TYPE_LABELS[summary.paymentType]
                : "Existing payment arrangement"}
            </CardDescription>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{workLabel}</Badge>
              <Badge
                variant={summary.overdueCents > 0 ? "destructive" : "secondary"}
              >
                {summary.remainingCents === 0
                  ? "Paid in full"
                  : summary.overdueCents > 0
                    ? "Overdue"
                    : "Balance due"}
              </Badge>
            </div>
          </div>
          {data.permissions.canRecord ? (
            <Button
              disabled={summary.remainingCents === 0}
              onClick={() => {
                setSelectedPayment(null)
                setOpen(true)
              }}
            >
              Record payment
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-6 lg:grid-cols-4">
          {[
            {
              label: "Total price",
              value: billingMoney(summary.totalPriceCents, summary.currency),
            },
            {
              label: "Paid",
              value: billingMoney(summary.paidCents, summary.currency),
            },
            {
              label: "Balance",
              value: billingMoney(summary.remainingCents, summary.currency),
            },
            {
              label: "Next payment",
              value: summary.nextDueDate
                ? billingMoney(summary.nextDueCents, summary.currency)
                : summary.remainingCents === 0
                  ? "All paid"
                  : "—",
              helper:
                summary.remainingCents === 0
                  ? ""
                  : summary.scheduleNeedsReview
                    ? "Schedule needs review"
                    : billingDate(summary.nextDueDate),
            },
          ].map((item) => (
            <div key={item.label} className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="text-xl font-semibold tabular-nums sm:text-2xl">
                {item.value}
              </p>
              {item.helper ? (
                <p className="text-xs text-muted-foreground">{item.helper}</p>
              ) : null}
            </div>
          ))}
        </CardContent>
        {summary.overdueCents > 0 ? (
          <CardFooter>
            <p className="text-sm text-destructive">
              {billingMoney(summary.overdueCents, summary.currency)} overdue.
              Payments apply to the oldest unpaid amounts first.
            </p>
          </CardFooter>
        ) : null}
      </Card>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>Payment schedule</CardTitle>
            <CardDescription>
              {summary.scheduleNeedsReview
                ? "The balance is preserved. An admin must confirm the schedule before dates are shown."
                : "Dates and amounts stay fixed when you record a payment."}
            </CardDescription>
          </div>
          {data.permissions.canRevisePlan &&
          summary.remainingCents > 0 &&
          summary.workState !== "CANCELED" ? (
            <Button variant="outline" onClick={openRevision}>
              {summary.scheduleNeedsReview
                ? "Confirm arrangement"
                : "Revise arrangement"}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {summary.schedule.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <caption className="sr-only">
                  Saved service payment schedule
                </caption>
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th scope="col" className="pb-3 font-medium">
                      Due
                    </th>
                    <th scope="col" className="pb-3 text-right font-medium">
                      Amount
                    </th>
                    <th scope="col" className="pb-3 text-right font-medium">
                      Unpaid
                    </th>
                    <th scope="col" className="pb-3 pl-4 font-medium">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summary.schedule.map((due) => (
                    <tr key={due.id} className="border-b last:border-0">
                      <td className="py-3">
                        <p>{billingDate(due.dueDate)}</p>
                        <p className="text-xs text-muted-foreground">
                          {due.label}
                        </p>
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {billingMoney(due.amountCents, summary.currency)}
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {billingMoney(due.remainingCents, summary.currency)}
                      </td>
                      <td className="py-3 pl-4">
                        <Badge
                          variant={
                            due.state === "OVERDUE"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {
                            {
                              PAID: "Paid",
                              PARTIAL: "Partially paid",
                              OVERDUE: "Overdue",
                              SCHEDULED: due.dueDate
                                ? "Scheduled"
                                : "Unscheduled",
                            }[due.state]
                          }
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {summary.scheduleNeedsReview
                ? "You can continue recording payments while this schedule is reviewed."
                : "No scheduled payments remain."}
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Payment history</CardTitle>
          <CardDescription>
            Receipts and corrections remain visible.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {data.payments.length ? (
            data.payments.map((payment) => (
              <div
                key={payment.id}
                className="flex flex-wrap items-start justify-between gap-3 border-b pb-4 last:border-0 last:pb-0"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="font-medium tabular-nums">
                    {billingMoney(payment.amountCents, summary.currency)}{" "}
                    {payment.voidedAt ? (
                      <Badge variant="outline">Voided</Badge>
                    ) : payment.replacesPaymentId ? (
                      <Badge variant="secondary">Corrected receipt</Badge>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Intl.DateTimeFormat("en-US", {
                      timeZone: summary.timezone,
                      dateStyle: "medium",
                    }).format(new Date(payment.paidAt))}{" "}
                    ·{" "}
                    {payment.paymentMethod?.toLowerCase() ??
                      "Method not specified"}{" "}
                    · {payment.recordedBy?.name ?? "Former staff member"}
                  </p>
                  {payment.note ? (
                    <p className="break-words text-sm">{payment.note}</p>
                  ) : null}
                  {payment.voidReason ? (
                    <p className="break-words text-sm text-muted-foreground">
                      Reason: {payment.voidReason}
                    </p>
                  ) : null}
                </div>
                {data.permissions.canRecord && !payment.voidedAt ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedPayment(payment)
                      setOpen(true)
                    }}
                  >
                    Correct / void
                  </Button>
                ) : null}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No receipts recorded.
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Account activity</CardTitle>
          <CardDescription>
            Who changed the arrangement or receipts, and why.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {data.changes.map((change) => (
            <div key={change.id} className="border-b pb-4 last:border-0">
              <p className="text-sm font-medium">
                {(
                  {
                    ACCOUNT_CREATED: "Account opened",
                    PLAN_REVISED: "Payment arrangement revised",
                    PAYMENT_ADDED: "Payment recorded",
                    PAYMENT_UPDATED: "Payment corrected",
                    PAYMENT_REMOVED: "Payment voided",
                    PAYMENT_REVIEWED: "Receipt reviewed",
                  } as Record<string, string>
                )[change.kind] ?? "Account updated"}
              </p>
              <p className="text-xs text-muted-foreground">
                {change.actorName} ·{" "}
                {new Intl.DateTimeFormat("en-US", {
                  timeZone: summary.timezone,
                  dateStyle: "medium",
                }).format(new Date(change.createdAt))}
              </p>
              {change.reason ? (
                <p className="mt-1 break-words text-sm">{change.reason}</p>
              ) : null}
              <PriorSchedule
                value={change.previous}
                currency={summary.currency}
                label="View previous schedule"
              />
              <PriorSchedule
                value={change.next}
                currency={summary.currency}
                label="View saved schedule"
              />
            </div>
          ))}
          {!data.changes.length ? (
            <p className="text-sm text-muted-foreground">
              Earlier receipts are preserved above. New changes will appear
              here.
            </p>
          ) : null}
        </CardContent>
        {data.pagination.totalPages > 1 ? (
          <CardFooter className="justify-between gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {page} of {data.pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.pagination.totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </Button>
          </CardFooter>
        ) : null}
      </Card>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <RecordServicePaymentDialog
        tenantId={tenantId}
        contactServiceId={contactServiceId}
        open={open}
        onOpenChange={setOpen}
        payment={selectedPayment}
        onSaved={changed}
      />
      <Dialog
        open={reviseOpen}
        onOpenChange={(value) => {
          if (!saving) setReviseOpen(value)
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {summary.scheduleNeedsReview
                ? "Confirm payment arrangement"
                : "Revise unpaid balance"}
            </DialogTitle>
            <DialogDescription>
              Reschedule{" "}
              {billingMoney(summary.remainingCents, summary.currency)}. Paid
              portions and the previous arrangement stay in history.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault()
              void revise()
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`${id}-type`}>Arrangement</FieldLabel>
                <Select
                  value={terms.type}
                  disabled={saving}
                  onValueChange={(value) =>
                    setTerms((current) => ({
                      ...current,
                      type: value as PaymentTerms["type"],
                    }))
                  }
                >
                  <SelectTrigger id={`${id}-type`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {Object.entries(PAYMENT_TYPE_LABELS).map(
                        ([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ),
                      )}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              {terms.type === "INSTALLMENTS" ? (
                <Field>
                  <FieldLabel htmlFor={`${id}-count`}>
                    Number of future payments
                  </FieldLabel>
                  <Input
                    id={`${id}-count`}
                    type="number"
                    min={1}
                    max={120}
                    required
                    value={terms.installmentCount ?? 4}
                    disabled={saving}
                    onChange={(event) =>
                      setTerms((current) => ({
                        ...current,
                        installmentCount: Number(event.target.value),
                      }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Frequency:{" "}
                    {data.settings.installmentFrequency.toLowerCase()}
                  </p>
                </Field>
              ) : null}
              {terms.type !== "FLEXIBLE" ? (
                <Field>
                  <FieldLabel htmlFor={`${id}-date`}>First due date</FieldLabel>
                  <Input
                    id={`${id}-date`}
                    type="date"
                    required
                    value={terms.firstDueDate ?? ""}
                    disabled={saving}
                    onChange={(event) =>
                      setTerms((current) => ({
                        ...current,
                        firstDueDate: event.target.value,
                        monthlyAnchorDay: undefined,
                      }))
                    }
                  />
                </Field>
              ) : null}
              <Field>
                <FieldLabel htmlFor={`${id}-reason`}>Reason</FieldLabel>
                <Input
                  id={`${id}-reason`}
                  required
                  maxLength={1000}
                  value={reason}
                  disabled={saving}
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>
            </FieldGroup>
            <div
              className="rounded-xl border bg-muted/40 p-4 text-sm"
              aria-live="polite"
            >
              {terms.type === "FLEXIBLE"
                ? `${billingMoney(summary.remainingCents, summary.currency)} with no scheduled due date.`
                : terms.type === "SINGLE_PAYMENT"
                  ? `${billingMoney(summary.remainingCents, summary.currency)} due ${billingDate(terms.firstDueDate ?? null)}.`
                  : terms.installmentCount &&
                      terms.installmentCount > 0 &&
                      terms.installmentCount <=
                        Math.min(120, summary.remainingCents)
                    ? `${terms.installmentCount} payments of approximately ${billingMoney(summary.remainingCents / terms.installmentCount, summary.currency)}, ${data.settings.installmentFrequency === "BIWEEKLY" ? "every two weeks" : data.settings.installmentFrequency.toLowerCase()}, starting ${billingDate(terms.firstDueDate ?? null)}. The final payment includes any rounding remainder.`
                    : "Choose a valid number of future payments."}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => setReviseOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !reason.trim()}>
                {saving ? "Saving…" : "Save arrangement"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
