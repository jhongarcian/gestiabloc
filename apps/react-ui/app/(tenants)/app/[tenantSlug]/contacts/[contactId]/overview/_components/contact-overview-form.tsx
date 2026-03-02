"use client"

import { isAxiosError } from "axios"
import { format } from "date-fns"
import { CircleHelp, Lock, Save } from "lucide-react"
import { useRouter } from "next/navigation"
import { type ReactNode, useMemo, useState } from "react"
import { z } from "zod"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DateInput,
  parseDateInput,
  parseStoredDate,
  serializeDateOnly,
} from "@/components/ui/date-input"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AppPhoneInput } from "@/components/ui/phone-input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type StatusOption = {
  label: string
  value: string
}

type ContactOverviewFormProps = {
  tenantId: string
  contactId: string
  initialContact: {
    firstName: string
    middleName: string | null
    lastName: string
    dateOfBirth: string | null
    phoneNumber: string | null
    secondaryPhoneNumber: string | null
    email: string | null
    address: {
      addressLine1: string | null
      addressLine2: string | null
      city: string | null
      state: string | null
      postalCode: string | null
      country: string | null
    }
    statusConfigId: string | null
    customFields: Array<{
      id: string
      key: string
      label: string
      description: string | null
      fieldType:
        | "TEXT"
        | "NUMBER"
        | "PHONE"
        | "CURRENCY"
        | "DATE"
        | "SELECT"
        | "MULTI_SELECT"
        | "RADIO"
        | "TEXTAREA"
        | "CHECKBOX"
      isRequired: boolean
      isEncrypted: boolean
      options: string[]
      sortOrder: number
      value: unknown
    }>
  }
  statusOptions: StatusOption[]
}

type CustomField = ContactOverviewFormProps["initialContact"]["customFields"][number]
type FieldErrors = Partial<Record<string, string>>

const optionalStringSchema = z.string().trim().max(255)
const optionalPhoneSchema = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || /^\+[1-9]\d{7,14}$/.test(value),
    "Enter a valid phone number.",
  )

const baseContactSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required.").max(100),
  middleName: z.string().trim().max(100),
  lastName: z.string().trim().min(1, "Last name is required.").max(100),
  dateOfBirth: z.date().max(new Date(), "Date of birth cannot be in the future.").optional(),
  phone: optionalPhoneSchema,
  secondaryPhone: optionalPhoneSchema,
  email: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || z.email().safeParse(value).success,
      "Enter a valid email address.",
    ),
  addressLine1: optionalStringSchema,
  addressLine2: optionalStringSchema,
  city: optionalStringSchema,
  state: optionalStringSchema,
  postalCode: z.string().trim().max(20, "Postal code is too long."),
  country: optionalStringSchema,
  statusConfigId: z.string(),
})

function validateCustomField(field: CustomField, value: unknown): string | null {
  const emptyStringSchema = z.string().trim()

  switch (field.fieldType) {
    case "TEXT":
    case "TEXTAREA": {
      const schema = field.isRequired
        ? emptyStringSchema.min(1, `${field.label} is required.`)
        : emptyStringSchema
      const result = schema.safeParse(typeof value === "string" ? value : "")
      return result.success ? null : result.error.issues[0]?.message ?? "Invalid value."
    }
    case "NUMBER": {
      const schema = z
        .union([z.string(), z.number(), z.null(), z.undefined()])
        .transform((input) => {
          if (typeof input === "number") {
            return String(input)
          }
          return typeof input === "string" ? input.trim() : ""
        })
        .superRefine((input, ctx) => {
          if (field.isRequired && input.length === 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${field.label} is required.`,
            })
            return
          }

          if (input.length > 0 && Number.isNaN(Number(input))) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${field.label} must be a valid number.`,
            })
          }
        })

      const result = schema.safeParse(value)
      return result.success ? null : result.error.issues[0]?.message ?? "Invalid value."
    }
    case "CURRENCY": {
      const schema = z
        .union([z.string(), z.number(), z.null(), z.undefined()])
        .transform((input) => {
          if (typeof input === "number") {
            return String(input)
          }
          return typeof input === "string" ? input.trim() : ""
        })
        .superRefine((input, ctx) => {
          if (field.isRequired && input.length === 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${field.label} is required.`,
            })
            return
          }

          if (input.length > 0 && Number.isNaN(Number(input))) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${field.label} must be a valid amount.`,
            })
          }
        })

      const result = schema.safeParse(value)
      return result.success ? null : result.error.issues[0]?.message ?? "Invalid value."
    }
    case "PHONE": {
      const schema = z
        .string()
        .trim()
        .superRefine((input, ctx) => {
          if (field.isRequired && input.length === 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${field.label} is required.`,
            })
            return
          }

          if (input.length > 0 && !/^\+[1-9]\d{7,14}$/.test(input)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${field.label} must be a valid phone number.`,
            })
          }
        })

      const result = schema.safeParse(typeof value === "string" ? value : "")
      return result.success ? null : result.error.issues[0]?.message ?? "Invalid value."
    }
    case "DATE": {
      const rawValue = typeof value === "string" ? value : ""

      if (field.isRequired && rawValue.length === 0) {
        return `${field.label} is required.`
      }

      if (rawValue.length === 0) {
        return null
      }

      return parseDateInput(rawValue) === null
        ? `${field.label} must be a valid date.`
        : null
    }
    case "SELECT":
    case "RADIO": {
      const schema = z
        .union([z.string(), z.null(), z.undefined()])
        .superRefine((input, ctx) => {
          const nextValue = typeof input === "string" ? input : ""

          if (field.isRequired && nextValue.length === 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${field.label} is required.`,
            })
            return
          }

          if (nextValue.length > 0 && !field.options.includes(nextValue)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${field.label} has an invalid selection.`,
            })
          }
        })

      const result = schema.safeParse(value)
      return result.success ? null : result.error.issues[0]?.message ?? "Invalid value."
    }
    case "MULTI_SELECT": {
      const schema = z
        .array(z.string())
        .superRefine((input, ctx) => {
          if (field.isRequired && input.length === 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${field.label} requires at least one selection.`,
            })
          }

          if (input.some((item) => !field.options.includes(item))) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${field.label} has an invalid selection.`,
            })
          }
        })

      const result = schema.safeParse(Array.isArray(value) ? value : [])
      return result.success ? null : result.error.issues[0]?.message ?? "Invalid value."
    }
    case "CHECKBOX": {
      const schema = z.boolean().refine(
        (input) => !field.isRequired || input === true,
        `${field.label} must be enabled.`,
      )

      const result = schema.safeParse(value === true)
      return result.success ? null : result.error.issues[0]?.message ?? "Invalid value."
    }
    default:
      return null
  }
}

function FieldLabel({
  htmlFor,
  label,
  required = false,
  description,
}: {
  htmlFor?: string
  label: string
  required?: boolean
  description?: string | null
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={htmlFor} className="text-sm font-medium text-slate-700">
        {label}
        {required ? <span className="ml-1 text-rose-600">*</span> : null}
      </Label>
      {description ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 transition hover:text-slate-600"
              aria-label={`${label} description`}
            >
              <CircleHelp className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6} className="max-w-64">
            {description}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}

function EncryptedFieldShell({
  encrypted,
  children,
  className,
  iconClassName,
}: {
  encrypted?: boolean
  children: ReactNode
  className?: string
  iconClassName?: string
}) {
  return (
    <div className={cn("relative", className)}>
      {children}
      {encrypted ? (
        <Lock
          className={cn(
            "pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400",
            iconClassName,
          )}
        />
      ) : null}
    </div>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null
  }

  return <p className="text-xs text-rose-600">{message}</p>
}

function normalizeInitialCustomFieldValue(field: CustomField) {
  if (field.fieldType === "DATE") {
    const parsedDate = parseStoredDate(
      typeof field.value === "string" ? field.value : null,
    )
    return parsedDate ? format(parsedDate, "MM/dd/yyyy") : ""
  }

  if (field.fieldType === "PHONE") {
    return typeof field.value === "string" ? field.value : ""
  }

  if (field.fieldType === "CURRENCY") {
    return typeof field.value === "number"
      ? String(field.value)
      : typeof field.value === "string"
        ? field.value
        : ""
  }

  return field.value ?? null
}

function normalizeCustomFieldSubmissionValue(
  field: CustomField,
  value: unknown,
) {
  if (field.fieldType === "DATE") {
    const rawValue = typeof value === "string" ? value.trim() : ""
    if (!rawValue) {
      return null
    }

    const parsedDate = parseDateInput(rawValue)
    return parsedDate ? serializeDateOnly(parsedDate) : null
  }

  return value === "" ? null : (value ?? null)
}

function areValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

export function ContactOverviewForm({
  tenantId,
  contactId,
  initialContact,
  statusOptions,
}: ContactOverviewFormProps) {
  const router = useRouter()
  const initialDateOfBirth = parseStoredDate(initialContact.dateOfBirth)
  const [isSaving, setIsSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [firstName, setFirstName] = useState(initialContact.firstName)
  const [middleName, setMiddleName] = useState(initialContact.middleName ?? "")
  const [lastName, setLastName] = useState(initialContact.lastName)
  const [dateOfBirth, setDateOfBirth] = useState<Date | undefined>(
    initialDateOfBirth,
  )
  const [dateOfBirthInput, setDateOfBirthInput] = useState(
    initialDateOfBirth ? format(initialDateOfBirth, "MM/dd/yyyy") : "",
  )
  const [phone, setPhone] = useState(initialContact.phoneNumber ?? "")
  const [secondaryPhone, setSecondaryPhone] = useState(
    initialContact.secondaryPhoneNumber ?? "",
  )
  const [email, setEmail] = useState(initialContact.email ?? "")
  const [addressLine1, setAddressLine1] = useState(
    initialContact.address.addressLine1 ?? "",
  )
  const [addressLine2, setAddressLine2] = useState(
    initialContact.address.addressLine2 ?? "",
  )
  const [city, setCity] = useState(initialContact.address.city ?? "")
  const [state, setState] = useState(initialContact.address.state ?? "")
  const [postalCode, setPostalCode] = useState(
    initialContact.address.postalCode ?? "",
  )
  const [country, setCountry] = useState(initialContact.address.country ?? "")
  const [statusConfigId, setStatusConfigId] = useState(
    initialContact.statusConfigId ?? "__unassigned__",
  )
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>(
    () =>
      Object.fromEntries(
        initialContact.customFields.map((field) => [
          field.id,
          normalizeInitialCustomFieldValue(field),
        ]),
      ),
  )
  const parsedDateOfBirthInput = parseDateInput(dateOfBirthInput)
  const isDirty = useMemo(() => {
    const initialBaseState = {
      firstName: initialContact.firstName,
      middleName: initialContact.middleName ?? "",
      lastName: initialContact.lastName,
      dateOfBirth: initialDateOfBirth ? format(initialDateOfBirth, "MM/dd/yyyy") : "",
      phone: initialContact.phoneNumber ?? "",
      secondaryPhone: initialContact.secondaryPhoneNumber ?? "",
      email: initialContact.email ?? "",
      addressLine1: initialContact.address.addressLine1 ?? "",
      addressLine2: initialContact.address.addressLine2 ?? "",
      city: initialContact.address.city ?? "",
      state: initialContact.address.state ?? "",
      postalCode: initialContact.address.postalCode ?? "",
      country: initialContact.address.country ?? "",
      statusConfigId: initialContact.statusConfigId ?? "__unassigned__",
    }

    const currentBaseState = {
      firstName,
      middleName,
      lastName,
      dateOfBirth: dateOfBirthInput,
      phone,
      secondaryPhone,
      email,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      country,
      statusConfigId,
    }

    if (!areValuesEqual(initialBaseState, currentBaseState)) {
      return true
    }

    return initialContact.customFields.some((field) => {
      const initialValue = normalizeCustomFieldSubmissionValue(
        field,
        normalizeInitialCustomFieldValue(field),
      )
      const currentValue = normalizeCustomFieldSubmissionValue(
        field,
        customFieldValues[field.id],
      )

      return !areValuesEqual(initialValue, currentValue)
    })
  }, [
    addressLine1,
    addressLine2,
    city,
    country,
    customFieldValues,
    dateOfBirthInput,
    email,
    firstName,
    initialContact,
    initialDateOfBirth,
    lastName,
    middleName,
    phone,
    postalCode,
    secondaryPhone,
    state,
    statusConfigId,
  ])

  const validateForm = () => {
    const validationResult = baseContactSchema.safeParse({
      firstName,
      middleName,
      lastName,
      dateOfBirth:
        parsedDateOfBirthInput === null
          ? undefined
          : parsedDateOfBirthInput,
      phone,
      secondaryPhone,
      email,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      country,
      statusConfigId,
    })

    const nextErrors: FieldErrors = {}

    if (parsedDateOfBirthInput === null) {
      nextErrors.dateOfBirth = "Enter a valid date in MM/DD/YYYY format."
    }

    if (!validationResult.success) {
      for (const issue of validationResult.error.issues) {
        const key = issue.path[0]
        if (typeof key === "string" && !nextErrors[key]) {
          nextErrors[key] = issue.message
        }
      }
    }

    for (const field of initialContact.customFields) {
      const error = validateCustomField(field, customFieldValues[field.id])
      if (error) {
        nextErrors[`customFieldValues.${field.id}`] = error
      }
    }

    setFieldErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleSave = async () => {
    if (!validateForm()) {
      toast.error("Fix the highlighted fields before saving.")
      return
    }

    setIsSaving(true)
    setFieldErrors({})

    const dateOfBirthIso = serializeDateOnly(dateOfBirth)

    try {
      await api.patch(`/api/contacts/${tenantId}/${contactId}`, {
        firstName: firstName.trim(),
        middleName: middleName.trim() || null,
        lastName: lastName.trim(),
        dateOfBirth: dateOfBirthIso,
        phone: phone.trim() || null,
        secondaryPhone: secondaryPhone.trim() || null,
        email: email.trim() || null,
        addressLine1: addressLine1.trim() || null,
        addressLine2: addressLine2.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        postalCode: postalCode.trim() || null,
        country: country.trim() || null,
        statusConfigId:
          statusConfigId === "__unassigned__" ? null : statusConfigId,
        customFieldValues: initialContact.customFields.map((field) => ({
          fieldId: field.id,
          value: normalizeCustomFieldSubmissionValue(
            field,
            customFieldValues[field.id],
          ),
        })),
      })

      toast.success("Contact updated.")
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const responseData = error.response?.data as
          | {
              error?: string
              details?: Array<{ path?: string; message?: string }>
            }
          | undefined

        if (Array.isArray(responseData?.details)) {
          const mappedErrors: FieldErrors = {}
          for (const detail of responseData.details) {
            if (detail.path && detail.message) {
              mappedErrors[detail.path] = detail.message
            }
          }
          setFieldErrors(mappedErrors)
        }

        const backendError = responseData?.error
        if (typeof backendError === "string") {
          toast.error(backendError.replace(/_/g, " "))
        } else {
          toast.error("Could not update contact.")
        }
      } else {
        toast.error("Could not update contact.")
      }
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <TooltipProvider>
      <div className="grid gap-6">
        <div className="grid gap-6">
          <section className="space-y-4 rounded-xl border border-slate-100 p-4 md:p-5">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-900">Name</h3>
              <p className="text-sm text-slate-500">
                Primary identifying information for the contact.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="contact-overview-first-name"
                  label="First Name"
                  required
                />
                <Input
                  id="contact-overview-first-name"
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  aria-invalid={Boolean(fieldErrors.firstName)}
                />
                <FieldError message={fieldErrors.firstName} />
              </div>

              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="contact-overview-middle-name"
                  label="Middle Name"
                />
                <Input
                  id="contact-overview-middle-name"
                  value={middleName}
                  onChange={(event) => setMiddleName(event.target.value)}
                  placeholder="Optional"
                  aria-invalid={Boolean(fieldErrors.middleName)}
                />
                <FieldError message={fieldErrors.middleName} />
              </div>

              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="contact-overview-last-name"
                  label="Last Name"
                  required
                />
                <Input
                  id="contact-overview-last-name"
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  aria-invalid={Boolean(fieldErrors.lastName)}
                />
                <FieldError message={fieldErrors.lastName} />
              </div>
            </div>
          </section>

          <section className="space-y-4 rounded-xl border border-slate-100 p-4 md:p-5">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-900">
                Contact Details
              </h3>
              <p className="text-sm text-slate-500">
                Core communication and demographic data.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <FieldLabel htmlFor="contact-overview-dob" label="Date of Birth" />
                <DateInput
                  id="contact-overview-dob"
                  value={dateOfBirthInput}
                  onValueChange={(nextValue) => {
                    setDateOfBirthInput(nextValue)
                    if (fieldErrors.dateOfBirth) {
                      setFieldErrors((prev) => {
                        const next = { ...prev }
                        delete next.dateOfBirth
                        return next
                      })
                    }
                  }}
                  onDateChange={setDateOfBirth}
                  ariaInvalid={Boolean(fieldErrors.dateOfBirth)}
                />
                <FieldError message={fieldErrors.dateOfBirth} />
              </div>

              <div className="grid gap-2">
                <FieldLabel label="Status" />
                <Select value={statusConfigId} onValueChange={setStatusConfigId}>
                  <SelectTrigger aria-invalid={Boolean(fieldErrors.statusConfigId)}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned__">Unassigned</SelectItem>
                    {statusOptions.map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError message={fieldErrors.statusConfigId} />
              </div>

              <div className="grid gap-2">
                <FieldLabel htmlFor="contact-overview-phone" label="Phone Number" />
                <AppPhoneInput
                  id="contact-overview-phone"
                  defaultCountry="US"
                  countryCallingCodeEditable={false}
                  value={phone}
                  onChange={(value) => setPhone(value ?? "")}
                />
                <FieldError message={fieldErrors.phone} />
              </div>

              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="contact-overview-secondary-phone"
                  label="Secondary Phone"
                />
                <AppPhoneInput
                  id="contact-overview-secondary-phone"
                  defaultCountry="US"
                  countryCallingCodeEditable={false}
                  value={secondaryPhone}
                  onChange={(value) => setSecondaryPhone(value ?? "")}
                />
                <FieldError message={fieldErrors.secondaryPhone} />
              </div>

              <div className="grid gap-2 md:col-span-2">
                <FieldLabel htmlFor="contact-overview-email" label="Email" />
                <Input
                  id="contact-overview-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="jane@company.com"
                  aria-invalid={Boolean(fieldErrors.email)}
                />
                <FieldError message={fieldErrors.email} />
              </div>
            </div>
          </section>

          <section className="space-y-4 rounded-xl border border-slate-100 p-4 md:p-5">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-900">Address</h3>
              <p className="text-sm text-slate-500">
                Mailing and location-related details for this contact.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2 md:col-span-2">
                <FieldLabel
                  htmlFor="contact-overview-address-line-1"
                  label="Address Line 1"
                />
                <Input
                  id="contact-overview-address-line-1"
                  value={addressLine1}
                  onChange={(event) => setAddressLine1(event.target.value)}
                  aria-invalid={Boolean(fieldErrors.addressLine1)}
                />
                <FieldError message={fieldErrors.addressLine1} />
              </div>

              <div className="grid gap-2 md:col-span-2">
                <FieldLabel
                  htmlFor="contact-overview-address-line-2"
                  label="Address Line 2"
                />
                <Input
                  id="contact-overview-address-line-2"
                  value={addressLine2}
                  onChange={(event) => setAddressLine2(event.target.value)}
                  aria-invalid={Boolean(fieldErrors.addressLine2)}
                />
                <FieldError message={fieldErrors.addressLine2} />
              </div>

              <div className="grid gap-2">
                <FieldLabel htmlFor="contact-overview-city" label="City" />
                <Input
                  id="contact-overview-city"
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                  aria-invalid={Boolean(fieldErrors.city)}
                />
                <FieldError message={fieldErrors.city} />
              </div>

              <div className="grid gap-2">
                <FieldLabel htmlFor="contact-overview-state" label="State" />
                <Input
                  id="contact-overview-state"
                  value={state}
                  onChange={(event) => setState(event.target.value)}
                  aria-invalid={Boolean(fieldErrors.state)}
                />
                <FieldError message={fieldErrors.state} />
              </div>

              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="contact-overview-postal-code"
                  label="Postal Code"
                />
                <Input
                  id="contact-overview-postal-code"
                  value={postalCode}
                  onChange={(event) => setPostalCode(event.target.value)}
                  aria-invalid={Boolean(fieldErrors.postalCode)}
                />
                <FieldError message={fieldErrors.postalCode} />
              </div>

              <div className="grid gap-2">
                <FieldLabel htmlFor="contact-overview-country" label="Country" />
                <Input
                  id="contact-overview-country"
                  value={country}
                  onChange={(event) => setCountry(event.target.value)}
                  aria-invalid={Boolean(fieldErrors.country)}
                />
                <FieldError message={fieldErrors.country} />
              </div>
            </div>
          </section>

          {initialContact.customFields.length > 0 ? (
            <section className="space-y-4 rounded-xl border border-slate-100 p-4 md:p-5">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-slate-900">Custom Fields</h3>
                <p className="text-sm text-slate-500">
                  Tenant-defined fields for additional contact information.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {initialContact.customFields.map((field) => {
                  const value = customFieldValues[field.id]
                  const error =
                    fieldErrors[`customFieldValues.${field.id}`] ?? fieldErrors[field.id]
                  const isFullWidth =
                    field.fieldType === "TEXTAREA" || field.fieldType === "MULTI_SELECT"

                  return (
                    <div
                      key={field.id}
                      className={cn(
                        "grid gap-2",
                        isFullWidth && "md:col-span-2 lg:col-span-3",
                      )}
                    >
                      <FieldLabel
                        htmlFor={`custom-field-${field.id}`}
                        label={field.label}
                        required={field.isRequired}
                        description={field.description}
                      />

                      {field.fieldType === "TEXT" ? (
                        <EncryptedFieldShell
                          encrypted={field.isEncrypted}
                          className="w-full"
                        >
                          <Input
                            id={`custom-field-${field.id}`}
                            className={field.isEncrypted ? "pr-10" : undefined}
                            value={typeof value === "string" ? value : ""}
                            onChange={(event) =>
                              setCustomFieldValues((prev) => ({
                                ...prev,
                                [field.id]: event.target.value,
                              }))
                            }
                            aria-invalid={Boolean(error)}
                          />
                        </EncryptedFieldShell>
                      ) : field.fieldType === "NUMBER" ? (
                        <EncryptedFieldShell
                          encrypted={field.isEncrypted}
                          className="w-full"
                        >
                          <Input
                            id={`custom-field-${field.id}`}
                            inputMode="decimal"
                            className={field.isEncrypted ? "pr-10" : undefined}
                            value={
                              typeof value === "number"
                                ? String(value)
                                : typeof value === "string"
                                  ? value
                                  : ""
                            }
                            onChange={(event) =>
                              setCustomFieldValues((prev) => ({
                                ...prev,
                                [field.id]: event.target.value,
                              }))
                            }
                            aria-invalid={Boolean(error)}
                          />
                        </EncryptedFieldShell>
                      ) : field.fieldType === "CURRENCY" ? (
                        <EncryptedFieldShell
                          encrypted={field.isEncrypted}
                          className="w-full"
                        >
                          <div className="relative w-full">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                              $
                            </span>
                            <Input
                              id={`custom-field-${field.id}`}
                              inputMode="decimal"
                              className={cn(
                                "pl-7",
                                field.isEncrypted ? "pr-10" : undefined,
                              )}
                              value={
                                typeof value === "number"
                                  ? String(value)
                                  : typeof value === "string"
                                    ? value
                                    : ""
                              }
                              onChange={(event) =>
                                setCustomFieldValues((prev) => ({
                                  ...prev,
                                  [field.id]: event.target.value,
                                }))
                              }
                              aria-invalid={Boolean(error)}
                            />
                          </div>
                        </EncryptedFieldShell>
                      ) : field.fieldType === "PHONE" ? (
                        <EncryptedFieldShell
                          encrypted={field.isEncrypted}
                          className="w-full"
                        >
                          <AppPhoneInput
                            id={`custom-field-${field.id}`}
                            className={cn(
                              "w-full",
                              field.isEncrypted ? "pr-10" : undefined,
                            )}
                            defaultCountry="US"
                            countryCallingCodeEditable={false}
                            value={typeof value === "string" ? value : ""}
                            onChange={(nextValue) =>
                              setCustomFieldValues((prev) => ({
                                ...prev,
                                [field.id]: nextValue ?? "",
                              }))
                            }
                          />
                        </EncryptedFieldShell>
                      ) : field.fieldType === "DATE" ? (
                        <EncryptedFieldShell
                          encrypted={field.isEncrypted}
                          className="w-full"
                        >
                          <DateInput
                            id={`custom-field-${field.id}`}
                            className="w-full"
                            value={typeof value === "string" ? value : ""}
                            onValueChange={(nextValue) =>
                              setCustomFieldValues((prev) => ({
                                ...prev,
                                [field.id]: nextValue,
                              }))
                            }
                            onDateChange={(nextValue) =>
                              setCustomFieldValues((prev) => ({
                                ...prev,
                                [field.id]: nextValue
                                  ? format(nextValue, "MM/dd/yyyy")
                                  : "",
                              }))
                            }
                            ariaInvalid={Boolean(error)}
                          />
                        </EncryptedFieldShell>
                      ) : field.fieldType === "TEXTAREA" ? (
                        <EncryptedFieldShell
                          encrypted={field.isEncrypted}
                          className="w-full"
                          iconClassName="top-4 -translate-y-0"
                        >
                          <Textarea
                            id={`custom-field-${field.id}`}
                            className={field.isEncrypted ? "pr-10" : undefined}
                            value={typeof value === "string" ? value : ""}
                            onChange={(event) =>
                              setCustomFieldValues((prev) => ({
                                ...prev,
                                [field.id]: event.target.value,
                              }))
                            }
                            aria-invalid={Boolean(error)}
                          />
                        </EncryptedFieldShell>
                      ) : field.fieldType === "CHECKBOX" ? (
                        <EncryptedFieldShell
                          encrypted={field.isEncrypted}
                          className="w-full"
                        >
                          <div
                            className={cn(
                              "flex h-10 items-center gap-3 rounded-md border border-slate-200 px-3",
                              field.isEncrypted ? "pr-10" : undefined,
                              error ? "border-destructive" : undefined,
                            )}
                          >
                            <Checkbox
                              id={`custom-field-${field.id}`}
                              checked={value === true}
                              onCheckedChange={(checked) =>
                                setCustomFieldValues((prev) => ({
                                  ...prev,
                                  [field.id]: checked === true,
                                }))
                              }
                            />
                            <span className="text-sm text-slate-700">Enabled</span>
                          </div>
                        </EncryptedFieldShell>
                      ) : field.fieldType === "MULTI_SELECT" ? (
                        <EncryptedFieldShell
                          encrypted={field.isEncrypted}
                          className="w-full"
                          iconClassName="top-4 -translate-y-0"
                        >
                          <div
                            className={cn(
                              "grid w-full gap-2 rounded-md border border-slate-200 p-3",
                              field.isEncrypted ? "pr-10" : undefined,
                              error ? "border-destructive" : undefined,
                            )}
                          >
                            {field.options.map((option) => {
                              const selected = Array.isArray(value)
                                ? value.includes(option)
                                : false
                              return (
                                <label
                                  key={option}
                                  className="flex items-center gap-3 text-sm text-slate-700"
                                >
                                  <Checkbox
                                    checked={selected}
                                    onCheckedChange={(checked) => {
                                      const nextValues = Array.isArray(value) ? [...value] : []
                                      const updatedValues =
                                        checked === true
                                          ? Array.from(new Set([...nextValues, option]))
                                          : nextValues.filter((item) => item !== option)

                                      setCustomFieldValues((prev) => ({
                                        ...prev,
                                        [field.id]: updatedValues,
                                      }))
                                    }}
                                  />
                                  <span>{option}</span>
                                </label>
                              )
                            })}
                          </div>
                        </EncryptedFieldShell>
                      ) : (
                        <EncryptedFieldShell
                          encrypted={field.isEncrypted}
                          className="w-full"
                        >
                          <Select
                            value={typeof value === "string" ? value : "__empty__"}
                            onValueChange={(nextValue) =>
                              setCustomFieldValues((prev) => ({
                                ...prev,
                                [field.id]: nextValue === "__empty__" ? null : nextValue,
                              }))
                            }
                          >
                            <SelectTrigger
                              id={`custom-field-${field.id}`}
                              className={cn(
                                "w-full",
                                field.isEncrypted ? "pr-10" : undefined,
                              )}
                              aria-invalid={Boolean(error)}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__empty__">No selection</SelectItem>
                              {field.options.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </EncryptedFieldShell>
                      )}

                      <FieldError message={error} />
                    </div>
                  )
                })}
              </div>
            </section>
          ) : null}

          {isDirty ? (
            <div className="sticky bottom-4 z-20 flex justify-end">
              <div className="flex items-center rounded-2xl border border-slate-200 bg-white/95 px-3 py-3 shadow-lg backdrop-blur supports-backdrop-filter:bg-white/85">
                <Button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={isSaving}
                  className="bg-blue-950 text-white hover:bg-blue-950/90"
                >
                  <Save className="h-4 w-4" />
                  {isSaving ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </TooltipProvider>
  )
}
