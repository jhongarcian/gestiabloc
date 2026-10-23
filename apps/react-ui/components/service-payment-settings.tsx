"use client"
import { useId } from "react"
import {
  PAYMENT_TYPE_LABELS,
  billingMoney,
  type PaymentSettings,
  type ServicePaymentType,
} from "@/lib/service-billing"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
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

export function ServicePaymentSettings({
  value,
  onChange,
  disabled,
  currency,
  totalCents,
}: {
  value: PaymentSettings
  onChange: (value: PaymentSettings) => void
  disabled?: boolean
  currency: string
  totalCents: number | null
}) {
  const id = useId()
  function toggle(type: ServicePaymentType, enabled: boolean) {
    const enabledTypes = enabled
      ? [...value.enabledTypes, type]
      : value.enabledTypes.filter((option) => option !== type)
    onChange({
      ...value,
      enabledTypes,
      defaultType: enabledTypes.includes(value.defaultType)
        ? value.defaultType
        : "SINGLE_PAYMENT",
    })
  }
  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend>Payment options</FieldLegend>
        <FieldDescription>
          Choose the arrangements staff can offer. A deposit is always a
          suggestion; enrollment can start with $0 received.
        </FieldDescription>
        <Field orientation="horizontal">
          <Checkbox id={`${id}-single`} checked disabled />
          <FieldLabel htmlFor={`${id}-single`}>Single payment</FieldLabel>
        </Field>
        {(["INSTALLMENTS", "FLEXIBLE"] as const).map((type) => (
          <Field key={type} orientation="horizontal">
            <Checkbox
              id={`${id}-${type}`}
              checked={value.enabledTypes.includes(type)}
              disabled={disabled}
              onCheckedChange={(checked) => toggle(type, checked === true)}
            />
            <FieldLabel htmlFor={`${id}-${type}`}>
              {PAYMENT_TYPE_LABELS[type]}
            </FieldLabel>
          </Field>
        ))}
      </FieldSet>
      <Field>
        <FieldLabel htmlFor={`${id}-default`}>Default arrangement</FieldLabel>
        <Select
          value={value.defaultType}
          disabled={disabled}
          onValueChange={(type) =>
            onChange({ ...value, defaultType: type as ServicePaymentType })
          }
        >
          <SelectTrigger id={`${id}-default`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {value.enabledTypes.map((type) => (
                <SelectItem key={type} value={type}>
                  {PAYMENT_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      {value.enabledTypes.includes("INSTALLMENTS") ? (
        <>
          <Field>
            <FieldLabel htmlFor={`${id}-deposit`}>
              Suggested deposit ({currency})
            </FieldLabel>
            <Input
              id={`${id}-deposit`}
              type="number"
              min={0}
              step="0.01"
              value={value.suggestedDepositCents / 100}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...value,
                  suggestedDepositCents: Math.round(
                    Number(event.target.value) * 100,
                  ),
                })
              }
            />
            <FieldDescription>
              Staff can record a different amount, including $0.
            </FieldDescription>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`${id}-count`}>
                Future payments after deposit
              </FieldLabel>
              <Input
                id={`${id}-count`}
                type="number"
                min={1}
                max={120}
                value={value.installmentCount}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...value,
                    installmentCount: Number(event.target.value),
                  })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-frequency`}>Frequency</FieldLabel>
              <Select
                value={value.installmentFrequency}
                disabled={disabled}
                onValueChange={(frequency) =>
                  onChange({
                    ...value,
                    installmentFrequency:
                      frequency as PaymentSettings["installmentFrequency"],
                  })
                }
              >
                <SelectTrigger id={`${id}-frequency`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="WEEKLY">Weekly</SelectItem>
                    <SelectItem value="BIWEEKLY">Every two weeks</SelectItem>
                    <SelectItem value="MONTHLY">Monthly</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </>
      ) : null}
      <div
        className="rounded-xl border bg-muted/40 p-4 text-sm"
        aria-live="polite"
      >
        <p className="font-medium">
          Default: {PAYMENT_TYPE_LABELS[value.defaultType]}
        </p>
        {value.defaultType === "INSTALLMENTS" &&
        totalCents !== null &&
        value.installmentCount > 0 ? (
          <p className="mt-1 text-muted-foreground">
            Suggested {billingMoney(value.suggestedDepositCents, currency)}{" "}
            today, then {value.installmentCount}{" "}
            {value.installmentFrequency.toLowerCase()} payments of approximately{" "}
            {billingMoney(
              Math.max(0, totalCents - value.suggestedDepositCents) /
                value.installmentCount,
              currency,
            )}
            . Staff confirm the actual amount and dates at enrollment.
          </p>
        ) : (
          <p className="mt-1 text-muted-foreground">
            {value.defaultType === "FLEXIBLE"
              ? "Varying payments with no scheduled due date."
              : "One balance due on the date selected at enrollment."}
          </p>
        )}
      </div>
    </FieldGroup>
  )
}
