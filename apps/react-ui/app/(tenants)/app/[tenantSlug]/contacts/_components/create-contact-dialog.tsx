"use client"

import { isAxiosError } from "axios"
import { format } from "date-fns"
import { CalendarIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
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
import { AppPhoneInput } from "@/components/ui/phone-input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { api } from "@/lib/api"

type ContactStatusOption = {
  label: string
  value: string
}

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
    setPhone("")
    setEmail("")
    setStatusConfigId(undefined)
    setFieldErrors({})
  }

  const validate = () => {
    const nextErrors: FieldErrors = {}
    if (!firstName.trim()) nextErrors.firstName = "First name is required."
    if (!lastName.trim()) nextErrors.lastName = "Last name is required."

    if (email.trim()) {
      const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
      if (!validEmail) nextErrors.email = "Email format is invalid."
    }

    setFieldErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const onSubmit = async () => {
    if (!validate()) return

    setIsSubmitting(true)
    try {
      const dateOfBirthIso = dateOfBirth
        ? new Date(
            Date.UTC(
              dateOfBirth.getFullYear(),
              dateOfBirth.getMonth(),
              dateOfBirth.getDate(),
              0,
              0,
              0,
            ),
          ).toISOString()
        : null

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
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) resetForm()
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          className="bg-blue-950 text-white hover:bg-blue-950/90"
        >
          Add Contact
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create Contact</DialogTitle>
          <DialogDescription>
            Add a new contact for this tenant.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="rounded-lg border border-slate-200 p-3 sm:p-4">
            <p className="text-sm font-medium text-slate-900">Basic Information</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="create-contact-first-name">First Name</Label>
                <Input
                  id="create-contact-first-name"
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  placeholder="Jane"
                />
                {fieldErrors.firstName ? (
                  <p className="text-xs text-rose-600">{fieldErrors.firstName}</p>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="create-contact-middle-name">Middle Name</Label>
                <Input
                  id="create-contact-middle-name"
                  value={middleName}
                  onChange={(event) => setMiddleName(event.target.value)}
                  placeholder="Marie"
                />
                {fieldErrors.middleName ? (
                  <p className="text-xs text-rose-600">{fieldErrors.middleName}</p>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="create-contact-last-name">Last Name</Label>
                <Input
                  id="create-contact-last-name"
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  placeholder="Doe"
                />
                {fieldErrors.lastName ? (
                  <p className="text-xs text-rose-600">{fieldErrors.lastName}</p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-3 sm:p-4">
            <p className="text-sm font-medium text-slate-900">Contact Details</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="create-contact-date-of-birth">Date of Birth</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      id="create-contact-date-of-birth"
                      type="button"
                      variant="outline"
                      className="w-full justify-between font-normal"
                    >
                      {dateOfBirth ? format(dateOfBirth, "MMM dd, yyyy") : "Pick a date"}
                      <CalendarIcon className="h-4 w-4 opacity-60" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dateOfBirth}
                      captionLayout="dropdown"
                      onSelect={(date) => setDateOfBirth(date)}
                      disabled={(date) => date > new Date()}
                    />
                  </PopoverContent>
                </Popover>
                {fieldErrors.dateOfBirth ? (
                  <p className="text-xs text-rose-600">{fieldErrors.dateOfBirth}</p>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="create-contact-phone">Phone</Label>
                <AppPhoneInput
                  id="create-contact-phone"
                  defaultCountry="US"
                  countryCallingCodeEditable={false}
                  value={phone}
                  onChange={(value) => setPhone(value ?? "")}
                />
                {fieldErrors.phone ? (
                  <p className="text-xs text-rose-600">{fieldErrors.phone}</p>
                ) : null}
              </div>
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="create-contact-email">Email</Label>
                <Input
                  id="create-contact-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="jane@company.com"
                />
                {fieldErrors.email ? (
                  <p className="text-xs text-rose-600">{fieldErrors.email}</p>
                ) : null}
              </div>
              <div className="grid gap-2 sm:col-span-2">
                <Label>Status</Label>
                <Select
                  value={statusConfigId ?? "__default__"}
                  onValueChange={(value) => {
                    setStatusConfigId(value === "__default__" ? undefined : value)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">Default (Active)</SelectItem>
                    {selectableStatuses.map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldErrors.status ? (
                  <p className="text-xs text-rose-600">{fieldErrors.status}</p>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              void onSubmit()
            }}
            className="bg-blue-950 text-white hover:bg-blue-950/90"
          >
            {isSubmitting ? "Creating..." : "Create Contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
