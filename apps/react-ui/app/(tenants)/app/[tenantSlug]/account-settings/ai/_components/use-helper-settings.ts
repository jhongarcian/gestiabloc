"use client"

import { useRef, useState } from "react"
import { isAxiosError } from "axios"
import { toast } from "sonner"
import { api } from "@/lib/api"
import type { AiHelperDraft } from "../_lib/demo-data"
import {
  AI_AVATAR_MAX_BYTES,
  emptyHelperSettings,
  helperFields,
  helperValidation,
  type AiAvatarPreset,
  type AiHelperSettings,
  type AiSettingsResponse,
} from "../_lib/helper-settings"

function errorMessage(error: unknown) {
  if (isAxiosError(error)) {
    const code = error.response?.data?.error
    if (code === "FILE_TOO_LARGE") return "Choose an image smaller than 5 MB."
    if (code === "UNSUPPORTED_OR_INVALID_IMAGE" || code === "INVALID_IMAGE")
      return "Choose a valid PNG, JPEG, or WebP image."
    if (error.response?.status === 401)
      return "Your session has expired. Sign in again to save changes."
    if (error.response?.status === 403)
      return "You need account administrator access to save these changes."
    if (code === "AVATAR_UPLOAD_FAILED")
      return "The image could not be uploaded. Your current avatar is unchanged. Try again."
  }
  return "Changes could not be saved. Your edits are still here. Try again."
}

export function useHelperSettings(
  tenantId: string,
  initialSettings: AiHelperSettings | null,
) {
  const [savedHelper, setSavedHelper] = useState(initialSettings)
  const [helper, updateHelper] = useState(() =>
    helperFields(initialSettings ?? emptyHelperSettings()),
  )
  const [helperError, setHelperError] = useState(
    initialSettings
      ? ""
      : "Helper settings could not be loaded. Retry to edit your saved helper.",
  )
  const [avatarError, setAvatarError] = useState("")
  const [helperConflict, setHelperConflict] = useState<AiHelperSettings | null>(
    null,
  )
  const [operation, setOperation] = useState<
    "settings" | "avatar" | "load" | null
  >(null)
  const lock = useRef(false)
  const path = `/api/account-settings/${tenantId}/ai`
  const fieldErrors = helperValidation(helper)
  const helperDirty =
    savedHelper !== null &&
    JSON.stringify(helper) !== JSON.stringify(helperFields(savedHelper))

  async function getSaved() {
    const { data } = await api.get<AiSettingsResponse>(`${path}/settings`)
    return data.settings
  }
  async function reloadHelper() {
    if (lock.current) return
    lock.current = true
    setOperation("load")
    try {
      const latest = await getSaved()
      setSavedHelper(latest)
      updateHelper(helperFields(latest))
      setHelperError("")
      setHelperConflict(null)
    } catch {
      setHelperError(
        "Helper settings could not be loaded. Check your connection and retry.",
      )
    } finally {
      lock.current = false
      setOperation(null)
    }
  }
  async function saveHelper() {
    if (
      lock.current ||
      !savedHelper ||
      helperConflict ||
      !helperDirty ||
      Object.keys(fieldErrors).length
    )
      return
    lock.current = true
    setOperation("settings")
    setHelperError("")
    try {
      const { data } = await api.patch<AiSettingsResponse>(`${path}/settings`, {
        ...helperFields(helper),
        revision: savedHelper.revision,
      })
      setSavedHelper(data.settings)
      updateHelper(helperFields(data.settings))
      toast.success("Helper settings saved.")
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 409) {
        try {
          setHelperConflict(await getSaved())
          setHelperError("")
        } catch {
          setHelperError(
            "Another administrator changed these settings. Retry saving to load their changes; your edits are still here.",
          )
        }
      } else setHelperError(errorMessage(error))
    } finally {
      lock.current = false
      setOperation(null)
    }
  }
  function resolveHelperConflict(keepEdits: boolean) {
    if (!helperConflict) return
    // Only an explicit choice accepts the newer text revision.
    setSavedHelper((current) => ({
      ...helperConflict,
      avatar: current?.avatar ?? helperConflict.avatar,
    }))
    if (!keepEdits) updateHelper(helperFields(helperConflict))
    setHelperConflict(null)
  }
  async function changeAvatar(
    action: () => Promise<{ data: AiSettingsResponse }>,
  ) {
    if (lock.current || !savedHelper) return
    lock.current = true
    setOperation("avatar")
    setAvatarError("")
    try {
      const { data } = await action()
      // Avatar saves never advance the draft's text revision or overwrite its text.
      setSavedHelper((current) =>
        current ? { ...current, avatar: data.settings.avatar } : current,
      )
      toast.success("Helper avatar saved.")
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 409) {
        try {
          const latest = await getSaved()
          setSavedHelper((current) =>
            current ? { ...current, avatar: latest.avatar } : current,
          )
          setAvatarError(
            "Another administrator changed the avatar. Their saved avatar is shown. Choose again to replace it.",
          )
        } catch {
          setAvatarError(
            "The avatar changed elsewhere. Reload this page before changing it again.",
          )
        }
      } else setAvatarError(errorMessage(error))
    } finally {
      lock.current = false
      setOperation(null)
    }
  }
  function setAvatarPreset(presetId: AiAvatarPreset) {
    return changeAvatar(() =>
      api.patch<AiSettingsResponse>(`${path}/avatar`, {
        presetId,
        avatarRevision: savedHelper?.avatar.revision,
      }),
    )
  }
  function removeAvatar() {
    return changeAvatar(() =>
      api.delete<AiSettingsResponse>(`${path}/avatar`, {
        data: { avatarRevision: savedHelper?.avatar.revision },
      }),
    )
  }
  async function uploadAvatar(file: File) {
    if (lock.current || !savedHelper) return
    if (!file.size || file.size > AI_AVATAR_MAX_BYTES) {
      setAvatarError("Choose an image smaller than 5 MB.")
      return
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setAvatarError("Choose a PNG, JPEG, or WebP image.")
      return
    }
    const form = new FormData()
    form.append("avatarRevision", String(savedHelper.avatar.revision))
    form.append("file", file)
    await changeAvatar(() =>
      api.post<AiSettingsResponse>(`${path}/avatar`, form),
    )
  }
  return {
    helper,
    savedHelper,
    helperReady: savedHelper !== null,
    helperError,
    avatarError,
    helperConflict,
    helperDirty,
    fieldErrors,
    helperBusy: operation !== null,
    isSavingHelper: operation === "settings",
    isSavingAvatar: operation === "avatar",
    setHelper: (value: AiHelperDraft) => {
      if (!lock.current) {
        updateHelper(value)
        setHelperError("")
      }
    },
    saveHelper,
    reloadHelper,
    resolveHelperConflict,
    setAvatarPreset,
    removeAvatar,
    uploadAvatar,
  }
}
