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
  SelectGroup,
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
import { ContactTagsSection } from "../../_components/contact-tags-section"

type StatusOption = {
  label: string
  value: string
}

type ContactGender = "FEMALE" | "MALE" | "NON_BINARY" | "OTHER" | "UNKNOWN"
type ContactSmokerStatus = "UNKNOWN" | "NEVER" | "CURRENT" | "FORMER"

type ContactOverviewFormProps = {
  tenantId: string
  contactId: string
  currentUserId: string
  membershipSecurityLevel: "LOW" | "MEDIUM" | "MAX"
  canApproveSensitiveFieldAccess: boolean
  canManageTags: boolean
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
    mailingAddress: {
      addressLine1: string | null
      addressLine2: string | null
      city: string | null
      state: string | null
      postalCode: string | null
      country: string | null
    }
    emergencyContactName: string | null
    emergencyContactPhone: string | null
    emergencyContactRelationship: string | null
    gender: ContactGender | null
    height: string | null
    weight: string | null
    deceasedAt: string | null
    smokerStatus: ContactSmokerStatus | null
    leadDate: string | null
    leadSource: string | null
    leadOtherSource: string | null
    statusConfigId: string
    tags: Array<{
      id: string
      name: string
      bgColor: string
      textColor: string
      sortOrder: number
    }>
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
      isSensitive: boolean
      options: string[]
      sortOrder: number
      value: unknown
      isValueRestricted: boolean
      canRequestAccess: boolean
      hasAccessGrant: boolean
      pendingAccessRequest: {
        id: string
        status: "PENDING"
        createdAt: string
      } | null
      pendingApprovals: Array<{
        id: string
        status: "PENDING"
        createdAt: string
        requesterUserId: string
        requesterName: string
        requesterEmail: string
      }>
    }>
  }
  statusOptions: StatusOption[]
  leadSourceOptions: StatusOption[]
}

type CustomField = ContactOverviewFormProps["initialContact"]["customFields"][number]
type FieldErrors = Partial<Record<string, string>>

const PROFILE_SELECT_TRIGGER_CLASSNAME =
  "h-9 w-full cursor-pointer rounded-full border-border/80 bg-background/80 px-3 text-sm font-medium text-foreground shadow-sm backdrop-blur transition-colors hover:bg-accent/70 hover:text-accent-foreground"
const COMPACT_SELECT_TRIGGER_CLASSNAME =
  "h-8 w-full cursor-pointer rounded-full border-border/80 bg-background/80 px-3 text-xs font-semibold text-foreground shadow-sm backdrop-blur transition-colors hover:bg-accent/70 hover:text-accent-foreground"

const SENSITIVE_ACCESS_GRANT_OPTIONS = [
  { value: "ONCE", label: "One time" },
  { value: "15M", label: "15 minutes" },
  { value: "30M", label: "30 minutes" },
  { value: "1H", label: "1 hour" },
  { value: "2H", label: "2 hours" },
  { value: "4H", label: "4 hours" },
  { value: "8H", label: "8 hours" },
  { value: "12H", label: "12 hours" },
] as const

type SensitiveAccessGrantOption = (typeof SENSITIVE_ACCESS_GRANT_OPTIONS)[number]["value"]

const optionalStringSchema = z.string().trim().max(255)
const optionalPhoneSchema = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || /^\+[1-9]\d{7,14}$/.test(value),
    "Enter a valid phone number.",
  )

const contactGenderSchema = z.enum([
  "FEMALE",
  "MALE",
  "NON_BINARY",
  "OTHER",
  "UNKNOWN",
])
const contactSmokerStatusSchema = z.enum([
  "UNKNOWN",
  "NEVER",
  "CURRENT",
  "FORMER",
])

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
  mailingAddressLine1: optionalStringSchema,
  mailingAddressLine2: optionalStringSchema,
  mailingCity: optionalStringSchema,
  mailingState: optionalStringSchema,
  mailingPostalCode: z.string().trim().max(40, "Postal code is too long."),
  mailingCountry: optionalStringSchema,
  emergencyContactName: optionalStringSchema,
  emergencyContactPhone: optionalPhoneSchema,
  emergencyContactRelationship: optionalStringSchema,
  gender: z.union([contactGenderSchema, z.literal("")]),
  height: z.string().trim().max(60),
  weight: z.string().trim().max(60),
  deceasedAt: z.date().optional(),
  smokerStatus: z.union([contactSmokerStatusSchema, z.literal("")]),
  leadDate: z.date().optional(),
  leadSource: z.string().trim().max(80),
  leadOtherSource: z.string().trim().max(160),
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
  currentUserId,
  membershipSecurityLevel,
  canApproveSensitiveFieldAccess,
  canManageTags,
  initialContact,
  statusOptions,
  leadSourceOptions,
}: ContactOverviewFormProps) {
  const router = useRouter()
  const initialDateOfBirth = parseStoredDate(initialContact.dateOfBirth)
  const initialDeceasedAt = parseStoredDate(initialContact.deceasedAt)
  const initialLeadDate = parseStoredDate(initialContact.leadDate)
  const [isSaving, setIsSaving] = useState(false)
  const [requestingFieldId, setRequestingFieldId] = useState<string | null>(null)
  const [resolvingRequestId, setResolvingRequestId] = useState<string | null>(null)
  const [grantOptionByRequestId, setGrantOptionByRequestId] = useState<
    Record<string, SensitiveAccessGrantOption>
  >({})
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
  const [hasDifferentMailingAddress, setHasDifferentMailingAddress] = useState(
    () => Object.values(initialContact.mailingAddress).some(Boolean),
  )
  const [mailingAddressLine1, setMailingAddressLine1] = useState(
    initialContact.mailingAddress.addressLine1 ?? "",
  )
  const [mailingAddressLine2, setMailingAddressLine2] = useState(
    initialContact.mailingAddress.addressLine2 ?? "",
  )
  const [mailingCity, setMailingCity] = useState(
    initialContact.mailingAddress.city ?? "",
  )
  const [mailingState, setMailingState] = useState(
    initialContact.mailingAddress.state ?? "",
  )
  const [mailingPostalCode, setMailingPostalCode] = useState(
    initialContact.mailingAddress.postalCode ?? "",
  )
  const [mailingCountry, setMailingCountry] = useState(
    initialContact.mailingAddress.country ?? "",
  )
  const [emergencyContactName, setEmergencyContactName] = useState(
    initialContact.emergencyContactName ?? "",
  )
  const [emergencyContactPhone, setEmergencyContactPhone] = useState(
    initialContact.emergencyContactPhone ?? "",
  )
  const [emergencyContactRelationship, setEmergencyContactRelationship] = useState(
    initialContact.emergencyContactRelationship ?? "",
  )
  const [gender, setGender] = useState<ContactGender | "">(
    initialContact.gender ?? "",
  )
  const [height, setHeight] = useState(initialContact.height ?? "")
  const [weight, setWeight] = useState(initialContact.weight ?? "")
  const [deceasedAt, setDeceasedAt] = useState<Date | undefined>(initialDeceasedAt)
  const [deceasedAtInput, setDeceasedAtInput] = useState(
    initialDeceasedAt ? format(initialDeceasedAt, "MM/dd/yyyy") : "",
  )
  const [smokerStatus, setSmokerStatus] = useState<ContactSmokerStatus | "">(
    initialContact.smokerStatus ?? "",
  )
  const [leadDate, setLeadDate] = useState<Date | undefined>(initialLeadDate)
  const [leadDateInput, setLeadDateInput] = useState(
    initialLeadDate ? format(initialLeadDate, "MM/dd/yyyy") : "",
  )
  const [leadSource, setLeadSource] = useState(initialContact.leadSource ?? "")
  const [leadOtherSource, setLeadOtherSource] = useState(
    initialContact.leadOtherSource ?? "",
  )
  const [statusConfigId, setStatusConfigId] = useState(
    initialContact.statusConfigId,
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
  const parsedDeceasedAtInput = parseDateInput(deceasedAtInput)
  const parsedLeadDateInput = parseDateInput(leadDateInput)
  const editableCustomFields = useMemo(
    () =>
      initialContact.customFields.filter(
        (field) => !(field.isSensitive && field.isValueRestricted),
      ),
    [initialContact.customFields],
  )
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
      hasDifferentMailingAddress: Object.values(initialContact.mailingAddress).some(Boolean),
      mailingAddressLine1: initialContact.mailingAddress.addressLine1 ?? "",
      mailingAddressLine2: initialContact.mailingAddress.addressLine2 ?? "",
      mailingCity: initialContact.mailingAddress.city ?? "",
      mailingState: initialContact.mailingAddress.state ?? "",
      mailingPostalCode: initialContact.mailingAddress.postalCode ?? "",
      mailingCountry: initialContact.mailingAddress.country ?? "",
      emergencyContactName: initialContact.emergencyContactName ?? "",
      emergencyContactPhone: initialContact.emergencyContactPhone ?? "",
      emergencyContactRelationship:
        initialContact.emergencyContactRelationship ?? "",
      gender: initialContact.gender ?? "",
      height: initialContact.height ?? "",
      weight: initialContact.weight ?? "",
      deceasedAt: initialDeceasedAt ? format(initialDeceasedAt, "MM/dd/yyyy") : "",
      smokerStatus: initialContact.smokerStatus ?? "",
      leadDate: initialLeadDate ? format(initialLeadDate, "MM/dd/yyyy") : "",
      leadSource: initialContact.leadSource ?? "",
      leadOtherSource: initialContact.leadOtherSource ?? "",
      statusConfigId: initialContact.statusConfigId,
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
      hasDifferentMailingAddress,
      mailingAddressLine1,
      mailingAddressLine2,
      mailingCity,
      mailingState,
      mailingPostalCode,
      mailingCountry,
      emergencyContactName,
      emergencyContactPhone,
      emergencyContactRelationship,
      gender,
      height,
      weight,
      deceasedAt: deceasedAtInput,
      smokerStatus,
      leadDate: leadDateInput,
      leadSource,
      leadOtherSource,
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
    emergencyContactName,
    emergencyContactPhone,
    emergencyContactRelationship,
    firstName,
    gender,
    hasDifferentMailingAddress,
    height,
    initialContact,
    initialDateOfBirth,
    initialDeceasedAt,
    initialLeadDate,
    lastName,
    leadDateInput,
    leadOtherSource,
    leadSource,
    mailingAddressLine1,
    mailingAddressLine2,
    mailingCity,
    mailingCountry,
    mailingPostalCode,
    mailingState,
    middleName,
    phone,
    postalCode,
    secondaryPhone,
    smokerStatus,
    state,
    statusConfigId,
    deceasedAtInput,
    weight,
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
      mailingAddressLine1,
      mailingAddressLine2,
      mailingCity,
      mailingState,
      mailingPostalCode,
      mailingCountry,
      emergencyContactName,
      emergencyContactPhone,
      emergencyContactRelationship,
      gender,
      height,
      weight,
      deceasedAt:
        parsedDeceasedAtInput === null ? undefined : parsedDeceasedAtInput,
      smokerStatus,
      leadDate: parsedLeadDateInput === null ? undefined : parsedLeadDateInput,
      leadSource,
      leadOtherSource,
      statusConfigId,
    })

    const nextErrors: FieldErrors = {}

    if (parsedDateOfBirthInput === null) {
      nextErrors.dateOfBirth = "Enter a valid date in MM/DD/YYYY format."
    }
    if (parsedDeceasedAtInput === null) {
      nextErrors.deceasedAt = "Enter a valid date in MM/DD/YYYY format."
    }
    if (parsedLeadDateInput === null) {
      nextErrors.leadDate = "Enter a valid date in MM/DD/YYYY format."
    }
    if (
      leadSource &&
      !leadSourceOptions.some((option) => option.value === leadSource)
    ) {
      nextErrors.leadSource = "Select a configured lead source."
    }

    if (!validationResult.success) {
      for (const issue of validationResult.error.issues) {
        const key = issue.path[0]
        if (typeof key === "string" && !nextErrors[key]) {
          nextErrors[key] = issue.message
        }
      }
    }

    for (const field of editableCustomFields) {
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
    const deceasedAtIso = serializeDateOnly(deceasedAt)
    const leadDateIso = serializeDateOnly(leadDate)

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
        mailingAddressLine1: hasDifferentMailingAddress
          ? mailingAddressLine1.trim() || null
          : null,
        mailingAddressLine2: hasDifferentMailingAddress
          ? mailingAddressLine2.trim() || null
          : null,
        mailingCity: hasDifferentMailingAddress
          ? mailingCity.trim() || null
          : null,
        mailingState: hasDifferentMailingAddress
          ? mailingState.trim() || null
          : null,
        mailingPostalCode: hasDifferentMailingAddress
          ? mailingPostalCode.trim() || null
          : null,
        mailingCountry: hasDifferentMailingAddress
          ? mailingCountry.trim() || null
          : null,
        emergencyContactName: emergencyContactName.trim() || null,
        emergencyContactPhone: emergencyContactPhone.trim() || null,
        emergencyContactRelationship:
          emergencyContactRelationship.trim() || null,
        gender: gender || null,
        height: height.trim() || null,
        weight: weight.trim() || null,
        deceasedAt: deceasedAtIso,
        smokerStatus: smokerStatus || null,
        leadDate: leadDateIso,
        leadSource: leadSource || null,
        leadOtherSource: leadOtherSource.trim() || null,
        statusConfigId,
        customFieldValues: editableCustomFields.map((field) => ({
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

  const handleRequestSensitiveFieldAccess = async (fieldId: string) => {
    setRequestingFieldId(fieldId)
    try {
      await api.post(`/api/contacts/${tenantId}/custom-field-access-requests`, {
        fieldId,
      })
      toast.success("Access request sent.")
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        if (backendError === "CUSTOM_FIELD_ACCESS_REQUEST_ALREADY_PENDING") {
          toast.info("An access request is already pending.")
        } else if (backendError === "CUSTOM_FIELD_ACCESS_ALREADY_GRANTED") {
          toast.info("Access is already granted.")
        } else {
          toast.error("Could not submit access request.")
        }
      } else {
        toast.error("Could not submit access request.")
      }
    } finally {
      setRequestingFieldId(null)
    }
  }

  const handleResolveSensitiveFieldAccess = async (
    requestId: string,
    action: "approve" | "reject",
  ) => {
    setResolvingRequestId(requestId)
    try {
      const selectedOption = grantOptionByRequestId[requestId] ?? "ONCE"
      await api.post(
        `/api/contacts/${tenantId}/custom-field-access-requests/${requestId}/${action}`,
        action === "approve" ? resolveGrantPayload(selectedOption) : {},
      )
      toast.success(action === "approve" ? "Access approved." : "Access request rejected.")
      router.refresh()
    } catch {
      toast.error("Could not update access request.")
    } finally {
      setResolvingRequestId(null)
    }
  }

  const resolveGrantPayload = (option: SensitiveAccessGrantOption) => {
    if (option === "ONCE") {
      return { grantMode: "ONCE" as const }
    }

    if (option.endsWith("M")) {
      return {
        grantMode: "MINUTES" as const,
        durationValue: Number(option.replace("M", "")),
      }
    }

    return {
      grantMode: "HOURS" as const,
      durationValue: Number(option.replace("H", "")),
    }
  }

  return (
    <TooltipProvider>
      <div className="grid gap-4">
        <div className="grid gap-4">
          <section className="space-y-4 rounded-xl border border-slate-100 p-4 md:p-5">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-900">Name</h3>
              <p className="text-sm text-slate-500">
                Primary identifying information for the contact.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-3 [&>*]:min-w-0">
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

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 [&>*]:min-w-0">
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
                  <SelectTrigger
                    className={PROFILE_SELECT_TRIGGER_CLASSNAME}
                    aria-invalid={Boolean(fieldErrors.statusConfigId)}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {statusOptions.map((status) => (
                        <SelectItem
                          key={status.value}
                          value={status.value}
                          className="cursor-pointer"
                        >
                          {status.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
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
              <h3 className="text-sm font-semibold text-slate-900">
                Personal Details
              </h3>
              <p className="text-sm text-slate-500">
                Demographic and health-related profile information.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 [&>*]:min-w-0">
              <div className="grid gap-2">
                <FieldLabel label="Gender" />
                <Select
                  value={gender || "__empty__"}
                  onValueChange={(value) =>
                    setGender(
                      value === "__empty__" ? "" : (value as ContactGender),
                    )
                  }
                >
                  <SelectTrigger
                    className={PROFILE_SELECT_TRIGGER_CLASSNAME}
                    aria-invalid={Boolean(fieldErrors.gender)}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="__empty__" className="cursor-pointer">
                        No selection
                      </SelectItem>
                      <SelectItem value="FEMALE" className="cursor-pointer">
                        Female
                      </SelectItem>
                      <SelectItem value="MALE" className="cursor-pointer">
                        Male
                      </SelectItem>
                      <SelectItem value="NON_BINARY" className="cursor-pointer">
                        Non-binary
                      </SelectItem>
                      <SelectItem value="OTHER" className="cursor-pointer">
                        Other
                      </SelectItem>
                      <SelectItem value="UNKNOWN" className="cursor-pointer">
                        Unknown
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldError message={fieldErrors.gender} />
              </div>

              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <div className="grid min-w-0 gap-2">
                  <FieldLabel htmlFor="contact-overview-height" label="Height" />
                  <Input
                    id="contact-overview-height"
                    value={height}
                    onChange={(event) => setHeight(event.target.value)}
                    placeholder="5 ft 8 in"
                    maxLength={60}
                    aria-invalid={Boolean(fieldErrors.height)}
                  />
                  <FieldError message={fieldErrors.height} />
                </div>

                <div className="grid min-w-0 gap-2">
                  <FieldLabel htmlFor="contact-overview-weight" label="Weight" />
                  <Input
                    id="contact-overview-weight"
                    value={weight}
                    onChange={(event) => setWeight(event.target.value)}
                    placeholder="165 lb"
                    maxLength={60}
                    aria-invalid={Boolean(fieldErrors.weight)}
                  />
                  <FieldError message={fieldErrors.weight} />
                </div>
              </div>

              <div className="grid gap-2">
                <FieldLabel label="Smoker Status" />
                <Select
                  value={smokerStatus || "__empty__"}
                  onValueChange={(value) =>
                    setSmokerStatus(
                      value === "__empty__"
                        ? ""
                        : (value as ContactSmokerStatus),
                    )
                  }
                >
                  <SelectTrigger
                    className={PROFILE_SELECT_TRIGGER_CLASSNAME}
                    aria-invalid={Boolean(fieldErrors.smokerStatus)}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="__empty__" className="cursor-pointer">
                        No selection
                      </SelectItem>
                      <SelectItem value="NEVER" className="cursor-pointer">
                        Never
                      </SelectItem>
                      <SelectItem value="CURRENT" className="cursor-pointer">
                        Current
                      </SelectItem>
                      <SelectItem value="FORMER" className="cursor-pointer">
                        Former
                      </SelectItem>
                      <SelectItem value="UNKNOWN" className="cursor-pointer">
                        Unknown
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldError message={fieldErrors.smokerStatus} />
              </div>

              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="contact-overview-deceased-at"
                  label="Deceased Date"
                />
                <DateInput
                  id="contact-overview-deceased-at"
                  value={deceasedAtInput}
                  onValueChange={(nextValue) => {
                    setDeceasedAtInput(nextValue)
                    if (fieldErrors.deceasedAt) {
                      setFieldErrors((previous) => {
                        const next = { ...previous }
                        delete next.deceasedAt
                        return next
                      })
                    }
                  }}
                  onDateChange={setDeceasedAt}
                  ariaInvalid={Boolean(fieldErrors.deceasedAt)}
                />
                <FieldError message={fieldErrors.deceasedAt} />
              </div>
            </div>
          </section>

          <section className="space-y-4 rounded-xl border border-slate-100 p-4 md:p-5">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-900">Address</h3>
              <p className="text-sm text-slate-500">
                Primary and optional mailing details for this contact.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 [&>*]:min-w-0">
              <div className="grid gap-2 md:col-span-2 lg:col-span-3 xl:col-span-2">
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

              <div className="grid gap-2 md:col-span-2 lg:col-span-3 xl:col-span-2">
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

            <div className="border-t border-slate-100 pt-4">
              <label
                htmlFor="contact-overview-different-mailing-address"
                className="flex cursor-pointer items-center gap-3 text-sm font-medium text-slate-700"
              >
                <Checkbox
                  id="contact-overview-different-mailing-address"
                  checked={hasDifferentMailingAddress}
                  onCheckedChange={(checked) => {
                    const enabled = checked === true
                    setHasDifferentMailingAddress(enabled)
                    if (!enabled) {
                      setMailingAddressLine1("")
                      setMailingAddressLine2("")
                      setMailingCity("")
                      setMailingState("")
                      setMailingPostalCode("")
                      setMailingCountry("")
                    }
                  }}
                />
                Mailing address is different from the primary address
              </label>
            </div>

            {hasDifferentMailingAddress ? (
              <div className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 [&>*]:min-w-0">
                <div className="grid gap-2 md:col-span-2 lg:col-span-3 xl:col-span-2">
                  <FieldLabel
                    htmlFor="contact-overview-mailing-address-line-1"
                    label="Mailing Address Line 1"
                  />
                  <Input
                    id="contact-overview-mailing-address-line-1"
                    value={mailingAddressLine1}
                    onChange={(event) => setMailingAddressLine1(event.target.value)}
                    aria-invalid={Boolean(fieldErrors.mailingAddressLine1)}
                  />
                  <FieldError message={fieldErrors.mailingAddressLine1} />
                </div>

                <div className="grid gap-2 md:col-span-2 lg:col-span-3 xl:col-span-2">
                  <FieldLabel
                    htmlFor="contact-overview-mailing-address-line-2"
                    label="Mailing Address Line 2"
                  />
                  <Input
                    id="contact-overview-mailing-address-line-2"
                    value={mailingAddressLine2}
                    onChange={(event) => setMailingAddressLine2(event.target.value)}
                    aria-invalid={Boolean(fieldErrors.mailingAddressLine2)}
                  />
                  <FieldError message={fieldErrors.mailingAddressLine2} />
                </div>

                <div className="grid gap-2">
                  <FieldLabel htmlFor="contact-overview-mailing-city" label="Mailing City" />
                  <Input
                    id="contact-overview-mailing-city"
                    value={mailingCity}
                    onChange={(event) => setMailingCity(event.target.value)}
                    aria-invalid={Boolean(fieldErrors.mailingCity)}
                  />
                  <FieldError message={fieldErrors.mailingCity} />
                </div>

                <div className="grid gap-2">
                  <FieldLabel htmlFor="contact-overview-mailing-state" label="Mailing State" />
                  <Input
                    id="contact-overview-mailing-state"
                    value={mailingState}
                    onChange={(event) => setMailingState(event.target.value)}
                    aria-invalid={Boolean(fieldErrors.mailingState)}
                  />
                  <FieldError message={fieldErrors.mailingState} />
                </div>

                <div className="grid gap-2">
                  <FieldLabel
                    htmlFor="contact-overview-mailing-postal-code"
                    label="Mailing Postal Code"
                  />
                  <Input
                    id="contact-overview-mailing-postal-code"
                    value={mailingPostalCode}
                    onChange={(event) => setMailingPostalCode(event.target.value)}
                    aria-invalid={Boolean(fieldErrors.mailingPostalCode)}
                  />
                  <FieldError message={fieldErrors.mailingPostalCode} />
                </div>

                <div className="grid gap-2">
                  <FieldLabel
                    htmlFor="contact-overview-mailing-country"
                    label="Mailing Country"
                  />
                  <Input
                    id="contact-overview-mailing-country"
                    value={mailingCountry}
                    onChange={(event) => setMailingCountry(event.target.value)}
                    aria-invalid={Boolean(fieldErrors.mailingCountry)}
                  />
                  <FieldError message={fieldErrors.mailingCountry} />
                </div>
              </div>
            ) : null}
          </section>

          <section className="space-y-4 rounded-xl border border-slate-100 p-4 md:p-5">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-900">
                Emergency Contact
              </h3>
              <p className="text-sm text-slate-500">
                Optional person to contact in an emergency.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-3 [&>*]:min-w-0">
              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="contact-overview-emergency-name"
                  label="Name"
                />
                <Input
                  id="contact-overview-emergency-name"
                  value={emergencyContactName}
                  onChange={(event) => setEmergencyContactName(event.target.value)}
                  aria-invalid={Boolean(fieldErrors.emergencyContactName)}
                />
                <FieldError message={fieldErrors.emergencyContactName} />
              </div>

              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="contact-overview-emergency-phone"
                  label="Phone"
                />
                <AppPhoneInput
                  id="contact-overview-emergency-phone"
                  defaultCountry="US"
                  countryCallingCodeEditable={false}
                  value={emergencyContactPhone}
                  onChange={(value) => setEmergencyContactPhone(value ?? "")}
                />
                <FieldError message={fieldErrors.emergencyContactPhone} />
              </div>

              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="contact-overview-emergency-relationship"
                  label="Relationship"
                />
                <Input
                  id="contact-overview-emergency-relationship"
                  value={emergencyContactRelationship}
                  onChange={(event) =>
                    setEmergencyContactRelationship(event.target.value)
                  }
                  aria-invalid={Boolean(fieldErrors.emergencyContactRelationship)}
                />
                <FieldError message={fieldErrors.emergencyContactRelationship} />
              </div>
            </div>
          </section>

          <section className="space-y-4 rounded-xl border border-slate-100 p-4 md:p-5">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-900">Lead Details</h3>
              <p className="text-sm text-slate-500">
                Track when and how this contact became a lead.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-3 [&>*]:min-w-0">
              <div className="grid gap-2">
                <FieldLabel htmlFor="contact-overview-lead-date" label="Lead Date" />
                <DateInput
                  id="contact-overview-lead-date"
                  value={leadDateInput}
                  onValueChange={(nextValue) => {
                    setLeadDateInput(nextValue)
                    if (fieldErrors.leadDate) {
                      setFieldErrors((previous) => {
                        const next = { ...previous }
                        delete next.leadDate
                        return next
                      })
                    }
                  }}
                  onDateChange={setLeadDate}
                  ariaInvalid={Boolean(fieldErrors.leadDate)}
                />
                <FieldError message={fieldErrors.leadDate} />
              </div>

              <div className="grid gap-2">
                <FieldLabel label="Lead Source" />
                <Select
                  value={leadSource || "__empty__"}
                  onValueChange={(value) =>
                    setLeadSource(value === "__empty__" ? "" : value)
                  }
                >
                  <SelectTrigger
                    className={PROFILE_SELECT_TRIGGER_CLASSNAME}
                    aria-invalid={Boolean(fieldErrors.leadSource)}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="__empty__" className="cursor-pointer">
                        No selection
                      </SelectItem>
                      {leadSourceOptions.map((option) => (
                        <SelectItem
                          key={option.value}
                          value={option.value}
                          className="cursor-pointer"
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldError message={fieldErrors.leadSource} />
              </div>

              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="contact-overview-lead-other-source"
                  label="Lead Other Source"
                />
                <Input
                  id="contact-overview-lead-other-source"
                  value={leadOtherSource}
                  onChange={(event) => setLeadOtherSource(event.target.value)}
                  maxLength={160}
                  aria-invalid={Boolean(fieldErrors.leadOtherSource)}
                />
                <FieldError message={fieldErrors.leadOtherSource} />
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

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {initialContact.customFields.map((field) => {
                  const value = customFieldValues[field.id]
                  const error =
                    fieldErrors[`customFieldValues.${field.id}`] ?? fieldErrors[field.id]
                  const isFullWidth =
                    field.fieldType === "TEXTAREA" || field.fieldType === "MULTI_SELECT"
                  const approvalsForOthers = field.pendingApprovals.filter(
                    (request) => request.requesterUserId !== currentUserId,
                  )

                  return (
                    <div
                      key={field.id}
                      className={cn(
                        "grid min-w-0 gap-2",
                        isFullWidth &&
                          "md:col-span-2 lg:col-span-3 xl:col-span-4",
                      )}
                    >
                      <FieldLabel
                        htmlFor={`custom-field-${field.id}`}
                        label={field.label}
                        required={field.isRequired}
                        description={field.description}
                      />

                      {canApproveSensitiveFieldAccess && approvalsForOthers.length > 0 ? (
                        <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-900">
                          <p className="mb-2 font-medium">
                            Pending sensitive-access requests
                          </p>
                          <div className="space-y-2">
                            {approvalsForOthers.map((request) => (
                              <div
                                key={request.id}
                                className="rounded-md border border-indigo-200 bg-white p-2.5"
                              >
                                <p className="font-medium text-slate-900">{request.requesterName}</p>
                                <p className="text-slate-600">{request.requesterEmail}</p>
                                <div className="mt-2">
                                  <Select
                                    value={grantOptionByRequestId[request.id] ?? "ONCE"}
                                    onValueChange={(nextValue) => {
                                      const allowed = SENSITIVE_ACCESS_GRANT_OPTIONS.some(
                                        (item) => item.value === nextValue,
                                      )
                                      if (!allowed) return
                                      setGrantOptionByRequestId((prev) => ({
                                        ...prev,
                                        [request.id]: nextValue as SensitiveAccessGrantOption,
                                      }))
                                    }}
                                  >
                                    <SelectTrigger
                                      className={COMPACT_SELECT_TRIGGER_CLASSNAME}
                                    >
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectGroup>
                                        {SENSITIVE_ACCESS_GRANT_OPTIONS.map((option) => (
                                          <SelectItem
                                            key={option.value}
                                            value={option.value}
                                            className="cursor-pointer"
                                          >
                                            {option.label}
                                          </SelectItem>
                                        ))}
                                      </SelectGroup>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="mt-2 flex items-center gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="h-7 cursor-pointer bg-emerald-600 px-2.5 text-xs text-white hover:bg-emerald-700"
                                    disabled={resolvingRequestId === request.id}
                                    onClick={() =>
                                      void handleResolveSensitiveFieldAccess(
                                        request.id,
                                        "approve",
                                      )
                                    }
                                  >
                                    Approve
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 cursor-pointer px-2.5 text-xs"
                                    disabled={resolvingRequestId === request.id}
                                    onClick={() =>
                                      void handleResolveSensitiveFieldAccess(
                                        request.id,
                                        "reject",
                                      )
                                    }
                                  >
                                    Reject
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {field.isSensitive && field.isValueRestricted ? (
                        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                              <p className="font-medium">Restricted sensitive field</p>
                              <p className="text-xs leading-5 text-amber-800">
                                This value is hidden for your security level.
                                {membershipSecurityLevel === "LOW"
                                  ? " Ask a tenant admin to grant you higher security."
                                  : " Request access to view and edit this value."}
                              </p>
                            </div>
                            <Lock className="h-4 w-4 shrink-0 text-amber-700" />
                          </div>

                          {field.pendingAccessRequest ? (
                            <p className="mt-2 text-xs text-amber-800">
                              Request pending since{" "}
                              {new Intl.DateTimeFormat("en-US", {
                                month: "short",
                                day: "2-digit",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              }).format(new Date(field.pendingAccessRequest.createdAt))}
                              .
                            </p>
                          ) : null}

                          {field.canRequestAccess && !field.pendingAccessRequest ? (
                            <Button
                              type="button"
                              size="sm"
                              className="mt-3 cursor-pointer bg-amber-600 text-white hover:bg-amber-700"
                              disabled={requestingFieldId === field.id}
                              onClick={() => void handleRequestSensitiveFieldAccess(field.id)}
                            >
                              {requestingFieldId === field.id ? "Requesting..." : "Request Access"}
                            </Button>
                          ) : null}

                        </div>
                      ) : field.fieldType === "TEXT" ? (
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
                                PROFILE_SELECT_TRIGGER_CLASSNAME,
                                field.isEncrypted ? "pr-10" : undefined,
                              )}
                              aria-invalid={Boolean(error)}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                <SelectItem
                                  value="__empty__"
                                  className="cursor-pointer"
                                >
                                  No selection
                                </SelectItem>
                                {field.options.map((option) => (
                                  <SelectItem
                                    key={option}
                                    value={option}
                                    className="cursor-pointer"
                                  >
                                    {option}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
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

          <ContactTagsSection
            tenantId={tenantId}
            contactId={contactId}
            initialTags={initialContact.tags}
            canManageTags={canManageTags}
            variant="card"
          />

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
