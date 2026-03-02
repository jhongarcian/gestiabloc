"use client"

import { isAxiosError } from "axios"
import {
  CircleDot,
  CircleHelp,
  Hash,
  ListChecks,
  Lock,
  CalendarDays,
  DollarSign,
  Phone,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Type,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type CustomFieldType =
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

type CustomFieldRecord = {
  id: string
  key: string
  label: string
  description: string | null
  fieldType: CustomFieldType
  isRequired: boolean
  isEncrypted: boolean
  isActive: boolean
  options: string[]
  sortOrder: number
  createdAt: string
  updatedAt: string
}

type CustomFieldsResponse = {
  ok: boolean
  customFields: CustomFieldRecord[]
}

type CustomFieldsPanelProps = {
  tenantId: string
  tenantSlug: string
}

type FormState = {
  label: string
  description: string
  fieldType: CustomFieldType
  isRequired: boolean
  isEncrypted: boolean
  isActive: boolean
  optionsText: string
}

type FieldErrors = Partial<Record<keyof FormState, string>>

const DESCRIPTION_MAX_LENGTH = 500

const FIELD_TYPE_OPTIONS: Array<{
  value: CustomFieldType
  label: string
  helper: string
}> = [
  {
    value: "TEXT",
    label: "Text",
    helper: "Single-line free text.",
  },
  {
    value: "NUMBER",
    label: "Number",
    helper: "Numeric values only.",
  },
  {
    value: "PHONE",
    label: "Phone",
    helper: "Formatted phone number input.",
  },
  {
    value: "CURRENCY",
    label: "Currency",
    helper: "Monetary amount with currency formatting.",
  },
  {
    value: "DATE",
    label: "Date",
    helper: "Calendar date only.",
  },
  {
    value: "SELECT",
    label: "Select",
    helper: "Choose one option from a dropdown.",
  },
  {
    value: "MULTI_SELECT",
    label: "Multiple Select",
    helper: "Choose several options.",
  },
  {
    value: "RADIO",
    label: "Radio",
    helper: "Choose one visible option.",
  },
  {
    value: "TEXTAREA",
    label: "Text Area",
    helper: "Long-form multiline text.",
  },
  {
    value: "CHECKBOX",
    label: "Checkbox",
    helper: "Boolean yes or no field.",
  },
]

const INITIAL_FORM: FormState = {
  label: "",
  description: "",
  fieldType: "TEXT",
  isRequired: false,
  isEncrypted: false,
  isActive: true,
  optionsText: "",
}

const formatSegment = (segment: string) =>
  segment.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())

const supportsOptions = (fieldType: CustomFieldType) =>
  fieldType === "SELECT" || fieldType === "MULTI_SELECT" || fieldType === "RADIO"

const getFieldTypeLabel = (fieldType: CustomFieldType) =>
  FIELD_TYPE_OPTIONS.find((item) => item.value === fieldType)?.label ?? fieldType

const parseOptions = (value: string) =>
  value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)

function getFieldTypeAccent(fieldType: CustomFieldType) {
  switch (fieldType) {
    case "TEXT":
      return "border-blue-200 bg-blue-50 text-blue-800"
    case "NUMBER":
      return "border-emerald-200 bg-emerald-50 text-emerald-800"
    case "PHONE":
      return "border-sky-200 bg-sky-50 text-sky-800"
    case "CURRENCY":
      return "border-lime-200 bg-lime-50 text-lime-800"
    case "DATE":
      return "border-orange-200 bg-orange-50 text-orange-800"
    case "SELECT":
      return "border-amber-200 bg-amber-50 text-amber-800"
    case "MULTI_SELECT":
      return "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800"
    case "RADIO":
      return "border-cyan-200 bg-cyan-50 text-cyan-800"
    case "TEXTAREA":
      return "border-violet-200 bg-violet-50 text-violet-800"
    case "CHECKBOX":
      return "border-slate-200 bg-slate-100 text-slate-800"
  }
}

function FieldPreview({
  fieldType,
  options,
  label,
  description,
  isRequired,
  isEncrypted,
}: {
  fieldType: CustomFieldType
  options: string[]
  label: string
  description: string
  isRequired: boolean
  isEncrypted: boolean
}) {
  const previewLabel = label.trim() || "Field Label"
  const previewOptions = options.length > 0 ? options : ["Option A", "Option B", "Option C"]
  const helperText = description.trim()

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-slate-900">
            {previewLabel}
            {isRequired ? <span className="ml-1 text-rose-600">*</span> : null}
          </p>
          {helperText ? (
            <TooltipProvider delayDuration={120}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    aria-label={`More information about ${previewLabel}`}
                  >
                    <CircleHelp className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-64 leading-5">
                  {helperText}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
        </div>
      </div>

      {fieldType === "TEXT" ? (
        <div className="relative">
          <Input
            disabled
            value=""
            placeholder="Example text value"
            className={cn(isEncrypted && "pr-9")}
          />
          {isEncrypted ? (
            <Lock className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
          ) : null}
        </div>
      ) : null}

      {fieldType === "NUMBER" ? (
        <div className="relative">
          <Input
            disabled
            value=""
            inputMode="numeric"
            placeholder="12345"
            className={cn(isEncrypted && "pr-9")}
          />
          {isEncrypted ? (
            <Lock className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
          ) : null}
        </div>
      ) : null}

      {fieldType === "PHONE" ? (
        <div className="relative">
          <Input
            disabled
            value=""
            inputMode="tel"
            placeholder="(555) 123-4567"
            className={cn(isEncrypted && "pr-9")}
          />
          {isEncrypted ? (
            <Lock className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
          ) : null}
        </div>
      ) : null}

      {fieldType === "CURRENCY" ? (
        <div className="relative">
          <Input
            disabled
            value=""
            inputMode="decimal"
            placeholder="$0.00"
            className={cn(isEncrypted && "pr-9")}
          />
          {isEncrypted ? (
            <Lock className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
          ) : null}
        </div>
      ) : null}

      {fieldType === "DATE" ? (
        <div className="relative">
          <Input
            disabled
            value=""
            placeholder="Select a date"
            className={cn(isEncrypted && "pr-9")}
          />
          {isEncrypted ? (
            <Lock className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
          ) : null}
        </div>
      ) : null}

      {fieldType === "TEXTAREA" ? (
        <div className="relative">
          <Textarea
            disabled
            value=""
            placeholder="Longer notes or details..."
            className={cn("min-h-28", isEncrypted && "pr-9")}
          />
          {isEncrypted ? (
            <Lock className="pointer-events-none absolute top-3 right-3 h-4 w-4 text-slate-400" />
          ) : null}
        </div>
      ) : null}

      {fieldType === "SELECT" ? (
        <div className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-500">
          {previewOptions[0]} (dropdown preview)
        </div>
      ) : null}

      {fieldType === "MULTI_SELECT" ? (
        <div className="flex flex-wrap gap-2">
          {previewOptions.map((option) => (
            <span
              key={option}
              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700"
            >
              {option}
            </span>
          ))}
        </div>
      ) : null}

      {fieldType === "RADIO" ? (
        <div className="space-y-2">
          {previewOptions.map((option, index) => (
            <label key={option} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="field-preview-radio"
                checked={index === 0}
                readOnly
                className="h-4 w-4"
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      ) : null}

      {fieldType === "CHECKBOX" ? (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <Checkbox checked disabled />
          <span>Checkbox option</span>
        </label>
      ) : null}
    </div>
  )
}

function FieldTypeOptionCard({
  option,
  selected,
  onSelect,
}: {
  option: (typeof FIELD_TYPE_OPTIONS)[number]
  selected: boolean
  onSelect: (value: CustomFieldType) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(option.value)}
      className={cn(
        "cursor-pointer rounded-2xl border p-3 text-left transition",
        selected
          ? "border-blue-900 bg-blue-950 text-white shadow-sm"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
      )}
    >
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <p className={cn("text-sm font-semibold", selected ? "text-white" : "text-slate-900")}>
            {option.label}
          </p>
          <span
            className={cn(
              "h-2.5 w-2.5 rounded-full",
              selected ? "bg-white" : "bg-slate-300",
            )}
          />
        </div>
        <p className={cn("text-xs leading-5", selected ? "text-blue-100" : "text-slate-500")}>
          {option.helper}
        </p>
      </div>
    </button>
  )
}

export function CustomFieldsPanel({
  tenantId,
  tenantSlug,
}: CustomFieldsPanelProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [customFields, setCustomFields] = useState<CustomFieldRecord[]>([])
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingField, setEditingField] = useState<CustomFieldRecord | null>(null)
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const load = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const { data } = await api.get<CustomFieldsResponse>(
        `/api/account-settings/${tenantId}/custom-fields`,
      )
      setCustomFields(data.customFields)
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        setErrorMessage(
          typeof backendError === "string"
            ? formatSegment(backendError)
            : "Could not load custom fields.",
        )
      } else {
        setErrorMessage("Could not load custom fields.")
      }
    } finally {
      setIsLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    void load()
  }, [load])

  const requiredCount = useMemo(
    () => customFields.filter((field) => field.isRequired).length,
    [customFields],
  )
  const encryptedCount = useMemo(
    () => customFields.filter((field) => field.isEncrypted).length,
    [customFields],
  )
  const activeCount = useMemo(
    () => customFields.filter((field) => field.isActive).length,
    [customFields],
  )
  const optionalCount = customFields.length - requiredCount

  const selectedType = useMemo(
    () => FIELD_TYPE_OPTIONS.find((item) => item.value === form.fieldType) ?? FIELD_TYPE_OPTIONS[0],
    [form.fieldType],
  )
  const descriptionLength = form.description.length
  const previewOptions = useMemo(() => parseOptions(form.optionsText), [form.optionsText])

  const resetDialog = () => {
    setEditingField(null)
    setForm(INITIAL_FORM)
    setFieldErrors({})
  }

  const openCreateDialog = () => {
    resetDialog()
    setIsDialogOpen(true)
  }

  const openEditDialog = (field: CustomFieldRecord) => {
    setEditingField(field)
    setForm({
      label: field.label,
      description: field.description ?? "",
      fieldType: field.fieldType,
      isRequired: field.isRequired,
      isEncrypted: field.isEncrypted,
      isActive: field.isActive,
      optionsText: field.options.join("\n"),
    })
    setFieldErrors({})
    setIsDialogOpen(true)
  }

  const validate = () => {
    const nextErrors: FieldErrors = {}

    if (!form.label.trim()) {
      nextErrors.label = "Label is required."
    }

    if (supportsOptions(form.fieldType) && parseOptions(form.optionsText).length === 0) {
      nextErrors.optionsText = "Add at least one option."
    }

    setFieldErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return

    setIsBusy(true)
    setErrorMessage(null)

    const payload = {
      label: form.label.trim(),
      description: form.description.trim() || null,
      fieldType: form.fieldType,
      isRequired: form.isRequired,
      isEncrypted: form.isEncrypted,
      isActive: form.isActive,
      options: supportsOptions(form.fieldType) ? parseOptions(form.optionsText) : [],
    }

    try {
      if (editingField) {
        await api.patch(`/api/account-settings/${tenantId}/custom-fields/${editingField.id}`, payload)
        toast.success("Custom field updated.")
      } else {
        await api.post(`/api/account-settings/${tenantId}/custom-fields`, payload)
        toast.success("Custom field created.")
      }

      setIsDialogOpen(false)
      resetDialog()
      await load()
    } catch (error) {
      if (isAxiosError(error)) {
        const responseData = error.response?.data as
          | { error?: string; details?: Array<{ path?: string; message?: string }> }
          | undefined

        if (Array.isArray(responseData?.details)) {
          const nextErrors: FieldErrors = {}
          for (const detail of responseData.details) {
            if (detail.path === "label" && detail.message) nextErrors.label = detail.message
            if (detail.path === "description" && detail.message) {
              nextErrors.description = detail.message
            }
            if (detail.path === "options" && detail.message) {
              nextErrors.optionsText = detail.message
            }
          }
          if (Object.keys(nextErrors).length > 0) {
            setFieldErrors(nextErrors)
          }
        }

        const backendError = responseData?.error
        setErrorMessage(
          typeof backendError === "string"
            ? formatSegment(backendError)
            : "Could not save custom field.",
        )
      } else {
        setErrorMessage("Could not save custom field.")
      }

      toast.error("Could not save custom field.")
    } finally {
      setIsBusy(false)
    }
  }

  const handleDelete = async (field: CustomFieldRecord) => {
    setIsBusy(true)
    setErrorMessage(null)

    try {
      await api.delete(`/api/account-settings/${tenantId}/custom-fields/${field.id}`)
      toast.success("Custom field deleted.")
      await load()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        setErrorMessage(
          typeof backendError === "string"
            ? formatSegment(backendError)
            : "Could not delete custom field.",
        )
      } else {
        setErrorMessage("Could not delete custom field.")
      }
      toast.error("Could not delete custom field.")
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_45%,#fff7ed_100%)]">
        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1.3fr)_360px] lg:p-7">
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                Contact Field Builder
              </p>
              <div className="space-y-3">
                <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-slate-950">
                  Design a cleaner intake experience for every contact form.
                </h2>
                <p className="max-w-2xl text-sm leading-6 text-slate-600">
                  Build tenant-specific fields with the right input type, clear instructions,
                  and stronger safeguards for sensitive data. Organize your form around what
                  your team actually collects.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                  Field library
                </p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">{customFields.length}</p>
                <p className="mt-1 text-sm text-slate-500">Total custom fields configured.</p>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                  Required
                </p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">{requiredCount}</p>
                <p className="mt-1 text-sm text-slate-500">Fields that must be completed.</p>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                  Secure
                </p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">{encryptedCount}</p>
                <p className="mt-1 text-sm text-slate-500">Fields marked for extra protection.</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-[24px] border border-slate-300/60 bg-slate-950 p-5 text-white shadow-sm">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-200/90">
                Workspace
              </p>
              <div>
                <p className="text-lg font-semibold">{tenantSlug}</p>
                <p className="mt-1 text-sm leading-6 text-slate-300">
                  Keep the form simple: use text for open entry, choice fields for standardized
                  answers, and encrypted fields only when the data is genuinely sensitive.
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <Button
                type="button"
                onClick={openCreateDialog}
                className="w-full cursor-pointer bg-white text-slate-950 hover:bg-slate-100"
              >
                <Plus className="h-4 w-4" />
                Create Custom Field
              </Button>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
                {activeCount} active field{activeCount === 1 ? "" : "s"} ready for future contact
                forms.
              </div>
            </div>
          </div>
        </div>
      </section>

      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Loading custom fields...
        </div>
      ) : errorMessage ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : customFields.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-base font-medium text-slate-900">No custom fields yet</p>
          <p className="mt-2 text-sm text-slate-500">
            Add the first field to start collecting tenant-specific contact data.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-5 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                  Field Library
                </p>
                <h3 className="text-xl font-semibold text-slate-950">Configured fields</h3>
                <p className="text-sm text-slate-500">
                  Review the labels, behavior, and preview for every field before wiring them
                  into contact forms.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
                  {activeCount} active
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
                  {optionalCount} optional
                </span>
              </div>
            </div>

            <div className="grid gap-4 p-4 md:p-5">
              {customFields.map((field, index) => (
                <article
                  key={field.id}
                  className={cn(
                    "rounded-[22px] border p-4 transition-colors md:p-5",
                    field.isActive
                      ? "border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)]"
                      : "border-slate-200/80 bg-slate-50/80 opacity-85",
                  )}
                >
                  <div className="flex flex-col gap-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-500">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-xs font-semibold",
                              getFieldTypeAccent(field.fieldType),
                            )}
                          >
                            {getFieldTypeLabel(field.fieldType)}
                          </span>
                          {field.isRequired ? (
                            <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                              Required
                            </Badge>
                          ) : (
                            <Badge variant="outline">Optional</Badge>
                          )}
                          {field.isEncrypted ? (
                            <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                              <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                              Encrypted
                            </Badge>
                          ) : null}
                          {!field.isActive ? <Badge variant="outline">Inactive</Badge> : null}
                        </div>

                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <h4 className="text-lg font-semibold text-slate-950">{field.label}</h4>
                            <span className="text-xs uppercase tracking-[0.18em] text-slate-400">
                              Key: {field.key}
                            </span>
                          </div>
                          <p className="max-w-2xl text-sm leading-6 text-slate-600">
                            {field.description?.trim() || "No description provided."}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isBusy}
                          className="cursor-pointer"
                          onClick={() => openEditDialog(field)}
                        >
                          <Pencil className="h-4 w-4" />
                          Edit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={isBusy}
                          className="cursor-pointer bg-slate-900 text-white hover:bg-slate-800"
                          onClick={() => void handleDelete(field)}
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="grid gap-3 md:grid-cols-3">
                          <div className="space-y-1">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                              Visibility
                            </p>
                            <p className="text-sm font-medium text-slate-900">
                              {field.isActive ? "Active" : "Inactive"}
                            </p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                              Requirement
                            </p>
                            <p className="text-sm font-medium text-slate-900">
                              {field.isRequired ? "Required" : "Optional"}
                            </p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                              Security
                            </p>
                            <p className="text-sm font-medium text-slate-900">
                              {field.isEncrypted ? "Encrypted" : "Standard"}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                          Options
                        </p>
                        <p className="mt-1 text-sm font-medium text-slate-900">
                          {field.options.length} option{field.options.length === 1 ? "" : "s"}
                        </p>
                        {field.options.length > 0 ? (
                          <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-500">
                            {field.options.join(", ")}
                          </p>
                        ) : (
                          <p className="mt-2 text-xs leading-5 text-slate-500">
                            No predefined choices.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <aside className="space-y-4">
            <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                Design Guide
              </p>
              <h3 className="mt-2 text-lg font-semibold text-slate-950">
                Better hierarchy for admins
              </h3>
              <div className="mt-4 space-y-4 text-sm text-slate-600">
                <div className="flex gap-3">
                  <Type className="mt-0.5 h-4 w-4 text-blue-700" />
                  <p>Use clear labels that describe the data, not the internal system name.</p>
                </div>
                <div className="flex gap-3">
                  <ListChecks className="mt-0.5 h-4 w-4 text-amber-700" />
                  <p>Use choice fields when you want clean reporting and consistent answers.</p>
                </div>
                <div className="flex gap-3">
                  <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-700" />
                  <p>Reserve encryption for truly sensitive values so the form stays simple.</p>
                </div>
              </div>
            </section>

            <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                Type Overview
              </p>
              <div className="mt-4 grid gap-3">
                <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <Type className="mt-0.5 h-4 w-4 text-blue-700" />
                  <div>
                    <p className="text-sm font-medium text-slate-900">Text and text area</p>
                    <p className="text-xs leading-5 text-slate-500">
                      Best for names, identifiers, notes, and flexible input.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <Hash className="mt-0.5 h-4 w-4 text-emerald-700" />
                  <div>
                    <p className="text-sm font-medium text-slate-900">Number</p>
                    <p className="text-xs leading-5 text-slate-500">
                      Good for counts, years, or numeric reference values.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <Phone className="mt-0.5 h-4 w-4 text-sky-700" />
                  <div>
                    <p className="text-sm font-medium text-slate-900">Phone</p>
                    <p className="text-xs leading-5 text-slate-500">
                      Good for alternate numbers, emergency contacts, and caregiver phone fields.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <DollarSign className="mt-0.5 h-4 w-4 text-lime-700" />
                  <div>
                    <p className="text-sm font-medium text-slate-900">Currency</p>
                    <p className="text-xs leading-5 text-slate-500">
                      Useful for premiums, balances, copays, and quoted amounts.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <CalendarDays className="mt-0.5 h-4 w-4 text-orange-700" />
                  <div>
                    <p className="text-sm font-medium text-slate-900">Date</p>
                    <p className="text-xs leading-5 text-slate-500">
                      Best for appointments, effective dates, renewals, and milestones.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <ListChecks className="mt-0.5 h-4 w-4 text-amber-700" />
                  <div>
                    <p className="text-sm font-medium text-slate-900">Select and multi-select</p>
                    <p className="text-xs leading-5 text-slate-500">
                      Good when the answer should come from a controlled list.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <CircleDot className="mt-0.5 h-4 w-4 text-cyan-700" />
                  <div>
                    <p className="text-sm font-medium text-slate-900">Radio and checkbox</p>
                    <p className="text-xs leading-5 text-slate-500">
                      Use radio for one visible choice, checkbox for a simple yes or no.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </aside>
        </div>
      )}

      <Dialog
        open={isDialogOpen}
        onOpenChange={(nextOpen) => {
          setIsDialogOpen(nextOpen)
          if (!nextOpen) {
            resetDialog()
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{editingField ? "Edit custom field" : "Create custom field"}</DialogTitle>
            <DialogDescription>
              Define the field clearly so your team understands what to collect and how it
              should appear in the contact form.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_340px]">
            <div className="space-y-5">
              <section className="rounded-[24px] border border-slate-200 bg-white p-5">
                <div className="mb-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    1. Basics
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-slate-950">
                    Name the field clearly
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Use a label your team will immediately recognize in the form.
                  </p>
                </div>

                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="custom-field-label">Label</Label>
                    <Input
                      id="custom-field-label"
                      value={form.label}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, label: event.target.value }))
                      }
                      placeholder="Policy Number"
                    />
                    {fieldErrors.label ? (
                      <p className="text-xs text-rose-600">{fieldErrors.label}</p>
                    ) : (
                      <p className="text-xs text-slate-500">
                        Keep it short and human-readable.
                      </p>
                    )}
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="custom-field-description">Description</Label>
                    <Textarea
                      id="custom-field-description"
                      value={form.description}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          description: event.target.value.slice(0, DESCRIPTION_MAX_LENGTH),
                        }))
                      }
                      placeholder="Explain when this should be used and what kind of answer is expected."
                      maxLength={DESCRIPTION_MAX_LENGTH}
                    />
                    <div className="flex items-center justify-between gap-3">
                      {fieldErrors.description ? (
                        <p className="text-xs text-rose-600">{fieldErrors.description}</p>
                      ) : (
                        <p className="text-xs text-slate-500">
                          Add enough detail so the field is self-explanatory.
                        </p>
                      )}
                      <p
                        className={cn(
                          "text-xs",
                          descriptionLength >= DESCRIPTION_MAX_LENGTH
                            ? "text-amber-600"
                            : "text-slate-400",
                        )}
                      >
                        {descriptionLength}/{DESCRIPTION_MAX_LENGTH}
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-[24px] border border-slate-200 bg-white p-5">
                <div className="mb-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    2. Input Type
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-slate-950">
                    Choose how the answer should look
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Pick the input that best matches the kind of answer you want users to enter.
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  {FIELD_TYPE_OPTIONS.map((option) => (
                    <FieldTypeOptionCard
                      key={option.value}
                      option={option}
                      selected={form.fieldType === option.value}
                      onSelect={(value) =>
                        setForm((current) => ({
                          ...current,
                          fieldType: value,
                          optionsText: supportsOptions(value) ? current.optionsText : "",
                        }))
                      }
                    />
                  ))}
                </div>
              </section>

              {supportsOptions(form.fieldType) ? (
                <section className="rounded-[24px] border border-slate-200 bg-white p-5">
                  <div className="mb-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      3. Choices
                    </p>
                    <h3 className="mt-1 text-lg font-semibold text-slate-950">
                      Add the available options
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Enter one option per line in the order you want users to see them.
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="custom-field-options">Options</Label>
                    <Textarea
                      id="custom-field-options"
                      value={form.optionsText}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, optionsText: event.target.value }))
                      }
                      placeholder={"Bronze\nSilver\nGold"}
                    />
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-slate-500">One choice per line.</p>
                      <p className="text-xs text-slate-400">{previewOptions.length} option(s)</p>
                    </div>
                    {fieldErrors.optionsText ? (
                      <p className="text-xs text-rose-600">{fieldErrors.optionsText}</p>
                    ) : null}
                  </div>
                </section>
              ) : null}

              <section className="rounded-[24px] border border-slate-200 bg-white p-5">
                <div className="mb-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    {supportsOptions(form.fieldType) ? "4. Rules" : "3. Rules"}
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-slate-950">
                    Configure field behavior
                  </h3>
                </div>

                <div className="grid gap-3">
                  <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <Checkbox
                      checked={form.isRequired}
                      onCheckedChange={(checked) =>
                        setForm((current) => ({
                          ...current,
                          isRequired: checked === true,
                        }))
                      }
                    />
                    <span className="space-y-1">
                      <span className="block text-sm font-medium text-slate-900">Required field</span>
                      <span className="block text-xs text-slate-500">
                        Users must complete this field before saving the contact form.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <Checkbox
                      checked={form.isEncrypted}
                      onCheckedChange={(checked) =>
                        setForm((current) => ({
                          ...current,
                          isEncrypted: checked === true,
                        }))
                      }
                    />
                    <span className="space-y-1">
                      <span className="block text-sm font-medium text-slate-900">Encrypted value</span>
                      <span className="block text-xs text-slate-500">
                        Use this for highly sensitive values that need stronger protection.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <Checkbox
                      checked={form.isActive}
                      onCheckedChange={(checked) =>
                        setForm((current) => ({
                          ...current,
                          isActive: checked === true,
                        }))
                      }
                    />
                    <span className="space-y-1">
                      <span className="block text-sm font-medium text-slate-900">Active field</span>
                      <span className="block text-xs text-slate-500">
                        Keep this on if the field should be available in future forms.
                      </span>
                    </span>
                  </label>
                </div>
              </section>
            </div>

            <aside className="space-y-4">
              <section className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Live Preview
                </p>
                <h3 className="mt-1 text-base font-semibold text-slate-950">
                  How this field will look
                </h3>
                <p className="mt-1 text-sm text-slate-500">{selectedType.helper}</p>
                <div className="mt-4">
                  <FieldPreview
                    fieldType={form.fieldType}
                    options={previewOptions}
                    label={form.label}
                    description={form.description}
                    isRequired={form.isRequired}
                    isEncrypted={form.isEncrypted}
                  />
                </div>
              </section>

              <section className="rounded-[24px] border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Quick Tips
                </p>
                <div className="mt-3 space-y-3 text-sm text-slate-600">
                  <p>Use labels people already say out loud in your workflow.</p>
                  <p>Choice fields are best when you want consistent reporting later.</p>
                  <p>Descriptions should explain what belongs in the field, not restate the label.</p>
                </div>
              </section>

              {errorMessage ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  {errorMessage}
                </div>
              ) : null}
            </aside>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              disabled={isBusy}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={isBusy}
              className="cursor-pointer bg-blue-950 text-white hover:bg-blue-950/90"
            >
              {isBusy ? "Saving..." : editingField ? "Save Changes" : "Create Field"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
