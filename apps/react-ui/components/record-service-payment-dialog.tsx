"use client"

import { useEffect, useId, useRef, useState } from "react"
import { isAxiosError } from "axios"
import { toast } from "sonner"
import { api } from "@/lib/api"
import {
  billingError,
  billingMoney,
  PAYMENT_METHODS,
  type BillingAccount,
  type BillingSummary,
  type ServicePayment,
} from "@/lib/service-billing"
import { dateTimeDraftToUtcIso } from "@/lib/date-time"
import {
  parseTransactionMoneyToCents,
  sanitizeTransactionMoneyInput,
} from "@/lib/transaction-inputs"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function RecordServicePaymentDialog({
  tenantId,
  contactServiceId,
  open,
  onOpenChange,
  onSaved,
  payment,
}: {
  tenantId: string
  contactServiceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void | Promise<void>
  payment?: ServicePayment | null
}) {
  const id = useId()
  const [summary, setSummary] = useState<BillingSummary | null>(null)
  const [amount, setAmount] = useState("")
  const [paidOn, setPaidOn] = useState("")
  const [method, setMethod] = useState("UNSPECIFIED")
  const [note, setNote] = useState("")
  const [reason, setReason] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  const request = useRef<{ signature: string; key: string } | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!open) return
    let active = true
    const controller = new AbortController()
    setSummary(null)
    setError("")
    request.current = null
    api
      .get<BillingAccount>(
        `/api/services/${encodeURIComponent(tenantId)}/contact-services/${encodeURIComponent(contactServiceId)}/billing`,
        { signal: controller.signal },
      )
      .then(({ data }) => {
        if (!active) return
        setSummary(data.summary)
        setAmount(payment ? (payment.amountCents / 100).toFixed(2) : "")
        setPaidOn(
          payment
            ? new Intl.DateTimeFormat("en-CA", {
                timeZone: data.summary.timezone,
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              }).format(new Date(payment.paidAt))
            : data.summary.today,
        )
        setMethod(payment?.paymentMethod ?? "UNSPECIFIED")
        setNote(payment?.note ?? "")
        setReason("")
      })
      .catch((failure) => {
        if (active && !controller.signal.aborted)
          setError(billingError(failure))
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [tenantId, contactServiceId, open, payment, retry])
  async function submit(voidPayment = false) {
    if (!summary || inFlight.current) return
    const cents = parseTransactionMoneyToCents(amount)
    if (
      !voidPayment &&
      (cents === null ||
        cents <= 0 ||
        cents > summary.remainingCents + (payment?.amountCents ?? 0))
    ) {
      setError(
        "Enter an amount greater than zero that does not exceed the balance.",
      )
      return
    }
    if (payment && !reason.trim()) {
      setError("Enter a reason for this correction or void.")
      return
    }
    const [year, month, day] = paidOn.split("-")
    const paidAt = dateTimeDraftToUtcIso(
      { date: `${month}/${day}/${year}`, time: "12:00" },
      summary.timezone,
    )
    if (!voidPayment && !paidAt) {
      setError("Choose a payment date.")
      return
    }
    const payload = {
      expectedRevision: summary.financialRevision,
      ...(payment ? { reason: reason.trim() } : {}),
      ...(!voidPayment
        ? {
            amountCents: cents,
            paidAt,
            paymentMethod: method === "UNSPECIFIED" ? null : method,
            note: note.trim() || null,
          }
        : {}),
    }
    const signature = JSON.stringify({
      paymentId: payment?.id,
      voidPayment,
      payload,
    })
    if (request.current?.signature !== signature)
      request.current = { signature, key: crypto.randomUUID() }
    const body = { ...payload, requestKey: request.current.key }
    inFlight.current = true
    setSaving(true)
    setError("")
    try {
      const url = `/api/services/${encodeURIComponent(tenantId)}/contact-services/${encodeURIComponent(contactServiceId)}/payments${payment ? `/${encodeURIComponent(payment.id)}` : ""}`
      if (voidPayment) await api.delete(url, { data: body })
      else if (payment) await api.patch(url, body)
      else await api.post(url, body)
    } catch (failure) {
      setError(billingError(failure))
      if (
        isAxiosError(failure) &&
        failure.response?.data?.error === "FINANCIAL_REVISION_CONFLICT"
      ) {
        try {
          const { data } = await api.get<BillingAccount>(
            `/api/services/${encodeURIComponent(tenantId)}/contact-services/${encodeURIComponent(contactServiceId)}/billing`,
          )
          setSummary(data.summary)
        } catch {
          setSummary(null)
          setError("Could not refresh this account. Reload it before retrying.")
        }
      }
      return
    } finally {
      inFlight.current = false
      setSaving(false)
    }
    toast.success(
      voidPayment
        ? "Payment voided. Original receipt preserved."
        : payment
          ? "Payment corrected. Original receipt preserved."
          : "Payment recorded.",
    )
    onOpenChange(false)
    void onSaved?.()
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!saving) onOpenChange(value)
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {payment ? "Correct payment" : "Record payment"}
          </DialogTitle>
          <DialogDescription>
            {payment
              ? "Correct a receipt or void a mistaken entry. The original stays in history."
              : "Record money already received. The oldest unpaid amounts are covered automatically."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
          className="flex flex-col gap-5"
        >
          {summary ? (
            <>
              <p className="text-sm text-muted-foreground">
                Balance{" "}
                <strong className="text-foreground tabular-nums">
                  {billingMoney(summary.remainingCents, summary.currency)}
                </strong>
              </p>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={`${id}-amount`}>
                    Amount ({summary.currency})
                  </FieldLabel>
                  <Input
                    id={`${id}-amount`}
                    autoFocus
                    inputMode="decimal"
                    required
                    value={amount}
                    disabled={saving}
                    maxLength={14}
                    onChange={(event) =>
                      setAmount(
                        sanitizeTransactionMoneyInput(event.target.value),
                      )
                    }
                  />
                  {!payment ? (
                    <div className="flex flex-wrap gap-2">
                      {summary.nextDueCents > 0 ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={saving}
                          onClick={() =>
                            setAmount((summary.nextDueCents / 100).toFixed(2))
                          }
                        >
                          Next payment
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={saving}
                        onClick={() =>
                          setAmount((summary.remainingCents / 100).toFixed(2))
                        }
                      >
                        Remaining balance
                      </Button>
                    </div>
                  ) : null}
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-date`}>Date received</FieldLabel>
                  <Input
                    id={`${id}-date`}
                    type="date"
                    required
                    value={paidOn}
                    disabled={saving}
                    onChange={(event) => setPaidOn(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-method`}>
                    Payment method
                  </FieldLabel>
                  <Select
                    value={method}
                    disabled={saving}
                    onValueChange={setMethod}
                  >
                    <SelectTrigger id={`${id}-method`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="UNSPECIFIED">
                          Not specified
                        </SelectItem>
                        {PAYMENT_METHODS.map((value) => (
                          <SelectItem key={value} value={value}>
                            {value === "ACH"
                              ? value
                              : value.charAt(0) + value.slice(1).toLowerCase()}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-note`}>
                    Note (optional)
                  </FieldLabel>
                  <Input
                    id={`${id}-note`}
                    value={note}
                    maxLength={1000}
                    disabled={saving}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </Field>
                {payment ? (
                  <Field>
                    <FieldLabel htmlFor={`${id}-reason`}>
                      Reason for correction or void
                    </FieldLabel>
                    <Input
                      id={`${id}-reason`}
                      value={reason}
                      maxLength={1000}
                      required
                      disabled={saving}
                      onChange={(event) => setReason(event.target.value)}
                    />
                    <FieldDescription>
                      This reason appears in the account history.
                    </FieldDescription>
                  </Field>
                ) : null}
              </FieldGroup>
            </>
          ) : !error ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading current balance…
            </p>
          ) : null}
          {error ? (
            <div role="alert" className="text-sm text-destructive">
              {error}
              {!summary ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRetry((value) => value + 1)}
                >
                  Retry
                </Button>
              ) : null}
            </div>
          ) : null}
          <DialogFooter className="flex-wrap gap-2">
            {payment ? (
              <Button
                type="button"
                variant="destructive"
                disabled={saving || !summary || !reason.trim()}
                onClick={() => void submit(true)}
              >
                Void entry
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !summary}>
              {saving
                ? "Saving…"
                : payment
                  ? "Save correction"
                  : "Record payment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
