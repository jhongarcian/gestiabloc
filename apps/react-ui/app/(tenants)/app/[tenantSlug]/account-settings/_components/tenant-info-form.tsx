"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { isAxiosError } from "axios"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AppPhoneInput } from "@/components/ui/phone-input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { api } from "@/lib/api"

type TenantInfoFormProps = {
  tenantId: string
}

type TenantInfo = {
  id: string
  name: string
  email: string | null
  phone: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  country: string | null
  timezone: string | null
  website: string | null
  emailVerified: boolean
  createdAt: string
  updatedAt: string
}

type TenantInfoResponse = {
  ok: boolean
  tenant: TenantInfo
}

type TenantInfoPayload = {
  name: string
  email: string
  phone: string
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  postalCode: string
  country: string
  timezone: string
  website: string
}

const INITIAL_PAYLOAD: TenantInfoPayload = {
  name: "",
  email: "",
  phone: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "",
  timezone: "",
  website: "",
}

const normalizeString = (value: string | null) => value ?? ""
const TIMEZONE_EMPTY_VALUE = "__SYSTEM_TIMEZONE__"
const TIMEZONE_GROUPS = [
  {
    label: "North America",
    values: [
      "America/New_York",
      "America/Toronto",
      "America/Chicago",
      "America/Denver",
      "America/Phoenix",
      "America/Los_Angeles",
      "America/Anchorage",
      "Pacific/Honolulu",
      "America/Mexico_City",
    ],
  },
  {
    label: "South America",
    values: [
      "America/Bogota",
      "America/Lima",
      "America/Santiago",
      "America/Caracas",
      "America/Sao_Paulo",
      "America/Argentina/Buenos_Aires",
      "America/Montevideo",
    ],
  },
  {
    label: "Europe",
    values: [
      "Europe/London",
      "Europe/Dublin",
      "Europe/Lisbon",
      "Europe/Madrid",
      "Europe/Paris",
      "Europe/Brussels",
      "Europe/Amsterdam",
      "Europe/Berlin",
      "Europe/Zurich",
      "Europe/Rome",
      "Europe/Vienna",
      "Europe/Prague",
      "Europe/Warsaw",
      "Europe/Stockholm",
      "Europe/Copenhagen",
      "Europe/Oslo",
      "Europe/Helsinki",
      "Europe/Athens",
      "Europe/Bucharest",
      "Europe/Budapest",
      "Europe/Istanbul",
      "Europe/Kyiv",
    ],
  },
  {
    label: "Global Popular",
    values: [
      "UTC",
      "Asia/Dubai",
      "Asia/Kolkata",
      "Asia/Singapore",
      "Asia/Tokyo",
      "Australia/Sydney",
      "Africa/Johannesburg",
    ],
  },
] as const

export function TenantInfoForm({ tenantId }: TenantInfoFormProps) {
  const [payload, setPayload] = useState<TenantInfoPayload>(INITIAL_PAYLOAD)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

  const timezoneOptions = useMemo(() => {
    const known = new Set(
      typeof Intl.supportedValuesOf === "function"
        ? Intl.supportedValuesOf("timeZone")
        : TIMEZONE_GROUPS.flatMap((group) => group.values),
    )

    return TIMEZONE_GROUPS.map((group) => ({
      label: group.label,
      values: group.values.filter((timezone) => known.has(timezone)),
    })).filter((group) => group.values.length > 0)
  }, [])

  const timezonePreview = useMemo(() => {
    const options: Intl.DateTimeFormatOptions = {
      dateStyle: "medium",
      timeStyle: "short",
    }

    if (payload.timezone) {
      try {
        return new Intl.DateTimeFormat("en-US", {
          ...options,
          timeZone: payload.timezone,
        }).format(now)
      } catch {
        // fall back to system timezone below
      }
    }

    return new Intl.DateTimeFormat("en-US", options).format(now)
  }, [payload.timezone, now])

  const load = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const { data } = await api.get<TenantInfoResponse>(
        `/api/account-settings/${tenantId}/account`,
      )
      const tenant = data.tenant
      setPayload({
        name: tenant.name,
        email: normalizeString(tenant.email),
        phone: normalizeString(tenant.phone),
        addressLine1: normalizeString(tenant.addressLine1),
        addressLine2: normalizeString(tenant.addressLine2),
        city: normalizeString(tenant.city),
        state: normalizeString(tenant.state),
        postalCode: normalizeString(tenant.postalCode),
        country: normalizeString(tenant.country),
        timezone: normalizeString(tenant.timezone),
        website: normalizeString(tenant.website),
      })
    } catch {
      setErrorMessage("Could not load tenant information.")
    } finally {
      setIsLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date())
    }, 1_000)

    return () => {
      window.clearInterval(timer)
    }
  }, [])

  const handleSave = async () => {
    setIsSaving(true)
    setErrorMessage(null)

    try {
      const { data } = await api.patch<TenantInfoResponse>(
        `/api/account-settings/${tenantId}/account`,
        payload,
      )

      const tenant = data.tenant
      setPayload({
        name: tenant.name,
        email: normalizeString(tenant.email),
        phone: normalizeString(tenant.phone),
        addressLine1: normalizeString(tenant.addressLine1),
        addressLine2: normalizeString(tenant.addressLine2),
        city: normalizeString(tenant.city),
        state: normalizeString(tenant.state),
        postalCode: normalizeString(tenant.postalCode),
        country: normalizeString(tenant.country),
        timezone: normalizeString(tenant.timezone),
        website: normalizeString(tenant.website),
      })

      toast.success("Tenant information updated.")
    } catch (error) {
      if (isAxiosError(error)) {
        const message = error.response?.data?.error
        if (typeof message === "string") {
          setErrorMessage(message.replace(/_/g, " "))
        } else {
          setErrorMessage("Could not save tenant information.")
        }
      } else {
        setErrorMessage("Could not save tenant information.")
      }
      toast.error("Could not save tenant information.")
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
        Loading tenant information...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Tenant Information</h2>
        <p className="text-sm text-slate-500">
          Update your tenant profile, contact details, and location settings.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="tenant-name">Tenant Name</Label>
          <Input
            id="tenant-name"
            value={payload.name}
            onChange={(event) =>
              setPayload((prev) => ({ ...prev, name: event.target.value }))
            }
            placeholder="Tenant name"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="tenant-email">Email</Label>
          <Input
            id="tenant-email"
            type="email"
            value={payload.email}
            onChange={(event) =>
              setPayload((prev) => ({ ...prev, email: event.target.value }))
            }
            placeholder="hello@company.com"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="tenant-phone">Phone</Label>
          <AppPhoneInput
            id="tenant-phone"
            defaultCountry="US"
            international
            countryCallingCodeEditable={false}
            value={payload.phone || undefined}
            onChange={(value) =>
              setPayload((prev) => ({ ...prev, phone: value ?? "" }))
            }
            placeholder="+1 000 000 0000"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="tenant-timezone">Timezone</Label>
          <Select
            value={payload.timezone || TIMEZONE_EMPTY_VALUE}
            onValueChange={(value) =>
              setPayload((prev) => ({
                ...prev,
                timezone: value === TIMEZONE_EMPTY_VALUE ? "" : value,
              }))
            }
          >
            <SelectTrigger id="tenant-timezone" className="w-full">
              <SelectValue placeholder="Select timezone" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TIMEZONE_EMPTY_VALUE}>
                System Timezone (Default)
              </SelectItem>
              {timezoneOptions.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.values.map((timezone) => (
                    <SelectItem key={timezone} value={timezone}>
                      {timezone}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-slate-500">
            Current time in selected zone: {timezonePreview}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="tenant-website">Website</Label>
          <Input
            id="tenant-website"
            value={payload.website}
            onChange={(event) =>
              setPayload((prev) => ({ ...prev, website: event.target.value }))
            }
            placeholder="https://example.com"
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="tenant-address1">Address Line 1</Label>
          <Input
            id="tenant-address1"
            value={payload.addressLine1}
            onChange={(event) =>
              setPayload((prev) => ({ ...prev, addressLine1: event.target.value }))
            }
            placeholder="Address line 1"
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="tenant-address2">Address Line 2</Label>
          <Input
            id="tenant-address2"
            value={payload.addressLine2}
            onChange={(event) =>
              setPayload((prev) => ({ ...prev, addressLine2: event.target.value }))
            }
            placeholder="Address line 2"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="tenant-city">City</Label>
          <Input
            id="tenant-city"
            value={payload.city}
            onChange={(event) =>
              setPayload((prev) => ({ ...prev, city: event.target.value }))
            }
            placeholder="City"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="tenant-state">State/Province</Label>
          <Input
            id="tenant-state"
            value={payload.state}
            onChange={(event) =>
              setPayload((prev) => ({ ...prev, state: event.target.value }))
            }
            placeholder="State"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="tenant-postal">Postal Code</Label>
          <Input
            id="tenant-postal"
            value={payload.postalCode}
            onChange={(event) =>
              setPayload((prev) => ({ ...prev, postalCode: event.target.value }))
            }
            placeholder="Postal code"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="tenant-country">Country</Label>
          <Input
            id="tenant-country"
            value={payload.country}
            onChange={(event) =>
              setPayload((prev) => ({ ...prev, country: event.target.value }))
            }
            placeholder="Country"
          />
        </div>
      </div>

      {errorMessage ? (
        <p className="text-sm text-rose-600">{errorMessage}</p>
      ) : null}

      <div className="flex justify-end">
        <Button type="button" onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </div>
  )
}
