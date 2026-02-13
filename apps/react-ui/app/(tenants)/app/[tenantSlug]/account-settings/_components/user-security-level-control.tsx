"use client"

import { useMemo, useState } from "react"
import { isAxiosError } from "axios"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { api } from "@/lib/api"

type SecurityLevel = "LOW" | "MEDIUM" | "MAX"
type TenantRole = "TENANT_ADMIN" | "TENANT_USER" | string

type UserSecurityLevelControlProps = {
  tenantId: string
  userId: string
  role: TenantRole
  initialSecurityLevel: SecurityLevel
  onSaved?: (securityLevel: SecurityLevel) => void
}

const SECURITY_LEVEL_OPTIONS: Array<{ value: SecurityLevel; label: string }> = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "MAX", label: "Max" },
]

const formatSegment = (segment: string) =>
  segment.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())

export function UserSecurityLevelControl({
  tenantId,
  userId,
  role,
  initialSecurityLevel,
  onSaved,
}: UserSecurityLevelControlProps) {
  const isTenantAdmin = role === "TENANT_ADMIN"
  const lockedValue: SecurityLevel = "MAX"
  const startValue = isTenantAdmin ? lockedValue : initialSecurityLevel

  const [savedValue, setSavedValue] = useState<SecurityLevel>(startValue)
  const [value, setValue] = useState<SecurityLevel>(startValue)
  const [isSaving, setIsSaving] = useState(false)

  const hasChanges = useMemo(() => {
    return value !== savedValue
  }, [savedValue, value])

  const handleSave = async () => {
    if (!hasChanges) return

    setIsSaving(true)
    try {
      await api.patch(`/api/account-settings/${tenantId}/users/${userId}/security-level`, {
        securityLevel: value,
      })
      setSavedValue(value)
      onSaved?.(value)
      toast.success("Security level updated.")
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        if (typeof backendError === "string") {
          toast.error(formatSegment(backendError))
        } else {
          toast.error("Could not update security level.")
        }
      } else {
        toast.error("Could not update security level.")
      }
      setValue(savedValue)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-slate-900">Security Level Access</h3>
        <p className="text-xs text-slate-500">
          Controls how much sensitive tenant data this member can access.
        </p>
      </div>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select
          value={value}
          onValueChange={(next) => {
            if (next === "LOW" || next === "MEDIUM" || next === "MAX") {
              setValue(next)
            }
          }}
          disabled={isTenantAdmin || isSaving}
        >
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SECURITY_LEVEL_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          type="button"
          onClick={() => {
            void handleSave()
          }}
          disabled={isTenantAdmin || !hasChanges || isSaving}
          className="sm:self-start"
        >
          {isSaving ? "Saving..." : "Save Level"}
        </Button>
      </div>

      {isTenantAdmin ? (
        <p className="mt-2 text-xs text-slate-500">
          Tenant admin members are fixed at Max security level.
        </p>
      ) : null}
    </div>
  )
}
