"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { isAxiosError } from "axios"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { changedProfileFields, profileDraft, profileFields, validateProfile, type AccountField, type AccountProfileDraft, type AccountProfileResponse, type ProfileErrors, type ProfileScope } from "@/lib/account-profile"

export function useAccountProfile(tenantId: string, initialProfile: AccountProfileResponse["tenant"] | null, scope: ProfileScope) {
  const router = useRouter()
  const [savedProfile, setSavedProfile] = useState(initialProfile)
  const [draft, setDraft] = useState(() => profileDraft(initialProfile))
  const [busy, setBusy] = useState<"load" | "save" | null>(null)
  const [error, setError] = useState(initialProfile ? "" : "Company information could not be loaded. Retry before editing your account.")
  const [serverErrors, setServerErrors] = useState<ProfileErrors>({})
  const [conflict, setConflict] = useState<AccountProfileResponse["tenant"] | null>(null)
  const lock = useRef(false)
  const path = `/api/account-settings/${tenantId}/account`
  const changes = changedProfileFields(draft, profileDraft(savedProfile), scope)
  const dirty = Boolean(savedProfile) && Object.keys(changes).length > 0
  const fieldErrors = savedProfile ? { ...validateProfile(draft, scope), ...serverErrors } : {}
  async function read() { return (await api.get<AccountProfileResponse>(path)).data.tenant }
  async function reload() {
    if (lock.current) return
    lock.current = true; setBusy("load")
    try {
      const latest = await read()
      setSavedProfile(latest); setDraft(profileDraft(latest)); setError(""); setServerErrors({}); setConflict(null)
    } catch { setError("Company information could not be loaded. Check your connection and retry.") }
    finally { lock.current = false; setBusy(null) }
  }
  async function save() {
    if (lock.current || !savedProfile || !dirty || conflict || Object.keys(fieldErrors).length) return
    lock.current = true; setBusy("save"); setError("")
    try {
      const { data } = await api.patch<AccountProfileResponse>(path, { ...changes, revision: savedProfile.revision })
      setSavedProfile(data.tenant); setDraft(profileDraft(data.tenant)); setServerErrors({})
      toast.success(scope === "company" ? "Company information saved." : "Account information saved.")
      // Refresh the account name in the main navigation and invalidate prefetched forms.
      router.refresh()
    } catch (cause) {
      if (isAxiosError(cause) && cause.response?.status === 409) {
        try { setConflict(await read()) }
        catch { setError("Newer account changes were saved. Retry saving to review them. Your edits are still here.") }
      } else if (isAxiosError(cause) && cause.response?.status === 400) {
        const details: unknown = cause.response.data?.details
        const errors: ProfileErrors = {}
        if (Array.isArray(details)) for (const detail of details) {
          if (typeof detail?.path === "string" && typeof detail?.message === "string" && profileFields(scope).includes(detail.path as AccountField)) errors[detail.path as AccountField] = detail.message
        }
        setServerErrors(errors)
        setError("Review the highlighted fields and try again.")
      } else if (isAxiosError(cause) && cause.response?.status === 401) setError("Your session has expired. Sign in again to save changes.")
      else if (isAxiosError(cause) && cause.response?.status === 403) setError("You need account administrator access to save these changes.")
      else setError("Changes could not be saved. Your edits are still here. Try again.")
    } finally { lock.current = false; setBusy(null) }
  }
  function setField<K extends keyof AccountProfileDraft>(key: K, value: AccountProfileDraft[K]) {
    if (lock.current) return
    setDraft((current) => ({ ...current, [key]: value }))
    setServerErrors((current) => { const next = { ...current }; delete next[key]; return next })
    setError("")
  }
  function resolveConflict(keepEdits: boolean) {
    if (!conflict || lock.current) return
    const latest = profileDraft(conflict)
    setDraft((current) => keepEdits ? { ...latest, ...changedProfileFields(current, profileDraft(savedProfile), scope) } : latest)
    setSavedProfile(conflict); setConflict(null); setServerErrors({}); setError("")
  }
  return { scope, draft, savedProfile, ready: savedProfile !== null, dirty, busy, error, fieldErrors, conflict, reload, save, setField, resolveConflict }
}
export type AccountProfileController = ReturnType<typeof useAccountProfile>
