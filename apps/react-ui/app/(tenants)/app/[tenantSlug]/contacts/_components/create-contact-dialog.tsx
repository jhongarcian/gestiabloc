"use client"

import { isAxiosError } from "axios"
import { Loader2, Plus } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DateInput,
  parseDateInput,
  serializeDateOnly,
} from "@/components/ui/date-input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { AppPhoneInput } from "@/components/ui/phone-input"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  ContactStatusSelect,
  type ContactStatusOption,
} from "./contact-status-select"

type CreateContactDialogProps = {
  tenantId: string
  statusOptions: ContactStatusOption[]
  onCreated: () => Promise<void> | void
}

type FieldErrors = Partial<
  Record<
    "firstName" | "middleName" | "lastName" | "dateOfBirth" | "phone" | "email" | "status",
    string
  >
>

const ALL_STATUS_VALUE = "ALL"

export function CreateContactDialog({
  tenantId,
  statusOptions,
  onCreated,
}: CreateContactDialogProps) {
  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const [firstName, setFirstName] = useState("")
  const [middleName, setMiddleName] = useState("")
  const [lastName, setLastName] = useState("")
  const [dateOfBirth, setDateOfBirth] = useState<Date | undefined>(undefined)
  const [dateOfBirthInput, setDateOfBirthInput] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [statusConfigId, setStatusConfigId] = useState<string | undefined>(undefined)

  const selectableStatuses = useMemo(
    () => statusOptions.filter((option) => option.value !== ALL_STATUS_VALUE),
    [statusOptions],
  )

  const resetForm = () => {
    setFirstName("")
    setMiddleName("")
    setLastName("")
    setDateOfBirth(undefined)
    setDateOfBirthInput("")
    setPhone("")
    setEmail("")
    setStatusConfigId(undefined)
    setFieldErrors({})
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isSubmitting) return

    setOpen(nextOpen)
    if (!nextOpen) resetForm()
  }

  const clearFieldError = (field: keyof FieldErrors) => {
    setFieldErrors((current) => {
      if (!current[field]) return current

      const nextErrors = { ...current }
      delete nextErrors[field]
      return nextErrors
    })
  }

  const validate = () => {
    const nextErrors: FieldErrors = {}
    const parsedDateOfBirth = parseDateInput(dateOfBirthInput)
    if (!firstName.trim()) nextErrors.firstName = "First name is required."
    if (!lastName.trim()) nextErrors.lastName = "Last name is required."
    if (parsedDateOfBirth === null) {
      nextErrors.dateOfBirth = "Enter a valid date in MM/DD/YYYY format."
    }

    if (email.trim()) {
      const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
      if (!validEmail) nextErrors.email = "Email format is invalid."
    }

    setFieldErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const onSubmit = async () => {
    if (isSubmitting) return
    if (!validate()) return

    setIsSubmitting(true)
    try {
      const dateOfBirthIso = serializeDateOnly(dateOfBirth)

      await api.post(`/api/contacts/${tenantId}`, {
        firstName: firstName.trim(),
        middleName: middleName.trim() || null,
        lastName: lastName.trim(),
        dateOfBirth: dateOfBirthIso,
        phone: phone.trim() || null,
        email: email.trim() || null,
        statusConfigId: statusConfigId ?? null,
      })

      toast.success("Contact created.")
      await onCreated()
      setOpen(false)
      resetForm()
    } catch (error) {
      if (isAxiosError(error)) {
        const responseData = error.response?.data as
          | { error?: string; details?: Array<{ path?: string; message?: string }> }
          | undefined

        if (Array.isArray(responseData?.details)) {
          const mappedErrors: FieldErrors = {}
          for (const detail of responseData.details) {
            if (detail.path === "firstName" && detail.message) {
              mappedErrors.firstName = detail.message
            }
            if (detail.path === "middleName" && detail.message) {
              mappedErrors.middleName = detail.message
            }
            if (detail.path === "lastName" && detail.message) {
              mappedErrors.lastName = detail.message
            }
            if (detail.path === "dateOfBirth" && detail.message) {
              mappedErrors.dateOfBirth = detail.message
            }
            if (detail.path === "phone" && detail.message) mappedErrors.phone = detail.message
            if (detail.path === "email" && detail.message) mappedErrors.email = detail.message
          }

          if (Object.keys(mappedErrors).length) {
            setFieldErrors(mappedErrors)
          }
        }

        const backendError = responseData?.error
        if (backendError === "INVALID_STATUS_CONFIG") {
          setFieldErrors((prev) => ({
            ...prev,
            status: "Selected status is invalid for this tenant.",
          }))
          toast.error("Selected status is invalid for this tenant.")
        } else if (typeof backendError === "string") {
          toast.error(backendError.replace(/_/g, " "))
        } else {
          toast.error("Could not create contact.")
        }
      } else {
        toast.error("Could not create contact.")
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          className="cursor-pointer rounded-xl bg-blue-950 text-white shadow-sm hover:bg-blue-900"
        >
          <Plus data-icon="inline-start" />
          Add contact
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[28px] border-slate-200 bg-white p-0 shadow-2xl sm:max-w-3xl [&>button]:cursor-pointer">
        <DialogHeader className="relative overflow-hidden border-b border-blue-100 bg-[#f1f7ff] px-6 py-6 text-left sm:px-7">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(30,64,175,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(30,64,175,.08)_1px,transparent_1px)] [background-size:42px_42px]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-12 -bottom-20 size-48 rounded-full bg-blue-300/30 blur-3xl"
          />
          <div className="relative pr-10">
            <div className="flex max-w-2xl min-w-0 flex-col gap-1.5">
              <p className="text-xs font-semibold text-blue-700">Contact directory</p>
              <DialogTitle className="text-xl font-semibold text-slate-950 sm:text-2xl">
                Create a contact
              </DialogTitle>
              <DialogDescription className="max-w-xl text-sm leading-6 text-slate-600">
                Add the identity and contact details your team needs to recognize this person.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form
          id="create-contact-form"
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            void onSubmit()
          }}
        >
          <div className="min-h-0 overflow-y-auto overscroll-contain px-6 py-6 [scrollbar-gutter:stable] sm:px-7">
            <div className="flex flex-col gap-7">
              <section className="flex flex-col gap-4" aria-labelledby="contact-identity-heading">
                <div className="flex flex-col gap-1">
                  <h3
                    id="contact-identity-heading"
                    className="text-sm font-semibold text-slate-950"
                  >
                    Identity
                  </h3>
                  <p className="text-xs leading-5 text-slate-500">
                    Use the person&apos;s legal or preferred name for this record.
                  </p>
                </div>

                <FieldGroup className="gap-5 sm:grid sm:grid-cols-3">
                  <Field
                    data-invalid={Boolean(fieldErrors.firstName)}
                    data-disabled={isSubmitting}
                    className="gap-2"
                  >
                    <FieldLabel htmlFor="create-contact-first-name" className="text-slate-800">
                      First name <span className="text-rose-600" aria-hidden="true">*</span>
                    </FieldLabel>
                    <Input
                      id="create-contact-first-name"
                      value={firstName}
                      onChange={(event) => {
                        setFirstName(event.target.value)
                        clearFieldError("firstName")
                      }}
                      placeholder="Jane"
                      autoComplete="given-name"
                      disabled={isSubmitting}
                      aria-invalid={Boolean(fieldErrors.firstName)}
                      aria-required="true"
                      className="h-11 rounded-xl border-slate-200 bg-slate-50/60 px-4 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
                    />
                    <FieldError>{fieldErrors.firstName}</FieldError>
                  </Field>

                  <Field
                    data-invalid={Boolean(fieldErrors.middleName)}
                    data-disabled={isSubmitting}
                    className="gap-2"
                  >
                    <FieldLabel htmlFor="create-contact-middle-name" className="text-slate-800">
                      Middle name
                    </FieldLabel>
                    <Input
                      id="create-contact-middle-name"
                      value={middleName}
                      onChange={(event) => {
                        setMiddleName(event.target.value)
                        clearFieldError("middleName")
                      }}
                      placeholder="Marie"
                      autoComplete="additional-name"
                      disabled={isSubmitting}
                      aria-invalid={Boolean(fieldErrors.middleName)}
                      className="h-11 rounded-xl border-slate-200 bg-slate-50/60 px-4 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
                    />
                    <FieldError>{fieldErrors.middleName}</FieldError>
                  </Field>

                  <Field
                    data-invalid={Boolean(fieldErrors.lastName)}
                    data-disabled={isSubmitting}
                    className="gap-2"
                  >
                    <FieldLabel htmlFor="create-contact-last-name" className="text-slate-800">
                      Last name <span className="text-rose-600" aria-hidden="true">*</span>
                    </FieldLabel>
                    <Input
                      id="create-contact-last-name"
                      value={lastName}
                      onChange={(event) => {
                        setLastName(event.target.value)
                        clearFieldError("lastName")
                      }}
                      placeholder="Doe"
                      autoComplete="family-name"
                      disabled={isSubmitting}
                      aria-invalid={Boolean(fieldErrors.lastName)}
                      aria-required="true"
                      className="h-11 rounded-xl border-slate-200 bg-slate-50/60 px-4 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
                    />
                    <FieldError>{fieldErrors.lastName}</FieldError>
                  </Field>
                </FieldGroup>
              </section>

              <section
                className="flex flex-col gap-4 border-t border-slate-200 pt-6"
                aria-labelledby="contact-details-heading"
              >
                <div className="flex flex-col gap-1">
                  <h3
                    id="contact-details-heading"
                    className="text-sm font-semibold text-slate-950"
                  >
                    Contact details
                  </h3>
                  <p className="text-xs leading-5 text-slate-500">
                    Add the best available information for communication and identification.
                  </p>
                </div>

                <FieldGroup className="gap-5 sm:grid sm:grid-cols-2">
                  <Field
                    data-invalid={Boolean(fieldErrors.dateOfBirth)}
                    data-disabled={isSubmitting}
                    className="gap-2"
                  >
                    <FieldLabel htmlFor="create-contact-date-of-birth" className="text-slate-800">
                      Date of birth
                    </FieldLabel>
                    <DateInput
                      id="create-contact-date-of-birth"
                      value={dateOfBirthInput}
                      onValueChange={(nextValue) => {
                        setDateOfBirthInput(nextValue)
                        clearFieldError("dateOfBirth")
                      }}
                      onDateChange={setDateOfBirth}
                      disabled={isSubmitting}
                      ariaInvalid={Boolean(fieldErrors.dateOfBirth)}
                      className="[&_[data-slot=button]]:h-11 [&_[data-slot=button]]:rounded-xl [&_[data-slot=button]]:border-slate-200 [&_[data-slot=input]]:h-11 [&_[data-slot=input]]:rounded-xl [&_[data-slot=input]]:border-slate-200 [&_[data-slot=input]]:bg-slate-50/60 [&_[data-slot=input]]:px-4 [&_[data-slot=input]]:shadow-none"
                    />
                    <FieldDescription className="text-xs">Use MM/DD/YYYY.</FieldDescription>
                    <FieldError>{fieldErrors.dateOfBirth}</FieldError>
                  </Field>

                  <Field
                    data-invalid={Boolean(fieldErrors.phone)}
                    data-disabled={isSubmitting}
                    className="gap-2"
                  >
                    <FieldLabel htmlFor="create-contact-phone" className="text-slate-800">
                      Phone
                    </FieldLabel>
                    <AppPhoneInput
                      id="create-contact-phone"
                      defaultCountry="US"
                      countryCallingCodeEditable={false}
                      value={phone}
                      onChange={(value) => {
                        setPhone(value ?? "")
                        clearFieldError("phone")
                      }}
                      disabled={isSubmitting}
                      aria-invalid={Boolean(fieldErrors.phone)}
                      className={cn(
                        "!h-11 !min-h-11 !rounded-xl !border-slate-200 !bg-slate-50/60 !shadow-none",
                        fieldErrors.phone && "!border-rose-500 !ring-3 !ring-rose-100",
                      )}
                    />
                    <FieldError>{fieldErrors.phone}</FieldError>
                  </Field>

                  <Field
                    data-invalid={Boolean(fieldErrors.email)}
                    data-disabled={isSubmitting}
                    className="gap-2"
                  >
                    <FieldLabel htmlFor="create-contact-email" className="text-slate-800">
                      Email
                    </FieldLabel>
                    <Input
                      id="create-contact-email"
                      type="email"
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value)
                        clearFieldError("email")
                      }}
                      placeholder="jane@company.com"
                      autoComplete="email"
                      disabled={isSubmitting}
                      aria-invalid={Boolean(fieldErrors.email)}
                      className="h-11 rounded-xl border-slate-200 bg-slate-50/60 px-4 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
                    />
                    <FieldError>{fieldErrors.email}</FieldError>
                  </Field>

                  <Field
                    data-invalid={Boolean(fieldErrors.status)}
                    data-disabled={isSubmitting}
                    className="gap-2"
                  >
                    <FieldLabel htmlFor="create-contact-status" className="text-slate-800">
                      Status
                    </FieldLabel>
                    <ContactStatusSelect
                      id="create-contact-status"
                      value={statusConfigId ?? "__default__"}
                      onValueChange={(value) => {
                        setStatusConfigId(value === "__default__" ? undefined : value)
                        clearFieldError("status")
                      }}
                      options={selectableStatuses}
                      noneValue="__default__"
                      noneLabel="Default (Active)"
                      disabled={isSubmitting}
                      ariaInvalid={Boolean(fieldErrors.status)}
                    />
                    <FieldDescription className="text-xs">
                      Uses the tenant&apos;s default active status when unchanged.
                    </FieldDescription>
                    <FieldError>{fieldErrors.status}</FieldError>
                  </Field>
                </FieldGroup>
              </section>
            </div>
          </div>

          <DialogFooter className="border-t border-slate-200 bg-slate-50/80 px-6 py-4 sm:items-center sm:px-7">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              className="cursor-pointer rounded-xl"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="min-w-36 cursor-pointer rounded-xl bg-blue-950 text-white shadow-sm hover:bg-blue-900"
            >
              {isSubmitting ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : null}
              {isSubmitting ? "Creating..." : "Create contact"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
