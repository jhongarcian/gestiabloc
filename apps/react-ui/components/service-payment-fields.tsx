"use client"

import { useEffect, useId, useState } from "react"
import { addDays, format } from "date-fns"
import { CalendarIcon } from "lucide-react"
import { api } from "@/lib/api"
import {
  billingDate,
  billingError,
  billingMoney,
  PAYMENT_METHODS,
  PAYMENT_TYPE_LABELS,
  type EnrollmentBillingValue,
  type PaymentSettings,
  type PaymentTerms,
} from "@/lib/service-billing"
import {
  parseTransactionMoneyToCents,
  sanitizeTransactionMoneyInput,
} from "@/lib/transaction-inputs"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { parseStoredDate } from "@/components/ui/date-input"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

type Preview = {
  permissions: { canRecord: boolean }
  totalPriceCents: number
  currency: string
  today: string
  configurationVersion: string
  settings: PaymentSettings
  plan: PaymentTerms & {
    installmentFrequency: string | null
    monthlyAnchorDay: number | null
  }
  dues: Array<{ label: string; amountCents: number; dueDate: string | null }>
}
export function ServicePaymentFields({
  tenantId,
  serviceId,
  disabled,
  onChange,
}: {
  tenantId: string
  serviceId: string
  disabled?: boolean
  onChange: (value: EnrollmentBillingValue | null) => void
}) {
  const id = useId()
  const [terms, setTerms] = useState<PaymentTerms | null>(null)
  const [amount, setAmount] = useState("0.00")
  const [method, setMethod] = useState<string>("UNSPECIFIED")
  const [note, setNote] = useState("")
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)
  const [isDueDateOpen, setIsDueDateOpen] = useState(false)
  useEffect(() => {
    onChange(null)
    const controller = new AbortController()
    let active = true
    const amountCents = parseTransactionMoneyToCents(amount)
    const timer = setTimeout(async () => {
      if (amountCents === null) {
        setError("Enter a valid amount received today.")
        return
      }
      try {
        const { data } = await api.post<Preview>(
          `/api/services/${encodeURIComponent(tenantId)}/billing-preview`,
          {
            serviceId,
            initialPaymentCents: amountCents,
            ...(terms ? { paymentTerms: terms } : {}),
          },
          { signal: controller.signal },
        )
        if (!active) return
        setPreview(data)
        setError("")
        const defaultFirstDueDate =
          data.plan.firstDueDate && data.plan.firstDueDate <= data.today
            ? format(addDays(parseStoredDate(data.today)!, 1), "yyyy-MM-dd")
            : data.plan.firstDueDate
        if (!terms || (!terms.firstDueDate && defaultFirstDueDate !== data.plan.firstDueDate)) {
          setTerms({
            type: data.plan.type,
            installmentCount: data.plan.installmentCount,
            ...(data.plan.monthlyAnchorDay
              ? { monthlyAnchorDay: data.plan.monthlyAnchorDay }
              : {}),
            ...(defaultFirstDueDate
              ? { firstDueDate: defaultFirstDueDate }
              : {}),
          })
          return
        }
        onChange({
          paymentTerms: {
            ...terms,
            ...(data.plan.firstDueDate
              ? { firstDueDate: data.plan.firstDueDate }
              : {}),
            ...(data.plan.monthlyAnchorDay
              ? { monthlyAnchorDay: data.plan.monthlyAnchorDay }
              : {}),
          },
          initialPaymentCents: amountCents,
          initialPaymentMethod: method === "UNSPECIFIED" ? null : method,
          initialPaymentNote: note.trim() || null,
          configurationVersion: data.configurationVersion,
        })
      } catch (failure) {
        if (active && !controller.signal.aborted)
          setError(billingError(failure))
      }
    }, 250)
    return () => {
      active = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [tenantId, serviceId, terms, amount, method, note, onChange, retry])
  const type = terms?.type ?? preview?.settings.defaultType
  const firstDueDate = terms?.firstDueDate ?? preview?.plan.firstDueDate
  const selectedDueDate = parseStoredDate(firstDueDate ?? null)
  const future =
    preview?.dues.filter((due) => due.label !== "Payment at enrollment") ?? []
  const frequency =
    preview?.settings.installmentFrequency === "BIWEEKLY"
      ? "every two weeks"
      : preview?.settings.installmentFrequency.toLowerCase()
  return (
    <FieldGroup>
      {!preview && !error ? <Skeleton className="h-40 w-full" /> : null}
      {preview ? (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-4">
            <p className="text-sm text-muted-foreground">
              Service total, including applicable tax
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {billingMoney(preview.totalPriceCents, preview.currency)}
            </p>
          </div>
          <Field>
            <FieldLabel htmlFor={`${id}-type`}>Payment arrangement</FieldLabel>
            <Select
              value={type}
              disabled={disabled}
              onValueChange={(value) =>
                setTerms({
                  type: value as PaymentTerms["type"],
                  installmentCount: preview.settings.installmentCount,
                })
              }
            >
              <SelectTrigger id={`${id}-type`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {preview.settings.enabledTypes.map((option) => (
                    <SelectItem key={option} value={option}>
                      {PAYMENT_TYPE_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-amount`}>
              Amount received today ({preview.currency})
            </FieldLabel>
            <Input
              id={`${id}-amount`}
              inputMode="decimal"
              maxLength={14}
              value={amount}
              disabled={disabled || !preview.permissions.canRecord}
              onChange={(event) =>
                setAmount(sanitizeTransactionMoneyInput(event.target.value))
              }
            />
            <FieldDescription>
              Enter only money already received. You can enroll with $0 today.
            </FieldDescription>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || !preview.permissions.canRecord}
                onClick={() =>
                  setAmount((preview.totalPriceCents / 100).toFixed(2))
                }
              >
                Full amount
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || !preview.permissions.canRecord}
                onClick={() => setAmount("0.00")}
              >
                Nothing today
              </Button>
              {type === "INSTALLMENTS" &&
              preview.settings.suggestedDepositCents > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled || !preview.permissions.canRecord}
                  onClick={() =>
                    setAmount(
                      (preview.settings.suggestedDepositCents / 100).toFixed(2),
                    )
                  }
                >
                  Suggested deposit{" "}
                  {billingMoney(
                    preview.settings.suggestedDepositCents,
                    preview.currency,
                  )}
                </Button>
              ) : null}
            </div>
          </Field>
          {type === "INSTALLMENTS" ? (
            <Field>
              <FieldLabel htmlFor={`${id}-count`}>
                Number of future payments
              </FieldLabel>
              <Input
                id={`${id}-count`}
                type="number"
                min={1}
                max={120}
                value={
                  terms?.installmentCount ?? preview.settings.installmentCount
                }
                disabled={disabled}
                onChange={(event) =>
                  setTerms((current) => ({
                    ...current!,
                    installmentCount: Number(event.target.value),
                  }))
                }
              />
              <FieldDescription>
                Paid {frequency}. These payments come after the amount received
                today.
              </FieldDescription>
            </Field>
          ) : null}
          {type && type !== "FLEXIBLE" ? (
            <Field>
              <FieldLabel htmlFor={`${id}-due`}>
                {type === "INSTALLMENTS"
                  ? "First future payment due"
                  : "Balance due date"}
              </FieldLabel>
              <div className="flex min-w-0">
                <Popover open={isDueDateOpen} onOpenChange={setIsDueDateOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      id={`${id}-due`}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={disabled}
                      className="h-8 w-fit min-w-0 max-w-full justify-start rounded-full text-xs font-medium"
                    >
                      <CalendarIcon data-icon="inline-start" className="text-muted-foreground" />
                      <span className="truncate">
                        {firstDueDate ? billingDate(firstDueDate) : "Choose a date"}
                      </span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] p-0">
                    <Calendar
                      mode="single"
                      required
                      selected={selectedDueDate}
                      defaultMonth={selectedDueDate}
                      disabled={(date) => Boolean(disabled) || format(date, "yyyy-MM-dd") <= preview.today}
                      today={parseStoredDate(preview.today)}
                      autoFocus
                      onSelect={(date) => {
                        if (disabled || format(date, "yyyy-MM-dd") <= preview.today) return
                        setTerms((current) => ({
                          ...current!,
                          firstDueDate: format(date, "yyyy-MM-dd"),
                          monthlyAnchorDay: undefined,
                        }))
                        setIsDueDateOpen(false)
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <FieldDescription>Choose a date after today.</FieldDescription>
            </Field>
          ) : null}
          {(parseTransactionMoneyToCents(amount) ?? 0) > 0 ? (
            <>
              <Field>
                <FieldLabel htmlFor={`${id}-method`}>Payment method</FieldLabel>
                <Select
                  value={method}
                  disabled={disabled}
                  onValueChange={setMethod}
                >
                  <SelectTrigger id={`${id}-method`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="UNSPECIFIED">Not specified</SelectItem>
                      {PAYMENT_METHODS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option === "ACH"
                            ? option
                            : option.charAt(0) + option.slice(1).toLowerCase()}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-note`}>
                  Payment note (optional)
                </FieldLabel>
                <Input
                  id={`${id}-note`}
                  value={note}
                  maxLength={1000}
                  disabled={disabled}
                  onChange={(event) => setNote(event.target.value)}
                />
              </Field>
            </>
          ) : null}
          <div
            className="rounded-xl border bg-muted/40 p-4 text-sm"
            aria-live="polite"
          >
            <p className="font-medium">
              {billingMoney(
                parseTransactionMoneyToCents(amount) ?? 0,
                preview.currency,
              )}{" "}
              today
              {(parseTransactionMoneyToCents(amount) ?? 0) >=
              preview.totalPriceCents
                ? "; paid in full"
                : type === "INSTALLMENTS" && future.length
                  ? `, then ${future.length} ${frequency} payment${future.length === 1 ? "" : "s"} of ${billingMoney(future[0].amountCents, preview.currency)} starting ${billingDate(future[0].dueDate)}`
                  : type === "FLEXIBLE"
                    ? "; remaining balance has no scheduled due date"
                    : `; remaining balance due ${billingDate(preview.plan.firstDueDate ?? null)}`}
              .
            </p>
            {type === "INSTALLMENTS" &&
            future.length > 1 &&
            future.at(-1)!.amountCents !== future[0].amountCents ? (
              <p className="mt-1 text-muted-foreground">
                Final payment:{" "}
                {billingMoney(future.at(-1)!.amountCents, preview.currency)}.
              </p>
            ) : null}
          </div>
        </>
      ) : null}
      {preview && !error ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => setRetry((value) => value + 1)}
        >
          Refresh preview
        </Button>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="flex flex-col gap-2 text-sm text-destructive"
        >
          <p>{error}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRetry((value) => value + 1)}
          >
            Refresh preview
          </Button>
        </div>
      ) : null}
    </FieldGroup>
  )
}
